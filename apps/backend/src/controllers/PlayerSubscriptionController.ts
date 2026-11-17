import { Request, Response } from 'express';
import { sendAppError, validationError } from '../errors';
import { playerSubscriptionService } from '../services/subscriptions/PlayerSubscriptionService';

/** Planes del jugador en la app ("Mis planes" del perfil). */
export class PlayerSubscriptionController {
  mine = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0) || null;
      if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
      return res.json(await playerSubscriptionService.listMine(userId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar tus planes.');
    }
  };

  private requireUser(req: Request) {
    const userId = Number((req as any)?.user?.userId || 0) || null;
    if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
    return userId;
  }

  /** Link de Mercado Pago para pagar la cuota pendiente. */
  checkout = async (req: Request, res: Response) => {
    try {
      return res.json(await playerSubscriptionService.createInstallmentCheckout(this.requireUser(req), String(req.params.id)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo armar el pago de la cuota.');
    }
  };

  pause = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const isKey = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (!isKey(body.endDate) || (body.startDate && !isKey(body.startDate))) {
        throw validationError('Revisá las fechas.', { endDate: 'Elegí hasta cuándo.' });
      }
      return res.json(
        await playerSubscriptionService.pause(this.requireUser(req), String(req.params.id), {
          startDate: body.startDate || null,
          endDate: body.endDate,
        })
      );
    } catch (error) {
      return sendAppError(res, error, 'No se pudo pausar el plan.');
    }
  };

  endPause = async (req: Request, res: Response) => {
    try {
      return res.json(
        await playerSubscriptionService.endPause(this.requireUser(req), String(req.params.id), String(req.params.pauseId))
      );
    } catch (error) {
      return sendAppError(res, error, 'No se pudo terminar la pausa.');
    }
  };
}
