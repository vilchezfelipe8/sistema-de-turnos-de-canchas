import { BookingStatus, Prisma } from '@prisma/client';
import {
  BookingConfirmationMode,
  getDepositRequiredAmount,
  getDerivedPaymentStatus,
  isBookingTransitionAllowed,
  shouldAutoConfirmBooking,
  roundMoney
} from '../domain/bookingDomain';
import { AccountService } from './AccountService';
import { ErrorCodes, conflict, notFound } from '../errors';

const EPSILON = 0.009;

type TxClient = Prisma.TransactionClient;

type ClubConfirmationSettings = {
  bookingConfirmationMode: BookingConfirmationMode;
  bookingDepositPercent: number | null;
  allowManualConfirmationOverride: boolean;
  autoCancelPendingBookingsEnabled: boolean;
  autoCancelPendingBookingsMinutesBefore: number | null;
  autoCancelPendingBookingsOnlyIfUnpaid: boolean;
  autoCancelPendingWarningEnabled: boolean;
  autoCancelPendingWarningMinutesBefore: number | null;
};

export class BookingDomainService {
  private readonly accountService = new AccountService();
  async getClubConfirmationSettingsTx(tx: TxClient, clubId: number): Promise<ClubConfirmationSettings> {
    const settings = await tx.clubSettings.findUnique({ where: { clubId } });
    return {
      bookingConfirmationMode: (settings?.bookingConfirmationMode ?? 'MANUAL') as BookingConfirmationMode,
      bookingDepositPercent: settings?.bookingDepositPercent == null ? null : Number(settings.bookingDepositPercent),
      allowManualConfirmationOverride: settings?.allowManualConfirmationOverride ?? true,
      autoCancelPendingBookingsEnabled: settings?.autoCancelPendingBookingsEnabled ?? false,
      autoCancelPendingBookingsMinutesBefore:
        settings?.autoCancelPendingBookingsMinutesBefore == null
          ? null
          : Number(settings.autoCancelPendingBookingsMinutesBefore),
      autoCancelPendingBookingsOnlyIfUnpaid: settings?.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
      autoCancelPendingWarningEnabled: settings?.autoCancelPendingWarningEnabled ?? false,
      autoCancelPendingWarningMinutesBefore:
        settings?.autoCancelPendingWarningMinutesBefore == null
          ? null
          : Number(settings.autoCancelPendingWarningMinutesBefore)
    };
  }

  async getBookingAccountTx(tx: TxClient, bookingId: number, clubId?: number) {
    const account = await tx.account.findFirst({
      where: {
        sourceType: 'BOOKING',
        sourceId: String(bookingId),
        ...(clubId ? { clubId } : {})
      },
      include: {
        items: true,
        payments: true
      }
    });

    if (!account) {
      throw notFound('La reserva no tiene cuenta asociada', ErrorCodes.ACCOUNT_NOT_FOUND);
    }

    return account;
  }

  async getBookingFinancialSummaryTx(tx: TxClient, bookingId: number, clubId?: number) {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, ...(clubId ? { clubId } : {}) },
      select: { id: true, clubId: true, price: true, status: true, startDateTime: true }
    });

    if (!booking) {
      throw notFound('Reserva no encontrada', ErrorCodes.BOOKING_NOT_FOUND);
    }

    const account = await tx.account.findFirst({
      where: {
        sourceType: 'BOOKING',
        sourceId: String(bookingId),
        clubId: booking.clubId
      },
      include: {
        items: true,
        payments: true
      }
    });
    const confirmationSettings = await this.getClubConfirmationSettingsTx(tx, booking.clubId);
    const bookingStatus = String(booking.status || '').toUpperCase();
    if (!account && (bookingStatus === 'CONFIRMED' || bookingStatus === 'COMPLETED')) {
      throw new Error(
        `Inconsistencia de integridad: la reserva ${booking.id} está ${bookingStatus} pero no tiene Account BOOKING`
      );
    }

    const bookingBaseAmount = roundMoney(
      (account?.items || [])
        .filter((item) => item.type === 'BOOKING')
        .reduce((sum, item) => sum + Number(item.total || 0), 0) || Number(booking.price || 0)
    );

    const total = account
      ? roundMoney(Number(account.totalAmount || 0))
      : bookingBaseAmount;
    const paid = account
      ? roundMoney(await this.accountService.calculateNetPaidAmountTx(tx, account.id))
      : 0;
    const remaining = roundMoney(Math.max(0, total - paid));

    const depositRequiredAmount = getDepositRequiredAmount({
      mode: confirmationSettings.bookingConfirmationMode,
      bookingBaseAmount,
      depositPercent: confirmationSettings.bookingDepositPercent
    });

    return {
      booking,
      account: account ?? {
        id: '',
        clubId: booking.clubId,
        sourceType: 'BOOKING',
        sourceId: String(booking.id),
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(total),
        paidAmount: new Prisma.Decimal(paid),
        items: bookingBaseAmount > 0
          ? [{
              id: '',
              accountId: '',
              type: 'BOOKING',
              description: 'Reserva cancha',
              quantity: 1,
              unitPrice: new Prisma.Decimal(bookingBaseAmount),
              total: new Prisma.Decimal(bookingBaseAmount),
              createdAt: booking.startDateTime
            }]
          : [],
        payments: []
      },
      confirmationSettings,
      total,
      paid,
      remaining,
      bookingBaseAmount,
      depositRequiredAmount,
      depositCovered: paid + EPSILON >= depositRequiredAmount,
      paymentStatus: getDerivedPaymentStatus(total, paid)
    };
  }

  async reevaluateBookingConfirmationTx(tx: TxClient, bookingId: number) {
    const summary = await this.getBookingFinancialSummaryTx(tx, bookingId);

    if (summary.booking.status !== 'PENDING') {
      return summary.booking.status;
    }

    const shouldConfirm = shouldAutoConfirmBooking({
      mode: summary.confirmationSettings.bookingConfirmationMode,
      paidAmount: summary.paid,
      requiredToConfirm: summary.depositRequiredAmount
    });

    if (!shouldConfirm) {
      return summary.booking.status;
    }

    await this.getBookingAccountTx(tx, bookingId, summary.booking.clubId);

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED' }
    });

    return 'CONFIRMED';
  }

  async confirmBookingManuallyTx(tx: TxClient, params: {
    bookingId: number;
    clubId: number;
  }) {
    const booking = await tx.booking.findFirst({
      where: { id: params.bookingId, clubId: params.clubId },
      select: { id: true, clubId: true, status: true }
    });

    if (!booking) throw notFound('Reserva no encontrada', ErrorCodes.BOOKING_NOT_FOUND);
    if (!isBookingTransitionAllowed(booking.status as BookingStatus, 'CONFIRMED')) {
      throw conflict('Solo se puede confirmar una reserva pendiente', ErrorCodes.BOOKING_INVALID_STATUS);
    }

    const settings = await this.getClubConfirmationSettingsTx(tx, booking.clubId);
    if (settings.bookingConfirmationMode === 'DEPOSIT_REQUIRED' && !settings.allowManualConfirmationOverride) {
      throw conflict('La configuración del club no permite confirmación manual en modo seña', ErrorCodes.BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN);
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CONFIRMED' }
    });

    return 'CONFIRMED';
  }

  async closeAccountIfEligibleTx(tx: TxClient, accountId: string) {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account) return null;

    const netPaid = await this.accountService.calculateNetPaidAmountTx(tx, accountId);
    const remaining = Number(account.totalAmount || 0) - netPaid;
    if (remaining > EPSILON) return account;

    if (account.status === 'CLOSED') return account;

    return tx.account.update({
      where: { id: accountId },
      data: {
        status: 'CLOSED',
        closedAt: new Date()
      }
    });
  }
}
