import { Router } from 'express';
import { EventController } from '../controllers/EventController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const eventController = new EventController();

router.get('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, eventController.list);
router.post('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, eventController.create);
router.post('/process-pending', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, eventController.processPending);

export default router;
