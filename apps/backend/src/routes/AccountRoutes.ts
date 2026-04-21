import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { AccountController } from '../controllers/AccountController';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();
const accountController = new AccountController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.create);
router.get('/:id', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.getById);
router.get('/:id/summary', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.summary);
router.get('/:id/balance', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.balance);
router.get('/:id/ledger', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.ledger);
router.post('/:id/items', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.addItem);
router.post('/:id/payments', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.registerPayment);
router.post('/:id/close', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), accountController.close);

export default router;
