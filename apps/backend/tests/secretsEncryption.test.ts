import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptJsonSecret,
  decryptMaybeEncryptedText,
  encryptJsonSecret,
  encryptMaybeText
} from '../src/utils/secretsEncryption';

test('cifra y descifra texto secreto', () => {
  process.env.PAYMENT_SECRETS_ENCRYPTION_KEY = 'hex:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const encrypted = encryptMaybeText('mi-webhook-secret');
  assert.ok(encrypted);
  assert.notEqual(encrypted, 'mi-webhook-secret');
  const decrypted = decryptMaybeEncryptedText(encrypted);
  assert.equal(decrypted, 'mi-webhook-secret');
});

test('cifra y descifra credenciales JSON', () => {
  process.env.PAYMENT_SECRETS_ENCRYPTION_KEY = 'hex:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const payload = { accessToken: 'abc', refreshToken: 'def', merchantId: '123' };
  const encrypted = encryptJsonSecret(payload);
  const decrypted = decryptJsonSecret(encrypted);
  assert.equal(decrypted.accessToken, 'abc');
  assert.equal(decrypted.refreshToken, 'def');
  assert.equal(decrypted.merchantId, '123');
});

test('mantiene compatibilidad con payload legacy plano', () => {
  const legacy = { accessToken: 'legacy-token' };
  const decrypted = decryptJsonSecret(legacy);
  assert.equal(decrypted.accessToken, 'legacy-token');
});
