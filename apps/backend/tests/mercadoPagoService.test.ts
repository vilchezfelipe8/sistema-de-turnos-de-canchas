import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoPagoService } from '../src/services/MercadoPagoService';

test('MercadoPagoService.createPreference incluye back_urls.success y auto_return cuando successUrl existe', async () => {
  const service = new MercadoPagoService();
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const originalFetch = global.fetch;

  global.fetch = (async (input: any, init?: any) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')),
      headers: init?.headers || {}
    });
    return {
      ok: true,
      json: async () => ({ id: 'pref_test', init_point: 'https://example.test/init' })
    } as any;
  }) as typeof fetch;

  try {
    await service.createPreference({
      accessToken: 'access-token-test',
      title: 'Reserva test',
      description: 'Reserva test',
      unitPrice: 1234,
      externalReference: 'attempt-test',
      notificationUrl: 'https://backend.test/api/webhooks/mercadopago',
      successUrl: 'https://frontend.test/bookings?booking=181&checkoutStatus=success',
      pendingUrl: 'https://frontend.test/bookings?booking=181&checkoutStatus=pending',
      failureUrl: 'https://frontend.test/bookings?booking=181&checkoutStatus=failure',
      metadata: { bookingId: 181 }
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body?.back_urls?.success, 'https://frontend.test/bookings?booking=181&checkoutStatus=success');
  assert.equal(calls[0]?.body?.back_urls?.pending, 'https://frontend.test/bookings?booking=181&checkoutStatus=pending');
  assert.equal(calls[0]?.body?.back_urls?.failure, 'https://frontend.test/bookings?booking=181&checkoutStatus=failure');
  assert.equal(calls[0]?.body?.auto_return, 'approved');
});

test('MercadoPagoService.createPreference omite auto_return cuando successUrl falta', async () => {
  const service = new MercadoPagoService();
  const calls: Array<{ body: any }> = [];
  const originalFetch = global.fetch;

  global.fetch = (async (_input: any, init?: any) => {
    calls.push({
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({ id: 'pref_test', init_point: 'https://example.test/init' })
    } as any;
  }) as typeof fetch;

  try {
    await service.createPreference({
      accessToken: 'access-token-test',
      title: 'Reserva test',
      description: 'Reserva test',
      unitPrice: 1234,
      externalReference: 'attempt-test',
      notificationUrl: 'https://backend.test/api/webhooks/mercadopago',
      successUrl: '',
      pendingUrl: 'https://frontend.test/bookings?booking=181&checkoutStatus=pending',
      failureUrl: 'https://frontend.test/bookings?booking=181&checkoutStatus=failure',
      metadata: { bookingId: 181 }
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body?.back_urls?.success, undefined);
  assert.equal(calls[0]?.body?.auto_return, undefined);
});
