import { Router } from 'express';
import { WhatsappOperationsController } from '../controllers/WhatsappOperationsController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requirePiqueTeam } from '../middleware/RoleMiddleware';

const router = Router();
const controller = new WhatsappOperationsController();

router.get(
  '/deliveries',
  authMiddleware,
  requirePiqueTeam,
  controller.listDeliveries
);
router.get(
  '/deliveries/:id',
  authMiddleware,
  requirePiqueTeam,
  controller.getDeliveryDetail
);
router.post(
  '/deliveries/:id/resend',
  authMiddleware,
  requirePiqueTeam,
  controller.resendDelivery
);
router.get(
  '/webhook-events',
  authMiddleware,
  requirePiqueTeam,
  controller.listWebhookEvents
);
router.get(
  '/preflight',
  authMiddleware,
  requirePiqueTeam,
  controller.getPreflight
);
router.get(
  '/summary',
  authMiddleware,
  requirePiqueTeam,
  controller.getSummary
);

export default router;
