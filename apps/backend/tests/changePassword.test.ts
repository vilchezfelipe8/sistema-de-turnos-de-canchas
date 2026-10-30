import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { AuthController } from '../src/controllers/AuthController';
import { prisma } from '../src/prisma';

test('cambio de contraseña exige autenticación y contraseña actual, y revoca sesiones al guardar', async (t) => {
  const originalFind = prisma.user.findUnique;
  const originalTransaction = prisma.$transaction;
  const password = await bcrypt.hash('Anterior2026!', 4);
  let updates = 0;
  let revoked = 0;
  let updateCount = 1;
  let savedHash = '';
  let active = true;
  (prisma.user as any).findUnique = async () => ({ id: 42, password, accountStatus: active ? 'ACTIVE' : 'DISABLED' });
  (prisma as any).$transaction = async (callback: any) => callback({
    user: { updateMany: async ({ where, data }: any) => {
      assert.equal(where.id, 42);
      assert.equal(where.password, password);
      updates++;
      savedHash = data.password;
      return { count: updateCount };
    } },
    authSession: { updateMany: async ({ where, data }: any) => {
      assert.equal(where.userId, 42);
      assert.equal(data.status, 'REVOKED');
      revoked++;
      return { count: 2 };
    } }
  });
  const controller = new AuthController();
  (controller as any).auditUserAccountEvent = async () => {};
  (controller as any).issueAuthPayload = async (id: number) => ({ user: { id } });
  const request = async (body: any, user: any = { userId: 42 }) => {
    const res: any = { statusCode: 200, body: null,
      status(code: number) { this.statusCode = code; return this; },
      json(value: any) { this.body = value; return this; }
    };
    await controller.changePassword({ body, user } as any, res);
    return res;
  };
  try {
    await t.test('sin sesión', async () => {
      assert.equal((await request({}, null)).statusCode, 401);
      assert.equal(updates, 0);
    });
    await t.test('actual incorrecta', async () => {
      assert.equal((await request({ currentPassword: 'Equivocada', newPassword: 'Nueva2026!' })).statusCode, 400);
      assert.equal(updates, 0);
    });
    await t.test('rechaza nueva corta, igual o superior al límite de bcrypt', async () => {
      for (const newPassword of ['corta', 'Anterior2026!', 'é'.repeat(40)]) {
        assert.equal((await request({ currentPassword: 'Anterior2026!', newPassword })).statusCode, 400);
      }
      assert.equal(updates, 0);
    });
    await t.test('cuenta deshabilitada', async () => {
      active = false;
      assert.equal((await request({ currentPassword: 'Anterior2026!', newPassword: 'Nueva2026!' })).statusCode, 401);
      active = true;
      assert.equal(updates, 0);
    });
    await t.test('guarda hash y renueva sesión', async () => {
      const res = await request({ currentPassword: 'Anterior2026!', newPassword: 'Nueva2026!' });
      assert.equal(res.statusCode, 200);
      assert.equal(await bcrypt.compare('Nueva2026!', savedHash), true);
      assert.equal(res.body.user.id, 42);
      assert.equal(revoked, 1);
    });
    await t.test('cambio simultáneo no sobrescribe contraseña ni revoca sesiones', async () => {
      updateCount = 0;
      assert.equal((await request({ currentPassword: 'Anterior2026!', newPassword: 'Nueva2026!' })).statusCode, 400);
      assert.equal(revoked, 1);
    });
  } finally {
    (prisma.user as any).findUnique = originalFind;
    (prisma as any).$transaction = originalTransaction;
  }
});
