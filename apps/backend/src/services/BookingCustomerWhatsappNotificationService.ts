import { Prisma, PrismaClient } from '@prisma/client';
import { featureFlags } from '../config/featureFlags';
import { TimeHelper } from '../utils/TimeHelper';
import { toDialablePhoneNumber } from '../utils/phone';
import { OutboxService, OUTBOX_TYPES } from './OutboxService';
import { WhatsappNotificationOutboxService } from './WhatsappNotificationOutboxService';

type DbClient = Prisma.TransactionClient | PrismaClient;

type FeatureFlagsReader = {
  ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: boolean;
};

type BookingCustomerWhatsappNotificationDeps = {
  outboxService?: Pick<OutboxService, 'enqueue'>;
  whatsappNotificationOutboxService?: Pick<WhatsappNotificationOutboxService, 'enqueueSendV2'>;
  flags?: FeatureFlagsReader;
};

type BookingCreatedInput = {
  bookingId: number;
  clubId: number;
  clubName: string;
  clubPhone?: string | null;
  courtName: string;
  clientName: string;
  clientPhone?: string | null;
  startDateTime: Date;
  timeZone: string;
  amount: number;
};

type BookingCancelledInput = {
  bookingId: number;
  clubId: number;
  clubName: string;
  clubPhone?: string | null;
  courtName: string;
  clientName: string;
  clientPhone?: string | null;
  startDateTime: Date;
  timeZone: string;
  reason?: 'MANUAL' | 'AUTO_CANCEL_UNCONFIRMED';
};

type BookingPendingWarningInput = {
  bookingId: number;
  clubId: number;
  clubName: string;
  courtName: string;
  clientName: string;
  clientPhone?: string | null;
  startDateTime: Date;
  timeZone: string;
  cancelMinutesBefore: number;
  insufficientAmount?: number | null;
};

type EnqueueResult = {
  queued: boolean;
  mode: 'LEGACY' | 'V2' | 'SKIPPED';
  error?: unknown;
};

const CUSTOMER_CREATED_TEMPLATE_ORDER = [
  'client_name',
  'club_name',
  'date',
  'time',
  'court_name',
  'amount',
  'club_whatsapp_url'
] as const;

const CUSTOMER_CANCELLED_TEMPLATE_ORDER = [
  'client_name',
  'club_name',
  'date',
  'time',
  'court_name',
  'club_whatsapp_url',
  'cancel_reason_label'
] as const;

const CUSTOMER_PENDING_WARNING_TEMPLATE_ORDER = [
  'client_name',
  'club_name',
  'date',
  'time',
  'court_name',
  'cancel_minutes_before',
  'insufficient_amount'
] as const;

export class BookingCustomerWhatsappNotificationService {
  private readonly outboxService: Pick<OutboxService, 'enqueue'>;
  private readonly whatsappNotificationOutboxService: Pick<
    WhatsappNotificationOutboxService,
    'enqueueSendV2'
  >;
  private readonly flags: FeatureFlagsReader;

  constructor(deps: BookingCustomerWhatsappNotificationDeps = {}) {
    this.outboxService = deps.outboxService ?? new OutboxService();
    this.whatsappNotificationOutboxService =
      deps.whatsappNotificationOutboxService ?? new WhatsappNotificationOutboxService();
    this.flags = deps.flags ?? featureFlags;
  }

  async enqueueBookingCreated(input: BookingCreatedInput, tx?: DbClient): Promise<EnqueueResult> {
    const clientPhone = toDialablePhoneNumber(input.clientPhone);
    if (!clientPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);
    const clubWhatsappUrl = this.buildClubWhatsappUrl(input.clubPhone);

    try {
      if (!this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2) {
        await this.outboxService.enqueue(
          {
            clubId: input.clubId,
            type: OUTBOX_TYPES.WHATSAPP_SEND,
            aggregateType: 'BOOKING',
            aggregateId: String(input.bookingId),
            dedupeKey: `booking-created:${input.bookingId}:client:${clientPhone}`,
            payload: {
              phone: clientPhone,
              message: this.buildCreatedLegacyMessage({
                ...input,
                date,
                time,
                clubWhatsappUrl
              })
            }
          },
          tx
        );

        return { queued: true, mode: 'LEGACY' };
      }

      await this.whatsappNotificationOutboxService.enqueueSendV2(
        {
          eventType: 'BOOKING_CREATED',
          recipientRole: 'CUSTOMER',
          clubId: input.clubId,
          recipientPhone: clientPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `wa-v2:booking-created:${input.bookingId}:customer:${clientPhone}`,
          templateParams: {
            client_name: input.clientName,
            club_name: input.clubName,
            date,
            time,
            court_name: input.courtName,
            amount: Number(input.amount || 0).toFixed(2),
            club_whatsapp_url: clubWhatsappUrl
          },
          templateParameterOrder: [...CUSTOMER_CREATED_TEMPLATE_ORDER],
          metadata: {
            source: 'BOOKING_CREATED',
            bookingId: input.bookingId
          }
        },
        tx
      );

      return { queued: true, mode: 'V2' };
    } catch (error) {
      console.error('[BOOKING_WHATSAPP_CUSTOMER] enqueueBookingCreated failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2 ? 'V2' : 'LEGACY', error };
    }
  }

  async enqueueBookingCancelled(
    input: BookingCancelledInput,
    tx?: DbClient
  ): Promise<EnqueueResult> {
    const clientPhone = toDialablePhoneNumber(input.clientPhone);
    if (!clientPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);
    const clubWhatsappUrl = this.buildClubWhatsappUrl(input.clubPhone);
    const cancelReasonLabel = this.buildCancelReasonLabel(input.reason);

    try {
      if (!this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2) {
        await this.outboxService.enqueue(
          {
            clubId: input.clubId,
            type: OUTBOX_TYPES.WHATSAPP_SEND,
            aggregateType: 'BOOKING',
            aggregateId: String(input.bookingId),
            dedupeKey: `booking-cancelled:${input.bookingId}:client:${clientPhone}`,
            payload: {
              phone: clientPhone,
              message: this.buildCancelledLegacyMessage({
                ...input,
                date,
                time,
                clubWhatsappUrl
              })
            }
          },
          tx
        );

        return { queued: true, mode: 'LEGACY' };
      }

      await this.whatsappNotificationOutboxService.enqueueSendV2(
        {
          eventType: 'BOOKING_CANCELLED',
          recipientRole: 'CUSTOMER',
          clubId: input.clubId,
          recipientPhone: clientPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `wa-v2:booking-cancelled:${input.bookingId}:customer:${clientPhone}`,
          templateParams: {
            client_name: input.clientName,
            club_name: input.clubName,
            date,
            time,
            court_name: input.courtName,
            club_whatsapp_url: clubWhatsappUrl,
            cancel_reason_label: cancelReasonLabel
          },
          templateParameterOrder: [...CUSTOMER_CANCELLED_TEMPLATE_ORDER],
          metadata: {
            source: 'BOOKING_CANCELLED',
            bookingId: input.bookingId,
            reason: input.reason ?? 'MANUAL'
          }
        },
        tx
      );

      return { queued: true, mode: 'V2' };
    } catch (error) {
      console.error('[BOOKING_WHATSAPP_CUSTOMER] enqueueBookingCancelled failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2 ? 'V2' : 'LEGACY', error };
    }
  }

  async enqueuePendingWarning(
    input: BookingPendingWarningInput,
    tx?: DbClient
  ): Promise<EnqueueResult> {
    const clientPhone = toDialablePhoneNumber(input.clientPhone);
    if (!clientPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);

    try {
      if (!this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2) {
        await this.outboxService.enqueue(
          {
            clubId: input.clubId,
            type: OUTBOX_TYPES.WHATSAPP_SEND,
            aggregateType: 'BOOKING',
            aggregateId: String(input.bookingId),
            dedupeKey: `booking-auto-cancel-warning:${input.bookingId}:client:${clientPhone}`,
            payload: {
              phone: clientPhone,
              message: this.buildPendingWarningLegacyMessage({
                ...input,
                date,
                time
              })
            }
          },
          tx
        );

        return { queued: true, mode: 'LEGACY' };
      }

      await this.whatsappNotificationOutboxService.enqueueSendV2(
        {
          eventType: 'BOOKING_PENDING_WARNING',
          recipientRole: 'CUSTOMER',
          clubId: input.clubId,
          recipientPhone: clientPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `wa-v2:booking-auto-cancel-warning:${input.bookingId}:customer:${clientPhone}`,
          templateParams: {
            client_name: input.clientName,
            club_name: input.clubName,
            date,
            time,
            court_name: input.courtName,
            cancel_minutes_before: String(Number(input.cancelMinutesBefore || 0)),
            insufficient_amount:
              Number(input.insufficientAmount || 0) > 0.009
                ? Number(input.insufficientAmount || 0).toFixed(2)
                : null
          },
          templateParameterOrder: [...CUSTOMER_PENDING_WARNING_TEMPLATE_ORDER],
          metadata: {
            source: 'BOOKING_PENDING_WARNING',
            bookingId: input.bookingId
          }
        },
        tx
      );

      return { queued: true, mode: 'V2' };
    } catch (error) {
      console.error('[BOOKING_WHATSAPP_CUSTOMER] enqueuePendingWarning failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: this.flags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2 ? 'V2' : 'LEGACY', error };
    }
  }

  private formatBookingDateTime(startDateTime: Date, timeZone: string) {
    const local = TimeHelper.utcToLocal(startDateTime, timeZone);
    return {
      date: `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(
        2,
        '0'
      )}/${local.getFullYear()}`,
      time: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(
        2,
        '0'
      )}`
    };
  }

  private buildClubWhatsappUrl(clubPhone?: string | null) {
    const cleanClubPhone = toDialablePhoneNumber(clubPhone);
    return cleanClubPhone ? `https://wa.me/${cleanClubPhone}` : 'No disponible';
  }

  private buildCancelReasonLabel(reason?: 'MANUAL' | 'AUTO_CANCEL_UNCONFIRMED') {
    if (reason === 'AUTO_CANCEL_UNCONFIRMED') {
      return 'falta de confirmacion';
    }

    return 'cancelacion solicitada';
  }

  private buildCreatedLegacyMessage(
    input: BookingCreatedInput & { date: string; time: string; clubWhatsappUrl: string }
  ) {
    return `
🎾 *¡Reserva Registrada en ${input.clubName}!* 🎾

Hola *${input.clientName}*, tu turno ha sido agendado a través de Pique.

📅 *Fecha:* ${input.date}
⏰ *Hora:* ${input.time}
📍 *Cancha:* ${input.courtName}
💰 *Monto del turno:* $${input.amount || 0}

⚠️ *INFORMACIÓN IMPORTANTE:*
Para confirmar tu asistencia, coordinar el pago de la seña o por cualquier consulta, por favor comunicate directamente con la administración del club:
📱 *WhatsApp del Club:* ${input.clubWhatsappUrl}

¡Gracias por usar nuestro sistema!
        `.trim();
  }

  private buildCancelledLegacyMessage(
    input: BookingCancelledInput & { date: string; time: string; clubWhatsappUrl: string }
  ) {
    const isAutoCancel = input.reason === 'AUTO_CANCEL_UNCONFIRMED';
    return `
❌ *Reserva Cancelada en ${input.clubName}* ❌

Hola *${input.clientName}*, te confirmamos que tu turno ha sido anulado${
      isAutoCancel ? ' automáticamente por falta de confirmación' : ' a través del sistema'
    }.

📅 *Fecha:* ${input.date}
⏰ *Hora:* ${input.time}
📍 *Cancha:* ${input.courtName}

⚠️ *Aviso:* Si tenías una seña abonada, por favor comunicate con la administración para gestionar tu cuenta:
📱 *WhatsApp del Club:* ${input.clubWhatsappUrl}

¡Te esperamos la próxima!
        `.trim();
  }

  private buildPendingWarningLegacyMessage(
    input: BookingPendingWarningInput & { date: string; time: string }
  ) {
    const insufficientLine =
      Number(input.insufficientAmount || 0) > 0.009
        ? `\nEl pago registrado todavia no alcanza para confirmar. Falta completar *$${Number(
            input.insufficientAmount || 0
          ).toFixed(2)}*.`
        : '';

    return `
⚠️ *Tu reserva sigue pendiente de confirmación* ⚠️

Hola *${input.clientName}*.
Tu turno en *${input.clubName}* todavía está pendiente.

📅 *Fecha:* ${input.date}
⏰ *Hora:* ${input.time}
📍 *Cancha:* ${input.courtName}
${insufficientLine}

Si no se confirma antes de *${input.cancelMinutesBefore} minutos previos al inicio*, el sistema puede cancelar automáticamente la reserva.
        `.trim();
  }
}
