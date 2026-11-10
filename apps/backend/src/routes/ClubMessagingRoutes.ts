import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { ClubMessagingController } from '../controllers/ClubMessagingController';

// Avisos por WhatsApp vistos por el club (solo lectura).
const router = Router();
const controller = new ClubMessagingController();

router.get('/status', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.status);

export default router;
