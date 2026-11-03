import { Router } from 'express';
import { createCallTask, listCallTasks, cancelCallTask, completeCallTask } from '../controllers/callController.js';
const router = Router();
router.get('/', listCallTasks);
router.post('/', createCallTask);
router.post('/:id/cancel', cancelCallTask);
router.post('/:id/complete', completeCallTask);
export default router;
