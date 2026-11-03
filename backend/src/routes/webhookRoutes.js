import { Router } from 'express';
import { repository } from '../services/repository.js';
import { callQueue } from '../queues/callQueue.js';
import { env } from '../config/env.js';
import { prepareCallPlan, generateConversationReply } from '../services/geminiAssistant.js';
import {
  escapeXml,
  buildTwilioVoiceTwiML,
  buildTwilioGatherTwiML
} from '../services/twilioService.js';

const router = Router();

// ==========================================
// EXOTEL WEBHOOKS
// ==========================================
router.post('/exotel/status', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sid = body.CallSid || body.call_sid || body.Sid || body.Call?.Sid;
    const status = String(body.Status || body.status || body.CallStatus || '').toLowerCase();
    if (!sid || !status) return res.status(400).json({ error: 'Missing call SID or status.' });
    const attempt = await repository.getAttemptByProviderSid(sid);
    if (!attempt) return res.status(202).json({ received: true, matched: false });
    const task = await repository.getTask(attempt.task_id);
    const terminal = ['completed', 'failed', 'busy', 'no-answer', 'no_answer'];
    if (!terminal.includes(status)) return res.json({ received: true });
    await repository.updateAttempt(attempt.id, { status: status.replace('-', '_'), ended_at: new Date().toISOString() });

    if (['busy', 'no-answer', 'no_answer', 'failed'].includes(status) && attempt.attempt_number === 1 && task?.status !== 'cancelled') {
      const retryAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await repository.updateTask(task.id, { status: 'retry_scheduled', next_retry_at: retryAt });
      if (callQueue) {
        await callQueue.add('place-call', { taskId: task.id, attemptNumber: 2 }, { delay: 10 * 60 * 1000, jobId: `retry-${task.id}`, removeOnComplete: 500, removeOnFail: 1000 });
      }
    } else if (['busy', 'no-answer', 'no_answer', 'failed'].includes(status)) {
      await repository.updateTask(task.id, { status: 'no_answer', next_retry_at: null });
    } else {
      await repository.updateTask(task.id, { status: 'completed', next_retry_at: null });
    }
    res.json({ received: true });
  } catch (e) { next(e); }
});

// ==========================================
// TWILIO WEBHOOKS (Voice, Speech Gather, Status)
// ==========================================

// 1. Initial Voice Webhook: Twilio hits this when the recipient answers
router.all('/twilio/voice', async (req, res, next) => {
  try {
    const taskId = req.query.taskId || req.body.taskId;
    const callSid = req.body.CallSid || req.query.CallSid;

    if (!taskId) {
      const notFoundXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Task ID missing.</Say><Hangup/></Response>';
      return res.type('text/xml').send(notFoundXml);
    }

    const task = await repository.getTask(taskId);
    if (!task) {
      const notFoundXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Task not found.</Say><Hangup/></Response>';
      return res.type('text/xml').send(notFoundXml);
    }

    await repository.updateTask(task.id, { status: 'calling' });

    const attempts = await repository.listAttempts(task.id);
    let attempt = attempts[attempts.length - 1];
    if (!attempt) {
      attempt = await repository.createAttempt(task.id, 1);
    }
    if (callSid) {
      await repository.updateAttempt(attempt.id, {
        provider_call_sid: callSid,
        status: 'in_progress',
        started_at: new Date().toISOString()
      });
    }

    let conversation = await repository.getLatestConversation(task.id);
    if (!conversation) {
      conversation = await repository.createConversation({
        taskId: task.id,
        attemptId: attempt.id,
        language: task.language
      });
    }

    let openingStatement = task.language === 'hi'
      ? `नमस्ते ${task.contact_name}, मैं कॉलमेट एआई बात कर रहा हूँ।`
      : `Hello ${task.contact_name}, this is CallMate AI calling.`;

    try {
      const plan = await prepareCallPlan({
        contactName: task.contact_name,
        instruction: task.instruction,
        language: task.language
      });
      if (plan.opening_message || plan.openingStatement) {
        openingStatement = plan.opening_message || plan.openingStatement;
      }
    } catch (err) {
      console.warn('Using default opening statement:', err.message);
    }

    await repository.saveTranscript(conversation.id, 'assistant', openingStatement);

    const baseUrl = (env.APP_BASE_URL || '').replace(/\/$/, '');
    const gatherUrl = `${baseUrl}/webhooks/twilio/gather?taskId=${encodeURIComponent(task.id)}&conversationId=${encodeURIComponent(conversation.id)}`;

    const xml = buildTwilioVoiceTwiML({
      openingStatement,
      gatherUrl,
      language: task.language
    });

    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('Twilio voice webhook error:', err);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>An internal error occurred.</Say><Hangup/></Response>');
  }
});

// 2. Gather Webhook: Twilio hits this when the recipient speaks
router.post('/twilio/gather', async (req, res, next) => {
  try {
    const taskId = req.query.taskId || req.body.taskId;
    const conversationId = req.query.conversationId || req.body.conversationId;
    const userSpeech = (req.body.SpeechResult || '').trim();

    if (!taskId) {
      return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }

    const task = await repository.getTask(taskId);
    if (!task) {
      return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }

    const baseUrl = (env.APP_BASE_URL || '').replace(/\/$/, '');
    const gatherUrl = `${baseUrl}/webhooks/twilio/gather?taskId=${encodeURIComponent(task.id)}&conversationId=${encodeURIComponent(conversationId || '')}`;
    const lang = task.language === 'hi' ? 'hi-IN' : 'en-IN';

    // If no speech detected
    if (!userSpeech) {
      const retryMsg = task.language === 'hi'
        ? 'माफ़ कीजिए, मुझे आपकी आवाज़ नहीं आई। कृपया दोबारा बोलिए।'
        : 'I could not hear you clearly. Could you please repeat that?';
      const noInputXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="${lang}">${escapeXml(retryMsg)}</Say>
  <Gather input="speech" action="${escapeXml(gatherUrl)}" method="POST" speechTimeout="auto" language="${lang}">
  </Gather>
  <Say voice="Polly.Aditi" language="${lang}">${task.language === 'hi' ? 'धन्यवाद, अलविदा।' : 'Thank you, goodbye.'}</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(noInputXml);
    }

    // Save recipient's words
    if (conversationId) {
      await repository.saveTranscript(conversationId, 'recipient', userSpeech);
    }

    // Fetch conversation history
    const rawTurns = conversationId ? await repository.listTranscripts(conversationId) : [];
    const formattedTranscript = rawTurns.map(t => ({
      speaker: t.speaker,
      message: t.message
    }));

    // Call Gemini
    const geminiResult = await generateConversationReply({
      language: task.language,
      recipientName: task.contact_name,
      objective: task.instruction,
      keyPoints: [task.instruction],
      transcript: formattedTranscript,
      recipientMessage: userSpeech
    });

    const reply = geminiResult.reply;

    if (conversationId) {
      await repository.saveTranscript(conversationId, 'assistant', reply);
    }

    // Check if conversation should conclude
    const isFarewell = /(goodbye|bye|have a (nice|great) day|take care|अलविदा|शुभ दिन|thank you for your time)/i.test(reply) ||
      /(bye|goodbye|hang up|not interested|wrong number|अलविदा|बंद करो)/i.test(userSpeech);

    if (isFarewell) {
      await repository.updateTask(task.id, { status: 'completed' });
      const attempts = await repository.listAttempts(task.id);
      const latestAttempt = attempts[attempts.length - 1];
      if (latestAttempt) {
        await repository.updateAttempt(latestAttempt.id, {
          status: 'completed',
          ended_at: new Date().toISOString()
        });
      }
    }

    const xml = buildTwilioGatherTwiML({
      reply,
      gatherUrl,
      language: task.language,
      endCall: isFarewell
    });

    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('Twilio gather webhook error:', err);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Goodbye.</Say><Hangup/></Response>');
  }
});

// 3. Status Webhook: Twilio hits this on call status changes
router.post('/twilio/status', async (req, res, next) => {
  try {
    const sid = req.body.CallSid;
    const status = String(req.body.CallStatus || '').toLowerCase();
    const taskId = req.query.taskId;

    if (!sid) return res.status(400).json({ error: 'Missing CallSid.' });

    const attempt = await repository.getAttemptByProviderSid(sid);
    if (attempt) {
      const mapped = status.replace('-', '_');
      await repository.updateAttempt(attempt.id, {
        status: mapped,
        ended_at: ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status) ? new Date().toISOString() : undefined
      });

      if (status === 'completed') {
        await repository.updateTask(attempt.task_id, { status: 'completed' });
      } else if (['busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        await repository.updateTask(attempt.task_id, { status: 'no_answer' });
      }
    } else if (taskId) {
      if (status === 'completed') {
        await repository.updateTask(taskId, { status: 'completed' });
      } else if (['busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        await repository.updateTask(taskId, { status: 'no_answer' });
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
