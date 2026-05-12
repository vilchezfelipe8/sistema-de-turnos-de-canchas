import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { AccountController } from '../controllers/AccountController';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();
const accountController = new AccountController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.create);
router.get('/:id', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.getById);
router.get('/:id/summary', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.summary);
router.get('/:id/balance', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.balance);
router.get('/:id/ledger', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.ledger);
router.post('/:id/items', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.addItem);
router.post('/:id/payments', paymentLimiter, authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.registerPayment);
router.post('/:id/close', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.close);
// P2-B: Anular venta de mostrador — restaura stock, sin pago o con pagos revertidos
router.post('/:id/void-pos', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), accountController.voidPos);

export default router;
