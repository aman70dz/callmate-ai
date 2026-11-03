import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
    NODE_ENV: z.string().default('development'),

    PORT: z.coerce.number().default(5000),

    FRONTEND_ORIGIN: z.string().default(
        'http://localhost:5173'
    ),

    APP_BASE_URL: z.string().optional(),

    DATA_MODE: z.enum([
        'demo',
        'supabase'
    ]).default('demo'),

    // Gemini AI
    GEMINI_API_KEY: z.string().optional(),

    GEMINI_TEXT_MODEL: z.string().default(
        'gemini-3-flash-preview'
    ),

    GEMINI_REALTIME_MODEL: z.string().default(
        'models/gemini-2.5-flash-native-audio-latest'
    ),

    GEMINI_REALTIME_VOICE: z.string().default(
        'Puck'
    ),

    // Exotel
    EXOTEL_BASE_URL: z.string().default(
        'https://api.in.exotel.com'
    ),

    EXOTEL_ACCOUNT_SID: z.string().optional(),

    EXOTEL_API_KEY: z.string().optional(),

    EXOTEL_API_TOKEN: z.string().optional(),

    EXOTEL_CALLER_ID: z.string().optional(),

    // Supabase
    SUPABASE_URL: z.string().optional(),

    SUPABASE_ANON_KEY: z.string().optional(),

    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    // Redis
    REDIS_URL: z.string().optional(),

    // Telephony provider
    TELEPHONY_PROVIDER: z.enum(['exotel', 'twilio']).default('twilio'),

    // Twilio
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),

    // Live calling kill switch
    ENABLE_LIVE_CALLS: z.string().default('false')
});

export const env = schema.parse(process.env);

export const liveCallsEnabled =
    env.ENABLE_LIVE_CALLS === 'true';