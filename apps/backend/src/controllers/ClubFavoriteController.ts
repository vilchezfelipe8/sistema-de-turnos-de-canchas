import { Request, Response } from 'express';
import { ClubFavoriteService } from '../services/ClubFavoriteService';
import { sendAuthError } from '../utils/authError';

export class ClubFavoriteController {
  constructor(private readonly favoriteService: ClubFavoriteService) {}

  listMyFavorites = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0);
      if (!Number.isFinite(userId) || userId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'Usuario no autenticado');
      }

      const favorites = await this.favoriteService.listFavorites(userId);
      return res.json({ favorites });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'No se pudieron obtener favoritos' });
    }
  };

  markFavorite = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0);
      const clubId = Number(req.params.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'Usuario no autenticado');
      }
      if (!Number.isFinite(clubId) || clubId <= 0) {
        return res.status(400).json({ error: 'Club inválido' });
      }

      const result = await this.favoriteService.markFavorite(userId, clubId);
      return res.status(201).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'No se pudo marcar favorito' });
    }
  };

  unmarkFavorite = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any)?.user?.userId || 0);
      const clubId = Number(req.params.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'Usuario no autenticado');
      }
      if (!Number.isFinite(clubId) || clubId <= 0) {
        return res.status(400).json({ error: 'Club inválido' });
      }

      const result = await this.favoriteService.removeFavorite(userId, clubId);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'No se pudo quitar favorito' });
    }
  };
}
