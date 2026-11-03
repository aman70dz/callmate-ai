import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { env } from '../config/env.js';

let genAIClient = null;

function getClient() {
  if (!env.GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY is missing. Please add your Gemini API key to .env.');
    error.status = 503;
    throw error;
  }

  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  return genAIClient;
}

// Zod schema for runtime validation of the generated plan
export const planSchema = z.object({
  objective: z.string().min(1, 'Objective is required'),
  opening_message: z.string().min(1, 'Opening message is required'),
  key_points: z.array(z.string()).min(1, 'At least one key point is required'),
  if_unknown: z.string().min(1, 'Unknown response handler is required'),
  language: z.enum(['hi', 'en']),
  clarification_needed: z.boolean(),
  clarification_question: z.string().default('')
});

// Candidate models for graceful fallback if the primary experiences high demand (503) or quota exhaustion (429)
const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.8-flash'
];

/**
 * Executes a Gemini request with retry on transient errors and model fallback.
 */
async function executeWithFallback(operationName, executeFn) {
  if (!env.GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY is missing. Please add your Gemini API key to .env.');
    error.status = 503;
    throw error;
  }

  const primaryModel = env.GEMINI_TEXT_MODEL || 'gemini-3-flash-preview';
  const modelsToTry = [
    primaryModel,
    ...FALLBACK_MODELS.filter(m => m !== primaryModel)
  ];

  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isPrimary = (i === 0);
    const maxAttempts = isPrimary ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const client = getClient();
        const result = await executeFn(client, model);
        return { result, model };
      } catch (err) {
        lastError = err;
        const status = err.status || (err.message?.includes('503') ? 503 : undefined);
        const isTransient = status === 503 || status === 429 || err.name === 'AbortError' || err.code === 'ECONNRESET';
        const isRetired = status === 404;

        // Log diagnostics safely without exposing API keys
        console.warn(`[Gemini] ${operationName} failed on model "${model}" (attempt ${attempt}/${maxAttempts}): ${err.message || status || 'Unknown error'}`);

        // If it's a fatal client error like bad API key (400/401/403), stop immediately
        if (status === 400 && err.message?.includes('API key')) {
          const authErr = new Error('Invalid Gemini API key. Please check your configuration in .env.');
          authErr.status = 401;
          throw authErr;
        }

        // If daily quota for this specific model is reached, jump directly to fallback model
        if (err.message?.includes('PerDay') || err.message?.includes('quota')) {
          break;
        }

        if (isTransient && attempt < maxAttempts) {
          // Exponential backoff before retry
          const delay = attempt * 800;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // If retired (404) or transient exhausted, break to next fallback model
        if (isRetired || isTransient) {
          break;
        }

        // For any other non-retryable error, throw directly
        throw mapToSafeError(err);
      }
    }
  }

  throw mapToSafeError(lastError);
}

function mapToSafeError(err) {
  if (err.status && err.status < 500) {
    return err;
  }
  const status = err.status || 503;
  const message = status === 503
    ? 'Gemini AI service is currently unavailable or experiencing high demand. Please try again in a few moments.'
    : status === 429
    ? 'Gemini AI rate limit exceeded. Please wait a moment and retry.'
    : 'Failed to generate response from Gemini AI. Please try again.';
  const safeErr = new Error(message);
  safeErr.status = status;
  return safeErr;
}

/**
 * Prepares a structured call plan for CallMate.
 */
export async function prepareCallPlan({
  contactName,
  instruction,
  language,
  additionalContext
}) {
  const systemInstruction = `
You are CallMate, a polite, transparent, and structured personal AI calling assistant.

Your purpose is to prepare a concise, high-clarity conversation plan for an outbound phone call conducted on behalf of the user.

STRICT CONVERSATION RULES:
1. Transparency: The AI must identify itself as an AI assistant calling on behalf of the user. Never pretend to be human.
2. Truthfulness: Only use facts explicitly provided in the user's instruction. Never invent dates, addresses, amounts, or commitments.
3. Language:
   - If language is 'hi', opening message and talking points must be in natural, polite Hindi (Devanagari script or natural conversational phrasing).
   - If language is 'en', opening message and talking points must be in natural, clear English.
4. Voice-friendly: Keep the opening greeting and talking points short, natural, and suitable for phone conversations.
5. Unknowns: Always provide a safe response for 'if_unknown' instructing the assistant to say it will check with the user and have them follow up.
6. Ambiguity: If the user's instruction lacks critical information to complete the call, set 'clarification_needed' to true and specify 'clarification_question'.
7. Safety: The plan must never attempt or simulate placing a phone call directly.
`;

  const inputPayload = {
    recipient_name: contactName,
    requested_language: language,
    user_instruction: instruction,
    additional_context: additionalContext || undefined
  };

  const { result: response, model: usedModel } = await executeWithFallback(
    'prepareCallPlan',
    async (client, model) => {
      return await client.models.generateContent({
        model,
        contents: JSON.stringify(inputPayload),
        config: {
          systemInstruction,
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              objective: {
                type: Type.STRING,
                description: 'The single concise objective of the conversation'
              },
              opening_message: {
                type: Type.STRING,
                description: 'Natural opening greeting stating AI identity and user reference'
              },
              key_points: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'List of essential talking points to cover'
              },
              if_unknown: {
                type: Type.STRING,
                description: 'Safe fallback response when asked something outside instructions'
              },
              language: {
                type: Type.STRING,
                enum: ['hi', 'en'],
                description: 'Language code: hi for Hindi, en for English'
              },
              clarification_needed: {
                type: Type.BOOLEAN,
                description: 'True if user instruction is ambiguous or missing critical info'
              },
              clarification_question: {
                type: Type.STRING,
                description: 'Question to ask user if clarification is needed, else empty'
              }
            },
            required: [
              'objective',
              'opening_message',
              'key_points',
              'if_unknown',
              'language',
              'clarification_needed',
              'clarification_question'
            ]
          }
        }
      });
    }
  );

  const rawText = response.text?.trim();
  if (!rawText) {
    const emptyErr = new Error('Gemini returned an empty response.');
    emptyErr.status = 502;
    throw emptyErr;
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    const parseErr = new Error('Gemini returned malformed JSON.');
    parseErr.status = 502;
    throw parseErr;
  }

  const validatedPlan = planSchema.parse(parsedJson);

  // Return an object that works both as { plan, model } and directly as plan
  const result = { ...validatedPlan };
  Object.defineProperty(result, 'plan', { value: validatedPlan, enumerable: false });
  Object.defineProperty(result, 'model', { value: usedModel, enumerable: false });

  return result;
}

/**
 * Generates an ongoing conversational reply for a live call turn.
 */
export async function generateConversationReply({
  language,
  recipientName,
  objective,
  keyPoints = [],
  transcript = [],
  recipientMessage
}) {
  const systemInstruction = `
You are CallMate, a polite personal AI calling assistant speaking on the telephone on behalf of the user.

Your job is to conduct a natural, short, and respectful phone conversation.

STRICT CONVERSATIONAL RULES:
1. Transparency: Always be transparent that you are an AI assistant calling on behalf of the user. Never pretend to be human.
2. Short & Voice-Friendly: Limit your reply to 1-2 concise, conversational sentences suitable for speech synthesis.
3. Language:
   - If language is 'hi', speak natural Hindi or Hinglish suitable for everyday Indian phone conversations.
   - If language is 'en', speak natural, clear English.
4. Truthfulness: Only use the supplied objective and key points. Never invent facts, prices, dates, or promises.
5. Unknown questions: If asked something not in the key points or objective, politely state that you do not have that information and will ask the user to follow up.
6. Stop / Opt-out requests: If the recipient says "stop", "bye", "hang up", "not interested", "wrong number", or asks to end the call, politely apologize, acknowledge, and end the call immediately.
7. Security: Never ask for passwords, OTPs, PINs, or financial details.
`;

  const inputPayload = {
    language,
    recipient_name: recipientName,
    objective,
    key_points: keyPoints,
    recent_transcript: transcript.slice(-10),
    latest_recipient_message: recipientMessage
  };

  const { result: response, model: usedModel } = await executeWithFallback(
    'generateConversationReply',
    async (client, model) => {
      return await client.models.generateContent({
        model,
        contents: JSON.stringify(inputPayload),
        config: {
          systemInstruction,
          temperature: 0.4
        }
      });
    }
  );

  const replyText = response.text?.trim();

  const safeDefault = language === 'hi'
    ? 'माफ़ कीजिए, मेरे पास इस बारे में पूरी जानकारी नहीं है। मैं उपयोगकर्ता से कहूँगा कि वे आपसे सीधे बात करें।'
    : 'I am sorry, I do not have that information. I will ask the person I am calling on behalf of to follow up with you.';

  const finalReply = replyText || safeDefault;

  return {
    reply: finalReply,
    model: usedModel,
    toString() {
      return finalReply;
    }
  };
}
