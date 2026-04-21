import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { CashShiftController } from '../controllers/CashShiftController';

const router = Router();
const controller = new CashShiftController();

router.post('/open', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.open);
router.post('/close', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.closeCurrent);
router.post('/:id/close', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.close);
router.get('/current', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.current);
router.get('/:id/report', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.report);

export default router;
