import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';
import { whatsappService } from '../services/WhatsappService';
import { TimeHelper } from '../utils/TimeHelper';
import { ProductService } from '../services/ProductService';

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

            const { courtId, startDateTime, date: dateStr, slotTime, activityId, durationMinutes, guestIdentifier, guestName, guestEmail, guestPhone, guestDni, isProfessor } = parsed.data;

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
            const isAdmin = userRole === 'ADMIN';
            const asGuest = Boolean((req.body as any)?.asGuest);
            const forceGuest = isAdmin && asGuest;
            const effectiveUserId = forceGuest ? null : (userIdFromToken ? Number(userIdFromToken) : null);
            const allowGuestWithoutContact = forceGuest;
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
            if (!effectiveUserId && !forceGuest && !guestPhone) {
                return res.status(400).json({ error: "Debe enviar un teléfono para reservar como invitado." });
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
                allowGuestWithoutContact,
                applyProfessorDiscount,
                durationMinutes
            );

            const courtWithClub = await prisma.court.findUnique({ where: { id: Number(courtId) }, include: { club: true } });
            const clubTimeZone = (courtWithClub?.club as any)?.timeZone ?? 'America/Argentina/Buenos_Aires';

            // 👇👇👇 INICIO BLOQUE WHATSAPP MEJORADO 👇👇👇
            try {
                let clientPhone: string | null = null;
                let clientName: string = 'Jugador';

                // 1. Datos del Cliente
                if (guestPhone) {
                    // Si escribiste un teléfono en el formulario (caso Admin cargando a otro), usamos ese
                    clientPhone = guestPhone;
                    clientName = guestName || 'Jugador';
                } else if (userIdFromToken) {
                    // Si NO hay teléfono manual pero hay token (usuario reservando desde su propia cuenta)
                    const fullUser = await prisma.user.findUnique({ where: { id: Number(userIdFromToken) } });
                    if (fullUser) {
                        clientPhone = fullUser.phoneNumber;
                        clientName = fullUser.firstName || 'Jugador';
                    }
                } else {
                    // Caso de invitado desde la web
                    clientPhone = effectiveGuestPhone || null;
                    clientName = effectiveGuestName || 'Jugador';
                }

                // 2. Datos de Fecha y Hora local
                const localForWhatsApp = TimeHelper.utcToLocal(startDate, clubTimeZone);
                const dia = String(localForWhatsApp.getDate()).padStart(2, '0');
                const mes = String(localForWhatsApp.getMonth() + 1).padStart(2, '0');
                const anio = localForWhatsApp.getFullYear();
                const horas = String(localForWhatsApp.getHours()).padStart(2, '0');
                const minutos = String(localForWhatsApp.getMinutes()).padStart(2, '0');
                const dateStr = `${dia}/${mes}/${anio}`;
                const timeStr = `${horas}:${minutos}`;

                // 3. Datos del Club (Evitando errores de tipado de TypeScript con "any")
                const clubData = courtWithClub?.club as any;
                const clubName = clubData?.name || 'el complejo';
                const courtName = courtWithClub?.name || 'Cancha';
                const clubPhoneRaw = clubData?.phone || clubData?.phoneNumber;
                
                // Limpieza de números (sacar guiones, espacios, el + del principio)
                const cleanClientPhone = clientPhone ? clientPhone.replace(/\D/g, '') : null;
                const cleanClubPhone = clubPhoneRaw ? clubPhoneRaw.replace(/\D/g, '') : null;

                // 4. Armado de Textos
                const clientMessage = `
🎾 *¡Reserva Registrada en ${clubName}!* 🎾

Hola *${clientName}*, tu turno ha sido agendado a través de TuCancha.

📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
📍 *Cancha:* ${courtName}
💰 *Monto del turno:* $${result.price || 0}

⚠️ *INFORMACIÓN IMPORTANTE:*
Para confirmar tu asistencia, coordinar el pago de la seña o por cualquier consulta, por favor comunicate directamente con la administración del club:
📱 *WhatsApp del Club:* ${cleanClubPhone ? `https://wa.me/${cleanClubPhone}` : 'No disponible'}

¡Gracias por usar nuestro sistema!
                `.trim();
                const clubMessage = `
🔔 *¡Nueva Reserva!* 🔔

Ingresó un nuevo turno web en *${clubName}*.

👤 *Cliente:* ${clientName} 
📞 *Tel:* ${cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
📍 *Cancha:* ${courtName}
💰 *Monto:* $${result.price || 28000}
                `.trim();

               // 5. Lista de envíos
            const notifications = [];

            // 1. Siempre intentamos mandarle al cliente
            if (cleanClientPhone) {
                notifications.push({ target: 'Cliente', phone: cleanClientPhone, message: clientMessage });
            }

            // 2. AL CLUB SOLO LE MANDAMOS SI NO ES EL ADMIN EL QUE ESTÁ CREANDO EL TURNO
            // Si vos (Admin) cargás el turno, no necesitás que el bot te mande un mensaje a vos mismo.
            if (cleanClubPhone && !isAdmin) { 
                notifications.push({ target: 'Club', phone: cleanClubPhone, message: clubMessage });
            }
            
                // 6. Loop de despacho con la instancia unificada
                for (const notif of notifications) {
                    if (process.env.DISABLE_WHATSAPP === 'true' || process.env.DISABLE_WHATSAPP === '1') {
                        try {
                            const fetchFn = (globalThis as any).fetch;
                            if (typeof fetchFn !== 'function') throw new Error('fetch no disponible en el runtime');
                            const resp = await fetchFn('http://wpp-service:3002/send', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ number: notif.phone, message: notif.message })
                            });
                            if (!resp.ok) {
                                const text = await resp.text();
                                console.error(`❌ Error wpp-service (${notif.target}):`, resp.status, text);
                            } else {
                                console.log(`✅ Mensaje enviado vía wpp-service a ${notif.target} (${notif.phone})`);
                            }
                        } catch (e) {
                            console.error(`❌ Error llamando wpp-service para ${notif.target}:`, e);
                        }
                    } else {
                        try {
                            // Tu servicio nativo de whatsapp
                            await whatsappService.sendMessage(notif.phone, notif.message);
                            console.log(`✅ Mensaje directo enviado a ${notif.target} (${notif.phone})`);
                        } catch (err) {
                            console.error(`❌ Falló envío directo a ${notif.target}:`, err);
                        }
                    }
                }

            } catch (waError) {
                console.error("❌ Error general procesando notificaciones de WhatsApp:", waError);
            }
            // 👆👆👆 FIN BLOQUE WHATSAPP MEJORADO 👆👆👆

            // Retornamos la respuesta al cliente
            const localForRefresh = TimeHelper.utcToLocal(startDate, clubTimeZone);
            const refreshDate = `${localForRefresh.getFullYear()}-${String(localForRefresh.getMonth() + 1).padStart(2, '0')}-${String(localForRefresh.getDate()).padStart(2, '0')}`;

            const payload = { ...result, refresh: true, refreshDate };
            res.status(201).json(payload);

        } catch (error: any) {
            console.error(error);
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

            // --- INICIO NOTIFICACIONES WHATSAPP DE CANCELACIÓN ---
            try {
                // 1. Traemos la reserva completa para leer los datos
                const fullBooking: any = await prisma.booking.findUnique({
                    where: { id: Number(req.params.id || req.body.bookingId) }, // Asegurate de usar el ID correcto según tu ruta
                    include: {
                        user: true,
                        court: { include: { club: true } }
                    }
                });

                if (fullBooking) {
                    let clientPhone: string | null = null;
                    let clientName: string = 'Jugador';

                    // 2. Extraemos datos del Cliente
                    if (fullBooking.user) {
                        clientPhone = fullBooking.user.phone || fullBooking.user.phoneNumber;
                        clientName = fullBooking.user.name || fullBooking.user.firstName || 'Jugador';
                    } else {
                        clientPhone = fullBooking.guestPhone;
                        clientName = fullBooking.guestName || 'Jugador';
                    }

                    // 3. Extraemos datos del Club
                    const clubData = fullBooking.court?.club;
                    const clubName = clubData?.name || 'el complejo';
                    const courtName = fullBooking.court?.name || 'Cancha';
                    const clubPhoneRaw = clubData?.phone || clubData?.phoneNumber;

                    // Limpieza de números
                    const cleanClientPhone = clientPhone ? clientPhone.replace(/\D/g, '') : null;
                    const cleanClubPhone = clubPhoneRaw ? clubPhoneRaw.replace(/\D/g, '') : null;

                    // 4. Fechas y Horas locales
                    // (Asumo que tenés TimeHelper importado en este controlador)
                    const localForWhatsApp = TimeHelper.utcToLocal(fullBooking.startDateTime, clubData?.timeZone || 'America/Argentina/Cordoba');
                    const dia = String(localForWhatsApp.getDate()).padStart(2, '0');
                    const mes = String(localForWhatsApp.getMonth() + 1).padStart(2, '0');
                    const anio = localForWhatsApp.getFullYear();
                    const horas = String(localForWhatsApp.getHours()).padStart(2, '0');
                    const minutos = String(localForWhatsApp.getMinutes()).padStart(2, '0');
                    const dateStr = `${dia}/${mes}/${anio}`;
                    const timeStr = `${horas}:${minutos}`;

                    // 5. Armado de Textos (Versión Cancelación)
                    const clientMessage = `
❌ *Reserva Cancelada en ${clubName}* ❌

Hola *${clientName}*, te confirmamos que tu turno ha sido anulado a través del sistema.

📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
📍 *Cancha:* ${courtName}

⚠️ *Aviso:* Si tenías una seña abonada, por favor comunicate con la administración para gestionar tu cuenta:
📱 *WhatsApp del Club:* ${cleanClubPhone ? `https://wa.me/${cleanClubPhone}` : 'No disponible'}

¡Te esperamos la próxima!
                    `.trim();

                    const clubMessage = `
⚠️ *¡Turno Cancelado por Usuario!* ⚠️

Un cliente acaba de cancelar su reserva desde la web en *${clubName}*.

👤 *Cliente:* ${clientName}
📞 *Tel:* ${cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
📍 *Cancha:* ${courtName}

ℹ️ *La cancha ya se encuentra disponible para nuevas reservas en la grilla.*
                    `.trim();

                    // 6. Lista de envíos
                    const notifications = [];

                    // Siempre notificamos al cliente
                    if (cleanClientPhone) {
                        notifications.push({ target: 'Cliente', phone: cleanClientPhone, message: clientMessage });
                    }

                    // Al club le notificamos para que sepa que se le liberó la cancha
                    // (Si querés que no le llegue si lo cancela un Admin, podés agregar el && !isAdmin acá)
                    if (cleanClubPhone) {
                        notifications.push({ target: 'Club', phone: cleanClubPhone, message: clubMessage });
                    }

                    // 7. Loop de despacho con la instancia unificada (TU CÓDIGO EXACTO)
                    for (const notif of notifications) {
                        if (process.env.DISABLE_WHATSAPP === 'true' || process.env.DISABLE_WHATSAPP === '1') {
                            try {
                                const fetchFn = (globalThis as any).fetch;
                                if (typeof fetchFn !== 'function') throw new Error('fetch no disponible en el runtime');
                                const resp = await fetchFn('http://wpp-service:3002/send', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ number: notif.phone, message: notif.message })
                                });
                                if (!resp.ok) {
                                    const text = await resp.text();
                                    console.error(`❌ Error wpp-service (${notif.target}):`, resp.status, text);
                                } else {
                                    console.log(`✅ Mensaje enviado vía wpp-service a ${notif.target} (${notif.phone})`);
                                }
                            } catch (e) {
                                console.error(`❌ Error llamando wpp-service para ${notif.target}:`, e);
                            }
                        } else {
                            try {
                                // Usamos el servicio de whatsapp inyectado o importado
                                await whatsappService.sendMessage(notif.phone, notif.message);
                                console.log(`✅ Mensaje directo de CANCELACIÓN enviado a ${notif.target} (${notif.phone})`);
                            } catch (err) {
                                console.error(`❌ Falló envío directo a ${notif.target}:`, err);
                            }
                        }
                    }
                }
            } catch (waError) {
                console.error("❌ Error general procesando notificaciones de WhatsApp para CANCELACIÓN:", waError);
            }
            // --- FIN NOTIFICACIONES WHATSAPP ---
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            if (error.message === "No tienes acceso a esta reserva") {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ error: error.message });
        }
    }

    confirmBooking = async (req: Request, res: Response) => {
        try {
            const confirmSchema = z.object({
                bookingId: z.preprocess((v) => Number(v), z.number().int().positive()),
                paymentMethod: z.enum(['CASH', 'TRANSFER', 'DEBT']).optional()
            });
            const parsed = confirmSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { bookingId, paymentMethod } = parsed.data;
            const userId = (req as any).user?.userId;
            if (!userId) {
                return res.status(401).json({ error: 'No autorizado' });
            }
            const clubId = (req as any).clubId as number | undefined;
            const result = await this.bookingService.confirmBooking(
                bookingId,
                userId,
                paymentMethod ?? 'CASH',
                clubId
            );
            res.json(result);
        } catch (error: any) {
            console.error("Error en confirmBooking:", error);
            if (error.message === "No tienes acceso a esta reserva") {
                return res.status(403).json({ error: error.message });
            }
            res.status(400).json({ error: error.message });
        }
    };

    getHistory = async (req: Request, res: Response) => {
        try {
            const userId = Number(req.params.userId);
            if (!Number.isInteger(userId) || userId < 1) {
                return res.status(400).json({ error: 'userId inválido' });
            }
            const user = (req as any).user;
            if (!user?.userId) {
                return res.status(401).json({ error: 'No autorizado' });
            }
            const fullUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { clubId: true } });
            const requestUser = {
                userId: user.userId,
                role: user.role ?? 'MEMBER',
                clubId: fullUser?.clubId ?? null
            };
            const history = await this.bookingService.getUserHistory(userId, requestUser);
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

    getAllAvailableSlots = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
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

            const { date, activityId, durationMinutes } = parsed.data;

            const searchDate = new Date(date);

            const slots = await this.bookingService.getAllAvailableSlots(
                searchDate,
                Number(activityId),
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
            const isAdmin = user?.role === 'ADMIN';
            const clubId = (req as any).clubId;

            if (!userId && !isAdmin) {
                return res.status(403).json({ error: "Solo un administrador puede crear turnos fijos sin usuario." });
            }
            if (!userId && !guestName) {
                return res.status(400).json({ error: "Debe enviar un nombre para el turno fijo." });
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
            const { id } = req.params; // El ID de la reserva viene en la URL
            
            // Llamamos al servicio (asegurate que tu servicio tenga este método)
            const items = await this.bookingService.getBookingItems(Number(id));
            
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
                paymentMethod: z.enum(['CASH', 'TRANSFER', 'DEBT']).optional()
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

        // Validaciones básicas...
        const booking = await prisma.booking.findUnique({ 
            where: { id: bookingId }, // Usamos el ID seguro
            include: { court: true }
        });
        if (!booking) return res.status(404).json({ error: "Reserva no encontrada" });

        const product = await prisma.product.findUnique({ where: { id: Number(productId) } });
        if (!product) return res.status(404).json({ error: "Producto no encontrado" });

        if (product.clubId !== booking.court.clubId) {
            return res.status(400).json({ error: 'El producto no pertenece al club de la reserva' });
        }

        const newItem = await prisma.$transaction(async (tx) => {
            await this.productService.consumeStock(booking.court.clubId, Number(productId), Number(quantity), tx);

            const createdItem = await tx.bookingItem.create({
                data: {
                    bookingId: bookingId,
                    productId: Number(productId),
                    quantity: Number(quantity),
                    price: Number(product.price)
                }
            });

            if (paymentMethod !== 'DEBT') {
                await tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount: Number(product.price) * Number(quantity),
                        description: `Venta Extra: ${quantity}x ${product.name} (Reserva #${bookingId})`,
                        method: paymentMethod || 'CASH',
                        bookingId: bookingId,
                        clubId: booking.court.clubId
                    }
                });
            } else if (booking.paymentStatus === 'PAID') {
                await tx.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: 'PARTIAL' }
                });
            }

            return createdItem;
        });

        const bookingWithTotals = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { items: true, cashMovements: true }
        });

        if (bookingWithTotals) {
            const itemsTotal = bookingWithTotals.items.reduce(
                (sum, item) => sum + Number(item.price) * item.quantity,
                0
            );
            const totalPaid = bookingWithTotals.cashMovements
                .filter((movement) => movement.type === 'INCOME')
                .reduce((sum, movement) => sum + Number(movement.amount), 0);
            const total = Number(bookingWithTotals.price || 0) + itemsTotal;
            const remaining = total - totalPaid;

            let nextStatus: 'PAID' | 'DEBT' | 'PARTIAL';
            if (remaining <= 0) nextStatus = 'PAID';
            else if (totalPaid > 0) nextStatus = 'PARTIAL';
            else nextStatus = 'DEBT';

            if (bookingWithTotals.paymentStatus !== nextStatus) {
                await prisma.booking.update({
                    where: { id: bookingId },
                    data: { paymentStatus: nextStatus }
                });
            }
        }

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
            const { itemId } = req.params; // OJO: Acá esperamos el ID del item, no de la reserva

            await this.bookingService.removeItemFromBooking(Number(itemId));
            
            res.json({ message: 'Consumo eliminado y stock devuelto' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error al eliminar el consumo' });
        }
    }

    updateStatus = async (req: Request, res: Response) => {
        const updateStatusSchema = z.object({
            id: z.preprocess((v) => Number(v), z.number().int().positive())
        });
        const bodySchema = z.object({
            paymentStatus: z.enum(['PAID', 'DEBT', 'PARTIAL'])
        });
        const paramsParsed = updateStatusSchema.safeParse(req.params);
        const bodyParsed = bodySchema.safeParse(req.body);
        if (!paramsParsed.success) {
            return res.status(400).json({ error: paramsParsed.error.format() });
        }
        if (!bodyParsed.success) {
            return res.status(400).json({ error: bodyParsed.error.format() });
        }
        const { id } = paramsParsed.data;
        const { paymentStatus } = bodyParsed.data;
        await this.bookingService.updatePaymentStatus(id, paymentStatus);
        res.json({ success: true });
    }

    getDebtors = async (req: Request, res: Response) => {
        try {
            const clubId = (req as any).clubId;
            const data = await this.bookingService.getClubDebtors(clubId);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener clientes con deuda' });
        }
    }

    payDebt = async (req: Request, res: Response) => {
        try {
            const payDebtSchema = z.object({
                bookingId: z.preprocess((v) => Number(v), z.number().int().positive()),
                paymentMethod: z.enum(['CASH', 'TRANSFER']).optional()
            });
            const parsed = payDebtSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { bookingId, paymentMethod } = parsed.data;
            const result = await this.bookingService.payBookingDebt(bookingId, paymentMethod ?? 'CASH');
            res.json({ message: "Deuda cobrada exitosamente", result });
        } catch (error: any) {
            console.error("Error en payDebt Controller:", error);
            res.status(400).json({ error: error.message || "Error al cobrar deuda" });
        }
    }
}

