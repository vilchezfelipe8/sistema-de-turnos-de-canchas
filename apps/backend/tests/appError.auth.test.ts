import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCodes, forbidden, notFound, sendAppError } from '../src/errors';
import { sendAuthError } from '../src/utils/authError';

class MockResponse {
  statusCode = 200;
  body: unknown = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    return this;
  }
}

const response = () => new MockResponse();

describe('Auth/AppError — contratos críticos', () => {
  test('AUTH_MISSING → 401 con payload seguro', () => {
    const res = response();
    sendAuthError(res as any, 401, 'AUTH_MISSING', 'Acceso denegado. Falta autenticación.');
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      error: 'Acceso denegado. Falta autenticación.',
      message: 'Acceso denegado. Falta autenticación.',
      code: 'AUTH_MISSING',
      blocking: true,
      field: 'general',
      retryable: false,
    });
  });

  test('AUTH_INVALID → 401 con payload seguro', () => {
    const res = response();
    sendAuthError(res as any, 401, 'AUTH_INVALID', 'Sesión inválida.');
    assert.equal(res.statusCode, 401);
    assert.equal((res.body as any).code, 'AUTH_INVALID');
    assert.equal((res.body as any).error, 'Sesión inválida.');
  });

  test('AUTH_EXPIRED → 401 con payload seguro', () => {
    const res = response();
    sendAuthError(res as any, 401, 'AUTH_EXPIRED', 'Tu sesión venció. Volvé a ingresar.');
    assert.equal(res.statusCode, 401);
    assert.equal((res.body as any).code, 'AUTH_EXPIRED');
    assert.equal((res.body as any).error, 'Tu sesión venció. Volvé a ingresar.');
  });

  test('AUTH_REVOKED → 401 con payload seguro', () => {
    const res = response();
    sendAuthError(res as any, 401, 'AUTH_REVOKED', 'La sesión fue revocada.');
    assert.equal(res.statusCode, 401);
    assert.equal((res.body as any).code, 'AUTH_REVOKED');
    assert.equal((res.body as any).error, 'La sesión fue revocada.');
  });

  test('FORBIDDEN → 403 con AppError seguro', () => {
    const res = response();
    sendAppError(res, forbidden('Permisos insuficientes.', ErrorCodes.FORBIDDEN));
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, {
      error: 'Permisos insuficientes.',
      code: ErrorCodes.FORBIDDEN,
    });
  });

  test('CLUB_MEMBERSHIP_REQUIRED → 403 con AppError seguro', () => {
    const res = response();
    sendAppError(
      res,
      forbidden('Necesitás pertenecer al club para realizar esta acción.', ErrorCodes.CLUB_MEMBERSHIP_REQUIRED)
    );
    assert.equal(res.statusCode, 403);
    assert.equal((res.body as any).code, ErrorCodes.CLUB_MEMBERSHIP_REQUIRED);
  });

  test('CLUB_NOT_FOUND → 404 con AppError seguro', () => {
    const res = response();
    sendAppError(res, notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND));
    assert.equal(res.statusCode, 404);
    assert.equal((res.body as any).code, ErrorCodes.CLUB_NOT_FOUND);
  });
});
