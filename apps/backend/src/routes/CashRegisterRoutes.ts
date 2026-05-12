import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { CashRegisterController } from '../controllers/CashRegisterController';

const router = Router();
const controller = new CashRegisterController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), controller.create);

export default router;
