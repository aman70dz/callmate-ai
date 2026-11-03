import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { repository } from '../services/repository.js';
import { placeOutboundCall } from '../services/telephonyService.js';
import { env } from '../config/env.js';

const connection = createRedisConnection();
const worker = new Worker('callmate-calls', async job => {
  const { taskId, attemptNumber } = job.data;
  const task = await repository.getTask(taskId);
  if (!task || task.status === 'cancelled') return;
  if (!task.recipient_consent_confirmed) throw new Error('Recipient consent confirmation is missing.');
  if (attemptNumber > 2 || task.attempts_made >= 2) return;

  const attempt = await repository.createAttempt(taskId, attemptNumber);
  await repository.updateTask(taskId, { status: 'calling', attempts_made: attemptNumber });
  try {
    const result = await placeOutboundCall({ phoneNumber: task.phone_number, taskId });
    await repository.updateAttempt(attempt.id, { provider_call_sid: result.sid, status: 'ringing', started_at: new Date().toISOString() });
  } catch (error) {
    await repository.updateAttempt(attempt.id, { status: 'failed', ended_at: new Date().toISOString() });
    await repository.updateTask(taskId, { status: 'failed' });
    throw error;
  }
}, { connection, concurrency: 3 });

worker.on('completed', job => console.log(`Call job completed: ${job.id}`));
worker.on('failed', (job, err) => console.error(`Call job failed: ${job?.id}`, err.message));
console.log(`CallMate worker running (DATA_MODE=${env.DATA_MODE}).`);
