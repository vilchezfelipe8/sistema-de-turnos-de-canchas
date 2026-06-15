import test from 'node:test';
import assert from 'node:assert/strict';
import { requireClubMembership, requireGlobalRole, requireTenantRole } from '../src/middleware/RoleMiddleware';

type Middleware = (req: any, res: any, next: () => void) => unknown;

const buildRes = () => {
  const payload: any = { statusCode: 200, body: null };
  const res: any = {
    req: {},
    status(code: number) {
      payload.statusCode = code;
      return res;
    },
    json(data: any) {
      payload.body = data;
      return res;
    }
  };
  return { res, payload };
};

const runMiddleware = async (middleware: Middleware, req: any) => {
  const { res, payload } = buildRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { payload, nextCalled };
};

test('requireTenantRole no acepta rol global ADMIN sin rol tenant permitido', async () => {
  const middleware = requireTenantRole('ADMIN');
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 9, role: 'ADMIN' },
    membershipRole: 'CUSTOMER',
    clubId: 15
  });

  assert.equal(nextCalled, false);
  assert.equal(payload.statusCode, 403);
  assert.equal(payload.body?.code, 'AUTH_FORBIDDEN');
});

test('requireTenantRole acepta OWNER cuando la ruta pide ADMIN', async () => {
  const middleware = requireTenantRole('ADMIN');
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 9, role: 'MEMBER' },
    membershipRole: 'OWNER',
    clubId: 20
  });

  assert.equal(nextCalled, true);
  assert.equal(payload.statusCode, 200);
});

test('requireTenantRole acepta STAFF en rutas operativas', async () => {
  const middleware = requireTenantRole(['ADMIN', 'STAFF']);
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 9, role: 'MEMBER' },
    membershipRole: 'STAFF',
    clubId: 33
  });

  assert.equal(nextCalled, true);
  assert.equal(payload.statusCode, 200);
});

test('requireTenantRole bloquea CUSTOMER en rutas operativas', async () => {
  const middleware = requireTenantRole(['ADMIN', 'STAFF']);
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 9, role: 'MEMBER' },
    membershipRole: 'CUSTOMER',
    clubId: 33
  });

  assert.equal(nextCalled, false);
  assert.equal(payload.statusCode, 403);
  assert.equal(payload.body?.code, 'AUTH_FORBIDDEN');
});

test('requireTenantRole bloquea STAFF en rutas sensibles de ADMIN', async () => {
  const middleware = requireTenantRole('ADMIN');
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 9, role: 'MEMBER' },
    membershipRole: 'STAFF',
    clubId: 33
  });

  assert.equal(nextCalled, false);
  assert.equal(payload.statusCode, 403);
  assert.equal(payload.body?.code, 'AUTH_FORBIDDEN');
});

test('requireGlobalRole valida solo rol global', async () => {
  const middleware = requireGlobalRole('ADMIN');
  const { payload, nextCalled } = await runMiddleware(middleware, {
    user: { userId: 77, role: 'ADMIN' },
    membershipRole: 'CUSTOMER'
  });

  assert.equal(nextCalled, true);
  assert.equal(payload.statusCode, 200);
});

test('requireClubMembership bloquea cuando no hay contexto tenant', async () => {
  const { payload, nextCalled } = await runMiddleware(requireClubMembership, {
    user: { userId: 99, role: 'ADMIN' },
    membershipRole: '',
    clubId: null
  });

  assert.equal(nextCalled, false);
  assert.equal(payload.statusCode, 403);
  assert.equal(payload.body?.code, 'AUTH_FORBIDDEN');
});

test('requireClubMembership permite seguir con membresia y club activo', async () => {
  const { payload, nextCalled } = await runMiddleware(requireClubMembership, {
    user: { userId: 99, role: 'MEMBER' },
    membershipRole: 'STAFF',
    clubId: 44
  });

  assert.equal(nextCalled, true);
  assert.equal(payload.statusCode, 200);
});
