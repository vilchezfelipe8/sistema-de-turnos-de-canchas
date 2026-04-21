import { Router } from 'express';
import { EventController } from '../controllers/EventController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const eventController = new EventController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), eventController.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), eventController.create);

export default router;
