import { TimeHelper } from './TimeHelper';

export type FixedScheduleSlot = {
    start: string;
    duration: number;
};

export type RangeScheduleWindow = {
    start: string;
    end: string;
};

export type ScheduleSource = {
    scheduleMode?: 'FIXED' | 'RANGE' | string | null;
    scheduleOpenTime?: string | null;
    scheduleCloseTime?: string | null;
    scheduleIntervalMinutes?: number | null;
    scheduleWindows?: unknown;
    scheduleDurations?: unknown;
    scheduleFixedSlots?: unknown;
};

export type NormalizedSchedule = {
    mode: 'FIXED' | 'RANGE';
    openTime: string | null;
    closeTime: string | null;
    intervalMinutes: number | null;
    rangeWindows: RangeScheduleWindow[];
    durations: number[];
    fixedSlots: FixedScheduleSlot[];
};

const TIME_RE = /^\d{2}:\d{2}$/;

const isValidTime = (value: unknown): value is string =>
    typeof value === 'string' && TIME_RE.test(value);

const parseDurations = (raw: unknown, fallback: number) => {
    const parsed = Array.isArray(raw)
        ? raw
              .map((v) => Number(v))
              .filter((v) => Number.isFinite(v) && v > 0)
              .map((v) => Math.floor(v))
        : [];

    if (parsed.length > 0) return Array.from(new Set(parsed));
    return [Math.max(1, Math.floor(fallback))];
};

const parseFixedSlots = (raw: unknown): FixedScheduleSlot[] => {
    if (!Array.isArray(raw)) return [];

    return raw.map((slot) => {
        if (!slot || typeof slot !== 'object') {
            throw new Error('scheduleFixedSlots debe tener formato [{ start: "HH:mm", duration: number }]');
        }

        const slotRecord = slot as Record<string, unknown>;
        const start = String(slotRecord.start || '').trim();
        const duration = Number(slotRecord.duration);

        if (!isValidTime(start)) {
            throw new Error('scheduleFixedSlots.start debe tener formato HH:mm');
        }
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error('scheduleFixedSlots.duration debe ser un número mayor a 0');
        }

        return { start, duration: Math.floor(duration) };
    });
};

const parseRangeWindows = (raw: unknown): RangeScheduleWindow[] => {
    if (!Array.isArray(raw)) return [];

    const windows = raw.map((item) => {
        if (!item || typeof item !== 'object') {
            throw new Error('scheduleWindows debe tener formato [{ start: "HH:mm", end: "HH:mm" }]');
        }

        const record = item as Record<string, unknown>;
        const start = String(record.start || '').trim();
        const end = String(record.end || '').trim();

        if (!isValidTime(start) || !isValidTime(end)) {
            throw new Error('scheduleWindows.start/end debe tener formato HH:mm');
        }

        const startMinutes = TimeHelper.timeToMinutes(start);
        const endMinutes = TimeHelper.timeToMinutes(end);
        if (endMinutes <= startMinutes) {
            throw new Error('Cada ventana de scheduleWindows debe tener end mayor a start');
        }

        return { start, end, startMinutes, endMinutes };
    });

    windows.sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 1; i < windows.length; i += 1) {
        if (windows[i].startMinutes < windows[i - 1].endMinutes) {
            throw new Error('scheduleWindows no puede tener ventanas superpuestas');
        }
    }

    return windows.map(({ start, end }) => ({ start, end }));
};

export const normalizeSchedule = (
    source: ScheduleSource,
    fallbackDuration: number
): NormalizedSchedule => {
    const durations = parseDurations(source.scheduleDurations, fallbackDuration);

    const mode = source.scheduleMode === 'RANGE' ? 'RANGE' : 'FIXED';
    const rangeWindows = parseRangeWindows(source.scheduleWindows);
    const fixedSlots = parseFixedSlots(source.scheduleFixedSlots);

    return {
        mode,
        openTime: source.scheduleOpenTime ?? null,
        closeTime: source.scheduleCloseTime ?? null,
        intervalMinutes:
            source.scheduleIntervalMinutes == null
                ? null
                : Math.floor(Number(source.scheduleIntervalMinutes)),
        rangeWindows,
        durations,
        fixedSlots
    };
};

export const validateScheduleMode = (schedule: NormalizedSchedule): string[] => {
    const errors: string[] = [];

    if (schedule.mode === 'FIXED') {
        if (!Array.isArray(schedule.fixedSlots) || schedule.fixedSlots.length === 0) {
            errors.push('scheduleFixedSlots es obligatorio cuando scheduleMode=FIXED');
        }
    }

    if (schedule.mode === 'RANGE') {
        if (Array.isArray(schedule.rangeWindows) && schedule.rangeWindows.length > 0) {
            for (const window of schedule.rangeWindows) {
                if (!isValidTime(window.start) || !isValidTime(window.end)) {
                    errors.push('scheduleWindows debe tener formato HH:mm-HH:mm válido');
                    break;
                }
                if (TimeHelper.timeToMinutes(window.end) <= TimeHelper.timeToMinutes(window.start)) {
                    errors.push('Cada ventana de scheduleWindows debe tener fin mayor al inicio');
                    break;
                }
            }
        } else {
            if (!isValidTime(schedule.openTime)) {
                errors.push('scheduleOpenTime es obligatorio (HH:mm) cuando scheduleMode=RANGE');
            }
            if (!isValidTime(schedule.closeTime)) {
                errors.push('scheduleCloseTime es obligatorio (HH:mm) cuando scheduleMode=RANGE');
            }
        }
        if (!Number.isFinite(Number(schedule.intervalMinutes)) || Number(schedule.intervalMinutes) <= 0) {
            errors.push('scheduleIntervalMinutes es obligatorio (> 0) cuando scheduleMode=RANGE');
        }
    }

    return errors;
};

export const assertValidScheduleMode = (schedule: NormalizedSchedule) => {
    const errors = validateScheduleMode(schedule);
    if (errors.length > 0) {
        throw new Error(`Configuración de horario inválida: ${errors.join(' | ')}`);
    }
};

const buildRangeSlots = (
    openTime: string,
    closeTime: string,
    intervalMinutes: number,
    durationMinutes: number
): Array<{ slotTime: string; dayOffset: number }> => {
    const open = TimeHelper.timeToMinutes(openTime);
    let close = TimeHelper.timeToMinutes(closeTime);
    if (close <= open) close += 24 * 60;

    const slots: Array<{ slotTime: string; dayOffset: number }> = [];
    for (let start = open; start + durationMinutes <= close; start += intervalMinutes) {
        const dayOffset = start >= 24 * 60 ? 1 : 0;
        const minuteOfDay = start % (24 * 60);
        slots.push({ slotTime: TimeHelper.minutesToTime(minuteOfDay), dayOffset });
    }

    return slots;
};

const buildSplitRangeSlots = (
    windows: RangeScheduleWindow[],
    intervalMinutes: number,
    durationMinutes: number
) => {
    const slots: Array<{ slotTime: string; dayOffset: number }> = [];
    for (const window of windows) {
        slots.push(...buildRangeSlots(window.start, window.end, intervalMinutes, durationMinutes));
    }

    const unique = new Map<string, { slotTime: string; dayOffset: number }>();
    for (const slot of slots) {
        unique.set(`${slot.dayOffset}-${slot.slotTime}`, slot);
    }

    return Array.from(unique.values()).sort((a, b) => {
        if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
        return TimeHelper.timeToMinutes(a.slotTime) - TimeHelper.timeToMinutes(b.slotTime);
    });
};

export const buildSlotsFromSchedule = (
    source: ScheduleSource,
    fallbackDuration: number,
    durationMinutes: number
): Array<{ slotTime: string; dayOffset: number }> => {
    const normalized = normalizeSchedule(source, fallbackDuration);

    if (normalized.mode === 'RANGE') {
        const interval = Number(normalized.intervalMinutes || 30);
        if (Array.isArray(normalized.rangeWindows) && normalized.rangeWindows.length > 0) {
            return buildSplitRangeSlots(normalized.rangeWindows, interval, durationMinutes);
        }

        const openTime = normalized.openTime || '08:00';
        const closeTime = normalized.closeTime || '22:00';
        return buildRangeSlots(openTime, closeTime, interval, durationMinutes);
    }

    return normalized.fixedSlots
        .filter((slot) => Number(slot.duration) === Number(durationMinutes))
        .map((slot) => ({ slotTime: slot.start, dayOffset: 0 }));
};

export const validateOpeningDays = (openingDays: unknown): string[] => {
    if (openingDays == null) return [];
    if (!Array.isArray(openingDays)) {
        return ['openingDays debe ser un array de enteros entre 0 y 6'];
    }

    for (const day of openingDays) {
        if (!Number.isInteger(day) || day < 0 || day > 6) {
            return ['openingDays debe tener formato [0,1,2,3,4,5,6] con valores entre 0 y 6'];
        }
    }

    return [];
};
