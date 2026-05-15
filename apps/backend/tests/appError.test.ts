/**
 * Tests — AppError infraestructura
 * Runner: node --test (Node built-in test runner)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors/AppError';
import { ErrorCodes } from '../src/errors/errorCodes';
import { badRequest, notFound, conflict, unprocessable, forbidden, validationError } from '../src/errors/factories';
import { sendAppError } from '../src/errors/sendAppError';

// ── Mock de res ────────────────────────────────────────────────────────────────
function mockRes() {
  let _status = 200;
  let _body: unknown = null;
  const res = {
    status(code: number) { _status = code; return res; },
    json(data: unknown) { _body = data; return res; },
    getStatus() { return _status; },
    getBody() { return _body as Record<string, unknown>; },
  };
  return res;
}

// ── AppError — construcción ───────────────────────────────────────────────────
describe('AppError — construcción', () => {
  test('instancia con campos básicos', () => {
    const err = new AppError({ code: 'ACCOUNT_CLOSED', statusCode: 409, message: 'Cuenta cerrada.' });
    assert.equal(err.code, 'ACCOUNT_CLOSED');
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, 'Cuenta cerrada.');
    assert.equal(err.name, 'AppError');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AppError);
  });

  test('instancia con meta', () => {
    const meta = { candidates: [{ id: 'c1' }, { id: 'c2' }] };
    const err = new AppError({ code: 'CLIENT_POSSIBLE_DUPLICATE', statusCode: 409, message: 'Duplicado.', meta });
    assert.deepEqual(err.meta, meta);
  });

  test('instancia con fieldErrors', () => {
    const fieldErrors = { email: 'Email inválido', phone: 'Teléfono requerido' };
    const err = new AppError({ code: 'VALIDATION_ERROR', statusCode: 400, message: 'Datos inválidos.', fieldErrors });
    assert.deepEqual(err.fieldErrors, fieldErrors);
  });

  test('fieldErrors y meta son undefined por defecto', () => {
    const err = new AppError({ code: 'NOT_FOUND', statusCode: 404, message: 'No encontrado.' });
    assert.equal(err.fieldErrors, undefined);
    assert.equal(err.meta, undefined);
  });
});

// ── sendAppError — AppError ───────────────────────────────────────────────────
describe('sendAppError — con AppError', () => {
  test('devuelve statusCode y payload correcto', () => {
    const res = mockRes();
    const err = new AppError({ code: 'ACCOUNT_CLOSED', statusCode: 409, message: 'Esta cuenta ya está cerrada.' });
    sendAppError(res, err);
    assert.equal(res.getStatus(), 409);
    const body = res.getBody();
    assert.equal(body.error, 'Esta cuenta ya está cerrada.');
    assert.equal(body.code, 'ACCOUNT_CLOSED');
    assert.equal(body.fieldErrors, undefined);
    assert.equal(body.meta, undefined);
  });

  test('incluye meta cuando está presente', () => {
    const res = mockRes();
    const meta = { candidates: [{ id: 'c1' }] };
    const err = new AppError({ code: 'CLIENT_POSSIBLE_DUPLICATE', statusCode: 409, message: 'Duplicado.', meta });
    sendAppError(res, err);
    assert.equal(res.getStatus(), 409);
    assert.deepEqual(res.getBody().meta, meta);
  });

  test('incluye fieldErrors cuando están presentes', () => {
    const res = mockRes();
    const fieldErrors = { email: 'Email inválido' };
    const err = new AppError({ code: 'VALIDATION_ERROR', statusCode: 400, message: 'Datos inválidos.', fieldErrors });
    sendAppError(res, err);
    assert.equal(res.getStatus(), 400);
    assert.deepEqual(res.getBody().fieldErrors, fieldErrors);
  });

  test('NO incluye fieldErrors vacío en el payload', () => {
    const res = mockRes();
    const err = new AppError({ code: 'VALIDATION_ERROR', statusCode: 400, message: 'Datos inválidos.', fieldErrors: {} });
    sendAppError(res, err);
    assert.equal(res.getBody().fieldErrors, undefined);
  });

  test('400 badRequest factory', () => {
    const res = mockRes();
    sendAppError(res, badRequest('Monto inválido.', ErrorCodes.PAYMENT_INVALID_AMOUNT));
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getBody().code, ErrorCodes.PAYMENT_INVALID_AMOUNT);
  });

  test('404 notFound factory', () => {
    const res = mockRes();
    sendAppError(res, notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_NOT_FOUND);
  });

  test('409 conflict factory', () => {
    const res = mockRes();
    sendAppError(res, conflict('Esta cuenta ya está cerrada.', ErrorCodes.ACCOUNT_CLOSED));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_CLOSED);
  });

  test('422 unprocessable factory', () => {
    const res = mockRes();
    sendAppError(res, unprocessable('Abrí una caja antes de registrar ventas.', ErrorCodes.NO_ACTIVE_CASH_SHIFT));
    assert.equal(res.getStatus(), 422);
    assert.equal(res.getBody().code, ErrorCodes.NO_ACTIVE_CASH_SHIFT);
  });

  test('403 forbidden factory', () => {
    const res = mockRes();
    sendAppError(res, forbidden('Sin permiso.'));
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getBody().code, ErrorCodes.FORBIDDEN);
  });

  test('validationError factory incluye fieldErrors', () => {
    const res = mockRes();
    const fieldErrors = { phone: 'Requerido', name: 'Mínimo 2 caracteres' };
    sendAppError(res, validationError('Datos inválidos.', fieldErrors));
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getBody().code, ErrorCodes.VALIDATION_ERROR);
    assert.deepEqual(res.getBody().fieldErrors, fieldErrors);
  });
});

// ── sendAppError — error inesperado ───────────────────────────────────────────
describe('sendAppError — con error inesperado', () => {
  test('Error ordinario → 500 + UNEXPECTED_ERROR', () => {
    const res = mockRes();
    sendAppError(res, new Error('P1001: Cannot reach database'), 'No se pudo cargar la cuenta');
    assert.equal(res.getStatus(), 500);
    assert.equal(res.getBody().code, ErrorCodes.UNEXPECTED_ERROR);
    assert.equal(res.getBody().error, 'No se pudo cargar la cuenta');
    // NUNCA el mensaje interno de Prisma
    assert.notEqual(res.getBody().error, 'P1001: Cannot reach database');
  });

  test('TypeError → 500 + UNEXPECTED_ERROR', () => {
    const res = mockRes();
    sendAppError(res, new TypeError("Cannot read properties of undefined"), 'No se pudo procesar');
    assert.equal(res.getStatus(), 500);
    assert.equal(res.getBody().code, ErrorCodes.UNEXPECTED_ERROR);
  });

  test('string thrown → 500 + fallback', () => {
    const res = mockRes();
    sendAppError(res, 'error string raro', 'Fallback seguro');
    assert.equal(res.getStatus(), 500);
    assert.equal(res.getBody().error, 'Fallback seguro');
    assert.equal(res.getBody().code, ErrorCodes.UNEXPECTED_ERROR);
  });

  test('null thrown → 500 + fallback', () => {
    const res = mockRes();
    sendAppError(res, null, 'Fallback seguro');
    assert.equal(res.getStatus(), 500);
    assert.equal(res.getBody().code, ErrorCodes.UNEXPECTED_ERROR);
  });

  test('usa fallback por defecto si no se pasa', () => {
    const res = mockRes();
    sendAppError(res, new Error('bug interno'));
    assert.equal(res.getStatus(), 500);
    assert.equal(res.getBody().error, 'No pudimos completar la acción. Intentá nuevamente.');
  });
});

// ── ErrorCodes — integridad del catálogo ─────────────────────────────────────
describe('ErrorCodes — catálogo', () => {
  test('todos los codes son strings no vacíos', () => {
    const { ErrorCodes: codes } = require('../src/errors/errorCodes');
    for (const [key, value] of Object.entries(codes)) {
      assert.equal(typeof value, 'string', `${key} debe ser string`);
      assert.ok((value as string).length > 0, `${key} no debe ser vacío`);
    }
  });

  test('codes críticos existen', () => {
    const required = [
      // Auth
      'FORBIDDEN', 'CLUB_NOT_FOUND',
      // Reservas
      'BOOKING_NOT_FOUND', 'BOOKING_OVERLAP', 'BOOKING_INVALID_STATUS',
      'BOOKING_SLOT_UNAVAILABLE', 'COURT_NOT_FOUND', 'ACTIVITY_NOT_FOUND',
      'ACTIVITY_OUT_OF_CLUB', 'CLUB_CONFIG_INVALID',
      'CLUB_INVALID',
      'SLOT_ALREADY_BOOKED', 'BOOKING_IN_PAST', 'SLOT_NOT_ALLOWED',
      'CLUB_CLOSED', 'DURATION_NOT_ALLOWED', 'ADVANCE_LIMIT_EXCEEDED',
      'INVALID_DATE_TIME', 'MISSING_DATE_TIME', 'INVALID_CLIENT_PHONE',
      'BOOKING_TITULAR_CHANGE_BLOCKED', 'BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN',
      'BILLING_MISSING_RESPONSIBLE', 'BILLING_INVALID_ASSIGNMENTS',
      'BILLING_ASSIGNMENTS_REQUIRED',
      'CLIENT_POSSIBLE_DUPLICATE', 'CLIENT_NOT_FOUND', 'CLIENT_OUT_OF_CLUB',
      'CLIENT_MERGE_CONFLICT', 'CLIENT_MERGE_SAME_CLIENT', 'CLIENT_LINK_CONFLICT',
      'USER_NOT_FOUND', 'USER_CLIENT_LINK_EXISTS',
      // Cuentas / pagos / caja
      'ACCOUNT_CLOSED', 'ACCOUNT_NOT_FOUND', 'ACCOUNT_HAS_PENDING_BALANCE',
      'ACCOUNT_HAS_PAYMENTS', 'ACCOUNT_HAS_REFUNDS',
      'PAYMENT_OVERPAY', 'PAYMENT_INVALID_AMOUNT', 'PAYMENT_METHOD_INVALID',
      'NO_ACTIVE_CASH_SHIFT', 'CASH_SHIFT_ALREADY_OPEN', 'CASH_SHIFT_NOT_FOUND',
      'CASH_SHIFT_CLOSE_BLOCKED', 'CASH_REGISTER_NOT_FOUND',
      'REFUND_INVALID_STATUS', 'REFUND_NOT_FOUND',
      // Productos / POS
      'PRODUCT_NOT_FOUND', 'PRODUCT_INACTIVE', 'STOCK_INSUFFICIENT',
      'SERVICE_NOT_FOUND', 'SERVICE_INACTIVE', 'PRICE_RULE_NOT_FOUND',
      // General
      'INVALID_INPUT', 'UNEXPECTED_ERROR',
    ];
    for (const code of required) {
      assert.ok(
        Object.values(ErrorCodes).includes(code as any),
        `Falta el code: ${code}`
      );
    }
  });
});
