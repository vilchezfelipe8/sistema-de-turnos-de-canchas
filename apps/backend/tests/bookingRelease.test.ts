import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BOOKING_RELEASE_POLICY,
  evaluateBookingRelease,
  normalizeBookingReleasePolicy,
  validateBookingReleasePolicy,
  type BookingReleasePolicy
} from '../src/services/BookingReleaseService';

const TZ = 'America/Argentina/Buenos_Aires'; // UTC-3
const policy: BookingReleasePolicy = { ...DEFAULT_BOOKING_RELEASE_POLICY, enabled: true };

// Hora local del club (UTC-3) → instante UTC.
const at = (localIso: string) => new Date(`${localIso}-03:00`);

const evaluate = (localIso: string, isMember: boolean, customPolicy = policy) =>
  evaluateBookingRelease({ policy: customPolicy, now: at(localIso), timeZone: TZ, isMember, isAuthenticated: true });

const stateOf = (localIso: string, isMember: boolean, customPolicy = policy) => {
  const result = evaluate(localIso, isMember, customPolicy);
  assert.equal(result.enabled, true);
  return result.enabled ? result.state : null;
};

test('sin política activa no restringe nada', () => {
  const result = evaluateBookingRelease({
    policy: DEFAULT_BOOKING_RELEASE_POLICY,
    now: at('2026-10-19T09:30:00'),
    timeZone: TZ,
    isMember: false,
    isAuthenticated: false
  });
  assert.deepEqual(result, { enabled: false });
});

test('entre las 00:00 y las 08:00 nadie reserva', () => {
  assert.equal(stateOf('2026-10-20T00:00:00', true), 'NOT_OPEN_YET');
  assert.equal(stateOf('2026-10-19T07:59:00', true), 'NOT_OPEN_YET');
  assert.equal(stateOf('2026-10-19T07:59:00', false), 'NOT_OPEN_YET');
});

test('de 08:00 a 11:00 reservan solo socios', () => {
  assert.equal(stateOf('2026-10-19T08:00:00', true), 'OPEN');
  assert.equal(stateOf('2026-10-19T08:00:00', false), 'MEMBERS_ONLY');
  assert.equal(stateOf('2026-10-19T10:59:00', false), 'MEMBERS_ONLY');
});

test('desde las 11:00 y hasta la medianoche reservan todos', () => {
  assert.equal(stateOf('2026-10-19T11:00:00', false), 'OPEN');
  assert.equal(stateOf('2026-10-19T23:59:00', false), 'OPEN');
  assert.equal(stateOf('2026-10-19T23:59:00', true), 'OPEN');
});

test('con cierre antes de medianoche queda cerrado hasta la apertura del día siguiente', () => {
  const custom = { ...policy, closesAt: '22:00' };
  const result = evaluate('2026-10-19T22:30:00', false, custom);
  assert.equal(result.enabled && result.state, 'CLOSED_FOR_TODAY');
  assert.equal(result.enabled && result.viewerOpensAt, '11:00');
});

test('los días habilitados son hoy y mañana, aun en cambio de mes', () => {
  const monday = evaluate('2026-10-19T12:00:00', false);
  assert.deepEqual(monday.enabled && monday.allowedDates, ['2026-10-19', '2026-10-20']);
  const endOfMonth = evaluate('2026-10-31T12:00:00', false);
  assert.deepEqual(endOfMonth.enabled && endOfMonth.allowedDates, ['2026-10-31', '2026-11-01']);
});

test('fin de semana con otros horarios o sin prioridad', () => {
  const custom: BookingReleasePolicy = {
    ...policy,
    weekendMode: 'CUSTOM',
    weekend: { memberOpensAt: '09:00', publicOpensAt: '12:00' }
  };
  // Sábado 24/10
  assert.equal(stateOf('2026-10-24T08:30:00', true, custom), 'NOT_OPEN_YET');
  assert.equal(stateOf('2026-10-24T09:00:00', true, custom), 'OPEN');
  assert.equal(stateOf('2026-10-24T11:00:00', false, custom), 'MEMBERS_ONLY');
  // El lunes vuelve el horario de semana
  assert.equal(stateOf('2026-10-26T08:00:00', true, custom), 'OPEN');

  const noPriority: BookingReleasePolicy = {
    ...policy,
    weekendMode: 'NO_PRIORITY',
    weekend: { memberOpensAt: '09:00', publicOpensAt: '10:00' }
  };
  assert.equal(stateOf('2026-10-25T09:30:00', true, noPriority), 'NOT_OPEN_YET');
  assert.equal(stateOf('2026-10-25T10:00:00', false, noPriority), 'OPEN');
});

test('normaliza datos inválidos a los valores por defecto', () => {
  const normalized = normalizeBookingReleasePolicy({ enabled: true, weekdays: { memberOpensAt: '8', publicOpensAt: '25:00' }, daysAhead: -2, weekendMode: 'X' });
  assert.equal(normalized.enabled, true);
  assert.deepEqual(normalized.weekdays, DEFAULT_BOOKING_RELEASE_POLICY.weekdays);
  assert.equal(normalized.daysAhead, 1);
  assert.equal(normalized.weekendMode, 'SAME');
  assert.equal(normalizeBookingReleasePolicy(null).enabled, false);
});

test('valida que los socios no empiecen después del resto ni después del cierre', () => {
  assert.equal(validateBookingReleasePolicy(policy), null);
  assert.ok(validateBookingReleasePolicy({ ...policy, weekdays: { memberOpensAt: '12:00', publicOpensAt: '11:00' } }));
  assert.ok(validateBookingReleasePolicy({ ...policy, closesAt: '10:00' }));
});
