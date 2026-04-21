export class ActivityType {
    constructor(
        public id: number,
        public name: string,
        public description: string,
        public defaultDurationMinutes: number,
        public clubId?: number,
        public scheduleMode?: 'FIXED' | 'RANGE',
        public scheduleOpenTime?: string | null,
        public scheduleCloseTime?: string | null,
        public scheduleIntervalMinutes?: number | null,
        public scheduleWindows?: Array<{ start: string; end: string }> | null,
        public scheduleDurations?: number[] | null,
        public scheduleFixedSlots?: Array<{ start: string; duration: number }> | null
    ) {}
}

