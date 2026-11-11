import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { PushMessages, isPushConfigured, loadBookingPushContext, pushNotificationService } from './PushNotificationService';

// Recordatorio push ~2 horas antes del turno, a los jugadores confirmados (titular + quienes aceptaron).
// Corre en el scheduler; cada jugador lo recibe una sola vez por reserva (BookingReminderLog).

const REMINDER_KIND = 'BEFORE_2H';
const WINDOW_FROM_MINUTES = 90;
const WINDOW_TO_MINUTES = 120;
const MAX_BOOKINGS_PER_RUN = 300;

export class BookingReminderService {
    async processUpcomingReminders(now = new Date()) {
        if (!isPushConfigured()) return { enqueued: 0 };

        const from = new Date(now.getTime() + WINDOW_FROM_MINUTES * 60_000);
        const to = new Date(now.getTime() + WINDOW_TO_MINUTES * 60_000);
        const bookings = await prisma.booking.findMany({
            where: { status: 'CONFIRMED', startDateTime: { gt: from, lte: to } },
            orderBy: { startDateTime: 'asc' },
            take: MAX_BOOKINGS_PER_RUN,
            select: {
                id: true,
                clubId: true,
                userId: true,
                participants: { where: { status: 'JOINED', userId: { not: null } }, select: { userId: true } },
                reminderLogs: { where: { kind: REMINDER_KIND }, select: { userId: true } }
            }
        });

        let enqueued = 0;
        for (const booking of bookings) {
            const recipients = new Set<number>();
            if (booking.userId) recipients.add(booking.userId);
            booking.participants.forEach((participant) => { if (participant.userId) recipients.add(participant.userId); });
            booking.reminderLogs.forEach((log) => recipients.delete(log.userId));
            if (recipients.size === 0) continue;

            // Solo quienes tienen algún dispositivo con avisos activados.
            const subscribed = await prisma.pushSubscription.findMany({
                where: { userId: { in: Array.from(recipients) } },
                select: { userId: true },
                distinct: ['userId']
            });
            if (subscribed.length === 0) continue;

            const context = await loadBookingPushContext(prisma, booking.id);
            if (!context) continue;
            const content = PushMessages.reminder(context);

            for (const { userId } of subscribed) {
                try {
                    await prisma.bookingReminderLog.create({ data: { bookingId: booking.id, userId, kind: REMINDER_KIND } });
                } catch (error) {
                    // Ya enviado por otra corrida.
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
                    throw error;
                }
                await pushNotificationService.enqueue(prisma, {
                    clubId: booking.clubId,
                    userId,
                    kind: 'BOOKING_REMINDER',
                    aggregateId: String(booking.id),
                    content
                });
                enqueued += 1;
            }
        }
        return { enqueued };
    }
}
