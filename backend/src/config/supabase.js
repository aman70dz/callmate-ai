import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = env.DATA_MODE === 'supabase'
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;
