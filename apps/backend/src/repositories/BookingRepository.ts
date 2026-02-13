import { prisma } from '../prisma';
import { Booking } from '../entities/Booking';
import { User } from '../entities/User';
import { Court } from '../entities/Court';
import { Club } from '../entities/Club';
import { ActivityType } from '../entities/ActivityType';
import { BookingStatus, Role } from '../entities/Enums';
import { TimeHelper } from '../utils/TimeHelper';

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
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            guestPhone: booking.guestPhone,
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
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date);

        const found = await prisma.booking.findMany({
            where: {
                courtId: courtId,
                startDateTime: { gte: startUtc, lte: endUtc }
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
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startUtc, lte: endUtc },
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

        return bookings.map((b: any) => this.mapToEntity(b));
    }

    async findAllByDateAndClub(date: Date, clubId: number) {
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startUtc, lte: endUtc },
                status: { not: 'CANCELLED' },
                court: {
                    clubId: clubId
                }
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
        const user = dbItem.user ? new User(dbItem.user.id, dbItem.user.firstName, dbItem.user.lastName, dbItem.user.email, dbItem.user.phoneNumber, dbItem.user.role as Role) : null;
        const club = new Club(
            dbItem.court.club.id,
            dbItem.court.club.slug,
            dbItem.court.club.name,
            dbItem.court.club.addressLine,
            dbItem.court.club.city,
            dbItem.court.club.province,
            dbItem.court.club.country,
            dbItem.court.club.contactInfo,
            dbItem.court.club.phone || undefined,
            dbItem.court.club.logoUrl || undefined,
            dbItem.court.club.clubImageUrl || undefined,
            dbItem.court.club.instagramUrl || undefined,
            dbItem.court.club.facebookUrl || undefined,
            dbItem.court.club.websiteUrl || undefined,
            dbItem.court.club.description || undefined,
            dbItem.court.club.lightsEnabled ?? false,
            dbItem.court.club.lightsExtraAmount ?? null,
            dbItem.court.club.lightsFromHour ?? null,
            dbItem.court.club.createdAt,
            dbItem.court.club.updatedAt
        );
    const court = new Court(dbItem.court.id, dbItem.court.name, dbItem.court.isIndoor, dbItem.court.surface, club, dbItem.court.isUnderMaintenance, null);
        const activity = new ActivityType(dbItem.activity.id, dbItem.activity.name, dbItem.activity.description, dbItem.activity.defaultDurationMinutes);

        const booking = new Booking(
            dbItem.id,
            dbItem.startDateTime,
            dbItem.endDateTime,
            dbItem.price,
            user,
            court,
            activity,
            dbItem.status as BookingStatus,
            dbItem.guestIdentifier,
            dbItem.guestName,
            dbItem.guestEmail,
            dbItem.guestPhone,
            dbItem.fixedBookingId || null 
        );
        if (dbItem.cancelledBy) booking.cancelledBy = dbItem.cancelledBy;
        if (dbItem.cancelledAt) booking.cancelledAt = dbItem.cancelledAt;

        return booking;
    }
}

