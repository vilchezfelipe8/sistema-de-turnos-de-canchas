import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export class TimeHelper {
    private static TIME_RE = /^\d{2}:\d{2}$/;
    private static MINUTES_IN_DAY = 24 * 60;

    static getDefaultTimeZone(): string {
        return process.env.DEFAULT_TIMEZONE || 'UTC';
    }

    static getUtcRangeForLocalDate(
        date: Date,
        timeZone = TimeHelper.getDefaultTimeZone()
    ) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        const startLocalIso = `${year}-${month}-${day}T00:00:00`;
        const endLocalIso = `${year}-${month}-${day}T23:59:59.999`;

        const startUtc = fromZonedTime(startLocalIso, timeZone);
        const endUtc = fromZonedTime(endLocalIso, timeZone);

        return { startUtc, endUtc };
    }

    static localSlotToUtc(
        date: Date | string,
        time: string,
        timeZone = TimeHelper.getDefaultTimeZone()
    ): Date {
        if (!this.TIME_RE.test(time)) {
            throw new Error(`Invalid time format: ${time}. Expected HH:mm`);
        }

        const dt =
            typeof date === 'string'
                ? date
                : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
                      2,
                      '0'
                  )}-${String(date.getDate()).padStart(2, '0')}`;

        const isoLocal = `${dt}T${time}:00`;

        return fromZonedTime(isoLocal, timeZone);
    }

    static utcToLocal(
        date: Date,
        timeZone = TimeHelper.getDefaultTimeZone()
    ): Date {
        return toZonedTime(date, timeZone);
    }

    static timeToMinutes(time: string): number {
        if (!this.TIME_RE.test(time)) {
            throw new Error(`Invalid time format: ${time}. Expected HH:mm`);
        }

        const [hoursStr, minutesStr] = time.split(':');
        const hours = Number(hoursStr);
        const minutes = Number(minutesStr);

        if (Number.isNaN(hours) || Number.isNaN(minutes)) {
            throw new Error(`Invalid time numbers in: ${time}`);
        }

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Time out of range: ${time}`);
        }

        return hours * 60 + minutes;
    }

    static minutesToTime(minutes: number): string {
        if (
            !Number.isInteger(minutes) ||
            minutes < 0 ||
            minutes >= this.MINUTES_IN_DAY
        ) {
            throw new Error(`Minutes out of range: ${minutes}`);
        }

        const h = Math.floor(minutes / 60);
        const m = minutes % 60;

        return `${h.toString().padStart(2, '0')}:${m
            .toString()
            .padStart(2, '0')}`;
    }

    static addMinutes(time: string, minutesToAdd: number): string {
        const total = this.timeToMinutes(time) + minutesToAdd;

        if (total < 0 || total >= this.MINUTES_IN_DAY) {
            throw new Error(
                `Resulting time out of day range: ${total} minutes`
            );
        }

        return this.minutesToTime(total);
    }

    static isOverlapping(
        startA: string,
        endA: string,
        startB: string,
        endB: string
    ): boolean {
        const sA = this.timeToMinutes(startA);
        const eA = this.timeToMinutes(endA);
        const sB = this.timeToMinutes(startB);
        const eB = this.timeToMinutes(endB);

        if (sA === eA || sB === eB) return false;

        return sA < eB && eA > sB;
    }

    static addMinutesToDate(date: Date, minutesToAdd: number): Date {
        return new Date(date.getTime() + minutesToAdd * 60000);
    }

    static isOverlappingDates(
        startA: Date,
        endA: Date,
        startB: Date,
        endB: Date
    ): boolean {
        return (
            startA.getTime() < endB.getTime() &&
            endA.getTime() > startB.getTime()
        );
    }
}