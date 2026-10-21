import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, notFound, sendAppError, zodValidationAppError } from '../errors';
import { BookingReleaseService } from '../services/BookingReleaseService';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usá el formato HH:MM.');
const timesSchema = z.object({ memberOpensAt: timeSchema, publicOpensAt: timeSchema });

const policySchema = z.object({
  enabled: z.boolean(),
  weekdays: timesSchema,
  weekendMode: z.enum(['SAME', 'CUSTOM', 'NO_PRIORITY']),
  weekend: timesSchema,
  daysAhead: z.number().int().min(0).max(30),
  closesAt: timeSchema
});

export class BookingReleaseController {
  private readonly bookingReleaseService = new BookingReleaseService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as any).clubId);
    if (!Number.isInteger(clubId) || clubId <= 0) throw badRequest('Club inválido', ErrorCodes.INVALID_INPUT);
    return clubId;
  }

  private resolveUserId(req: Request) {
    const userId = Number((req as any).user?.userId || 0);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  // Público (sesión opcional): qué puede reservar quien mira ahora mismo.
  getPublicWindow = async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim();
      const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } });
      if (!club) throw notFound('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
      const evaluation = await this.bookingReleaseService.evaluate({ clubId: club.id, userId: this.resolveUserId(req) });
      return res.json(evaluation);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el horario de reservas');
    }
  };

  getPolicy = async (req: Request, res: Response) => {
    try {
      return res.json(await this.bookingReleaseService.getPolicy(this.resolveClubId(req)));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener la configuración de ventanas de reserva');
    }
  };

  updatePolicy = async (req: Request, res: Response) => {
    try {
      const parsed = policySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const policy = await this.bookingReleaseService.savePolicy(
        this.resolveClubId(req),
        parsed.data,
        this.resolveUserId(req)
      );
      return res.json(policy);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo guardar la configuración de ventanas de reserva');
    }
  };
}
