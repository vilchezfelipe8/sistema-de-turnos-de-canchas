import { Prisma, PrismaClient } from '@prisma/client';
import { featureFlags } from '../config/featureFlags';
import { TimeHelper } from '../utils/TimeHelper';
import { toDialablePhoneNumber } from '../utils/phone';
import { OutboxService, OUTBOX_TYPES } from './OutboxService';
import { WhatsappNotificationOutboxService } from './WhatsappNotificationOutboxService';

type DbClient = Prisma.TransactionClient | PrismaClient;

type FeatureFlagsReader = {
  ENABLE_WHATSAPP_STAFF_EVENTS_V2: boolean;
};

type BookingStaffWhatsappNotificationDeps = {
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
  clubPhone?: string | null;
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

const STAFF_CREATED_TEMPLATE_ORDER = [
  'club_name',
  'client_name',
  'client_phone',
  'date',
  'time',
  'court_name',
  'amount'
] as const;

const STAFF_CANCELLED_TEMPLATE_ORDER = [
  'club_name',
  'client_name',
  'client_phone',
  'date',
  'time',
  'court_name',
  'cancel_reason_label'
] as const;

const STAFF_PENDING_WARNING_TEMPLATE_ORDER = [
  'club_name',
  'client_name',
  'client_phone',
  'date',
  'time',
  'court_name',
  'cancel_minutes_before',
  'insufficient_amount'
] as const;

export class BookingStaffWhatsappNotificationService {
  private readonly outboxService: Pick<OutboxService, 'enqueue'>;
  private readonly whatsappNotificationOutboxService: Pick<
    WhatsappNotificationOutboxService,
    'enqueueSendV2'
  >;
  private readonly flags: FeatureFlagsReader;

  constructor(deps: BookingStaffWhatsappNotificationDeps = {}) {
    this.outboxService = deps.outboxService ?? new OutboxService();
    this.whatsappNotificationOutboxService =
      deps.whatsappNotificationOutboxService ?? new WhatsappNotificationOutboxService();
    this.flags = deps.flags ?? featureFlags;
  }

  async enqueueBookingCreated(input: BookingCreatedInput, tx?: DbClient): Promise<EnqueueResult> {
    const staffPhone = toDialablePhoneNumber(input.clubPhone);
    if (!staffPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);
    const cleanClientPhone = toDialablePhoneNumber(input.clientPhone);

    try {
      if (!this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2) {
        await this.outboxService.enqueue(
          {
            clubId: input.clubId,
            type: OUTBOX_TYPES.WHATSAPP_SEND,
            aggregateType: 'BOOKING',
            aggregateId: String(input.bookingId),
            dedupeKey: `booking-created:${input.bookingId}:club:${staffPhone}`,
            payload: {
              phone: staffPhone,
              message: this.buildCreatedLegacyMessage({
                ...input,
                date,
                time,
                cleanClientPhone
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
          recipientRole: 'CLUB_STAFF',
          clubId: input.clubId,
          recipientPhone: staffPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `booking:${input.bookingId}:staff:booking_created:v2`,
          templateParams: {
            club_name: input.clubName,
            client_name: input.clientName,
            client_phone: cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado',
            date,
            time,
            court_name: input.courtName,
            amount: Number(input.amount || 0).toFixed(2)
          },
          templateParameterOrder: [...STAFF_CREATED_TEMPLATE_ORDER],
          metadata: {
            source: 'BOOKING_CREATED',
            bookingId: input.bookingId
          }
        },
        tx
      );

      return { queued: true, mode: 'V2' };
    } catch (error) {
      console.error('[BOOKING_WHATSAPP_STAFF] enqueueBookingCreated failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2 ? 'V2' : 'LEGACY', error };
    }
  }

  async enqueueBookingCancelled(
    input: BookingCancelledInput,
    tx?: DbClient
  ): Promise<EnqueueResult> {
    const staffPhone = toDialablePhoneNumber(input.clubPhone);
    if (!staffPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);
    const cleanClientPhone = toDialablePhoneNumber(input.clientPhone);
    const cancelReasonLabel = this.buildCancelReasonLabel(input.reason);

    try {
      if (!this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2) {
        await this.outboxService.enqueue(
          {
            clubId: input.clubId,
            type: OUTBOX_TYPES.WHATSAPP_SEND,
            aggregateType: 'BOOKING',
            aggregateId: String(input.bookingId),
            dedupeKey: `booking-cancelled:${input.bookingId}:club:${staffPhone}`,
            payload: {
              phone: staffPhone,
              message: this.buildCancelledLegacyMessage({
                ...input,
                date,
                time,
                cleanClientPhone
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
          recipientRole: 'CLUB_STAFF',
          clubId: input.clubId,
          recipientPhone: staffPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `booking:${input.bookingId}:staff:booking_cancelled:v2`,
          templateParams: {
            club_name: input.clubName,
            client_name: input.clientName,
            client_phone: cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado',
            date,
            time,
            court_name: input.courtName,
            cancel_reason_label: cancelReasonLabel
          },
          templateParameterOrder: [...STAFF_CANCELLED_TEMPLATE_ORDER],
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
      console.error('[BOOKING_WHATSAPP_STAFF] enqueueBookingCancelled failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2 ? 'V2' : 'LEGACY', error };
    }
  }

  async enqueuePendingWarning(
    input: BookingPendingWarningInput,
    tx?: DbClient
  ): Promise<EnqueueResult> {
    const staffPhone = toDialablePhoneNumber(input.clubPhone);
    if (!staffPhone) {
      return { queued: false, mode: 'SKIPPED' };
    }

    if (!this.flags.ENABLE_WHATSAPP_STAFF_EVENTS_V2) {
      return { queued: false, mode: 'SKIPPED' };
    }

    const { date, time } = this.formatBookingDateTime(input.startDateTime, input.timeZone);
    const cleanClientPhone = toDialablePhoneNumber(input.clientPhone);

    try {
      await this.whatsappNotificationOutboxService.enqueueSendV2(
        {
          eventType: 'BOOKING_PENDING_WARNING',
          recipientRole: 'CLUB_STAFF',
          clubId: input.clubId,
          recipientPhone: staffPhone,
          referenceType: 'BOOKING',
          referenceId: String(input.bookingId),
          dedupeKey: `booking:${input.bookingId}:staff:booking_pending_warning:v2`,
          templateParams: {
            club_name: input.clubName,
            client_name: input.clientName,
            client_phone: cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado',
            date,
            time,
            court_name: input.courtName,
            cancel_minutes_before: String(Number(input.cancelMinutesBefore || 0)),
            insufficient_amount:
              Number(input.insufficientAmount || 0) > 0.009
                ? Number(input.insufficientAmount || 0).toFixed(2)
                : null
          },
          templateParameterOrder: [...STAFF_PENDING_WARNING_TEMPLATE_ORDER],
          metadata: {
            source: 'BOOKING_PENDING_WARNING',
            bookingId: input.bookingId
          }
        },
        tx
      );

      return { queued: true, mode: 'V2' };
    } catch (error) {
      console.error('[BOOKING_WHATSAPP_STAFF] enqueuePendingWarning failed', {
        bookingId: input.bookingId,
        clubId: input.clubId,
        error
      });
      return { queued: false, mode: 'V2', error };
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

  private buildCancelReasonLabel(reason?: 'MANUAL' | 'AUTO_CANCEL_UNCONFIRMED') {
    if (reason === 'AUTO_CANCEL_UNCONFIRMED') {
      return 'falta de confirmacion';
    }

    return 'cancelacion solicitada';
  }

  private buildCreatedLegacyMessage(
    input: BookingCreatedInput & { date: string; time: string; cleanClientPhone: string | null }
  ) {
    return `
🔔 *¡Nueva Reserva!* 🔔

Ingresó un nuevo turno web en *${input.clubName}*.

👤 *Cliente:* ${input.clientName}
📞 *Tel:* ${input.cleanClientPhone ? `wa.me/${input.cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${input.date}
⏰ *Hora:* ${input.time}
📍 *Cancha:* ${input.courtName}
💰 *Monto:* $${input.amount || 0}
        `.trim();
  }

  private buildCancelledLegacyMessage(
    input: BookingCancelledInput & { date: string; time: string; cleanClientPhone: string | null }
  ) {
    const isAutoCancel = input.reason === 'AUTO_CANCEL_UNCONFIRMED';
    return `
⚠️ *¡Turno Cancelado!* ⚠️

${isAutoCancel ? 'El sistema canceló automáticamente una reserva pendiente en' : 'Un cliente canceló su reserva en'} *${input.clubName}*.

👤 *Cliente:* ${input.clientName}
📞 *Tel:* ${input.cleanClientPhone ? `wa.me/${input.cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${input.date}
⏰ *Hora:* ${input.time}
📍 *Cancha:* ${input.courtName}

ℹ️ *La cancha ya se encuentra disponible para nuevas reservas en la grilla.*
        `.trim();
  }
}
