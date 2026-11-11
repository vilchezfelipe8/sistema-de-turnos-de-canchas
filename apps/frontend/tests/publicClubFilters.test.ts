import test from 'node:test';
import assert from 'node:assert/strict';
import type { Club } from '../services/ClubService';
import { getPublicClubLocations, matchesPublicClubFilters, normalizePublicSport } from '../utils/publicClubFilters';

const clubs = [
  { id: 1, name: 'Las Tejas Pádel', city: 'Río Tercero', province: 'Córdoba', country: 'Argentina', publicSports: ['padel', 'tennis'] },
  { id: 2, name: 'Central', city: 'Buenos Aires', province: 'Buenos Aires', country: 'Argentina', publicSports: ['football', 'padel'] },
  { id: 4, name: 'Barrio Parque', city: 'Córdoba', province: 'Córdoba', country: 'Argentina', publicSports: ['tennis'] },
] as Club[];

test('enlaces antiguos del inicio y opciones de Complejos devuelven los mismos clubes', () => {
  for (const [legacy, canonical, ids] of [
    ['tenis', 'tennis', [1, 4]],
    ['futbol', 'football', [2]],
    ['pádel', 'padel', [1, 2]],
  ] as const) {
    assert.equal(normalizePublicSport(legacy), canonical);
    for (const sport of [legacy, canonical]) {
      assert.deepEqual(clubs.filter(club => matchesPublicClubFilters(club, { sport })).map(club => club.id), ids);
    }
  }
});

test('deporte y zona elegidos en inicio se combinan igual que en Complejos', () => {
  assert.deepEqual(
    clubs.filter(club => matchesPublicClubFilters(club, { sport: 'tenis', zone: 'Córdoba' })).map(club => club.id),
    [4],
  );
  assert.equal(matchesPublicClubFilters(clubs[2], { sport: 'padel', zone: 'Córdoba' }), false);
  assert.equal(matchesPublicClubFilters(clubs[0], { search: 'rio tercero' }), true);
});

test('zonas salen de clubes disponibles, sin duplicados ni ciudades vacías', () => {
  const locations = getPublicClubLocations([...clubs, clubs[2], { ...clubs[0], city: '' }]);
  assert.deepEqual(locations.map(location => location.city), ['Buenos Aires', 'Córdoba', 'Río Tercero']);
  assert.ok(locations.every(location => clubs.some(club => matchesPublicClubFilters(club, { zone: location.city }))));
});

test('normaliza tildes y descarta deportes desconocidos al leer URL', () => {
  assert.equal(normalizePublicSport(' FÚTBOL '), 'football');
  assert.equal(normalizePublicSport('básquet'), 'basketball');
  assert.equal(normalizePublicSport('vóley'), 'volleyball');
  assert.equal(normalizePublicSport('desconocido'), '');
  assert.equal(normalizePublicSport('constructor'), '');
});
