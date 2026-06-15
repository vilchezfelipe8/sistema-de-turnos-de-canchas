import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfProtection } from '../src/middleware/CsrfMiddleware';
import { AppError, ErrorCodes } from '../src/errors';
import { authConfig } from '../src/utils/authConfig';

const buildReq = (overrides: Record<string, any> = {}) => ({
  method: 'POST',
  headers: {},
  cookies: {},
  header(name: string) {
    return (this.headers as any)[String(name || '').toLowerCase()] ?? null;
  },
  ...overrides
});

test('permite métodos seguros sin token', async () => {
  const req = buildReq({ method: 'GET' });
  let nextCalled = false;
  csrfProtection(req as any, {} as any, (error?: unknown) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('permite requests sin cookies de sesión', async () => {
  const req = buildReq();
  let nextCalled = false;
  csrfProtection(req as any, {} as any, (error?: unknown) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('bloquea request mutante con sesión y sin header csrf', async () => {
  const req = buildReq({
    cookies: {
      [authConfig.accessCookieName]: 'access-cookie',
      [authConfig.csrfCookieName]: 'csrf-cookie'
    }
  });

  csrfProtection(req as any, {} as any, (error?: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).code, ErrorCodes.CSRF_INVALID);
  });
});

test('permite request mutante con cookie y header csrf válidos', async () => {
  const req = buildReq({
    cookies: {
      [authConfig.accessCookieName]: 'access-cookie',
      [authConfig.csrfCookieName]: 'csrf-cookie'
    },
    headers: {
      'x-csrf-token': 'csrf-cookie'
    }
  });

  let nextCalled = false;
  csrfProtection(req as any, {} as any, (error?: unknown) => {
    assert.equal(error, undefined);
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});
