import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();
const paymentController = new PaymentController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), paymentController.list);
router.get('/refunds', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), paymentController.listRefunds);
router.get('/refunds/pending', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), paymentController.listPendingRefunds);
router.post('/refunds/:refundId/approve', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), paymentController.approveRefund);
router.post('/refunds/:refundId/execute', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), paymentController.executeRefund);
router.post('/refunds/:refundId/fail', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), paymentController.failRefund);
router.post('/refunds/:refundId/retry', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), paymentController.retryRefund);
router.post('/refunds/:refundId/cancel', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), paymentController.cancelRefund);
router.post('/', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), paymentController.create);
router.post('/:id/refunds/request', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), paymentController.requestRefund);

export default router;
