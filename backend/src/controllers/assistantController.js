import { z } from 'zod';
import { env } from '../config/env.js';
import { prepareCallPlan, generateConversationReply } from '../services/geminiAssistant.js';

const prepareSchema = z.object({
  contactName: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(3).max(2000),
  language: z.enum(['en', 'hi'])
});

const replySchema = z.object({
  language: z.enum(['en', 'hi']),
  recipientName: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(1000),
  keyPoints: z.array(z.string().max(300)).max(10).default([]),
  transcript: z.array(z.object({
    speaker: z.enum(['assistant', 'recipient']),
    text: z.string().max(1500)
  })).max(30).default([]),
  recipientMessage: z.string().trim().min(1).max(1500)
});

export async function prepareAssistantCall(req, res, next) {
  try {
    const parsed = prepareSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request.',
        details: parsed.error.flatten()
      });
    }

    const result = await prepareCallPlan(parsed.data);
    const plan = result.plan || result;
    const model = result.model || 'gemini';

    res.json({
      plan,
      model,
      textModel: env.GEMINI_TEXT_MODEL
    });
  } catch (error) {
    next(error);
  }
}

export async function assistantReply(req, res, next) {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request.',
        details: parsed.error.flatten()
      });
    }

    const result = await generateConversationReply(parsed.data);
    const reply = typeof result === 'string' ? result : result.reply;
    const model = result.model || 'gemini';

    res.json({
      reply,
      model
    });
  } catch (error) {
    next(error);
  }
}
