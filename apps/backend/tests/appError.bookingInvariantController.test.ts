import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingController } from '../src/controllers/BookingController';
import { ErrorCodes } from '../src/errors';

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

const integrityError = (message: string) => new Error(`Inconsistencia de integridad: ${message}`);

test('cancelBooking devuelve UNEXPECTED_ERROR ante invariante interna', async () => {
  const controller = new BookingController({
    cancelBooking: async () => {
      throw integrityError('la reserva 711 está CONFIRMED pero no tiene Account BOOKING');
    },
  } as any);

  const res = new MockResponse();

  await controller.cancelBooking(
    {
      body: { bookingId: 711 },
      user: { userId: 99 },
      clubId: 15,
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'No pudimos completar la acción. Intentá nuevamente.',
    code: ErrorCodes.UNEXPECTED_ERROR,
  });
});

test('completeBooking devuelve UNEXPECTED_ERROR ante invariante interna', async () => {
  const controller = new BookingController({
    completeBooking: async () => {
      throw integrityError('la reserva 88 no tiene Account BOOKING');
    },
  } as any);

  const res = new MockResponse();

  await controller.completeBooking(
    {
      params: { id: '88' },
      user: { userId: 99 },
      clubId: 3,
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'No se pudo completar la reserva',
    code: ErrorCodes.UNEXPECTED_ERROR,
  });
});

test('getItems devuelve UNEXPECTED_ERROR ante invariante interna', async () => {
  const controller = new BookingController({
    getBookingItems: async () => {
      throw integrityError('la reserva 610 está CONFIRMED pero no tiene Account BOOKING');
    },
  } as any);

  const res = new MockResponse();

  await controller.getItems(
    {
      params: { id: '610' },
      clubId: 7,
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: 'Error al obtener los consumos',
    code: ErrorCodes.UNEXPECTED_ERROR,
  });
});
