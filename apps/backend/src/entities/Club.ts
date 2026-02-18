import { Court } from './Court';

export class Club {
    public courts: Court[] = [];

    constructor(
        public id: number,
        public slug: string,
        public name: string,
        public addressLine: string,
        public city: string,
        public province: string,
        public country: string,
        public contactInfo: string,
        public phone?: string,
        public logoUrl?: string,
    public clubImageUrl?: string,
        public instagramUrl?: string,
        public facebookUrl?: string,
        public websiteUrl?: string,
        public description?: string,
        public lightsEnabled: boolean = false,
        public lightsExtraAmount?: number | null,
        public lightsFromHour?: string | null,
        public professorDiscountEnabled: boolean = false,
        public professorDiscountPercent?: number | null,
        public scheduleMode?: string,
        public scheduleOpenTime?: string | null,
        public scheduleCloseTime?: string | null,
        public scheduleIntervalMinutes?: number | null,
        public scheduleDurations?: number[] | null,
        public scheduleFixedSlots?: string[] | null,
        public createdAt?: Date,
        public updatedAt?: Date
    ) {}
}

