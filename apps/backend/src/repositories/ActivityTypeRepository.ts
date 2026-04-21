import { prisma } from '../prisma';
import { ActivityType } from '../entities/ActivityType';
import { assertValidScheduleMode, normalizeSchedule } from '../utils/ActivityScheduleHelper';

export class ActivityTypeRepository {
    
    async save(activity: ActivityType): Promise<ActivityType> {
        const normalized = normalizeSchedule(
            {
                scheduleMode: activity.scheduleMode,
                scheduleOpenTime: activity.scheduleOpenTime,
                scheduleCloseTime: activity.scheduleCloseTime,
                scheduleIntervalMinutes: activity.scheduleIntervalMinutes,
                scheduleWindows: activity.scheduleWindows,
                scheduleDurations: activity.scheduleDurations,
                scheduleFixedSlots: activity.scheduleFixedSlots
            },
            activity.defaultDurationMinutes
        );
        assertValidScheduleMode(normalized);

        const scheduleUpdateData: any = {
            ...(activity.clubId ? { clubId: activity.clubId } : {}),
            scheduleMode: normalized.mode,
            scheduleOpenTime: normalized.openTime,
            scheduleCloseTime: normalized.closeTime,
            scheduleIntervalMinutes: normalized.intervalMinutes,
            scheduleWindows: normalized.rangeWindows as any,
            scheduleDurations: normalized.durations as any,
            scheduleFixedSlots: normalized.fixedSlots as any
        };

        const scheduleCreateData: any = {
            name: activity.name,
            description: activity.description,
            defaultDurationMinutes: activity.defaultDurationMinutes,
            clubId: Number(activity.clubId),
            scheduleMode: normalized.mode,
            scheduleOpenTime: normalized.openTime,
            scheduleCloseTime: normalized.closeTime,
            scheduleIntervalMinutes: normalized.intervalMinutes,
            scheduleWindows: normalized.rangeWindows as any,
            scheduleDurations: normalized.durations as any,
            scheduleFixedSlots: normalized.fixedSlots as any
        };

        const saved = await prisma.activityType.upsert({
            where: { id: activity.id === 0 ? -1 : activity.id },
            update: scheduleUpdateData,
            create: scheduleCreateData
        });

        return new ActivityType(
            saved.id,
            saved.name,
            saved.description,
            saved.defaultDurationMinutes,
            saved.clubId,
            saved.scheduleMode as 'FIXED' | 'RANGE',
            saved.scheduleOpenTime,
            saved.scheduleCloseTime,
            saved.scheduleIntervalMinutes,
            (Array.isArray((saved as any).scheduleWindows) ? (saved as any).scheduleWindows : null) as Array<{ start: string; end: string }> | null,
            (Array.isArray(saved.scheduleDurations) ? saved.scheduleDurations : null) as number[] | null,
            (Array.isArray(saved.scheduleFixedSlots) ? saved.scheduleFixedSlots : null) as Array<{ start: string; duration: number }> | null
        );
    }

    async findById(id: number): Promise<ActivityType | undefined> {
        const found = await prisma.activityType.findUnique({ where: { id } });
        if (!found) return undefined;
        return new ActivityType(
            found.id,
            found.name,
            found.description,
            found.defaultDurationMinutes,
            found.clubId,
            found.scheduleMode as 'FIXED' | 'RANGE',
            found.scheduleOpenTime,
            found.scheduleCloseTime,
            found.scheduleIntervalMinutes,
            (Array.isArray((found as any).scheduleWindows) ? (found as any).scheduleWindows : null) as Array<{ start: string; end: string }> | null,
            (Array.isArray(found.scheduleDurations) ? found.scheduleDurations : null) as number[] | null,
            (Array.isArray(found.scheduleFixedSlots) ? found.scheduleFixedSlots : null) as Array<{ start: string; duration: number }> | null
        );
    }
}

