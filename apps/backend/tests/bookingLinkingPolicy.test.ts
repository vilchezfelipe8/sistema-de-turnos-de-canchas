import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';

type MemoryClient = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
};

function buildTx(clients: MemoryClient[]) {
  const auditLogs: any[] = [];
  const tx: any = {
    client: {
      findFirst: async ({ where }: any) => {
        const clubId = Number(where?.clubId);
        const matchesUserId = (row: MemoryClient) => {
          if (!Object.prototype.hasOwnProperty.call(where || {}, 'userId')) return true;
          if (where.userId === null) return row.userId === null;
          return Number(row.userId) === Number(where.userId);
        };
        if (where?.userId != null && !where?.dni && !where?.phone && !where?.email) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row)) || null;
        }
        if (where?.dni != null) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && row.dni === String(where.dni)) || null;
        }
        if (where?.phone?.in) {
          const accepted = new Set((where.phone.in || []).map((value: any) => String(value)));
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && accepted.has(String(row.phone || ''))) || null;
        }
        if (where?.email != null) {
          return clients.find((row) => row.clubId === clubId && matchesUserId(row) && row.email === String(where.email)) || null;
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        return clients.find((row) => String(row.id) === String(where?.id)) || null;
      },
      update: async ({ where, data }: any) => {
        const idx = clients.findIndex((row) => String(row.id) === String(where?.id));
        if (idx < 0) throw new Error('Client not found');
        clients[idx] = { ...clients[idx], ...data };
        return clients[idx];
      },
      create: async ({ data }: any) => {
        const created: MemoryClient = {
          id: `c-${clients.length + 1}`,
          clubId: Number(data.clubId),
          userId: data.userId == null ? null : Number(data.userId),
          name: String(data.name || ''),
          phone: data.phone ?? null,
          email: data.email ?? null,
          dni: data.dni ?? null
        };
        clients.push(created);
        return created;
      }
    },
    auditLog: {
      create: async ({ data }: any) => {
        const created = { id: `audit-${auditLogs.length + 1}`, ...data, createdAt: new Date() };
        auditLogs.push(created);
        return created;
      }
    }
  };
  return { tx, clients, auditLogs };
}

function createService() {
  return new BookingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit 1 + 2 — No auto-linking por coincidencia de identidad
// ─────────────────────────────────────────────────────────────────────────────

test('usuario logueado no auto-linkea client existente por DNI', async () => {
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-dni',
      clubId: 10,
      userId: null,
      name: 'Nombre Cliente',
      phone: '+5493511234567',
      email: 'cliente@example.com',
      dni: '30111222'
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 7,
    name: 'Nombre Usuario',
    phone: '',
    email: '',
    dni: '30111222'
  });

  // Nuevo cliente creado — no el existente
  assert.notEqual(resolved.id, 'c-dni');
  // userId siempre null — nunca se auto-linkea
  assert.equal(resolved.userId, null);
  // Los datos del draft se almacenan tal cual (sin nullificación)
  assert.equal(resolved.dni, '30111222');
  // El cliente original permanece intacto
  assert.equal(clients[0].userId, null);
  assert.equal(clients[0].name, 'Nombre Cliente');
  assert.equal(clients[0].email, 'cliente@example.com');
  assert.equal(clients.length, 2);
  assert.equal(auditLogs.some((row) => row.payload?.reason === 'CREATED_CLIENT'), false);
});

test('usuario logueado no auto-linkea client existente por teléfono', async () => {
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-phone',
      clubId: 10,
      userId: null,
      name: 'Cliente Original',
      phone: '+5493511234567',
      email: 'old@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 8,
    name: 'Nombre Nuevo',
    phone: '+54 9 351 123 4567',
    email: '',
    dni: ''
  });

  assert.notEqual(resolved.id, 'c-phone');
  assert.equal(resolved.userId, null);
  // Teléfono normalizado y almacenado como vino (sin nullificación Commit 2)
  assert.equal(resolved.phone, '+5493511234567');
  assert.equal(clients[0].userId, null);
  assert.equal(clients[0].name, 'Cliente Original');
  assert.equal(clients.length, 2);
  assert.equal(auditLogs.some((row) => row.payload?.reason === 'CREATED_CLIENT'), false);
});

test('usuario logueado no auto-linkea client existente por email exacto', async () => {
  // Commit 1: EXACT_EMAIL_MATCH eliminado. Aunque el email coincida exactamente,
  // el sistema crea un nuevo cliente sin userId linkage.
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-email',
      clubId: 10,
      userId: null,
      name: 'Cliente Email',
      phone: '+5493510000000',
      email: 'ada@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 9,
    name: 'Ada',
    phone: '',
    email: 'ada@example.com',
    dni: ''
  });

  // Nuevo cliente creado — no usa el existente por coincidencia de email
  assert.notEqual(resolved.id, 'c-email');
  assert.equal(resolved.userId, null);
  assert.equal(resolved.email, 'ada@example.com');
  // El cliente original permanece intacto
  assert.equal(clients[0].userId, null);
  assert.equal(clients[0].phone, '+5493510000000');
  assert.equal(clients.length, 2);
  // Nunca debe aparecer EXACT_EMAIL_MATCH en auditoría
  assert.equal(auditLogs.some((row) => row.payload?.reason === 'EXACT_EMAIL_MATCH'), false);
});

test('usuario logueado tampoco selecciona candidato único por email/teléfono', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-phone',
      clubId: 10,
      userId: null,
      name: 'Cliente A',
      phone: '+5493511234567',
      email: null,
      dni: null
    },
    {
      id: 'c-email',
      clubId: 10,
      userId: null,
      name: 'Cliente B',
      phone: '+5493519999999',
      email: 'ada@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 7,
    name: 'Ada',
    phone: '+5493511234567',
    email: 'ada@example.com',
    dni: ''
  });

  assert.notEqual(resolved.id, 'c-email');
  assert.notEqual(resolved.id, 'c-phone');
  assert.equal(resolved.userId, null);
  assert.equal(clients.length, 3);
  assert.equal(clients.find((client) => client.id === 'c-phone')?.userId, null);
  assert.equal(clients.find((client) => client.id === 'c-email')?.userId, null);
});

test('usuario logueado nunca auto-linkea por nombre solo', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-name',
      clubId: 10,
      userId: null,
      name: 'Ada Lovelace',
      phone: null,
      email: null,
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 7,
    name: 'Ada Lovelace',
    phone: '',
    email: '',
    dni: ''
  });

  assert.notEqual(resolved.id, 'c-name');
  assert.equal(resolved.userId, null);
  assert.equal(clients.find((client) => client.id === 'c-name')?.userId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Commit 2 — Detección de duplicados: decisión siempre humana
// ─────────────────────────────────────────────────────────────────────────────

test('alta rápida admin con candidato único devuelve CLIENT_POSSIBLE_DUPLICATE con candidates', async () => {
  const { tx } = buildTx([
    {
      id: 'c-phone',
      clubId: 10,
      userId: null,
      name: 'Cliente Original',
      phone: '+5493511234567',
      email: 'old@example.com',
      dni: '30111222'
    }
  ]);
  const service = createService();

  await assert.rejects(() =>
    (service as any).resolveOrCreateClient(tx, {
      clubId: 10,
      userId: null,
      name: 'Cliente con otro mail',
      phone: '+54 9 351 123 4567',
      email: 'nuevo@example.com',
      dni: ''
    }),
    (error: any) => {
      assert.equal(error?.code, 'CLIENT_POSSIBLE_DUPLICATE');
      assert.deepEqual(error?.details?.candidateClientIds, ['c-phone']);
      assert.equal(error?.details?.signals?.phone, '+5493511234567');
      return true;
    }
  );
});

test('alta rápida admin con múltiples candidatos devuelve CLIENT_POSSIBLE_DUPLICATE con todos los candidates', async () => {
  const { tx } = buildTx([
    {
      id: 'c-dni',
      clubId: 10,
      userId: null,
      name: 'Cliente DNI',
      phone: '+5493511111111',
      email: null,
      dni: '30111222'
    },
    {
      id: 'c-email',
      clubId: 10,
      userId: null,
      name: 'Cliente Email',
      phone: '+5493519999999',
      email: 'dup@example.com',
      dni: null
    }
  ]);
  const service = createService();

  await assert.rejects(() =>
    (service as any).resolveOrCreateClient(tx, {
      clubId: 10,
      userId: null,
      name: 'Cliente ambiguo',
      phone: '+54 9 351 111 1111',
      email: 'dup@example.com',
      dni: '30111222'
    }),
    (error: any) => {
      assert.equal(error?.code, 'CLIENT_POSSIBLE_DUPLICATE');
      assert.deepEqual(new Set(error?.details?.candidateClientIds || []), new Set(['c-dni', 'c-email']));
      return true;
    }
  );
});

test('duplicateResolution CREATE_NEW crea cliente nuevo duplicado sin nullificar identidad', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-base',
      clubId: 10,
      userId: null,
      name: 'Cliente Base',
      phone: '+5493511234567',
      email: 'base@example.com',
      dni: '30111222'
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente Duplicado',
    phone: '+54 9 351 123 4567',
    email: 'base@example.com',
    dni: '30111222',
    forceCreateNew: true
  });

  assert.notEqual(resolved.id, 'c-base');
  assert.equal(resolved.userId, null);
  assert.equal(resolved.phone, '+5493511234567');
  assert.equal(resolved.email, 'base@example.com');
  assert.equal(resolved.dni, '30111222');
  assert.equal(clients.length, 2);
});

test('dos clientes del mismo club pueden compartir teléfono cuando hay confirmación CREATE_NEW', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-phone-base',
      clubId: 10,
      userId: null,
      name: 'Cliente Base',
      phone: '+5493511234567',
      email: 'base-a@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente B',
    phone: '+54 9 351 123 4567',
    email: 'base-b@example.com',
    forceCreateNew: true
  });

  assert.notEqual(resolved.id, 'c-phone-base');
  assert.equal(clients.length, 2);
  assert.equal(clients[0].phone, clients[1].phone);
});

test('dos clientes del mismo club pueden compartir email cuando hay confirmación CREATE_NEW', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-email-base',
      clubId: 10,
      userId: null,
      name: 'Cliente Base',
      phone: '+5493511000000',
      email: 'duplicado@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente B',
    phone: '3512000000',
    email: 'duplicado@example.com',
    forceCreateNew: true
  });

  assert.notEqual(resolved.id, 'c-email-base');
  assert.equal(clients.length, 2);
  assert.equal(clients[0].email, clients[1].email);
});

test('dos clientes del mismo club pueden compartir DNI cuando hay confirmación CREATE_NEW', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-dni-base',
      clubId: 10,
      userId: null,
      name: 'Cliente Base',
      phone: '+5493511000000',
      email: 'dni-a@example.com',
      dni: '30111222'
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente B',
    phone: '3512000000',
    email: 'dni-b@example.com',
    dni: '30111222',
    forceCreateNew: true
  });

  assert.notEqual(resolved.id, 'c-dni-base');
  assert.equal(clients.length, 2);
  assert.equal(clients[0].dni, clients[1].dni);
});

test('clientes de otros clubes no se mezclan al buscar duplicados', async () => {
  const { tx, clients } = buildTx([
    {
      id: 'c-other-club',
      clubId: 99,
      userId: null,
      name: 'Cliente Otro Club',
      phone: '+5493511234567',
      email: 'otro@example.com',
      dni: '30111222'
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente Club 10',
    phone: '+54 9 351 123 4567',
    email: 'otro@example.com',
    dni: '30111222'
  });

  assert.equal(resolved.id, 'c-2');
  assert.equal(clients.length, 2);
  assert.equal(clients[1].clubId, 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fase 1.2 — Email opcional en alta rápida admin
// ─────────────────────────────────────────────────────────────────────────────

test('alta rápida admin crea cliente nuevo sin duplicados (con email)', async () => {
  const { tx, clients } = buildTx([]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Cliente Nuevo',
    phone: '+54 9 351 123 4567',
    email: 'nuevo@example.com',
    dni: ''
  });

  assert.equal(resolved.userId, null);
  assert.equal(resolved.name, 'Cliente Nuevo');
  assert.equal(resolved.email, 'nuevo@example.com');
  assert.equal(clients.length, 1);
});

test('alta rápida admin crea cliente sin email — Client.email queda null', async () => {
  // Fase 1.2: email es opcional. name + phone son suficientes.
  const { tx, clients } = buildTx([]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Carlos sin email',
    phone: '+5493511234567',
    email: '',
    dni: ''
  });

  assert.equal(resolved.userId, null);
  assert.equal(resolved.name, 'Carlos sin email');
  assert.equal(resolved.email, null);          // email null, no error
  assert.equal(resolved.phone, '+5493511234567');
  assert.equal(clients.length, 1);
});

test('alta rápida admin sin email — no setea Client.userId aunque User tenga ese email', async () => {
  // Aunque un User en la plataforma tenga el mismo email, no debe linkearse.
  // Commit 1 elimina esa lógica. Este test verifica que no hay regresión.
  const { tx, clients } = buildTx([]);
  const service = createService();

  // userId null → path anónimo (admin creando sin usuario logueado)
  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Ana García',
    phone: '+5493519001234',
    email: '',        // sin email
    dni: ''
  });

  assert.equal(resolved.userId, null);
  assert.equal(resolved.email, null);
  assert.equal(clients.length, 1);
});

test('alta rápida admin sin teléfono falla con mensaje claro', async () => {
  // Phone sigue siendo obligatorio (Fase 1.2 solo libera email).
  const { tx } = buildTx([]);
  const service = createService();

  await assert.rejects(
    () =>
      (service as any).resolveOrCreateClient(tx, {
        clubId: 10,
        userId: null,
        name: 'Cliente sin teléfono',
        phone: '',
        email: 'conEmail@example.com',
        dni: ''
      }),
    /teléfono es obligatorio/i
  );
});

test('alta rápida admin sin nombre falla con mensaje claro', async () => {
  const { tx } = buildTx([]);
  const service = createService();

  await assert.rejects(
    () =>
      (service as any).resolveOrCreateClient(tx, {
        clubId: 10,
        userId: null,
        name: '',
        phone: '+5493511234567',
        email: 'ok@example.com',
        dni: ''
      }),
    /nombre.*obligatorio/i
  );
});

test('duplicado detectado por teléfono aunque no haya email', async () => {
  // Sin email en el request, la detección por teléfono sigue funcionando.
  const { tx } = buildTx([
    {
      id: 'c-existing',
      clubId: 10,
      userId: null,
      name: 'Juan Pérez',
      phone: '+5493511234567',
      email: null,
      dni: null
    }
  ]);
  const service = createService();

  await assert.rejects(
    () =>
      (service as any).resolveOrCreateClient(tx, {
        clubId: 10,
        userId: null,
        name: 'Juan P.',
        phone: '+54 9 351 123 4567',
        email: '',     // sin email
        dni: ''
      }),
    (error: any) => {
      assert.equal(error?.code, 'CLIENT_POSSIBLE_DUPLICATE');
      assert.deepEqual(error?.details?.candidateClientIds, ['c-existing']);
      assert.equal(error?.details?.signals?.email, null);
      return true;
    }
  );
});

test('forceCreateNew sin email crea cliente con email null', async () => {
  // Fase 1.2: CREATE_NEW + sin email → cliente válido con email null.
  const { tx, clients } = buildTx([
    {
      id: 'c-existing',
      clubId: 10,
      userId: null,
      name: 'Juan Pérez',
      phone: '+5493511234567',
      email: null,
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: null,
    name: 'Juan P. (copia)',
    phone: '+54 9 351 123 4567',
    email: '',
    forceCreateNew: true
  });

  assert.notEqual(resolved.id, 'c-existing');
  assert.equal(resolved.email, null);
  assert.equal(resolved.userId, null);
  assert.equal(clients.length, 2);
});

test('usuario logueado con cliente ya linkeado retorna el existente (ALREADY_LINKED)', async () => {
  const { tx, clients, auditLogs } = buildTx([
    {
      id: 'c-linked',
      clubId: 10,
      userId: 42,
      name: 'Usuario Vinculado',
      phone: '+5493511234567',
      email: 'linked@example.com',
      dni: null
    }
  ]);
  const service = createService();

  const resolved = await (service as any).resolveOrCreateClient(tx, {
    clubId: 10,
    userId: 42,
    name: 'Usuario Vinculado',
    phone: '+5493511234567',
    email: 'linked@example.com',
    dni: ''
  });

  assert.equal(resolved.id, 'c-linked');
  assert.equal(clients.length, 1);    // no se creó un nuevo cliente
  assert.ok(auditLogs.some((row) => row.payload?.reason === 'ALREADY_LINKED'));
});
