import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, forbidden, notFound } from '../errors';
import { assertValidScheduleMode, normalizeSchedule } from '../utils/ActivityScheduleHelper';

type UpdateScheduleInput = {
  scheduleMode: 'FIXED' | 'RANGE';
  scheduleOpenTime?: string | null;
  scheduleCloseTime?: string | null;
  scheduleIntervalMinutes?: number | null;
  scheduleWindows?: Array<{ start: string; end: string }> | null;
  scheduleDurations?: Array<number | string>;
  scheduleFixedSlots?: Array<{ start: string; duration: number | string }>;
};

type UpsertScheduleExceptionInput = {
  localDate: string;
  isClosed?: boolean;
  scheduleMode?: 'FIXED' | 'RANGE';
  scheduleOpenTime?: string | null;
  scheduleCloseTime?: string | null;
  scheduleIntervalMinutes?: number | null;
  scheduleWindows?: Array<{ start: string; end: string }> | null;
  scheduleDurations?: Array<number | string>;
  scheduleFixedSlots?: Array<{ start: string; duration: number | string }>;
};

export class ActivityTypeAdminService {
  private static readonly DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

  private formatDateOnlyUtc(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  private getDateKeyInTimeZone(timeZone: string, date = new Date()): string {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      // noop: fallback UTC
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async getClubTodayDateKey(clubId: number): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { settings: { select: { timeZone: true } } }
    });
    const timeZone = String(club?.settings?.timeZone || ActivityTypeAdminService.DEFAULT_TIME_ZONE).trim() || ActivityTypeAdminService.DEFAULT_TIME_ZONE;
    return this.getDateKeyInTimeZone(timeZone);
  }

  private assertScheduleExceptionsSupport() {
    const prismaAny = prisma as any;
    if (prismaAny?.activityScheduleException) return;
    throw badRequest('La versión actual de Prisma Client no soporta excepciones de agenda. Ejecutá "npx prisma generate" en apps/backend y reiniciá el backend.', ErrorCodes.CLUB_CONFIG_INVALID);
  }

  private parseLocalDate(value: string) {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw badRequest('localDate debe tener formato YYYY-MM-DD', ErrorCodes.INVALID_INPUT);
    }

    return {
      key: normalized,
      dbDate: new Date(`${normalized}T00:00:00.000Z`)
    };
  }

  private async ensureActivityOwnership(clubId: number, activityTypeId: number) {
    const activity = await prisma.activityType.findUnique({ where: { id: activityTypeId } });
    if (!activity) {
      throw notFound('Actividad no encontrada', ErrorCodes.ACTIVITY_NOT_FOUND);
    }
    if (Number(activity.clubId) !== clubId) {
      throw forbidden('La actividad no pertenece a este club', ErrorCodes.ACTIVITY_OUT_OF_CLUB);
    }

    return activity;
  }

  private mapExceptionRow(row: any) {
    return {
      id: row.id,
      activityTypeId: row.activityTypeId,
      localDate: this.formatDateOnlyUtc(row.localDate) ?? String(row.localDate),
      isClosed: Boolean(row.isClosed),
      scheduleMode: row.scheduleMode ?? null,
      scheduleOpenTime: row.scheduleOpenTime ?? null,
      scheduleCloseTime: row.scheduleCloseTime ?? null,
      scheduleIntervalMinutes: row.scheduleIntervalMinutes ?? null,
      scheduleWindows: Array.isArray(row.scheduleWindows) ? row.scheduleWindows : null,
      scheduleDurations: Array.isArray(row.scheduleDurations) ? row.scheduleDurations : null,
      scheduleFixedSlots: Array.isArray(row.scheduleFixedSlots) ? row.scheduleFixedSlots : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async listByClub(clubId: number) {
    return prisma.activityType.findMany({
      where: { clubId },
      orderBy: { name: 'asc' }
    });
  }

  async updateSchedule(clubId: number, activityTypeId: number, input: UpdateScheduleInput) {
    const activity = await this.ensureActivityOwnership(clubId, activityTypeId);

    const fallbackDuration = Number(activity.defaultDurationMinutes) > 0 ? Number(activity.defaultDurationMinutes) : 60;

    const normalized = normalizeSchedule(
      {
        scheduleMode: input.scheduleMode,
        scheduleOpenTime: input.scheduleOpenTime ?? null,
        scheduleCloseTime: input.scheduleCloseTime ?? null,
        scheduleIntervalMinutes: input.scheduleIntervalMinutes ?? null,
        scheduleWindows: input.scheduleWindows ?? null,
        scheduleDurations: input.scheduleDurations,
        scheduleFixedSlots: input.scheduleFixedSlots
      },
      fallbackDuration
    );

    assertValidScheduleMode(normalized);

    const updateData: any = {
      scheduleMode: normalized.mode,
      scheduleOpenTime: normalized.openTime,
      scheduleCloseTime: normalized.closeTime,
      scheduleIntervalMinutes: normalized.intervalMinutes,
      scheduleWindows: normalized.rangeWindows as unknown as Prisma.InputJsonValue,
      scheduleDurations: normalized.durations as unknown as Prisma.InputJsonValue,
      scheduleFixedSlots: normalized.fixedSlots as unknown as Prisma.InputJsonValue
    };

    return prisma.activityType.update({
      where: { id: activity.id },
      data: updateData
    });
  }

  async listScheduleExceptions(clubId: number, activityTypeId: number, fromDate?: string, toDate?: string) {
    await this.ensureActivityOwnership(clubId, activityTypeId);
    this.assertScheduleExceptionsSupport();

    const from = fromDate ? this.parseLocalDate(fromDate).dbDate : null;
    const to = toDate ? this.parseLocalDate(toDate).dbDate : null;

    const prismaAny = prisma as any;
    const rows = await prismaAny.activityScheduleException.findMany({
      where: {
        activityTypeId,
        ...(from || to
          ? {
              localDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      },
      orderBy: { localDate: 'asc' }
    });

    return rows.map((row: any) => this.mapExceptionRow(row));
  }

  async upsertScheduleException(clubId: number, activityTypeId: number, input: UpsertScheduleExceptionInput) {
    const activity = await this.ensureActivityOwnership(clubId, activityTypeId);
    this.assertScheduleExceptionsSupport();
    const { key, dbDate } = this.parseLocalDate(input.localDate);
    const todayDateKey = await this.getClubTodayDateKey(clubId);
    if (key < todayDateKey) {
      throw badRequest(`localDate no puede ser una fecha pasada (mínimo permitido: ${todayDateKey})`, ErrorCodes.INVALID_INPUT);
    }
    const isClosed = Boolean(input.isClosed);

    const prismaAny = prisma as any;
    if (isClosed) {
      const row = await prismaAny.activityScheduleException.upsert({
        where: {
          activityTypeId_localDate: {
            activityTypeId,
            localDate: dbDate
          }
        },
        update: {
          isClosed: true,
          scheduleMode: null,
          scheduleOpenTime: null,
          scheduleCloseTime: null,
          scheduleIntervalMinutes: null,
          scheduleWindows: null,
          scheduleDurations: null,
          scheduleFixedSlots: null
        },
        create: {
          activityTypeId,
          localDate: dbDate,
          isClosed: true
        }
      });

      return this.mapExceptionRow(row);
    }

    if (!input.scheduleMode) {
      throw badRequest('scheduleMode es obligatorio cuando la excepción no está cerrada', ErrorCodes.INVALID_INPUT);
    }

    const fallbackDuration = Number(activity.defaultDurationMinutes) > 0 ? Number(activity.defaultDurationMinutes) : 60;
    const normalized = normalizeSchedule(
      {
        scheduleMode: input.scheduleMode,
        scheduleOpenTime: input.scheduleOpenTime ?? null,
        scheduleCloseTime: input.scheduleCloseTime ?? null,
        scheduleIntervalMinutes: input.scheduleIntervalMinutes ?? null,
        scheduleWindows: input.scheduleWindows ?? null,
        scheduleDurations: input.scheduleDurations,
        scheduleFixedSlots: input.scheduleFixedSlots
      },
      fallbackDuration
    );

    assertValidScheduleMode(normalized);

    const row = await prismaAny.activityScheduleException.upsert({
      where: {
        activityTypeId_localDate: {
          activityTypeId,
          localDate: dbDate
        }
      },
      update: {
        isClosed: false,
        scheduleMode: normalized.mode,
        scheduleOpenTime: normalized.openTime,
        scheduleCloseTime: normalized.closeTime,
        scheduleIntervalMinutes: normalized.intervalMinutes,
        scheduleWindows: normalized.rangeWindows,
        scheduleDurations: normalized.durations,
        scheduleFixedSlots: normalized.fixedSlots
      },
      create: {
        activityTypeId,
        localDate: dbDate,
        isClosed: false,
        scheduleMode: normalized.mode,
        scheduleOpenTime: normalized.openTime,
        scheduleCloseTime: normalized.closeTime,
        scheduleIntervalMinutes: normalized.intervalMinutes,
        scheduleWindows: normalized.rangeWindows,
        scheduleDurations: normalized.durations,
        scheduleFixedSlots: normalized.fixedSlots
      }
    });

    return {
      ...this.mapExceptionRow(row),
      localDate: key
    };
  }

  async deleteScheduleException(clubId: number, activityTypeId: number, localDate: string) {
    await this.ensureActivityOwnership(clubId, activityTypeId);
    this.assertScheduleExceptionsSupport();
    const { dbDate } = this.parseLocalDate(localDate);

    const prismaAny = prisma as any;
    const deleted = await prismaAny.activityScheduleException.deleteMany({
      where: {
        activityTypeId,
        localDate: dbDate
      }
    });

    return { deleted: Number(deleted?.count || 0) > 0 };
  }
}
