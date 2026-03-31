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

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && String(error.message || '').trim().length > 0
        ? error.message
        : fallback;

const isIntegrityInconsistencyError = (error: unknown) =>
    getErrorMessage(error, '').includes('Inconsistencia de integridad');

type OptionalAuthState = 'guest' | 'authenticated' | 'invalid_token';

const resolveOptionalAuthState = (req: Request): OptionalAuthState => {
    const raw = String((req as any).authState || 'guest').trim();
    if (raw === 'authenticated' || raw === 'invalid_token') return raw;
    return 'guest';
};

export class BookingController {
    private productService = new ProductService();
    private duplicateIncidentService = new ClientDuplicateIncidentService();

    constructor(private bookingService: BookingService) {}

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
                    dni: optionalTrimmedString()
                }).optional(),
                applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
            });

            const dataToValidate = {
                ...req.body
            };

            const parsed = createSchema.safeParse(dataToValidate);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
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
                    dni: client.dni ? sanitizeString(client.dni, 20) : undefined
                }
                : undefined;

            // Resolve startDate: prefer date+slotTime (local) if provided, otherwise use startDateTime ISO
            let startDate: Date;
            if (dateStr && slotTime) {
                // Need club timezone: fetch court->club to get timeZone
                try {
                    const court = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: { include: { settings: true } } } });
                    const tz = String(court?.club?.settings?.timeZone || '').trim();
                    if (!tz) {
                        return res.status(400).json({ error: 'Configuración de club inválida: timeZone es obligatorio' });
                    }
                    startDate = TimeHelper.localSlotToUtc(dateStr, slotTime, tz);
                } catch (e) {
                    return res.status(400).json({ error: 'Combinación fecha/horario inválida o zona horaria del club faltante' });
                }
            } else if (startDateTime) {
                startDate = new Date(String(startDateTime));
                if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'startDateTime inválido' });
            } else {
                return res.status(400).json({ error: 'Debe enviar startDateTime o (date y slotTime)' });
            }
            
            const userRole = user?.role;
            const membershipRole = String((req as any).membershipRole || '');
            const isAdmin = userRole === 'ADMIN' || membershipRole === 'OWNER' || membershipRole === 'ADMIN';
            const tokenUserId = userIdFromToken ? Number(userIdFromToken) : null;
            const now = new Date();
            if (startDate.getTime() < now.getTime()) {
                return res.status(400).json({ error: "No se pueden reservar turnos en el pasado." });
            }

            const courtCountry = await prisma.court.findUnique({
                where: { id: Number(courtId) },
                select: { club: { select: { country: true } } }
            });
            const normalizedDraftPhone = normalizeIdentityPhone(
                {
                    phone: sanitizedClient?.phone,
                    countryCode: sanitizedClient?.phoneCountryCode,
                    phoneNumberLocal: sanitizedClient?.phoneNumberLocal
                },
                { defaultCountryIso2: String(courtCountry?.club?.country || '').trim() || null }
            );

            const adminClientDraft = isAdmin
                ? {
                    name: sanitizedClient?.name || '',
                    phone: normalizedDraftPhone || undefined,
                    email: sanitizedClient?.email,
                    dni: sanitizedClient?.dni
                }
                : undefined;

            const hasAdminClientInput = Boolean(clientId || adminClientDraft?.name);
            const useAdminClientMode = Boolean(isAdmin && hasAdminClientInput);
            const effectiveUserId = useAdminClientMode ? null : tokenUserId;

            if (!effectiveUserId && !useAdminClientMode) {
                if (resolveOptionalAuthState(req) === 'invalid_token') {
                    return sendAuthError(res, 401, 'AUTH_INVALID', 'Sesion invalida. Volve a iniciar sesion.');
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
                    applyDiscount: useAdminClientMode ? applyDiscount : false,
                    actorUserId: Number(user?.userId || 0) || null,
                    clientId: clientId || null,
                    clientDraft: useAdminClientMode && adminClientDraft?.name ? adminClientDraft : null
                }
            );

            const courtWithClub = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: { include: { settings: true } } } });
            const clubTimeZone = String(courtWithClub?.club?.settings?.timeZone || '').trim();
            if (!clubTimeZone) {
                return res.status(400).json({ error: 'Configuración de club inválida: timeZone es obligatorio' });
            }

            // Retornamos la respuesta al cliente
            const localForRefresh = TimeHelper.utcToLocal(startDate, clubTimeZone);
            const refreshDate = `${localForRefresh.getFullYear()}-${String(localForRefresh.getMonth() + 1).padStart(2, '0')}-${String(localForRefresh.getDate()).padStart(2, '0')}`;

            const payload = { ...result, refresh: true, refreshDate };
            res.status(201).json(payload);

        } catch (error: any) {
            console.error(error);
            if (error?.code === 'CLIENT_POSSIBLE_DUPLICATE' || error?.message === 'CLIENT_POSSIBLE_DUPLICATE') {
                await this.registerDuplicateIncidentFromBookingError(req, 'BOOKING', error);
                return res.status(409).json({
                    error: 'Se detectaron datos que podrían corresponder a más de un cliente. Revisá y seleccioná el cliente correcto.'
                });
            }
            if (error?.code === 'BOOKING_OVERLAP') {
                return res.status(409).json({
                    error: 'El horario se superpone con reservas existentes.',
                    overlaps: Array.isArray(error?.overlaps) ? error.overlaps : []
                });
            }
            if (error?.message === 'SLOT_ALREADY_BOOKED') {
                return res.status(409).json({
                    error: 'El horario acaba de ser reservado por otro jugador'
                });
            }
            res.status(400).json({ error: error.message || "Error desconocido" });
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
                return res.status(400).json({ error: parsed.error.format() });
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
                return res.status(400).json({ error: 'Teléfono inválido para cotización' });
            }

            let resolvedStart: Date;
            if (dateStr && slotTime) {
                const court = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: { include: { settings: true } } } });
                const tz = String(court?.club?.settings?.timeZone || '').trim();
                if (!tz) {
                    return res.status(400).json({ error: 'Configuración de club inválida: timeZone es obligatorio' });
                }
                resolvedStart = TimeHelper.localSlotToUtc(dateStr, slotTime, tz);
            } else if (startDateTime) {
                resolvedStart = new Date(String(startDateTime));
                if (Number.isNaN(resolvedStart.getTime())) return res.status(400).json({ error: 'startDateTime inválido' });
            } else {
                return res.status(400).json({ error: 'Debe enviar startDateTime o (date y slotTime)' });
            }

            const tokenUserId = Number((req as any).user?.userId || 0);
            const userRole = (req as any)?.user?.role;
            const membershipRole = String((req as any).membershipRole || '');
            const isAdmin = userRole === 'ADMIN' || membershipRole === 'OWNER' || membershipRole === 'ADMIN';
            const quote = await this.bookingService.quoteBookingPrice({
                userId: tokenUserId > 0 ? tokenUserId : null,
                allowAdminBenefits: isAdmin,
                clientId: clientId || null,
                courtId: Number(courtId),
                activityId: Number(activityId),
                startDateTime: resolvedStart,
                durationMinutes,
                clientEmail,
                clientPhone: normalizedClientPhone || undefined,
                clientDni,
                applyDiscount: isAdmin ? applyDiscount : false
            });

            return res.json({
                ...quote,
                authState: resolveOptionalAuthState(req)
            });
        } catch (error: any) {
            return res.status(400).json({ error: error?.message || 'No se pudo cotizar la reserva' });
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
            let clubContext: { clubId: number } | null = null;
            try {
                clubContext = await getUserClubContext(Number(user.userId), preferredClubId);
            } catch {
                clubContext = null;
            }
            const requestUser = {
                userId: user.userId,
                role: (req as any).membershipRole ?? user.role ?? 'MEMBER',
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
            if (!p.success) return res.status(400).json({ error: p.error.format() });
            if (!b.success) return res.status(400).json({ error: b.error.format() });

            const clubId = Number((req as any).clubId);
            if (!Number.isInteger(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'Club inválido' });
            }

            const updated = await this.bookingService.rescheduleBooking({
                bookingId: p.data.id,
                clubId,
                courtId: b.data.courtId,
                startDateTime: new Date(b.data.startDateTime),
                durationMinutes: b.data.durationMinutes
            });
            return res.json({ booking: updated });
        } catch (error: any) {
            if (error?.code === 'BOOKING_OVERLAP') {
                return res.status(409).json({ error: error.message || 'Superposición detectada' });
            }
            return res.status(400).json({ error: error?.message || 'No se pudo mover la reserva' });
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
                allowOverlappingSeries: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            });
            const parsed = createFixedSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { userId, courtId, activityId, startDateTime, durationMinutes, clientId, client, allowOverlappingSeries } = parsed.data;
            const user = (req as any).user;
            const membershipRole = String((req as any).membershipRole || '');
            const isAdmin = user?.role === 'ADMIN' || membershipRole === 'OWNER' || membershipRole === 'ADMIN';
            const clubId = (req as any).clubId;

            if (!isAdmin) {
                return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'Solo un administrador puede crear turnos fijos.');
            }

            const sanitizedClient = client
                ? {
                    name: client.name ? sanitizeString(client.name, 200) : '',
                    phone: client.phone ? sanitizeString(client.phone, 30) : undefined,
                    email: client.email ? sanitizeString(client.email, 254) : undefined,
                    dni: client.dni ? sanitizeString(client.dni, 20) : undefined
                }
                : undefined;

            const safeClientId = clientId ? sanitizeString(clientId, 64) : undefined;
            if (!safeClientId && !userId && !sanitizedClient?.name) {
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
                    durationMinutes
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
            const id = parseInt(req.params.id as string);
            const clubId = (req as any).clubId; // Agregado por middleware de verificación de club
            const result = await this.bookingService.cancelFixedBooking(id, clubId);
            res.json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
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

    } catch (error: any) { // 👇 Le ponemos 'any' para poder leer el mensaje
        console.error("❌ Error en addItem:", error);
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
}
