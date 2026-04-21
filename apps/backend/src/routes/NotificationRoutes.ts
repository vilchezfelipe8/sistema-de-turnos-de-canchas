import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const notificationController = new NotificationController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), notificationController.list);
router.patch('/:id/read', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), notificationController.markRead);
router.patch('/read-all', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), notificationController.markAllRead);

export default router;
