import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingCustomerWhatsappNotificationService } from '../src/services/BookingCustomerWhatsappNotificationService';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function createService(options?: {
  customerEventsV2?: boolean;
  legacyImpl?: (input: any) => Promise<any>;
  v2Impl?: (input: any) => Promise<any>;
}) {
  const legacyCalls: any[] = [];
  const v2Calls: any[] = [];

  const service = new BookingCustomerWhatsappNotificationService({
    flags: {
      ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: options?.customerEventsV2 ?? false
    },
    outboxService: {
      enqueue: async (input: any) => {
        legacyCalls.push(input);
        if (options?.legacyImpl) return options.legacyImpl(input);
        return input;
      }
    },
    whatsappNotificationOutboxService: {
      enqueueSendV2: async (input: any) => {
        v2Calls.push(input);
        if (options?.v2Impl) return options.v2Impl(input);
        return {
          created: true,
          outboxMessage: { id: 'outbox-v2' },
          whatsappDelivery: { id: 'delivery-v2' }
        };
      }
    }
  });

  return { service, legacyCalls, v2Calls };
}

function buildBaseInput() {
  return {
    bookingId: 101,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires'
  };
}

test('booking created usa legacy exacto cuando ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2=false', async () => {
  const { service, legacyCalls, v2Calls } = createService({ customerEventsV2: false });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 12000
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'LEGACY');
  assert.equal(legacyCalls.length, 1);
  assert.equal(v2Calls.length, 0);
  assert.equal(legacyCalls[0].type, OUTBOX_TYPES.WHATSAPP_SEND);
  assert.match(String(legacyCalls[0].dedupeKey), /^booking-created:101:client:/);
  assert.match(String(legacyCalls[0].payload?.message), /Reserva Registrada/i);
});

test('booking created usa WHATSAPP_SEND_V2 con templateParameterOrder explicito cuando flag V2 esta activo', async () => {
  const { service, legacyCalls, v2Calls } = createService({ customerEventsV2: true });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 12000
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
  assert.equal(v2Calls[0].eventType, 'BOOKING_CREATED');
  assert.equal(v2Calls[0].recipientRole, 'CUSTOMER');
  assert.deepEqual(v2Calls[0].templateParameterOrder, [
    'client_name',
    'club_name',
    'date',
    'time',
    'court_name',
    'amount',
    'club_whatsapp_url'
  ]);
  assert.equal(v2Calls[0].templateParams.club_whatsapp_url, 'https://wa.me/5493515551111');
});

test('booking cancelled usa V2 y no mezcla legacy cuando el flag esta activo', async () => {
  const { service, legacyCalls, v2Calls } = createService({ customerEventsV2: true });

  const result = await service.enqueueBookingCancelled({
    ...buildBaseInput(),
    reason: 'AUTO_CANCEL_UNCONFIRMED'
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
  assert.equal(v2Calls[0].eventType, 'BOOKING_CANCELLED');
  assert.equal(v2Calls[0].templateParams.cancel_reason_label, 'falta de confirmacion');
});

test('pending warning usa legacy cuando el flag V2 esta apagado', async () => {
  const { service, legacyCalls, v2Calls } = createService({ customerEventsV2: false });

  const result = await service.enqueuePendingWarning({
    ...buildBaseInput(),
    cancelMinutesBefore: 90,
    insufficientAmount: 2500
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'LEGACY');
  assert.equal(legacyCalls.length, 1);
  assert.equal(v2Calls.length, 0);
  assert.match(String(legacyCalls[0].payload?.message), /pendiente de confirmaci/i);
});

test('pending warning usa V2 cuando el flag esta activo', async () => {
  const { service, legacyCalls, v2Calls } = createService({ customerEventsV2: true });

  const result = await service.enqueuePendingWarning({
    ...buildBaseInput(),
    cancelMinutesBefore: 90,
    insufficientAmount: 2500
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
  assert.equal(v2Calls[0].eventType, 'BOOKING_PENDING_WARNING');
  assert.deepEqual(v2Calls[0].templateParameterOrder, [
    'client_name',
    'club_name',
    'date',
    'time',
    'court_name',
    'cancel_minutes_before',
    'insufficient_amount'
  ]);
});

test('si el enqueue V2 falla no rompe la reserva y no hace fallback legacy automatico', async () => {
  const { service, legacyCalls, v2Calls } = createService({
    customerEventsV2: true,
    v2Impl: async () => {
      throw new Error('boom');
    }
  });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 12000
  });

  assert.equal(result.queued, false);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
});
