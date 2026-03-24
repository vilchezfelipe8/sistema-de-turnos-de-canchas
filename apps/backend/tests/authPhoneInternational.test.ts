import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthController } from '../src/controllers/AuthController';
import { prisma } from '../src/prisma';

const buildRes = () => {
  const response: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
  return response;
};

test('registro acepta countryCode + local y persiste teléfono internacional canónico', async () => {
  const controller = new AuthController();
  let createdPayload: any = null;

  const originalFindUnique = (prisma as any).user.findUnique;
  const originalCreate = (prisma as any).user.create;

  (prisma as any).user.findUnique = async () => null;
  (prisma as any).user.create = async ({ data }: any) => {
    createdPayload = data;
    return { id: 77, ...data };
  };

  try {
    const req: any = {
      body: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: '123456',
        phoneCountryCode: '+1',
        phoneNumberLocal: '2025550123',
        role: 'MEMBER'
      }
    };
    const res = buildRes();

    await controller.register(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(createdPayload.phoneNumber, '+12025550123');
  } finally {
    (prisma as any).user.findUnique = originalFindUnique;
    (prisma as any).user.create = originalCreate;
  }
});
