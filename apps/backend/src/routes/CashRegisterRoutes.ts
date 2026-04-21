import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { CashRegisterController } from '../controllers/CashRegisterController';

const router = Router();
const controller = new CashRegisterController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.create);

export default router;
