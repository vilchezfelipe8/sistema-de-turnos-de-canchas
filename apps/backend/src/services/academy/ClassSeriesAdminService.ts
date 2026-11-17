import { Prisma } from '@prisma/client';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { AppError, ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString, parseMoneyOrThrow } from './academyAdminUtils';
import { ClassCreditUsageAdminService } from './ClassCreditUsageAdminService';
import { ClassPassAdminService } from './ClassPassAdminService';
import { PersonService } from '../PersonService';
import { pushNotificationService } from '../PushNotificationService';
import { AccountService } from '../AccountService';
import { ClubPaymentIntegrationService } from '../ClubPaymentIntegrationService';
import { MercadoPagoService } from '../MercadoPagoService';
import { mercadoPagoConfig } from '../../utils/mercadoPagoConfig';
import { generateDisplayCode } from '../../utils/displayCode';

/**
 * Cursos: una clase con días fijos (ej. martes y jueves 18:00).
 *
 * El curso genera las clases (ClassSession) de las próximas semanas y anota en cada una a
 * sus alumnos (ClassSeriesMember). Cada clase sigue siendo una clase común: se marca
 * asistencia, se cobra y se usan packs igual que antes.
 *
 * Al cambiar el curso se rehacen las clases futuras que todavía no tienen movimientos.
 * Las que ya tienen algo (asistencia, pago, pack, cuenta o un alumno anotado a mano) no se
 * tocan, para no perder nada.
 */

type Tx = Prisma.TransactionClient;

const HORIZON_DAYS = 56; // 8 semanas de clases generadas por adelantado
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_SESSION_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

export type ClassSeriesInput = {
  teacherId: string;
  activityTypeId?: number | null;
  courtId?: number | null;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  capacity: number;
  pricePerStudent?: number | string | null;
  /** Nombre que ve el jugador. Sin nombre se muestra la actividad. */
  name?: string | null;
  level?: string | null;
  description?: string | null;
  startsOn: string;
  endsOn?: string | null;
  /** PUBLIC: se ve en la app del club y los jugadores se anotan solos. */
  visibility?: 'PUBLIC' | 'PRIVATE';
  /** Los que se anotan desde la app esperan que el club los acepte. */
  requiresApproval?: boolean;
  /** Se paga por Mercado Pago al anotarse desde la app (la cuota del mes). */
  requiresPayment?: boolean;
};

/** Tiempo que se guarda el lugar mientras el jugador paga. */
const PAID_SPOT_HOLD_MS = 30 * 60_000;

export type ClassSeriesConflict = { date: string; startsAt: string; reason: string };

type Occurrence = { date: string; startsAt: Date; endsAt: Date };

const fieldError = (message: string, field: string, fieldMessage = message) =>
  new AppError({ statusCode: 400, code: ErrorCodes.INVALID_INPUT, message, fieldErrors: { [field]: fieldMessage } });

const toDateKey = (value: Date) => value.toISOString().slice(0, 10);
const dateKeyToDbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

const addDaysToKey = (key: string, days: number) => {
  const date = dateKeyToDbDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
};

const weekdayOfKey = (key: string) => dateKeyToDbDate(key).getUTCDay();

const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const describeWeekdays = (weekdays: number[]) =>
  [...weekdays]
    // Lunes primero: es como se lee una semana de clases.
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((day) => WEEKDAY_SHORT[day])
    .join(', ');

export class ClassSeriesAdminService {
  private readonly validation = new AcademyAdminValidationService();
  private readonly creditUsageService = new ClassCreditUsageAdminService();
  private readonly classPassService = new ClassPassAdminService();
  private readonly personService = new PersonService();
  private readonly accountService = new AccountService();
  private readonly paymentIntegrationService = new ClubPaymentIntegrationService();
  private readonly mercadoPagoService = new MercadoPagoService();

  // ---------------------------------------------------------------------------
  // Fechas
  // ---------------------------------------------------------------------------

  private async resolveTimeZone(clubId: number, tx: Tx | typeof prisma = prisma) {
    const settings = await tx.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
    return String(settings?.timeZone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  }

  private todayKey(timeZone: string) {
    const local = toZonedTime(new Date(), timeZone);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  }

  /** Fechas del curso entre fromKey y toKey (inclusive), en el huso del club. */
  private occurrences(
    series: { weekdays: number[]; startTime: string; durationMinutes: number; startsOn: string; endsOn: string | null },
    fromKey: string,
    toKey: string,
    timeZone: string
  ): Occurrence[] {
    const start = series.startsOn > fromKey ? series.startsOn : fromKey;
    const end = series.endsOn && series.endsOn < toKey ? series.endsOn : toKey;
    const days = new Set(series.weekdays);
    const result: Occurrence[] = [];
    for (let key = start; key <= end; key = addDaysToKey(key, 1)) {
      if (!days.has(weekdayOfKey(key))) continue;
      const startsAt = fromZonedTime(`${key}T${series.startTime}:00`, timeZone);
      const endsAt = new Date(startsAt.getTime() + series.durationMinutes * 60000);
      result.push({ date: key, startsAt, endsAt });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Validación
  // ---------------------------------------------------------------------------

  private async validateInput(clubId: number, actorUserId: number, input: ClassSeriesInput) {
    const teacherId = String(input.teacherId || '').trim();
    if (!teacherId) throw fieldError('Elegí quién da el curso.', 'teacherId', 'Elegí un profesor.');

    const weekdays = Array.from(new Set((input.weekdays || []).map(Number))).filter(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6
    );
    if (weekdays.length === 0) {
      throw fieldError('Elegí al menos un día.', 'weekdays');
    }

    const startTime = String(input.startTime || '').trim();
    if (!TIME_RE.test(startTime)) throw fieldError('Hora inválida.', 'startTime');

    const durationMinutes = Number(input.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) {
      throw badRequest('Duración inválida.', ErrorCodes.INVALID_INPUT);
    }

    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      throw fieldError('Poné para cuántos alumnos es.', 'capacity', 'Cupo inválido.');
    }

    const startsOn = String(input.startsOn || '').trim();
    if (!DATE_RE.test(startsOn)) throw badRequest('Fecha de inicio inválida.', ErrorCodes.INVALID_DATE_TIME);
    const endsOn = input.endsOn ? String(input.endsOn).trim() : null;
    if (endsOn && (!DATE_RE.test(endsOn) || endsOn < startsOn)) {
      throw fieldError('El curso tiene que terminar después de empezar.', 'endsOn', 'Revisá la fecha de fin.');
    }

    await Promise.all([
      this.validation.assertTeacherBelongsToClub(clubId, teacherId),
      this.validation.assertUserBelongsToClub(clubId, actorUserId),
      input.courtId ? this.validation.assertCourtBelongsToClub(clubId, Number(input.courtId)) : Promise.resolve(null),
      input.activityTypeId ? this.validation.assertActivityBelongsToClub(clubId, Number(input.activityTypeId)) : Promise.resolve(null),
    ]);

    const validated = {
      teacherId,
      activityTypeId: input.activityTypeId ? Number(input.activityTypeId) : null,
      courtId: input.courtId ? Number(input.courtId) : null,
      classType: (capacity === 1 ? 'INDIVIDUAL' : 'GROUP') as 'INDIVIDUAL' | 'GROUP',
      weekdays: weekdays.sort((a, b) => a - b),
      startTime,
      durationMinutes,
      capacity,
      pricePerStudent: parseMoneyOrThrow(input.pricePerStudent, 'Precio por alumno'),
      name: normalizeOptionalString(input.name),
      level: normalizeOptionalString(input.level),
      description: normalizeOptionalString(input.description),
      startsOn,
      endsOn,
      visibility: (input.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE') as 'PUBLIC' | 'PRIVATE',
      // Cobrar al anotarse y aprobar a cada uno no van juntos: el que paga queda anotado.
      requiresApproval: input.visibility === 'PUBLIC' && !input.requiresPayment ? Boolean(input.requiresApproval) : false,
      requiresPayment: input.visibility === 'PUBLIC' ? Boolean(input.requiresPayment) : false,
    };
    if (validated.requiresPayment) {
      if (!(Number(validated.pricePerStudent ?? 0) > 0)) {
        throw fieldError('Para cobrar al anotarse, poné el precio por clase.', 'pricePerStudent', 'Poné el precio por clase.');
      }
      const integration = await this.paymentIntegrationService.getMercadoPagoIntegrationStatusForClub(clubId);
      if (!integration.connected) {
        throw fieldError(
          'Para cobrar al anotarse, conectá Mercado Pago en Ajustes > Integraciones.',
          'requiresPayment',
          'Falta conectar Mercado Pago.'
        );
      }
    }
    return validated;
  }

  /** Fechas en las que la cancha ya está ocupada por un turno, otra clase o un bloqueo. */
  private async findConflicts(
    tx: Tx | typeof prisma,
    clubId: number,
    courtId: number | null,
    occurrences: Occurrence[],
    ignoreSeriesId?: string
  ): Promise<ClassSeriesConflict[]> {
    if (!courtId || occurrences.length === 0) return [];
    const from = occurrences[0].startsAt;
    const to = occurrences[occurrences.length - 1].endsAt;
    const [bookings, classes, blocks] = await Promise.all([
      tx.booking.findMany({
        where: { clubId, courtId, status: { not: 'CANCELLED' }, startDateTime: { lt: to }, endDateTime: { gt: from } },
        select: { startDateTime: true, endDateTime: true },
      }),
      tx.classSession.findMany({
        where: {
          clubId,
          courtId,
          status: { in: [...ACTIVE_SESSION_STATUSES] },
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(ignoreSeriesId ? { OR: [{ seriesId: null }, { seriesId: { not: ignoreSeriesId } }] } : {}),
        },
        select: { startsAt: true, endsAt: true },
      }),
      tx.courtBlock.findMany({
        where: { clubId, courtId, startDateTime: { lt: to }, endDateTime: { gt: from } },
        select: { startDateTime: true, endDateTime: true },
      }),
    ]);

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;
    const result: ClassSeriesConflict[] = [];
    for (const occurrence of occurrences) {
      let reason = '';
      if (bookings.some((row) => overlaps(occurrence.startsAt, occurrence.endsAt, row.startDateTime, row.endDateTime))) {
        reason = 'hay un turno reservado';
      } else if (classes.some((row) => overlaps(occurrence.startsAt, occurrence.endsAt, row.startsAt, row.endsAt))) {
        reason = 'hay otra clase';
      } else if (blocks.some((row) => overlaps(occurrence.startsAt, occurrence.endsAt, row.startDateTime, row.endDateTime))) {
        reason = 'la cancha está bloqueada';
      }
      if (reason) result.push({ date: occurrence.date, startsAt: occurrence.startsAt.toISOString(), reason });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Generación de clases
  // ---------------------------------------------------------------------------

  private sessionDataFromSeries(series: any) {
    return {
      teacherId: String(series.teacherId),
      activityTypeId: series.activityTypeId ?? null,
      courtId: series.courtId ?? null,
      classType: series.classType,
      capacity: Number(series.capacity),
      pricePerStudent: series.pricePerStudent ?? null,
      level: series.level ?? null,
      description: series.description ?? null,
      durationMinutes: Number(series.durationMinutes),
    };
  }

  /**
   * Crea las clases que faltan hasta el horizonte y anota a los alumnos del curso.
   * Saltea fechas que ya tienen clase del curso y fechas con la cancha ocupada.
   */
  private async generateTx(tx: Tx, seriesId: string, actorUserId: number, timeZone: string) {
    const series = await tx.classSeries.findUnique({
      where: { id: seriesId },
      include: {
        members: {
          where: { leftAt: null, status: 'ACTIVE' },
          orderBy: { joinedAt: 'asc' },
          include: { studentClient: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
        },
      },
    });
    if (!series || series.status !== 'ACTIVE') return { created: 0, skipped: [] as ClassSeriesConflict[] };

    const todayKey = this.todayKey(timeZone);
    const horizonKey = addDaysToKey(todayKey, HORIZON_DAYS);
    const occurrences = this.occurrences(
      {
        weekdays: series.weekdays,
        startTime: series.startTime,
        durationMinutes: series.durationMinutes,
        startsOn: toDateKey(series.startsOn),
        endsOn: series.endsOn ? toDateKey(series.endsOn) : null,
      },
      todayKey,
      horizonKey,
      timeZone
    ).filter((occurrence) => occurrence.startsAt.getTime() > Date.now());

    // Fechas que ya tienen una clase de este curso (activa o cancelada a mano): no se repiten.
    const existing = await tx.classSession.findMany({
      where: { seriesId, startsAt: { gte: dateKeyToDbDate(addDaysToKey(todayKey, -1)) } },
      select: { startsAt: true },
    });
    const existingDates = new Set(existing.map((row) => this.localDateKey(row.startsAt, timeZone)));
    const pending = occurrences.filter((occurrence) => !existingDates.has(occurrence.date));

    const conflicts = await this.findConflicts(tx, series.clubId, series.courtId, pending, seriesId);
    const conflictDates = new Set(conflicts.map((row) => row.date));
    const base = this.sessionDataFromSeries(series);
    const members = series.members.slice(0, series.capacity);

    let created = 0;
    for (const occurrence of pending) {
      if (conflictDates.has(occurrence.date)) continue;
      const session = await tx.classSession.create({
        data: {
          clubId: series.clubId,
          seriesId,
          ...base,
          visibility: 'PRIVATE',
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          status: 'SCHEDULED',
          createdByUserId: Number(actorUserId),
        },
        select: { id: true },
      });
      created += 1;
      for (const member of members) {
        await tx.classEnrollment.create({
          data: this.enrollmentDataForMember(series, member, session.id),
        });
      }
    }

    const generatedUntil = series.endsOn && toDateKey(series.endsOn) < horizonKey ? toDateKey(series.endsOn) : horizonKey;
    await tx.classSeries.update({ where: { id: seriesId }, data: { generatedUntil: dateKeyToDbDate(generatedUntil) } });
    return { created, skipped: conflicts };
  }

  private enrollmentDataForMember(series: any, member: any, classSessionId: string) {
    return {
      clubId: Number(series.clubId),
      classSessionId,
      seriesMemberId: String(member.id),
      studentClientId: String(member.studentClient.id),
      studentUserId: member.studentClient.userId ?? null,
      billingResponsibleClientId: member.billingResponsibleClientId ?? null,
      snapshotName: String(member.studentClient.name || '').trim(),
      snapshotEmail: member.studentClient.email ?? null,
      snapshotPhone: member.studentClient.phone ?? null,
      priceAtEnrollment: series.pricePerStudent ?? 0,
      paidAmount: 0,
      enrollmentStatus: 'ENROLLED' as const,
      attendanceStatus: 'PENDING' as const,
      paymentStatus: 'UNPAID' as const,
      createdByUserId: Number(member.createdByUserId),
    };
  }

  private localDateKey(date: Date, timeZone: string) {
    const local = toZonedTime(date, timeZone);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  }

  /**
   * Clases futuras del curso, separadas en las que se pueden rehacer y las que tienen
   * movimientos (asistencia, pago, pack, cuenta abierta o un alumno anotado solo a esa clase).
   */
  private async splitFutureSessions(tx: Tx, seriesId: string) {
    const sessions = await tx.classSession.findMany({
      where: { seriesId, startsAt: { gt: new Date() } },
      select: {
        id: true,
        status: true,
        enrollments: {
          select: {
            id: true,
            seriesMemberId: true,
            enrollmentStatus: true,
            attendanceStatus: true,
            paymentStatus: true,
            paidAmount: true,
            _count: { select: { creditUsages: true } },
          },
        },
      },
    });
    const enrollmentIds = sessions.flatMap((session) => session.enrollments.map((row) => row.id));
    const accounts = enrollmentIds.length
      ? await tx.account.findMany({
          where: { sourceType: 'CLASS_ENROLLMENT', sourceId: { in: enrollmentIds } },
          select: { sourceId: true },
        })
      : [];
    const withAccount = new Set(accounts.map((row) => String(row.sourceId)));

    const replaceable: string[] = [];
    const kept: string[] = [];
    for (const session of sessions) {
      const touched =
        !ACTIVE_SESSION_STATUSES.includes(session.status as any) ||
        session.enrollments.some(
          (row) =>
            // Una baja sin pago ni pack no cuenta como movimiento.
            !(row.enrollmentStatus === 'CANCELLED' && row.paymentStatus === 'UNPAID' && Number(row.paidAmount) === 0 && row._count.creditUsages === 0 && !withAccount.has(row.id)) &&
            (!row.seriesMemberId ||
            row.attendanceStatus !== 'PENDING' ||
            row.paymentStatus !== 'UNPAID' ||
            Number(row.paidAmount) > 0 ||
            row._count.creditUsages > 0 ||
            withAccount.has(row.id))
        );
      (touched ? kept : replaceable).push(session.id);
    }
    return { replaceable, kept };
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  private mapSeries(row: any, timeZone: string) {
    const startsOn = toDateKey(row.startsOn);
    const endsOn = row.endsOn ? toDateKey(row.endsOn) : null;
    return {
      id: String(row.id),
      teacherId: String(row.teacherId),
      teacher: row.teacher ? { id: String(row.teacher.id), displayName: String(row.teacher.displayName || '').trim() } : null,
      activityTypeId: row.activityTypeId ?? null,
      activityType: row.activityType ? { id: Number(row.activityType.id), name: String(row.activityType.name || '').trim() } : null,
      courtId: row.courtId ?? null,
      court: row.court ? { id: Number(row.court.id), name: String(row.court.name || '').trim() } : null,
      classType: String(row.classType),
      weekdays: row.weekdays as number[],
      weekdaysLabel: describeWeekdays(row.weekdays),
      startTime: String(row.startTime),
      durationMinutes: Number(row.durationMinutes),
      capacity: Number(row.capacity),
      pricePerStudent: row.pricePerStudent == null ? null : Number(row.pricePerStudent),
      name: row.name ?? null,
      level: row.level ?? null,
      description: row.description ?? null,
      startsOn,
      endsOn,
      status: String(row.status),
      timeZone,
      members: Array.isArray(row.members)
        ? row.members.map((member: any) => ({
            id: String(member.id),
            studentClientId: String(member.studentClientId),
            studentName: String(member.studentClient?.name || '').trim(),
            studentPhone: member.studentClient?.phone ?? null,
            billingResponsibleClientId: member.billingResponsibleClientId ?? null,
            billingResponsibleName: member.billingResponsibleClient?.name ?? null,
            joinedAt: new Date(member.joinedAt).toISOString(),
            notes: member.notes ?? null,
            status: String(member.status || 'ACTIVE'),
            fromApp: member.requestedByUserId != null,
          }))
        : undefined,
      activeMembersCount: row._count?.members ?? undefined,
      visibility: String(row.visibility || 'PRIVATE'),
      requiresApproval: Boolean(row.requiresApproval),
      requiresPayment: Boolean(row.requiresPayment),
    };
  }

  private readonly seriesInclude = {
    teacher: { select: { id: true, displayName: true } },
    activityType: { select: { id: true, name: true } },
    court: { select: { id: true, name: true } },
  } as const;

  async list(clubId: number) {
    const timeZone = await this.resolveTimeZone(clubId);
    const rows = await prisma.classSeries.findMany({
      where: { clubId },
      include: { ...this.seriesInclude, _count: { select: { members: { where: { leftAt: null, status: 'ACTIVE' } } } } },
      orderBy: [{ status: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((row) => this.mapSeries(row, timeZone));
  }

  async getById(clubId: number, seriesId: string) {
    const timeZone = await this.resolveTimeZone(clubId);
    const row = await prisma.classSeries.findFirst({
      where: { id: String(seriesId), clubId },
      include: {
        ...this.seriesInclude,
        members: {
          where: { leftAt: null, status: { in: ['ACTIVE', 'PENDING'] } },
          orderBy: { joinedAt: 'asc' },
          include: {
            studentClient: { select: { id: true, name: true, phone: true } },
            billingResponsibleClient: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!row) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    return this.mapSeries(row, timeZone);
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  private async assertNoConflicts(
    clubId: number,
    data: Awaited<ReturnType<ClassSeriesAdminService['validateInput']>>,
    timeZone: string,
    options: { skipConflicts?: boolean; ignoreSeriesId?: string }
  ) {
    if (options.skipConflicts) return;
    const todayKey = this.todayKey(timeZone);
    const occurrences = this.occurrences(data, todayKey, addDaysToKey(todayKey, HORIZON_DAYS), timeZone).filter(
      (occurrence) => occurrence.startsAt.getTime() > Date.now()
    );
    if (occurrences.length === 0) {
      throw badRequest('Con esos días y fechas el curso no tiene clases por delante.', ErrorCodes.INVALID_INPUT);
    }
    const conflicts = await this.findConflicts(prisma, clubId, data.courtId, occurrences, options.ignoreSeriesId);
    if (conflicts.length > 0) {
      throw conflict(
        conflicts.length === 1
          ? 'Una fecha choca con algo que ya está en la cancha.'
          : `${conflicts.length} fechas chocan con algo que ya está en la cancha.`,
        ErrorCodes.CLASS_SESSION_OVERLAP,
        { conflicts, total: occurrences.length }
      );
    }
  }

  async create(clubId: number, actorUserId: number, input: ClassSeriesInput, options: { skipConflicts?: boolean } = {}) {
    const data = await this.validateInput(clubId, actorUserId, input);
    const timeZone = await this.resolveTimeZone(clubId);
    await this.assertNoConflicts(clubId, data, timeZone, options);

    const result = await prisma.$transaction(
      async (tx) => {
        const series = await tx.classSeries.create({
          data: {
            clubId,
            ...data,
            startsOn: dateKeyToDbDate(data.startsOn),
            endsOn: data.endsOn ? dateKeyToDbDate(data.endsOn) : null,
            createdByUserId: Number(actorUserId),
          },
          select: { id: true },
        });
        const generated = await this.generateTx(tx, series.id, actorUserId, timeZone);
        return { id: series.id, ...generated };
      },
      { timeout: 30000 }
    );

    return { series: await this.getById(clubId, result.id), created: result.created, skipped: result.skipped };
  }

  async update(
    clubId: number,
    seriesId: string,
    actorUserId: number,
    input: ClassSeriesInput,
    options: { skipConflicts?: boolean } = {}
  ) {
    const existing = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId }, select: { id: true, status: true } });
    if (!existing) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (existing.status !== 'ACTIVE') throw badRequest('El curso ya terminó.', ErrorCodes.INVALID_INPUT);

    const data = await this.validateInput(clubId, actorUserId, input);
    const timeZone = await this.resolveTimeZone(clubId);
    await this.assertNoConflicts(clubId, data, timeZone, { ...options, ignoreSeriesId: existing.id });

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.classSeries.update({
          where: { id: existing.id },
          data: {
            ...data,
            startsOn: dateKeyToDbDate(data.startsOn),
            endsOn: data.endsOn ? dateKeyToDbDate(data.endsOn) : null,
          },
        });
        const { replaceable, kept } = await this.splitFutureSessions(tx, existing.id);
        if (replaceable.length) {
          await tx.classSession.deleteMany({ where: { id: { in: replaceable } } });
        }
        // Las que tienen movimientos conservan día y hora; se actualiza quién la da y los textos.
        if (kept.length) {
          await tx.classSession.updateMany({
            where: { id: { in: kept }, status: { in: [...ACTIVE_SESSION_STATUSES] } },
            data: { teacherId: data.teacherId, level: data.level, description: data.description, activityTypeId: data.activityTypeId },
          });
        }
        const generated = await this.generateTx(tx, existing.id, actorUserId, timeZone);
        return { ...generated, kept: kept.length };
      },
      { timeout: 30000 }
    );

    return {
      series: await this.getById(clubId, existing.id),
      created: result.created,
      skipped: result.skipped,
      kept: result.kept,
    };
  }

  /** Termina el curso: no genera más clases y saca las futuras que no tienen movimientos. */
  async end(clubId: number, seriesId: string) {
    const existing = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId }, select: { id: true } });
    if (!existing) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    const timeZone = await this.resolveTimeZone(clubId);
    const kept = await prisma.$transaction(async (tx) => {
      await tx.classSeries.update({
        where: { id: existing.id },
        data: { status: 'ENDED', endsOn: dateKeyToDbDate(this.todayKey(timeZone)) },
      });
      const { replaceable, kept: keptIds } = await this.splitFutureSessions(tx, existing.id);
      if (replaceable.length) await tx.classSession.deleteMany({ where: { id: { in: replaceable } } });
      return keptIds.length;
    });
    return { series: await this.getById(clubId, existing.id), kept };
  }

  /** Anota al alumno en las clases futuras del curso que tienen lugar. */
  private async enrollMemberInFutureTx(tx: Tx, series: any, member: any) {
    const sessions = await tx.classSession.findMany({
      where: { seriesId: series.id, startsAt: { gt: new Date() }, status: { in: [...ACTIVE_SESSION_STATUSES] } },
      select: {
        id: true,
        startsAt: true,
        capacity: true,
        enrollments: { where: { enrollmentStatus: { not: 'CANCELLED' } }, select: { studentClientId: true, enrollmentStatus: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    let enrolled = 0;
    const full: string[] = [];
    for (const session of sessions) {
      if (session.enrollments.some((row) => row.studentClientId === member.studentClient.id)) continue;
      const taken = session.enrollments.filter((row) => row.enrollmentStatus === 'ENROLLED').length;
      if (taken >= session.capacity) {
        full.push(session.startsAt.toISOString());
        continue;
      }
      await tx.classEnrollment.create({ data: this.enrollmentDataForMember(series, member, session.id) });
      enrolled += 1;
    }
    return { enrolled, full };
  }

  private async assertRoomInSeries(series: { id: string; capacity: number }) {
    const activeMembers = await prisma.classSeriesMember.count({
      where: { seriesId: series.id, leftAt: null, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } },
    });
    if (activeMembers >= series.capacity) {
      throw conflict('El curso está completo.', ErrorCodes.CLASS_SESSION_CAPACITY_EXCEEDED);
    }
  }

  /** Anota al alumno al curso: queda en todas las clases que vienen con lugar. */
  async addMember(
    clubId: number,
    seriesId: string,
    actorUserId: number,
    input: { studentClientId: string; billingResponsibleClientId?: string | null; notes?: string | null },
    options: { fromAppUserId?: number; pending?: boolean } = {}
  ) {
    const series = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId } });
    if (!series) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (series.status !== 'ACTIVE') throw badRequest('El curso ya terminó.', ErrorCodes.INVALID_INPUT);

    const student = await this.validation.assertClientBelongsToClub(clubId, String(input.studentClientId || ''));
    const responsible = input.billingResponsibleClientId
      ? await this.validation.assertClientBelongsToClub(clubId, String(input.billingResponsibleClientId))
      : null;
    // Desde la app se anota el propio jugador, que no es del staff del club.
    if (!options.fromAppUserId) await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const already = await prisma.classSeriesMember.findFirst({
      where: { seriesId: series.id, studentClientId: student.id, leftAt: null, status: { in: ['ACTIVE', 'PENDING', 'AWAITING_PAYMENT'] } },
      select: { id: true, status: true },
    });
    if (already) {
      throw conflict(
        already.status === 'PENDING' ? `${student.name} ya pidió lugar en el curso.` : `${student.name} ya está en el curso.`,
        ErrorCodes.CLASS_SESSION_ENROLLMENT_CONFLICT
      );
    }

    await this.assertRoomInSeries(series);

    const result = await prisma.$transaction(
      async (tx) => {
        const member = await tx.classSeriesMember.create({
          data: {
            clubId,
            seriesId: series.id,
            studentClientId: student.id,
            billingResponsibleClientId: responsible?.id ?? null,
            notes: normalizeOptionalString(input.notes),
            createdByUserId: Number(actorUserId),
            status: options.pending ? 'PENDING' : 'ACTIVE',
            requestedByUserId: options.fromAppUserId ?? null,
          },
          include: { studentClient: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
        });
        if (options.pending) return { memberId: member.id, enrolled: 0, full: [] as string[] };
        const enrolled = await this.enrollMemberInFutureTx(tx, series, member);
        return { memberId: member.id, ...enrolled };
      },
      { timeout: 30000 }
    );

    return { series: await this.getById(clubId, series.id), ...result };
  }

  /** Acepta un pedido de la app: pasa a estar en el curso y en las clases que vienen. */
  async approveMember(clubId: number, seriesId: string, memberId: string) {
    const series = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId } });
    if (!series) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (series.status !== 'ACTIVE') throw badRequest('El curso ya terminó.', ErrorCodes.INVALID_INPUT);
    const pending = await prisma.classSeriesMember.findFirst({
      where: { id: String(memberId), seriesId: series.id, clubId, leftAt: null, status: 'PENDING' },
      select: { id: true },
    });
    if (!pending) throw notFound('Ese pedido ya no está.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    await this.assertRoomInSeries(series);

    const result = await prisma.$transaction(
      async (tx) => {
        const member = await tx.classSeriesMember.update({
          where: { id: pending.id },
          data: { status: 'ACTIVE', joinedAt: new Date() },
          include: { studentClient: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
        });
        return this.enrollMemberInFutureTx(tx, series, member);
      },
      { timeout: 30000 }
    );
    await this.notifyPlayer(clubId, series.id, pending.id, true);
    return { series: await this.getById(clubId, series.id), ...result };
  }

  /** Rechaza un pedido de la app. */
  async rejectMember(clubId: number, seriesId: string, memberId: string) {
    const updated = await prisma.classSeriesMember.updateMany({
      where: { id: String(memberId), seriesId: String(seriesId), clubId, leftAt: null, status: 'PENDING' },
      data: { status: 'REJECTED', leftAt: new Date() },
    });
    if (updated.count !== 1) throw notFound('Ese pedido ya no está.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    await this.notifyPlayer(clubId, String(seriesId), String(memberId), false);
    return { series: await this.getById(clubId, String(seriesId)) };
  }

  /** Pedidos de lugar que esperan respuesta, de todos los cursos del club. */
  async listRequests(clubId: number) {
    const rows = await prisma.classSeriesMember.findMany({
      where: { clubId, leftAt: null, status: 'PENDING', series: { status: 'ACTIVE' } },
      include: {
        studentClient: { select: { name: true, phone: true } },
        series: { select: { id: true, weekdays: true, startTime: true, activityType: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      memberId: row.id,
      seriesId: row.seriesId,
      seriesLabel: this.courseLabel(row.series),
      studentName: row.studentClient?.name || 'Jugador',
      studentPhone: row.studentClient?.phone || null,
      requestedAt: row.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Avisos (push). Nunca frenan la acción: si fallan, se registra y sigue.
  // ---------------------------------------------------------------------------

  private courseLabel(series: { weekdays: number[]; startTime: string; activityType?: { name: string } | null }) {
    return `${series.activityType?.name || 'Curso'} ${describeWeekdays(series.weekdays)} ${series.startTime}`;
  }

  private async notifyStaff(
    clubId: number,
    seriesId: string,
    actorUserId: number,
    event: 'REQUEST' | 'JOINED' | 'PAID' | 'LEFT' | 'CANCELLED_REQUEST',
    playerName: string
  ) {
    try {
      const series = await prisma.classSeries.findUnique({
        where: { id: seriesId },
        select: { weekdays: true, startTime: true, activityType: { select: { name: true } } },
      });
      if (!series) return;
      const label = this.courseLabel(series);
      const content =
        event === 'REQUEST'
          ? { title: `${playerName} pidió lugar en un curso`, body: `${label}. Tocá para aceptarlo o rechazarlo.`, url: '/admin/academia?tab=clases&pedidos=1' }
          : event === 'PAID'
            ? { title: `${playerName} se anotó y pagó un curso`, body: `${label}. Ya está en las clases que vienen.`, url: '/admin/academia?tab=clases' }
          : event === 'JOINED'
            ? { title: `${playerName} se anotó a un curso`, body: `${label}. Ya está en las clases que vienen.`, url: '/admin/academia?tab=clases' }
            : event === 'LEFT'
              ? { title: `${playerName} se bajó de un curso`, body: `${label}. Ya no está en las clases que vienen.`, url: '/admin/academia?tab=clases' }
              : { title: `${playerName} canceló su pedido`, body: `${label}.`, url: '/admin/academia?tab=clases' };
      const staff = await prisma.membership.findMany({
        where: { clubId, role: { in: ['OWNER', 'ADMIN', 'STAFF'] }, userId: { not: actorUserId } },
        select: { userId: true },
      });
      for (const row of staff) {
        await pushNotificationService.enqueue(prisma, {
          clubId,
          userId: row.userId,
          kind: 'COURSE_REQUEST',
          aggregateType: 'ClassSeries',
          aggregateId: seriesId,
          content: { ...content, tag: `course-${seriesId}-${event.toLowerCase()}` },
        });
      }
    } catch (error) {
      console.error('[academia] No se pudo avisar al club del curso', error);
    }
  }

  private async notifyPlayer(clubId: number, seriesId: string, memberId: string, accepted: boolean) {
    try {
      const member = await prisma.classSeriesMember.findUnique({
        where: { id: memberId },
        select: {
          requestedByUserId: true,
          studentClient: { select: { userId: true } },
          series: {
            select: {
              weekdays: true,
              startTime: true,
              activityType: { select: { name: true } },
              club: { select: { name: true, slug: true } },
            },
          },
        },
      });
      const userId = member?.requestedByUserId ?? member?.studentClient?.userId ?? null;
      if (!member || !userId) return;
      const label = this.courseLabel(member.series);
      const clubName = member.series.club?.name || 'El club';
      await pushNotificationService.enqueue(prisma, {
        clubId,
        userId,
        kind: 'COURSE_ANSWER',
        aggregateType: 'ClassSeries',
        aggregateId: seriesId,
        content: accepted
          ? { title: `${clubName} te sumó al curso ✅`, body: `${label}. Ya estás en las clases que vienen.`, url: '/perfil#mis-cursos', tag: `course-${seriesId}` }
          : {
              title: `${clubName} no pudo sumarte al curso`,
              body: `${label}. Mirá otros horarios en la página del club.`,
              url: member.series.club?.slug ? `/club/${member.series.club.slug}` : '/complejos',
              tag: `course-${seriesId}`,
            },
      });
    } catch (error) {
      console.error('[academia] No se pudo avisar al jugador del curso', error);
    }
  }

  // ---------------------------------------------------------------------------
  // App del jugador
  // ---------------------------------------------------------------------------

  /** Cursos que el club muestra en la app, con el estado del jugador si está logueado. */
  async listPublic(clubId: number, userId?: number | null) {
    const rows = await prisma.classSeries.findMany({
      where: { clubId, status: 'ACTIVE', visibility: 'PUBLIC' },
      include: {
        teacher: { select: { displayName: true } },
        activityType: { select: { name: true } },
        _count: { select: { members: { where: { leftAt: null, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } } } } },
      },
      orderBy: [{ startTime: 'asc' }],
    });
    const client = userId ? await prisma.client.findFirst({ where: { clubId, userId: Number(userId) }, select: { id: true } }) : null;
    const mine = client
      ? await prisma.classSeriesMember.findMany({
          where: { studentClientId: client.id, seriesId: { in: rows.map((row) => row.id) }, leftAt: null },
          select: { seriesId: true, status: true },
        })
      : [];
    const myStatus = new Map(mine.map((row) => [row.seriesId, String(row.status)]));
    const timeZone = await this.resolveTimeZone(clubId);
    const today = this.todayKey(timeZone);
    const quotes = new Map<string, ReturnType<ClassSeriesAdminService['applyPlanCoverage']>>();
    for (const row of rows) {
      const quote = await this.signupQuote(row, timeZone);
      // Con sesión: cuántas de esas clases ya le cubre un plan del club.
      const credits = quote && client ? await this.planCreditsForMonth(row, client.id, quote.month, timeZone) : 0;
      quotes.set(row.id, this.applyPlanCoverage(quote, credits));
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      activity: row.activityType?.name ?? null,
      teacher: row.teacher?.displayName ?? null,
      weekdays: row.weekdays,
      weekdaysLabel: describeWeekdays(row.weekdays),
      startTime: row.startTime,
      durationMinutes: row.durationMinutes,
      level: row.level,
      description: row.description,
      pricePerClass: row.pricePerStudent == null ? null : Number(row.pricePerStudent),
      spotsLeft: Math.max(0, row.capacity - (row._count?.members ?? 0)),
      requiresApproval: row.requiresApproval,
      requiresPayment: row.requiresPayment,
      // Desde cuándo y hasta cuándo se da (para que no parezca que ya arrancó).
      startsOn: toDateKey(row.startsOn),
      endsOn: row.endsOn ? toDateKey(row.endsOn) : null,
      startsLater: toDateKey(row.startsOn) > today,
      // Lo que paga hoy al anotarse: las clases que quedan del mes (o el mes que viene), menos las que cubre su plan.
      signupPrice: row.requiresPayment ? quotes.get(row.id) ?? null : null,
      // Clases del mes que le cubre su plan (null sin sesión, sin precio o sin plan que sirva).
      planCoverage: (() => {
        const quote = quotes.get(row.id);
        if (!quote || !quote.coveredByPlan) return null;
        return { covered: quote.coveredByPlan, classes: quote.coveredByPlan + quote.classes, full: quote.classes === 0 };
      })(),
      myStatus: (myStatus.get(row.id) as 'ACTIVE' | 'PENDING' | 'AWAITING_PAYMENT' | undefined) ?? null,
    }));
  }

  private async assertPublicSeries(clubId: number, seriesId: string) {
    const series = await prisma.classSeries.findFirst({
      where: { id: String(seriesId), clubId, status: 'ACTIVE', visibility: 'PUBLIC' },
    });
    if (!series) throw notFound('Ese curso no está disponible.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    return series;
  }

  /** El jugador se anota desde la app. Si el curso pide aprobación, queda esperando. */
  async joinFromApp(clubId: number, seriesId: string, userId: number) {
    const series = await this.assertPublicSeries(clubId, seriesId);
    const client = await this.personService.ensureClientForUser(clubId, userId, { source: 'SELF_BOOKING' });
    if (series.requiresPayment) return this.joinPaying(clubId, series, client.id, userId, client.name);
    const result = await this.addMember(
      clubId,
      series.id,
      userId,
      { studentClientId: String(client.id) },
      { fromAppUserId: userId, pending: series.requiresApproval }
    );
    await this.notifyStaff(clubId, series.id, userId, series.requiresApproval ? 'REQUEST' : 'JOINED', client.name);
    return {
      status: series.requiresApproval ? ('PENDING' as const) : ('ACTIVE' as const),
      enrolled: result.enrolled,
      initPoint: null as string | null,
      coveredByPlan: false,
    };
  }

  /** El jugador se baja del curso (o cancela su pedido). */
  async leaveFromApp(clubId: number, seriesId: string, userId: number) {
    await this.assertPublicSeries(clubId, seriesId);
    const client = await prisma.client.findFirst({ where: { clubId, userId: Number(userId) }, select: { id: true } });
    const member = client
      ? await prisma.classSeriesMember.findFirst({
          where: {
            seriesId: String(seriesId),
            studentClientId: client.id,
            leftAt: null,
            status: { in: ['ACTIVE', 'PENDING', 'AWAITING_PAYMENT'] },
          },
          select: { id: true, status: true, studentClient: { select: { name: true } } },
        })
      : null;
    if (!member) throw notFound('No estás en este curso.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    const result = await this.removeMember(clubId, String(seriesId), member.id);
    // Si todavía no había pagado, el club nunca se enteró: no hace falta avisar.
    if (member.status !== 'AWAITING_PAYMENT') await this.notifyStaff(
      clubId,
      String(seriesId),
      userId,
      member.status === 'PENDING' ? 'CANCELLED_REQUEST' : 'LEFT',
      member.studentClient?.name || 'Un jugador'
    );
    return { kept: result.kept };
  }

  // ---------------------------------------------------------------------------
  // Cobrar al anotarse (Mercado Pago)
  // ---------------------------------------------------------------------------

  /**
   * Lo que paga el jugador al anotarse: las clases que quedan este mes, como un pack.
   * Si este mes ya no quedan clases, el mes que viene completo.
   */
  async signupQuote(
    series: {
      id: string;
      weekdays: number[];
      startTime: string;
      durationMinutes: number;
      startsOn: Date;
      endsOn: Date | null;
      generatedUntil: Date | null;
      pricePerStudent: Prisma.Decimal | number | null;
    },
    timeZone: string
  ) {
    const price = Number(series.pricePerStudent ?? 0);
    if (!(price > 0)) return null;
    const now = new Date();
    const todayKey = this.todayKey(timeZone);
    const generatedUntilKey = series.generatedUntil ? toDateKey(series.generatedUntil) : null;
    let month = todayKey.slice(0, 7);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [year, monthNumber] = month.split('-').map(Number);
      const monthStart = `${month}-01`;
      const nextMonth = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
      const nextMonthStart = `${nextMonth}-01`;
      const fromKey = attempt === 0 ? todayKey : monthStart;
      const occurrences = this.occurrences(
        {
          weekdays: series.weekdays,
          startTime: series.startTime,
          durationMinutes: series.durationMinutes,
          startsOn: toDateKey(series.startsOn),
          endsOn: series.endsOn ? toDateKey(series.endsOn) : null,
        },
        fromKey,
        addDaysToKey(nextMonthStart, -1),
        timeZone
      ).filter((occurrence) => occurrence.startsAt > now);
      // Fechas ya generadas: cuentan solo si la clase existe y no se canceló (las salteadas no se cobran).
      const sessions = await prisma.classSession.findMany({
        where: {
          seriesId: series.id,
          startsAt: { gt: now, lt: fromZonedTime(`${nextMonthStart}T00:00:00`, timeZone) },
          status: { in: [...ACTIVE_SESSION_STATUSES] },
        },
        select: { startsAt: true },
      });
      const sessionKeys = new Set(sessions.map((row) => this.localDateKey(row.startsAt, timeZone)));
      const classes = occurrences.filter((occurrence) =>
        generatedUntilKey && occurrence.date <= generatedUntilKey ? sessionKeys.has(occurrence.date) : true
      ).length;
      if (classes > 0) {
        return {
          month,
          monthLabel: new Date(`${monthStart}T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' }),
          classes,
          pricePerClass: price,
          total: Number((price * classes).toFixed(2)),
          // Igual que la cuota del mes: vence una semana después de fin de mes.
          expiresAt: fromZonedTime(`${addDaysToKey(nextMonthStart, 7)}T00:00:00`, timeZone).toISOString(),
        };
      }
      month = nextMonth;
    }
    return null;
  }

  /** Anotarse pagando: guarda el lugar, arma la cuota del mes y devuelve el link de Mercado Pago. */
  private async joinPaying(clubId: number, series: any, studentClientId: string, userId: number, studentName = 'Un jugador') {
    const existing = await prisma.classSeriesMember.findFirst({
      where: { seriesId: series.id, studentClientId, leftAt: null, status: 'AWAITING_PAYMENT' },
      select: { id: true },
    });

    // Si su plan ya le da todas las clases del mes, se anota sin pagar (si no, pagaría dos veces).
    if (!existing) {
      const timeZone = await this.resolveTimeZone(clubId);
      const quote = await this.signupQuote(series, timeZone);
      const credits = quote ? await this.planCreditsForMonth(series, studentClientId, quote.month, timeZone) : 0;
      if (quote && credits >= quote.classes) {
        const result = await this.addMember(clubId, series.id, userId, { studentClientId }, { fromAppUserId: userId });
        await this.notifyStaff(clubId, series.id, userId, 'JOINED', studentName);
        return { status: 'ACTIVE' as const, enrolled: result.enrolled, initPoint: null as string | null, coveredByPlan: true };
      }
    }

    const accessToken = await this.paymentIntegrationService.getMercadoPagoAccessTokenForClub(clubId);
    if (!accessToken) {
      throw conflict('Este club todavía no cobra online. Escribile al club para anotarte.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }

    if (existing) {
      const open = await prisma.onlinePaymentAttempt.findFirst({
        where: { classSeriesMemberId: existing.id, status: { in: ['CREATED', 'PENDING'] }, initPoint: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { initPoint: true },
      });
      if (open?.initPoint) return { status: 'AWAITING_PAYMENT' as const, enrolled: 0, initPoint: open.initPoint, coveredByPlan: false };
    }

    const spot = existing ? await this.loadPaidSpot(existing.id) : await this.reservePaidSpot(clubId, series, studentClientId, userId);
    try {
      const initPoint = await this.createSignupCheckout({
        clubId,
        series,
        memberId: spot.memberId,
        accountId: spot.accountId,
        amount: spot.amount,
        title: spot.title,
        userId,
        accessToken,
      });
      return { status: 'AWAITING_PAYMENT' as const, enrolled: 0, initPoint, coveredByPlan: false };
    } catch (error) {
      // Sin link de pago no tiene sentido guardar el lugar.
      await prisma.$transaction((tx) => this.releasePaidSpotTx(tx, spot.memberId));
      throw error;
    }
  }

  /** Guarda el lugar (sin anotar en las clases todavía) y crea la cuota del mes con su cuenta. */
  async reservePaidSpot(clubId: number, series: any, studentClientId: string, userId: number) {
    await this.assertRoomInSeries(series);
    const timeZone = await this.resolveTimeZone(clubId);
    const baseQuote = await this.signupQuote(series, timeZone);
    if (!baseQuote) throw conflict('Este curso no tiene clases para cobrar por ahora.', ErrorCodes.INVALID_INPUT);
    const quote = this.applyPlanCoverage(
      baseQuote,
      await this.planCreditsForMonth(series, studentClientId, baseQuote.month, timeZone)
    )!;
    if (quote.classes <= 0) throw conflict('Tu plan ya cubre este curso: anotate sin pagar.', ErrorCodes.INVALID_INPUT);
    const student = await prisma.client.findFirst({
      where: { id: studentClientId, clubId },
      select: { id: true, userId: true },
    });
    if (!student) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);

    const title = `${series.name || `Curso ${describeWeekdays(series.weekdays)} ${series.startTime}`} · ${quote.monthLabel}`;
    const created = await prisma.$transaction(async (tx) => {
      const member = await tx.classSeriesMember.create({
        data: {
          clubId,
          seriesId: series.id,
          studentClientId: student.id,
          createdByUserId: Number(userId),
          status: 'AWAITING_PAYMENT',
          requestedByUserId: Number(userId),
        },
        select: { id: true },
      });
      const pass = await tx.classPass.create({
        data: {
          clubId,
          ownerClientId: student.id,
          beneficiaryClientId: student.id,
          beneficiaryUserId: student.userId ?? null,
          packageName: title,
          priceAtPurchase: quote.total,
          totalCredits: quote.classes,
          usedCredits: 0,
          remainingCredits: quote.classes,
          expiresAt: new Date(quote.expiresAt),
          teacherId: series.teacherId,
          status: 'ACTIVE',
          seriesMemberId: member.id,
          coversMonth: quote.month,
          validFrom: fromZonedTime(`${quote.month}-01T00:00:00`, timeZone),
          createdByUserId: Number(userId),
        },
        select: { id: true },
      });
      return { memberId: member.id, passId: pass.id };
    });

    try {
      const opened = await this.accountService.openAccount({ clubId, sourceType: 'CLASS_PASS', sourceId: created.passId });
      // openAccount devuelve la cuenta antes de sumarle la cuota: el total se lee de nuevo.
      const account = await prisma.account.findUnique({ where: { id: opened.id }, select: { id: true, totalAmount: true } });
      const amount = Number(account?.totalAmount ?? 0);
      if (!(amount > 0)) throw conflict('No se pudo armar el cobro del curso.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
      return { memberId: created.memberId, accountId: opened.id, amount, title, quote };
    } catch (error) {
      await prisma.$transaction((tx) => this.releasePaidSpotTx(tx, created.memberId));
      throw error;
    }
  }

  private async loadPaidSpot(memberId: string) {
    const pass = await prisma.classPass.findFirst({
      where: { seriesMemberId: memberId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, clubId: true, packageName: true },
    });
    if (!pass) throw notFound('No encontramos tu lugar en el curso. Probá anotarte de nuevo.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    const opened = await this.accountService.openAccount({ clubId: pass.clubId, sourceType: 'CLASS_PASS', sourceId: pass.id });
    const account = (await prisma.account.findUnique({ where: { id: opened.id } })) ?? opened;
    const paid = await this.accountService.calculateNetPaidAmount(account.id);
    return {
      memberId,
      accountId: account.id,
      amount: Number(Math.max(0, Number(account.totalAmount) - paid).toFixed(2)),
      title: pass.packageName,
      quote: null,
    };
  }

  private async createSignupCheckout(input: {
    clubId: number;
    series: any;
    memberId: string;
    accountId: string;
    amount: number;
    title: string;
    userId: number;
    accessToken: string;
  }) {
    if (!(input.amount > 0)) throw conflict('Este curso no tiene nada para cobrar.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);
    const [club, user, integration] = await Promise.all([
      prisma.club.findUnique({ where: { id: input.clubId }, select: { name: true, slug: true } }),
      prisma.user.findUnique({ where: { id: input.userId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.clubPaymentIntegration.findUnique({
        where: { clubId_provider: { clubId: input.clubId, provider: 'MERCADO_PAGO' } },
        select: { id: true },
      }),
    ]);
    const attempt = await prisma.onlinePaymentAttempt.create({
      data: {
        clubId: input.clubId,
        bookingId: null,
        classSeriesMemberId: input.memberId,
        accountId: input.accountId,
        userId: input.userId,
        integrationId: integration?.id ?? null,
        provider: 'MERCADO_PAGO',
        status: 'CREATED',
        amount: input.amount,
        currency: 'ARS',
        idempotencyKey: `course:${input.memberId}:${input.amount.toFixed(2)}:${generateDisplayCode('K')}`,
        externalReference: `course-checkout:${input.memberId}:attempt:${generateDisplayCode('CHK')}`,
      },
    });

    const publicBase = mercadoPagoConfig.frontendUrl || 'http://localhost:3001';
    const backendBase = mercadoPagoConfig.appBaseUrl || 'http://localhost:3000';
    const returnUrl = (checkoutStatus: 'success' | 'pending' | 'failure') => {
      const url = new URL(`/club/${club?.slug || ''}`, publicBase);
      url.searchParams.set('curso', input.series.id);
      url.searchParams.set('checkoutStatus', checkoutStatus);
      return url.toString();
    };
    const webhookUrl = new URL('/api/webhooks/mercadopago', backendBase);
    webhookUrl.searchParams.set('clubId', String(input.clubId));
    webhookUrl.searchParams.set('attemptId', attempt.id);

    try {
      const preference = await this.mercadoPagoService.createPreference({
        accessToken: input.accessToken,
        title: `${input.title} - ${club?.name || 'Club'}`,
        description: `${input.title} · ${club?.name || ''}`.trim(),
        quantity: 1,
        unitPrice: input.amount,
        payer: user?.email
          ? { name: user.firstName || 'Jugador', surname: user.lastName || undefined, email: user.email }
          : undefined,
        externalReference: attempt.id,
        notificationUrl: webhookUrl.toString(),
        successUrl: returnUrl('success'),
        pendingUrl: returnUrl('pending'),
        failureUrl: returnUrl('failure'),
        metadata: { attemptId: attempt.id, classSeriesMemberId: input.memberId, accountId: input.accountId, clubId: input.clubId },
      });
      const initPoint = String(preference.init_point || preference.sandbox_init_point || '').trim();
      if (!initPoint) throw conflict('Mercado Pago no devolvió el link de pago.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
      await prisma.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'PENDING',
          providerPreferenceId: String(preference.id || '').trim() || null,
          initPoint,
          rawProviderData: preference as Prisma.InputJsonValue,
        },
      });
      await prisma.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.userId,
          entity: 'ONLINE_PAYMENT_ATTEMPT',
          entityId: attempt.id,
          action: 'CHECKOUT_ATTEMPT_CREATED',
          payload: { provider: 'MERCADO_PAGO', classSeriesMemberId: input.memberId, amount: input.amount },
        },
      });
      return initPoint;
    } catch (error) {
      await prisma.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'ERROR', failureReason: 'PREFERENCE_FAILED' },
      });
      throw error;
    }
  }

  /** Pago aprobado (desde el webhook, en su transacción): queda anotado en las clases que vienen. */
  async confirmPaidSpotTx(tx: Tx, memberId: string) {
    const member = await tx.classSeriesMember.findUnique({ where: { id: memberId }, include: { series: true } });
    if (!member || (member.status === 'ACTIVE' && !member.leftAt)) return false;
    const updated = await tx.classSeriesMember.update({
      where: { id: member.id },
      data: { status: 'ACTIVE', leftAt: null, joinedAt: new Date() },
      include: { studentClient: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
    });
    await this.enrollMemberInFutureTx(tx, member.series, updated);
    return true;
  }

  /** Aviso al club después de que se confirmó el pago. */
  async notifyPaidSpotConfirmed(memberId: string) {
    const member = await prisma.classSeriesMember.findUnique({
      where: { id: memberId },
      select: { clubId: true, seriesId: true, requestedByUserId: true, studentClient: { select: { name: true } } },
    });
    if (!member) return;
    await this.notifyStaff(member.clubId, member.seriesId, Number(member.requestedByUserId || 0), 'PAID', member.studentClient?.name || 'Un jugador');
  }

  /** Suelta el lugar de alguien que no pagó: anula la cuota y los intentos de pago abiertos. */
  async releasePaidSpotTx(tx: Tx, memberId: string) {
    await tx.classSeriesMember.updateMany({ where: { id: memberId, leftAt: null }, data: { leftAt: new Date() } });
    const passes = await tx.classPass.findMany({
      where: { seriesMemberId: memberId, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    for (const pass of passes) {
      await this.accountService.cancelItemsForSourceTx(tx, { sourceType: 'CLASS_PASS', sourceId: pass.id });
      await tx.classPass.update({ where: { id: pass.id }, data: { status: 'CANCELLED' } });
    }
    await tx.onlinePaymentAttempt.updateMany({
      where: { classSeriesMemberId: memberId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'CANCELLED', failureReason: 'COURSE_SPOT_RELEASED' },
    });
  }

  /** Libera los lugares guardados que no se pagaron a tiempo. Lo corre el scheduler. */
  async releaseExpiredPaidSpots() {
    const cutoff = new Date(Date.now() - PAID_SPOT_HOLD_MS);
    const rows = await prisma.classSeriesMember.findMany({
      where: { status: 'AWAITING_PAYMENT', leftAt: null, createdAt: { lt: cutoff } },
      select: { id: true },
      take: 200,
    });
    let released = 0;
    for (const row of rows) {
      const attempts = await prisma.onlinePaymentAttempt.findMany({
        where: { classSeriesMemberId: row.id },
        select: { status: true, createdAt: true, providerPaymentId: true },
      });
      if (attempts.some((attempt) => attempt.status === 'APPROVED')) continue;
      // Un pago en curso (Mercado Pago ya lo registró) o un link recién pedido: se espera.
      const inFlight = attempts.some(
        (attempt) =>
          (attempt.status === 'PENDING' || attempt.status === 'CREATED') &&
          (attempt.providerPaymentId || attempt.createdAt > cutoff)
      );
      if (inFlight) continue;
      try {
        await prisma.$transaction((tx) => this.releasePaidSpotTx(tx, row.id));
        released += 1;
      } catch (error) {
        console.error('[academia] No se pudo liberar un lugar sin pagar', { memberId: row.id, error });
      }
    }
    return { released };
  }

  /** Clases de plan que le quedan al alumno para este curso en el mes (YYYY-MM). */
  private async planCreditsForMonth(
    series: { clubId: number; activityTypeId: number | null; classType: string; teacherId: string },
    studentClientId: string,
    month: string,
    timeZone: string
  ) {
    const [year, monthNumber] = month.split('-').map(Number);
    const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
    const rows = await this.planPassesForMonth(series.clubId, series, studentClientId, {
      gte: fromZonedTime(`${month}-01T00:00:00`, timeZone),
      lt: fromZonedTime(`${next}-01T00:00:00`, timeZone),
    });
    return rows.reduce((sum, row) => sum + Number(row.remainingCredits || 0), 0);
  }

  /** Descuenta de la cotización las clases que ya le da el plan: paga solo el resto. */
  private applyPlanCoverage(quote: Awaited<ReturnType<ClassSeriesAdminService['signupQuote']>>, planCredits: number) {
    if (!quote) return null;
    const coveredByPlan = Math.min(quote.classes, Math.max(0, planCredits));
    const classes = quote.classes - coveredByPlan;
    return { ...quote, coveredByPlan, classes, total: Number((quote.pricePerClass * classes).toFixed(2)) };
  }

  /** Packs de planes (clases incluidas) que le sirven al alumno para este curso en ese mes. */
  private async planPassesForMonth(
    clubId: number,
    series: { activityTypeId: number | null; classType: string; teacherId: string },
    studentClientId: string,
    monthRange: { gte: Date; lt: Date }
  ) {
    const rows = await prisma.classPass.findMany({
      where: {
        clubId,
        beneficiaryClientId: studentClientId,
        status: 'ACTIVE',
        subscriptionId: { not: null },
        subscription: { status: 'ACTIVE' },
        remainingCredits: { gt: 0 },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lt: monthRange.lt } }] },
          // Los packs de plan vencen 8 días después de su período: la semana de gracia no cuenta como cobertura del mes.
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(Math.max(monthRange.gte.getTime() + 8 * 86_400_000, Date.now())) } }] },
          { OR: [{ activityTypeId: null }, ...(series.activityTypeId ? [{ activityTypeId: series.activityTypeId }] : [])] },
          { OR: [{ classType: null }, { classType: series.classType as any }] },
          { OR: [{ teacherId: null }, { teacherId: series.teacherId }] },
        ],
      },
      orderBy: [{ validFrom: 'asc' }],
      select: { id: true, packageName: true, remainingCredits: true },
    });
    return rows.map((row) => ({ classPassId: row.id, packageName: row.packageName, remainingCredits: row.remainingCredits }));
  }

  /** Cursos del jugador en todos sus clubes, con las próximas clases. */
  async listMine(userId: number) {
    const members = await prisma.classSeriesMember.findMany({
      where: {
        leftAt: null,
        status: { in: ['ACTIVE', 'PENDING', 'AWAITING_PAYMENT'] },
        studentClient: { userId: Number(userId) },
        series: { status: 'ACTIVE' },
      },
      include: {
        series: {
          select: {
            id: true,
            weekdays: true,
            startTime: true,
            durationMinutes: true,
            name: true,
            level: true,
            visibility: true,
            activityType: { select: { name: true } },
            teacher: { select: { displayName: true } },
            court: { select: { name: true } },
            club: { select: { name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    const upcoming = members.length
      ? await prisma.classEnrollment.findMany({
          where: {
            seriesMemberId: { in: members.map((member) => member.id) },
            enrollmentStatus: 'ENROLLED',
            classSession: { startsAt: { gt: now }, status: { not: 'CANCELLED' } },
          },
          select: { seriesMemberId: true, classSession: { select: { id: true, startsAt: true } } },
          orderBy: { classSession: { startsAt: 'asc' } },
        })
      : [];
    const nextByMember = new Map<string, string[]>();
    for (const row of upcoming) {
      const key = String(row.seriesMemberId);
      const list = nextByMember.get(key) || [];
      if (list.length < 3) list.push(row.classSession.startsAt.toISOString());
      nextByMember.set(key, list);
    }
    return members.map((member) => ({
      id: member.series.id,
      status: member.status as 'ACTIVE' | 'PENDING' | 'AWAITING_PAYMENT',
      clubName: member.series.club?.name || '',
      clubSlug: member.series.club?.slug || '',
      name: member.series.name ?? null,
      activity: member.series.activityType?.name ?? null,
      teacher: member.series.teacher?.displayName ?? null,
      court: member.series.court?.name ?? null,
      weekdaysLabel: describeWeekdays(member.series.weekdays),
      startTime: member.series.startTime,
      durationMinutes: member.series.durationMinutes,
      level: member.series.level,
      // Solo se puede bajar solo de los cursos que el club publica en la app; los otros los maneja el club.
      canLeave: member.series.visibility === 'PUBLIC',
      nextClasses: nextByMember.get(member.id) || [],
    }));
  }

  /** Saca al alumno del curso: deja de estar en las clases que vienen (las pasadas quedan). */
  async removeMember(clubId: number, seriesId: string, memberId: string) {
    const member = await prisma.classSeriesMember.findFirst({
      where: { id: String(memberId), seriesId: String(seriesId), clubId, leftAt: null },
      select: { id: true, status: true },
    });
    if (!member) throw notFound('Ese alumno no está en el curso.', ErrorCodes.CLASS_SESSION_NOT_FOUND);

    const kept = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.classSeriesMember.update({ where: { id: member.id }, data: { leftAt: now } });
      if (member.status === 'PENDING') return 0;
      if (member.status === 'AWAITING_PAYMENT') {
        await this.releasePaidSpotTx(tx, member.id);
        return 0;
      }
      const future = await tx.classEnrollment.findMany({
        where: { seriesMemberId: member.id, enrollmentStatus: { not: 'CANCELLED' }, classSession: { startsAt: { gt: now } } },
        select: { id: true, attendanceStatus: true, paymentStatus: true, paidAmount: true, _count: { select: { creditUsages: true } } },
      });
      const free = future.filter(
        (row) => row.attendanceStatus === 'PENDING' && row.paymentStatus === 'UNPAID' && Number(row.paidAmount) === 0 && row._count.creditUsages === 0
      );
      if (free.length) {
        await tx.classEnrollment.updateMany({
          where: { id: { in: free.map((row) => row.id) } },
          data: { enrollmentStatus: 'CANCELLED', attendanceStatus: 'CANCELLED_ON_TIME', cancelledAt: now },
        });
      }
      return future.length - free.length;
    });

    return { series: await this.getById(clubId, String(seriesId)), kept };
  }

  /**
   * Cuota del mes de un alumno del curso.
   *
   * Se cobra como un pack con las clases del curso en ese mes: al marcar presente se usa
   * una clase sola. Las clases de ese mes que ya estaban pagadas o cubiertas no se cuentan,
   * y las que ya tienen presente se cubren apenas se crea.
   * Con preview: true solo calcula, sin crear nada.
   */
  async monthPass(
    clubId: number,
    seriesId: string,
    memberId: string,
    actorUserId: number,
    input: { month: string; preview?: boolean }
  ) {
    const month = String(input.month || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fieldError('Elegí el mes.', 'month');

    const series = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId } });
    if (!series) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    const member = await prisma.classSeriesMember.findFirst({
      where: { id: String(memberId), seriesId: series.id, clubId },
      include: { studentClient: { select: { id: true, name: true, userId: true } } },
    });
    if (!member) throw notFound('Ese alumno no está en el curso.', ErrorCodes.CLASS_SESSION_NOT_FOUND);

    const timeZone = await this.resolveTimeZone(clubId);
    const monthStart = `${month}-01`;
    const [year, monthNumber] = month.split('-').map(Number);
    const nextMonthStart = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
    const monthEnd = addDaysToKey(nextMonthStart, -1);
    const monthLabel = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' });

    // Vence una semana después de fin de mes, para poder marcar presente tarde.
    const expiresAt = fromZonedTime(`${addDaysToKey(nextMonthStart, 7)}T00:00:00`, timeZone);
    if (expiresAt.getTime() <= Date.now()) throw fieldError('Ese mes ya pasó.', 'month');

    const joinedKey = this.localDateKey(member.joinedAt, timeZone);
    const leftKey = member.leftAt ? this.localDateKey(member.leftAt, timeZone) : null;
    const fromKey = joinedKey > monthStart ? joinedKey : monthStart;
    const toKey = leftKey && leftKey < monthEnd ? leftKey : monthEnd;
    const occurrences =
      fromKey <= toKey
        ? this.occurrences(
            {
              weekdays: series.weekdays,
              startTime: series.startTime,
              durationMinutes: series.durationMinutes,
              startsOn: toDateKey(series.startsOn),
              endsOn: series.endsOn ? toDateKey(series.endsOn) : null,
            },
            fromKey,
            toKey,
            timeZone
          )
        : [];

    const monthRange = {
      gte: fromZonedTime(`${monthStart}T00:00:00`, timeZone),
      lt: fromZonedTime(`${nextMonthStart}T00:00:00`, timeZone),
    };
    const enrollments = await prisma.classEnrollment.findMany({
      where: { seriesMemberId: member.id, classSession: { startsAt: monthRange } },
      select: {
        id: true,
        enrollmentStatus: true,
        attendanceStatus: true,
        paymentStatus: true,
        classSession: { select: { status: true, startsAt: true } },
      },
    });
    // Fechas ya generadas: se cobra la clase solo si el alumno la tiene activa y sin pagar
    // (no se cobran fechas salteadas, canceladas ni ya pagadas). Fechas que todavía no se
    // generaron: se cuentan según los días del curso.
    const generatedUntilKey = series.generatedUntil ? toDateKey(series.generatedUntil) : null;
    const chargeableByDate = new Map<string, boolean>();
    for (const row of enrollments) {
      const key = this.localDateKey(row.classSession.startsAt, timeZone);
      const chargeable =
        row.enrollmentStatus === 'ENROLLED' && row.paymentStatus === 'UNPAID' && row.classSession.status !== 'CANCELLED';
      chargeableByDate.set(key, Boolean(chargeableByDate.get(key)) || chargeable);
    }
    const settled = enrollments.filter((row) => row.paymentStatus !== 'UNPAID').length;
    const classes = occurrences.filter((occurrence) =>
      generatedUntilKey && occurrence.date <= generatedUntilKey
        ? Boolean(chargeableByDate.get(occurrence.date))
        : true
    ).length;
    const pricePerClass = series.pricePerStudent == null ? null : Number(series.pricePerStudent);
    const total = pricePerClass == null ? null : Number((pricePerClass * classes).toFixed(2));

    const existing = await prisma.classPass.findFirst({
      where: { clubId, seriesMemberId: member.id, coversMonth: month, status: { not: 'CANCELLED' } },
      select: { id: true },
    });

    const summary = {
      month,
      monthLabel,
      classes,
      settled,
      pricePerClass,
      total,
      expiresAt: expiresAt.toISOString(),
      existingPassId: existing?.id ?? null,
      // Clases que ya le da un plan del club ese mes (se usan solas al marcar presente).
      coveredByPlan: await this.planPassesForMonth(clubId, series, member.studentClient.id, monthRange),
    };
    if (input.preview) return { ...summary, pass: null, applied: 0 };

    if (existing) throw conflict(`Ya cobraste ${monthLabel} a ${member.studentClient.name}.`, ErrorCodes.INVALID_INPUT);
    if (classes <= 0) throw fieldError(`No tiene clases para cobrar en ${monthLabel}.`, 'month');
    await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const created = await prisma.classPass.create({
      data: {
        clubId,
        ownerClientId: member.billingResponsibleClientId ?? member.studentClient.id,
        beneficiaryClientId: member.studentClient.id,
        beneficiaryUserId: member.studentClient.userId ?? null,
        packageName: `Curso ${describeWeekdays(series.weekdays)} ${series.startTime} · ${monthLabel}`,
        priceAtPurchase: total && total > 0 ? total : null,
        totalCredits: classes,
        usedCredits: 0,
        remainingCredits: classes,
        expiresAt,
        teacherId: series.teacherId,
        status: 'ACTIVE',
        seriesMemberId: member.id,
        coversMonth: month,
        validFrom: monthRange.gte,
        createdByUserId: Number(actorUserId),
      },
      select: { id: true },
    });

    // Clases de ese mes que ya tienen presente y siguen sin pagar: se cubren ya.
    const attendedUnpaid = enrollments.filter(
      (row) => row.attendanceStatus === 'ATTENDED' && row.paymentStatus === 'UNPAID' && row.enrollmentStatus === 'ENROLLED'
    );
    let applied = 0;
    for (const row of attendedUnpaid) {
      try {
        await this.creditUsageService.create(clubId, created.id, actorUserId, {
          classEnrollmentId: row.id,
          creditsUsed: 1,
          reason: 'ATTENDANCE',
        });
        applied += 1;
      } catch {
        // La clase tiene una cuenta con movimientos: queda para revisar a mano.
      }
    }

    return { ...summary, pass: await this.classPassService.getById(clubId, created.id), applied };
  }

  /** Job del scheduler: mantiene generadas las próximas semanas de todos los cursos activos. */
  async extendAll() {
    const rows = await prisma.classSeries.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, clubId: true, createdByUserId: true },
    });
    let created = 0;
    for (const row of rows) {
      const timeZone = await this.resolveTimeZone(row.clubId);
      const result = await prisma.$transaction((tx) => this.generateTx(tx, row.id, row.createdByUserId, timeZone), { timeout: 30000 });
      created += result.created;
    }
    return { series: rows.length, created };
  }
}
