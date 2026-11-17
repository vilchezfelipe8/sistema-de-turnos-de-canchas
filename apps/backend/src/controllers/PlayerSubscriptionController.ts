import { Request, Response } from 'express';
import { sendAppError, validationError } from '../errors';
import { subscriptionService } from '../services/subscriptions/SubscriptionService';

/** Planes del jugador en la app ("Mis planes" del perfil). */
export class PlayerSubscriptionController {
  mine = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0) || null;
      if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
      return res.json(await subscriptionService.listMine(userId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar tus planes.');
    }
  };
}
