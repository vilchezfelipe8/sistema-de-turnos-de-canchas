import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const notificationController = new NotificationController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), notificationController.list);
router.patch('/:id/read', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), notificationController.markRead);
router.patch('/read-all', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), notificationController.markAllRead);

export default router;
