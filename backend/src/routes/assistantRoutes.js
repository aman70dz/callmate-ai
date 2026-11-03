import { Router } from 'express';
import { prepareAssistantCall, assistantReply } from '../controllers/assistantController.js';
const router = Router();
router.post('/prepare', prepareAssistantCall);
router.post('/reply', assistantReply);
export default router;
