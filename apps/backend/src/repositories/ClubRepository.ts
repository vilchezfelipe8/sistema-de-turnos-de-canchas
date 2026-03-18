import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { Club } from '../entities/Club';
import type { ClubOperationalStatus, FixedBookingSettingsByActivity } from '../entities/Club';
import { Court } from '../entities/Court';
import { ActivityType } from '../entities/ActivityType';

export class ClubRepository {
    private readonly CLOSURE_STATUS_DEFAULT: ClubOperationalStatus = 'OPEN';

    private supportsClosureDatesField(): boolean {
        const models = ((Prisma as any)?.dmmf?.datamodel?.models ?? []) as Array<{ name?: string; fields?: Array<{ name?: string }> }>;
        const clubSettingsModel = models.find((model) => model?.name === 'ClubSettings');
        const fields = Array.isArray(clubSettingsModel?.fields) ? clubSettingsModel!.fields : [];
        return fields.some((field) => field?.name === 'closureDates');
    }

    private supportsClosureLifecycleFields(): boolean {
        const models = ((Prisma as any)?.dmmf?.datamodel?.models ?? []) as Array<{ name?: string; fields?: Array<{ name?: string }> }>;
        const clubSettingsModel = models.find((model) => model?.name === 'ClubSettings');
        const fields = new Set(
            (Array.isArray(clubSettingsModel?.fields) ? clubSettingsModel!.fields : [])
                .map((field) => field?.name)
                .filter((name): name is string => Boolean(name))
        );

        return fields.has('clubOperationalStatus') && fields.has('temporaryClosureStartDate') && fields.has('temporaryClosureEndDate');
    }

    private assertClosureDatesSupport(closureDates: string[] | null | undefined) {
        const hasRequestedClosureDates = Array.isArray(closureDates) && closureDates.length > 0;
        if (!hasRequestedClosureDates) return;
        if (this.supportsClosureDatesField()) return;

        throw new Error(
            'La versión actual de Prisma Client no soporta closureDates. Ejecutá "npx prisma generate" en apps/backend y reiniciá el backend.'
        );
    }

    private assertClosureLifecycleSupport(
        clubOperationalStatus: ClubOperationalStatus | undefined,
        temporaryClosureStartDate: string | null | undefined,
        temporaryClosureEndDate: string | null | undefined
    ) {
        const requestedStatus = clubOperationalStatus && clubOperationalStatus !== this.CLOSURE_STATUS_DEFAULT;
        const requestedTemporaryRange = temporaryClosureStartDate != null || temporaryClosureEndDate != null;
        if (!requestedStatus && !requestedTemporaryRange) return;
        if (this.supportsClosureLifecycleFields()) return;

        throw new Error(
            'La versión actual de Prisma Client no soporta reglas de cierre temporal/permanente. Ejecutá "npx prisma generate" en apps/backend y reiniciá el backend.'
        );
    }

    private parseDateOnly(value: string | null | undefined): Date | null {
        if (!value) return null;
        const normalized = String(value).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
        return new Date(`${normalized}T00:00:00.000Z`);
    }

    private formatDateOnly(value: unknown): string | null {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
    }

    async createClub(
        slug: string,
        name: string, 
        addressLine: string,
        city: string,
        province: string,
        country: string,
        contact: string,
        phone?: string,
        logoUrl?: string,
    clubImageUrl?: string,
        instagramUrl?: string,
        facebookUrl?: string,
        websiteUrl?: string,
        description?: string,
        timeZone: string = 'America/Argentina/Buenos_Aires',
        lightsEnabled: boolean = false,
        lightsExtraAmount?: number | null,
        lightsFromHour?: string | null,
        professorDurationOverrideEnabled: boolean = true,
        professorDurationOverrideMinutes: number = 60,
        fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null,
        bookingConfirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED' = 'MANUAL',
        bookingDepositPercent?: number | null,
        allowManualConfirmationOverride: boolean = true,
        autoCancelPendingBookingsEnabled: boolean = false,
        autoCancelPendingBookingsMinutesBefore?: number | null,
        autoCancelPendingBookingsOnlyIfUnpaid: boolean = true,
        autoCancelPendingWarningEnabled: boolean = false,
        autoCancelPendingWarningMinutesBefore?: number | null,
        enforceCashShiftCloseWithOpenAccounts: boolean = false,
        bookingSimpleAdvanceDaysUser: number = 30,
        bookingSimpleAdvanceDaysAdmin: number = 30,
        allowAdminSkipSimpleAdvanceLimit: boolean = false,
        closureDates?: string[] | null,
        openingDays?: number[] | null,
        clubOperationalStatus: ClubOperationalStatus = 'OPEN',
        temporaryClosureStartDate?: string | null,
        temporaryClosureEndDate?: string | null
    ): Promise<Club> {
        this.assertClosureDatesSupport(closureDates);
        this.assertClosureLifecycleSupport(clubOperationalStatus, temporaryClosureStartDate, temporaryClosureEndDate);
        const location = await this.ensureLocation(city, province, country);
        const settingsCreateData: any = {
            timeZone,
            openingDays: openingDays ?? undefined,
            lightsEnabled,
            lightsExtraAmount,
            lightsFromHour: lightsFromHour ?? null,
            professorDurationOverrideEnabled,
            professorDurationOverrideMinutes,
            fixedBookingSettingsByActivity: fixedBookingSettingsByActivity ?? undefined,
            bookingConfirmationMode,
            bookingDepositPercent,
            allowManualConfirmationOverride,
            autoCancelPendingBookingsEnabled,
            autoCancelPendingBookingsMinutesBefore: autoCancelPendingBookingsMinutesBefore ?? null,
            autoCancelPendingBookingsOnlyIfUnpaid,
            autoCancelPendingWarningEnabled,
            autoCancelPendingWarningMinutesBefore: autoCancelPendingWarningMinutesBefore ?? null,
            enforceCashShiftCloseWithOpenAccounts,
            bookingSimpleAdvanceDaysUser: Number.isFinite(Number(bookingSimpleAdvanceDaysUser))
                ? Math.max(0, Math.floor(Number(bookingSimpleAdvanceDaysUser)))
                : 30,
            bookingSimpleAdvanceDaysAdmin: Number.isFinite(Number(bookingSimpleAdvanceDaysAdmin))
                ? Math.max(0, Math.floor(Number(bookingSimpleAdvanceDaysAdmin)))
                : 30,
            allowAdminSkipSimpleAdvanceLimit
        };
        if (this.supportsClosureDatesField()) {
            settingsCreateData.closureDates = closureDates ?? undefined;
        }
        if (this.supportsClosureLifecycleFields()) {
            settingsCreateData.clubOperationalStatus = clubOperationalStatus;
            settingsCreateData.temporaryClosureStartDate = this.parseDateOnly(temporaryClosureStartDate);
            settingsCreateData.temporaryClosureEndDate = this.parseDateOnly(temporaryClosureEndDate);
        }

        const clubData = {
            slug,
            name,
            addressLine,
            city,
            province,
            country,
            locationId: location.id,
            contactInfo: contact,
            phone,
            logoUrl,
            clubImageUrl,
            instagramUrl,
            facebookUrl,
            websiteUrl,
            description
        };

        const saved = await prisma.club.create({
            data: {
                ...clubData,
                settings: {
                    create: settingsCreateData
                }
            },
            include: { settings: true }
        });
        return this.mapToClub(saved);
    }

    async saveCourt(court: Court): Promise<Court> {
        const saved = await prisma.court.create({
            data: {
                name: court.name,
                isIndoor: court.isIndoor,
                surface: court.surface,
                isUnderMaintenance: court.isUnderMaintenance,
                club: { connect: { id: court.club.id } },
                ...(court.activityType?.id
                    ? { activityType: { connect: { id: court.activityType.id } } }
                    : {})
            },
            include: { club: true, activityType: true }
        });

        const club = this.mapToClub(saved.club);
        const activityType = saved.activityType
            ? new ActivityType(
                saved.activityType.id,
                saved.activityType.name,
                saved.activityType.description,
                saved.activityType.defaultDurationMinutes,
                (saved.activityType as any).clubId
                ,
                (saved.activityType as any).scheduleMode,
                (saved.activityType as any).scheduleOpenTime,
                (saved.activityType as any).scheduleCloseTime,
                (saved.activityType as any).scheduleIntervalMinutes,
                Array.isArray((saved.activityType as any).scheduleWindows) ? (saved.activityType as any).scheduleWindows : null,
                Array.isArray((saved.activityType as any).scheduleDurations) ? (saved.activityType as any).scheduleDurations : null,
                Array.isArray((saved.activityType as any).scheduleFixedSlots) ? (saved.activityType as any).scheduleFixedSlots : null
            )
            : null;
        
    const newCourt = new Court(saved.id, saved.name, saved.isIndoor, saved.surface, club, saved.isUnderMaintenance, activityType);
        
        return newCourt;
    }

    async findCourtById(id: number): Promise<Court | undefined> {
        const found = await prisma.court.findUnique({
            where: { id },
            include: { club: true, activityType: true }
        });

        if (!found) return undefined;

        const club = this.mapToClub(found.club);
        const activityType = found.activityType
            ? new ActivityType(
                found.activityType.id,
                found.activityType.name,
                found.activityType.description,
                found.activityType.defaultDurationMinutes,
                (found.activityType as any).clubId
                ,
                (found.activityType as any).scheduleMode,
                (found.activityType as any).scheduleOpenTime,
                (found.activityType as any).scheduleCloseTime,
                (found.activityType as any).scheduleIntervalMinutes,
                Array.isArray((found.activityType as any).scheduleWindows) ? (found.activityType as any).scheduleWindows : null,
                Array.isArray((found.activityType as any).scheduleDurations) ? (found.activityType as any).scheduleDurations : null,
                Array.isArray((found.activityType as any).scheduleFixedSlots) ? (found.activityType as any).scheduleFixedSlots : null
            )
            : null;
        
    const court = new Court(found.id, found.name, found.isIndoor, found.surface, club, found.isUnderMaintenance, activityType);
        return court;
    }

    // Método extra necesario para que compile el servicio
    async saveClub(club: Club): Promise<Club> {
        return this.createClub(
            club.slug,
            club.name, 
            club.addressLine,
            club.city,
            club.province,
            club.country,
            club.contactInfo,
            club.phone,
            club.logoUrl,
            club.clubImageUrl,
            club.instagramUrl,
            club.facebookUrl,
            club.websiteUrl,
            club.description,
            club.timeZone,
            club.lightsEnabled,
            club.lightsExtraAmount != null ? Number(club.lightsExtraAmount) : null,
            club.lightsFromHour ?? null,
            club.professorDurationOverrideEnabled ?? true,
            Number.isFinite(Number(club.professorDurationOverrideMinutes)) ? Number(club.professorDurationOverrideMinutes) : 60,
            club.fixedBookingSettingsByActivity ?? null,
            club.bookingConfirmationMode ?? 'MANUAL',
            club.bookingDepositPercent != null ? Number(club.bookingDepositPercent) : null,
            club.allowManualConfirmationOverride ?? true,
            club.autoCancelPendingBookingsEnabled ?? false,
            club.autoCancelPendingBookingsMinutesBefore != null ? Number(club.autoCancelPendingBookingsMinutesBefore) : null,
            club.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
            club.autoCancelPendingWarningEnabled ?? false,
            club.autoCancelPendingWarningMinutesBefore != null ? Number(club.autoCancelPendingWarningMinutesBefore) : null,
            club.enforceCashShiftCloseWithOpenAccounts ?? false,
            Number.isFinite(Number(club.bookingSimpleAdvanceDaysUser)) ? Number(club.bookingSimpleAdvanceDaysUser) : 30,
            Number.isFinite(Number(club.bookingSimpleAdvanceDaysAdmin)) ? Number(club.bookingSimpleAdvanceDaysAdmin) : 30,
            Boolean(club.allowAdminSkipSimpleAdvanceLimit),
            club.closureDates ?? null,
            club.openingDays ?? null,
            club.clubOperationalStatus ?? 'OPEN',
            club.temporaryClosureStartDate ?? null,
            club.temporaryClosureEndDate ?? null
        );
    }
    
    async findAllClubs(): Promise<Club[]> {
        const all = await prisma.club.findMany({ include: { settings: true } });
        return all.map(c => this.mapToClub(c));
    }

    async findClubById(id: number): Promise<Club | undefined> {
        const found = await prisma.club.findUnique({
            where: { id },
            include: { settings: true }
        });
        if (!found) return undefined;
        return this.mapToClub(found);
    }

    async findClubBySlug(slug: string): Promise<Club | undefined> {
        const found = await prisma.club.findUnique({
            where: { slug },
            include: { settings: true }
        });
        if (!found) return undefined;
        return this.mapToClub(found);
    }

    async updateClub(id: number, data: {
        slug?: string;
        name?: string;
        addressLine?: string;
        city?: string;
        province?: string;
        country?: string;
        locationId?: number | null;
        contactInfo?: string;
        phone?: string | null;
        logoUrl?: string | null;
    clubImageUrl?: string | null;
        instagramUrl?: string | null;
        facebookUrl?: string | null;
        websiteUrl?: string | null;
        description?: string | null;
        timeZone?: string;
        lightsEnabled?: boolean;
        lightsExtraAmount?: number | null;
        lightsFromHour?: string | null;
        professorDurationOverrideEnabled?: boolean;
        professorDurationOverrideMinutes?: number;
        fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
        bookingConfirmationMode?: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
        bookingDepositPercent?: number | null;
        allowManualConfirmationOverride?: boolean;
        autoCancelPendingBookingsEnabled?: boolean;
        autoCancelPendingBookingsMinutesBefore?: number | null;
        autoCancelPendingBookingsOnlyIfUnpaid?: boolean;
        autoCancelPendingWarningEnabled?: boolean;
        autoCancelPendingWarningMinutesBefore?: number | null;
        enforceCashShiftCloseWithOpenAccounts?: boolean;
        bookingSimpleAdvanceDaysUser?: number;
        bookingSimpleAdvanceDaysAdmin?: number;
        allowAdminSkipSimpleAdvanceLimit?: boolean;
        closureDates?: string[] | null;
        openingDays?: number[] | null;
        clubOperationalStatus?: ClubOperationalStatus;
        temporaryClosureStartDate?: string | null;
        temporaryClosureEndDate?: string | null;
    }): Promise<Club> {
        this.assertClosureDatesSupport(data.closureDates);
        this.assertClosureLifecycleSupport(data.clubOperationalStatus, data.temporaryClosureStartDate, data.temporaryClosureEndDate);
        const clubFields = {
            slug: data.slug,
            name: data.name,
            addressLine: data.addressLine,
            city: data.city,
            province: data.province,
            country: data.country,
            locationId: data.locationId,
            contactInfo: data.contactInfo,
            phone: data.phone,
            logoUrl: data.logoUrl,
            clubImageUrl: data.clubImageUrl,
            instagramUrl: data.instagramUrl,
            facebookUrl: data.facebookUrl,
            websiteUrl: data.websiteUrl,
            description: data.description
        };
        const cleanClubData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(clubFields)) {
            if (v !== undefined) cleanClubData[k] = v;
        }

        if (data.city && data.province && data.country) {
            const location = await this.ensureLocation(data.city, data.province, data.country);
            cleanClubData.locationId = location.id;
        }

        const settingsUpsertCreate: any = {
            timeZone: data.timeZone ?? 'America/Argentina/Buenos_Aires',
            openingDays: data.openingDays === null ? Prisma.JsonNull : (data.openingDays ?? undefined),
            lightsEnabled: data.lightsEnabled ?? false,
            lightsExtraAmount: data.lightsExtraAmount ?? null,
            lightsFromHour: typeof data.lightsFromHour === 'string' ? data.lightsFromHour : (data.lightsFromHour ?? null),
            professorDurationOverrideEnabled: data.professorDurationOverrideEnabled ?? true,
            professorDurationOverrideMinutes: Number.isFinite(Number(data.professorDurationOverrideMinutes))
                ? Math.max(1, Math.floor(Number(data.professorDurationOverrideMinutes)))
                : 60,
            fixedBookingSettingsByActivity: data.fixedBookingSettingsByActivity === null ? Prisma.JsonNull : (data.fixedBookingSettingsByActivity ?? undefined),
            bookingConfirmationMode: data.bookingConfirmationMode ?? 'MANUAL',
            bookingDepositPercent: data.bookingDepositPercent ?? null,
            allowManualConfirmationOverride: data.allowManualConfirmationOverride ?? true,
            autoCancelPendingBookingsEnabled: data.autoCancelPendingBookingsEnabled ?? false,
            autoCancelPendingBookingsMinutesBefore: data.autoCancelPendingBookingsMinutesBefore ?? null,
            autoCancelPendingBookingsOnlyIfUnpaid: data.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
            autoCancelPendingWarningEnabled: data.autoCancelPendingWarningEnabled ?? false,
            autoCancelPendingWarningMinutesBefore: data.autoCancelPendingWarningMinutesBefore ?? null,
            enforceCashShiftCloseWithOpenAccounts: data.enforceCashShiftCloseWithOpenAccounts ?? false,
            bookingSimpleAdvanceDaysUser: Number.isFinite(Number(data.bookingSimpleAdvanceDaysUser))
                ? Math.max(0, Math.floor(Number(data.bookingSimpleAdvanceDaysUser)))
                : 30,
            bookingSimpleAdvanceDaysAdmin: Number.isFinite(Number(data.bookingSimpleAdvanceDaysAdmin))
                ? Math.max(0, Math.floor(Number(data.bookingSimpleAdvanceDaysAdmin)))
                : 30,
            allowAdminSkipSimpleAdvanceLimit: data.allowAdminSkipSimpleAdvanceLimit ?? false
        };
        if (this.supportsClosureDatesField()) {
            settingsUpsertCreate.closureDates = data.closureDates === null ? Prisma.JsonNull : (data.closureDates ?? undefined);
        }
        if (this.supportsClosureLifecycleFields()) {
            settingsUpsertCreate.clubOperationalStatus = data.clubOperationalStatus ?? this.CLOSURE_STATUS_DEFAULT;
            settingsUpsertCreate.temporaryClosureStartDate = this.parseDateOnly(data.temporaryClosureStartDate);
            settingsUpsertCreate.temporaryClosureEndDate = this.parseDateOnly(data.temporaryClosureEndDate);
        }

        const settingsUpsertUpdate: any = {
            ...(data.timeZone !== undefined ? { timeZone: data.timeZone } : {}),
            ...(data.openingDays !== undefined ? { openingDays: data.openingDays === null ? Prisma.JsonNull : data.openingDays } : {}),
            ...(data.lightsEnabled !== undefined ? { lightsEnabled: data.lightsEnabled } : {}),
            ...(data.lightsExtraAmount !== undefined ? { lightsExtraAmount: data.lightsExtraAmount } : {}),
            ...(data.lightsFromHour !== undefined
                ? { lightsFromHour: typeof data.lightsFromHour === 'string' ? data.lightsFromHour : null }
                : {}),
            ...(data.professorDurationOverrideEnabled !== undefined
                ? { professorDurationOverrideEnabled: data.professorDurationOverrideEnabled }
                : {}),
            ...(data.professorDurationOverrideMinutes !== undefined
                ? { professorDurationOverrideMinutes: Math.max(1, Math.floor(Number(data.professorDurationOverrideMinutes))) }
                : {}),
            ...(data.fixedBookingSettingsByActivity !== undefined
                ? { fixedBookingSettingsByActivity: data.fixedBookingSettingsByActivity === null ? Prisma.JsonNull : data.fixedBookingSettingsByActivity }
                : {}),
            ...(data.bookingConfirmationMode !== undefined
                ? { bookingConfirmationMode: data.bookingConfirmationMode }
                : {}),
            ...(data.bookingDepositPercent !== undefined
                ? { bookingDepositPercent: data.bookingDepositPercent }
                : {}),
            ...(data.allowManualConfirmationOverride !== undefined
                ? { allowManualConfirmationOverride: data.allowManualConfirmationOverride }
                : {}),
            ...(data.autoCancelPendingBookingsEnabled !== undefined
                ? { autoCancelPendingBookingsEnabled: data.autoCancelPendingBookingsEnabled }
                : {}),
            ...(data.autoCancelPendingBookingsMinutesBefore !== undefined
                ? { autoCancelPendingBookingsMinutesBefore: data.autoCancelPendingBookingsMinutesBefore }
                : {}),
            ...(data.autoCancelPendingBookingsOnlyIfUnpaid !== undefined
                ? { autoCancelPendingBookingsOnlyIfUnpaid: data.autoCancelPendingBookingsOnlyIfUnpaid }
                : {}),
            ...(data.autoCancelPendingWarningEnabled !== undefined
                ? { autoCancelPendingWarningEnabled: data.autoCancelPendingWarningEnabled }
                : {}),
            ...(data.autoCancelPendingWarningMinutesBefore !== undefined
                ? { autoCancelPendingWarningMinutesBefore: data.autoCancelPendingWarningMinutesBefore }
                : {})
            ,
            ...(data.enforceCashShiftCloseWithOpenAccounts !== undefined
                ? { enforceCashShiftCloseWithOpenAccounts: data.enforceCashShiftCloseWithOpenAccounts }
                : {})
            ,
            ...(data.bookingSimpleAdvanceDaysUser !== undefined
                ? { bookingSimpleAdvanceDaysUser: Math.max(0, Math.floor(Number(data.bookingSimpleAdvanceDaysUser))) }
                : {}),
            ...(data.bookingSimpleAdvanceDaysAdmin !== undefined
                ? { bookingSimpleAdvanceDaysAdmin: Math.max(0, Math.floor(Number(data.bookingSimpleAdvanceDaysAdmin))) }
                : {}),
            ...(data.allowAdminSkipSimpleAdvanceLimit !== undefined
                ? { allowAdminSkipSimpleAdvanceLimit: data.allowAdminSkipSimpleAdvanceLimit }
                : {})
        };
        if (this.supportsClosureDatesField() && data.closureDates !== undefined) {
            settingsUpsertUpdate.closureDates = data.closureDates === null ? Prisma.JsonNull : data.closureDates;
        }
        if (this.supportsClosureLifecycleFields()) {
            if (data.clubOperationalStatus !== undefined) {
                settingsUpsertUpdate.clubOperationalStatus = data.clubOperationalStatus;
            }
            if (data.temporaryClosureStartDate !== undefined) {
                settingsUpsertUpdate.temporaryClosureStartDate = this.parseDateOnly(data.temporaryClosureStartDate);
            }
            if (data.temporaryClosureEndDate !== undefined) {
                settingsUpsertUpdate.temporaryClosureEndDate = this.parseDateOnly(data.temporaryClosureEndDate);
            }
        }

        const updated = await prisma.club.update({
            where: { id },
            data: {
                ...cleanClubData,
                settings: {
                    upsert: {
                        create: settingsUpsertCreate,
                        update: settingsUpsertUpdate
                    }
                }
            },
            include: { settings: true }
        });
        return this.mapToClub(updated);
    }

    private mapToClub(dbClub: any): Club {
        const settings = dbClub.settings ?? null;
        const resolvedTimeZone = settings?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const resolvedOpeningDays = Array.isArray(settings?.openingDays) ? settings.openingDays : null;
        const resolvedClosureDates = Array.isArray(settings?.closureDates)
            ? settings.closureDates
                .map((date: unknown) => String(date || '').trim())
                .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
            : null;
        const resolvedClubOperationalStatus =
            settings?.clubOperationalStatus === 'TEMPORARY_CLOSED' || settings?.clubOperationalStatus === 'PERMANENTLY_CLOSED'
                ? settings.clubOperationalStatus
                : this.CLOSURE_STATUS_DEFAULT;
        const resolvedTemporaryClosureStartDate = this.formatDateOnly(settings?.temporaryClosureStartDate);
        const resolvedTemporaryClosureEndDate = this.formatDateOnly(settings?.temporaryClosureEndDate);
        const resolvedLightsEnabled = settings?.lightsEnabled ?? false;
        const resolvedLightsExtraAmountRaw = settings?.lightsExtraAmount ?? null;
        const resolvedLightsFromHour = this.formatLightsFromHour(settings?.lightsFromHour) ?? null;
        const resolvedProfessorDurationOverrideEnabled = settings?.professorDurationOverrideEnabled ?? true;
        const resolvedProfessorDurationOverrideMinutesRaw = settings?.professorDurationOverrideMinutes ?? 60;
        const bookingConfirmationMode = settings?.bookingConfirmationMode ?? 'MANUAL';
        const bookingDepositPercentRaw = settings?.bookingDepositPercent ?? null;
        const allowManualConfirmationOverride = settings?.allowManualConfirmationOverride ?? true;
        const autoCancelPendingBookingsEnabled = settings?.autoCancelPendingBookingsEnabled ?? false;
        const autoCancelPendingBookingsMinutesBeforeRaw = settings?.autoCancelPendingBookingsMinutesBefore ?? null;
        const autoCancelPendingBookingsOnlyIfUnpaid = settings?.autoCancelPendingBookingsOnlyIfUnpaid ?? true;
        const autoCancelPendingWarningEnabled = settings?.autoCancelPendingWarningEnabled ?? false;
        const autoCancelPendingWarningMinutesBeforeRaw = settings?.autoCancelPendingWarningMinutesBefore ?? null;
        const enforceCashShiftCloseWithOpenAccounts = settings?.enforceCashShiftCloseWithOpenAccounts ?? false;
        const bookingSimpleAdvanceDaysUserRaw = settings?.bookingSimpleAdvanceDaysUser ?? 30;
        const bookingSimpleAdvanceDaysAdminRaw = settings?.bookingSimpleAdvanceDaysAdmin ?? 30;
        const allowAdminSkipSimpleAdvanceLimit = settings?.allowAdminSkipSimpleAdvanceLimit ?? false;
        const resolvedLightsExtraAmount = resolvedLightsExtraAmountRaw == null ? null : Number(resolvedLightsExtraAmountRaw);
        const resolvedProfessorDurationOverrideMinutes = Number.isFinite(Number(resolvedProfessorDurationOverrideMinutesRaw))
            ? Math.max(1, Math.floor(Number(resolvedProfessorDurationOverrideMinutesRaw)))
            : 60;
        const bookingDepositPercent = bookingDepositPercentRaw == null ? null : Number(bookingDepositPercentRaw);
        const autoCancelPendingBookingsMinutesBefore = autoCancelPendingBookingsMinutesBeforeRaw == null ? null : Number(autoCancelPendingBookingsMinutesBeforeRaw);
        const autoCancelPendingWarningMinutesBefore = autoCancelPendingWarningMinutesBeforeRaw == null ? null : Number(autoCancelPendingWarningMinutesBeforeRaw);
        const bookingSimpleAdvanceDaysUser = Number.isFinite(Number(bookingSimpleAdvanceDaysUserRaw))
            ? Math.max(0, Math.floor(Number(bookingSimpleAdvanceDaysUserRaw)))
            : 30;
        const bookingSimpleAdvanceDaysAdmin = Number.isFinite(Number(bookingSimpleAdvanceDaysAdminRaw))
            ? Math.max(0, Math.floor(Number(bookingSimpleAdvanceDaysAdminRaw)))
            : 30;
        const resolvedFixedBooking = (settings?.fixedBookingSettingsByActivity ?? null) as FixedBookingSettingsByActivity | null;

        return new Club(
            dbClub.id,
            dbClub.slug,
            dbClub.name,
            dbClub.addressLine,
            dbClub.city,
            dbClub.province,
            dbClub.country,
            dbClub.contactInfo,
            dbClub.phone || undefined,
            dbClub.logoUrl || undefined,
            dbClub.clubImageUrl || undefined,
            dbClub.instagramUrl || undefined,
            dbClub.facebookUrl || undefined,
            dbClub.websiteUrl || undefined,
            dbClub.description || undefined,
            resolvedTimeZone,
            resolvedLightsEnabled,
            resolvedLightsExtraAmount,
            resolvedLightsFromHour,
            resolvedProfessorDurationOverrideEnabled,
            resolvedProfessorDurationOverrideMinutes,
            resolvedFixedBooking,
            bookingConfirmationMode,
            bookingDepositPercent,
            allowManualConfirmationOverride,
            autoCancelPendingBookingsEnabled,
            autoCancelPendingBookingsMinutesBefore,
            autoCancelPendingBookingsOnlyIfUnpaid,
            autoCancelPendingWarningEnabled,
            autoCancelPendingWarningMinutesBefore,
            enforceCashShiftCloseWithOpenAccounts,
            resolvedOpeningDays,
            resolvedClosureDates,
            dbClub.createdAt,
            dbClub.updatedAt,
            bookingSimpleAdvanceDaysUser,
            bookingSimpleAdvanceDaysAdmin,
            allowAdminSkipSimpleAdvanceLimit,
            resolvedClubOperationalStatus,
            resolvedTemporaryClosureStartDate,
            resolvedTemporaryClosureEndDate
        );
    }

    private parseLightsFromHour(value: string | null | undefined): number | null {
        if (!value) return null;
        const [hoursRaw, minutesRaw] = String(value).split(':');
        const hours = Number(hoursRaw);
        const minutes = Number(minutesRaw ?? '0');
        if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    private formatLightsFromHour(value: number | null | undefined): string | null {
        if (!Number.isFinite(Number(value))) return null;
        const total = Number(value);
        if (total < 0) return null;
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    private async ensureLocation(city: string, province: string, country: string) {
        return await prisma.location.upsert({
            where: {
                city_province_country: { city, province, country }
            },
            update: {},
            create: { city, province, country }
        });
    }
    async findBySlug(slug: string) {
        return await prisma.club.findUnique({
            where: { slug },
            include: { settings: true }
        });
    }
}
