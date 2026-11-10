import { Request, Response } from 'express';
import { ClubMessagingStatusService } from '../services/ClubMessagingStatusService';
import { sendAppError, badRequest, ErrorCodes } from '../errors';

export class ClubMessagingController {
  private readonly service = new ClubMessagingStatusService();

  history = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as Request & { clubId?: number }).clubId);
      if (!Number.isFinite(clubId) || clubId <= 0) throw badRequest('Club inválido.', ErrorCodes.INVALID_INPUT);
      const onlyFailed = String(req.query.filter || '').toLowerCase() === 'failed';
      const limit = Number(req.query.limit) || 30;
      const clientId = String(req.query.clientId || '').trim() || undefined;
      return res.json({ items: await this.service.getHistory(clubId, { onlyFailed, limit, clientId }) });
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el historial de avisos.');
    }
  };

  status = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as Request & { clubId?: number }).clubId);
      if (!Number.isFinite(clubId) || clubId <= 0) throw badRequest('Club inválido.', ErrorCodes.INVALID_INPUT);
      return res.json(await this.service.getStatus(clubId));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el estado de los avisos.');
    }
  };
}
