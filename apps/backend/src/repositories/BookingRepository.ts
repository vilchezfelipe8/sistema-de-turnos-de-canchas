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
            // user puede ser null para reservas de invitado
            userId: booking.user ? booking.user.id : undefined,
            guestIdentifier: booking.guestIdentifier,
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
        // Normalizar a UTC para evitar inconsistencias entre creación y lectura de bookings
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();

        const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

        console.log('Buscando bookings para cancha', courtId, 'entre:', startOfDay.toISOString(), 'y', endOfDay.toISOString());

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
            status: { not: BookingStatus.CANCELLED }
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
        // Normalizar a UTC para que todas las consultas de día usen el mismo rango
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();

        const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

        console.log('Buscando bookings entre:', startOfDay.toISOString(), 'y', endOfDay.toISOString());

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startOfDay, lte: endOfDay },
                status: { not: 'CANCELLED' }
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

        console.log('Encontradas', bookings.length, 'reservas');

        // 👇👇👇 AGREGA ESTO JUSTO AQUÍ 👇👇👇
        if (bookings.length > 0) {
            console.log("--------------------------------------------------");
            console.log("🕵️ DETALLE DE RESERVAS ENCONTRADAS:");
            bookings.forEach((b: any) => {
                console.log(`👉 ID: ${b.id} | Cancha: ${b.courtId} | Hora: ${b.startDateTime.toISOString()} | Status: ${b.status}`);
            });
            console.log("--------------------------------------------------");
        }
        // 👆👆👆 ----------------------------- 👆👆👆

        return bookings.map((b: any) => this.mapToEntity(b));
    }

    // Helper para convertir lo que viene de DB a tu Clase Entidad
    public mapToEntity(dbItem: any): Booking {
        const user = dbItem.user ? new User(dbItem.user.id, dbItem.user.firstName, dbItem.user.lastName, dbItem.user.email, dbItem.user.phoneNumber, dbItem.user.role as Role) : null;
        const club = new Club(dbItem.court.club.id, dbItem.court.club.name, dbItem.court.club.address, dbItem.court.club.contactInfo);
        const court = new Court(dbItem.court.id, dbItem.court.name, dbItem.court.isIndoor, dbItem.court.surface, club, dbItem.court.isUnderMaintenance);
        const activity = new ActivityType(dbItem.activity.id, dbItem.activity.name, dbItem.activity.description, dbItem.activity.defaultDurationMinutes);

        const booking = new Booking(
            dbItem.id,
            dbItem.startDateTime,
            dbItem.endDateTime,
            dbItem.price,
            user, court, activity, dbItem.status as BookingStatus, dbItem.guestIdentifier
        );
        if (dbItem.cancelledBy) booking.cancelledBy = dbItem.cancelledBy;
        if (dbItem.cancelledAt) booking.cancelledAt = dbItem.cancelledAt;

        return booking;
    }
}

