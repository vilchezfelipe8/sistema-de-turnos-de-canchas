import { Request, Response } from 'express';
import { z } from 'zod';
import { CashShiftService } from '../services/CashShiftService';
import { mapCashShiftDto } from '../dto/financialDto';
import { sendAuthError } from '../utils/authError';
import { sendAppError, badRequest, ErrorCodes } from '../errors';

export class CashShiftController {
  private readonly service = new CashShiftService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as Request & { clubId?: number }).clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) throw badRequest('Club inválido.', ErrorCodes.INVALID_INPUT);
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
    return Number.isFinite(userId) && userId > 0 ? userId : undefined;
  }

  open = async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        cashRegisterId: z.string().trim().min(1),
        openingAmount: z.preprocess((v) => Number(v), z.number().min(0))
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const openedByUserId = Number((req as any)?.user?.userId || 0);
      if (!openedByUserId) return sendAuthError(res, 401, 'AUTH_MISSING', 'Usuario inválido');

      const shift = await this.service.open(clubId, openedByUserId, parsed.data);
      return res.status(201).json(mapCashShiftDto(shift));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo abrir el turno de caja.');
    }
  };

  close = async (req: Request, res: Response) => {
    try {
      const params = z.object({ id: z.string().trim().min(1) }).safeParse(req.params);
      const body = z.object({ countedCash: z.preprocess((v) => Number(v), z.number().min(0)) }).safeParse(req.body);
      if (!params.success) return res.status(400).json({ error: params.error.format() });
      if (!body.success) return res.status(400).json({ error: body.error.format() });

      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const shift = await this.service.close(clubId, params.data.id, body.data.countedCash, actorUserId);
      return res.json(mapCashShiftDto(shift));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo cerrar el turno de caja.');
    }
  };

  closeCurrent = async (req: Request, res: Response) => {
    try {
      const body = z.object({ countedCash: z.preprocess((v) => Number(v), z.number().min(0)) }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: body.error.format() });

      const clubId = this.resolveClubId(req);
      const current = await this.service.current(clubId);
      if (!current) return res.status(404).json({ error: 'No hay turno abierto' });

      const actorUserId = this.resolveActorUserId(req);
      const shift = await this.service.close(clubId, current.id, body.data.countedCash, actorUserId);
      return res.json(mapCashShiftDto(shift));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo cerrar el turno de caja.');
    }
  };

  current = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const shift = await this.service.current(clubId);
      return res.json(shift ? mapCashShiftDto(shift) : null);
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el turno actual.');
    }
  };

  report = async (req: Request, res: Response) => {
    try {
      const params = z.object({ id: z.string().trim().min(1) }).safeParse(req.params);
      if (!params.success) return res.status(400).json({ error: params.error.format() });

      const clubId = this.resolveClubId(req);
      const report = await this.service.report(clubId, params.data.id);
      return res.json({
        shift: mapCashShiftDto(report.shift),
        totals: report.totals,
        expectedCash: report.expectedCash,
        countedCash: report.countedCash,
        difference: report.difference
      });
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el reporte del turno.');
    }
  };
}
