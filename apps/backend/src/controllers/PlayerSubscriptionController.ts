import { Request, Response } from 'express';
import { sendAppError, validationError } from '../errors';
import { playerSubscriptionService } from '../services/subscriptions/PlayerSubscriptionService';

const returnToOf = (body: unknown): 'club' | 'perfil' | undefined => {
  const value = body && typeof body === 'object' ? (body as { returnTo?: unknown }).returnTo : undefined;
  return value === 'club' || value === 'perfil' ? value : undefined;
};

/** Planes del jugador en la app ("Mis planes" del perfil y pestaña Gimnasio del club). */
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
      return res.json(
        await playerSubscriptionService.createInstallmentCheckout(this.requireUser(req), String(req.params.id), {
          returnTo: returnToOf(req.body),
        })
      );
    } catch (error) {
      return sendAppError(res, error, 'No se pudo armar el pago de la cuota.');
    }
  };

  /** Planes del club (pestaña Gimnasio de la app). Público; con sesión marca los que ya tiene. */
  listClubPlans = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0) || null;
      return res.json(await playerSubscriptionService.listClubPlans(String(req.params.slug), userId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los planes.');
    }
  };

  /** Comprar un plan desde la app: devuelve el link de Mercado Pago. */
  purchase = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const optionId = typeof body.optionId === 'string' ? body.optionId.trim() : '';
      if (!optionId) throw validationError('Elegí una forma de pago.', { optionId: 'Elegí una forma de pago.' });
      return res.status(201).json(
        await playerSubscriptionService.purchase(this.requireUser(req), String(req.params.slug), {
          planId: String(req.params.planId),
          optionId,
          returnTo: returnToOf(body),
        })
      );
    } catch (error) {
      return sendAppError(res, error, 'No se pudo comprar el plan.');
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
