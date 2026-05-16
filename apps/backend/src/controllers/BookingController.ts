import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';
import { TimeHelper } from '../utils/TimeHelper';
import { ProductService } from '../services/ProductService';
import { ClientDuplicateIncidentService } from '../services/ClientDuplicateIncidentService';
import { ReportsService } from '../services/ReportsService';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { sanitizeString } from '../utils/sanitize';
import { normalizeIdentityPhone } from '../utils/phone';
import { sendAuthError } from '../utils/authError';
import { AppError, ErrorCodes, badRequest, conflict, forbidden, notFound, sendAppError, flattenZodFieldErrors, zodValidationAppError } from '../errors';

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && String(error.message || '').trim().length > 0
        ? error.message
        : fallback;

type OptionalAuthState = 'guest' | 'authenticated' | 'invalid_token';
const TENANT_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);
const TENANT_OPERATOR_ROLES = new Set(['OWNER', 'ADMIN', 'STAFF']);

const resolveOptionalAuthState = (req: Request): OptionalAuthState => {
    const raw = String((req as any).authState || 'guest').trim();
    if (raw === 'authenticated' || raw === 'invalid_token') return raw;
    return 'guest';
};

const sendControllerAppError = (
    res: Response,
    params: { statusCode: number; code: string; message: string; meta?: Record<string, unknown>; [key: string]: unknown }
) => sendAppError(res, new AppError(params));

const sendZodControllerError = (
    res: Response,
    error: z.ZodError,
    message: string,
    field: string = 'general'
) => sendControllerAppError(res, {
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    field,
    blocking: true,
    message,
    fieldErrors: flattenZodFieldErrors(error),
    meta: { issues: error.flatten() }
});

const createBookingAppError = (error: unknown, fallback = 'No se pudo crear la reserva.'): AppError => {
    if (error instanceof AppError) return error;
    const known = (error || {}) as any;
    const rawCode = String(known?.code || '').trim();
    const message = getErrorMessage(error, fallback);
    const normalizedMessage = message
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (rawCode === 'CLIENT_POSSIBLE_DUPLICATE') {
        const details = (known?.meta && typeof known.meta === 'object')
            ? known.meta
            : (known?.details && typeof known.details === 'object') ? known.details : {};
        const candidateClientIds = Array.isArray((details as any)?.candidateClientIds)
            ? (details as any).candidateClientIds
            : [];
        const candidates = Array.isArray((details as any)?.candidates)
            ? (details as any).candidates
            : [];
        return conflict(
            'Se detectaron datos que podrían corresponder a más de un cliente. Revisá y seleccioná el cliente correcto.',
            ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
            {
                ...(details as Record<string, unknown>),
                candidateClientIds,
                candidates
            }
        );
    }

    if (rawCode === 'BOOKING_OVERLAP') {
        const meta = (known?.meta && typeof known.meta === 'object') ? known.meta : {};
        const overlaps = Array.isArray((meta as any)?.overlaps)
            ? (meta as any).overlaps
            : Array.isArray(known?.overlaps) ? known.overlaps : [];
        return conflict('El horario se superpone con reservas existentes.', ErrorCodes.BOOKING_OVERLAP, { overlaps });
    }

    if (message.includes('pasado')) {
        return badRequest(message, ErrorCodes.INVALID_INPUT);
    }

    if (normalizedMessage.includes('duracion no permitida')) {
        return conflict(message, ErrorCodes.BOOKING_SLOT_UNAVAILABLE);
    }

    if (normalizedMessage.includes('horario no permitido')) {
        return conflict(message, ErrorCodes.BOOKING_SLOT_UNAVAILABLE);
    }

    if (normalizedMessage.includes('club esta cerrado')) {
        return conflict(message, ErrorCodes.BOOKING_SLOT_UNAVAILABLE);
    }

    if (normalizedMessage.includes('limite de anticipacion')) {
        return badRequest(message, ErrorCodes.INVALID_INPUT);
    }

    return badRequest(message, rawCode || ErrorCodes.INVALID_INPUT);
};

const createBillingConfigAppError = (error: unknown): AppError => {
    if (error instanceof AppError) return error;
    const known = (error || {}) as any;
    const rawCode = String(known?.code || '').trim();
    const message = getErrorMessage(error, 'No se pudo guardar la configuración de cobro.');
    const lower = message
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    if (lower.includes('reserva no encontrada')) {
        return notFound(message, ErrorCodes.BOOKING_NOT_FOUND);
    }
    if (lower.includes('club invalido')) {
        return badRequest(message, ErrorCodes.INVALID_INPUT);
    }

    return badRequest(message, rawCode || ErrorCodes.INVALID_INPUT);
};

export class BookingController {
    private productService = new ProductService();
    private duplicateIncidentService = new ClientDuplicateIncidentService();
    private reportsService = new ReportsService();

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
            const details = (error && typeof error === 'object') ? (error.meta || error.details || {}) : {};
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
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
                return sendControllerAppError(res, {
                    statusCode: 404,
                    code: 'COURT_NOT_FOUND',
                    field: 'court',
                    blocking: true,
                    message: 'Cancha no encontrada.'
                });
            }
            const clubTimeZone = String(courtContext.timeZone || '').trim();
            if (!clubTimeZone) {
                return sendControllerAppError(res, {
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
                    return sendControllerAppError(res, {
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
                    return sendControllerAppError(res, {
                        statusCode: 400,
                        code: 'INVALID_DATE_TIME',
                        field: 'time',
                        blocking: true,
                        message: 'startDateTime invalido.'
                    });
                }
            } else {
                return sendControllerAppError(res, {
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
                return sendControllerAppError(res, {
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
            if ((error instanceof AppError && error.code === ErrorCodes.CLIENT_POSSIBLE_DUPLICATE) || error?.code === ErrorCodes.CLIENT_POSSIBLE_DUPLICATE) {
                await this.registerDuplicateIncidentFromBookingError(req, 'BOOKING', error);
            }
            const mapped = createBookingAppError(error);
            return sendAppError(res, mapped);
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
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
                return sendControllerAppError(res, {
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
                    return sendControllerAppError(res, {
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
                    return sendControllerAppError(res, {
                        statusCode: 400,
                        code: 'INVALID_DATE_TIME',
                        field: 'time',
                        blocking: true,
                        message: 'startDateTime invalido.'
                    });
                }
            } else {
                return sendControllerAppError(res, {
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
            return sendAppError(res, createBookingAppError(error, 'No se pudo cotizar la reserva.'));
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
            return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
        return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
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
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
            return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
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
            return sendAppError(res, error, 'No se pudo confirmar la reserva');
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
            return sendAppError(res, error, 'No se pudo completar la reserva');
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
                return sendAppError(res, error, 'Contexto de club inválido');
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
            return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
        }
    }

    getMyBookings = async (req: Request, res: Response) => {
        try {
            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para ver tus reservas.');
            }

            const items = await this.bookingService.getPlayerBookings(userId);
            return res.json({ items });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos cargar tus reservas.');
        }
    }

    getMyBookingCheckout = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para ver el estado de pago.');
            }

            const checkout = await this.bookingService.getPlayerBookingCheckout(bookingId, userId);
            return res.json(checkout);
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos cargar el estado de pago de la reserva.');
        }
    }

    getMyBookingParticipants = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para ver los participantes.');
            }

            const items = await this.bookingService.getPlayerBookingParticipants(bookingId, userId);
            return res.json({ items });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos cargar los participantes.');
        }
    }

    inviteMyBookingParticipant = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const bodySchema = z.object({
                email: z.string().trim().email(),
                name: z.string().trim().min(1).max(120).optional()
            });
            const parsed = bodySchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para invitar jugadores.');
            }

            const participant = await this.bookingService.invitePlayerBookingParticipant({
                bookingId,
                ownerUserId: userId,
                invitedEmail: parsed.data.email,
                invitedName: parsed.data.name || null
            });
            return res.status(201).json({
                message: 'Invitación creada.',
                participant
            });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos invitar al jugador.');
        }
    }

    removeMyBookingParticipant = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const participantId = String(req.params.participantId || '').trim();
            if (!participantId) {
                return sendAppError(res, badRequest('Seleccioná un participante válido.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para gestionar participantes.');
            }

            await this.bookingService.removePlayerBookingParticipant({
                bookingId,
                participantId,
                ownerUserId: userId
            });
            return res.json({ message: 'Participante removido.' });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos remover al participante.');
        }
    }

    getMyBookingInvitations = async (req: Request, res: Response) => {
        try {
            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para ver tus invitaciones.');
            }

            const items = await this.bookingService.getMyBookingInvitations(userId);
            return res.json({ items });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos cargar tus invitaciones.');
        }
    }

    acceptMyBookingInvitation = async (req: Request, res: Response) => {
        try {
            const invitationId = String(req.params.id || '').trim();
            if (!invitationId) {
                return sendAppError(res, badRequest('Seleccioná una invitación válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para aceptar la invitación.');
            }

            await this.bookingService.acceptBookingInvitation(invitationId, userId);
            return res.json({ message: 'Invitación aceptada.' });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos aceptar la invitación.');
        }
    }

    declineMyBookingInvitation = async (req: Request, res: Response) => {
        try {
            const invitationId = String(req.params.id || '').trim();
            if (!invitationId) {
                return sendAppError(res, badRequest('Seleccioná una invitación válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para rechazar la invitación.');
            }

            await this.bookingService.declineBookingInvitation(invitationId, userId);
            return res.json({ message: 'Invitación rechazada.' });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos rechazar la invitación.');
        }
    }

    leaveMyBooking = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para salirte de la reserva.');
            }

            await this.bookingService.leavePlayerBooking(bookingId, userId);
            return res.json({ message: 'Te saliste de la reserva.' });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos procesar tu salida de la reserva.');
        }
    }

    cancelMyBooking = async (req: Request, res: Response) => {
        try {
            const bookingId = Number(req.params.id);
            if (!Number.isInteger(bookingId) || bookingId <= 0) {
                return sendAppError(res, badRequest('Seleccioná una reserva válida.', ErrorCodes.INVALID_INPUT));
            }

            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para cancelar tu reserva.');
            }

            const booking = await this.bookingService.cancelPlayerBooking(bookingId, userId);
            return res.json({
                message: 'Reserva cancelada.',
                booking
            });
        } catch (error: any) {
            return sendAppError(res, error, 'No pudimos cancelar la reserva.');
        }
    }

    getById = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) {
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
            return sendAppError(res, error, 'Reserva no encontrada');
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
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
            return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
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
            return sendAppError(res, error, 'Error interno al cargar agenda');
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
                return sendControllerAppError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Parámetros inválidos para mover la reserva.',
                    meta: { issues: p.error.flatten() }
                });
            }
            if (!b.success) {
                return sendControllerAppError(res, {
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
                return sendControllerAppError(res, {
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
            return sendAppError(res, createBookingAppError(error, 'No se pudo mover la reserva.'));
        }
    }

    getBookingBillingConfig = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) {
                return sendControllerAppError(res, {
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
                return sendControllerAppError(res, {
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
            return sendAppError(res, createBillingConfigAppError(error));
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
                return sendControllerAppError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'general',
                    blocking: true,
                    message: 'Parámetros inválidos para guardar configuración de cobro.',
                    meta: { issues: p.error.flatten() }
                });
            }
            if (!b.success) {
                return sendControllerAppError(res, {
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
                return sendControllerAppError(res, {
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
            return sendAppError(res, createBillingConfigAppError(error));
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
                return sendZodControllerError(res, parsed.error, 'Revisá los campos marcados.');
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
                return sendControllerAppError(res, {
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                    field: 'owner',
                    blocking: true,
                    message: 'Revisá los campos marcados.',
                    fieldErrors: { owner: 'Debes seleccionar un cliente o cargar un alta rápida.' }
                });
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
            if ((error instanceof AppError && error.code === ErrorCodes.CLIENT_POSSIBLE_DUPLICATE) || error?.code === ErrorCodes.CLIENT_POSSIBLE_DUPLICATE) {
                await this.registerDuplicateIncidentFromBookingError(req, 'FIXED_BOOKING', error);
                return sendAppError(res, error);
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
                    error: 'No se pudo crear ningún turno fijo por superposición.',
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : []
                });
            }
            return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
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
                return sendZodControllerError(res, parsedParams.error, 'Revisá los campos marcados.');
            }
            const parsedBody = bodySchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return sendZodControllerError(res, parsedBody.error, 'Revisá los campos marcados.');
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
            return sendAppError(res, error, 'No pudimos completar la acción. Intentá nuevamente.');
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
                return sendZodControllerError(res, parsedParams.error, 'Revisá los campos marcados.');
            }
            if (!parsedBody.success) {
                return sendZodControllerError(res, parsedBody.error, 'Revisá los campos marcados.');
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
                    error: 'Superposición detectada',
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : []
                });
            }
            return sendAppError(res, error, 'No se pudo editar la serie.');
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
            return sendAppError(res, error, 'Error al obtener los consumos');
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
                return sendZodControllerError(res, bodyParsed.error, 'Revisá los campos marcados.');
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

    } catch (error: any) {
        return sendAppError(res, error, 'Error al agregar item');
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
                return sendZodControllerError(res, bodyParsed.error, 'Revisá los campos marcados.');
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
            return sendAppError(res, error, 'Error al cotizar consumo');
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
            return sendAppError(res, error, 'Error al eliminar el consumo');
        }
    }

    getDashboardStats = async (req: Request, res: Response) => {
        try {
            const clubId = Number((req as any).clubId);
            const schema = z.object({
                startDate: z.string().trim().optional(),
                endDate: z.string().trim().optional()
            });
            const parsed = schema.safeParse(req.query);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }

            const report = await this.reportsService.getAdminDashboardReport(
                clubId,
                parsed.data.startDate,
                parsed.data.endDate
            );

            return res.json(report);
        } catch (error) {
            return sendAppError(res, error, 'No se pudieron cargar los informes.');
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
                return sendControllerAppError(res, {
                    statusCode: 400,
                    code: ErrorCodes.VALIDATION_ERROR,
                    message: 'Revisá los campos marcados.',
                    fieldErrors: { newClientId: 'Seleccioná un cliente para continuar.' }
                });
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
            return sendAppError(res, error, 'No se pudo cambiar el titular');
        }
    }
}
