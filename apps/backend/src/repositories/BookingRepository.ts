import { prisma } from '../prisma';
import { Booking } from '../entities/Booking';
import { User } from '../entities/User';
import { Court } from '../entities/Court';
import { Club } from '../entities/Club';
import { ActivityType } from '../entities/ActivityType';
import { BookingStatus, Role } from '../entities/Enums';

export class BookingRepository {

    async save(booking: Booking): Promise<Booking> {
        const data: any = {
            startDateTime: booking.startDateTime,
            endDateTime: booking.endDateTime,
            price: booking.price,
            status: booking.status,
            userId: booking.user.id,
            courtId: booking.court.id,
            activityId: booking.activity.id
        };

        const saved = await prisma.booking.create({
            data,
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        return this.mapToEntity(saved);
    }

    async findByCourtAndDate(courtId: number, date: Date): Promise<Booking[]> {
        const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);

        const found = await prisma.booking.findMany({
            where: {
                courtId: courtId,
                startDateTime: { gte: startOfDay, lte: endOfDay }
            },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });

        return found.map((b: any) => this.mapToEntity(b));
    }

    async findByCourtAndDateRange(courtId: number, start: Date, end: Date) {
    return await prisma.booking.findMany({ 
        where: {
            courtId: courtId,
            startDateTime: {
                gte: start,
                lte: end
            },
            status: { not: 'CANCELLED' }
        }
    });
}

    async findById(id: number): Promise<Booking | undefined> {
        const found = await prisma.booking.findUnique({
            where: { id },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        if (!found) return undefined;
        return this.mapToEntity(found);
    }

    async findByUserId(userId: number): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            where: { userId },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        return found.map((b: any) => this.mapToEntity(b));
    }

    async findAll(): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        return found.map((b: any) => this.mapToEntity(b));
    }

    async delete(id: number, cancelledBy?: number): Promise<void> {
        const data: any = {
            status: 'CANCELLED',
            cancelledAt: new Date()
        };
        if (cancelledBy) data.cancelledBy = cancelledBy;
        await prisma.booking.update({
            where: { id: id },
            data
        });
    }

    async findAllByDate(date: Date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startOfDay, lte: endOfDay }
            },
            include: {
                user: true,
                court: { include: { club: true } },
                activity: true
            },
            orderBy: {
                startDateTime: 'asc'
            }
        });

        return bookings.map((b: any) => this.mapToEntity(b));
    }

    // Helper para convertir lo que viene de DB a tu Clase Entidad
    public mapToEntity(dbItem: any): Booking {
        const user = new User(dbItem.user.id, dbItem.user.firstName, dbItem.user.lastName, dbItem.user.email, dbItem.user.phoneNumber, dbItem.user.role as Role);
        const club = new Club(dbItem.court.club.id, dbItem.court.club.name, dbItem.court.club.address, dbItem.court.club.contactInfo);
        const court = new Court(dbItem.court.id, dbItem.court.name, dbItem.court.isIndoor, dbItem.court.surface, club, dbItem.court.isUnderMaintenance);
        const activity = new ActivityType(dbItem.activity.id, dbItem.activity.name, dbItem.activity.description, dbItem.activity.defaultDurationMinutes);

        const booking = new Booking(
            dbItem.id,
            dbItem.startDateTime,
            dbItem.endDateTime,
            dbItem.price,
            user, court, activity, dbItem.status as BookingStatus
        );
        if (dbItem.cancelledBy) booking.cancelledBy = dbItem.cancelledBy;
        if (dbItem.cancelledAt) booking.cancelledAt = dbItem.cancelledAt;

        return booking;
    }
}

