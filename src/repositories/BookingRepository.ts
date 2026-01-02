import { prisma } from '../prisma';
import { Booking } from '../entities/Booking';
import { User } from '../entities/User';
import { Court } from '../entities/Court';
import { Club } from '../entities/Club';
import { ActivityType } from '../entities/ActivityType';
import { BookingStatus, Role } from '../entities/Enums';

export class BookingRepository {

    async save(booking: Booking): Promise<Booking> {
        const saved = await prisma.booking.create({
            data: {
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                price: booking.price,
                status: booking.status,
                userId: booking.user.id,
                courtId: booking.court.id,
                activityId: booking.activity.id
            },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        return this.mapToEntity(saved);
    }

    async findByCourtAndDate(courtId: number, date: Date): Promise<Booking[]> {
        // Prisma busca por fecha exacta. Nos aseguramos de comparar el día.
        const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);

        const found = await prisma.booking.findMany({
            where: {
                courtId: courtId,
                date: {
                    gte: startOfDay, // Mayor o igual al inicio del día
                    lte: endOfDay    // Menor o igual al fin del día
                }
            },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });

        return found.map(b => this.mapToEntity(b));
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
        return found.map(b => this.mapToEntity(b));
    }

    async findAll(): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            include: { user: true, court: { include: { club: true } }, activity: true }
        });
        return found.map(b => this.mapToEntity(b));
    }

    async delete(id: number): Promise<void> {
        await prisma.booking.delete({
            where: { id: id }
        });
    }

    // Buscar todas las reservas de una fecha específica (Grilla del día)
    async findAllByDate(date: Date) {
        // Truco para asegurar todo el día: desde las 00:00 hasta las 23:59
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const bookings = await prisma.booking.findMany({
            where: {
                date: {
                    gte: startOfDay, // Mayor o igual al inicio del día
                    lte: endOfDay    // Menor o igual al fin del día
                }
            },
            include: {
                user: true,   // Traemos al usuario para saber quién reservó
                court: true   // Traemos la cancha para saber dónde juegan
            },
            orderBy: {
                startTime: 'asc' // Ordenado por hora (de la mañana a la noche)
            }
        });

        return bookings;
    }

    // Helper para convertir lo que viene de DB a tu Clase Entidad
    private mapToEntity(dbItem: any): Booking {
        const user = new User(dbItem.user.id, dbItem.user.firstName, dbItem.user.lastName, dbItem.user.email, dbItem.user.phoneNumber, dbItem.user.role as Role);
        const club = new Club(dbItem.court.club.id, dbItem.court.club.name, dbItem.court.club.address, dbItem.court.club.contactInfo);
        const court = new Court(dbItem.court.id, dbItem.court.name, dbItem.court.isIndoor, dbItem.court.surface, club, dbItem.court.isUnderMaintenance);
        const activity = new ActivityType(dbItem.activity.id, dbItem.activity.name, dbItem.activity.description, dbItem.activity.defaultDurationMinutes);

        const booking = new Booking(
            dbItem.id, dbItem.date, dbItem.startTime, dbItem.endTime, dbItem.price,
            user, court, activity, dbItem.status as BookingStatus
        );
        return booking;
    }
}