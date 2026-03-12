import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();
const paymentController = new PaymentController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.list);
router.get('/refunds', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.listRefunds);
router.get('/refunds/pending', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.listPendingRefunds);
router.post('/refunds/:refundId/approve', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.approveRefund);
router.post('/refunds/:refundId/execute', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.executeRefund);
router.post('/refunds/:refundId/fail', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.failRefund);
router.post('/refunds/:refundId/retry', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.retryRefund);
router.post('/refunds/:refundId/cancel', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.cancelRefund);
router.post('/', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.create);
router.post('/:id/refunds/request', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.requestRefund);
router.post('/:id/refunds', paymentLimiter, authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), paymentController.refund);

export default router;
