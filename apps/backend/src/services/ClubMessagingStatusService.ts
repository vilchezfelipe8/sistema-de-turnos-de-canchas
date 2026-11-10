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
