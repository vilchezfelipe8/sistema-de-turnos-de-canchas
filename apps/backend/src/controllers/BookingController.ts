import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';
import { TimeHelper } from '../utils/TimeHelper';
import { ProductService } from '../services/ProductService';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { sanitizeString } from '../utils/sanitize';

export class BookingController {
    private productService = new ProductService();

    constructor(private bookingService: BookingService) {}

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
                startDateTime: z.string().optional().refine((s) => s === undefined || !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO datetime' }),
                date: z.string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Invalid date format. Use YYYY-MM-DD' })
                    .optional(),
                slotTime: z.string()
                    .regex(/^\d{2}:\d{2}$/, { message: 'Invalid slotTime format. Use HH:mm' })
                    .optional(),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                guestIdentifier: optionalTrimmedString(),
                guestName: optionalTrimmedString(2),
                guestEmail: z.preprocess(
                    (v) => {
                        if (typeof v !== 'string') return v;
                        const trimmed = v.trim();
                        return trimmed.length === 0 ? undefined : trimmed;
                    },
                    z.string().email().optional()
                ),
                guestPhone: optionalTrimmedString(),
                guestDni: optionalTrimmedString(),
                isProfessor: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            });

            const dataToValidate = {
                ...req.body
            };

            const parsed = createSchema.safeParse(dataToValidate);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            let { courtId, startDateTime, date: dateStr, slotTime, activityId, durationMinutes, guestIdentifier, guestName, guestEmail, guestPhone, guestDni, isProfessor } = parsed.data;
            guestName = guestName ? sanitizeString(guestName, 200) : undefined;
            guestIdentifier = guestIdentifier ? sanitizeString(guestIdentifier, 100) : undefined;
            guestEmail = guestEmail ? sanitizeString(guestEmail, 254) : undefined;
            guestPhone = guestPhone ? sanitizeString(guestPhone, 30) : undefined;
            guestDni = guestDni ? sanitizeString(guestDni, 20) : undefined;

            // Resolve startDate: prefer date+slotTime (local) if provided, otherwise use startDateTime ISO
            let startDate: Date;
            if (dateStr && slotTime) {
                // Need club timezone: fetch court->club to get timeZone
                try {
                    const court = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: true } });
                    const tz = (court?.club as any)?.timeZone ?? 'America/Argentina/Buenos_Aires';
                    startDate = TimeHelper.localSlotToUtc(dateStr, slotTime, tz);
                } catch (e) {
                    return res.status(400).json({ error: 'Invalid date/slot combination or club timezone missing' });
                }
            } else if (startDateTime) {
                startDate = new Date(String(startDateTime));
                if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'Invalid startDateTime' });
            } else {
                return res.status(400).json({ error: 'Debe enviar startDateTime o (date y slotTime)' });
            }
            
            const userRole = user?.role;
            const membershipRole = String((req as any).membershipRole || '');
            const isAdmin = userRole === 'ADMIN' || membershipRole === 'OWNER' || membershipRole === 'ADMIN';
            const asGuest = Boolean((req.body as any)?.asGuest);
            const forceGuest = isAdmin && asGuest;
            const effectiveUserId = forceGuest ? null : (userIdFromToken ? Number(userIdFromToken) : null);
            const effectiveGuestIdentifier = forceGuest && !guestIdentifier ? `admin_${Date.now()}` : guestIdentifier;
            const applyProfessorDiscount = isAdmin && Boolean(isProfessor);

            const now = new Date();
            if (startDate.getTime() < now.getTime()) {
                return res.status(400).json({ error: "No se pueden reservar turnos en el pasado." });
            }

            if (userRole !== 'ADMIN') {
                const maxDate = new Date(now);
                maxDate.setMonth(now.getMonth() + 1);
                if (startDate.getTime() > maxDate.getTime()) {
                    return res.status(400).json({ error: "Solo se pueden reservar turnos hasta 1 mes desde hoy." });
                }
            }

            if (!effectiveUserId && !forceGuest && !effectiveGuestIdentifier) {
                return res.status(400).json({ error: "Debe enviar guestIdentifier o autenticarse para reservar." });
            }
            if (!effectiveUserId && !guestName) {
                return res.status(400).json({ error: "Debe enviar un nombre para reservar como invitado." });
            }
            if (!effectiveUserId && !guestPhone) {
                return res.status(400).json({ error: "Debe enviar un teléfono para reservar como invitado." });
            }
            if (!effectiveUserId && !guestDni) {
                return res.status(400).json({ error: "Debe enviar un DNI para reservar como invitado." });
            }

            const isGuest = !effectiveUserId;
            const effectiveGuestName = isGuest ? guestName : undefined;
            const effectiveGuestEmail = isGuest ? guestEmail : undefined;
            const effectiveGuestPhone = isGuest ? guestPhone : undefined;
            const effectiveGuestDni = isGuest ? guestDni : undefined;

            // 1. CREAR LA RESERVA
            const result = await this.bookingService.createBooking(
                effectiveUserId,
                effectiveGuestIdentifier,
                effectiveGuestName,
                effectiveGuestEmail,
                effectiveGuestPhone,
                effectiveGuestDni,
                Number(courtId),
                startDate,
                Number(activityId),
                applyProfessorDiscount,
                durationMinutes,
                isAdmin
            );

            const courtWithClub = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: true } });
            const clubTimeZone = (courtWithClub?.club as any)?.timeZone ?? 'America/Argentina/Buenos_Aires';

            // Retornamos la respuesta al cliente
            const localForRefresh = TimeHelper.utcToLocal(startDate, clubTimeZone);
            const refreshDate = `${localForRefresh.getFullYear()}-${String(localForRefresh.getMonth() + 1).padStart(2, '0')}-${String(localForRefresh.getDate()).padStart(2, '0')}`;

            const payload = { ...result, refresh: true, refreshDate };
            res.status(201).json(payload);

        } catch (error: any) {
            console.error(error);
            if (error?.message === 'SLOT_ALREADY_BOOKED') {
                return res.status(409).json({
                    error: 'El horario acaba de ser reservado por otro jugador'
                });
            }
            res.status(400).json({ error: error.message || "Error desconocido" });
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
                bookingId: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = cancelSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { bookingId } = parsed.data;
            const user = (req as any).user;
            const clubId = (req as any).clubId;
            const result = await this.bookingService.cancelBooking(Number(bookingId), user?.userId, clubId);
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            if (error.message === "No tienes acceso a esta reserva") {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ error: error.message });
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
                return res.status(401).json({ error: 'No autorizado' });
            }
            let clubContext: { clubId: number } | null = null;
            try {
                clubContext = await getUserClubContext(Number(user.userId), getPreferredClubIdFromRequest(req));
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
                return res.status(403).json({ error: error.message });
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
            const [booking, financialSummary] = await Promise.all([
                this.bookingService.getBookingById(bookingId),
                this.bookingService.getBookingFinancialSummary(bookingId)
            ]);

            return res.json({ booking, financialSummary });
        } catch (error: any) {
            return res.status(404).json({ error: error.message || 'Reserva no encontrada' });
        }
    }

    getAllAvailableSlots = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato inválido. Use YYYY-MM-DD (ej: 2026-01-06)" }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                clubSlug: z.string().trim().min(1).optional(),
                durationMinutes: z.preprocess(
                    (v) => (v === undefined ? undefined : Number(v)),
                    z.number().int().positive().optional()
                )
            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId, clubSlug, durationMinutes } = parsed.data;

            const searchDate = new Date(date);

            let clubId: number | undefined;
            if (clubSlug) {
                const club = await prisma.club.findUnique({ where: { slug: clubSlug } });
                if (club) {
                    clubId = club.id;
                }
            }

            const slots = await this.bookingService.getAllAvailableSlots(
                searchDate,
                Number(activityId),
                clubId,
                durationMinutes
            );

            res.json({ date: date, availableSlots: slots });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getAvailableSlotsWithCourts = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
            // Aceptamos cualquier string de fecha y después la procesamos nosotros
            date: z.string(), 
            activityId: z.preprocess((v) => Number(v), z.number()),
            clubSlug: z.string().optional(),
            durationMinutes: z.preprocess(
                (v) => (v === undefined || v === '' ? undefined : Number(v)),
                z.number().optional()
            )

            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId, clubSlug, durationMinutes } = parsed.data;

            // Blindaje matemático para que la fecha no se atrase un día por el UTC
            const [year, month, day] = String(date).split('-').map(Number);
            const searchDate = new Date(year, month - 1, day);

            let clubId: number | undefined;
            if (clubSlug && typeof clubSlug === 'string' && clubSlug.trim()) {
                const club = await prisma.club.findUnique({ where: { slug: clubSlug.trim() } });
                if (club) clubId = club.id;
            }

            const slotsWithCourts = await this.bookingService.getAvailableSlotsWithCourts(
                searchDate,
                Number(activityId),
                clubId,
                durationMinutes
            );

            res.json({ date: date, slotsWithCourts });
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
            res.status(500).json({ error: error.message });
        }
    }
    
    createFixed = async (req: Request, res: Response) => {
        try {
            const createFixedSchema = z.object({
                userId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'startDateTime debe ser una fecha ISO válida' }),
                guestName: z.string().optional(),
                guestPhone: z.union([z.string(), z.number()]).optional(),
                guestDni: z.string().optional(),
                isProfessor: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional()
            });
            const parsed = createFixedSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { userId, courtId, activityId, startDateTime, guestName, guestPhone, guestDni, isProfessor } = parsed.data;
            const user = (req as any).user;
            const membershipRole = String((req as any).membershipRole || '');
            const isAdmin = user?.role === 'ADMIN' || membershipRole === 'OWNER' || membershipRole === 'ADMIN';
            const clubId = (req as any).clubId;

            if (!userId && !isAdmin) {
                return res.status(403).json({ error: "Solo un administrador puede crear turnos fijos sin usuario." });
            }
            if (!userId && !guestName) {
                return res.status(400).json({ error: "Debe enviar un nombre para el turno fijo." });
            }
            if (!userId && !guestPhone) {
                return res.status(400).json({ error: "Debe enviar un teléfono para el turno fijo." });
            }
            if (!userId && !guestDni) {
                return res.status(400).json({ error: "Debe enviar un DNI para el turno fijo." });
            }

            const startDate = new Date(startDateTime);

            const result = await this.bookingService.createFixedBooking(
                userId ? Number(userId) : null, 
                courtId, 
                activityId, 
                startDate,
                undefined,
                guestName,
                guestPhone,
                guestDni,
                Boolean(isProfessor),
                clubId
            );
            
            res.status(201).json(result);
        } catch (error: any) {
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
            res.status(500).json({ error: 'Error al obtener los consumos' });
        }
    }

    //  AGREGAR CONSUMO (POST)
    async addItem(req: Request, res: Response) {
        try {
            const addItemSchema = z.object({
                bookingId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                productId: z.preprocess((v) => Number(v), z.number().int().positive()),
                quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
                paymentMethod: z.enum(['CASH', 'TRANSFER', 'MERCADOPAGO', 'CARD', 'OTHER']).optional()
            });
            const paramId = req.params.id || req.params.bookingId;
            const bodyParsed = addItemSchema.safeParse(req.body);
            if (!bodyParsed.success) {
                return res.status(400).json({ error: bodyParsed.error.format() });
            }
            const { productId, quantity, paymentMethod } = bodyParsed.data;
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
                paymentMethod ?? 'CASH'
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
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error al eliminar el consumo' });
        }
    }

    getDashboardStats = async (req: Request, res: Response) => {
    try {
        const clubId = Number((req as any).clubId);
        
        // 1. LEER FECHAS DE LA URL O USAR POR DEFECTO EL MES ACTUAL
        const { startDate, endDate } = req.query;
        
        let start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let end = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

        if (startDate && endDate) {
            start = new Date(startDate as string);
            end = new Date(endDate as string);
            end.setHours(23, 59, 59, 999); // Aseguramos que tome hasta el último segundo de ese día
        }

        // 2. CONSULTAS A PRISMA (Usando 'start' y 'end')
        const [movements, playedBookings] = await Promise.all([
            prisma.cashMovement.findMany({
                where: {
                    clubId: clubId,
                    type: 'PAYMENT_IN',
                    createdAt: { gte: start, lte: end }
                },
                select: { createdAt: true, amount: true, concept: true, method: true }
            }),
            prisma.booking.count({
                where: {
                    clubId,
                    startDateTime: { gte: start, lte: end },
                    status: 'COMPLETED' 
                }
            })
        ]);

        // 3. PROCESAMIENTO
        const dailyMap = new Map();
        const methodMap: Record<string, number> = {};
        let totalTurnos = 0;
        let totalBar = 0;

        movements.forEach(m => {
            // 🔥 CAMBIO CLAVE: Formateamos como "DD/MM" para evitar mezclar meses
            const dayStr = m.createdAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
            const amount = Number(m.amount);
            const isProduct = String(m.concept || '').toLowerCase().includes('producto');

            const current = dailyMap.get(dayStr) || { turnos: 0, bar: 0 };
            
            if (isProduct) {
                current.bar += amount;
                totalBar += amount;
            } else {
                current.turnos += amount;
                totalTurnos += amount;
            }
            dailyMap.set(dayStr, current);

            methodMap[m.method] = (methodMap[m.method] || 0) + amount;
        });

        // 4. ORDENAR Y FORMATEAR PARA EL GRÁFICO
        const dailyEvolution = Array.from(dailyMap, ([day, values]) => {
            // Convertimos "DD/MM" de vuelta a fecha para ordenar correctamente
            const [d, m] = day.split('/');
            const sortDate = new Date(new Date().getFullYear(), Number(m) - 1, Number(d)).getTime();
            return { day, sortDate, ...values };
        })
        .sort((a, b) => a.sortDate - b.sortDate)
        .map(({ sortDate, ...rest }) => rest); // Limpiamos el campo de ordenamiento

        res.json({
            totalRevenue: totalTurnos + totalBar,
            totalBookings: playedBookings,
            dailyEvolution: dailyEvolution,
            paymentMethods: Object.entries(methodMap).map(([name, value]) => ({ name, value }))
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Error al calcular estadísticas" });
    }
}
}

