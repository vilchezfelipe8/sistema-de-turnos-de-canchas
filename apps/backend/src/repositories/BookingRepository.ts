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
            listPrice: booking.listPrice,
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
            include: { user: true, client: true, court: { include: { club: { include: { settings: true } } } }, activity: true }
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
            include: { user: true, client: true, court: { include: { club: { include: { settings: true } } } }, activity: true }
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
            include: { user: true, client: true, court: { include: { club: { include: { settings: true } } } }, activity: true }
        });
        if (!found) return undefined;
        return this.mapToEntity(found);
    }

    async findByUserId(userId: number): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            where: { userId },
            include: { user: true, client: true, court: { include: { club: { include: { settings: true } } } }, activity: true }
        });
        return found.map((b: any) => this.mapToEntity(b));
    }

    async findAll(): Promise<Booking[]> {
        const found = await prisma.booking.findMany({
            include: { user: true, client: true, court: { include: { club: { include: { settings: true } } } }, activity: true }
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
                court: { include: { club: { include: { settings: true } } } },
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
                court: { include: { club: { include: { settings: true } } } },
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
        const c = dbItem.court.club;
        const s = c.settings ?? null;
        const club = new Club(
            c.id,
            c.slug,
            c.name,
            c.addressLine,
            c.city,
            c.province,
            c.country,
            c.contactInfo,
            c.phone || undefined,
            c.logoUrl || undefined,
            c.clubImageUrl || undefined,
            c.instagramUrl || undefined,
            c.facebookUrl || undefined,
            c.websiteUrl || undefined,
            c.description || undefined,
            s?.timeZone ?? 'America/Argentina/Buenos_Aires',
            s?.lightsEnabled ?? false,
            s?.lightsExtraAmount != null ? Number(s.lightsExtraAmount) : null,
            s?.lightsFromHour != null ? String(s.lightsFromHour) : null,
            s?.professorDurationOverrideEnabled ?? true,
            s?.professorDurationOverrideMinutes != null ? Number(s.professorDurationOverrideMinutes) : 60,
            (s?.fixedBookingSettingsByActivity ?? null) as any,
            s?.bookingConfirmationMode ?? 'MANUAL',
            s?.bookingDepositPercent != null ? Number(s.bookingDepositPercent) : null,
            s?.allowManualConfirmationOverride ?? true,
            s?.autoCancelPendingBookingsEnabled ?? false,
            s?.autoCancelPendingBookingsMinutesBefore != null ? Number(s.autoCancelPendingBookingsMinutesBefore) : null,
            s?.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
            s?.autoCancelPendingWarningEnabled ?? false,
            s?.autoCancelPendingWarningMinutesBefore != null ? Number(s.autoCancelPendingWarningMinutesBefore) : null,
            s?.enforceCashShiftCloseWithOpenAccounts ?? false,
            Array.isArray(s?.openingDays) ? s.openingDays : null,
            c.createdAt,
            c.updatedAt
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
        booking.listPrice = Number(dbItem.listPrice || dbItem.price || 0);
        if (dbItem.cancelledBy) booking.cancelledBy = dbItem.cancelledBy;
        if (dbItem.cancelledAt) booking.cancelledAt = dbItem.cancelledAt;
        if (dbItem.createdAt) booking.createdAt = dbItem.createdAt;

        return booking;
    }
}
