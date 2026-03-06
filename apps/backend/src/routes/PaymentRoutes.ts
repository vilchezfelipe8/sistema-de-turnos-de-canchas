import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const paymentController = new PaymentController();

router.get('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, paymentController.list);
router.post('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, paymentController.create);
router.patch('/:id/status', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, paymentController.updateStatus);

export default router;
