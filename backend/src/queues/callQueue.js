import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { env } from '../config/env.js';

// Keep demo mode dependency-free. Production Supabase mode must configure Redis.
export const callQueue = env.DATA_MODE === 'supabase' && env.REDIS_URL
  ? new Queue('callmate-calls', { connection: createRedisConnection() })
  : null;
