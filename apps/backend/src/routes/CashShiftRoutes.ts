import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { CashShiftController } from '../controllers/CashShiftController';

const router = Router();
const controller = new CashShiftController();

router.post('/open', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.open);
router.post('/close', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.closeCurrent);
router.post('/:id/close', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.close);
router.get('/current', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.current);
router.get('/:id/report', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), controller.report);

export default router;
