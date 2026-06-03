import { Router } from 'express';
import { WhatsappOperationsController } from '../controllers/WhatsappOperationsController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireGlobalRole } from '../middleware/RoleMiddleware';

const router = Router();
const controller = new WhatsappOperationsController();

router.get(
  '/deliveries',
  authMiddleware,
  requireGlobalRole('ADMIN'),
  controller.listDeliveries
);
router.get(
  '/deliveries/:id',
  authMiddleware,
  requireGlobalRole('ADMIN'),
  controller.getDeliveryDetail
);
router.get(
  '/webhook-events',
  authMiddleware,
  requireGlobalRole('ADMIN'),
  controller.listWebhookEvents
);
router.get(
  '/preflight',
  authMiddleware,
  requireGlobalRole('ADMIN'),
  controller.getPreflight
);
router.get(
  '/summary',
  authMiddleware,
  requireGlobalRole('ADMIN'),
  controller.getSummary
);

export default router;
