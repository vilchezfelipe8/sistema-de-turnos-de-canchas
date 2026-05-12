import { Router } from 'express';
import { EventController } from '../controllers/EventController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const eventController = new EventController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), eventController.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), eventController.create);

export default router;
