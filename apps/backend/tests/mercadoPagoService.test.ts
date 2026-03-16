import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { MercadoPagoService } from '../src/services/MercadoPagoService';

const service = new MercadoPagoService();

test('valida firma webhook con manifest oficial (id/request-id/ts)', () => {
  const secret = 'test-secret';
  const requestId = 'req-123';
  const ts = '1710000000';
  const dataIdFromUrl = 'ABCD1234';
  const manifest = `id:${dataIdFromUrl.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const signature = `ts=${ts},v1=${v1}`;

  const valid = service.validateWebhookSignature({
    rawBody: JSON.stringify({}),
    headerSignature: signature,
    headerRequestId: requestId,
    dataId: dataIdFromUrl,
    secret
  });

  assert.equal(valid, true);
});

test('rechaza firma webhook invalida', () => {
  const valid = service.validateWebhookSignature({
    rawBody: JSON.stringify({ hello: 'world' }),
    headerSignature: 'ts=1710000000,v1=deadbeef',
    headerRequestId: 'req-123',
    dataId: 'abc123',
    secret: 'test-secret'
  });

  assert.equal(valid, false);
});

test('parsea webhook de pago y mapea estado approved', async () => {
  const payload = {
    type: 'payment',
    status: 'approved',
    transaction_amount: 2000,
    data: { id: '999' },
    external_reference: 'PAY-1'
  };

  const parsed = await service.parseWebhookToGatewayTransaction({
    rawPayload: payload
  });

  assert.equal(parsed.externalId, '999');
  assert.equal(parsed.status, 'APPROVED');
  assert.equal(parsed.amount, 2000);
  assert.equal(parsed.externalReference, 'PAY-1');
});
