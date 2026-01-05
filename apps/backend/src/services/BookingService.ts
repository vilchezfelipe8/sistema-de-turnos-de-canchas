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
                throw new Error(`El slot ${startDateTime.toISOString()} ya está ocupado.`);
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

        const clubOpenTime = "09:00";
        const clubCloseTime = "23:00";
        const duration = activity.defaultDurationMinutes;

        const possibleSlots: string[] = [];
        let currentTime = clubOpenTime;

        while (TimeHelper.timeToMinutes(currentTime) + duration <= TimeHelper.timeToMinutes(clubCloseTime)) {
            possibleSlots.push(currentTime);
            currentTime = TimeHelper.addMinutes(currentTime, duration);
        }

        const existingBookings = await this.bookingRepo.findByCourtAndDate(courtId, date);

        const freeSlots = possibleSlots.filter(slotStart => {
            const slotEnd = TimeHelper.addMinutes(slotStart, duration);

            const [sh, sm] = slotStart.split(':').map(Number);
            const [eh, em] = slotEnd.split(':').map(Number);
            const slotStartDate = new Date(date);
            slotStartDate.setHours(sh, sm, 0, 0);
            const slotEndDate = new Date(date);
            slotEndDate.setHours(eh, em, 0, 0);

            const isOccupied = existingBookings.some(booking => {
                if (booking.status === BookingStatus.CANCELLED) return false;
                return TimeHelper.isOverlappingDates(slotStartDate, slotEndDate, booking.startDateTime, booking.endDateTime);
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
        return await this.bookingRepo.findAllByDate(date);
    }
}

