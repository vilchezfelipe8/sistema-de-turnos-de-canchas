import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';
import { whatsappService } from '../services/WhatsappService';

export class BookingController {
    constructor(private bookingService: BookingService) {}

    createBooking = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const userIdFromToken = user?.id || user?.userId || null;

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
            startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO datetime' }),
            activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
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
            guestDni: optionalTrimmedString()
        });

        const dataToValidate = {
            ...req.body
        };

        const parsed = createSchema.safeParse(dataToValidate);

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { courtId, startDateTime, activityId, guestIdentifier, guestName, guestEmail, guestPhone, guestDni } = parsed.data;
        const startDate = new Date(String(startDateTime));
        const userRole = user?.role;
        const isAdmin = userRole === 'ADMIN';
        const asGuest = Boolean((req.body as any)?.asGuest);
        const forceGuest = isAdmin && asGuest;
        const effectiveUserId = forceGuest ? null : (userIdFromToken ? Number(userIdFromToken) : null);
        const allowGuestWithoutContact = forceGuest;
        const effectiveGuestIdentifier = forceGuest && !guestIdentifier ? `admin_${Date.now()}` : guestIdentifier;

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

        // Verificar disponibilidad
        const existingBooking = await prisma.booking.findFirst({
            where: {
                courtId: courtId,
                startDateTime: startDate, // Asegúrate que tu DB use 'startDateTime' o 'startTime'
                status: { not: 'CANCELLED' }
            }
        });

        if (existingBooking) {
            return res.status(400).json({ error: "Esta cancha ya está reservada en ese horario." });
        }

        // 1. CREAR LA RESERVA (Esto sigue igual)
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
            allowGuestWithoutContact
        );

        try {
            let phoneToSend: string | null = null;
            let nameToSend: string = 'Jugador';

            // CASO A: Usuario Registrado
            if (userIdFromToken) {
                const fullUser = await prisma.user.findUnique({ where: { id: Number(userIdFromToken) } });
                if (fullUser) {
                    phoneToSend = fullUser.phoneNumber;
                    nameToSend = fullUser.firstName || 'Jugador';
                }
            } 
            // CASO B: Usuario Invitado (Guest)
            else {
                // Usamos directamente lo que vino del formulario
                phoneToSend = effectiveGuestPhone || null;
                nameToSend = effectiveGuestName || 'Jugador';
            }

            // Si conseguimos un teléfono (sea de User o de Guest), mandamos el mensaje
            if (phoneToSend) {
                
                // Formateo de fecha (Tu lógica original)
                const options: Intl.DateTimeFormatOptions = { 
                    timeZone: 'America/Argentina/Cordoba', 
                    };                

                const argOffset = 3 * 60 * 60 * 1000;
                const argDate = new Date(startDate.getTime() - argOffset);

                // Formateamos "a mano" para no depender de locales
                const dia = String(argDate.getUTCDate()).padStart(2, '0');
                const mes = String(argDate.getUTCMonth() + 1).padStart(2, '0');
                const anio = argDate.getUTCFullYear();
                const horas = String(argDate.getUTCHours()).padStart(2, '0');
                const minutos = String(argDate.getUTCMinutes()).padStart(2, '0');

                const dateStr = `${dia}/${mes}/${anio}`;
                const timeStr = `${horas}:${minutos}`;


                const message = `
🎾 *¡Reserva Confirmada!* 🎾

Hola *${nameToSend}*, tu turno ha sido agendado.

📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
💰 *Precio:* $${result.price || 28000}

⚠️ *PAGO PENDIENTE:*
Para confirmar tu asistencia, por favor abona el turno al Alias: *CLUB.PADEL.2025* y envía el comprobante por acá.

¡Te esperamos!
                `.trim();

                // Enviamos el mensaje al teléfono detectado
                // (Agrego una limpieza simple por si el guest puso guiones o espacios)
                const cleanPhone = phoneToSend.replace(/\D/g, ''); 
                await whatsappService.sendMessage(cleanPhone, message);
            }

        } catch (waError) {
            console.error("❌ Error enviando WhatsApp:", waError);
        }
        // 👆 FIN DEL CAMBIO 👆

// ... (El resto de tu respuesta JSON sigue igual) ...
    
        // Preparar respuesta para el frontend
        const year = startDate.getUTCFullYear();
        const month = String(startDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(startDate.getUTCDate()).padStart(2, '0');
        const refreshDate = `${year}-${month}-${day}`;

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
            activityId: z.preprocess((v) => Number(v), z.number().int().positive())
        });

        const parsed = querySchema.safeParse(req.query); 

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { courtId, date, activityId } = parsed.data;

        const searchDate = new Date(date);

        const slots = await this.bookingService.getAvailableSlots(
            Number(courtId),
            searchDate, 
            Number(activityId)
        );

        res.json({ date: date, availableSlots: slots });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
}

    cancelBooking = async (req: Request, res: Response) => {
        try {
            const { bookingId } = req.body;
            const user = (req as any).user;
            const clubId = (req as any).clubId; // Agregado por middleware de verificación de club
            const result = await this.bookingService.cancelBooking(Number(bookingId), user?.userId, clubId);
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    confirmBooking = async (req: Request, res: Response) => {
        try {
            const { bookingId } = req.body;
            if (!bookingId) {
                return res.status(400).json({ error: "Falta bookingId." });
            }
            const clubId = (req as any).clubId; // Agregado por middleware de verificación de club
            const result = await this.bookingService.confirmBooking(Number(bookingId), clubId);
            res.json({ message: "Reserva confirmada", booking: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getHistory = async (req: Request, res: Response) => {
        try {
            const userId = Number(req.params.userId);
            const history = await this.bookingService.getUserHistory(userId);
            const payload = history.map((b: any) => ({
                ...b,
                court: b.court ? {
                    id: b.court.id,
                    name: b.court.name,
                    club: b.court.club ? { id: b.court.club.id, name: b.court.club.name, slug: b.court.club.slug } : null
                } : null
            }));
            res.json(payload);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getAllAvailableSlots = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato inválido. Use YYYY-MM-DD (ej: 2026-01-06)" }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive())
            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId } = parsed.data;

            const searchDate = new Date(date);

            const slots = await this.bookingService.getAllAvailableSlots(
                searchDate,
                Number(activityId)
            );

            res.json({ date: date, availableSlots: slots });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getAvailableSlotsWithCourts = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato inválido. Use YYYY-MM-DD (ej: 2026-01-06)" }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive()),
                clubSlug: z.string().optional()
            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId, clubSlug } = parsed.data;

            const searchDate = new Date(date);

            let clubId: number | undefined;
            if (clubSlug && typeof clubSlug === 'string' && clubSlug.trim()) {
                const club = await prisma.club.findUnique({ where: { slug: clubSlug.trim() } });
                if (club) clubId = club.id;
            }

            const slotsWithCourts = await this.bookingService.getAvailableSlotsWithCourts(
                searchDate,
                Number(activityId),
                clubId
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
            const { userId, courtId, activityId, startDateTime, guestName, guestPhone, guestDni } = req.body;
            const user = (req as any).user;
            const isAdmin = user?.role === 'ADMIN';
            const clubId = (req as any).clubId; // Agregado por middleware de verificación de club

            if (!userId && !isAdmin) {
                return res.status(403).json({ error: "Solo un administrador puede crear turnos fijos sin usuario." });
            }
            if (!userId && !guestName) {
                return res.status(400).json({ error: "Debe enviar un nombre para el turno fijo." });
            }
            
            // Convertimos string a Date
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
    addItem = async (req: Request, res: Response) => {
        try {
            const { id } = req.params; // ID de la reserva
            const { productId, quantity } = req.body; // Datos del producto

            // Validamos que vengan los datos
            if (!productId || !quantity) {
                return res.status(400).json({ error: 'Falta productId o quantity' });
            }

            const item = await this.bookingService.addItemToBooking(
                Number(id), 
                Number(productId), 
                Number(quantity)
            );
            
            res.status(201).json(item);
        } catch (error: any) {
            // Si el servicio tira error (ej: "Sin stock"), lo devolvemos al frontend
            res.status(400).json({ error: error.message || 'Error al agregar consumo' });
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
    const { id } = req.params;
    const { paymentStatus } = req.body; // 'PAID' o 'DEBT'
    await this.bookingService.updatePaymentStatus(Number(id), paymentStatus);
    res.json({ success: true });
}

    getDebtors = async (req: Request, res: Response) => {
        try {
            const clubId = (req as any).clubId;
            const data = await this.bookingService.getClientStats(clubId);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener clientes' });
        }
    }
}

