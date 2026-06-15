import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../app';

const assertStatus = async (response: Response, expected: number, label: string) => {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${label}: status ${response.status} != ${expected}. Body: ${body}`);
  }
};

const maybeRunAuthenticatedFlow = async (baseUrl: string) => {
  const email = process.env.SMOKE_USER_EMAIL?.trim();
  const password = process.env.SMOKE_USER_PASSWORD?.trim();
  if (!email || !password) {
    return { executed: false as const };
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  await assertStatus(login, 200, 'auth_login');
  const loginJson = await login.json();
  const token = String(loginJson?.token || '');
  if (!token) {
    throw new Error('auth_login: no devolvió token');
  }

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  await assertStatus(me, 200, 'auth_me');

  return {
    executed: true as const,
    checks: ['auth_login', 'auth_me']
  };
};

const run = async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address?.port) {
    throw new Error('No se pudo levantar el servidor para smoke tests');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    await assertStatus(health, 200, 'health');

    const authMe = await fetch(`${baseUrl}/api/auth/me`);
    await assertStatus(authMe, 401, 'auth_me_requires_token');

    const bookingQuote = await fetch(`${baseUrl}/api/bookings/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    await assertStatus(bookingQuote, 400, 'booking_quote_contract');

    const createBooking = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    await assertStatus(createBooking, 400, 'booking_create_contract');

    const bookingItems = await fetch(`${baseUrl}/api/bookings/1/items`);
    await assertStatus(bookingItems, 401, 'booking_items_requires_auth');

    const registerPayment = await fetch(`${baseUrl}/api/accounts/account_test/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000, method: 'CASH' })
    });
    await assertStatus(registerPayment, 401, 'account_payment_requires_auth');

    const adminProducts = await fetch(`${baseUrl}/api/clubs/smoke-club/admin/products`);
    await assertStatus(adminProducts, 401, 'admin_products_requires_auth');

    const adminDiscountPolicies = await fetch(`${baseUrl}/api/clubs/smoke-club/admin/discount-policies`);
    await assertStatus(adminDiscountPolicies, 401, 'admin_discount_policies_requires_auth');

    const currentCashShift = await fetch(`${baseUrl}/api/cash-shifts/current`);
    await assertStatus(currentCashShift, 401, 'cash_shift_current_requires_auth');

    const posItems = await fetch(`${baseUrl}/api/cash/pos-items`);
    await assertStatus(posItems, 401, 'cash_pos_items_requires_auth');

    const productSaleQuote = await fetch(`${baseUrl}/api/cash/product-sale/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    await assertStatus(productSaleQuote, 401, 'cash_product_sale_quote_requires_auth');

    const posReport = await fetch(`${baseUrl}/api/cash/pos-report`);
    await assertStatus(posReport, 401, 'cash_pos_report_requires_auth');

    const authFlow = await maybeRunAuthenticatedFlow(baseUrl);

    console.log(JSON.stringify({
      ok: true,
      smoke: [
        'health',
        'auth_me_requires_token',
        'booking_quote_contract',
        'booking_create_contract',
        'booking_items_requires_auth',
        'account_payment_requires_auth',
        'admin_products_requires_auth',
        'admin_discount_policies_requires_auth',
        'cash_shift_current_requires_auth',
        'cash_pos_items_requires_auth',
        'cash_product_sale_quote_requires_auth',
        'cash_pos_report_requires_auth'
      ],
      authenticatedFlow: authFlow.executed ? authFlow.checks : 'skipped (set SMOKE_USER_EMAIL/SMOKE_USER_PASSWORD)'
    }));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) return reject(error);
        resolve();
      });
    });
  }
};

run().catch((error) => {
  console.error('[ERROR] smoke_release:', error);
  process.exit(1);
});
