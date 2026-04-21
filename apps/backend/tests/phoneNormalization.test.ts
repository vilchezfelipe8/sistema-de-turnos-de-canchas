import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentityPhone } from '../src/utils/phone';

test('normaliza formatos locales al canónico 549', () => {
  assert.equal(normalizeIdentityPhone({ phoneNumberLocal: '3511234567', countryCode: '+54' }), '+5493511234567');
  assert.equal(normalizeIdentityPhone({ phoneNumberLocal: '03511234567', countryCode: '+54' }), '+5493511234567');
  assert.equal(normalizeIdentityPhone('+54 9 351 123-4567'), '+5493511234567');
});

test('devuelve null cuando no hay señal de teléfono suficiente', () => {
  assert.equal(normalizeIdentityPhone('abc'), null);
  assert.equal(normalizeIdentityPhone('1234567'), null);
  assert.equal(normalizeIdentityPhone(null), null);
});

test('permite teléfono de otro país sin forzar Argentina', () => {
  assert.equal(
    normalizeIdentityPhone({ phoneNumberLocal: '2025550123', countryCode: '+1' }),
    '+12025550123'
  );
});
