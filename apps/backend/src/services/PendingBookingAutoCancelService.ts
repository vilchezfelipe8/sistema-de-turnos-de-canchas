import { BookingStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { OutboxService, OUTBOX_TYPES } from './OutboxService';
import { BookingService } from './BookingService';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { CashRepository } from '../repositories/CashRepository';
import { ProductRepository } from '../repositories/ProductRepository';
import { AccountService } from './AccountService';
import { AuditLogService } from './AuditLogService';
import { TimeHelper } from '../utils/TimeHelper';
import { getDepositRequiredAmount } from '../domain/bookingDomain';
import { normalizeIdentityPhone } from '../utils/phone';

const EPSILON = 0.009;

type TxClient = Prisma.TransactionClient;

export type PendingAutoCancelSettings = {
  enabled: boolean;
  cancelMinutesBefore: number | null;
  onlyIfUnpaid: boolean;
  warningEnabled: boolean;
  warningMinutesBefore: number | null;
};

export function validatePendingAutoCancelSettings(settings: PendingAutoCancelSettings): string[] {
  const errors: string[] = [];
  if (settings.enabled) {
    if (!Number.isFinite(Number(settings.cancelMinutesBefore)) || Number(settings.cancelMinutesBefore) <= 0) {
      errors.push('autoCancelPendingBookingsMinutesBefore debe ser > 0 cuando auto-cancel está habilitado');
    }
  }
  if (settings.warningEnabled) {
    if (!Number.isFinite(Number(settings.warningMinutesBefore)) || Number(settings.warningMinutesBefore) <= 0) {
      errors.push('autoCancelPendingWarningMinutesBefore debe ser > 0 cuando el aviso está habilitado');
    }
  }
  if (settings.enabled && settings.warningEnabled) {
    const warning = Number(settings.warningMinutesBefore);
    const cancel = Number(settings.cancelMinutesBefore);
    if (Number.isFinite(warning) && Number.isFinite(cancel) && warning <= cancel) {
      errors.push('warningMinutesBefore debe ser mayor a cancelMinutesBefore (el aviso debe ocurrir antes de la cancelación)');
    }
  }
  return errors;
}

export class PendingBookingAutoCancelService {
  private readonly outboxService = new OutboxService();
  private readonly accountService = new AccountService();
  private readonly auditLogService = new AuditLogService();
  private readonly bookingService = new BookingService(
    new BookingRepository(),
    new CourtRepository(),
    new UserRepository(),
    new ActivityTypeRepository(),
    new CashRepository(),
    new ProductRepository()
  );

  private getSettings(raw: any): PendingAutoCancelSettings {
    return {
      enabled: raw?.autoCancelPendingBookingsEnabled ?? false,
      cancelMinutesBefore: raw?.autoCancelPendingBookingsMinutesBefore == null ? null : Number(raw.autoCancelPendingBookingsMinutesBefore),
      onlyIfUnpaid: raw?.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
      warningEnabled: raw?.autoCancelPendingWarningEnabled ?? false,
      warningMinutesBefore: raw?.autoCancelPendingWarningMinutesBefore == null ? null : Number(raw.autoCancelPendingWarningMinutesBefore)
    };
  }

  private isWarningTimeWindow(params: {
    now: Date;
    startDateTime: Date;
    warningMinutesBefore: number;
    cancelMinutesBefore?: number | null;
  }) {
    const warningAt = new Date(params.startDateTime.getTime() - params.warningMinutesBefore * 60_000);
    if (params.now.getTime() < warningAt.getTime()) return false;
    if (params.cancelMinutesBefore && Number.isFinite(params.cancelMinutesBefore) && params.cancelMinutesBefore > 0) {
      const cancelAt = new Date(params.startDateTime.getTime() - params.cancelMinutesBefore * 60_000);
      if (params.now.getTime() >= cancelAt.getTime()) return false;
    }
    return true;
  }

  private buildWarningMessage(params: {
    bookingId: number;
    clubName: string;
    courtName: string;
    clientName: string;
    startDateTime: Date;
    timeZone: string;
    cancelMinutesBefore: number;
    insufficientAmount?: number | null;
  }) {
    const localStart = TimeHelper.utcToLocal(params.startDateTime, params.timeZone);
    const date = `${String(localStart.getDate()).padStart(2, '0')}/${String(localStart.getMonth() + 1).padStart(2, '0')}/${localStart.getFullYear()}`;
    const time = `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}`;
    const limit = new Date(params.startDateTime.getTime() - params.cancelMinutesBefore * 60_000);
    const localLimit = TimeHelper.utcToLocal(limit, params.timeZone);
    const limitTime = `${String(localLimit.getHours()).padStart(2, '0')}:${String(localLimit.getMinutes()).padStart(2, '0')}`;

    const insufficientLine =
      Number(params.insufficientAmount || 0) > 0.009
        ? `\nEl pago registrado todavia no alcanza para confirmar. Falta completar *$${Number(params.insufficientAmount || 0).toFixed(2)}*.`
        : '';

    return `
⚠️ *Tu reserva sigue pendiente de confirmación* ⚠️

Hola *${params.clientName}*.
Tu turno en *${params.clubName}* todavía está pendiente.

📅 *Fecha:* ${date}
⏰ *Hora:* ${time}
📍 *Cancha:* ${params.courtName}
${insufficientLine}

Si no se confirma antes de las *${limitTime}*, puede cancelarse automáticamente.
`.trim();
  }

  private async trySendWarningTx(tx: TxClient, bookingId: number, now: Date) {
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "Booking"
      WHERE "id" = ${bookingId}
      FOR UPDATE
    `;

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: true,
        client: true,
        court: { include: { club: { include: { settings: true } } } }
      }
    });

    if (!booking) return false;
    if (booking.status !== BookingStatus.PENDING) return false;
    if (booking.autoCancelledAt) return false;
    if (booking.autoCancelWarningSentAt) return false;

    const settings = this.getSettings(booking.court.club.settings);
    const settingsErrors = validatePendingAutoCancelSettings(settings);
    if (settingsErrors.length > 0) return false;
    if (!settings.warningEnabled || !settings.warningMinutesBefore || settings.warningMinutesBefore <= 0) return false;
    if (booking.startDateTime.getTime() <= now.getTime()) return false;
    if (!this.isWarningTimeWindow({
      now,
      startDateTime: booking.startDateTime,
      warningMinutesBefore: settings.warningMinutesBefore,
      cancelMinutesBefore: settings.enabled ? settings.cancelMinutesBefore : null
    })) {
      return false;
    }

    const clientPhone = normalizeIdentityPhone(booking.user?.phoneNumber || booking.client?.phone || null);
    const clientName = booking.user?.firstName || booking.client?.name || 'Jugador';
    const clubTimeZone = booking.court.club.settings?.timeZone ?? 'America/Argentina/Buenos_Aires';
    const dedupeSuffix = `booking-auto-cancel-warning:${booking.id}`;
    let insufficientAmount: number | null = null;
    if (booking.court.club.settings?.bookingConfirmationMode === 'DEPOSIT_REQUIRED') {
      const account = await tx.account.findFirst({
        where: {
          sourceType: 'BOOKING',
          sourceId: String(booking.id),
          clubId: booking.clubId
        },
        select: { id: true }
      });
      if (account) {
        const paidAmount = await this.accountService.calculateNetPaidAmountTx(tx, account.id);
        const depositRequiredAmount = getDepositRequiredAmount({
          mode: 'DEPOSIT_REQUIRED',
          bookingBaseAmount: Number(booking.price || 0),
          depositPercent:
            booking.court.club.settings.bookingDepositPercent == null
              ? null
              : Number(booking.court.club.settings.bookingDepositPercent)
        });
        insufficientAmount = Math.max(0, Number((depositRequiredAmount - paidAmount).toFixed(2)));
      }
    }
    const message = this.buildWarningMessage({
      bookingId: booking.id,
      clubName: booking.court.club.name,
      courtName: booking.court.name,
      clientName,
      startDateTime: booking.startDateTime,
      timeZone: clubTimeZone,
      cancelMinutesBefore: Number(settings.cancelMinutesBefore || 0),
      insufficientAmount
    });

    if (clientPhone) {
      await this.outboxService.enqueue({
        clubId: booking.clubId,
        type: OUTBOX_TYPES.WHATSAPP_SEND,
        aggregateType: 'BOOKING',
        aggregateId: String(booking.id),
        dedupeKey: `${dedupeSuffix}:client:${clientPhone}`,
        payload: {
          phone: clientPhone,
          message
        }
      }, tx);
    }

    if (booking.userId) {
      await this.outboxService.enqueue({
        clubId: booking.clubId,
        type: OUTBOX_TYPES.NOTIFICATION_CREATE,
        aggregateType: 'BOOKING',
        aggregateId: String(booking.id),
        dedupeKey: `${dedupeSuffix}:notification:${booking.userId}`,
        payload: {
          userId: booking.userId,
          clubId: booking.clubId,
          title: 'Reserva pendiente de confirmación',
          message: 'Tu reserva sigue pendiente y puede cancelarse automáticamente si no se confirma a tiempo.'
        }
      }, tx);
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { autoCancelWarningSentAt: now }
    });

    await this.auditLogService.create({
      clubId: booking.clubId,
      userId: null,
      entity: 'Booking',
      entityId: String(booking.id),
      action: 'BOOKING_AUTO_CANCEL_WARNING',
      payload: {
        bookingId: booking.id,
        warningMinutesBefore: settings.warningMinutesBefore,
        processedAt: now.toISOString()
      }
    });

    return true;
  }

  async processPendingBookingWarnings(input?: { now?: Date; limit?: number }) {
    const now = input?.now ?? new Date();
    const limit = Math.max(1, Math.min(input?.limit ?? 500, 5000));

    const candidates = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        autoCancelWarningSentAt: null,
        autoCancelledAt: null
      },
      select: { id: true },
      orderBy: { startDateTime: 'asc' },
      take: limit
    });

    let warned = 0;
    for (const candidate of candidates) {
      try {
        const sent = await prisma.$transaction((tx) => this.trySendWarningTx(tx, candidate.id, now));
        if (sent) warned += 1;
      } catch (error) {
        console.error('[AUTO_CANCEL_WARNING] error procesando warning', {
          bookingId: candidate.id,
          error
        });
      }
    }

    return { scanned: candidates.length, warned };
  }

  async processPendingBookingAutoCancellations(input?: { now?: Date; limit?: number }) {
    const now = input?.now ?? new Date();
    const limit = Math.max(1, Math.min(input?.limit ?? 500, 5000));

    const candidates = await prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        autoCancelledAt: null
      },
      select: { id: true, clubId: true },
      orderBy: { startDateTime: 'asc' },
      take: limit
    });

    let cancelled = 0;
    for (const candidate of candidates) {
      try {
        const booking = await prisma.booking.findUnique({
          where: { id: candidate.id },
          include: { court: { include: { club: { include: { settings: true } } } } }
        });
        if (!booking || booking.status !== BookingStatus.PENDING) continue;

        const settings = this.getSettings(booking.court.club.settings);
        const errors = validatePendingAutoCancelSettings(settings);
        if (errors.length > 0) continue;
        if (!settings.enabled || !settings.cancelMinutesBefore || settings.cancelMinutesBefore <= 0) continue;

        const cancelAt = new Date(booking.startDateTime.getTime() - settings.cancelMinutesBefore * 60_000);
        if (now.getTime() < cancelAt.getTime()) continue;

        if (settings.onlyIfUnpaid) {
          const account = await prisma.account.findFirst({
            where: { sourceType: 'BOOKING', sourceId: String(booking.id), clubId: booking.clubId },
            select: { id: true }
          });
          if (account) {
            const netPaid = await this.accountService.calculateNetPaidAmount(account.id);
            if (netPaid > EPSILON) continue;
          }
        }

        const before = await prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true, autoCancelledAt: true } });
        if (!before || before.status !== BookingStatus.PENDING || before.autoCancelledAt) continue;

        await this.bookingService.cancelBooking(
          booking.id,
          null,
          booking.clubId,
          {
            reason: 'AUTO_CANCEL_UNCONFIRMED',
            triggeredBy: 'SYSTEM',
            skipAccessValidation: true,
            now
          }
        );

        const after = await prisma.booking.findUnique({
          where: { id: booking.id },
          select: { status: true, autoCancelledAt: true }
        });
        if (after?.status === BookingStatus.CANCELLED && after.autoCancelledAt) {
          cancelled += 1;
        }
      } catch (error) {
        console.error('[AUTO_CANCEL_PENDING] error procesando auto-cancelación', {
          bookingId: candidate.id,
          error
        });
      }
    }

    return { scanned: candidates.length, cancelled };
  }
}
