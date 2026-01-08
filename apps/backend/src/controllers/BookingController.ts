import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';
import { prisma } from '../prisma';

export class BookingController {
    constructor(private bookingService: BookingService) {}

    createBooking = async (req: Request, res: Response) => {
        try {
            const user = (req as any).user;
            const userIdFromToken = user?.id || user?.userId;
    
            if (!userIdFromToken) {
                return res.status(401).json({ error: "Usuario no autenticado (Token inválido o sin ID)" });
            }
    
            const createSchema = z.object({
                userId: z.preprocess((v) => Number(v), z.number().int().positive()),
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO datetime' }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive())
            });
    
            const dataToValidate = {
                ...req.body,
                userId: userIdFromToken
            };
    
            const parsed = createSchema.safeParse(dataToValidate);
    
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
    
            // [MODIFICADO] Quitamos courtId de la desestructuración
            const { userId, courtId, startDateTime, activityId } = parsed.data;
            const startDate = new Date(String(startDateTime));

            // [MODIFICADO] Verificar que la cancha esté disponible antes de crear la reserva
            const existingBooking = await prisma.booking.findFirst({
                where: {
                    courtId: courtId,
                    startDateTime: startDate,
                    status: { not: 'CANCELLED' }
                }
            });

            if (existingBooking) {
                return res.status(400).json({ error: "Esta cancha ya está reservada en ese horario." });
            }

            const result = await this.bookingService.createBooking(
                Number(userId),
                Number(courtId),
                startDate,
                Number(activityId)
            );
            // Enviar la reserva y una flag para que el frontend sepa que debe refrescar la grilla
            const year = startDate.getUTCFullYear();
            const month = String(startDate.getUTCMonth() + 1).padStart(2, '0');
            const day = String(startDate.getUTCDate()).padStart(2, '0');
            const refreshDate = `${year}-${month}-${day}`;

            // Mantener compatibilidad: devolver el objeto de reserva con campos extra
            const payload = { ...result, refresh: true, refreshDate };
            res.status(201).json(payload);
        } catch (error: any) {
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

            console.log('Buscando reservas para fecha:', searchDate.toISOString());

            const bookings = await this.bookingService.getDaySchedule(searchDate);
            res.json(bookings);
        } catch (error: any) {
            console.error('Error en getAdminSchedule:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

