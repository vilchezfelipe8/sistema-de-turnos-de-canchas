/**
 * Tests — AppError financiero (errores de dominio Caja/Cuentas/Pagos/Devoluciones)
 * Runner: node --test (Node built-in test runner)
 *
 * Estos tests verifican que:
 * 1. Los factories crean AppError con el code y statusCode correctos.
 * 2. sendAppError responde con el payload esperado.
 * 3. Los ErrorCodes críticos financieros existen en el catálogo.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors/AppError';
import { ErrorCodes } from '../src/errors/errorCodes';
import { badRequest, notFound, conflict, unprocessable } from '../src/errors/factories';
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

// ── CashShift errors ──────────────────────────────────────────────────────────
describe('CashShift — errores de dominio', () => {
  test('CASH_SHIFT_ALREADY_OPEN → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('Ya existe un turno abierto para esta caja.', ErrorCodes.CASH_SHIFT_ALREADY_OPEN));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.CASH_SHIFT_ALREADY_OPEN);
  });

  test('NO_ACTIVE_CASH_SHIFT → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Turno de caja abierto no encontrado.', ErrorCodes.NO_ACTIVE_CASH_SHIFT));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.NO_ACTIVE_CASH_SHIFT);
  });

  test('CASH_SHIFT_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Turno no encontrado.', ErrorCodes.CASH_SHIFT_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.CASH_SHIFT_NOT_FOUND);
  });

  test('CASH_SHIFT_CLOSE_BLOCKED → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('No se puede cerrar caja con cuentas abiertas.', ErrorCodes.CASH_SHIFT_CLOSE_BLOCKED));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.CASH_SHIFT_CLOSE_BLOCKED);
  });

  test('CASH_REGISTER_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Caja no encontrada.', ErrorCodes.CASH_REGISTER_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.CASH_REGISTER_NOT_FOUND);
  });
});

// ── Account errors ────────────────────────────────────────────────────────────
describe('Account — errores de dominio', () => {
  test('ACCOUNT_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_NOT_FOUND);
    assert.equal(res.getBody().error, 'Cuenta no encontrada.');
  });

  test('ACCOUNT_CLOSED → 409 al agregar ítem', () => {
    const res = mockRes();
    sendAppError(res, conflict('Solo se pueden agregar consumos a cuentas abiertas.', ErrorCodes.ACCOUNT_CLOSED));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_CLOSED);
  });

  test('ACCOUNT_HAS_PENDING_BALANCE → 409 con meta.remaining', () => {
    const res = mockRes();
    const err = conflict(
      'No se puede cerrar la cuenta: aún hay saldo pendiente.',
      ErrorCodes.ACCOUNT_HAS_PENDING_BALANCE,
      { remaining: 1500.50 }
    );
    sendAppError(res, err);
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_HAS_PENDING_BALANCE);
    assert.deepEqual(res.getBody().meta, { remaining: 1500.50 });
  });

  test('STOCK_INSUFFICIENT → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('Stock insuficiente.', ErrorCodes.STOCK_INSUFFICIENT));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.STOCK_INSUFFICIENT);
  });
});

// ── Payment errors ────────────────────────────────────────────────────────────
describe('Payment — errores de dominio', () => {
  test('PAYMENT_INVALID_AMOUNT → 400', () => {
    const res = mockRes();
    sendAppError(res, badRequest('El monto debe ser mayor a 0.', ErrorCodes.PAYMENT_INVALID_AMOUNT));
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getBody().code, ErrorCodes.PAYMENT_INVALID_AMOUNT);
  });

  test('PAYMENT_OVERPAY → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('El pago supera el saldo pendiente de la cuenta.', ErrorCodes.PAYMENT_OVERPAY));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.PAYMENT_OVERPAY);
  });

  test('PAYMENT_METHOD_INVALID → 400', () => {
    const res = mockRes();
    sendAppError(res, badRequest('El canal es obligatorio para pagos por transferencia.', ErrorCodes.PAYMENT_METHOD_INVALID));
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getBody().code, ErrorCodes.PAYMENT_METHOD_INVALID);
  });

  test('NO_ACTIVE_CASH_SHIFT para POS → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('No hay turno de caja abierto para pagos POS.', ErrorCodes.NO_ACTIVE_CASH_SHIFT));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.NO_ACTIVE_CASH_SHIFT);
  });

  test('ACCOUNT_CLOSED en registerPayment → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('Solo se pueden registrar pagos en cuentas abiertas.', ErrorCodes.ACCOUNT_CLOSED));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.ACCOUNT_CLOSED);
  });

  test('BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict(
      'No se puede registrar un pago sobre una reserva pendiente en modo MANUAL.',
      ErrorCodes.BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN
    ));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN);
  });
});

// ── Refund errors ─────────────────────────────────────────────────────────────
describe('Refund — errores de dominio', () => {
  test('REFUND_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Devolución no encontrada.', ErrorCodes.REFUND_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.REFUND_NOT_FOUND);
  });

  test('REFUND_INVALID_STATUS → 409 al ejecutar cancelada', () => {
    const res = mockRes();
    sendAppError(res, conflict('No se puede ejecutar una devolución cancelada.', ErrorCodes.REFUND_INVALID_STATUS));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.REFUND_INVALID_STATUS);
  });

  test('REFUND_INVALID_STATUS → 409 al reintentar no-FAILED', () => {
    const res = mockRes();
    sendAppError(res, conflict('Solo se pueden reintentar devoluciones en estado FAILED.', ErrorCodes.REFUND_INVALID_STATUS));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.REFUND_INVALID_STATUS);
  });

  test('PAYMENT_OVERPAY en refund → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('El monto de devolución supera el saldo refundable del pago.', ErrorCodes.PAYMENT_OVERPAY));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.PAYMENT_OVERPAY);
  });
});

// ── POS / CashService errors ──────────────────────────────────────────────────
describe('POS / CashService — errores de dominio', () => {
  test('NO_ACTIVE_CASH_SHIFT en venta → 422', () => {
    const res = mockRes();
    sendAppError(res, unprocessable('Abrí una caja antes de registrar ventas de mostrador.', ErrorCodes.NO_ACTIVE_CASH_SHIFT));
    assert.equal(res.getStatus(), 422);
    assert.equal(res.getBody().code, ErrorCodes.NO_ACTIVE_CASH_SHIFT);
  });

  test('PRODUCT_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Producto no encontrado.', ErrorCodes.PRODUCT_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.PRODUCT_NOT_FOUND);
  });

  test('PRODUCT_INACTIVE → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('Producto inactivo.', ErrorCodes.PRODUCT_INACTIVE));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.PRODUCT_INACTIVE);
  });

  test('STOCK_INSUFFICIENT en venta → 409', () => {
    const res = mockRes();
    sendAppError(res, conflict('Stock insuficiente.', ErrorCodes.STOCK_INSUFFICIENT));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.STOCK_INSUFFICIENT);
  });

  test('CLIENT_POSSIBLE_DUPLICATE → 409 con meta', () => {
    const res = mockRes();
    const meta = { candidateClientIds: ['c1', 'c2'], reasonType: 'PHONE' };
    sendAppError(res, conflict('Se encontraron posibles clientes duplicados.', ErrorCodes.CLIENT_POSSIBLE_DUPLICATE, meta));
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getBody().code, ErrorCodes.CLIENT_POSSIBLE_DUPLICATE);
    assert.deepEqual(res.getBody().meta, meta);
  });

  test('CLIENT_NOT_FOUND → 404', () => {
    const res = mockRes();
    sendAppError(res, notFound('Cliente no encontrado para el club.', ErrorCodes.CLIENT_NOT_FOUND));
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getBody().code, ErrorCodes.CLIENT_NOT_FOUND);
  });
});

// ── ErrorCodes financieros — integridad del catálogo ─────────────────────────
describe('ErrorCodes financieros — catálogo', () => {
  test('todos los codes financieros críticos existen', () => {
    const required = [
      'ACCOUNT_NOT_FOUND', 'ACCOUNT_CLOSED', 'ACCOUNT_HAS_PENDING_BALANCE',
      'ACCOUNT_HAS_PAYMENTS', 'ACCOUNT_HAS_REFUNDS',
      'PAYMENT_OVERPAY', 'PAYMENT_INVALID_AMOUNT', 'PAYMENT_METHOD_INVALID',
      'NO_ACTIVE_CASH_SHIFT', 'CASH_SHIFT_ALREADY_OPEN', 'CASH_SHIFT_NOT_FOUND',
      'CASH_SHIFT_CLOSE_BLOCKED', 'CASH_REGISTER_NOT_FOUND',
      'REFUND_INVALID_STATUS', 'REFUND_NOT_FOUND',
      'STOCK_INSUFFICIENT', 'PRODUCT_INACTIVE', 'PRODUCT_NOT_FOUND',
      'SERVICE_NOT_FOUND', 'SERVICE_INACTIVE',
      'CLIENT_POSSIBLE_DUPLICATE', 'CLIENT_NOT_FOUND',
    ];
    for (const code of required) {
      assert.ok(
        Object.values(ErrorCodes).includes(code as any),
        `Falta el code financiero: ${code}`
      );
    }
  });
});
