import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/prisma';
import { PlayerInviteSearchService, normalizeSearchToken } from '../src/services/PlayerInviteSearchService';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-player-search';

type CapturedQuery = { sql: string; values: unknown[] };

// Reemplaza las consultas de Prisma que usa la búsqueda y devuelve lo que se pidió a la base.
function mockSearch(users: Array<{ id: number; firstName: string; lastName: string }>) {
  const original = {
    clubFindUnique: (prisma.club as any).findUnique,
    queryRaw: (prisma as any).$queryRaw,
    userFindMany: (prisma.user as any).findMany,
    bookingFindMany: (prisma.booking as any).findMany
  };
  const captured: CapturedQuery[] = [];
  (prisma.club as any).findUnique = async () => ({ id: 5 });
  (prisma as any).$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Prisma.sql(strings, ...values);
    captured.push({ sql: query.sql, values: query.values });
    return users.map((user) => ({ id: user.id }));
  };
  (prisma.user as any).findMany = async () => users;
  (prisma.booking as any).findMany = async () => [];
  const restore = () => {
    (prisma.club as any).findUnique = original.clubFindUnique;
    (prisma as any).$queryRaw = original.queryRaw;
    (prisma.user as any).findMany = original.userFindMany;
    (prisma.booking as any).findMany = original.bookingFindMany;
  };
  return { captured, restore };
}

test('normalizeSearchToken ignora acentos, ñ, diéresis, mayúsculas y signos', () => {
  assert.equal(normalizeSearchToken('Martín'), 'martin');
  assert.equal(normalizeSearchToken('NÚÑEZ'), 'nunez');
  assert.equal(normalizeSearchToken('Güemes'), 'guemes');
  assert.equal(normalizeSearchToken("O'Neill"), 'oneill');
  assert.equal(normalizeSearchToken('María-José'), 'mariajose');
  assert.equal(normalizeSearchToken('pérez,'), 'perez');
  assert.equal(normalizeSearchToken('Çelik'), 'celik');
});

test('la búsqueda compara sin acentos del lado de la base y del texto buscado', async () => {
  const { captured, restore } = mockSearch([{ id: 11, firstName: 'Martín', lastName: 'Núñez' }]);
  try {
    const service = new PlayerInviteSearchService();
    const results = await service.searchByName({ requesterUserId: 1, query: '  Martin  NUÑEZ ', clubSlug: 'club' });

    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, 'Martín N.');
    assert.equal(captured.length, 1);
    // Los nombres guardados se normalizan en SQL (translate + lower), no con ILIKE.
    assert.match(captured[0].sql, /translate\(lower\(u\."firstName"\)/);
    assert.match(captured[0].sql, /translate\(lower\(u\."lastName"\)/);
    assert.doesNotMatch(captured[0].sql, /ILIKE/i);
    // El texto buscado viaja normalizado y como parámetro.
    assert.ok(captured[0].values.includes('%martin%'));
    assert.ok(captured[0].values.includes('%nunez%'));
    // Solo personas relacionadas con el club y sin el propio usuario.
    assert.ok(captured[0].values.includes(5));
    assert.ok(captured[0].values.includes(1));
  } finally {
    restore();
  }
});

test('apóstrofes y comas no rompen la búsqueda', async () => {
  const { captured, restore } = mockSearch([{ id: 12, firstName: 'Sean', lastName: "O'Neill" }]);
  try {
    const service = new PlayerInviteSearchService();
    await service.searchByName({ requesterUserId: 1, query: "o'neill,", clubSlug: 'club' });
    assert.ok(captured[0].values.includes('%oneill%'));
  } finally {
    restore();
  }
});

test('con menos de 3 letras no consulta la base', async () => {
  const { captured, restore } = mockSearch([]);
  try {
    const service = new PlayerInviteSearchService();
    const results = await service.searchByName({ requesterUserId: 1, query: 'Jó', clubSlug: 'club' });
    assert.deepEqual(results, []);
    assert.equal(captured.length, 0);
  } finally {
    restore();
  }
});
