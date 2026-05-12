import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';
import { TimeHelper } from '../utils/TimeHelper';
import { ProductService } from '../services/ProductService';
import { ClientDuplicateIncidentService } from '../services/ClientDuplicateIncidentService';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { sanitizeString } from '../utils/sanitize';
import { normalizeIdentityPhone } from '../utils/phone';
import { sendAuthError } from '../utils/authError';
import { ApiError, sendApiError } from '../utils/apiError';

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && String(error.message || '').trim().length > 0
        ? error.message
        : fallback;

const isIntegrityInconsistencyError = (error: unknown) =>
    getErrorMessage(error, '').includes('Inconsistencia de integridad');

type OptionalAuthState = 'guest' | 'authenticated' | 'invalid_token';
const TENANT_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);
const TENANT_OPERATOR_ROLES = new Set(['OWNER', 'ADMIN', 'STAFF']);

const resolveOptionalAuthState = (req: Request): OptionalAuthState => {
    const raw = String((req as any).authState || 'guest').trim();
    if (raw === 'authenticated' || raw === 'invalid_token') return raw;
    return 'guest';
};

const createBookingApiError = (error: unknown): ApiError => {
    const known = (error || {}) as any;
    const rawCode = String(known?.code || '').trim();
    const message = getErrorMessage(error, 'No se pudo crear la reserva.');
    const normalizedMessage = message
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (rawCode === 'CLIENT_POSSIBLE_DUPLICATE' || message === 'CLIENT_POSSIBLE_DUPLICATE') {
        const details = (known?.details && typeof known.details === 'object') ? known.details : {};
        const candidateClientIds = Array.isArray((details as any)?.candidateClientIds)
            ? (details as any).candidateClientIds
            : [];
        const candidates = Array.isArray((details as any)?.candidates)
            ? (details as any).candidates
            : [];
        return new ApiError({
            statusCode: 409,
            code: 'CLIENT_POSSIBLE_DUPLICATE',
            field: 'owner',
            blocking: true,
            message: 'Se detectaron datos que podrian corresponder a mas de un cliente. Revisa y selecciona el cliente correcto.',
            meta: {
                candidateClientIds,
                candidates
            }
        });
    }

    if (rawCode === 'BOOKING_OVERLAP') {
        const overlaps = Array.isArray(known?.overlaps) ? known.overlaps : [];
        return new ApiError({
            statusCode: 409,
            code: 'BOOKING_OVERLAP',
            field: 'time',
            blocking: true,
            message: 'El horario se superpone con reservas existentes.',
            meta: { overlaps }
        });
    }

    if (message === 'SLOT_ALREADY_BOOKED') {
        return new ApiError({
            statusCode: 409,
            code: 'SLOT_ALREADY_BOOKED',
            field: 'time',
            blocking: true,
            message: 'No se pudo confirmar la disponibilidad del horario. Reintentá.'
        });
    }

    if (message.includes('pasado')) {
        return new ApiError({
            statusCode: 400,
            code: 'BOOKING_IN_PAST',
            field: 'time',
            blocking: true,
            message
        });
    }

    if (normalizedMessage.includes('duracion no permitida')) {
        return new ApiError({
            statusCode: 400,
            code: 'DURATION_NOT_ALLOWED',
            field: 'duration',
            blocking: true,
            message
        });
    }

    if (normalizedMessage.includes('horario no permitido')) {
        return new ApiError({
            statusCode: 400,
            code: 'SLOT_NOT_ALLOWED',
            field: 'time',
            blocking: true,
            message
        });
    }

    if (normalizedMessage.includes('club esta cerrado')) {
        return new ApiError({
            statusCode: 400,
            code: 'CLUB_CLOSED',
            field: 'date',
            blocking: true,
            message
        });
    }

    if (normalizedMessage.includes('limite de anticipacion')) {
        return new ApiError({
            statusCode: 400,
            code: 'ADVANCE_LIMIT_EXCEEDED',
            field: 'date',
            blocking: true,
            message
        });
    }

    return new ApiError({
        statusCode: 400,
        code: rawCode || 'BOOKING_CREATE_FAILED',
        field: 'general',
        blocking: true,
        message
    });
};

const createBillingConfigApiError = (error: unknown): ApiError => {
    const known = (error || {}) as any;
    const rawCode = String(known?.code || '').trim();
    const message = getErrorMessage(error, 'No se pudo guardar la configuración de cobro.');
    const lower = message
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (lower.includes('chargeresponsibleref')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'BILLING_MISSING_RESPONSIBLE',
            field: 'payment',
            blocking: true,
            message
        });
    }
    if (lower.includes('exactamente una asignación cobrable')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'BILLING_INVALID_ASSIGNMENTS',
            field: 'payment',
            blocking: true,
            message
        });
    }
    if (lower.includes('debe enviar al menos una asignación')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'BILLING_ASSIGNMENTS_REQUIRED',
            field: 'participants',
            blocking: true,
            message
        });
    }
    if (lower.includes('ya tiene pagos registrados')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'BILLING_CONFIG_LOCKED_BY_PAYMENTS',
            field: 'payment',
            blocking: true,
            message
        });
    }
    if (lower.includes('reserva completada') && lower.includes('participantes')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'BOOKING_COMPLETED_PARTICIPANTS_LOCKED',
            field: 'participants',
            blocking: true,
            message
        });
    }
    if (lower.includes('reserva no encontrada')) {
        return new ApiError({
            statusCode: 404,
            code: rawCode || 'BOOKING_NOT_FOUND',
            field: 'general',
            blocking: true,
            message
        });
    }
    if (lower.includes('club invalido')) {
        return new ApiError({
            statusCode: 400,
            code: rawCode || 'CLUB_INVALID',
            field: 'general',
            blocking: true,
            message
        });
    }

    return new ApiError({
        statusCode: 400,
        code: rawCode || 'BILLING_CONFIG_UPDATE_FAILED',
        field: 'payment',
        blocking: true,
        message
    });
};

export class BookingController {
    private productService = new ProductService();
    private duplicateIncidentService = new ClientDuplicateIncidentService();

    constructor(private bookingService: BookingService) {}

    private async resolveMembershipRoleForCourt(req: Request, courtId: number): Promise<string> {
        const explicitMembershipRole = String((req as any).membershipRole || '').trim();
        if (explicitMembershipRole) return explicitMembershipRole;

        const actorUserId = Number((req as any)?.user?.userId || 0);
        if (!Number.isInteger(actorUserId) || actorUserId <= 0) return '';
        if (!Number.isInteger(courtId) || courtId <= 0) return '';

        const court = await prisma.court.findUnique({
            where: { id: courtId },
            select: { clubId: true }
        });
        const clubId = Number(court?.clubId || 0);
        if (!Number.isInteger(clubId) || clubId <= 0) return '';

        const membership = await prisma.membership.findUnique({
            where: {
                userId_clubId: {
                    userId: actorUserId,
                    clubId
                }
            },
            select: { role: true }
        });

        return String(membership?.role || '').trim();
    }

    private async registerDuplicateIncidentFromBookingError(req: Request, sourceType: 'BOOKING' | 'FIXED_BOOKING', error: any) {
        try {
            const details = (error && typeof error === 'object') ? (error.details || {}) : {};
            let clubId = Number((req as any).clubId || details?.clubId || 0);
            if ((!Number.isInteger(clubId) || clubId <= 0) && Number.isInteger(Number(req.body?.courtId))) {
                const court = await prisma.court.findUnique({
                    where: { id: Number(req.body.courtId) },
                    select: { clubId: true }
                });
                clubId = Number(court?.clubId || 0);
            }
            if (!Number.isInteger(clubId) || clubId <= 0) return;

            const actorUserId = Number((req as any)?.user?.userId || 0);
            const userId =
                Number(details?.userId || 0) > 0
                    ? Number(details.userId)
                    : (Number(req.body?.userId || 0) > 0 ? Number(req.body.userId) : null);

            const candidateClientIds: string[] = Array.from(
                new Set(
                    (Array.isArray(details?.candidateClientIds) ? details.candidateClientIds : [])
                        .map((value: unknown) => String(value || '').trim())
                        .filter(Boolean)
                )
            );
            if (candidateClientIds.length === 0) return;

            await this.duplicateIncidentService.createOrReuseIncident({
                clubId,
                userId,
                sourceType,
                reasonType: String(details?.reasonType || 'MULTI_SIGNAL_CONFLICT'),
                primaryClientId: details?.primaryClientId ? String(details.primaryClientId) : null,
                candidateClientIds,
                payload: {
                    endpoint: sourceType === 'BOOKING' ? 'createBooking' : 'createFixedBooking',
                    signals: details?.signals || null,
                    actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null
                }
            });
        } catch (incidentError) {
            console.warn('No se pudo registrar incidente de duplicado en booking', incidentError);
        }
    }

    private async resolveCourtBookingContext(courtId: number): Promise<{ exists: boolean; country: string | null; timeZone: string }> {
        const court = await prisma.court.findUnique({
            where: { id: Number(courtId) },
            select: {
                id: true,
                club: {
                    select: {
                        country: true,
                        settings: {
                            select: {
                                timeZone: true
                            }
                        }
                    }
                }
            }
        });

        const country = String(court?.club?.country || '').trim() || null;
        const timeZone = String(court?.club?.settings?.timeZone || '').trim();

        return {
            exists: Boolean(court),
            country,
            timeZone
        };
    }

    createBooking = async (req: Request, res: Response) => {
        try {
            const user = (req as any).user;
            const userIdFromToken = user?.userId || null;

            const optionalTrimmedString = (minLength?: number) =>
                z.preprocess(
                    (v) => {
                        if (typeof v !== 'string') return v;
                        const trimmed = v.trim();
                        return trimmed.length === 0 ? undefined : trimmed;
                    },
                    minLength ? z.string().min(minLength).optional() : z.string().optional()
                );

            const createSchema = z.object({
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                // Accept either an ISO `startDateTime` or a `date` + `slotTime` pair (local)
                startDateTime: z.string().optional().refine((s) => s === undefined || !Number.isNaN(Date.parse(s)), { message: 'Fecha/hora ISO inválida' }),
                date: z.string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Formato de fecha inválido. Usá YYYY-MM-DD' })
                    .optional(),
                slotTime: z.string()
                    .regex(/^\d{2}:\d{2}$/, { message: 'Formato de hora inválido. Usá HH:mm' })
                    .optional(),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                clientId: optionalTrimmedString(),
                client: z.object({
                    name: optionalTrimmedString(2),
                    phone: optionalTrimmedString(),
                    phoneCountryCode: optionalTrimmedString(),
                    phoneNumberLocal: optionalTrimmedString(),
                    email: z.preprocess(
                        (v) => {
                            if (typeof v !== 'string') return v;
                            const trimmed = v.trim();
                            return trimmed.length === 0 ? undefined : trimmed;
                        },
                        z.string().email().optional()
                    ),
                    dni: optionalTrimmedString(),
                    /** Caso C: el admin confirmó crear un cliente nuevo pese a candidatos existentes */
                    duplicateResolution: z.enum(['CREATE_NEW']).optional()
                }).optional(),
                applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
            });

            const dataToValidate = {
                ...req.body
            };

            const parsed = createSchema.safeParse(dataToValidate);

            if (!parsed.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Datos inválidos para crear la reserva.',
                    meta: { issues: parsed.error.flatten() }
                });
            }

            let { courtId, startDateTime, date: dateStr, slotTime, activityId, durationMinutes, clientId, client, applyDiscount } = parsed.data;
            clientId = clientId ? sanitizeString(clientId, 64) : undefined;
            const sanitizedClient = client
                ? {
                    name: client.name ? sanitizeString(client.name, 200) : '',
                    phone: client.phone ? sanitizeString(client.phone, 30) : undefined,
                    phoneCountryCode: client.phoneCountryCode ? sanitizeString(client.phoneCountryCode, 8) : undefined,
                    phoneNumberLocal: client.phoneNumberLocal ? sanitizeString(client.phoneNumberLocal, 30) : undefined,
                    email: client.email ? sanitizeString(client.email, 254) : undefined,
                    dni: client.dni ? sanitizeString(client.dni, 20) : undefined,
                    duplicateResolution: client.duplicateResolution ?? undefined
                }
                : undefined;

            const courtContext = await this.resolveCourtBookingContext(Number(courtId));
            if (!courtContext.exists) {
                return sendApiError(res, {
                    statusCode: 404,
                    code: 'COURT_NOT_FOUND',
                    field: 'court',
                    blocking: true,
                    message: 'Cancha no encontrada.'
                });
            }
            const clubTimeZone = String(courtContext.timeZone || '').trim();
            if (!clubTimeZone) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'CLUB_CONFIG_INVALID',
                    field: 'general',
                    blocking: true,
                    message: 'Configuración de club inválida: timeZone es obligatorio.'
                });
            }

            // Resolve startDate: prefer date+slotTime (local) if provided, otherwise use startDateTime ISO
            let startDate: Date;
            if (dateStr && slotTime) {
                try {
                    startDate = TimeHelper.localSlotToUtc(dateStr, slotTime, clubTimeZone);
                } catch (e) {
                    return sendApiError(res, {
                        statusCode: 400,
                        code: 'INVALID_DATE_TIME',
                        field: 'time',
                        blocking: true,
                        message: 'Combinación fecha/horario inválida o zona horaria del club faltante.'
                    });
                }
            } else if (startDateTime) {
                startDate = new Date(String(startDateTime));
                if (Number.isNaN(startDate.getTime())) {
                    return sendApiError(res, {
                        statusCode: 400,
                        code: 'INVALID_DATE_TIME',
                        field: 'time',
                        blocking: true,
                        message: 'startDateTime invalido.'
                    });
                }
            } else {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'MISSING_DATE_TIME',
                    field: 'time',
                    blocking: true,
                    message: 'Debe enviar startDateTime o (date y slotTime).'
                });
            }
            const membershipRole = await this.resolveMembershipRoleForCourt(req, Number(courtId));
            const isTenantOperator = TENANT_OPERATOR_ROLES.has(membershipRole);
            const canApplyDiscountOverride = TENANT_ADMIN_ROLES.has(membershipRole);
            const tokenUserId = userIdFromToken ? Number(userIdFromToken) : null;
            const now = new Date();
            if (startDate.getTime() < now.getTime()) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'BOOKING_IN_PAST',
                    field: 'time',
                    blocking: true,
                    message: 'No se pueden reservar turnos en el pasado.'
                });
            }

            const normalizedDraftPhone = normalizeIdentityPhone(
                {
                    phone: sanitizedClient?.phone,
                    countryCode: sanitizedClient?.phoneCountryCode,
                    phoneNumberLocal: sanitizedClient?.phoneNumberLocal
                },
                { defaultCountryIso2: String(courtContext.country || '').trim() || null }
            );

            const adminClientDraft = isTenantOperator
                ? {
                    name: sanitizedClient?.name || '',
                    phone: normalizedDraftPhone || undefined,
                    email: sanitizedClient?.email,
                    dni: sanitizedClient?.dni,
                    duplicateResolution: sanitizedClient?.duplicateResolution ?? undefined
                }
                : undefined;

            const hasAdminClientInput = Boolean(clientId || adminClientDraft?.name);
            const useAdminClientMode = Boolean(isTenantOperator && hasAdminClientInput);
            const effectiveUserId = useAdminClientMode ? null : tokenUserId;

            if (!effectiveUserId && !useAdminClientMode) {
                if (resolveOptionalAuthState(req) === 'invalid_token') {
                    return sendAuthError(res, 401, 'AUTH_INVALID', 'Sesión inválida. Volvé a iniciar sesión.');
                }
                return sendAuthError(res, 401, 'AUTH_MISSING', 'Debes iniciar sesión para reservar.');
            }

            // 1. CREAR LA RESERVA
            const result = await this.bookingService.createBooking(
                effectiveUserId,
                Number(courtId),
                startDate,
                Number(activityId),
                durationMinutes,
                useAdminClientMode,
                {
                    applyDiscount: useAdminClientMode && canApplyDiscountOverride ? applyDiscount : false,
                    actorUserId: Number(user?.userId || 0) || null,
                    clientId: clientId || null,
                    clientDraft: useAdminClientMode && adminClientDraft?.name ? adminClientDraft : null
                }
            );

            // Retornamos la respuesta al cliente
            const localForRefresh = TimeHelper.utcToLocal(startDate, clubTimeZone);
            const refreshDate = `${localForRefresh.getFullYear()}-${String(localForRefresh.getMonth() + 1).padStart(2, '0')}-${String(localForRefresh.getDate()).padStart(2, '0')}`;

            const payload = { ...result, refresh: true, refreshDate };
            res.status(201).json(payload);

        } catch (error: any) {
            if (error?.code === 'CLIENT_POSSIBLE_DUPLICATE' || error?.message === 'CLIENT_POSSIBLE_DUPLICATE') {
                await this.registerDuplicateIncidentFromBookingError(req, 'BOOKING', error);
            }
            const mapped = createBookingApiError(error);
            return sendApiError(res, mapped);
        }
    }

    quoteBookingPrice = async (req: Request, res: Response) => {
        try {
            const optionalTrimmedString = () =>
                z.preprocess(
                    (v) => {
                        if (typeof v !== 'string') return v;
                        const trimmed = v.trim();
                        return trimmed.length === 0 ? undefined : trimmed;
                    },
                    z.string().optional()
                );

            const quoteSchema = z.object({
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                clientId: optionalTrimmedString(),
                startDateTime: z.string().optional().refine((s) => s === undefined || !Number.isNaN(Date.parse(s)), { message: 'Fecha/hora ISO inválida' }),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                slotTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
                durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                clientEmail: z.preprocess(
                    (v) => {
                        if (typeof v !== 'string') return v;
                        const trimmed = v.trim();
                        return trimmed.length === 0 ? undefined : trimmed;
                    },
                    z.string().email().optional()
                ),
                clientPhone: optionalTrimmedString(),
                clientPhoneCountryCode: optionalTrimmedString(),
                clientPhoneNumberLocal: optionalTrimmedString(),
                clientDni: optionalTrimmedString(),
                applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
            });

            const parsed = quoteSchema.safeParse(req.body ?? {});
            if (!parsed.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Datos inválidos para cotizar la reserva.',
                    meta: { issues: parsed.error.flatten() }
                });
            }

            const {
                courtId,
                activityId,
                clientId,
                startDateTime,
                date: dateStr,
                slotTime,
                durationMinutes,
                clientEmail,
                clientPhone,
                clientPhoneCountryCode,
                clientPhoneNumberLocal,
                clientDni,
                applyDiscount
            } = parsed.data;

            const courtCountry = await prisma.court.findUnique({
                where: { id: Number(courtId) },
                select: { club: { select: { country: true } } }
            });
            const normalizedClientPhone = normalizeIdentityPhone(
                {
                    phone: clientPhone,
                    countryCode: clientPhoneCountryCode,
                    phoneNumberLocal: clientPhoneNumberLocal
                },
                { defaultCountryIso2: String(courtCountry?.club?.country || '').trim() || null }
            );
            const hasAnyClientPhoneInput =
                Boolean(String(clientPhone || '').trim()) ||
                Boolean(String(clientPhoneNumberLocal || '').trim());
            if (hasAnyClientPhoneInput && !normalizedClientPhone) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'INVALID_CLIENT_PHONE',
                    field: 'owner',
                    blocking: true,
                    message: 'Teléfono inválido para cotización.'
                });
            }

            let resolvedStart: Date;
            if (dateStr && slotTime) {
                const court = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: { include: { settings: true } } } });
                const tz = String(court?.club?.settings?.timeZone || '').trim();
                if (!tz) {
                    return sendApiError(res, {
                        statusCode: 400,
                        code: 'CLUB_CONFIG_INVALID',
                        field: 'general',
                        blocking: true,
                        message: 'Configuración de club inválida: timeZone es obligatorio.'
                    });
                }
                resolvedStart = TimeHelper.localSlotToUtc(dateStr, slotTime, tz);
            } else if (startDateTime) {
                resolvedStart = new Date(String(startDateTime));
                if (Number.isNaN(resolvedStart.getTime())) {
                    return sendApiError(res, {
                        statusCode: 400,
                        code: 'INVALID_DATE_TIME',
                        field: 'time',
                        blocking: true,
                        message: 'startDateTime invalido.'
                    });
                }
            } else {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'MISSING_DATE_TIME',
                    field: 'time',
                    blocking: true,
                    message: 'Debe enviar startDateTime o (date y slotTime).'
                });
            }

            const tokenUserId = Number((req as any).user?.userId || 0);
            const membershipRole = await this.resolveMembershipRoleForCourt(req, Number(courtId));
            const isTenantOperator = TENANT_OPERATOR_ROLES.has(membershipRole);
            const canApplyDiscountOverride = TENANT_ADMIN_ROLES.has(membershipRole);
            const quote = await this.bookingService.quoteBookingPrice({
                userId: tokenUserId > 0 ? tokenUserId : null,
                allowAdminBenefits: isTenantOperator,
                clientId: clientId || null,
                courtId: Number(courtId),
                activityId: Number(activityId),
                startDateTime: resolvedStart,
                durationMinutes,
                clientEmail,
                clientPhone: normalizedClientPhone || undefined,
                clientDni,
                applyDiscount: canApplyDiscountOverride ? applyDiscount : false
            });

            return res.json({
                ...quote,
                authState: resolveOptionalAuthState(req)
            });
        } catch (error: any) {
            const mapped = createBookingApiError(error);
            return sendApiError(res, new ApiError({
                statusCode: mapped.statusCode,
                code: mapped.code === 'BOOKING_CREATE_FAILED' ? 'BOOKING_QUOTE_FAILED' : mapped.code,
                field: mapped.field,
                blocking: mapped.blocking,
                message: getErrorMessage(error, 'No se pudo cotizar la reserva.'),
                meta: mapped.meta,
                retryable: mapped.retryable
            }));
        }
    }

    getAvailability = async (req: Request, res: Response) => {
    try {
        const querySchema = z.object({
            courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato inválido. Use YYYY-MM-DD (ej: 2026-01-06)" }),
            activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
            durationMinutes: z.preprocess(
                (v) => (v === undefined ? undefined : Number(v)),
                z.number().int().positive().optional()
            )
        });

        const parsed = querySchema.safeParse(req.query); 

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { courtId, date, activityId, durationMinutes } = parsed.data;

        // En lugar de new Date(date), separamos los componentes para que sea "Día Puro"
        const [year, month, day] = String(date).split('-').map(Number);
        const searchDate = new Date(year, month - 1, day);

        const slots = await this.bookingService.getAvailableSlots(
            Number(courtId),
            searchDate,
            Number(activityId),
            durationMinutes
        );

        res.json({ date: date, availableSlots: slots });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
}

    cancelBooking = async (req: Request, res: Response) => {
        try {
            const cancelSchema = z.object({
                bookingId: z.preprocess((v) => Number(v), z.number().int().positive()),
                refund: z.object({
                    amount: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().positive().optional()),
                    executeNow: z.boolean().optional(),
                    reasonType: z.enum(['FULL', 'PARTIAL_COMMERCIAL', 'PARTIAL_SERVICE_FAILURE', 'PARTIAL_PRICING_ERROR', 'OTHER']).optional(),
                    executionNotes: z.string().trim().max(500).optional()
                }).optional()
            });
            const parsed = cancelSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { bookingId } = parsed.data;
            const user = (req as any).user;
            const clubId = (req as any).clubId;
            const result = await this.bookingService.cancelBooking(Number(bookingId), user?.userId, clubId, {
                refund: parsed.data.refund
                    ? {
                        amount: parsed.data.refund.amount,
                        executeNow: parsed.data.refund.executeNow,
                        reasonType: parsed.data.refund.reasonType,
                        executionNotes: parsed.data.refund.executionNotes
                    }
                    : undefined
            });
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            if (error.message === "No tienes acceso a esta reserva") {
                return sendAuthError(res, 403, 'AUTH_FORBIDDEN', error.message);
            }
            if (isIntegrityInconsistencyError(error)) {
                return res.status(409).json({ error: getErrorMessage(error, 'Inconsistencia de integridad en reserva') });
            }
            res.status(400).json({ error: error.message });
        }
    }

    confirmBooking = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id ?? req.body?.bookingId);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return res.status(400).json({ error: 'bookingId inválido' });
            }
            const actorUserId = Number((req as any).user?.userId);
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const booking = await this.bookingService.confirmBooking(bookingId, actorUserId, clubId);
            return res.json({ message: 'Reserva confirmada', booking });
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'No se pudo confirmar la reserva' });
        }
    }

    completeBooking = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id ?? req.body?.bookingId);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return res.status(400).json({ error: 'bookingId inválido' });
            }
            const actorUserId = Number((req as any).user?.userId);
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const booking = await this.bookingService.completeBooking(bookingId, actorUserId, clubId);
            return res.json({ message: 'Reserva completada', booking });
        } catch (error: any) {
            if (isIntegrityInconsistencyError(error)) {
                return res.status(409).json({ error: getErrorMessage(error, 'Inconsistencia de integridad en reserva') });
            }
            return res.status(400).json({ error: error.message || 'No se pudo completar la reserva' });
        }
    }

    getHistory = async (req: Request, res: Response) => {
        try {
            const userId = Number(req.params.userId);
            if (!Number.isInteger(userId) || userId < 1) {
                return res.status(400).json({ error: 'userId inválido' });
            }
            const pageRaw = Number(req.query.page ?? 0);
            const takeRaw = Number(req.query.take ?? 50);
            const page = Number.isInteger(pageRaw) && pageRaw >= 0 ? pageRaw : 0;
            const take = Number.isInteger(takeRaw) && takeRaw > 0 ? Math.min(takeRaw, 100) : 50;
            const user = (req as any).user;
            if (!user?.userId) {
                return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
            }
            let preferredClubId: number | undefined;
            try {
                preferredClubId = getPreferredClubIdFromRequest(req);
            } catch (error: any) {
                return res.status(400).json({ error: error?.message || 'Contexto de club inválido' });
            }
            let clubContext: { clubId: number; role: string } | null = null;
            try {
                clubContext = await getUserClubContext(Number(user.userId), preferredClubId);
            } catch {
                clubContext = null;
            }
            const requestRole = String(clubContext?.role || (req as any).membershipRole || user.role || 'MEMBER');
            const requestUser = {
                userId: user.userId,
                role: requestRole,
                clubId: clubContext?.clubId ?? null
            };
            const history = await this.bookingService.getUserHistory(userId, requestUser, page, take);
            const payload = history.map((b: any) => ({
                ...b,
                court: b.court ? {
                    id: b.court.id,
                    name: b.court.name,
                    club: b.court.club ? {
                        id: b.court.club.id,
                        name: b.court.club.name,
                        slug: b.court.club.slug,
                        // Exponer datos de ubicación para el frontend
                        addressLine: b.court.club.addressLine || null,
                        address: b.court.club.addressLine || null,
                        street: b.court.club.addressLine || null,
                        city: b.court.club.city || null,
                        province: b.court.club.province || null,
                        phone: b.court.club.phone || null
                    } : null
                } : null,
                items: Array.isArray(b.items)
                    ? b.items.map((item: any) => ({
                        id: item.id,
                        quantity: item.quantity,
                        price: item.price,
                        product: item.product ? { id: item.product.id, name: item.product.name } : null
                    }))
                    : []
            }));
            res.json(payload);
        } catch (error: any) {
            if (error.message === "No tienes permiso para ver el historial de otro usuario") {
                return sendAuthError(res, 403, 'AUTH_FORBIDDEN', error.message);
            }
            res.status(400).json({ error: error.message });
        }
    }

    getById = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const bookingId = parsed.data.id;
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const [booking, financialSummary] = await Promise.all([
                this.bookingService.getBookingById(bookingId, clubId),
                this.bookingService.getBookingFinancialSummary(bookingId, clubId)
            ]);

            return res.json({ booking, financialSummary });
        } catch (error: any) {
            return res.status(404).json({ error: error.message || 'Reserva no encontrada' });
        }
    }

    getAvailableSlotsWithCourts = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
            // Aceptamos cualquier string de fecha y después la procesamos nosotros
            date: z.string(), 
            activityId: z.preprocess((v) => Number(v), z.number()),
            clubSlug: z.string().optional(),
            clientId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().optional()),
            clientEmail: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().email().optional()),
            clientPhone: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().optional()),
            clientDni: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().optional()),
            durationMinutes: z.preprocess(
                (v) => (v === undefined || v === '' ? undefined : Number(v)),
                z.number().optional()
            )

            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId, clubSlug, clientId, clientEmail, clientPhone, clientDni, durationMinutes } = parsed.data;

            // Blindaje matemático para que la fecha no se atrase un día por el UTC
            const [year, month, day] = String(date).split('-').map(Number);
            const searchDate = new Date(year, month - 1, day);

            let clubId: number | undefined;
            if (clubSlug && typeof clubSlug === 'string' && clubSlug.trim()) {
                const club = await prisma.club.findUnique({ where: { slug: clubSlug.trim() } });
                if (club) clubId = club.id;
            }

            const availability = await this.bookingService.getAvailableSlotsWithCourts(
                searchDate,
                Number(activityId),
                clubId,
                durationMinutes,
                {
                    clientId: clientId || null,
                    userId: Number((req as any)?.user?.userId || 0) || null,
                    clientEmail: clientEmail || undefined,
                    clientPhone: clientPhone || undefined,
                    clientDni: clientDni || undefined
                }
            );

            res.json({
                date: date,
                slotsWithCourts: availability.slotsWithCourts,
                professorOverrideAvailable: availability.professorOverrideAvailable,
                professorDurationOverrideMinutes: availability.professorDurationOverrideMinutes,
                authState: resolveOptionalAuthState(req)
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getAdminSchedule = async (req: Request, res: Response) => {
        try {
            const { date } = req.query;
            if (!date) {
                return res.status(400).json({ error: "Falta el parámetro 'date' (ej: ?date=2025-10-25)" });
            }

            // Crear fecha sin zona horaria específica para evitar problemas
            const [year, month, day] = String(date).split('-').map(Number);
            const searchDate = new Date(year, month - 1, day);

            // Obtener clubId del request (agregado por middleware de verificación de club)
            const clubId = (req as any).clubId;

            const bookings = await this.bookingService.getDaySchedule(searchDate, clubId);
            res.json(bookings);
        } catch (error: any) {
            console.error('Error en getAdminSchedule:', error);
            if (isIntegrityInconsistencyError(error)) {
                return res.status(409).json({ error: getErrorMessage(error, 'Inconsistencia de integridad en agenda') });
            }
            res.status(500).json({ error: getErrorMessage(error, 'Error interno al cargar agenda') });
        }
    }

    rescheduleBooking = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const bodySchema = z.object({
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'startDateTime inválido' }),
                durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
            });

            const p = paramsSchema.safeParse(req.params);
            const b = bodySchema.safeParse(req.body || {});
            if (!p.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Parámetros inválidos para mover la reserva.',
                    meta: { issues: p.error.flatten() }
                });
            }
            if (!b.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'time',
                    blocking: true,
                    message: 'Datos inválidos para mover la reserva.',
                    meta: { issues: b.error.flatten() }
                });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'CLUB_INVALID',
                    field: 'general',
                    blocking: true,
                    message: 'Club invalido.'
                });
            }

            const updated = await this.bookingService.rescheduleBooking({
                bookingId: p.data.id,
                clubId,
                courtId: b.data.courtId,
                startDateTime: new Date(b.data.startDateTime),
                durationMinutes: b.data.durationMinutes,
                actorUserId: Number((req as any)?.user?.userId || 0) || null
            });
            return res.json({ booking: updated });
        } catch (error: any) {
            if (error?.code === 'BOOKING_OVERLAP') {
                return sendApiError(res, new ApiError({
                    statusCode: 409,
                    code: 'BOOKING_OVERLAP',
                    field: 'time',
                    blocking: true,
                    message: getErrorMessage(error, 'Superposicion detectada'),
                    meta: Array.isArray(error?.overlaps) ? { overlaps: error.overlaps } : undefined
                }));
            }
            return sendApiError(res, new ApiError({
                statusCode: 400,
                code: 'BOOKING_RESCHEDULE_FAILED',
                field: 'general',
                blocking: true,
                message: getErrorMessage(error, 'No se pudo mover la reserva.')
            }));
        }
    }

    getBookingBillingConfig = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Parámetros inválidos para leer la configuración de cobro.',
                    meta: { issues: parsed.error.flatten() }
                });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'CLUB_INVALID',
                    field: 'general',
                    blocking: true,
                    message: 'Club invalido.'
                });
            }

            const config = await this.bookingService.getBookingBillingConfig(parsed.data.id, clubId);
            return res.json(config);
        } catch (error: any) {
            return sendApiError(res, new ApiError({
                statusCode: 400,
                code: 'BILLING_CONFIG_FETCH_FAILED',
                field: 'payment',
                blocking: true,
                message: getErrorMessage(error, 'No se pudo obtener la configuración de cobro.')
            }));
        }
    }

    upsertBookingBillingConfig = async (req: Request, res: Response) => {
        // Commit 4 — P1 note: participants are intentionally isolated from booking
        // identity. upsertBookingBillingConfig never writes to Booking.clientId.
        // The only path that changes the titular is PATCH /:id/client (Commit 3).
        // A future hardening pass should verify that chargeResponsibleRef cannot
        // silently redirect payments away from the account owner without an explicit
        // admin action. Tracking as P1 until billing aggregation is audited end-to-end.

        // Commit 4 — participantRef prefix whitelist.
        // Only well-known prefixes are accepted; unknown formats are rejected at
        // the boundary so they can never reach normalization logic downstream.
        const PARTICIPANT_REF_PREFIXES = [
            'booking-client:',
            'booking-user:',
            'guest:',
            'client:',
            'user:'
        ] as const;
        const isValidParticipantRef = (ref: string): boolean => {
            const lower = ref.toLowerCase();
            return PARTICIPANT_REF_PREFIXES.some((prefix) => {
                if (!lower.startsWith(prefix)) return false;
                const suffix = ref.slice(prefix.length).trim();
                return suffix.length > 0;
            });
        };

        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const bodySchema = z.object({
                chargeMode: z.enum(['INDIVIDUAL', 'SHARED']),
                chargeResponsibleRef: z.preprocess(
                    (v) => (typeof v === 'string' && v.trim().length === 0 ? undefined : v),
                    z.string().trim().refine(
                        (v) => isValidParticipantRef(v),
                        { message: 'chargeResponsibleRef tiene un prefijo no reconocido.' }
                    ).optional()
                ),
                assignments: z.array(
                    z.object({
                        id: z.string().trim().min(1),
                        participantRef: z.string().trim().min(1).refine(
                            (v) => isValidParticipantRef(v),
                            { message: 'participantRef tiene un prefijo no reconocido.' }
                        ),
                        isChargeable: z.boolean(),
                        assignedAmount: z.preprocess((v) => Number(v), z.number().min(0)),
                        participantLinkState: z.enum(['ACTIVE', 'ARCHIVED_REFERENCE']).optional()
                    })
                ).min(1),
                metadata: z.record(z.unknown()).optional()
            });

            const p = paramsSchema.safeParse(req.params);
            const b = bodySchema.safeParse(req.body || {});
            if (!p.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Parámetros inválidos para guardar configuración de cobro.',
                    meta: { issues: p.error.flatten() }
                });
            }
            if (!b.success) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'payment',
                    blocking: true,
                    message: 'Datos inválidos para guardar configuración de cobro.',
                    meta: { issues: b.error.flatten() }
                });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return sendApiError(res, {
                    statusCode: 400,
                    code: 'CLUB_INVALID',
                    field: 'general',
                    blocking: true,
                    message: 'Club invalido.'
                });
            }

            const actorUserId = Number((req as any)?.user?.userId || 0) || null;
            const config = await this.bookingService.upsertBookingBillingConfig({
                bookingId: p.data.id,
                clubId,
                actorUserId,
                chargeMode: b.data.chargeMode,
                chargeResponsibleRef: b.data.chargeResponsibleRef || null,
                assignments: b.data.assignments.map((assignment) => ({
                    id: assignment.id,
                    participantRef: assignment.participantRef,
                    isChargeable: assignment.isChargeable,
                    assignedAmount: Number(assignment.assignedAmount),
                    participantLinkState: assignment.participantLinkState || 'ACTIVE'
                })),
                metadata: b.data.metadata || null
            });
            return res.json(config);
        } catch (error: any) {
            return sendApiError(res, createBillingConfigApiError(error));
        }
    }
    
    createFixed = async (req: Request, res: Response) => {
        try {
            const optionalTrimmedString = (minLength?: number) =>
                z.preprocess(
                    (v) => {
                        if (typeof v !== 'string') return v;
                        const trimmed = v.trim();
                        return trimmed.length === 0 ? undefined : trimmed;
                    },
                    minLength ? z.string().min(minLength).optional() : z.string().optional()
                );

            const createFixedSchema = z.object({
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'startDateTime debe ser una fecha ISO válida' }),
                durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                userId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                clientId: optionalTrimmedString(),
                client: z.object({
                    name: optionalTrimmedString(2),
                    phone: optionalTrimmedString(),
                    email: z.preprocess(
                        (v) => {
                            if (typeof v !== 'string') return v;
                            const trimmed = v.trim();
                            return trimmed.length === 0 ? undefined : trimmed;
                        },
                        z.string().email().optional()
                    ),
                    dni: optionalTrimmedString()
                }).optional(),
                allowOverlappingSeries: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional(),
                everyDays: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                repetitions: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                previewConflictsOnly: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            });
            const parsed = createFixedSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { userId, courtId, activityId, startDateTime, durationMinutes, clientId, client, allowOverlappingSeries, everyDays, repetitions, previewConflictsOnly } = parsed.data;
            const user = (req as any).user;
            const membershipRole = String((req as any).membershipRole || '').trim();
            const isTenantOperator = TENANT_OPERATOR_ROLES.has(membershipRole);
            const clubId = (req as any).clubId;

            if (!isTenantOperator) {
                return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes permisos para crear turnos fijos.');
            }

            const sanitizedClient = client
                ? {
                    name: client.name ? sanitizeString(client.name, 200) : '',
                    phone: client.phone ? sanitizeString(client.phone, 30) : undefined,
                    email: client.email ? sanitizeString(client.email, 254) : undefined,
                    dni: client.dni ? sanitizeString(client.dni, 20) : undefined
                }
                : undefined;

            const sanitizedClientId = clientId ? sanitizeString(clientId, 64) : undefined;
            const safeClientId =
                sanitizedClientId && !['undefined', 'null', 'nan'].includes(String(sanitizedClientId).toLowerCase())
                    ? sanitizedClientId
                    : undefined;
            if (!previewConflictsOnly && !safeClientId && !userId && !sanitizedClient?.name) {
                return res.status(400).json({ error: "Debes seleccionar un cliente o cargar un alta rápida." });
            }

            const startDate = new Date(startDateTime);

            const result = await this.bookingService.createFixedBooking(
                courtId, 
                activityId, 
                startDate,
                {
                    userId: userId ? Number(userId) : null,
                    clientId: safeClientId || null,
                    clientDraft: sanitizedClient?.name ? sanitizedClient : null,
                    clubId,
                    actorUserId: Number(user?.userId || 0) || null,
                    allowOverlappingSeries: Boolean(allowOverlappingSeries),
                    durationMinutes,
                    everyDays,
                    repetitions,
                    previewConflictsOnly: Boolean(previewConflictsOnly)
                }
            );
            
            res.status(201).json(result);
        } catch (error: any) {
            if (error?.code === 'CLIENT_POSSIBLE_DUPLICATE' || error?.message === 'CLIENT_POSSIBLE_DUPLICATE') {
                await this.registerDuplicateIncidentFromBookingError(req, 'FIXED_BOOKING', error);
                return res.status(409).json({
                    error: 'Se detectaron datos que podrían corresponder a más de un cliente. Revisá y seleccioná el cliente correcto.'
                });
            }
            if (error?.code === 'FIXED_BOOKING_OVERLAP') {
                return res.status(409).json({
                    error: 'El turno fijo se superpone con otro turno fijo existente.',
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : [],
                    canProceed: true
                });
            }
            if (error?.code === 'FIXED_BOOKING_NO_OCCURRENCES') {
                return res.status(409).json({
                    error: error.message || 'No se pudo crear ningún turno fijo por superposición.',
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : []
                });
            }
            res.status(400).json({ error: error.message });
        }
    }

    cancelFixed = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const bodySchema = z.object({
                scope: z.enum(['THIS_OCCURRENCE', 'NEXT_OCCURRENCES', 'ALL_OCCURRENCES']).optional(),
                occurrenceBookingId: z.preprocess(
                    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
                    z.number().int().positive().optional()
                ),
                previewOnly: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            }).optional();

            const parsedParams = paramsSchema.safeParse(req.params);
            if (!parsedParams.success) {
                return res.status(400).json({ error: 'ID de turno fijo inválido.' });
            }
            const parsedBody = bodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({ error: parsedBody.error.format() });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const result = await this.bookingService.cancelFixedBooking({
                fixedBookingId: parsedParams.data.id,
                clubId,
                scope: parsedBody.data?.scope || 'ALL_OCCURRENCES',
                occurrenceBookingId: parsedBody.data?.occurrenceBookingId,
                previewOnly: Boolean(parsedBody.data?.previewOnly),
                actorUserId: Number((req as any)?.user?.userId || 0) || null
            });
            res.json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    rescheduleFixed = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const bodySchema = z.object({
                scope: z.enum(['THIS_OCCURRENCE', 'NEXT_OCCURRENCES', 'ALL_OCCURRENCES']),
                occurrenceBookingId: z.preprocess(
                    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
                    z.number().int().positive().optional()
                ),
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'startDateTime inválido' }),
                durationMinutes: z.preprocess(
                    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
                    z.number().int().positive().optional()
                ),
                previewOnly: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            });

            const parsedParams = paramsSchema.safeParse(req.params);
            const parsedBody = bodySchema.safeParse(req.body || {});
            if (!parsedParams.success) {
                return res.status(400).json({ error: 'ID de turno fijo inválido.' });
            }
            if (!parsedBody.success) {
                return res.status(400).json({ error: parsedBody.error.format() });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const result = await this.bookingService.rescheduleFixedBooking({
                fixedBookingId: parsedParams.data.id,
                clubId,
                scope: parsedBody.data.scope,
                occurrenceBookingId: parsedBody.data.occurrenceBookingId,
                courtId: parsedBody.data.courtId,
                startDateTime: new Date(parsedBody.data.startDateTime),
                durationMinutes: parsedBody.data.durationMinutes,
                previewOnly: Boolean(parsedBody.data.previewOnly),
                actorUserId: Number((req as any)?.user?.userId || 0) || null
            });
            return res.json(result);
        } catch (error: any) {
            if (error?.code === 'BOOKING_OVERLAP') {
                return res.status(409).json({
                    error: String(error?.message || 'Superposición detectada'),
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : []
                });
            }
            return res.status(400).json({ error: error?.message || 'No se pudo editar la serie.' });
        }
    }

    // OBTENER CONSUMOS (GET)
    getItems = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const items = await this.bookingService.getBookingItems(Number(id), clubId);
            
            res.json(items);
        } catch (error) {
            console.error(error);
            if (isIntegrityInconsistencyError(error)) {
                return res.status(409).json({ error: getErrorMessage(error, 'Inconsistencia de integridad en consumos') });
            }
            res.status(500).json({ error: getErrorMessage(error, 'Error al obtener los consumos') });
        }
    }

    //  AGREGAR CONSUMO (POST)
    async addItem(req: Request, res: Response) {
        try {
            const addItemSchema = z.object({
                bookingId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                productId: z.preprocess((v) => Number(v), z.number().int().positive()),
                quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
                paymentMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
                applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
            });
            const paramId = req.params.id || req.params.bookingId;
            const bodyParsed = addItemSchema.safeParse(req.body);
            if (!bodyParsed.success) {
                return res.status(400).json({ error: bodyParsed.error.format() });
            }
            const { productId, quantity, paymentMethod, applyDiscount } = bodyParsed.data;
            const rawBookingId = paramId ?? bodyParsed.data.bookingId;
            if (rawBookingId === undefined || rawBookingId === null) {
                return res.status(400).json({ error: "Falta el ID de la reserva (bookingId en URL o body)" });
            }
            const bookingId = Number(rawBookingId);
            if (!Number.isInteger(bookingId) || bookingId < 1) {
                return res.status(400).json({ error: "bookingId inválido" });
            }
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: "Club inválido" });
            }
            const newItem = await this.bookingService.addItemToBooking(
                bookingId,
                Number(productId),
                Number(quantity),
                clubId,
                paymentMethod ?? 'CASH',
                { applyDiscount, actorUserId: Number((req as any).user?.userId || 0) || null }
            );

            return res.json(newItem);

    } catch (error: any) { // Le ponemos 'any' para poder leer el mensaje
        console.error("Error en addItem:", error);
        // Devolvemos el error real para verlo en el frontend
        return res.status(500).json({ 
            error: "Error al agregar item: " + (error.message || "Desconocido") 
        });
    }
}

    // COTIZAR CONSUMO (POST) - sin persistir
    quoteItem = async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                productId: z.preprocess((v) => Number(v), z.number().int().positive()),
                quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
                applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
            });
            const paramId = req.params.id || req.params.bookingId;
            const bodyParsed = schema.safeParse(req.body);
            if (!bodyParsed.success) {
                return res.status(400).json({ error: bodyParsed.error.format() });
            }
            const rawBookingId = paramId;
            const bookingId = Number(rawBookingId);
            if (!Number.isInteger(bookingId) || bookingId < 1) {
                return res.status(400).json({ error: "bookingId inválido" });
            }
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: "Club inválido" });
            }

            const result = await this.bookingService.quoteItemForBooking(
                bookingId,
                Number(bodyParsed.data.productId),
                Number(bodyParsed.data.quantity),
                clubId,
                { applyDiscount: bodyParsed.data.applyDiscount }
            );
            return res.json(result);
        } catch (error: any) {
            const message = String(error?.message || 'Error al cotizar consumo');
            return res.status(400).json({ error: message });
        }
    }

    //  ELIMINAR CONSUMO (DELETE)
    removeItem = async (req: Request, res: Response) => {
        try {
            const { itemId } = req.params;
            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            await this.bookingService.removeItemFromBooking(String(itemId), clubId);
            
            res.json({ message: 'Consumo eliminado y stock devuelto' });
        } catch (error: any) {
            console.error(error);
            const message = String(error?.message || '');
            const known =
                message.includes('Item no encontrado') ||
                message.includes('No tienes acceso') ||
                message.includes('cuentas abiertas') ||
                message.includes('cancha no se puede eliminar') ||
                message.includes('pagos asociados') ||
                message.includes('sobrepagada');
            res.status(known ? 400 : 500).json({ error: message || 'Error al eliminar el consumo' });
        }
    }

    getDashboardStats = async (req: Request, res: Response) => {
    try {
        const clubId = Number((req as any).clubId);
        const { startDate, endDate } = req.query;

        const club = await prisma.club.findUnique({ where: { id: clubId }, include: { settings: true } });
        const timeZone = String(club?.settings?.timeZone || '').trim();
        if (!timeZone) {
            return res.status(400).json({ error: 'Configuración de club inválida: timeZone es obligatorio' });
        }

        const parseLocalDate = (value: string) => {
            const [y, m, d] = String(value).split('-').map(Number);
            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
            return new Date(y, m - 1, d);
        };

        const nowLocal = TimeHelper.utcToLocal(new Date(), timeZone);
        let startLocal = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), 1);
        let endLocal = new Date(nowLocal.getFullYear(), nowLocal.getMonth() + 1, 0);

        let start: Date;
        let end: Date;

        if (startDate && endDate) {
            const asDateStart = new Date(String(startDate));
            const asDateEnd = new Date(String(endDate));
            if (!Number.isNaN(asDateStart.getTime()) && !Number.isNaN(asDateEnd.getTime())) {
                start = asDateStart;
                end = asDateEnd;
            } else {
                const parsedStart = parseLocalDate(String(startDate));
                const parsedEnd = parseLocalDate(String(endDate));
                if (parsedStart && parsedEnd) {
                    startLocal = parsedStart;
                    endLocal = parsedEnd;
                }
                const rangeStart = TimeHelper.getUtcRangeForLocalDate(startLocal, timeZone);
                const rangeEnd = TimeHelper.getUtcRangeForLocalDate(endLocal, timeZone);
                start = rangeStart.startUtc;
                end = rangeEnd.endUtc;
            }
        } else {
            const rangeStart = TimeHelper.getUtcRangeForLocalDate(startLocal, timeZone);
            const rangeEnd = TimeHelper.getUtcRangeForLocalDate(endLocal, timeZone);
            start = rangeStart.startUtc;
            end = rangeEnd.endUtc;
        }

        let dailyRows: Array<{ day: string; turnos: number; bar: number }> = [];
        try {
            dailyRows = await prisma.$queryRaw<Array<{ day: string; turnos: number; bar: number }>>`
                WITH payments AS (
                    SELECT p."id",
                           p."createdAt",
                           p."amount",
                           a."sourceType"::text AS "sourceType"
                    FROM "Payment" p
                    JOIN "Account" a ON a."id" = p."accountId"
                    WHERE a."clubId" = ${clubId}
                      AND p."createdAt" >= ${start}
                      AND p."createdAt" <= ${end}
                ),
                alloc AS (
                    SELECT pa."paymentId",
                           COALESCE(SUM(CASE WHEN ai."type" = 'BOOKING' THEN pa."amount" ELSE 0 END), 0)::float8 AS booking_amount,
                           COALESCE(SUM(CASE WHEN ai."type" = 'BOOKING' THEN 0 ELSE pa."amount" END), 0)::float8 AS bar_amount
                    FROM "PaymentAllocation" pa
                    JOIN "AccountItem" ai ON ai."id" = pa."accountItemId"
                    GROUP BY pa."paymentId"
                )
                SELECT
                  to_char(day, 'DD/MM') AS day,
                  COALESCE(SUM(COALESCE(booking_amount, CASE WHEN "sourceType" = 'BOOKING' THEN amount ELSE 0 END)), 0)::float8 AS turnos,
                  COALESCE(SUM(COALESCE(bar_amount, CASE WHEN "sourceType" = 'BAR' THEN amount ELSE 0 END)), 0)::float8 AS bar
                FROM (
                  SELECT
                    DATE(timezone(${timeZone}::text, p."createdAt")) AS day,
                    p."amount" AS amount,
                    p."sourceType" AS "sourceType",
                    a.booking_amount,
                    a.bar_amount
                  FROM payments p
                  LEFT JOIN alloc a ON a."paymentId" = p."id"
                ) t
                GROUP BY day
                ORDER BY day ASC
            `;
        } catch (error: any) {
            const message = String(error?.message || '');
            if (!message.includes('PaymentAllocation') && !message.includes('42P01')) {
                throw error;
            }
            dailyRows = await prisma.$queryRaw<Array<{ day: string; turnos: number; bar: number }>>`
                SELECT
                  to_char(day, 'DD/MM') AS day,
                  COALESCE(SUM(CASE WHEN LOWER(concept) LIKE '%producto%' THEN 0 ELSE amount END), 0)::float8 AS turnos,
                  COALESCE(SUM(CASE WHEN LOWER(concept) LIKE '%producto%' THEN amount ELSE 0 END), 0)::float8 AS bar
                FROM (
                  SELECT
                    DATE(timezone(${timeZone}::text, "createdAt")) AS day,
                    "amount" AS amount,
                    "concept" AS concept
                  FROM "CashMovement"
                  WHERE "clubId" = ${clubId}
                    AND "type" = 'PAYMENT_IN'::"CashMovementPosType"
                    AND "createdAt" >= ${start}
                    AND "createdAt" <= ${end}
                ) t
                GROUP BY day
                ORDER BY day ASC
            `;
        }

        const [methodRows, playedBookings] = await Promise.all([
            prisma.$queryRaw<Array<{ method: string; value: number }>>`
                SELECT
                  "method"::text AS method,
                  COALESCE(SUM("amount"), 0)::float8 AS value
                FROM "CashMovement"
                WHERE "clubId" = ${clubId}
                  AND "type" = 'PAYMENT_IN'::"CashMovementPosType"
                  AND "createdAt" >= ${start}
                  AND "createdAt" <= ${end}
                GROUP BY "method"
            `,
            prisma.booking.count({
                where: {
                    clubId,
                    startDateTime: { gte: start, lte: end },
                    status: 'COMPLETED' 
                }
            })
        ]);

        const productAllRows = await prisma.$queryRaw<Array<{
            productId: number;
            name: string | null;
            quantity: number;
            revenue: number;
        }>>`
            WITH sales AS (
              SELECT
                ai."productId"::int AS "productId",
                COALESCE(SUM(ai."quantity"), 0)::int AS quantity,
                COALESCE(SUM(ai."total"), 0)::float8 AS revenue
              FROM "AccountItem" ai
              JOIN "Account" a ON a."id" = ai."accountId"
              WHERE a."clubId" = ${clubId}
                AND ai."type" = 'PRODUCT'::"AccountItemType"
                AND ai."createdAt" >= ${start}
                AND ai."createdAt" <= ${end}
                AND ai."productId" IS NOT NULL
              GROUP BY ai."productId"
            )
            SELECT
              p."id"::int AS "productId",
              p."name"::text AS name,
              COALESCE(s.quantity, 0)::int AS quantity,
              COALESCE(s.revenue, 0)::float8 AS revenue
            FROM "Product" p
            LEFT JOIN sales s ON s."productId" = p."id"
            WHERE p."clubId" = ${clubId}
              AND p."isActive" = true
            ORDER BY quantity DESC, revenue DESC, p."name" ASC
        `;

        const productsTop = productAllRows.slice(0, 12);
        const productsBottom = [...productAllRows]
            .sort((a, b) => {
                const qa = Number(a.quantity || 0);
                const qb = Number(b.quantity || 0);
                if (qa !== qb) return qa - qb;
                const ra = Number(a.revenue || 0);
                const rb = Number(b.revenue || 0);
                if (ra !== rb) return ra - rb;
                return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
            })
            .slice(0, 12);
        const productsUnsold = productAllRows.filter((row) => Number(row.quantity || 0) <= 0);
        const productsUnsoldTop = productsUnsold
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' }))
            .slice(0, 12);

        const dailyEvolution = dailyRows.map((row) => ({
            day: String(row.day || ''),
            turnos: Number(row.turnos || 0),
            bar: Number(row.bar || 0)
        }));

        const totalTurnos = dailyEvolution.reduce((sum, row) => sum + Number(row.turnos || 0), 0);
        const totalBar = dailyEvolution.reduce((sum, row) => sum + Number(row.bar || 0), 0);
        const productsRevenueAll = productAllRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
        const productsQuantityAll = productAllRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        const productsRevenueTop = productsTop.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
        const productsQuantityTop = productsTop.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

        res.json({
            totalRevenue: totalTurnos + totalBar,
            totalBookings: playedBookings,
            dailyEvolution: dailyEvolution,
            paymentMethods: methodRows.map((row) => ({
                name: row.method,
                value: Number(row.value || 0)
            })),
            products: {
                totals: {
                    quantityAll: productsQuantityAll,
                    revenueAll: productsRevenueAll,
                    quantityTop: productsQuantityTop,
                    revenueTop: productsRevenueTop,
                    unsoldCount: productsUnsold.length
                },
                top: productsTop.map((row) => ({
                    productId: row.productId,
                    name: row.name || 'Producto',
                    quantity: Number(row.quantity || 0),
                    revenue: Number(row.revenue || 0)
                })),
                bottom: productsBottom.map((row) => ({
                    productId: row.productId,
                    name: row.name || 'Producto',
                    quantity: Number(row.quantity || 0),
                    revenue: Number(row.revenue || 0)
                })),
                unsold: productsUnsoldTop.map((row) => ({
                    productId: row.productId,
                    name: row.name || 'Producto'
                }))
            }
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Error al calcular estadísticas" });
    }
}

    // Commit 3 — PATCH /admin/bookings/:id/client
    // Cambia el titular (clientId) de una reserva de forma explícita.
    // Solo OWNER/ADMIN. Bloqueado si existen pagos o devoluciones.
    changeBookingClient = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return res.status(400).json({ error: 'bookingId inválido' });
            }

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const actorUserId = Number((req as any).user?.userId);
            if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
                return res.status(401).json({ error: 'No autenticado' });
            }

            const newClientId = String(req.body?.newClientId ?? '').trim();
            if (!newClientId) {
                return res.status(400).json({ error: 'newClientId es obligatorio' });
            }

            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null;

            const updated = await this.bookingService.changeBookingClient({
                bookingId,
                newClientId,
                actorUserId,
                clubId,
                reason
            });

            return res.json({
                message: 'Titular actualizado correctamente',
                booking: updated
            });
        } catch (error: any) {
            return res.status(400).json({ error: error.message || 'No se pudo cambiar el titular' });
        }
    }
}
