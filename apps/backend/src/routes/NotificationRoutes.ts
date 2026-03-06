import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const notificationController = new NotificationController();

router.get('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, notificationController.list);
router.patch('/:id/read', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, notificationController.markRead);
router.patch('/read-all', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, notificationController.markAllRead);

export default router;
