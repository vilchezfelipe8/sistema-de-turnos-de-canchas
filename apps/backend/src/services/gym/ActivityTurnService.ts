import { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { localDateKey } from '../MemberService';
import { addDaysKey, isDateKey } from '../../domain/subscriptionSchedule';
import { acquireTransactionAdvisoryLock } from '../../utils/advisoryLock';
import { activityAccessService, clubTimeZone, localTimeLabel, shortDateKey } from './ActivityAccessService';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type TurnWindow = { weekdays: number[]; open: string; close: string };

export type TurnScheduleInput = {
  name: string;
  slotMinutes: number;
  capacity: number;
  windows: TurnWindow[];
  bookAheadDays: number;
  requiresTurn: boolean;
  earlyEntryMinutes: number;
  isActive: boolean;
};

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const fromMinutes = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const weekdayOfKey = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const parseWindows = (raw: unknown): TurnWindow[] =>
  (Array.isArray(raw) ? raw : []).filter(
    (row: any) => row && Array.isArray(row.weekdays) && TIME_RE.test(String(row.open)) && TIME_RE.test(String(row.close))
  ) as TurnWindow[];

/** Lunes de la semana de una fecha (las semanas van de lunes a domingo). */
const mondayOfKey = (key: string) => addDaysKey(key, -((weekdayOfKey(key) + 6) % 7));

/**
 * Turnero de actividades sin cancha (ej. Musculación): franjas con cupo que el socio reserva
 * desde la app. Las franjas salen del horario configurado; solo se guardan las reservas.
 */
export class ActivityTurnService {
  // ── Configuración (admin) ─────────────────────────────────────────────

  private mapSchedule(row: any) {
    return {
      activityTypeId: row.activityTypeId,
      name: row.activityType?.name ?? '',
      slotMinutes: row.slotMinutes,
      capacity: row.capacity,
      windows: parseWindows(row.windows),
      bookAheadDays: row.bookAheadDays,
      requiresTurn: row.requiresTurn,
      earlyEntryMinutes: row.earlyEntryMinutes,
      isActive: row.isActive,
    };
  }

  async listSchedules(clubId: number, options: { onlyActive?: boolean } = {}) {
    const rows = await prisma.activityTurnSchedule.findMany({
      where: { clubId, ...(options.onlyActive ? { isActive: true } : {}) },
      include: { activityType: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.mapSchedule(row));
  }

  private validate(input: TurnScheduleInput) {
    const name = String(input.name || '').trim();
    if (name.length < 2) throw badRequest('Poné un nombre (ej. Musculación).');
    if (!Number.isInteger(input.slotMinutes) || input.slotMinutes < 15 || input.slotMinutes > 240) {
      throw badRequest('La duración del turno debe ser de 15 a 240 minutos.');
    }
    if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 500) {
      throw badRequest('El cupo debe ser de 1 a 500 personas.');
    }
    if (!Number.isInteger(input.bookAheadDays) || input.bookAheadDays < 0 || input.bookAheadDays > 30) {
      throw badRequest('Se puede reservar con hasta 30 días de anticipación.');
    }
    if (!Number.isInteger(input.earlyEntryMinutes) || input.earlyEntryMinutes < 0 || input.earlyEntryMinutes > 60) {
      throw badRequest('La entrada anticipada debe ser de 0 a 60 minutos.');
    }
    const windows = (input.windows || []).map((row) => ({
      weekdays: Array.from(new Set((row.weekdays || []).map(Number))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort(),
      open: String(row.open || ''),
      close: String(row.close || ''),
    }));
    if (windows.length === 0) throw badRequest('Agregá al menos un horario.');
    windows.forEach((row) => {
      if (row.weekdays.length === 0) throw badRequest('Elegí los días de cada horario.');
      if (!TIME_RE.test(row.open) || !TIME_RE.test(row.close) || toMinutes(row.open) >= 24 * 60) {
        throw badRequest('Revisá las horas: usá el formato 07:00.');
      }
      if (toMinutes(row.close) - toMinutes(row.open) < input.slotMinutes) {
        throw badRequest(`De ${row.open} a ${row.close} no entra un turno de ${input.slotMinutes} minutos.`);
      }
    });
    return { name, windows };
  }

  async createSchedule(clubId: number, input: TurnScheduleInput) {
    const { name, windows } = this.validate(input);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.activityType.findFirst({ where: { clubId, name: { equals: name, mode: 'insensitive' } } });
      if (existing) throw conflict(`Ya existe una actividad llamada ${existing.name}.`);
      const activity = await tx.activityType.create({
        data: { clubId, name, description: '', defaultDurationMinutes: input.slotMinutes },
      });
      const row = await tx.activityTurnSchedule.create({
        data: {
          clubId,
          activityTypeId: activity.id,
          slotMinutes: input.slotMinutes,
          capacity: input.capacity,
          windows: windows as unknown as Prisma.InputJsonValue,
          bookAheadDays: input.bookAheadDays,
          requiresTurn: input.requiresTurn,
          earlyEntryMinutes: input.earlyEntryMinutes,
          isActive: input.isActive,
        },
        include: { activityType: { select: { name: true } } },
      });
      return this.mapSchedule(row);
    });
  }

  async updateSchedule(clubId: number, activityTypeId: number, input: TurnScheduleInput) {
    const { name, windows } = this.validate(input);
    return prisma.$transaction(async (tx) => {
      const current = await tx.activityTurnSchedule.findFirst({ where: { clubId, activityTypeId } });
      if (!current) throw notFound('No se encontró el turnero.', ErrorCodes.ACTIVITY_NOT_FOUND);
      const clash = await tx.activityType.findFirst({
        where: { clubId, id: { not: activityTypeId }, name: { equals: name, mode: 'insensitive' } },
      });
      if (clash) throw conflict(`Ya existe una actividad llamada ${clash.name}.`);
      await tx.activityType.update({ where: { id: activityTypeId }, data: { name, defaultDurationMinutes: input.slotMinutes } });
      const row = await tx.activityTurnSchedule.update({
        where: { id: current.id },
        data: {
          slotMinutes: input.slotMinutes,
          capacity: input.capacity,
          windows: windows as unknown as Prisma.InputJsonValue,
          bookAheadDays: input.bookAheadDays,
          requiresTurn: input.requiresTurn,
          earlyEntryMinutes: input.earlyEntryMinutes,
          isActive: input.isActive,
        },
        include: { activityType: { select: { name: true } } },
      });
      // Los turnos ya reservados se mantienen aunque cambie el horario.
      return this.mapSchedule(row);
    });
  }

  // ── Franjas ───────────────────────────────────────────────────────────

  private async getActiveSchedule(clubId: number, activityTypeId: number, db: DbClient = prisma, includeInactive = false) {
    const row = await db.activityTurnSchedule.findFirst({
      where: { clubId, activityTypeId, ...(includeInactive ? {} : { isActive: true }) },
      include: { activityType: { select: { name: true } } },
    });
    if (!row) throw notFound('Esta actividad no tiene turnos.', ErrorCodes.ACTIVITY_NOT_FOUND);
    return row;
  }

  /** Franjas de un día (hora del club), sin repetidas. */
  private slotsOfDay(schedule: { slotMinutes: number; windows: unknown }, dayKey: string, timeZone: string) {
    const weekday = weekdayOfKey(dayKey);
    const starts = new Set<number>();
    parseWindows(schedule.windows)
      .filter((row) => row.weekdays.includes(weekday))
      .forEach((row) => {
        for (let m = toMinutes(row.open); m + schedule.slotMinutes <= toMinutes(row.close); m += schedule.slotMinutes) starts.add(m);
      });
    return Array.from(starts)
      .sort((a, b) => a - b)
      .map((minute) => {
        const startsAt = fromZonedTime(`${dayKey}T${fromMinutes(minute)}:00`, timeZone);
        return { startsAt, endsAt: new Date(startsAt.getTime() + schedule.slotMinutes * 60_000), time: fromMinutes(minute) };
      });
  }

  private async resolvePlayerClient(clubId: number, userId: number) {
    return prisma.client.findFirst({ where: { clubId, userId }, select: { id: true, name: true } });
  }

  /** Lo que ve el jugador: turneros del club y los días que puede reservar. */
  async listPublic(clubId: number) {
    const timeZone = await clubTimeZone(clubId);
    const today = localDateKey(new Date(), timeZone);
    const schedules = await this.listSchedules(clubId, { onlyActive: true });
    return schedules.map((row) => ({
      activityTypeId: row.activityTypeId,
      name: row.name,
      slotMinutes: row.slotMinutes,
      capacity: row.capacity,
      requiresTurn: row.requiresTurn,
      days: Array.from({ length: row.bookAheadDays + 1 }, (_, i) => addDaysKey(today, i)).filter(
        (key) => this.slotsOfDay(row, key, timeZone).length > 0
      ),
    }));
  }

  /** Franjas de un día con ocupación. Si hay jugador, marca las suyas y su situación con el plan. */
  async daySlots(clubId: number, activityTypeId: number, dayKey: string, userId: number | null, includeInactive = false) {
    if (!isDateKey(dayKey)) throw badRequest('Fecha inválida.', ErrorCodes.INVALID_DATE_TIME);
    const schedule = await this.getActiveSchedule(clubId, activityTypeId, prisma, includeInactive);
    const timeZone = await clubTimeZone(clubId);
    const now = new Date();
    const slots = this.slotsOfDay(schedule, dayKey, timeZone);
    const client = userId ? await this.resolvePlayerClient(clubId, userId) : null;

    const dayStart = fromZonedTime(`${dayKey}T00:00:00`, timeZone);
    const turns = await prisma.activityTurn.findMany({
      where: {
        activityTypeId,
        status: 'BOOKED',
        startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 26 * 3600_000) },
      },
      select: { id: true, startsAt: true, clientId: true },
    });

    let access: { allowed: boolean; code: string; message: string; timesPerWeek: number | null } | null = null;
    let week: { used: number; limit: number } | null = null;
    if (client) {
      const at = fromZonedTime(`${dayKey}T12:00:00`, timeZone);
      const result = await activityAccessService.check(clubId, client.id, activityTypeId, { at, ignoreTurn: true });
      access = { allowed: result.allowed, code: result.code, message: result.message, timesPerWeek: result.timesPerWeek };
      if (result.allowed && result.timesPerWeek) {
        week = { used: await this.countWeek(prisma, clubId, client.id, activityTypeId, dayKey, timeZone), limit: result.timesPerWeek };
      }
    } else if (userId) {
      access = { allowed: false, code: 'NO_PLAN', message: `No tenés un plan que incluya ${schedule.activityType.name}.`, timesPerWeek: null };
    }

    return {
      activityTypeId,
      name: schedule.activityType.name,
      date: dayKey,
      capacity: schedule.capacity,
      access,
      week,
      slots: slots.map((slot) => {
        const here = turns.filter((row) => row.startsAt.getTime() === slot.startsAt.getTime());
        const mine = client ? here.find((row) => row.clientId === client.id) : undefined;
        return {
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          time: slot.time,
          booked: here.length,
          available: Math.max(0, schedule.capacity - here.length),
          isPast: slot.endsAt.getTime() <= now.getTime(),
          myTurnId: mine?.id ?? null,
        };
      }),
    };
  }

  private async countWeek(db: DbClient, clubId: number, clientId: string, activityTypeId: number, dayKey: string, timeZone: string) {
    const monday = mondayOfKey(dayKey);
    return db.activityTurn.count({
      where: {
        clubId,
        clientId,
        activityTypeId,
        status: 'BOOKED',
        startsAt: {
          gte: fromZonedTime(`${monday}T00:00:00`, timeZone),
          lt: fromZonedTime(`${addDaysKey(monday, 7)}T00:00:00`, timeZone),
        },
      },
    });
  }

  // ── Reservar y cancelar ───────────────────────────────────────────────

  async book(
    clubId: number,
    activityTypeId: number,
    startsAtRaw: string,
    who: { clientId: string; userId: number | null; actorUserId: number | null }
  ) {
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) throw badRequest('Horario inválido.', ErrorCodes.INVALID_DATE_TIME);
    const schedule = await this.getActiveSchedule(clubId, activityTypeId);
    const timeZone = await clubTimeZone(clubId);
    const now = new Date();
    const dayKey = localDateKey(startsAt, timeZone);
    const slot = this.slotsOfDay(schedule, dayKey, timeZone).find((row) => row.startsAt.getTime() === startsAt.getTime());
    if (!slot) throw badRequest('Ese horario no es un turno de esta actividad.');
    if (slot.endsAt.getTime() <= now.getTime()) throw badRequest('Ese turno ya pasó.');
    const today = localDateKey(now, timeZone);
    if (dayKey > addDaysKey(today, schedule.bookAheadDays)) {
      throw badRequest(
        schedule.bookAheadDays === 0
          ? 'Solo se pueden reservar turnos para hoy.'
          : `Se puede reservar con hasta ${schedule.bookAheadDays} días de anticipación.`
      );
    }

    const access = await activityAccessService.check(clubId, who.clientId, activityTypeId, { at: slot.startsAt, ignoreTurn: true });
    if (!access.allowed) throw conflict(access.message);

    return prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `activity-turn:${activityTypeId}:${slot.startsAt.toISOString()}`);
      await acquireTransactionAdvisoryLock(tx, `activity-turn-client:${who.clientId}`);

      const overlap = await tx.activityTurn.findFirst({
        where: { clientId: who.clientId, status: 'BOOKED', startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
      });
      if (overlap) throw conflict('Ya tenés un turno en ese horario.');

      if (access.timesPerWeek) {
        const used = await this.countWeek(tx, clubId, who.clientId, activityTypeId, dayKey, timeZone);
        if (used >= access.timesPerWeek) {
          throw conflict(
            `Tu plan incluye ${access.timesPerWeek} ${access.timesPerWeek === 1 ? 'turno' : 'turnos'} por semana y ya ${
              access.timesPerWeek === 1 ? 'lo reservaste' : 'los reservaste'
            }.`
          );
        }
      }

      const booked = await tx.activityTurn.count({ where: { activityTypeId, status: 'BOOKED', startsAt: slot.startsAt } });
      if (booked >= schedule.capacity) throw conflict('Ese turno ya está completo.');

      const turn = await tx.activityTurn.create({
        data: {
          clubId,
          activityTypeId,
          clientId: who.clientId,
          userId: who.userId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          createdByUserId: who.actorUserId,
        },
      });
      return {
        id: turn.id,
        startsAt: turn.startsAt.toISOString(),
        endsAt: turn.endsAt.toISOString(),
        label: `${schedule.activityType.name} el ${WEEKDAY_NAMES[weekdayOfKey(dayKey)]} ${shortDateKey(dayKey)} de ${slot.time} a ${localTimeLabel(
          slot.endsAt,
          timeZone
        )}`,
      };
    });
  }

  async bookForPlayer(clubId: number, activityTypeId: number, startsAt: string, userId: number) {
    const client = await this.resolvePlayerClient(clubId, userId);
    if (!client) {
      const schedule = await this.getActiveSchedule(clubId, activityTypeId);
      throw conflict(`No tenés un plan que incluya ${schedule.activityType.name}.`);
    }
    return this.book(clubId, activityTypeId, startsAt, { clientId: client.id, userId, actorUserId: null });
  }

  async cancel(clubId: number, turnId: string, by: { userId: number } | { admin: true }) {
    const turn = await prisma.activityTurn.findFirst({ where: { id: turnId, clubId } });
    if (!turn) throw notFound('No se encontró el turno.');
    if ('userId' in by) {
      const client = await this.resolvePlayerClient(clubId, by.userId);
      if (!client || client.id !== turn.clientId) throw notFound('No se encontró el turno.');
    }
    if (turn.status === 'CANCELLED') throw conflict('El turno ya estaba cancelado.');
    if (turn.startsAt.getTime() <= Date.now()) throw conflict('El turno ya empezó: no se puede cancelar.');
    await prisma.activityTurn.update({ where: { id: turn.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    return { id: turn.id, status: 'CANCELLED' as const };
  }

  /** Próximos turnos del jugador en el club. */
  async listMine(clubId: number, userId: number) {
    const client = await this.resolvePlayerClient(clubId, userId);
    if (!client) return [];
    const timeZone = await clubTimeZone(clubId);
    const rows = await prisma.activityTurn.findMany({
      where: { clubId, clientId: client.id, status: 'BOOKED', endsAt: { gt: new Date() } },
      include: { activityType: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    return rows.map((row) => ({
      id: row.id,
      activityTypeId: row.activityTypeId,
      activityName: row.activityType.name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      date: localDateKey(row.startsAt, timeZone),
      time: localTimeLabel(row.startsAt, timeZone),
      endTime: localTimeLabel(row.endsAt, timeZone),
      started: row.startsAt.getTime() <= Date.now(),
    }));
  }

  /** Admin: quiénes vienen en cada franja del día. */
  async adminDay(clubId: number, activityTypeId: number, dayKey: string) {
    const base = await this.daySlots(clubId, activityTypeId, dayKey, null, true);
    const timeZone = await clubTimeZone(clubId);
    const dayStart = fromZonedTime(`${dayKey}T00:00:00`, timeZone);
    const turns = await prisma.activityTurn.findMany({
      where: {
        clubId,
        activityTypeId,
        status: 'BOOKED',
        startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 26 * 3600_000) },
      },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...base,
      slots: base.slots.map((slot) => ({
        ...slot,
        people: turns
          .filter((row) => row.startsAt.toISOString() === slot.startsAt)
          .map((row) => ({ turnId: row.id, clientId: row.client.id, name: row.client.name, checkedInAt: row.checkedInAt?.toISOString() ?? null })),
      })),
    };
  }
}

export const activityTurnService = new ActivityTurnService();
