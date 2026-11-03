import IORedis from 'ioredis';
import { env } from './env.js';

export function createRedisConnection() {
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the worker.');
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
