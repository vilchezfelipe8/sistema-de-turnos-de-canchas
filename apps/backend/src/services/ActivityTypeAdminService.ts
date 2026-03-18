import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
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
  private assertScheduleExceptionsSupport() {
    const prismaAny = prisma as any;
    if (prismaAny?.activityScheduleException) return;
    throw new Error('La versión actual de Prisma Client no soporta excepciones de agenda. Ejecutá "npx prisma generate" en apps/backend y reiniciá el backend.');
  }

  private parseLocalDate(value: string) {
    const normalized = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new Error('localDate debe tener formato YYYY-MM-DD');
    }

    return {
      key: normalized,
      dbDate: new Date(`${normalized}T00:00:00.000Z`)
    };
  }

  private async ensureActivityOwnership(clubId: number, activityTypeId: number) {
    const activity = await prisma.activityType.findUnique({ where: { id: activityTypeId } });
    if (!activity) {
      throw new Error('Actividad no encontrada');
    }
    if (Number(activity.clubId) !== clubId) {
      throw new Error('La actividad no pertenece a este club');
    }

    return activity;
  }

  private mapExceptionRow(row: any) {
    return {
      id: row.id,
      activityTypeId: row.activityTypeId,
      localDate: row.localDate instanceof Date ? row.localDate.toISOString().slice(0, 10) : String(row.localDate),
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
      throw new Error('scheduleMode es obligatorio cuando la excepción no está cerrada');
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
