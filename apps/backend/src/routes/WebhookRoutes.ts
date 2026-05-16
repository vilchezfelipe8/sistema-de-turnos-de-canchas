import { Router } from 'express';
import { PaymentIntegrationController } from '../controllers/PaymentIntegrationController';

const router = Router();
const controller = new PaymentIntegrationController();

router.post('/webhooks/mercadopago', (req, res) => controller.mercadoPagoWebhook(req, res));

export default router;
