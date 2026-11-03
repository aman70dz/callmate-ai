import { z } from 'zod';
import { repository } from '../services/repository.js';
import { callQueue } from '../queues/callQueue.js';
import { env, liveCallsEnabled } from '../config/env.js';
import { placeOutboundCall } from '../services/telephonyService.js';

const createSchema = z.object({
  contactName: z.string().trim().min(1).max(100),
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, e.g. +919876543210.'),
  instruction: z.string().trim().min(3).max(2000),
  language: z.enum(['en','hi']),
  recipientConsentConfirmed: z.literal(true),
  maxAttempts: z.literal(2).default(2)
});

export async function createCallTask(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid call task.', details: parsed.error.flatten() });
    }

    const p = parsed.data;
    const task = await repository.createTask({
      user_id: req.user.id,
      contact_name: p.contactName,
      phone_number: p.phoneNumber,
      instruction: p.instruction,
      language: p.language,
      recipient_consent_confirmed: true,
      max_attempts: 2,
      retry_delay_minutes: 10,
      attempts_made: 0,
      status: 'pending'
    });

    const shouldQueue = env.DATA_MODE === 'supabase' && env.REDIS_URL && callQueue && liveCallsEnabled;
    if (shouldQueue) {
      await callQueue.add(
        'place-call',
        { taskId: task.id, attemptNumber: 1 },
        { jobId: `initial-${task.id}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 500, removeOnFail: 1000 }
      );
    }

    res.status(201).json({
      task,
      mode: shouldQueue ? 'queued' : (env.DATA_MODE === 'supabase' ? 'supabase' : 'demo')
    });
  } catch (e) {
    next(e);
  }
}

export async function listCallTasks(req, res, next) {
  try {
    res.json({ tasks: await repository.listTasks(req.user.id) });
  } catch (e) {
    next(e);
  }
}

export async function cancelCallTask(req, res, next) {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task || task.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (!['pending','retry_scheduled'].includes(task.status)) {
      return res.status(409).json({ error: 'This task can no longer be cancelled.' });
    }
    const updated = await repository.updateTask(task.id, { status: 'cancelled', next_retry_at: null });
    res.json({ task: updated });
  } catch (e) {
    next(e);
  }
}

export async function completeCallTask(req, res, next) {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task || task.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    const updated = await repository.updateTask(task.id, {
      status: 'completed',
      attempts_made: Math.max(1, task.attempts_made || 1)
    });
    res.json({ task: updated });
  } catch (e) {
    next(e);
  }
}

export async function dialCallTask(req, res, next) {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task || task.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    if (task.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot dial a cancelled task.' });
    }
    if (!liveCallsEnabled) {
      return res.status(400).json({
        error: 'Live calling is currently disabled (ENABLE_LIVE_CALLS=false in .env). Set ENABLE_LIVE_CALLS=true to place real phone calls.',
        hint: 'Verify TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and APP_BASE_URL in .env'
      });
    }

    const nextAttemptNum = (task.attempts_made || 0) + 1;
    const attempt = await repository.createAttempt(task.id, nextAttemptNum);
    await repository.updateTask(task.id, {
      status: 'calling',
      attempts_made: nextAttemptNum
    });

    try {
      const result = await placeOutboundCall({
        phoneNumber: task.phone_number,
        taskId: task.id
      });
      await repository.updateAttempt(attempt.id, {
        provider_call_sid: result.sid,
        status: 'ringing',
        started_at: new Date().toISOString()
      });
      const updatedTask = await repository.getTask(task.id);
      res.json({ success: true, sid: result.sid, task: updatedTask });
    } catch (dialErr) {
      await repository.updateAttempt(attempt.id, {
        status: 'failed',
        ended_at: new Date().toISOString()
      });
      await repository.updateTask(task.id, { status: 'failed' });
      throw dialErr;
    }
  } catch (e) {
    next(e);
  }
}
