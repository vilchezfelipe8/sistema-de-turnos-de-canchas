import webpush from 'web-push';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';

// Avisos push web (Web Push + VAPID). Se encolan en el outbox (en la misma transacción que el evento)
// y los envía el worker con reintentos. Si las claves VAPID no están configuradas, no se envía nada.

export type PushKind = 'INVITATION' | 'INVITATION_RESPONSE' | 'BOOKING_REMINDER' | 'BOOKING_CANCELLED' | 'BOOKING_CONFIRMED';

export type PushAction = { action: string; title: string; url: string };

export type PushContent = {
    title: string;
    body: string;
    url: string;
    tag?: string;
    actions?: PushAction[];
};

export type PushOutboxPayload = PushContent & { userId: number; kind: PushKind };

type DbClient = Prisma.TransactionClient | PrismaClient;

const PUSH_TTL_SECONDS = 60 * 60 * 24;
const MAX_PUSH_ATTEMPTS = 5;

let vapidConfigured: boolean | null = null;

export const getVapidPublicKey = () => String(process.env.VAPID_PUBLIC_KEY || '').trim();

export const isPushConfigured = () => {
    if (vapidConfigured !== null) return vapidConfigured;
    const publicKey = getVapidPublicKey();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = String(process.env.VAPID_SUBJECT || 'mailto:soporte.pique@gmail.com').trim();
    if (!publicKey || !privateKey) {
        vapidConfigured = false;
        return false;
    }
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
    } catch (error) {
        console.error('❌ Claves VAPID inválidas: los avisos push quedan desactivados.', error);
        vapidConfigured = false;
    }
    return vapidConfigured;
};

// ---------------------------------------------------------------------------
// Contexto de la reserva para armar los textos
// ---------------------------------------------------------------------------

export type BookingPushContext = {
    bookingId: number;
    clubId: number;
    clubName: string;
    address: string;
    courtName: string;
    activityName: string;
    dayLabel: string;
    timeLabel: string;
    ownerUserId: number | null;
    playerCount: number | null;
};

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const loadBookingPushContext = async (client: DbClient, bookingId: number): Promise<BookingPushContext | null> => {
    const booking = await client.booking.findUnique({
        where: { id: bookingId },
        select: {
            id: true,
            clubId: true,
            userId: true,
            startDateTime: true,
            court: { select: { name: true } },
            activity: { select: { name: true } },
            activityFormat: { select: { playerCount: true } },
            club: { select: { name: true, addressLine: true, city: true } }
        }
    });
    if (!booking) return null;
    const settings = await client.clubSettings.findUnique({
        where: { clubId: booking.clubId },
        select: { timeZone: true }
    });
    const timeZone = settings?.timeZone || 'America/Argentina/Buenos_Aires';
    const start = new Date(booking.startDateTime);
    const weekday = new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'short' }).format(start).replace('.', '');
    const day = new Intl.DateTimeFormat('es-AR', { timeZone, day: 'numeric' }).format(start);
    const time = new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
    return {
        bookingId: booking.id,
        clubId: booking.clubId,
        clubName: booking.club?.name || 'el club',
        address: [booking.club?.addressLine, booking.club?.city].filter(Boolean).join(', '),
        courtName: booking.court?.name || 'Cancha',
        activityName: booking.activity?.name || 'Turno',
        dayLabel: `${capitalize(weekday)} ${day}`,
        timeLabel: time,
        ownerUserId: booking.userId ?? null,
        playerCount: booking.activityFormat?.playerCount ?? null
    };
};

export const shortUserName = (user: { firstName?: string | null; lastName?: string | null } | null | undefined) => {
    const first = String(user?.firstName || '').trim();
    const lastInitial = String(user?.lastName || '').trim().charAt(0);
    return `${first}${lastInitial ? ` ${lastInitial}.` : ''}`.trim() || 'Un jugador';
};

const bookingLine = (ctx: BookingPushContext) =>
    `${ctx.activityName} · ${ctx.dayLabel} · ${ctx.timeLabel} · ${ctx.courtName} · ${ctx.clubName}`;

const bookingUrl = (bookingId: number) => `/bookings?booking=${bookingId}`;

// ---------------------------------------------------------------------------
// Textos de cada aviso
// ---------------------------------------------------------------------------

export const PushMessages = {
    invitation(ctx: BookingPushContext, inviterName: string): PushContent {
        return {
            title: `${inviterName} te invitó a jugar 🎾`,
            body: `${bookingLine(ctx)}. Tocá para aceptar.`,
            url: '/bookings#invitaciones',
            tag: `invitation-${ctx.bookingId}`
        };
    },
    invitationAccepted(ctx: BookingPushContext, playerName: string, joinedCount: number): PushContent {
        const capacity = ctx.playerCount;
        const joined = capacity ? Math.min(joinedCount, capacity) : joinedCount;
        const missing = capacity ? Math.max(0, capacity - joined) : 0;
        const progress = capacity ? ` Ya son ${joined} de ${capacity} para el ${ctx.activityName} del ${ctx.dayLabel} · ${ctx.timeLabel}.` : ` ${ctx.activityName} · ${ctx.dayLabel} · ${ctx.timeLabel}.`;
        const tail = capacity ? (missing > 0 ? ` Falta${missing === 1 ? '' : 'n'} ${missing} lugar${missing === 1 ? '' : 'es'}.` : ' ¡Están completos!') : '';
        return {
            title: `${playerName} aceptó tu invitación ✅`,
            body: `${progress.trim()}${tail}`,
            url: bookingUrl(ctx.bookingId),
            tag: `invitation-response-${ctx.bookingId}`
        };
    },
    invitationDeclined(ctx: BookingPushContext, playerName: string): PushContent {
        return {
            title: `${playerName} no puede jugar`,
            body: `Rechazó la invitación del ${ctx.dayLabel} · ${ctx.timeLabel}. Tocá para invitar a otra persona.`,
            url: bookingUrl(ctx.bookingId),
            tag: `invitation-response-${ctx.bookingId}`
        };
    },
    reminder(ctx: BookingPushContext): PushContent {
        const actions: PushAction[] = [{ action: 'view', title: 'Ver reserva', url: bookingUrl(ctx.bookingId) }];
        if (ctx.address) {
            actions.push({
                action: 'map',
                title: 'Cómo llegar',
                url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ctx.clubName}, ${ctx.address}`)}`
            });
        }
        return {
            title: 'Tu turno es en 2 horas ⏰',
            body: `${ctx.activityName} · ${ctx.courtName} · ${ctx.timeLabel} · ${ctx.clubName}.`,
            url: bookingUrl(ctx.bookingId),
            tag: `reminder-${ctx.bookingId}`,
            actions
        };
    },
    confirmedByClub(ctx: BookingPushContext): PushContent {
        return {
            title: `${ctx.clubName} confirmó tu reserva ✅`,
            body: `${ctx.activityName} · ${ctx.dayLabel} · ${ctx.timeLabel} · ${ctx.courtName}. ¡Te esperamos!`,
            url: bookingUrl(ctx.bookingId),
            tag: `confirmed-${ctx.bookingId}`
        };
    },
    cancelledByClub(ctx: BookingPushContext, reason: { text?: string | null; autoCancel?: boolean }): PushContent {
        const reasonText = String(reason.text || '').trim();
        const motive = reasonText
            ? ` Motivo: ${reasonText.replace(/\.$/, '')}.`
            : reason.autoCancel
                ? ' No se confirmó a tiempo.'
                : '';
        return {
            title: `${ctx.clubName} canceló tu reserva ❌`,
            body: `${ctx.activityName} · ${ctx.dayLabel} · ${ctx.timeLabel} · ${ctx.courtName}.${motive} Tocá para ver opciones.`,
            url: bookingUrl(ctx.bookingId),
            tag: `cancelled-${ctx.bookingId}`
        };
    }
};

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

export class PushNotificationService {
    private readonly outboxService = new OutboxService();

    // Se encola en la misma transacción que el evento (si la transacción se revierte, no hay aviso).
    async enqueue(
        client: DbClient,
        input: { clubId: number; userId: number; kind: PushKind; content: PushContent; aggregateId?: string }
    ) {
        if (!Number.isInteger(input.userId) || input.userId <= 0) return;
        const payload: PushOutboxPayload = { userId: input.userId, kind: input.kind, ...input.content };
        await this.outboxService.enqueue(
            {
                clubId: input.clubId,
                type: OUTBOX_TYPES.PUSH_SEND,
                aggregateType: 'Booking',
                aggregateId: input.aggregateId,
                payload: payload as unknown as Record<string, unknown>
            },
            client
        );
    }

    private async isAllowedByPreferences(userId: number, kind: PushKind) {
        // Cambios de estado de la reserva hechos por el club: siempre se avisan.
        if (kind === 'BOOKING_CANCELLED' || kind === 'BOOKING_CONFIRMED') return true;
        const preferences = await prisma.userNotificationPreference.findUnique({ where: { userId } });
        if (!preferences) return true;
        if (kind === 'INVITATION') return preferences.invitations;
        if (kind === 'INVITATION_RESPONSE') return preferences.invitationResponses;
        if (kind === 'BOOKING_REMINDER') return preferences.bookingReminders;
        return true;
    }

    // Envía a todos los dispositivos del usuario. Borra suscripciones vencidas (404/410).
    // Devuelve un motivo cuando no corresponde enviar; lanza error si conviene reintentar.
    async deliver(payload: PushOutboxPayload, attempts: number): Promise<{ sent: number; skipped?: string }> {
        if (!isPushConfigured()) return { sent: 0, skipped: 'VAPID_NOT_CONFIGURED' };
        const userId = Number(payload?.userId || 0);
        if (!Number.isInteger(userId) || userId <= 0 || !payload?.title) return { sent: 0, skipped: 'INVALID_PAYLOAD' };
        if (!(await this.isAllowedByPreferences(userId, payload.kind))) return { sent: 0, skipped: 'DISABLED_BY_USER' };

        const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
        if (subscriptions.length === 0) return { sent: 0, skipped: 'NO_SUBSCRIPTIONS' };

        const body = JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url,
            tag: payload.tag,
            actions: payload.actions || []
        });

        let sent = 0;
        let retryableError: Error | null = null;
        for (const subscription of subscriptions) {
            try {
                await webpush.sendNotification(
                    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
                    body,
                    { TTL: PUSH_TTL_SECONDS, urgency: payload.kind === 'BOOKING_CANCELLED' ? 'high' : 'normal' }
                );
                sent += 1;
                await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastSentAt: new Date() } });
            } catch (caught: unknown) {
                const error = caught as { statusCode?: number; message?: string };
                const statusCode = Number(error?.statusCode || 0);
                if (statusCode === 404 || statusCode === 410) {
                    // El usuario desinstaló o revocó el permiso en ese dispositivo.
                    await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
                    continue;
                }
                retryableError = error instanceof Error ? error : new Error(String(error?.message || error));
            }
        }

        if (sent === 0 && retryableError && attempts + 1 < MAX_PUSH_ATTEMPTS) {
            throw retryableError;
        }
        return { sent, ...(sent === 0 && retryableError ? { skipped: `FAILED: ${retryableError.message}` } : {}) };
    }

    // ---- Suscripciones y preferencias ----

    async saveSubscription(userId: number, input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) {
        // El mismo navegador puede pasar a otra cuenta: la suscripción queda del último usuario.
        await prisma.pushSubscription.upsert({
            where: { endpoint: input.endpoint },
            create: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null },
            update: { userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent ?? null }
        });
    }

    async deleteSubscription(userId: number, endpoint: string) {
        await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    }

    async getPreferences(userId: number) {
        const preferences = await prisma.userNotificationPreference.findUnique({ where: { userId } });
        return {
            invitations: preferences?.invitations ?? true,
            invitationResponses: preferences?.invitationResponses ?? true,
            bookingReminders: preferences?.bookingReminders ?? true
        };
    }

    async updatePreferences(
        userId: number,
        input: Partial<{ invitations: boolean; invitationResponses: boolean; bookingReminders: boolean }>
    ) {
        await prisma.userNotificationPreference.upsert({
            where: { userId },
            create: { userId, ...input },
            update: input
        });
        return this.getPreferences(userId);
    }
}

export const pushNotificationService = new PushNotificationService();
