import { Router } from 'express';
import { repository } from '../services/repository.js';
import { callQueue } from '../queues/callQueue.js';
const router = Router();

// Verify Exotel webhook authentication/signature against the current provider
// guidance before enabling this endpoint publicly. Do not trust arbitrary callbacks.
router.post('/exotel/status', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sid = body.CallSid || body.call_sid || body.Sid || body.Call?.Sid;
    const status = String(body.Status || body.status || body.CallStatus || '').toLowerCase();
    if (!sid || !status) return res.status(400).json({ error: 'Missing call SID or status.' });
    const attempt = await repository.getAttemptByProviderSid(sid);
    if (!attempt) return res.status(202).json({ received: true, matched: false });
    const task = await repository.getTask(attempt.task_id);
    const terminal = ['completed','failed','busy','no-answer','no_answer'];
    if (!terminal.includes(status)) return res.json({ received: true });
    await repository.updateAttempt(attempt.id, { status: status.replace('-', '_'), ended_at: new Date().toISOString() });

    if (['busy','no-answer','no_answer','failed'].includes(status) && attempt.attempt_number === 1 && task?.status !== 'cancelled') {
      const retryAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await repository.updateTask(task.id, { status: 'retry_scheduled', next_retry_at: retryAt });
      await callQueue.add('place-call', { taskId: task.id, attemptNumber: 2 }, { delay: 10 * 60 * 1000, jobId: `retry-${task.id}`, removeOnComplete: 500, removeOnFail: 1000 });
    } else if (['busy','no-answer','no_answer','failed'].includes(status)) {
      await repository.updateTask(task.id, { status: 'no_answer', next_retry_at: null });
    } else {
      await repository.updateTask(task.id, { status: 'completed', next_retry_at: null });
    }
    res.json({ received: true });
  } catch (e) { next(e); }
});
export default router;
