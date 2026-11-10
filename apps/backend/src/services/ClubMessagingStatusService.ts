import { prismaRead } from '../prisma';
import { featureFlags } from '../config/featureFlags';
import { toDialablePhoneNumber } from '../utils/phone';
import { WhatsappSenderResolver } from './WhatsappSenderResolver';

/**
 * Estado de los avisos por WhatsApp de un club, para mostrarle al club en palabras simples.
 * Solo lectura: no envía nada ni toca la configuración.
 */
export class ClubMessagingStatusService {
  private readonly senderResolver = new WhatsappSenderResolver();

  /** Últimos avisos del club, con la reserva a la que se refieren. Sin payloads crudos. */
  async getHistory(clubId: number, input: { onlyFailed?: boolean; limit?: number; clientId?: string } = {}) {
    const take = Math.min(100, Math.max(1, Math.floor(input.limit || 30)));
    // Por cliente: los avisos que le mandamos sobre sus reservas (las últimas 300).
    let clientFilter = {};
    if (input.clientId) {
      const clientBookings = await prismaRead.booking.findMany({
        where: { clubId, clientId: input.clientId },
        orderBy: { startDateTime: 'desc' },
        take: 300,
        select: { id: true }
      });
      if (clientBookings.length === 0) return [];
      clientFilter = {
        recipientRole: 'CUSTOMER' as const,
        outboxMessage: { aggregateType: 'BOOKING', aggregateId: { in: clientBookings.map((b) => String(b.id)) } }
      };
    }
    const rows = await prismaRead.whatsappDelivery.findMany({
      where: { clubId, ...(input.onlyFailed ? { status: 'FAILED' } : {}), ...clientFilter },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        status: true,
        eventType: true,
        recipientRole: true,
        recipientPhone: true,
        errorCode: true,
        outboxMessage: { select: { aggregateType: true, aggregateId: true } }
      }
    });

    const bookingIds = Array.from(
      new Set(
        rows
          .filter((row) => row.outboxMessage?.aggregateType === 'BOOKING')
          .map((row) => Number(row.outboxMessage?.aggregateId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const bookings = bookingIds.length
      ? await prismaRead.booking.findMany({
          where: { clubId, id: { in: bookingIds } },
          select: {
            id: true,
            startDateTime: true,
            court: { select: { name: true } },
            client: { select: { id: true, name: true } }
          }
        })
      : [];
    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));

    return rows.map((row) => {
      const bookingId = row.outboxMessage?.aggregateType === 'BOOKING' ? Number(row.outboxMessage.aggregateId) : NaN;
      const booking = bookingById.get(bookingId);
      return {
        id: row.id,
        createdAt: row.createdAt,
        status: row.status,
        eventType: row.eventType,
        recipientRole: row.recipientRole,
        recipientPhone: row.recipientPhone,
        // 131026: el número no tiene WhatsApp (código de Meta).
        failReason:
          row.status === 'FAILED'
            ? String(row.errorCode || '') === '131026'
              ? 'Ese número no tiene WhatsApp'
              : 'WhatsApp no lo pudo entregar'
            : null,
        booking: booking
          ? {
              id: booking.id,
              startDateTime: booking.startDateTime,
              courtName: booking.court?.name ?? null,
              clientId: booking.client?.id ?? null,
              clientName: booking.client?.name ?? null
            }
          : null
      };
    });
  }

  async getStatus(clubId: number) {
    const [club, settings, sender, recent] = await Promise.all([
      prismaRead.club.findUnique({ where: { id: clubId }, select: { phone: true } }),
      prismaRead.clubSettings.findUnique({
        where: { clubId },
        select: {
          autoCancelPendingBookingsEnabled: true,
          autoCancelPendingBookingsMinutesBefore: true,
          autoCancelPendingWarningEnabled: true,
          autoCancelPendingWarningMinutesBefore: true
        }
      }),
      this.senderResolver
        .resolve({ clubId, recipientRole: 'CUSTOMER', eventType: 'BOOKING_CREATED' })
        .catch(() => ({ ok: false as const })),
      prismaRead.whatsappDelivery.groupBy({
        by: ['status'],
        where: { clubId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        _count: { _all: true }
      })
    ]);

    // Por qué camino saldría cada aviso (el mismo que usan los servicios de reservas).
    const outbox = featureFlags.ENABLE_OUTBOX;
    const senderReady = Boolean((sender as { ok: boolean }).ok);
    const cloudReady =
      outbox && featureFlags.ENABLE_WHATSAPP_SEND_V2 && !featureFlags.ENABLE_WHATSAPP_V2_DRY_RUN && senderReady;
    const legacyReady = outbox && featureFlags.ENABLE_WHATSAPP_WORKER;
    const customerReady = featureFlags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2 ? cloudReady : legacyReady;
    const staffReady = featureFlags.ENABLE_WHATSAPP_STAFF_EVENTS_V2 ? cloudReady : legacyReady;

    const senderMode =
      senderReady && 'sender' in sender && sender.sender ? (sender.sender as { mode: string }).mode : null;

    const countBy = (statuses: string[]) =>
      recent.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);

    return {
      clubPhone: club?.phone ?? null,
      clubPhoneValid: Boolean(toDialablePhoneNumber(club?.phone ?? null)),
      customerReady,
      staffReady,
      senderMode,
      pendingWarning: {
        enabled: Boolean(settings?.autoCancelPendingWarningEnabled),
        minutesBefore: settings?.autoCancelPendingWarningMinutesBefore ?? null
      },
      autoCancel: {
        enabled: Boolean(settings?.autoCancelPendingBookingsEnabled),
        minutesBefore: settings?.autoCancelPendingBookingsMinutesBefore ?? null
      },
      last7Days: {
        sent: countBy(['ACCEPTED', 'SENT', 'DELIVERED', 'READ']),
        failed: countBy(['FAILED'])
      }
    };
  }
}
