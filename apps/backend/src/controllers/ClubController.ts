import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';
import { z } from 'zod';
import { validateOpeningDays } from '../utils/ActivityScheduleHelper';
import { MediaStorageService } from '../services/MediaStorageService';
import { sanitizeString } from '../utils/sanitize';

const fixedBookingActivityConfigSchema = z.object({
    fixedBookingDaysAhead: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().positive()),
    fixedBookingGenerationFrequencyDays: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().int().positive())
});

export class ClubController {
    private readonly mediaStorageService = new MediaStorageService();
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
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { slug, name, addressLine, city, province, country, contact, phone, logoUrl, clubImageUrl, instagramUrl, facebookUrl, websiteUrl, description, timeZone,
                lightsEnabled, lightsExtraAmount, lightsFromHour, openingDays,
                professorDurationOverrideEnabled, professorDurationOverrideMinutes,
                fixedBookingSettingsByActivity, bookingConfirmationMode, bookingDepositPercent, allowManualConfirmationOverride,
                autoCancelPendingBookingsEnabled, autoCancelPendingBookingsMinutesBefore, autoCancelPendingBookingsOnlyIfUnpaid,
                autoCancelPendingWarningEnabled, autoCancelPendingWarningMinutesBefore,
                enforceCashShiftCloseWithOpenAccounts, bookingSimpleAdvanceDaysUser, bookingSimpleAdvanceDaysAdmin, allowAdminSkipSimpleAdvanceLimit } = parsed.data;

            const openingDaysErrors = validateOpeningDays(openingDays);
            if (openingDaysErrors.length > 0) {
                return res.status(400).json({ error: openingDaysErrors.join(' | ') });
            }
            if (bookingConfirmationMode === 'DEPOSIT_REQUIRED') {
                if (!Number.isFinite(Number(bookingDepositPercent)) || Number(bookingDepositPercent) <= 0 || Number(bookingDepositPercent) > 100) {
                    return res.status(400).json({ error: 'bookingDepositPercent debe estar entre 0 y 100 cuando el modo es DEPOSIT_REQUIRED' });
                }
            }
            if (autoCancelPendingBookingsEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingBookingsMinutesBefore)) || Number(autoCancelPendingBookingsMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingBookingsMinutesBefore debe ser mayor a 0 cuando auto-cancel estÃ¡ habilitado' });
                }
            }
            if (autoCancelPendingWarningEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingWarningMinutesBefore)) || Number(autoCancelPendingWarningMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingWarningMinutesBefore debe ser mayor a 0 cuando warning estÃ¡ habilitado' });
                }
            }
            if (autoCancelPendingBookingsEnabled && autoCancelPendingWarningEnabled) {
                if (Number(autoCancelPendingWarningMinutesBefore) <= Number(autoCancelPendingBookingsMinutesBefore)) {
                    return res.status(400).json({ error: 'El warning debe configurarse antes de la cancelación automática' });
                }
            }
            if ((professorDurationOverrideEnabled ?? true) && (!Number.isFinite(Number(professorDurationOverrideMinutes)) || Number(professorDurationOverrideMinutes) <= 0)) {
                return res.status(400).json({ error: 'professorDurationOverrideMinutes debe ser mayor a 0' });
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
                Array.isArray(openingDays) ? openingDays : null
            );
            res.status(201).json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getClubById = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'ID de club invÃ¡lido' });
            }
            const club = await this.clubService.getClubById(id);
            res.json(club);
        } catch (error: any) {
            res.status(404).json({ error: error.message });
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
            res.status(404).json({ error: error.message });
        }
    }

    getAllClubs = async (req: Request, res: Response) => {
        try {
            const clubs = await this.clubService.getAllClubs();
            res.json(clubs);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    updateClub = async (req: Request, res: Response) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de club invÃ¡lido' });
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
                return res.status(400).json({ error: parsed.error.format() });
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

            const normalizedLogoUrl = await this.mediaStorageService.normalizeAsset(logoUrl ?? null, 'logoUrl');
            const normalizedClubImageUrl = await this.mediaStorageService.normalizeAsset(clubImageUrl ?? null, 'clubImageUrl');

            const openingDaysErrors = validateOpeningDays(openingDays);
            if (openingDaysErrors.length > 0) {
                return res.status(400).json({ error: openingDaysErrors.join(' | ') });
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
                    return res.status(400).json({ error: 'autoCancelPendingBookingsMinutesBefore debe ser mayor a 0 cuando auto-cancel estÃ¡ habilitado' });
                }
            }
            if (resolvedWarningEnabled) {
                if (!Number.isFinite(Number(autoCancelPendingWarningMinutesBefore)) || Number(autoCancelPendingWarningMinutesBefore) <= 0) {
                    return res.status(400).json({ error: 'autoCancelPendingWarningMinutesBefore debe ser mayor a 0 cuando warning estÃ¡ habilitado' });
                }
            }
            if (resolvedAutoCancelEnabled && resolvedWarningEnabled) {
                if (Number(autoCancelPendingWarningMinutesBefore) <= Number(autoCancelPendingBookingsMinutesBefore)) {
                    return res.status(400).json({ error: 'El warning debe configurarse antes de la cancelación automática' });
                }
            }
            if ((professorDurationOverrideEnabled ?? true) && professorDurationOverrideMinutes !== undefined) {
                if (!Number.isFinite(Number(professorDurationOverrideMinutes)) || Number(professorDurationOverrideMinutes) <= 0) {
                    return res.status(400).json({ error: 'professorDurationOverrideMinutes debe ser mayor a 0' });
                }
            }
            if (bookingSimpleAdvanceDaysUser !== undefined && (!Number.isFinite(Number(bookingSimpleAdvanceDaysUser)) || Number(bookingSimpleAdvanceDaysUser) < 0)) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysUser debe ser 0 o mayor' });
            }
            if (bookingSimpleAdvanceDaysAdmin !== undefined && (!Number.isFinite(Number(bookingSimpleAdvanceDaysAdmin)) || Number(bookingSimpleAdvanceDaysAdmin) < 0)) {
                return res.status(400).json({ error: 'bookingSimpleAdvanceDaysAdmin debe ser 0 o mayor' });
            }

            const safeDescription = description != null ? sanitizeString(description) : null;
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
            res.json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
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

        const filtered = await this.clubService.getClients(club.id, query);
        res.json(filtered);

    } catch (error: any) {
        console.error("Error buscando clientes:", error);
        res.status(500).json({ error: error.message });
    }
};
}

