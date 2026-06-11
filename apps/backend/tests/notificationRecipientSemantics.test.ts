import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_RECIPIENT_ROLES,
  normalizeSemanticRecipientRole
} from '../src/types/notifications';

test('BOOKING_OWNER se normaliza a CUSTOMER solo en capa semántica', () => {
  assert.equal(normalizeSemanticRecipientRole('BOOKING_OWNER'), 'CUSTOMER');
});

test('CUSTOMER y CLUB_STAFF pasan sin cambios', () => {
  assert.equal(normalizeSemanticRecipientRole('CUSTOMER'), 'CUSTOMER');
  assert.equal(normalizeSemanticRecipientRole('CLUB_STAFF'), 'CLUB_STAFF');
});

test('BOOKING_OWNER no aparece como rol persistente', () => {
  assert.equal(NOTIFICATION_RECIPIENT_ROLES.includes('BOOKING_OWNER' as any), false);
});
