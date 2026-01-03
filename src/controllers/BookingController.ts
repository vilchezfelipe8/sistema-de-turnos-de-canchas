import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';
import { z } from 'zod';

export class BookingController {
    constructor(private bookingService: BookingService) {}

    createBooking = async (req: Request, res: Response) => {
        try {
            const createSchema = z.object({
                userId: z.preprocess((v) => Number(v), z.number().int().positive()),
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                startDateTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO datetime' }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = createSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { userId, courtId, startDateTime, activityId } = parsed.data;
            const startDate = new Date(String(startDateTime));

            const result = await this.bookingService.createBooking(
                Number(userId),
                Number(courtId),
                startDate,
                Number(activityId)
            );

            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getAvailability = async (req: Request, res: Response) => {
        try {
            const querySchema = z.object({
                courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
                date: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid date' }),
                activityId: z.preprocess((v) => Number(v), z.number().int().positive())
            });

            const parsed = querySchema.safeParse(req.query);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const { courtId, date, activityId } = parsed.data;
            const searchDate = new Date(String(date));
            searchDate.setHours(0,0,0,0);

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

    getAdminSchedule = async (req: Request, res: Response) => {
        try {
            const { date } = req.query;
            if (!date) {
                return res.status(400).json({ error: "Falta el parámetro 'date' (ej: ?date=2025-10-25)" });
            }

            const searchDate = new Date(String(date) + "T12:00:00");
            const bookings = await this.bookingService.getDaySchedule(searchDate);
            res.json(bookings);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}