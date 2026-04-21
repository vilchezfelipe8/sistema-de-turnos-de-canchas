import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePendingAutoCancelSettings } from '../src/services/PendingBookingAutoCancelService';

test('valida que warning sea mayor a cancel cuando ambos están activos', () => {
  const errors = validatePendingAutoCancelSettings({
    enabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: true,
    warningMinutesBefore: 30
  });
  assert.ok(errors.some((error) => error.includes('warningMinutesBefore')));
});

test('acepta configuración válida de auto-cancel + warning', () => {
  const errors = validatePendingAutoCancelSettings({
    enabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: true,
    warningMinutesBefore: 180
  });
  assert.equal(errors.length, 0);
});

