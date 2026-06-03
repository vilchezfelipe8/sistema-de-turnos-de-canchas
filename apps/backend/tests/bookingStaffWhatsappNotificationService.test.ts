import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingStaffWhatsappNotificationService } from '../src/services/BookingStaffWhatsappNotificationService';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function createService(options?: {
  staffEventsV2?: boolean;
  legacyImpl?: (input: any) => Promise<any>;
  v2Impl?: (input: any) => Promise<any>;
}) {
  const legacyCalls: any[] = [];
  const v2Calls: any[] = [];

  const service = new BookingStaffWhatsappNotificationService({
    flags: {
      ENABLE_WHATSAPP_STAFF_EVENTS_V2: options?.staffEventsV2 ?? false
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
    bookingId: 201,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 2',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires'
  };
}

test('staff booking created usa legacy cuando ENABLE_WHATSAPP_STAFF_EVENTS_V2=false', async () => {
  const { service, legacyCalls, v2Calls } = createService({ staffEventsV2: false });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 15000
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'LEGACY');
  assert.equal(legacyCalls.length, 1);
  assert.equal(v2Calls.length, 0);
  assert.equal(legacyCalls[0].type, OUTBOX_TYPES.WHATSAPP_SEND);
  assert.match(String(legacyCalls[0].dedupeKey), /^booking-created:201:club:/);
});

test('staff booking created usa V2 cuando flag staff esta activo', async () => {
  const { service, legacyCalls, v2Calls } = createService({ staffEventsV2: true });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 15000
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
  assert.equal(v2Calls[0].eventType, 'BOOKING_CREATED');
  assert.equal(v2Calls[0].recipientRole, 'CLUB_STAFF');
  assert.equal(v2Calls[0].recipientPhone, '5493515551111');
  assert.equal(v2Calls[0].dedupeKey, 'booking:201:staff:booking_created:v2');
  assert.deepEqual(v2Calls[0].templateParameterOrder, [
    'club_name',
    'client_name',
    'client_phone',
    'date',
    'time',
    'court_name',
    'amount'
  ]);
});

test('staff booking cancelled usa V2 sin doble envio legacy', async () => {
  const { service, legacyCalls, v2Calls } = createService({ staffEventsV2: true });

  const result = await service.enqueueBookingCancelled({
    ...buildBaseInput(),
    reason: 'AUTO_CANCEL_UNCONFIRMED'
  });

  assert.equal(result.queued, true);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
  assert.equal(v2Calls[0].eventType, 'BOOKING_CANCELLED');
  assert.equal(v2Calls[0].recipientRole, 'CLUB_STAFF');
  assert.equal(v2Calls[0].dedupeKey, 'booking:201:staff:booking_cancelled:v2');
  assert.equal(v2Calls[0].templateParams.cancel_reason_label, 'falta de confirmacion');
});

test('si enqueue V2 staff falla no rompe operacion y no cae a legacy automatico', async () => {
  const { service, legacyCalls, v2Calls } = createService({
    staffEventsV2: true,
    v2Impl: async () => {
      throw new Error('boom');
    }
  });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    amount: 15000
  });

  assert.equal(result.queued, false);
  assert.equal(result.mode, 'V2');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 1);
});

test('si falta club.phone el flujo staff se omite sin crear V2 invalido', async () => {
  const { service, legacyCalls, v2Calls } = createService({ staffEventsV2: true });

  const result = await service.enqueueBookingCreated({
    ...buildBaseInput(),
    clubPhone: null,
    amount: 15000
  });

  assert.equal(result.queued, false);
  assert.equal(result.mode, 'SKIPPED');
  assert.equal(legacyCalls.length, 0);
  assert.equal(v2Calls.length, 0);
});
