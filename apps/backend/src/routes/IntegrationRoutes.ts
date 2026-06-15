import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { PaymentIntegrationController } from '../controllers/PaymentIntegrationController';

const router = Router();
const controller = new PaymentIntegrationController();

router.get('/integrations/mercadopago/callback', (req, res) => controller.mercadoPagoCallback(req, res));

router.get('/clubs/:slug/admin/integrations', authMiddleware, verifyClubAccess, requireTenantRole('ADMIN'), (req, res) =>
  controller.listClubIntegrations(req, res)
);
router.get('/clubs/:slug/admin/integrations/mercadopago/connect', authMiddleware, verifyClubAccess, requireTenantRole('ADMIN'), (req, res) =>
  controller.startMercadoPagoConnect(req, res)
);
router.post('/clubs/:slug/admin/integrations/mercadopago/disconnect', authMiddleware, verifyClubAccess, requireTenantRole('ADMIN'), (req, res) =>
  controller.disconnectMercadoPago(req, res)
);

export default router;
