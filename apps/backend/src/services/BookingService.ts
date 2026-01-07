import { BookingRepository } from '../repositories/BookingRepository';
import { ClubRepository } from '../repositories/ClubRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Booking } from '../entities/Booking';
import { BookingStatus } from '../entities/Enums';
import { TimeHelper } from '../utils/TimeHelper';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma';
import { User } from '../entities/User';
import { Club } from '../entities/Club';
import { Court as CourtEntity } from '../entities/Court';
import { ActivityType } from '../entities/ActivityType';

export class BookingService {
    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    async createBooking(userId: number, courtId: number, startDateTime: Date, activityId: number): Promise<Booking> {
        const user = await this.userRepo.findById(userId);
        if (!user) throw new Error("Usuario no encontrado");

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");

        const endDateTime = new Date(startDateTime.getTime() + activity.defaultDurationMinutes * 60000);

        const created = await prisma.$transaction(async (tx: any) => {
            const overlapping = await tx.booking.findMany({
                where: {
                    courtId: courtId,
                    AND: [
                        { startDateTime: { lt: endDateTime } },
                        { endDateTime: { gt: startDateTime } }
                    ],
                    NOT: { status: BookingStatus.CANCELLED }
                },
                include: { user: true, court: { include: { club: true } }, activity: true }
            });

            if (overlapping.length > 0) {
                throw new Error(`El turno ${startDateTime.toISOString()} ya está ocupado.`);
            }

            const saved = await tx.booking.create({
                data: {
                    startDateTime,
                    endDateTime,
                    price: 1500,
                    status: BookingStatus.PENDING,
                    userId: userId,
                    courtId: courtId,
                    activityId: activityId
                },
                include: { user: true, court: { include: { club: true } }, activity: true }
            });

            return saved;
        });

        return this.bookingRepo.mapToEntity(created);
    }

async getAvailableSlots(courtId: number, date: Date, activityId: number): Promise<string[]> {
    
    
    const court = await this.courtRepo.findById(courtId);
    if (!court) throw new Error("Cancha no encontrada");

    const activity = await this.activityRepo.findById(activityId);
    if (!activity) throw new Error("Actividad no encontrada");

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    const existingBookings = await this.bookingRepo.findByCourtAndDateRange(courtId, startOfDay, endOfDay);

    const possibleSlots = [
        "08:00", 
        "09:30", 
        "11:00", 
        "12:30", 
        "14:00", 
        "15:30", 
        // "17:00" -> SALTADO (Descanso de 17:00 a 17:30) ☕
        "17:30", 
        "19:00", 
        "20:30",
        "22:00"
    ];

    const duration = activity.defaultDurationMinutes; 

    const freeSlots = possibleSlots.filter(slotStart => {
        const slotEnd = TimeHelper.addMinutes(slotStart, duration);

        const [sh, sm] = slotStart.split(':').map(Number);
        const [eh, em] = slotEnd.split(':').map(Number);

        const slotStartDate = new Date(Date.UTC(year, month, day, sh, sm, 0));
        const slotEndDate = new Date(Date.UTC(year, month, day, eh, em, 0));

        const isOccupied = existingBookings.some(booking => {
            if (booking.status === "CANCELLED") return false; 

            return TimeHelper.isOverlappingDates(
                slotStartDate, 
                slotEndDate, 
                booking.startDateTime, 
                booking.endDateTime
            );
        });

        return !isOccupied;
    });

    return freeSlots;
}

    async cancelBooking(bookingId: number, cancelledByUserId: number) {
        const booking = await this.bookingRepo.findById(bookingId);
        if (!booking) {
            throw new Error("La reserva no existe.");
        }
        await this.bookingRepo.delete(bookingId, cancelledByUserId);
        const updated = await this.bookingRepo.findById(bookingId);
        return updated;
    }

    async getUserHistory(userId: number) {
        return await this.bookingRepo.findByUserId(userId);
    }

    async getDaySchedule(date: Date) {
        // Obtener todas las canchas activas (no en mantenimiento)
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        // Obtener todas las bookings del día
        const bookings = await this.bookingRepo.findAllByDate(date);

        // Slots posibles del día
        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // Crear grilla completa
        const schedule = [];

        console.log('Creando grilla para', activeCourts.length, 'canchas activas');

        for (const court of activeCourts) {
            for (const slotTime of possibleSlots) {
                // Parsear el slot time - crear fecha en UTC
                const [hours, minutes] = slotTime.split(':').map(Number);
                const slotDateTime = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

                // Buscar si hay una booking para esta cancha y hora
                // Comparar en UTC para evitar problemas de zona horaria
                const booking = bookings.find(b => {
                    const courtMatch = b.court.id === court.id;
                    const bookingUTCTime = Date.UTC(
                        b.startDateTime.getUTCFullYear(),
                        b.startDateTime.getUTCMonth(),
                        b.startDateTime.getUTCDate(),
                        b.startDateTime.getUTCHours(),
                        b.startDateTime.getUTCMinutes()
                    );
                    const slotUTCTime = slotDateTime.getTime();
                    const timeMatch = bookingUTCTime === slotUTCTime;
                    
                    if (courtMatch) {
                        console.log(`Cancha ${court.id} - Booking UTC: ${new Date(bookingUTCTime).toISOString()}, Slot UTC: ${slotDateTime.toISOString()}`);
                        console.log(`Time match: ${timeMatch}`);
                    }
                    
                    return courtMatch && timeMatch;
                });

                schedule.push({
                    courtId: court.id,
                    courtName: court.name,
                    slotTime: slotTime,
                    startDateTime: slotDateTime.toISOString(),
                    isAvailable: !booking,
                    booking: booking || null
                });
            }
        }

        // Ordenar por hora (slotTime) primero, luego por nombre de cancha
        schedule.sort((a, b) => {
            // Primero comparar por slotTime
            if (a.slotTime < b.slotTime) return -1;
            if (a.slotTime > b.slotTime) return 1;
            // Si son iguales, comparar por courtName
            if (a.courtName < b.courtName) return -1;
            if (a.courtName > b.courtName) return 1;
            return 0;
        });

        return schedule;
    }

    async getAllAvailableSlots(date: Date, activityId: number): Promise<string[]> {
        // Obtener todas las canchas activas
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        // Obtener todas las bookings del día
        const bookings = await this.bookingRepo.findAllByDate(date);

        // Slots posibles del día
        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // Encontrar slots donde al menos una cancha está disponible
        const availableSlots = possibleSlots.filter(slotTime => {
            // Parsear el slot time - crear fecha en UTC
            const [hours, minutes] = slotTime.split(':').map(Number);
            const slotDateTime = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

            // Verificar si al menos una cancha está disponible en este slot
            const hasAvailableCourt = activeCourts.some(court => {
                const booking = bookings.find(b => {
                    const courtMatch = b.court.id === court.id;
                    const bookingUTCTime = Date.UTC(
                        b.startDateTime.getUTCFullYear(),
                        b.startDateTime.getUTCMonth(),
                        b.startDateTime.getUTCDate(),
                        b.startDateTime.getUTCHours(),
                        b.startDateTime.getUTCMinutes()
                    );
                    const slotUTCTime = slotDateTime.getTime();
                    const timeMatch = bookingUTCTime === slotUTCTime;
                    
                    return courtMatch && timeMatch;
                });
                return !booking; // Disponible si no hay booking
            });

            return hasAvailableCourt;
        });

        return availableSlots;
    }

    async getAvailableSlotsWithCourts(date: Date, activityId: number): Promise<Array<{
        slotTime: string;
        availableCourts: Array<{
            id: number;
            name: string;
        }>;
    }>> {
        // Obtener todas las canchas activas
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        // Obtener todas las bookings del día
        const bookings = await this.bookingRepo.findAllByDate(date);

        // Slots posibles del día
        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // Para cada slot, encontrar qué canchas están disponibles
        const slotsWithCourts = possibleSlots.map(slotTime => {
            // Parsear el slot time - crear fecha en UTC
            const [hours, minutes] = slotTime.split(':').map(Number);
            const slotDateTime = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

            // Encontrar canchas disponibles para este slot
            const availableCourts = activeCourts.filter(court => {
                const booking = bookings.find(b => {
                    const courtMatch = b.court.id === court.id;
                    const bookingUTCTime = Date.UTC(
                        b.startDateTime.getUTCFullYear(),
                        b.startDateTime.getUTCMonth(),
                        b.startDateTime.getUTCDate(),
                        b.startDateTime.getUTCHours(),
                        b.startDateTime.getUTCMinutes()
                    );
                    const slotUTCTime = slotDateTime.getTime();
                    const timeMatch = bookingUTCTime === slotUTCTime;
                    
                    return courtMatch && timeMatch;
                });
                return !booking; // Disponible si no hay booking
            }).map(court => ({
                id: court.id,
                name: court.name
            }));

            return {
                slotTime,
                availableCourts
            };
        }).filter(slot => slot.availableCourts.length > 0); // Solo incluir slots con al menos una cancha disponible

        return slotsWithCourts;
    }
}

