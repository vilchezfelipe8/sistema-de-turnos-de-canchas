import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ErrorCodes, notFound, sendAppError, validationError, zodValidationAppError } from '../errors';
import { activityTurnService } from '../services/gym/ActivityTurnService';
import { activityAccessService } from '../services/gym/ActivityAccessService';
import { accessCheckInService } from '../services/gym/AccessCheckInService';
import { FINGERPRINT_FORMATS, fingerprintService } from '../services/gym/FingerprintService';
import { sanitizeString } from '../utils/sanitize';

const time = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scheduleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slotMinutes: z.number().int().min(15).max(240),
  capacity: z.number().int().min(1).max(500),
  windows: z
    .array(z.object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), open: time, close: time }))
    .min(1)
    .max(14),
  bookAheadDays: z.number().int().min(0).max(30),
  requiresTurn: z.boolean(),
  earlyEntryMinutes: z.number().int().min(0).max(60),
  isActive: z.boolean(),
});

const bookSchema = z.object({ startsAt: z.string().min(10) });
const checkInSchema = z.object({ activityTypeId: z.number().int().positive(), identifier: z.string().trim().min(1).max(120) });
const adminBookSchema = z.object({ startsAt: z.string().min(10), clientId: z.string().trim().min(1) });

const enrollSchema = z.object({
  clientId: z.string().trim().min(1),
  template: z.string().trim().min(1).max(8192),
  format: z.enum(FINGERPRINT_FORMATS),
  finger: z.number().int().min(0).max(9).nullable().default(null),
  consent: z.boolean(),
});

type ClubRequest = Request & { clubId?: number };

const userIdOf = (req: Request) => Number((req as any)?.user?.userId || 0) || null;

const clubIdOf = (req: ClubRequest) => {
  const clubId = Number(req.clubId);
  if (!Number.isFinite(clubId) || clubId <= 0) throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
  return clubId;
};

const activityIdOf = (raw: unknown) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw validationError('Revisá los campos marcados.', { activityTypeId: 'Actividad inválida.' });
  return id;
};

const resolveSlugClubId = async (slug: unknown) => {
  const club = await prisma.club.findUnique({ where: { slug: String(slug || '').trim() }, select: { id: true } });
  if (!club) throw notFound('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
  return club.id;
};

/** Turnero (ej. Musculación): jugador reserva su franja; el club configura horarios y cupo. */
export class ActivityTurnController {
  // ── Jugador ────────────────────────────────────────────────────────────

  listPublic = async (req: Request, res: Response) => {
    try {
      const clubId = await resolveSlugClubId(req.params.slug);
      const userId = userIdOf(req);
      const [activities, mine] = await Promise.all([
        activityTurnService.listPublic(clubId),
        userId ? activityTurnService.listMine(clubId, userId) : Promise.resolve([]),
      ]);
      return res.json({ activities, mine });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los turnos.');
    }
  };

  daySlots = async (req: Request, res: Response) => {
    try {
      const clubId = await resolveSlugClubId(req.params.slug);
      const parsed = dateKey.safeParse(req.query.date);
      if (!parsed.success) throw validationError('Revisá los campos marcados.', { date: 'Fecha inválida.' });
      return res.json(await activityTurnService.daySlots(clubId, activityIdOf(req.params.activityTypeId), parsed.data, userIdOf(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los turnos.');
    }
  };

  book = async (req: Request, res: Response) => {
    try {
      const userId = userIdOf(req);
      if (!userId) throw validationError('Iniciá sesión para reservar.', { user: 'Usuario inválido.' });
      const clubId = await resolveSlugClubId(req.params.slug);
      const parsed = bookSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const turn = await activityTurnService.bookForPlayer(clubId, activityIdOf(req.params.activityTypeId), parsed.data.startsAt, userId);
      return res.status(201).json(turn);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo reservar el turno.');
    }
  };

  cancelMine = async (req: Request, res: Response) => {
    try {
      const userId = userIdOf(req);
      if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
      const clubId = await resolveSlugClubId(req.params.slug);
      return res.json(await activityTurnService.cancel(clubId, String(req.params.turnId), { userId }));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cancelar el turno.');
    }
  };

  // ── Admin ──────────────────────────────────────────────────────────────

  listSchedules = async (req: ClubRequest, res: Response) => {
    try {
      return res.json(await activityTurnService.listSchedules(clubIdOf(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los turneros.');
    }
  };

  createSchedule = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const created = await activityTurnService.createSchedule(clubIdOf(req), { ...parsed.data, name: sanitizeString(parsed.data.name, 60) });
      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear el turnero.');
    }
  };

  updateSchedule = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      return res.json(
        await activityTurnService.updateSchedule(clubIdOf(req), activityIdOf(req.params.activityTypeId), {
          ...parsed.data,
          name: sanitizeString(parsed.data.name, 60),
        })
      );
    } catch (error) {
      return sendAppError(res, error, 'No se pudo guardar el turnero.');
    }
  };

  adminDay = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = dateKey.safeParse(req.query.date);
      if (!parsed.success) throw validationError('Revisá los campos marcados.', { date: 'Fecha inválida.' });
      return res.json(await activityTurnService.adminDay(clubIdOf(req), activityIdOf(req.params.activityTypeId), parsed.data));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los turnos.');
    }
  };

  adminBook = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = adminBookSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const clubId = clubIdOf(req);
      const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, clubId }, select: { id: true, userId: true } });
      if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);
      const turn = await activityTurnService.book(clubId, activityIdOf(req.params.activityTypeId), parsed.data.startsAt, {
        clientId: client.id,
        userId: client.userId,
        actorUserId: userIdOf(req),
      });
      return res.status(201).json(turn);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo reservar el turno.');
    }
  };

  adminCancel = async (req: ClubRequest, res: Response) => {
    try {
      return res.json(await activityTurnService.cancel(clubIdOf(req), String(req.params.turnId), { admin: true }));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cancelar el turno.');
    }
  };

  checkIn = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = checkInSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      return res.json(await accessCheckInService.checkIn(clubIdOf(req), parsed.data.activityTypeId, parsed.data.identifier, userIdOf(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo validar el ingreso.');
    }
  };

  accessLogs = async (req: ClubRequest, res: Response) => {
    try {
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : null;
      return res.json(await accessCheckInService.listDay(clubIdOf(req), date));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los ingresos.');
    }
  };

  myAccessCode = async (req: Request, res: Response) => {
    try {
      const userId = userIdOf(req);
      if (!userId) throw validationError('Iniciá sesión.', { user: 'Usuario inválido.' });
      const clubId = await resolveSlugClubId(req.params.slug);
      const code = await accessCheckInService.playerCode(clubId, userId);
      if (!code) throw notFound('Todavía no sos cliente de este club.', ErrorCodes.CLIENT_NOT_FOUND);
      return res.json(code);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo armar tu código.');
    }
  };

  fingerprintSync = async (req: ClubRequest, res: Response) => {
    try {
      return res.json(await fingerprintService.listForSync(clubIdOf(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las huellas.');
    }
  };

  fingerprintLookup = async (req: ClubRequest, res: Response) => {
    try {
      return res.json(await fingerprintService.lookup(clubIdOf(req), String(req.query.dni || '')));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo buscar el cliente.');
    }
  };

  fingerprintEnroll = async (req: ClubRequest, res: Response) => {
    try {
      const parsed = enrollSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      return res.status(201).json(await fingerprintService.enroll(clubIdOf(req), parsed.data, userIdOf(req)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo guardar la huella.');
    }
  };

  fingerprintRemove = async (req: ClubRequest, res: Response) => {
    try {
      return res.json(await fingerprintService.remove(clubIdOf(req), String(req.params.id)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo borrar la huella.');
    }
  };

  accessCheck = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = clubIdOf(req);
      const clientId = String(req.query.clientId || '').trim();
      if (!clientId) throw validationError('Revisá los campos marcados.', { clientId: 'Cliente inválido.' });
      return res.json(await activityAccessService.check(clubId, clientId, activityIdOf(req.query.activityTypeId)));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo validar el acceso.');
    }
  };
}
