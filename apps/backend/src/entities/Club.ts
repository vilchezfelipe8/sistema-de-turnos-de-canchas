import { Court } from './Court';

export type FixedBookingActivityConfig = {
    fixedBookingDaysAhead: number;
    fixedBookingGenerationFrequencyDays: number;
};

export type FixedBookingSettingsByActivity = Record<string, FixedBookingActivityConfig>;
export type BookingConfirmationMode = 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
export type ClubOperationalStatus = 'OPEN' | 'TEMPORARY_CLOSED' | 'PERMANENTLY_CLOSED';

export class Club {
    public courts: Court[] = [];
    public publicSports: string[] = [];

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
        // Regla operativa explícita: duración especial para profesor
        public professorDurationOverrideEnabled: boolean = true,
        public professorDurationOverrideMinutes: number = 60,
        public fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null,
        public bookingConfirmationMode: BookingConfirmationMode = 'MANUAL',
        public bookingDepositPercent?: number | null,
        public allowManualConfirmationOverride: boolean = true,
        public autoCancelPendingBookingsEnabled: boolean = false,
        public autoCancelPendingBookingsMinutesBefore?: number | null,
        public autoCancelPendingBookingsOnlyIfUnpaid: boolean = true,
        public autoCancelPendingWarningEnabled: boolean = false,
        public autoCancelPendingWarningMinutesBefore?: number | null,
        public enforceCashShiftCloseWithOpenAccounts: boolean = false,
        public openingDays?: number[] | null,
        public closureDates?: string[] | null,
        public createdAt?: Date,
        public updatedAt?: Date,
        public bookingSimpleAdvanceDaysUser: number = 30,
        public bookingSimpleAdvanceDaysAdmin: number = 30,
        public allowAdminSkipSimpleAdvanceLimit: boolean = false,
        public clubOperationalStatus: ClubOperationalStatus = 'OPEN',
        public temporaryClosureStartDate?: string | null,
        public temporaryClosureEndDate?: string | null
    ) {}
}
