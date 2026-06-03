import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function createService() {
  return new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
}

test('booking created filtra solo el whatsapp legacy del customer y mantiene staff legacy', () => {
  const service = createService();
  const messages = service.buildBookingCreatedOutboxMessages({
    bookingId: 55,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserIds: [9],
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    amount: 10000
  });

  const filtered = service.filterOutboxMessages(messages, (message: any) =>
    service.isLegacyCustomerWhatsappOutboxMessage(message, 'booking-created:55:client:')
  );

  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.WHATSAPP_SEND && String(message.dedupeKey).includes(':client:')),
    false
  );
  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.WHATSAPP_SEND && String(message.dedupeKey).includes(':club:')),
    true
  );
  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.NOTIFICATION_CREATE),
    true
  );
});

test('booking cancelled filtra solo el whatsapp legacy del customer y mantiene staff legacy', () => {
  const service = createService();
  const messages = service.buildBookingCancelledOutboxMessages({
    bookingId: 56,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserId: 9,
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    reason: 'AUTO_CANCEL_UNCONFIRMED'
  });

  const filtered = service.filterOutboxMessages(messages, (message: any) =>
    service.isLegacyCustomerWhatsappOutboxMessage(message, 'booking-cancelled:56:client:')
  );

  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.WHATSAPP_SEND && String(message.dedupeKey).includes(':client:')),
    false
  );
  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.WHATSAPP_SEND && String(message.dedupeKey).includes(':club:')),
    true
  );
  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.NOTIFICATION_CREATE),
    true
  );
});

test('matriz false/false deja customer y staff en legacy', () => {
  const service = createService();
  const messages = service.buildBookingCreatedOutboxMessages({
    bookingId: 57,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserIds: [9],
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    amount: 10000
  });

  const filtered = service.filterBookingWhatsappOutboxMessages({
    messages,
    customerLegacyDedupePrefix: 'booking-created:57:client:',
    staffLegacyDedupePrefix: 'booking-created:57:club:',
    customerEventsV2Enabled: false,
    staffEventsV2Enabled: false
  });

  assert.equal(filtered.length, messages.length);
});

test('matriz true/false deja customer V2 y staff legacy', () => {
  const service = createService();
  const messages = service.buildBookingCreatedOutboxMessages({
    bookingId: 58,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserIds: [9],
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    amount: 10000
  });

  const filtered = service.filterBookingWhatsappOutboxMessages({
    messages,
    customerLegacyDedupePrefix: 'booking-created:58:client:',
    staffLegacyDedupePrefix: 'booking-created:58:club:',
    customerEventsV2Enabled: true,
    staffEventsV2Enabled: false
  });

  assert.equal(
    filtered.some((message: any) => String(message.dedupeKey).includes(':client:')),
    false
  );
  assert.equal(
    filtered.some((message: any) => String(message.dedupeKey).includes(':club:')),
    true
  );
});

test('matriz false/true deja customer legacy y staff V2', () => {
  const service = createService();
  const messages = service.buildBookingCreatedOutboxMessages({
    bookingId: 59,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserIds: [9],
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    amount: 10000
  });

  const filtered = service.filterBookingWhatsappOutboxMessages({
    messages,
    customerLegacyDedupePrefix: 'booking-created:59:client:',
    staffLegacyDedupePrefix: 'booking-created:59:club:',
    customerEventsV2Enabled: false,
    staffEventsV2Enabled: true
  });

  assert.equal(
    filtered.some((message: any) => String(message.dedupeKey).includes(':client:')),
    true
  );
  assert.equal(
    filtered.some((message: any) => String(message.dedupeKey).includes(':club:')),
    false
  );
});

test('matriz true/true deja ambos roles en V2 y solo notificaciones internas legacy', () => {
  const service = createService();
  const messages = service.buildBookingCreatedOutboxMessages({
    bookingId: 60,
    clubId: 7,
    clubName: 'Pique Club',
    clubPhone: '+54 9 351 555 1111',
    courtName: 'Cancha 1',
    clientName: 'Fran',
    clientPhone: '+54 9 351 444 2222',
    notificationUserIds: [9],
    startDateTime: new Date('2026-06-02T00:30:00.000Z'),
    timeZone: 'America/Argentina/Buenos_Aires',
    amount: 10000
  });

  const filtered = service.filterBookingWhatsappOutboxMessages({
    messages,
    customerLegacyDedupePrefix: 'booking-created:60:client:',
    staffLegacyDedupePrefix: 'booking-created:60:club:',
    customerEventsV2Enabled: true,
    staffEventsV2Enabled: true
  });

  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.WHATSAPP_SEND),
    false
  );
  assert.equal(
    filtered.some((message: any) => message.type === OUTBOX_TYPES.NOTIFICATION_CREATE),
    true
  );
});
