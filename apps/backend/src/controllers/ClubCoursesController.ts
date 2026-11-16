import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { ErrorCodes, notFound, sendAppError, validationError } from '../errors';
import { ClassSeriesAdminService } from '../services/academy/ClassSeriesAdminService';

/** Cursos del club en la app del jugador: ver, anotarse y bajarse. */
export class ClubCoursesController {
  private readonly service = new ClassSeriesAdminService();

  private async resolveClubId(slug: unknown) {
    const club = await prisma.club.findUnique({ where: { slug: String(slug || '').trim() }, select: { id: true } });
    if (!club) throw notFound('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
    return club.id;
  }

  private userId(req: Request) {
    return Number((req as any)?.user?.userId || 0) || null;
  }

  list = async (req: Request, res: Response) => {
    try {
      const clubId = await this.resolveClubId(req.params.slug);
      return res.json(await this.service.listPublic(clubId, this.userId(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los cursos.');
    }
  };

  join = async (req: Request, res: Response) => {
    try {
      const userId = this.userId(req);
      if (!userId) throw validationError('Iniciá sesión para anotarte.', { user: 'Usuario inválido.' });
      const clubId = await this.resolveClubId(req.params.slug);
      return res.status(201).json(await this.service.joinFromApp(clubId, String(req.params.id), userId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo anotarte al curso.');
    }
  };

  leave = async (req: Request, res: Response) => {
    try {
      const userId = this.userId(req);
      if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
      const clubId = await this.resolveClubId(req.params.slug);
      return res.json(await this.service.leaveFromApp(clubId, String(req.params.id), userId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo bajarte del curso.');
    }
  };
}
