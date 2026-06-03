import { Request, Response } from 'express';
import { WhatsappWebhookProcessor } from '../services/WhatsappWebhookProcessor';

export class WhatsappWebhookController {
  constructor(
    private readonly processor = new WhatsappWebhookProcessor()
  ) {}

  verifyMetaWebhook = async (req: Request, res: Response) => {
    const result = this.processor.verifyWebhook({
      mode: String(req.query['hub.mode'] || '').trim() || null,
      verifyToken: String(req.query['hub.verify_token'] || '').trim() || null,
      challenge: String(req.query['hub.challenge'] || '').trim() || null,
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({
        error: result.errorMessage,
        code: result.errorCode,
      });
    }

    return res.status(200).type('text/plain').send(result.challenge);
  };

  metaWebhook = async (req: Request, res: Response) => {
    const result = await this.processor.processWebhook(req.body);
    return res.status(200).json(result);
  };
}
