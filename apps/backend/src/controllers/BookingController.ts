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
            guestPhone: optionalTrimmedString()
        });

        const dataToValidate = {
            ...req.body
        };

        const parsed = createSchema.safeParse(dataToValidate);

        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { courtId, startDateTime, activityId, guestIdentifier, guestName, guestEmail, guestPhone } = parsed.data;
        const startDate = new Date(String(startDateTime));

        if (!userIdFromToken && !guestIdentifier) {
            return res.status(400).json({ error: "Debe enviar guestIdentifier o autenticarse para reservar." });
        }
        if (!userIdFromToken && !guestName) {
            return res.status(400).json({ error: "Debe enviar un nombre para reservar como invitado." });
        }
        if (!userIdFromToken && !guestEmail && !guestPhone) {
            return res.status(400).json({ error: "Debe enviar un email o teléfono para reservar como invitado." });
        }

        const isGuest = !userIdFromToken;
        const effectiveGuestIdentifier = isGuest ? guestIdentifier : undefined;
        const effectiveGuestName = isGuest ? guestName : undefined;
        const effectiveGuestEmail = isGuest ? guestEmail : undefined;
        const effectiveGuestPhone = isGuest ? guestPhone : undefined;

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
            userIdFromToken ? Number(userIdFromToken) : null,
            effectiveGuestIdentifier,
            effectiveGuestName,
            effectiveGuestEmail,
            effectiveGuestPhone,
            Number(courtId),
            startDate,
            Number(activityId)
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
                const options: Intl.DateTimeFormatOptions = {timeZone: 'UTC'};
                
                const dateStr = startDate.toLocaleDateString('es-AR', { 
                    ...options, day: '2-digit', month: '2-digit', year: 'numeric' 
                });

                const timeStr = startDate.toLocaleTimeString('es-AR', { 
                    ...options, hour: '2-digit', minute: '2-digit', hour12: false 
                });

                const paymentLink = `https://tu-club.com/pagar/${result.id}`;

                const message = `
🎾 *¡Reserva Confirmada!* 🎾

Hola *${nameToSend}*, tu turno ha sido agendado.

📅 *Fecha:* ${dateStr}
⏰ *Hora:* ${timeStr}
💰 *Precio:* $${result.price || 1500}

⚠️ *PAGO PENDIENTE:*
Para confirmar tu asistencia, por favor abona el turno en el siguiente link:
👉 ${paymentLink}

O transfiere al Alias: *CLUB.PADEL.2025* y envía el comprobante por acá.

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
            const result = await this.bookingService.cancelBooking(Number(bookingId), user?.userId);
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getHistory = async (req: Request, res: Response) => {
        try {
            const userId = Number(req.params.userId);
            const history = await this.bookingService.getUserHistory(userId);
            res.json(history);
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
                activityId: z.preprocess((v) => Number(v), z.number().int().positive())
            });

            const parsed = querySchema.safeParse(req.query);

            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { date, activityId } = parsed.data;

            const searchDate = new Date(date);

            const slotsWithCourts = await this.bookingService.getAvailableSlotsWithCourts(
                searchDate,
                Number(activityId)
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

            const bookings = await this.bookingService.getDaySchedule(searchDate);
            res.json(bookings);
        } catch (error: any) {
            console.error('Error en getAdminSchedule:', error);
            res.status(500).json({ error: error.message });
        }
    }
    
    createFixed = async (req: Request, res: Response) => {
        try {
            const { userId, courtId, activityId, startDateTime } = req.body;
            
            // Convertimos string a Date
            const startDate = new Date(startDateTime);

            const result = await this.bookingService.createFixedBooking(
                userId, 
                courtId, 
                activityId, 
                startDate
            );
            
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    cancelFixed = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            const result = await this.bookingService.cancelFixedBooking(id);
            res.json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
}

