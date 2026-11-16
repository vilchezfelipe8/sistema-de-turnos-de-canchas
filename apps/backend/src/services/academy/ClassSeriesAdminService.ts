import { Prisma } from '@prisma/client';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { AppError, ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString, parseMoneyOrThrow } from './academyAdminUtils';

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
  level?: string | null;
  description?: string | null;
  startsOn: string;
  endsOn?: string | null;
};

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

    return {
      teacherId,
      activityTypeId: input.activityTypeId ? Number(input.activityTypeId) : null,
      courtId: input.courtId ? Number(input.courtId) : null,
      classType: (capacity === 1 ? 'INDIVIDUAL' : 'GROUP') as 'INDIVIDUAL' | 'GROUP',
      weekdays: weekdays.sort((a, b) => a - b),
      startTime,
      durationMinutes,
      capacity,
      pricePerStudent: parseMoneyOrThrow(input.pricePerStudent, 'Precio por alumno'),
      level: normalizeOptionalString(input.level),
      description: normalizeOptionalString(input.description),
      startsOn,
      endsOn,
    };
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
          where: { leftAt: null },
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
          }))
        : undefined,
      activeMembersCount: row._count?.members ?? undefined,
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
      include: { ...this.seriesInclude, _count: { select: { members: { where: { leftAt: null } } } } },
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
          where: { leftAt: null },
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

  /** Anota al alumno al curso: queda en todas las clases que vienen con lugar. */
  async addMember(
    clubId: number,
    seriesId: string,
    actorUserId: number,
    input: { studentClientId: string; billingResponsibleClientId?: string | null; notes?: string | null }
  ) {
    const series = await prisma.classSeries.findFirst({ where: { id: String(seriesId), clubId } });
    if (!series) throw notFound('Curso no encontrado.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (series.status !== 'ACTIVE') throw badRequest('El curso ya terminó.', ErrorCodes.INVALID_INPUT);

    const student = await this.validation.assertClientBelongsToClub(clubId, String(input.studentClientId || ''));
    const responsible = input.billingResponsibleClientId
      ? await this.validation.assertClientBelongsToClub(clubId, String(input.billingResponsibleClientId))
      : null;
    await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const already = await prisma.classSeriesMember.findFirst({
      where: { seriesId: series.id, studentClientId: student.id, leftAt: null },
      select: { id: true },
    });
    if (already) throw conflict(`${student.name} ya está en el curso.`, ErrorCodes.CLASS_SESSION_ENROLLMENT_CONFLICT);

    const activeMembers = await prisma.classSeriesMember.count({ where: { seriesId: series.id, leftAt: null } });
    if (activeMembers >= series.capacity) {
      throw conflict('El curso está completo.', ErrorCodes.CLASS_SESSION_CAPACITY_EXCEEDED);
    }

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
          },
          include: { studentClient: { select: { id: true, name: true, email: true, phone: true, userId: true } } },
        });

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
          if (session.enrollments.some((row) => row.studentClientId === student.id)) continue;
          const taken = session.enrollments.filter((row) => row.enrollmentStatus === 'ENROLLED').length;
          if (taken >= session.capacity) {
            full.push(session.startsAt.toISOString());
            continue;
          }
          await tx.classEnrollment.create({ data: this.enrollmentDataForMember(series, member, session.id) });
          enrolled += 1;
        }
        return { memberId: member.id, enrolled, full };
      },
      { timeout: 30000 }
    );

    return { series: await this.getById(clubId, series.id), ...result };
  }

  /** Saca al alumno del curso: deja de estar en las clases que vienen (las pasadas quedan). */
  async removeMember(clubId: number, seriesId: string, memberId: string) {
    const member = await prisma.classSeriesMember.findFirst({
      where: { id: String(memberId), seriesId: String(seriesId), clubId, leftAt: null },
      select: { id: true },
    });
    if (!member) throw notFound('Ese alumno no está en el curso.', ErrorCodes.CLASS_SESSION_NOT_FOUND);

    const kept = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.classSeriesMember.update({ where: { id: member.id }, data: { leftAt: now } });
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
