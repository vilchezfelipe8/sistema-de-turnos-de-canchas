import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubPaymentIntegrationService } from '../src/services/ClubPaymentIntegrationService';
import { prisma } from '../src/prisma';
import { AppError, ErrorCodes } from '../src/errors';

function createService() {
  const service = new ClubPaymentIntegrationService() as any;
  service.mercadoPagoService = {
    assertConfigured: () => {},
    buildAuthorizationUrl: (state: string) => `https://mp.example.test/oauth?state=${encodeURIComponent(state)}`,
    exchangeAuthorizationCode: async () => ({
      access_token: 'access-token-123',
      refresh_token: 'refresh-token-456',
      public_key: 'APP_USR-123',
      user_id: 'mp-user-77',
      expires_in: 3600
    })
  };
  return service as any;
}

async function withPrismaMocks(
  mocks: Partial<Record<string, any>>,
  run: () => Promise<void>
) {
  const original = {
    membershipFindUnique: (prisma.membership as any).findUnique,
    clubPaymentIntegrationFindUnique: (prisma.clubPaymentIntegration as any).findUnique,
    clubPaymentIntegrationFindMany: (prisma.clubPaymentIntegration as any).findMany,
    clubPaymentIntegrationUpdate: (prisma.clubPaymentIntegration as any).update,
    paymentProviderOAuthStateCreate: (prisma.paymentProviderOAuthState as any).create,
    paymentProviderOAuthStateFindUnique: (prisma.paymentProviderOAuthState as any).findUnique,
    auditLogCreate: (prisma.auditLog as any).create,
    transaction: (prisma as any).$transaction
  };

  if (mocks.membershipFindUnique) (prisma.membership as any).findUnique = mocks.membershipFindUnique;
  if (mocks.clubPaymentIntegrationFindUnique) (prisma.clubPaymentIntegration as any).findUnique = mocks.clubPaymentIntegrationFindUnique;
  if (mocks.clubPaymentIntegrationFindMany) (prisma.clubPaymentIntegration as any).findMany = mocks.clubPaymentIntegrationFindMany;
  if (mocks.clubPaymentIntegrationUpdate) (prisma.clubPaymentIntegration as any).update = mocks.clubPaymentIntegrationUpdate;
  if (mocks.paymentProviderOAuthStateCreate) (prisma.paymentProviderOAuthState as any).create = mocks.paymentProviderOAuthStateCreate;
  if (mocks.paymentProviderOAuthStateFindUnique) (prisma.paymentProviderOAuthState as any).findUnique = mocks.paymentProviderOAuthStateFindUnique;
  if (mocks.auditLogCreate) (prisma.auditLog as any).create = mocks.auditLogCreate;
  if (mocks.transaction) (prisma as any).$transaction = mocks.transaction;

  try {
    await run();
  } finally {
    (prisma.membership as any).findUnique = original.membershipFindUnique;
    (prisma.clubPaymentIntegration as any).findUnique = original.clubPaymentIntegrationFindUnique;
    (prisma.clubPaymentIntegration as any).findMany = original.clubPaymentIntegrationFindMany;
    (prisma.clubPaymentIntegration as any).update = original.clubPaymentIntegrationUpdate;
    (prisma.paymentProviderOAuthState as any).create = original.paymentProviderOAuthStateCreate;
    (prisma.paymentProviderOAuthState as any).findUnique = original.paymentProviderOAuthStateFindUnique;
    (prisma.auditLog as any).create = original.auditLogCreate;
    (prisma as any).$transaction = original.transaction;
  }
}

test('staff no puede iniciar la conexión OAuth de Mercado Pago', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      membershipFindUnique: async () => ({ role: 'STAFF' })
    },
    async () => {
      await assert.rejects(
        () => service.startMercadoPagoConnect({ clubId: 10, actorUserId: 77 }),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.MEMBERSHIP_FORBIDDEN
      );
    }
  );
});

test('owner/admin inicia OAuth y genera state expirable ligado al club', async () => {
  const service = createService();
  let createdState: any = null;

  await withPrismaMocks(
    {
      membershipFindUnique: async () => ({ role: 'ADMIN' }),
      clubPaymentIntegrationFindUnique: async () => null,
      paymentProviderOAuthStateCreate: async ({ data }: any) => {
        createdState = data;
        return { ...data, id: 'oauth-state-1' };
      }
    },
    async () => {
      const result = await service.startMercadoPagoConnect({ clubId: 10, actorUserId: 77 });

      assert.match(result.authorizationUrl, /^https:\/\/mp\.example\.test\/oauth\?state=/);
      assert.equal(createdState.clubId, 10);
      assert.equal(createdState.userId, 77);
      assert.equal(createdState.provider, 'MERCADO_PAGO');
      assert.equal(typeof createdState.nonce, 'string');
      assert.ok(createdState.nonce.length > 10);
      assert.ok(createdState.expiresAt instanceof Date);
      assert.equal(createdState.integrationId, null);
    }
  );
});

test('callback con state inválido se bloquea', async () => {
  const service = createService();

  await withPrismaMocks(
    {
      paymentProviderOAuthStateFindUnique: async () => null
    },
    async () => {
      await assert.rejects(
        () => service.handleMercadoPagoCallback({ code: 'oauth-code', state: 'bad-state' }),
        (error: any) => error instanceof AppError && error.code === ErrorCodes.PAYMENT_PROVIDER_STATE_INVALID
      );
    }
  );
});

test('callback válido guarda integración cifrada y audita la conexión', async () => {
  const service = createService();
  let upsertData: any = null;
  let auditCreated = false;

  await withPrismaMocks(
    {
      paymentProviderOAuthStateFindUnique: async () => ({
        id: 'oauth-state-1',
        provider: 'MERCADO_PAGO',
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        clubId: 10,
        userId: 77,
        club: {
          id: 10,
          slug: 'club-norte'
        }
      }),
      transaction: async (callback: any) =>
        callback({
          paymentProviderOAuthState: {
            update: async () => ({}),
            updateMany: async () => ({ count: 1 })
          },
          clubPaymentIntegration: {
            upsert: async (args: any) => {
              upsertData = args;
              return {
                id: 'integration-1',
                externalUserId: 'mp-user-77'
              };
            }
          },
          auditLog: {
            create: async () => {
              auditCreated = true;
              return {};
            }
          }
        })
    },
    async () => {
      const result = await service.handleMercadoPagoCallback({
        code: 'oauth-code',
        state: 'nonce-ok'
      });

      assert.match(result.redirectUrl, /\/admin\/ajustes\?tab=integraciones/);
      assert.equal(upsertData.create.clubId, 10);
      assert.equal(upsertData.create.provider, 'MERCADO_PAGO');
      assert.equal(upsertData.create.status, 'CONNECTED');
      assert.notEqual(upsertData.create.accessTokenEnc, 'access-token-123');
      assert.notEqual(upsertData.create.refreshTokenEnc, 'refresh-token-456');
      assert.equal(upsertData.create.publicKey, 'APP_USR-123');
      assert.equal(upsertData.create.externalUserId, 'mp-user-77');
      assert.equal(auditCreated, true);
    }
  );
});

test('disconnect desactiva la integración sin exponer tokens', async () => {
  const service = createService();
  let auditCreated = false;

  await withPrismaMocks(
    {
      membershipFindUnique: async () => ({ role: 'OWNER' }),
      clubPaymentIntegrationFindUnique: async () => ({
        id: 'integration-1',
        clubId: 10,
        provider: 'MERCADO_PAGO'
      }),
      clubPaymentIntegrationUpdate: async ({ data }: any) => ({
        id: 'integration-1',
        status: data.status,
        connectedBy: {
          id: 77,
          email: 'owner@club.com',
          firstName: 'Ada',
          lastName: 'Owner'
        },
        publicKey: data.publicKey,
        externalUserId: data.externalUserId,
        createdAt: new Date('2026-05-10T10:00:00.000Z'),
        disconnectedAt: data.disconnectedAt,
        updatedAt: new Date('2026-05-16T15:00:00.000Z')
      }),
      auditLogCreate: async () => {
        auditCreated = true;
        return {};
      }
    },
    async () => {
      const result = await service.disconnectMercadoPago({ clubId: 10, actorUserId: 77 });

      assert.equal(result.status, 'DISCONNECTED');
      assert.equal(result.connected, false);
      assert.equal(result.publicKey, null);
      assert.equal(result.externalUserId, null);
      assert.equal(auditCreated, true);
    }
  );
});
