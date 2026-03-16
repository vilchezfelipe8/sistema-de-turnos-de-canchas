import { Router } from 'express';
import { PaymentGatewayController } from '../controllers/PaymentGatewayController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { paymentLimiter } from '../middleware/rateLimit';

const router = Router();
const paymentGatewayController = new PaymentGatewayController();

router.get(
  '/oauth/mercadopago/start',
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.startMercadoPagoOAuth
);

router.get(
  '/oauth/mercadopago/callback',
  paymentGatewayController.mercadoPagoOAuthCallback
);

router.get(
  '/provider-accounts',
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.listProviderAccounts
);

router.post(
  '/provider-accounts',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.createProviderAccount
);

router.patch(
  '/provider-accounts/:providerAccountId/status',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.updateProviderAccountStatus
);

router.post(
  '/transactions',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.upsertGatewayTransaction
);

router.get(
  '/transactions',
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.listGatewayTransactions
);

router.get(
  '/fiscal-documents',
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.listFiscalDocuments
);

router.post(
  '/fiscal/payments/:paymentId/issue',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.requestPaymentFiscalDocument
);

router.post(
  '/fiscal/refunds/:refundId/issue',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.requestRefundFiscalDocument
);

router.post(
  '/webhooks/mercadopago',
  paymentGatewayController.mercadopagoWebhook
);

router.post(
  '/reprocess/mercadopago/:externalId',
  paymentLimiter,
  authMiddleware,
  setAdminClubFromUser,
  requireRole('ADMIN'),
  paymentGatewayController.reprocessMercadoPagoTransaction
);

export default router;
