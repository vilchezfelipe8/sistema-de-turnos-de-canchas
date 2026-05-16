import { Request, Response } from 'express';
import { sendAuthError } from '../utils/authError';
import { badRequest, sendAppError, ErrorCodes, AppError } from '../errors';
import { ClubPaymentIntegrationService } from '../services/ClubPaymentIntegrationService';
import { OnlineCheckoutService } from '../services/OnlineCheckoutService';

export class PaymentIntegrationController {
  private readonly clubPaymentIntegrationService = new ClubPaymentIntegrationService();
  private readonly onlineCheckoutService = new OnlineCheckoutService();

  listClubIntegrations = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId || (req as any).club?.id || 0);
      if (!Number.isInteger(clubId) || clubId <= 0) {
        return sendAppError(res, badRequest('No pudimos determinar el club activo.', ErrorCodes.CLUB_NOT_FOUND));
      }

      const actorUserId = Number((req as any)?.user?.userId || 0);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para ver integraciones.');
      }

      const items = await this.clubPaymentIntegrationService.listIntegrations({ clubId, actorUserId });
      return res.json({ items });
    } catch (error) {
      return sendAppError(res, error, 'No pudimos cargar las integraciones del club.');
    }
  };

  startMercadoPagoConnect = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId || (req as any).club?.id || 0);
      if (!Number.isInteger(clubId) || clubId <= 0) {
        return sendAppError(res, badRequest('No pudimos determinar el club activo.', ErrorCodes.CLUB_NOT_FOUND));
      }

      const actorUserId = Number((req as any)?.user?.userId || 0);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para conectar Mercado Pago.');
      }

      const { authorizationUrl } = await this.clubPaymentIntegrationService.startMercadoPagoConnect({ clubId, actorUserId });
      return res.redirect(authorizationUrl);
    } catch (error) {
      return sendAppError(res, error, 'No pudimos iniciar la conexión con Mercado Pago.');
    }
  };

  disconnectMercadoPago = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId || (req as any).club?.id || 0);
      if (!Number.isInteger(clubId) || clubId <= 0) {
        return sendAppError(res, badRequest('No pudimos determinar el club activo.', ErrorCodes.CLUB_NOT_FOUND));
      }

      const actorUserId = Number((req as any)?.user?.userId || 0);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para desconectar Mercado Pago.');
      }

      const integration = await this.clubPaymentIntegrationService.disconnectMercadoPago({ clubId, actorUserId });
      return res.json({ integration });
    } catch (error) {
      return sendAppError(res, error, 'No pudimos desconectar Mercado Pago.');
    }
  };

  mercadoPagoCallback = async (req: Request, res: Response) => {
    try {
      const result = await this.clubPaymentIntegrationService.handleMercadoPagoCallback({
        code: String(req.query.code || '').trim() || null,
        state: String(req.query.state || '').trim() || null,
        providerError: String(req.query.error || '').trim() || null,
        providerErrorDescription: String(req.query.error_description || '').trim() || null
      });

      return res.redirect(result.redirectUrl);
    } catch (error) {
      const redirectUrl = error instanceof AppError ? String(error.meta?.redirectUrl || '').trim() : '';
      if (redirectUrl) {
        return res.redirect(redirectUrl);
      }
      return sendAppError(res, error, 'No pudimos validar la conexión con Mercado Pago.');
    }
  };

  mercadoPagoWebhook = async (req: Request, res: Response) => {
    try {
      const result = await this.onlineCheckoutService.processMercadoPagoWebhook({
        clubId: Number(req.query.clubId || 0),
        attemptId: String(req.query.attemptId || '').trim() || null,
        paymentId: String((req.query as any)?.['data.id'] || req.body?.data?.id || '').trim() || null,
        xSignature: req.header('x-signature'),
        xRequestId: req.header('x-request-id')
      });

      return res.status(200).json(result);
    } catch (error) {
      return sendAppError(res, error, 'No pudimos procesar el webhook de Mercado Pago.');
    }
  };
}
