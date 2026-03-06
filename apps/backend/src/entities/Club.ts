import { Court } from './Court';

export type FixedBookingActivityConfig = {
    fixedBookingDaysAhead: number;
    fixedBookingGenerationFrequencyDays: number;
};

export type FixedBookingSettingsByActivity = Record<string, FixedBookingActivityConfig>;

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
        public timeZone: string = 'America/Argentina/Buenos_Aires',
        public lightsEnabled: boolean = false,
        public lightsExtraAmount?: number | null,
        public lightsFromHour?: string | null,
        public professorDiscountEnabled: boolean = false,
        public professorDiscountPercent?: number | null,
        public fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null,
        public openingDays?: number[] | null,
        public createdAt?: Date,
        public updatedAt?: Date
    ) {}
}

