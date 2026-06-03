import { Router } from 'express';
import { PaymentIntegrationController } from '../controllers/PaymentIntegrationController';
import { WhatsappWebhookController } from '../controllers/WhatsappWebhookController';

const router = Router();
const controller = new PaymentIntegrationController();
const whatsappWebhookController = new WhatsappWebhookController();

router.post('/webhooks/mercadopago', (req, res) => controller.mercadoPagoWebhook(req, res));
router.get('/webhooks/meta/whatsapp', (req, res) => whatsappWebhookController.verifyMetaWebhook(req, res));
router.post('/webhooks/meta/whatsapp', (req, res) => whatsappWebhookController.metaWebhook(req, res));

export default router;
