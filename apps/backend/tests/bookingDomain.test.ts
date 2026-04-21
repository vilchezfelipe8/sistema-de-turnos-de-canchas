import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDepositRequiredAmount,
  getDerivedPaymentStatus,
  isBookingTransitionAllowed,
  resolveInitialBookingStatus,
  shouldAutoConfirmBooking
} from '../src/domain/bookingDomain';

test('create booking in automatic mode starts confirmed', () => {
  assert.equal(resolveInitialBookingStatus('AUTOMATIC'), 'CONFIRMED');
});

test('create booking in manual mode starts pending', () => {
  assert.equal(resolveInitialBookingStatus('MANUAL'), 'PENDING');
});

test('create booking in deposit-required mode starts pending', () => {
  assert.equal(resolveInitialBookingStatus('DEPOSIT_REQUIRED'), 'PENDING');
});

test('deposit-required confirms when paid reaches required amount', () => {
  const required = getDepositRequiredAmount({ mode: 'DEPOSIT_REQUIRED', bookingBaseAmount: 20000, depositPercent: 30 });
  assert.equal(required, 6000);
  assert.equal(shouldAutoConfirmBooking({ mode: 'DEPOSIT_REQUIRED', paidAmount: 6000, requiredToConfirm: required }), true);
});

test('deposit-required does not confirm when paid does not reach required amount', () => {
  const required = getDepositRequiredAmount({ mode: 'DEPOSIT_REQUIRED', bookingBaseAmount: 20000, depositPercent: 30 });
  assert.equal(shouldAutoConfirmBooking({ mode: 'DEPOSIT_REQUIRED', paidAmount: 5999.99, requiredToConfirm: required }), false);
});

test('manual mode payment does not auto-confirm', () => {
  assert.equal(shouldAutoConfirmBooking({ mode: 'MANUAL', paidAmount: 10000, requiredToConfirm: 5000 }), false);
});

test('pending cannot transition directly to completed', () => {
  assert.equal(isBookingTransitionAllowed('PENDING', 'COMPLETED'), false);
});

test('completed and cancelled are terminal states', () => {
  assert.equal(isBookingTransitionAllowed('COMPLETED', 'CONFIRMED'), false);
  assert.equal(isBookingTransitionAllowed('CANCELLED', 'PENDING'), false);
});

test('derived payment status is computed from totals', () => {
  assert.equal(getDerivedPaymentStatus(10000, 0), 'UNPAID');
  assert.equal(getDerivedPaymentStatus(10000, 5000), 'PARTIAL');
  assert.equal(getDerivedPaymentStatus(10000, 10000), 'PAID');
});
