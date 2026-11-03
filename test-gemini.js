import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not defined in .env');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3-flash-preview';

async function test() {
    try {
        console.log(`Testing Gemini text generation with model "${model}"...`);
        const start = Date.now();

        const response = await ai.models.generateContent({
            model,
            contents: 'Generate a short, polite Hindi greeting for calling my father.',
            config: {
                systemInstruction: 'You are CallMate AI, a polite personal calling assistant.'
            }
        });

        console.log(`\nGemini response (${Date.now() - start}ms):`);
        console.log(response.text?.trim());
        console.log('\n[SUCCESS] Gemini text generation verified.');
    } catch (error) {
        console.error('\nGemini generation failed.');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
    }
}

test();
