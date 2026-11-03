import { Router } from 'express';
import { repository } from '../services/repository.js';
import { prepareCallPlan, generateConversationReply } from '../services/geminiAssistant.js';

const router = Router();

// GET /api/public/calls/:id - Get call task details for the recipient
router.get('/:id', async (req, res, next) => {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Call task not found or expired.' });

    res.json({
      id: task.id,
      contactName: task.contact_name,
      language: task.language,
      instruction: task.instruction,
      status: task.status
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/calls/:id/start - Recipient answered the call, get opening greeting
router.post('/:id/start', async (req, res, next) => {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Call task not found.' });

    // Update task to in-progress
    await repository.updateTask(task.id, { status: 'calling' });

    // Create attempt
    const attempts = await repository.listAttempts(task.id);
    const attempt = attempts.length > 0 ? attempts[attempts.length - 1] : await repository.createAttempt(task.id, 1);

    // Create conversation
    let conversation = await repository.getLatestConversation(task.id);
    if (!conversation) {
      conversation = await repository.createConversation({
        taskId: task.id,
        attemptId: attempt.id,
        language: task.language
      });
    }

    // Generate Gemini opening greeting
    let openingMessage = task.language === 'hi'
      ? `नमस्ते ${task.contact_name}, मैं कॉलमेट एआई बात कर रहा हूँ।`
      : `Hello ${task.contact_name}, this is CallMate AI calling.`;

    try {
      const plan = await prepareCallPlan({
        contactName: task.contact_name,
        instruction: task.instruction,
        language: task.language
      });
      if (plan.opening_message || plan.openingStatement) {
        openingMessage = plan.opening_message || plan.openingStatement;
      }
    } catch (planErr) {
      console.warn('Fallback opening greeting used in public call:', planErr.message);
    }

    // Save assistant greeting in transcripts
    await repository.saveTranscript(conversation.id, 'assistant', openingMessage);

    res.json({
      conversationId: conversation.id,
      openingMessage,
      language: task.language,
      contactName: task.contact_name
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/calls/:id/reply - Process recipient speech and return Gemini AI response
router.post('/:id/reply', async (req, res, next) => {
  try {
    const task = await repository.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Call task not found.' });

    const { conversationId, userSpeech } = req.body;
    if (!userSpeech || !userSpeech.trim()) {
      return res.status(400).json({ error: 'userSpeech is required.' });
    }

    // Save recipient turn
    if (conversationId) {
      await repository.saveTranscript(conversationId, 'recipient', userSpeech.trim());
    }

    // Fetch conversation history
    const rawTurns = conversationId ? await repository.listTranscripts(conversationId) : [];
    const formattedTranscript = rawTurns.map(t => ({
      speaker: t.speaker,
      message: t.message
    }));

    // Generate Gemini reply
    const geminiResult = await generateConversationReply({
      language: task.language,
      recipientName: task.contact_name,
      objective: task.instruction,
      keyPoints: [task.instruction],
      transcript: formattedTranscript,
      recipientMessage: userSpeech.trim()
    });

    const reply = geminiResult.reply;

    // Save assistant reply
    if (conversationId) {
      await repository.saveTranscript(conversationId, 'assistant', reply);
    }

    // Check if call concluded
    const isFarewell = /(goodbye|bye|have a (nice|great) day|take care|अलविदा|शुभ दिन|thank you for your time)/i.test(reply) ||
      /(bye|goodbye|hang up|not interested|wrong number|अलविदा|बंद करो)/i.test(userSpeech);

    if (isFarewell) {
      await repository.updateTask(task.id, { status: 'completed' });
    }

    res.json({
      reply,
      endCall: isFarewell,
      language: task.language
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/calls/:id/end - End the call
router.post('/:id/end', async (req, res, next) => {
  try {
    const task = await repository.getTask(req.params.id);
    if (task) {
      await repository.updateTask(task.id, { status: 'completed' });
    }
    res.json({ success: true, message: 'Call ended.' });
  } catch (err) {
    next(err);
  }
});

export default router;

