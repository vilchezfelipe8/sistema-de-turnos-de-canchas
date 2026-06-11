import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskPhone,
  sanitizeWhatsappPayload,
  sanitizeWhatsappRawRequest,
  sanitizeWhatsappRawResponse
} from '../src/utils/whatsappAdminSanitizer';

test('maskPhone enmascara telefono conservando ultimos 4 caracteres', () => {
  assert.equal(maskPhone('5493511234567'), '*********4567');
});

test('sanitize elimina Authorization, bearer token y access_token', () => {
  const payload = sanitizeWhatsappPayload({
    headers: {
      Authorization: 'Bearer abc123'
    },
    access_token: 'secret-value',
    nested: {
      bearer: 'Bearer xyz789'
    }
  }) as any;

  assert.equal(payload.headers.Authorization, '[REDACTED]');
  assert.equal(payload.access_token, '[REDACTED]');
  assert.equal(payload.nested.bearer, '[REDACTED]');
});

test('sanitize enmascara telefonos en request y response', () => {
  const request = sanitizeWhatsappRawRequest({
    to: '5493511234567',
    recipientPhone: '5493519998888'
  }) as any;
  const response = sanitizeWhatsappRawResponse({
    contacts: [{ wa_id: '5493511112222' }]
  }) as any;

  assert.equal(request.to, '*********4567');
  assert.equal(request.recipientPhone, '*********8888');
  assert.equal(response.contacts[0].wa_id, '*********2222');
});

test('sanitize tolera payloads null o vacios', () => {
  assert.equal(sanitizeWhatsappPayload(null), null);
  assert.equal(sanitizeWhatsappPayload(undefined), undefined);
  assert.deepEqual(sanitizeWhatsappPayload({}), {});
});

