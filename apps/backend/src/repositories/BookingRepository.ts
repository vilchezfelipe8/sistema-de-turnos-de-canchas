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
            userId: booking.user ? booking.user.id : null,
            guestIdentifier: booking.guestIdentifier,
            courtId: booking.court.id,
            activityId: booking.activity.id,
            clubId: booking.court.club.id
        };

        const saved = await prisma.booking.create({
            data,
            include: { user: true, client: true, court: { include: { club: true } }, activity: true }
        });
        return this.mapToEntity(saved);
    }

    async findByCourtAndDate(courtId: number, date: Date, timeZone: string): Promise<Booking[]> {
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, timeZone);

        const found = await prisma.booking.findMany({
            where: {
                courtId: courtId,
                startDateTime: { gte: startUtc, lte: endUtc }
            },
            include: { user: true, client: true, court: { include: { club: true } }, activity: true }
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
            include: { user: true, client: true, court: { include: { club: true } }, activity: true }
        });
        if (!found) return undefined;
        return this.mapToEntity(found);
    }

    async findByUserId(userId: number): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            where: { userId },
            include: { user: true, client: true, court: { include: { club: true } }, activity: true }
        });
        return found.map((b: any) => this.mapToEntity(b));
    }

    async findAll(): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            include: { user: true, client: true, court: { include: { club: true } }, activity: true }
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

    async findAllByDate(date: Date, timeZone: string, clubId?: number) {
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, timeZone);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startUtc, lte: endUtc },
                status: { not: 'CANCELLED' },
                ...(clubId ? { clubId } : {})
            },
            include: {
                user: true,
                client: true,
                court: { include: { club: true } },
                activity: true
            },
            orderBy: {
                startDateTime: 'asc'
            }
        });

        return bookings.map((b: any) => this.mapToEntity(b));
    }

    async findAllByDateAndClub(date: Date, clubId: number, timeZone: string) {
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, timeZone);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { gte: startUtc, lte: endUtc },
                status: { not: 'CANCELLED' },
                clubId
            },
            include: {
                user: true,
                client: true,
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
        const user = dbItem.user
            ? new User(
                dbItem.user.id,
                dbItem.user.firstName,
                dbItem.user.lastName,
                dbItem.user.email,
                dbItem.user.phoneNumber,
                dbItem.user.role as Role,
                (dbItem.user as any).isProfessor ?? false
            )
            : null;
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
            dbItem.court.club.timeZone ?? 'America/Argentina/Buenos_Aires',
            dbItem.court.club.lightsEnabled ?? false,
            dbItem.court.club.lightsExtraAmount != null ? Number(dbItem.court.club.lightsExtraAmount) : null,
                dbItem.court.club.lightsFromHour ?? null,
                dbItem.court.club.professorDiscountEnabled ?? false,
                dbItem.court.club.professorDiscountPercent != null ? Number(dbItem.court.club.professorDiscountPercent) : null,
                null,
                null,
            dbItem.court.club.createdAt,
            dbItem.court.club.updatedAt
        );
    const court = new Court(dbItem.court.id, dbItem.court.name, dbItem.court.isIndoor, dbItem.court.surface, club, dbItem.court.isUnderMaintenance, null);
        const activity = new ActivityType(
            dbItem.activity.id,
            dbItem.activity.name,
            dbItem.activity.description,
            dbItem.activity.defaultDurationMinutes,
            dbItem.activity.clubId,
            dbItem.activity.scheduleMode,
            dbItem.activity.scheduleOpenTime,
            dbItem.activity.scheduleCloseTime,
            dbItem.activity.scheduleIntervalMinutes,
            Array.isArray(dbItem.activity.scheduleDurations) ? dbItem.activity.scheduleDurations : null,
            Array.isArray(dbItem.activity.scheduleFixedSlots) ? dbItem.activity.scheduleFixedSlots : null
        );

        const client = dbItem.client
            ? {
                id: dbItem.client.id,
                name: dbItem.client.name,
                dni: dbItem.client.dni ?? null,
                phone: dbItem.client.phone ?? null,
                email: dbItem.client.email ?? null
            }
            : null;

        const booking = new Booking(
            dbItem.id,
            dbItem.startDateTime,
            dbItem.endDateTime,
            Number(dbItem.price || 0),
            user,
            court,
            activity,
            dbItem.status as BookingStatus,
            dbItem.guestIdentifier,
            dbItem.fixedBookingId || null,
            dbItem.clientId ?? null,
            client
        );
        if (dbItem.cancelledBy) booking.cancelledBy = dbItem.cancelledBy;
        if (dbItem.cancelledAt) booking.cancelledAt = dbItem.cancelledAt;
        if (dbItem.createdAt) booking.createdAt = dbItem.createdAt;

        return booking;
    }
}

