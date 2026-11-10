import { Request, Response } from 'express';
import { ClubMessagingStatusService } from '../services/ClubMessagingStatusService';
import { sendAppError, badRequest, ErrorCodes } from '../errors';

export class ClubMessagingController {
  private readonly service = new ClubMessagingStatusService();

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
