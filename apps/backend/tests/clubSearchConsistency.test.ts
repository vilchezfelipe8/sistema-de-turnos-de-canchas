import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubService } from '../src/services/ClubService';
import { prisma } from '../src/prisma';

function createService() {
  return new ClubService({} as any, {} as any);
}

test('getClients devuelve todos los clients distintos del club aunque compartan teléfono o email', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;

  (prisma as any).client.findMany = async () => ([
    {
      id: 'client-hijo',
      name: 'Juan Hijo',
      phone: '+5493571359791',
      email: 'familia@pique.test',
      dni: '',
      isProfessor: false,
      userId: null,
      createdAt: new Date('2026-05-19T21:02:15.856Z')
    },
    {
      id: 'client-padre',
      name: 'Juan Padre',
      phone: '+5493571359791',
      email: 'familia@pique.test',
      dni: '',
      isProfessor: false,
      userId: null,
      createdAt: new Date('2026-05-19T20:02:15.856Z')
    }
  ]);

  try {
    const results = await service.getClients(5, 'familia');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.id),
      ['client-hijo', 'client-padre']
    );
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
  }
});

test('searchParticipants devuelve todos los clients distintos que matcheen aunque compartan teléfono o email', async () => {
  const service = createService();
  const originalSearchPeople = (service as any).personService.searchPeople;

  (service as any).personService.searchPeople = async () => ([
    {
      personKey: 'client:client-hijo',
      kind: 'clubClient',
      clientId: 'client-hijo',
      userId: null,
      displayName: 'Juan Hijo',
      email: 'familia@pique.test',
      phone: '+5493571359791',
      dni: null,
      badges: ['Cliente del club']
    },
    {
      personKey: 'client:client-padre',
      kind: 'clubClient',
      clientId: 'client-padre',
      userId: null,
      displayName: 'Juan Padre',
      email: 'familia@pique.test',
      phone: '+5493571359791',
      dni: null,
      badges: ['Cliente del club']
    }
  ]);

  try {
    const results = await service.searchParticipants(5, 'familia');
    assert.equal(results.length, 2);
    assert.ok(results.every((row) => row.sourceType === 'clubClient'));
  } finally {
    (service as any).personService.searchPeople = originalSearchPeople;
  }
});

test('searchParticipants colapsa Client + User vinculados explícitamente en una sola opción clubClient', async () => {
  const service = createService();
  const originalSearchPeople = (service as any).personService.searchPeople;

  (service as any).personService.searchPeople = async () => ([
    {
      personKey: 'linked:client:client-1:user:7',
      kind: 'linked',
      clientId: 'client-1',
      userId: 7,
      displayName: 'Ana Pérez',
      email: 'ana@example.com',
      phone: '+5493512223333',
      dni: null,
      badges: ['Cliente del club', 'Usuario Pique']
    }
  ]);

  try {
    const results = await service.searchParticipants(5, 'ana');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.sourceType, 'clubClient');
    assert.equal(results[0]?.userId, 7);
  } finally {
    (service as any).personService.searchPeople = originalSearchPeople;
  }
});

test('searchParticipants no colapsa client y user no vinculados solo por compartir email o teléfono', async () => {
  const service = createService();
  const originalSearchPeople = (service as any).personService.searchPeople;

  (service as any).personService.searchPeople = async () => ([
    {
      personKey: 'client:client-1',
      kind: 'clubClient',
      clientId: 'client-1',
      userId: null,
      displayName: 'Juan Cliente',
      email: 'juan@pique.test',
      phone: '+5493510000001',
      dni: null,
      badges: ['Cliente del club']
    },
    {
      personKey: 'user:44',
      kind: 'systemUser',
      clientId: null,
      userId: 44,
      displayName: 'Juan Usuario',
      email: 'juan@pique.test',
      phone: '+5493510000001',
      dni: null,
      badges: ['Usuario Pique']
    }
  ]);

  try {
    const results = await service.searchParticipants(5, 'juan@pique.test');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.sourceType),
      ['clubClient', 'systemUser']
    );
  } finally {
    (service as any).personService.searchPeople = originalSearchPeople;
  }
});
