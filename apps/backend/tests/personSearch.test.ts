import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { PersonService } from '../src/services/PersonService';

const createService = () => new PersonService();

test('PersonSearch muestra dos clients distintos aunque compartan teléfono', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  (prisma as any).client.findMany = async () => ([
    {
      id: 'client-hijo',
      clubId: 5,
      userId: null,
      name: 'Juan Hijo',
      phone: '+5493511111111',
      email: 'familia@example.com',
      dni: null,
      createdAt: new Date('2026-05-20T20:00:00.000Z')
    },
    {
      id: 'client-padre',
      clubId: 5,
      userId: null,
      name: 'Juan Padre',
      phone: '+5493511111111',
      email: 'familia@example.com',
      dni: null,
      createdAt: new Date('2026-05-20T19:00:00.000Z')
    }
  ]);
  (prisma as any).user.findMany = async () => [];

  try {
    const results = await service.searchPeople(5, '3511111111');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.clientId),
      ['client-hijo', 'client-padre']
    );
    assert.ok(results.every((row) => row.kind === 'clubClient'));
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch muestra dos users distintos si una búsqueda exacta por email los permite', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => [];
  (prisma as any).user.findMany = async () => {
    userCall += 1;
    if (userCall === 1) return [];
    return [
      {
        id: 77,
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@pique.test',
        phoneNumber: '+5493511231234',
        dni: null
      },
      {
        id: 78,
        firstName: 'Ana 2',
        lastName: 'Pérez',
        email: 'ana@pique.test',
        phoneNumber: '+5493511231234',
        dni: null
      }
    ];
  };

  try {
    const results = await service.searchPeople(5, 'ana@pique.test');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.userId).sort((left, right) => Number(left) - Number(right)),
      [77, 78]
    );
    assert.ok(results.every((row) => row.kind === 'systemUser'));
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch muestra dos users distintos si una búsqueda exacta por teléfono los permite', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => [];
  (prisma as any).user.findMany = async () => {
    userCall += 1;
    if (userCall === 1) return [];
    return [
      {
        id: 90,
        firstName: 'Padre',
        lastName: 'Familia',
        email: 'padre@pique.test',
        phoneNumber: '+5493517778888',
        dni: null
      },
      {
        id: 91,
        firstName: 'Hijo',
        lastName: 'Familia',
        email: 'hijo@pique.test',
        phoneNumber: '+54 9 351 777 8888',
        dni: null
      }
    ];
  };

  try {
    const results = await service.searchPeople(5, '3517778888');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.userId).sort((left, right) => Number(left) - Number(right)),
      [90, 91]
    );
    assert.ok(results.every((row) => row.kind === 'systemUser'));
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch no muestra users globales por nombre ambiguo si no están relacionados con el club', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => [];
  (prisma as any).user.findMany = async () => {
    userCall += 1;
    if (userCall === 1) return [];
    return [];
  };

  try {
    const results = await service.searchPeople(5, 'juan');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.kind, 'newClientSuggestion');
    assert.equal(results[0]?.displayName, 'juan');
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch devuelve una sola fila linked cuando client y user están vinculados explícitamente', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => ([
    {
      id: 'client-linked',
      clubId: 5,
      userId: 9,
      name: 'Lucía Díaz',
      phone: '+5493515554444',
      email: 'lucia@pique.test',
      dni: null,
      createdAt: new Date('2026-05-20T19:00:00.000Z')
    }
  ]);
  (prisma as any).user.findMany = async ({ where }: any) => {
    userCall += 1;
    if (where?.id?.in) {
      return [
        {
          id: 9,
          firstName: 'Lucía',
          lastName: 'Díaz',
          email: 'lucia@pique.test',
          phoneNumber: '+5493515554444',
          dni: null
        }
      ];
    }
    if (userCall === 1) return [];
    return [];
  };

  try {
    const results = await service.searchPeople(5, 'lucía');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.kind, 'linked');
    assert.equal(results[0]?.clientId, 'client-linked');
    assert.equal(results[0]?.userId, 9);
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch no colapsa client y user no vinculados solo por compartir email o teléfono', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => ([
    {
      id: 'client-alone',
      clubId: 5,
      userId: null,
      name: 'Juan Cliente',
      phone: '+5493510000001',
      email: 'juan@pique.test',
      dni: null,
      createdAt: new Date('2026-05-20T19:00:00.000Z')
    }
  ]);
  (prisma as any).user.findMany = async () => {
    userCall += 1;
    if (userCall === 1) {
      return [
        {
          id: 55,
          firstName: 'Juan',
          lastName: 'Usuario',
          email: 'juan@pique.test',
          phoneNumber: '+5493510000001',
          dni: null
        }
      ];
    }
    return [
      {
        id: 55,
        firstName: 'Juan',
        lastName: 'Usuario',
        email: 'juan@pique.test',
        phoneNumber: '+5493510000001',
        dni: null
      }
    ];
  };

  try {
    const results = await service.searchPeople(5, 'juan@pique.test');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((row) => row.kind),
      ['clubClient', 'systemUser']
    );
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch no repite el mismo client si un join interno lo devuelve dos veces', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  (prisma as any).client.findMany = async () => ([
    {
      id: 'client-1',
      clubId: 5,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-20T20:00:00.000Z')
    },
    {
      id: 'client-1',
      clubId: 5,
      userId: null,
      name: 'Admin Las Tejas',
      phone: '+5493571359791',
      email: 'admin@lastejas.com',
      dni: null,
      createdAt: new Date('2026-05-20T20:00:00.000Z')
    }
  ]);
  (prisma as any).user.findMany = async () => [];

  try {
    const results = await service.searchPeople(5, 'admin');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.clientId, 'client-1');
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch no repite el mismo user si aparece por relación al club y por búsqueda exacta', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  let userCall = 0;
  (prisma as any).client.findMany = async () => [];
  (prisma as any).user.findMany = async () => {
    userCall += 1;
    return [
      {
        id: 77,
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@pique.test',
        phoneNumber: '+5493511231234',
        dni: null
      }
    ];
  };

  try {
    const results = await service.searchPeople(5, 'ana@pique.test');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.userId, 77);
    assert.equal(results[0]?.kind, 'systemUser');
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});

test('PersonSearch ofrece crear nuevo cliente cuando no hay coincidencias', async () => {
  const service = createService();
  const originalClientFindMany = (prisma as any).client.findMany;
  const originalUserFindMany = (prisma as any).user.findMany;

  (prisma as any).client.findMany = async () => [];
  (prisma as any).user.findMany = async () => [];

  try {
    const results = await service.searchPeople(5, 'Persona Nueva');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.kind, 'newClientSuggestion');
    assert.equal(results[0]?.displayName, 'Persona Nueva');
  } finally {
    (prisma as any).client.findMany = originalClientFindMany;
    (prisma as any).user.findMany = originalUserFindMany;
  }
});
