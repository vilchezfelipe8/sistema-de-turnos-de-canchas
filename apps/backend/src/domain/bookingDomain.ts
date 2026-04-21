export type BookingOperationalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
export type BookingConfirmationMode = 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
export type DerivedPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

const EPSILON = 0.009;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

export function getDerivedPaymentStatus(totalAmount: number, paidAmount: number): DerivedPaymentStatus {
  const total = Math.max(0, roundMoney(totalAmount));
  const paid = Math.max(0, roundMoney(paidAmount));

  if (paid <= EPSILON) return 'UNPAID';
  if (paid + EPSILON >= total) return 'PAID';
  return 'PARTIAL';
}

export function isBookingTransitionAllowed(
  from: BookingOperationalStatus,
  to: BookingOperationalStatus
): boolean {
  if (from === 'CANCELLED' || from === 'COMPLETED') return false;
  if (from === 'PENDING') return to === 'CONFIRMED' || to === 'CANCELLED';
  if (from === 'CONFIRMED') return to === 'COMPLETED' || to === 'CANCELLED';
  return false;
}

export function resolveInitialBookingStatus(mode: BookingConfirmationMode): BookingOperationalStatus {
  return mode === 'AUTOMATIC' ? 'CONFIRMED' : 'PENDING';
}

export function getDepositRequiredAmount(params: {
  mode: BookingConfirmationMode;
  bookingBaseAmount: number;
  depositPercent: number | null;
}): number {
  const bookingBase = Math.max(0, roundMoney(params.bookingBaseAmount));

  if (params.mode === 'AUTOMATIC') return 0;
  if (params.mode === 'MANUAL') return bookingBase;

  const rawPercent = Number(params.depositPercent ?? 0);
  const clampedPercent = Math.min(100, Math.max(0, Number.isFinite(rawPercent) ? rawPercent : 0));
  return roundMoney((bookingBase * clampedPercent) / 100);
}

export function shouldAutoConfirmBooking(params: {
  mode: BookingConfirmationMode;
  paidAmount: number;
  requiredToConfirm: number;
}): boolean {
  if (params.mode === 'MANUAL') return false;
  if (params.mode === 'AUTOMATIC') return true;

  const paid = Math.max(0, roundMoney(params.paidAmount));
  const required = Math.max(0, roundMoney(params.requiredToConfirm));

  return paid + EPSILON >= required;
}
