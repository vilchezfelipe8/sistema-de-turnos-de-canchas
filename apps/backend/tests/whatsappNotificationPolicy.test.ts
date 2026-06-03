import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappNotificationPolicyService } from '../src/services/WhatsappNotificationPolicyService';

const service = new WhatsappNotificationPolicyService();

test('policy acepta payload CUSTOMER v\u00e1lido y normaliza tel\u00e9fono', () => {
  const payload = service.validatePayload({
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CUSTOMER',
    clubId: 10,
    recipientPhone: '+54 9 351 123-4567',
    referenceType: 'BOOKING',
    referenceId: 'booking-1',
    dedupeKey: 'wa-v2:booking-1:customer',
    templateParams: {
      bookingId: 'booking-1',
      amount: 1000
    }
  });

  assert.equal(payload.recipientPhone, '5493511234567');
});

test('policy acepta payload CLUB_STAFF v\u00e1lido', () => {
  const payload = service.validatePayload({
    eventType: 'BOOKING_CANCELLED',
    recipientRole: 'CLUB_STAFF',
    clubId: 10,
    recipientPhone: '5493512223333',
    referenceType: 'BOOKING',
    referenceId: 'booking-2',
    dedupeKey: 'wa-v2:booking-2:staff',
    templateParams: {
      bookingId: 'booking-2'
    }
  });

  assert.equal(payload.recipientRole, 'CLUB_STAFF');
});

test('policy rechaza BOOKING_OWNER como rol persistente', () => {
  assert.throws(
    () =>
      service.validatePayload({
        eventType: 'BOOKING_CREATED',
        recipientRole: 'BOOKING_OWNER' as any,
        clubId: 10,
        recipientPhone: '5493512223333',
        referenceType: 'BOOKING',
        referenceId: 'booking-3',
        dedupeKey: 'wa-v2:booking-3:owner',
        templateParams: {}
      }),
    /BOOKING_OWNER/
  );
});

test('policy rechaza recipientPhone vac\u00edo', () => {
  assert.throws(
    () =>
      service.validatePayload({
        eventType: 'BOOKING_CREATED',
        recipientRole: 'CUSTOMER',
        clubId: 10,
        recipientPhone: '',
        referenceType: 'BOOKING',
        referenceId: 'booking-4',
        dedupeKey: 'wa-v2:booking-4:customer',
        templateParams: {}
      }),
    /recipientPhone/
  );
});

test('policy rechaza dedupeKey vac\u00edo', () => {
  assert.throws(
    () =>
      service.validatePayload({
        eventType: 'BOOKING_CREATED',
        recipientRole: 'CUSTOMER',
        clubId: 10,
        recipientPhone: '5493512223333',
        referenceType: 'BOOKING',
        referenceId: 'booking-5',
        dedupeKey: '   ',
        templateParams: {}
      }),
    /dedupeKey/
  );
});
