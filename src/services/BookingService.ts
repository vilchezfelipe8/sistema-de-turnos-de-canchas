import { BookingRepository } from '../repositories/BookingRepository';
import { ClubRepository } from '../repositories/ClubRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Booking } from '../entities/Booking';
import { BookingStatus } from '../entities/Enums';
import { TimeHelper } from '../utils/TimeHelper'; // <--- Importamos el ayudante
import { Court } from '@prisma/client';
import { CourtRepository } from '../repositories/CourtRepository';

export class BookingService {
    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    // 1. CREAR RESERVA (Con duración automática)
    async createBooking(userId: number, courtId: number, date: Date, startTime: string, activityId: number): Promise<Booking> {
        
        const user = await this.userRepo.findById(userId);
        if (!user) throw new Error("Usuario no encontrado");

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");

        
        // --- LÓGICA NUEVA: CALCULAR HORA FIN REAL ---
        // Si es Padel (90 min), startTime "14:00" -> endTime "15:30"
        const endTime = TimeHelper.addMinutes(startTime, activity.defaultDurationMinutes);

        // --- LÓGICA NUEVA: VALIDAR COLISIÓN REAL ---
        const turnosExistentes = await this.bookingRepo.findByCourtAndDate(courtId, date);
        
        const tieneConflicto = turnosExistentes.some(booking => {
            if (booking.status === BookingStatus.CANCELLED) return false;
            // Usamos el Helper para ver si los horarios se pisan
            return TimeHelper.isOverlapping(startTime, endTime, booking.startTime, booking.endTime);
        });
        
        if (tieneConflicto) throw new Error(`El turno de ${startTime} a ${endTime} ya está ocupado.`);

        // GUARDAR
        const newBooking = new Booking(0, date, startTime, endTime, 1500, user as any, court as any, activity, BookingStatus.PENDING);
        return await this.bookingRepo.save(newBooking);
    }

    // 2. OBTENER TURNOS DISPONIBLES (La Grilla)
    async getAvailableSlots(courtId: number, date: Date, activityId: number): Promise<string[]> {
        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");

        // DEFINIR HORARIOS DEL CLUB (Esto podría estar en la entidad Club)
        const clubOpenTime = "09:00";
        const clubCloseTime = "23:00";
        const duration = activity.defaultDurationMinutes; // ej: 90 min

        // GENERAR TODOS LOS TURNOS POSIBLES (Slots)
        // Ejemplo: ["09:00", "10:30", "12:00"...]
        const possibleSlots: string[] = [];
        let currentTime = clubOpenTime;

        while (TimeHelper.timeToMinutes(currentTime) + duration <= TimeHelper.timeToMinutes(clubCloseTime)) {
            possibleSlots.push(currentTime);
            currentTime = TimeHelper.addMinutes(currentTime, duration);
        }

        // FILTRAR LOS OCUPADOS
        const existingBookings = await this.bookingRepo.findByCourtAndDate(courtId, date);

        const freeSlots = possibleSlots.filter(slotStart => {
            const slotEnd = TimeHelper.addMinutes(slotStart, duration);
            
            // Verificamos si este slot choca con alguna reserva existente
            const isOccupied = existingBookings.some(booking => {
                if (booking.status === BookingStatus.CANCELLED) return false;
                return TimeHelper.isOverlapping(slotStart, slotEnd, booking.startTime, booking.endTime);
            });

            return !isOccupied; // Solo devolvemos los que NO están ocupados
        });

        return freeSlots;
    }

    // ... (Mantener los otros métodos cancelBooking y getUserHistory igual que antes) ...
    async cancelBooking(bookingId: number): Promise<void> {
    // 1. Verificamos que exista
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) {
        throw new Error("La reserva no existe.");
    }

    // 2. La borramos directamente (sin validar hora ni usuario)
    await this.bookingRepo.delete(bookingId); 
}
    
    async getUserHistory(userId: number) {
        return await this.bookingRepo.findByUserId(userId);
    }

    async getDaySchedule(date: Date) {
        return await this.bookingRepo.findAllByDate(date);
    }
}