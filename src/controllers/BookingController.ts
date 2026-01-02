import { Request, Response } from 'express';
import { BookingService } from '../services/BookingService';

export class BookingController {
    constructor(private bookingService: BookingService) {}

    // POST /api/bookings
    createBooking = async (req: Request, res: Response) => {
        try {
            // Extraemos datos del JSON que nos mandan
            const { userId, courtId, date, startTime, activityId } = req.body;

            // Convertimos el string de fecha a objeto Date
            const bookingDate = new Date(date);
            // Truco: setear horas a 0 para evitar líos de zona horaria en la comparación
            bookingDate.setHours(0,0,0,0);

            const result = await this.bookingService.createBooking(
                Number(userId),
                Number(courtId),
                bookingDate,
                startTime,
                Number(activityId)
            );

            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    // GET /api/bookings/availability
    // Query Params: ?courtId=1&date=2025-10-20&activityId=2
    getAvailability = async (req: Request, res: Response) => {
        try {
            const { courtId, date, activityId } = req.query;
            
            if (!courtId || !date || !activityId) {
                return res.status(400).json({ error: "Faltan parámetros (courtId, date, activityId)" });
            }

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

    // POST /api/bookings/cancel
    cancelBooking = async (req: Request, res: Response) => {
        try {
            const { bookingId} = req.body;
            const result = await this.bookingService.cancelBooking(Number(bookingId));
            res.json({ message: "Reserva cancelada", booking: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    // GET /api/bookings/history/:userId
    getHistory = async (req: Request, res: Response) => {
        try {
            const userId = Number(req.params.userId);
            const history = await this.bookingService.getUserHistory(userId);
            res.json(history);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    // GET /api/bookings/admin/schedule?date=2025-10-25
    getAdminSchedule = async (req: Request, res: Response) => {
        try {
            const { date } = req.query;

            if (!date) {
                return res.status(400).json({ error: "Falta el parámetro 'date' (ej: ?date=2025-10-25)" });
            }

            // Convertimos el string que llega a un objeto Date
            // Le agregamos "T12:00:00" para evitar problemas de zona horaria y asegurar que caiga en el día correcto
            const searchDate = new Date(String(date) + "T12:00:00"); 

            const bookings = await this.bookingService.getDaySchedule(searchDate);
            res.json(bookings);

        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}