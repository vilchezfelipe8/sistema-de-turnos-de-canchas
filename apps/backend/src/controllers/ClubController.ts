import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { validateOpeningDays } from '../utils/ActivityScheduleHelper';
import { MediaStorageService } from '../services/MediaStorageService';
import { sanitizeString } from '../utils/sanitize';
import { normalizeIdentityPhone } from '../utils/phone';
import { AuditLogService } from '../services/AuditLogService';
import { ClientIdentityAdminService } from '../services/ClientIdentityAdminService';

const fixedBookingActivityConfigSchema = z.object({
    fixedBookingDaysAhead: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().positive()),
    fixedBookingGenerationFrequencyDays: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().positive())
});

const CLOSURE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLUB_OPERATIONAL_STATUS_VALUES = ['OPEN', 'TEMPORARY_CLOSED', 'PERMANENTLY_CLOSED'] as const;
type ClubOperationalStatus = typeof CLUB_OPERATIONAL_STATUS_VALUES[number];
const DEFAULT_CLUB_TIMEZONE = 'America/Argentina/Buenos_Aires';

const getDateKeyInTimeZone = (timeZone: string, date = new Date()): string => {
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
        // noop: fallback abajo
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const validateClosureDates = (closureDates: unknown): string[] => {
    if (closureDates == null) return [];
    if (!Array.isArray(closureDates)) {
        return ['closureDates debe ser un array de fechas con formato YYYY-MM-DD'];
    }

    const seen = new Set<string>();
    for (const raw of closureDates) {
        const value = String(raw || '').trim();
        if (!CLOSURE_DATE_RE.test(value)) {
            return ['closureDates debe tener formato YYYY-MM-DD'];
        }
        if (seen.has(value)) {
            return ['closureDates no puede contener fechas duplicadas'];
        }
        seen.add(value);
    }

    return [];
};

const validateClosureDatesNoPast = (closureDates: unknown, minimumDateKey: string): string[] => {
    if (!Array.isArray(closureDates)) return [];
    const pastDate = closureDates
        .map((raw) => String(raw || '').trim())
        .find((value) => CLOSURE_DATE_RE.test(value) && value < minimumDateKey);
    if (pastDate) {
        return [`closureDates contiene ${pastDate}, que es una fecha pasada (mínimo permitido: ${minimumDateKey})`];
    }
    return [];
};

const normalizeDateOnly = (value: unknown): string | null => {
    if (value == null) return null;
    const normalized = String(value).trim();
    return CLOSURE_DATE_RE.test(normalized) ? normalized : null;
};

const isDateWithinRange = (date: string, start: string, end: string): boolean => date >= start && date <= end;

const validateClubClosurePolicy = (params: {
    clubOperationalStatus: ClubOperationalStatus;
    temporaryClosureStartDate?: string | null;
    temporaryClosureEndDate?: string | null;
    closureDates?: string[] | null;
    minimumDateKey?: string | null;
    allowPastTemporaryRangeIfUnchanged?: {
        previousStartDate?: string | null;
        previousEndDate?: string | null;
    } | null;
}): string[] => {
    const errors: string[] = [];
    const status = params.clubOperationalStatus;
    const startDate = normalizeDateOnly(params.temporaryClosureStartDate);
    const endDate = normalizeDateOnly(params.temporaryClosureEndDate);

    if (params.temporaryClosureStartDate != null && !startDate) {
        errors.push('temporaryClosureStartDate debe tener formato YYYY-MM-DD');
    }
    if (params.temporaryClosureEndDate != null && !endDate) {
        errors.push('temporaryClosureEndDate debe tener formato YYYY-MM-DD');
    }

    if (status === 'TEMPORARY_CLOSED') {
        if (!startDate || !endDate) {
            errors.push('TEMPORARY_CLOSED requiere temporaryClosureStartDate y temporaryClosureEndDate');
        } else if (startDate > endDate) {
            errors.push('temporaryClosureStartDate no puede ser mayor a temporaryClosureEndDate');
        }

        const minimumDateKey = String(params.minimumDateKey || '').trim();
        if (CLOSURE_DATE_RE.test(minimumDateKey)) {
            const previousStartDate = normalizeDateOnly(params.allowPastTemporaryRangeIfUnchanged?.previousStartDate);
            const previousEndDate = normalizeDateOnly(params.allowPastTemporaryRangeIfUnchanged?.previousEndDate);
            const startChanged = startDate !== previousStartDate;
            const endChanged = endDate !== previousEndDate;
            if (startDate && startDate < minimumDateKey && startChanged) {
                errors.push(`temporaryClosureStartDate no puede ser una fecha pasada (mínimo permitido: ${minimumDateKey})`);
            }
            if (endDate && endDate < minimumDateKey && endChanged) {
                errors.push(`temporaryClosureEndDate no puede ser una fecha pasada (mínimo permitido: ${minimumDateKey})`);
            }
        }
    }

    if (status !== 'TEMPORARY_CLOSED' && (startDate || endDate)) {
        errors.push('temporaryClosureStartDate/temporaryClosureEndDate solo se permiten con clubOperationalStatus=TEMPORARY_CLOSED');
    }

    if (status === 'PERMANENTLY_CLOSED') {
        if (Array.isArray(params.closureDates) && params.closureDates.length > 0) {
            errors.push('No se permiten closureDates cuando el club está PERMANENTLY_CLOSED');
        }
    }

    if (status === 'TEMPORARY_CLOSED' && startDate && endDate && Array.isArray(params.closureDates) && params.closureDates.length > 0) {
        const overlappingDate = params.closureDates.find((date) => isDateWithinRange(date, startDate, endDate));
        if (overlappingDate) {
            errors.push(`closureDates contiene ${overlappingDate}, que ya está cubierto por el cierre temporal`);
        }
    }

    return errors;
};

export class ClubController {
    private static readonly LIGHTS_FROM_HOUR_OPTIONS = new Set(['18:00', '19:00', '20:00', '21:00', '22:00']);
    private readonly mediaStorageService = new MediaStorageService();
    private readonly auditLogService = new AuditLogService();
    private readonly clientIdentityAdminService = new ClientIdentityAdminService();
    constructor(private clubService: ClubService) {}

    createClub = async (req: Request, res: Response) => {
        try {
            const createClubSchema = z.object({
                slug: z.string().min(1),
                name: z.string().min(1),
                addressLine: z.string().min(1),
                city: z.string().min(1),
                province: z.string().min(1),
                country: z.string().min(1),
                contact: z.string().min(1),
                phone: z.string().optional().nullable(),
                logoUrl: z.string().optional().nullable(),
                clubImageUrl: z.string().optional().nullable(),
                instagramUrl: z.string().optional().nullable(),
                facebookUrl: z.string().optional().nullable(),
                websiteUrl: z.string().optional().nullable(),
                description: z.string().optional().nullable(),
                timeZone: z.string().optional(),
                lightsEnabled: z.boolean().optional(),
                lightsExtraAmount: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                lightsFromHour: z.string().optional().nullable(),
                openingDays: z.array(z.number().int().min(0).max(6)).optional().nullable(),
                closureDates: z.array(z.string().regex(CLOSURE_DATE_RE)).optional().nullable(),
                clubOperationalStatus: z.enum(CLUB_OPERATIONAL_STATUS_VALUES).optional(),
                temporaryClosureStartDate: z.string().regex(CLOSURE_DATE_RE).optional().nullable(),
                temporaryClosureEndDate: z.string().regex(CLOSURE_DATE_RE).optional().nullable(),
                professorDurationOverrideEnabled: z.boolean().optional(),
                professorDurationOverrideMinutes: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                fixedBookingSettingsByActivity: z.record(fixedBookingActivityConfigSchema).optional().nullable(),
                bookingConfirmationMode: z.enum(['AUTOMATIC', 'MANUAL', 'DEPOSIT_REQUIRED']).optional(),
                bookingDepositPercent: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                allowManualConfirmationOverride: z.boolean().optional(),
                autoCancelPendingBookingsEnabled: z.boolean().optional(),
                autoCancelPendingBookingsMinutesBefore: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                autoCancelPendingBookingsOnlyIfUnpaid: z.boolean().optional(),
                autoCancelPendingWarningEnabled: z.boolean().optional(),
                autoCancelPendingWarningMinutesBefore: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                enforceCashShiftCloseWithOpenAccounts: z.boolean().optional(),
                bookingSimpleAdvanceDaysUser: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                bookingSimpleAdvanceDaysAdmin: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                allowAdminSkipSimpleAdvanceLimit: z.boolean().optional()
            });
            const parsed = createClubSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }
            const { slug, name, addressLine, city, province, country, contact, phone, logoUrl, clubImageUrl, instagramUrl, facebookUrl, websiteUrl, description, timeZone,
                lightsEnabled, lightsExtraAmount, lightsFromHour, openingDays, closureDates,
                clubOperationalStatus, temporaryClosureStartDate, temporaryClosureEndDate,
                professorDurationOverrideEnabled, professorDurationOverrideMinutes,
                fixedBookingSettingsByActivity, bookingConfirmationMode, bookingDepositPercent, allowManualConfirmationOverride,
                autoCancelPendingBookingsEnabled, autoCancelPendingBookingsMinutesBefore, autoCancelPendingBookingsOnlyIfUnpaid,
                autoCancelPendingWarningEnabled, autoCancelPendingWarningMinutesBefore,
                enforceCashShiftCloseWithOpenAccounts, bookingSimpleAdvanceDaysUser, bookingSimpleAdvanceDaysAdmin, allowAdminSkipSimpleAdvanceLimit } = parsed.data;

            const openingDaysErrors = validateOpeningDays(openingDays);
            if (openingDaysErrors.length > 0) {
                return res.status(400).json({ error: openingDaysErrors.join(' | ') });
            }
            const closureDateErrors = validateClosureDates(closureDates);
            if (closureDateErrors.length > 0) {
                return res.status(400).json({ error: closureDateErrors.join(' | ') });
            }
            const resolvedCreateTimeZone = String(timeZone || DEFAULT_CLUB_TIMEZONE).trim() || DEFAULT_CLUB_TIMEZONE;
            const todayDateKey = getDateKeyInTimeZone(resolvedCreateTimeZone);
            const closureDateNoPastErrors = validateClosureDatesNoPast(closureDates, todayDateKey);
            if (closureDateNoPastErrors.length > 0) {
                return res.status(400).json({ error: closureDateNoPastErrors.join(' | ') });
            }
            const closurePolicyErrors = validateClubClosurePolicy({
                clubOperationalStatus: (clubOperationalStatus ?? 'OPEN') as ClubOperationalStatus,
                temporaryClosureStartDate,
                temporaryClosureEndDate,
                closureDates: Array.isArray(closureDates) ? closureDates : null,
                minimumDateKey: todayDateKey
            });
            if (closurePolicyErrors.length > 0) {
                return res.status(400).json({ error: closurePolicyErrors.join(' | ') });
            }
            if (bookingConfirmationMode === 'DEPOSIT_REQUIRED') {
                if (!Number.isFinite(Number(bookingDepositPercent)) || Number(bookingDepositPercent) <= 0 || Number(bookingDepositPercent) > 100) {
                    return res.status(400).json({ error: 'bookingDepositPercent debe estar entre 0 y 100 cuando el modo es DEPOSIT_REQUIRED' });
                }
            }
            if (autoCancelPendingBookingsEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingBookingsMinutesBefore)) || Number(autoCancelPendingBookingsMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingBookingsMinutesBefore debe ser mayor a 0 cuando la cancelación automática está habilitada' });
                }
            }
            if (autoCancelPendingWarningEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingWarningMinutesBefore)) || Number(autoCancelPendingWarningMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingWarningMinutesBefore debe ser mayor a 0 cuando el aviso está habilitado' });
                }
            }
            if (autoCancelPendingBookingsEnabled && autoCancelPendingWarningEnabled) {
                if (Number(autoCancelPendingWarningMinutesBefore) <= Number(autoCancelPendingBookingsMinutesBefore)) {
                    return res.status(400).json({ error: 'El aviso debe configurarse antes de la cancelación automática' });
                }
            }
            if ((professorDurationOverrideEnabled ?? true) && (!Number.isFinite(Number(professorDurationOverrideMinutes)) || Number(professorDurationOverrideMinutes) <= 0)) {
                return res.status(400).json({ error: 'professorDurationOverrideMinutes debe ser mayor a 0' });
            }
            if (lightsEnabled) {
                if (!Number.isFinite(Number(lightsExtraAmount)) || Number(lightsExtraAmount) <= 0) {
                    return res.status(400).json({ error: 'lightsExtraAmount debe ser mayor a 0 cuando lightsEnabled está activado' });
                }
                if (!/^\d{2}:\d{2}$/.test(String(lightsFromHour || ''))) {
                    return res.status(400).json({ error: 'lightsFromHour es obligatorio (HH:mm) cuando lightsEnabled está activado' });
                }
                if (!ClubController.LIGHTS_FROM_HOUR_OPTIONS.has(String(lightsFromHour))) {
                    return res.status(400).json({ error: 'lightsFromHour debe ser una hora válida de las opciones configurables del panel' });
                }
            }
            if (!Number.isFinite(Number(bookingSimpleAdvanceDaysUser ?? 30)) || Number(bookingSimpleAdvanceDaysUser ?? 30) < 0) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysUser debe ser 0 o mayor' });
            }
            if (!Number.isFinite(Number(bookingSimpleAdvanceDaysAdmin ?? 30)) || Number(bookingSimpleAdvanceDaysAdmin ?? 30) < 0) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysAdmin debe ser 0 o mayor' });
            }

            const safeDescription = description != null ? sanitizeString(description) : null;
            const normalizedLogoUrl = await this.mediaStorageService.normalizeAsset(logoUrl ?? null, 'logoUrl');
            const normalizedClubImageUrl = await this.mediaStorageService.normalizeAsset(clubImageUrl ?? null, 'clubImageUrl');

            const club = await this.clubService.createClub(
                slug,
                name,
                addressLine,
                city,
                province,
                country,
                contact,
                phone ?? undefined,
                normalizedLogoUrl ?? undefined,
                normalizedClubImageUrl ?? undefined,
                instagramUrl ?? undefined,
                facebookUrl ?? undefined,
                websiteUrl ?? undefined,
                safeDescription ?? undefined,
                timeZone ?? 'America/Argentina/Buenos_Aires',
                Boolean(lightsEnabled),
                lightsExtraAmount ?? null,
                lightsFromHour ?? null,
                professorDurationOverrideEnabled ?? true,
                Number.isFinite(Number(professorDurationOverrideMinutes)) ? Number(professorDurationOverrideMinutes) : 60,
                fixedBookingSettingsByActivity ?? null,
                bookingConfirmationMode ?? 'MANUAL',
                bookingDepositPercent ?? null,
                allowManualConfirmationOverride ?? true,
                autoCancelPendingBookingsEnabled ?? false,
                autoCancelPendingBookingsMinutesBefore ?? null,
                autoCancelPendingBookingsOnlyIfUnpaid ?? true,
                autoCancelPendingWarningEnabled ?? false,
                autoCancelPendingWarningMinutesBefore ?? null,
                enforceCashShiftCloseWithOpenAccounts ?? false,
                Number(bookingSimpleAdvanceDaysUser ?? 30),
                Number(bookingSimpleAdvanceDaysAdmin ?? 30),
                allowAdminSkipSimpleAdvanceLimit ?? false,
                Array.isArray(closureDates) ? closureDates : null,
                Array.isArray(openingDays) ? openingDays : null,
                (clubOperationalStatus ?? 'OPEN') as ClubOperationalStatus,
                normalizeDateOnly(temporaryClosureStartDate),
                normalizeDateOnly(temporaryClosureEndDate)
            );
            res.status(201).json(club);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo guardar el club');
        }
    }

    getClubById = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'ID de club inválido' });
            }
            const club = await this.clubService.getClubById(id);
            res.json(club);
        } catch (error: any) {
            return sendAppError(res, error, 'Club no encontrado');
        }
    }

    getClubBySlug = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            if (!slug) {
                return res.status(400).json({ error: 'Slug de club requerido' });
            }
            const club = await this.clubService.getClubBySlug(slug as string);
            res.json(club);
        } catch (error: any) {
            return sendAppError(res, error, 'Club no encontrado');
        }
    }

    getAllClubs = async (req: Request, res: Response) => {
        try {
            const clubs = await this.clubService.getAllClubs();
            res.json(clubs);
        } catch (error: any) {
            return sendAppError(res, error, 'Error al obtener los clubes');
        }
    }

    updateClub = async (req: Request, res: Response) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de club inválido' });
            }
            const id = idParsed.data;
            const updateClubSchema = z.object({
                slug: z.string().optional(),
                name: z.string().optional(),
                addressLine: z.string().optional(),
                city: z.string().optional(),
                province: z.string().optional(),
                country: z.string().optional(),
                contactInfo: z.string().optional(),
                phone: z.string().optional().nullable(),
                logoUrl: z.string().optional().nullable(),
                clubImageUrl: z.string().optional().nullable(),
                instagramUrl: z.string().optional().nullable(),
                facebookUrl: z.string().optional().nullable(),
                websiteUrl: z.string().optional().nullable(),
                description: z.string().optional().nullable(),
                timeZone: z.string().optional(),
                lightsEnabled: z.boolean().optional(),
                lightsExtraAmount: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                lightsFromHour: z.string().optional().nullable(),
                professorDurationOverrideEnabled: z.boolean().optional(),
                professorDurationOverrideMinutes: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                fixedBookingSettingsByActivity: z.record(fixedBookingActivityConfigSchema).optional().nullable(),
                openingDays: z.array(z.number().int().min(0).max(6)).optional(),
                closureDates: z.array(z.string().regex(CLOSURE_DATE_RE)).optional().nullable(),
                clubOperationalStatus: z.enum(CLUB_OPERATIONAL_STATUS_VALUES).optional(),
                temporaryClosureStartDate: z.string().regex(CLOSURE_DATE_RE).optional().nullable(),
                temporaryClosureEndDate: z.string().regex(CLOSURE_DATE_RE).optional().nullable(),
                bookingConfirmationMode: z.enum(['AUTOMATIC', 'MANUAL', 'DEPOSIT_REQUIRED']).optional(),
                bookingDepositPercent: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                allowManualConfirmationOverride: z.boolean().optional(),
                autoCancelPendingBookingsEnabled: z.boolean().optional(),
                autoCancelPendingBookingsMinutesBefore: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                autoCancelPendingBookingsOnlyIfUnpaid: z.boolean().optional(),
                autoCancelPendingWarningEnabled: z.boolean().optional(),
                autoCancelPendingWarningMinutesBefore: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                enforceCashShiftCloseWithOpenAccounts: z.boolean().optional(),
                bookingSimpleAdvanceDaysUser: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                bookingSimpleAdvanceDaysAdmin: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                allowAdminSkipSimpleAdvanceLimit: z.boolean().optional()
            });
            const parsed = updateClubSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }
            const {
                slug,
                name,
                addressLine,
                city,
                province,
                country,
                contactInfo,
                phone,
                logoUrl,
                clubImageUrl,
                instagramUrl,
                facebookUrl,
                websiteUrl,
                description,
                timeZone,
                lightsEnabled,
                lightsExtraAmount,
                lightsFromHour,
                professorDurationOverrideEnabled,
                professorDurationOverrideMinutes,
                fixedBookingSettingsByActivity,
                openingDays,
                closureDates,
                clubOperationalStatus,
                temporaryClosureStartDate,
                temporaryClosureEndDate,
                bookingConfirmationMode,
                bookingDepositPercent,
                allowManualConfirmationOverride,
                autoCancelPendingBookingsEnabled,
                autoCancelPendingBookingsMinutesBefore,
                autoCancelPendingBookingsOnlyIfUnpaid,
                autoCancelPendingWarningEnabled,
                autoCancelPendingWarningMinutesBefore,
                enforceCashShiftCloseWithOpenAccounts,
                bookingSimpleAdvanceDaysUser,
                bookingSimpleAdvanceDaysAdmin,
                allowAdminSkipSimpleAdvanceLimit
            } = parsed.data;
            const previousClub = await this.clubService.getClubById(id);

            const normalizedLogoUrl = await this.mediaStorageService.normalizeAsset(logoUrl ?? null, 'logoUrl');
            const normalizedClubImageUrl = await this.mediaStorageService.normalizeAsset(clubImageUrl ?? null, 'clubImageUrl');

            const openingDaysErrors = validateOpeningDays(openingDays);
            if (openingDaysErrors.length > 0) {
                return res.status(400).json({ error: openingDaysErrors.join(' | ') });
            }
            const closureDateErrors = validateClosureDates(closureDates);
            if (closureDateErrors.length > 0) {
                return res.status(400).json({ error: closureDateErrors.join(' | ') });
            }
            const resolvedTimeZone = String(timeZone ?? previousClub.timeZone ?? DEFAULT_CLUB_TIMEZONE).trim() || DEFAULT_CLUB_TIMEZONE;
            const todayDateKey = getDateKeyInTimeZone(resolvedTimeZone);
            if (Array.isArray(closureDates)) {
                const previousClosureDatesSet = new Set(
                    Array.isArray(previousClub.closureDates)
                        ? previousClub.closureDates
                            .map((raw: unknown) => String(raw || '').trim())
                            .filter((value: string) => CLOSURE_DATE_RE.test(value))
                        : []
                );
                const newlyAddedPastDate = closureDates
                    .map((raw) => String(raw || '').trim())
                    .find((value) => CLOSURE_DATE_RE.test(value) && value < todayDateKey && !previousClosureDatesSet.has(value));
                if (newlyAddedPastDate) {
                    return res.status(400).json({
                        error: `closureDates contiene ${newlyAddedPastDate}, que es una fecha pasada (mínimo permitido: ${todayDateKey})`
                    });
                }
            }
            const resolvedClubOperationalStatus =
                (clubOperationalStatus ?? previousClub.clubOperationalStatus ?? 'OPEN') as ClubOperationalStatus;
            const resolvedTemporaryClosureStartDate =
                temporaryClosureStartDate !== undefined
                    ? temporaryClosureStartDate
                    : previousClub.temporaryClosureStartDate ?? null;
            const resolvedTemporaryClosureEndDate =
                temporaryClosureEndDate !== undefined
                    ? temporaryClosureEndDate
                    : previousClub.temporaryClosureEndDate ?? null;
            const resolvedClosureDates =
                closureDates !== undefined
                    ? closureDates
                    : (Array.isArray(previousClub.closureDates) ? previousClub.closureDates : null);

            const closurePolicyErrors = validateClubClosurePolicy({
                clubOperationalStatus: resolvedClubOperationalStatus,
                temporaryClosureStartDate: resolvedTemporaryClosureStartDate,
                temporaryClosureEndDate: resolvedTemporaryClosureEndDate,
                closureDates: resolvedClosureDates,
                minimumDateKey: todayDateKey,
                allowPastTemporaryRangeIfUnchanged: {
                    previousStartDate: previousClub.temporaryClosureStartDate ?? null,
                    previousEndDate: previousClub.temporaryClosureEndDate ?? null
                }
            });
            if (closurePolicyErrors.length > 0) {
                return res.status(400).json({ error: closurePolicyErrors.join(' | ') });
            }
            if (bookingConfirmationMode === 'DEPOSIT_REQUIRED') {
                if (!Number.isFinite(Number(bookingDepositPercent)) || Number(bookingDepositPercent) <= 0 || Number(bookingDepositPercent) > 100) {
                    return res.status(400).json({ error: 'bookingDepositPercent debe estar entre 0 y 100 cuando el modo es DEPOSIT_REQUIRED' });
                }
            }
            const resolvedAutoCancelEnabled = autoCancelPendingBookingsEnabled ?? false;
            const resolvedWarningEnabled = autoCancelPendingWarningEnabled ?? false;
            if (resolvedAutoCancelEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingBookingsMinutesBefore)) || Number(autoCancelPendingBookingsMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingBookingsMinutesBefore debe ser mayor a 0 cuando la cancelación automática está habilitada' });
                }
            }
            if (resolvedWarningEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingWarningMinutesBefore)) || Number(autoCancelPendingWarningMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingWarningMinutesBefore debe ser mayor a 0 cuando el aviso está habilitado' });
                }
            }
            if (resolvedAutoCancelEnabled && resolvedWarningEnabled) {
                if (Number(autoCancelPendingWarningMinutesBefore) <= Number(autoCancelPendingBookingsMinutesBefore)) {
                    return res.status(400).json({ error: 'El aviso debe configurarse antes de la cancelación automática' });
                }
            }
            if ((professorDurationOverrideEnabled ?? true) && professorDurationOverrideMinutes !== undefined) {
                if (!Number.isFinite(Number(professorDurationOverrideMinutes)) || Number(professorDurationOverrideMinutes) <= 0) {
                    return res.status(400).json({ error: 'professorDurationOverrideMinutes debe ser mayor a 0' });
                }
            }
            const resolvedLightsEnabled = typeof lightsEnabled === 'boolean' ? lightsEnabled : undefined;
            if (resolvedLightsEnabled === true) {
                if (!Number.isFinite(Number(lightsExtraAmount)) || Number(lightsExtraAmount) <= 0) {
                    return res.status(400).json({ error: 'lightsExtraAmount debe ser mayor a 0 cuando lightsEnabled está activado' });
                }
                if (!/^\d{2}:\d{2}$/.test(String(lightsFromHour || ''))) {
                    return res.status(400).json({ error: 'lightsFromHour es obligatorio (HH:mm) cuando lightsEnabled está activado' });
                }
                if (!ClubController.LIGHTS_FROM_HOUR_OPTIONS.has(String(lightsFromHour))) {
                    return res.status(400).json({ error: 'lightsFromHour debe ser una hora válida de las opciones configurables del panel' });
                }
            }
            if (bookingSimpleAdvanceDaysUser !== undefined && (!Number.isFinite(Number(bookingSimpleAdvanceDaysUser)) || Number(bookingSimpleAdvanceDaysUser) < 0)) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysUser debe ser 0 o mayor' });
            }
            if (bookingSimpleAdvanceDaysAdmin !== undefined && (!Number.isFinite(Number(bookingSimpleAdvanceDaysAdmin)) || Number(bookingSimpleAdvanceDaysAdmin) < 0)) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysAdmin debe ser 0 o mayor' });
            }

            const safeDescription = description != null ? sanitizeString(description) : null;
            const shouldClearTemporaryRange = clubOperationalStatus !== undefined && clubOperationalStatus !== 'TEMPORARY_CLOSED';
            const club = await this.clubService.updateClub(id, {
                slug,
                name,
                addressLine,
                city,
                province,
                country,
                contactInfo,
                phone: phone === '' ? null : phone,
                logoUrl: normalizedLogoUrl,
                clubImageUrl: normalizedClubImageUrl,
                instagramUrl: instagramUrl === '' ? null : instagramUrl,
                facebookUrl: facebookUrl === '' ? null : facebookUrl,
                websiteUrl: websiteUrl === '' ? null : websiteUrl,
                description: safeDescription === '' ? null : safeDescription,
                timeZone,
                lightsEnabled: typeof lightsEnabled === 'boolean' ? lightsEnabled : undefined,
                lightsExtraAmount: lightsExtraAmount ?? null,
                lightsFromHour: (lightsFromHour === '' || lightsFromHour == null) ? null : lightsFromHour,
                professorDurationOverrideEnabled: typeof professorDurationOverrideEnabled === 'boolean' ? professorDurationOverrideEnabled : undefined,
                professorDurationOverrideMinutes:
                    Number.isFinite(Number(professorDurationOverrideMinutes))
                        ? Number(professorDurationOverrideMinutes)
                        : undefined,
                fixedBookingSettingsByActivity: fixedBookingSettingsByActivity ?? undefined,
                openingDays: Array.isArray(openingDays) ? openingDays : undefined,
                closureDates: closureDates === null ? null : (Array.isArray(closureDates) ? closureDates : undefined),
                clubOperationalStatus,
                temporaryClosureStartDate: shouldClearTemporaryRange
                    ? null
                    : (temporaryClosureStartDate === null
                        ? null
                        : (temporaryClosureStartDate !== undefined ? normalizeDateOnly(temporaryClosureStartDate) : undefined)),
                temporaryClosureEndDate: shouldClearTemporaryRange
                    ? null
                    : (temporaryClosureEndDate === null
                        ? null
                        : (temporaryClosureEndDate !== undefined ? normalizeDateOnly(temporaryClosureEndDate) : undefined)),
                bookingConfirmationMode,
                bookingDepositPercent,
                allowManualConfirmationOverride,
                autoCancelPendingBookingsEnabled,
                autoCancelPendingBookingsMinutesBefore,
                autoCancelPendingBookingsOnlyIfUnpaid,
                autoCancelPendingWarningEnabled,
                autoCancelPendingWarningMinutesBefore,
                enforceCashShiftCloseWithOpenAccounts,
                bookingSimpleAdvanceDaysUser,
                bookingSimpleAdvanceDaysAdmin,
                allowAdminSkipSimpleAdvanceLimit
            });

            const toComparable = (value: unknown) => (value === undefined ? null : value);
            const serializeComparable = (value: unknown) => JSON.stringify(toComparable(value));
            const summarizeValue = (value: unknown) => {
                if (value === undefined || value === null) return null;
                if (typeof value === 'string') {
                    const compact = value.length > 180 ? `${value.slice(0, 180)}...(${value.length} chars)` : value;
                    return compact;
                }
                return value;
            };

            const changes = Object.keys(parsed.data)
                .filter((key) => (parsed.data as any)[key] !== undefined)
                .map((field) => {
                    const before = (previousClub as any)[field];
                    const after = (club as any)[field];
                    return { field, before, after };
                })
                .filter((row) => serializeComparable(row.before) !== serializeComparable(row.after))
                .map((row) => ({
                    field: row.field,
                    before: summarizeValue(row.before),
                    after: summarizeValue(row.after)
                }));

            if (changes.length > 0) {
                try {
                    await this.auditLogService.create({
                        clubId: club.id,
                        userId: Number((req as any)?.user?.userId) || null,
                        entity: 'CLUB',
                        entityId: String(club.id),
                        action: 'CLUB_CONFIG_UPDATED',
                        payload: {
                            source: 'ADMIN_SETTINGS',
                            changedCount: changes.length,
                            changedFields: changes.map((item) => item.field),
                            changes
                        }
                    });
                } catch {
                    // No frenamos la operación principal por un error de auditoría.
                }
            }

            res.json(club);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo guardar el club');
        }
    }

    getClubClientsList = async (req: Request, res: Response) => {
    try {
        const club = (req as any).club;
        
        if (!club) {
            return res.status(404).json({ message: 'Club no encontrado' });
        }

        const query = String(req.query.q || '').trim();
        if (!query) {
            return res.json([]); 
        }

        const filtered = await this.clubService.searchParticipants(club.id, query);
        res.json(filtered);

    } catch (error: any) {
        return sendAppError(res, error, 'Error al buscar clientes');
    }
};

    createClubClient = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const bodySchema = z.object({
                name: z.string().trim().min(2),
                phone: z.string().trim().optional().nullable(),
                phoneCountryCode: z.string().trim().optional().nullable(),
                phoneNumberLocal: z.string().trim().optional().nullable(),
                dni: z.string().trim().optional().nullable(),
                email: z.string().trim().email().optional().nullable(),
                isProfessor: z.boolean().optional()
            });
            const parsed = bodySchema.safeParse(req.body);
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

            const normalizedPhone = normalizeIdentityPhone(
                {
                    phone: parsed.data.phone ? sanitizeString(parsed.data.phone, 40) : null,
                    countryCode: parsed.data.phoneCountryCode ? sanitizeString(parsed.data.phoneCountryCode, 8) : null,
                    phoneNumberLocal: parsed.data.phoneNumberLocal ? sanitizeString(parsed.data.phoneNumberLocal, 30) : null
                },
                { defaultCountryIso2: String(club.country || '').trim() || null }
            );
            const hasAnyPhoneInput =
                Boolean(parsed.data.phone && String(parsed.data.phone).trim()) ||
                Boolean(parsed.data.phoneNumberLocal && String(parsed.data.phoneNumberLocal).trim());
            if (!hasAnyPhoneInput || !normalizedPhone) {
                throw validationError('Revisá los campos marcados.', {
                    phone: 'Cargá un teléfono válido.'
                });
            }
            // Fase 1.2: email es opcional en alta de cliente admin.

            const client = await this.clubService.createClient(Number(club.id), {
                name: sanitizeString(parsed.data.name, 120),
                phone: normalizedPhone,
                dni: parsed.data.dni ? sanitizeString(parsed.data.dni, 40) : null,
                email: parsed.data.email ? sanitizeString(parsed.data.email, 120).toLowerCase() : null,
                isProfessor: Boolean(parsed.data.isProfessor)
            });
            return res.status(201).json(client);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo crear el cliente');
        }
    };

    updateClubClient = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
            const bodySchema = z.object({
                name: z.string().trim().min(2),
                phone: z.string().trim().optional().nullable(),
                phoneCountryCode: z.string().trim().optional().nullable(),
                phoneNumberLocal: z.string().trim().optional().nullable(),
                dni: z.string().trim().optional().nullable(),
                email: z.string().trim().email().optional().nullable(),
                isProfessor: z.boolean().optional()
            });
            const paramsParsed = paramsSchema.safeParse(req.params);
            const bodyParsed = bodySchema.safeParse(req.body);
            if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
            if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));

            const normalizedPhone = normalizeIdentityPhone(
                {
                    phone: bodyParsed.data.phone ? sanitizeString(bodyParsed.data.phone, 40) : null,
                    countryCode: bodyParsed.data.phoneCountryCode ? sanitizeString(bodyParsed.data.phoneCountryCode, 8) : null,
                    phoneNumberLocal: bodyParsed.data.phoneNumberLocal ? sanitizeString(bodyParsed.data.phoneNumberLocal, 30) : null
                },
                { defaultCountryIso2: String(club.country || '').trim() || null }
            );
            const hasAnyPhoneInput =
                Boolean(bodyParsed.data.phone && String(bodyParsed.data.phone).trim()) ||
                Boolean(bodyParsed.data.phoneNumberLocal && String(bodyParsed.data.phoneNumberLocal).trim());
            if (!hasAnyPhoneInput || !normalizedPhone) {
                throw validationError('Revisá los campos marcados.', {
                    phone: 'Cargá un teléfono válido.'
                });
            }
            // Fase 1.2: email es opcional en edición de cliente admin.

            const client = await this.clubService.updateClient(Number(club.id), paramsParsed.data.clientId, {
                name: sanitizeString(bodyParsed.data.name, 120),
                phone: normalizedPhone,
                dni: bodyParsed.data.dni ? sanitizeString(bodyParsed.data.dni, 40) : null,
                email: bodyParsed.data.email ? sanitizeString(bodyParsed.data.email, 120).toLowerCase() : null,
                isProfessor: Boolean(bodyParsed.data.isProfessor)
            });
            return res.json(client);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo actualizar el cliente');
        }
    };

    deleteClubClient = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
            const paramsParsed = paramsSchema.safeParse(req.params);
            if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));

            await this.clubService.deleteClient(Number(club.id), paramsParsed.data.clientId);
            return res.status(204).send();
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo eliminar el cliente');
        }
    };

    linkClubClientUser = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            const actorUserId = Number((req as any)?.user?.userId || 0);
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
            const bodySchema = z.object({
                userId: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const paramsParsed = paramsSchema.safeParse(req.params);
            const bodyParsed = bodySchema.safeParse(req.body);
            if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
            if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));

            const client = await this.clientIdentityAdminService.linkUserToClient({
                clubId: Number(club.id),
                clientId: paramsParsed.data.clientId,
                userId: bodyParsed.data.userId,
                actorUserId
            });
            return res.json(client);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo vincular el cliente con el usuario');
        }
    };

    unlinkClubClientUser = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            const actorUserId = Number((req as any)?.user?.userId || 0);
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
            const paramsParsed = paramsSchema.safeParse(req.params);
            if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));

            const client = await this.clientIdentityAdminService.unlinkUserFromClient({
                clubId: Number(club.id),
                clientId: paramsParsed.data.clientId,
                actorUserId
            });
            return res.json(client);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo desvincular el cliente del usuario');
        }
    };

    mergeClubClients = async (req: Request, res: Response) => {
        try {
            const club = (req as any).club;
            const actorUserId = Number((req as any)?.user?.userId || 0);
            if (!club?.id) return res.status(404).json({ error: 'Club no encontrado' });

            const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
            const bodySchema = z.object({
                targetClientId: z.string().trim().min(1),
                incidentId: z.string().trim().min(1).optional(),
                resolutionNotes: z.string().trim().max(300).optional()
            });
            const paramsParsed = paramsSchema.safeParse(req.params);
            const bodyParsed = bodySchema.safeParse(req.body);
            if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
            if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));

            const result = await this.clientIdentityAdminService.mergeClients({
                clubId: Number(club.id),
                sourceClientId: paramsParsed.data.clientId,
                targetClientId: bodyParsed.data.targetClientId,
                actorUserId,
                incidentId: bodyParsed.data.incidentId || null,
                resolutionNotes: bodyParsed.data.resolutionNotes || null
            });
            return res.json(result);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo fusionar el cliente');
        }
    };
}
