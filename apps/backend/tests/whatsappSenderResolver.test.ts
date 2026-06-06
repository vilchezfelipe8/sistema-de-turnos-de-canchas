import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import {
  PIQUE_DEFAULT_SENDER_CODE,
  WhatsappSenderResolver
} from '../src/services/WhatsappSenderResolver';

function withMockedSenderRepo(
  rows: any[],
  run: () => Promise<void>
) {
  const original = (prisma as any).whatsappSender;

  (prisma as any).whatsappSender = {
    findFirst: async ({ where }: any) =>
      rows.find((row) => {
        if (where?.code && row.code !== where.code) return false;
        if (where?.mode && row.mode !== where.mode) return false;
        if (where?.provider && row.provider !== where.provider) return false;
        if (where?.status && row.status !== where.status) return false;
        if (Object.prototype.hasOwnProperty.call(where || {}, 'clubId')) {
          if (row.clubId !== where.clubId) return false;
        }
        return true;
      }) || null
  };

  return run().finally(() => {
    (prisma as any).whatsappSender = original;
  });
}

test('resuelve sender CLUB_OWN activo para el club antes de PIQUE_DEFAULT', async () => {
  const resolver = new WhatsappSenderResolver();

  await withMockedSenderRepo([
    {
      id: 'sender-club',
      code: 'CLUB_10',
      mode: 'CLUB_OWN',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'club-phone',
      wabaId: 'club-waba',
      tokenSecretRef: 'secret://club',
      status: 'ACTIVE',
      clubId: 10
    },
    {
      id: 'sender-1',
      code: PIQUE_DEFAULT_SENDER_CODE,
      mode: 'PIQUE_DEFAULT',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'phone-number-id',
      wabaId: 'waba-id',
      tokenSecretRef: 'secret://pique-default',
      status: 'ACTIVE',
      clubId: null
    },
  ], async () => {
    const result = await resolver.resolve({
      clubId: 10,
      recipientRole: 'CUSTOMER',
      eventType: 'BOOKING_CREATED'
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sender.code, 'CLUB_10');
      assert.equal(result.sender.mode, 'CLUB_OWN');
      assert.equal(result.sender.tokenSecretRef, 'secret://club');
    }
  });
});

test('resuelve PIQUE_DEFAULT si no hay CLUB_OWN activo para el club', async () => {
  const resolver = new WhatsappSenderResolver();

  await withMockedSenderRepo([
    {
      id: 'sender-1',
      code: PIQUE_DEFAULT_SENDER_CODE,
      mode: 'PIQUE_DEFAULT',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'phone-number-id',
      wabaId: 'waba-id',
      tokenSecretRef: 'secret://pique-default',
      status: 'ACTIVE',
      clubId: null
    },
    {
      id: 'sender-club-disabled',
      code: 'CLUB_10',
      mode: 'CLUB_OWN',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'club-phone',
      wabaId: 'club-waba',
      tokenSecretRef: 'secret://club',
      status: 'DISABLED',
      clubId: 10
    }
  ], async () => {
    const result = await resolver.resolve({
      clubId: 10,
      recipientRole: 'CUSTOMER',
      eventType: 'BOOKING_CREATED'
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sender.code, PIQUE_DEFAULT_SENDER_CODE);
      assert.equal(result.sender.mode, 'PIQUE_DEFAULT');
      assert.equal(result.sender.tokenSecretRef, 'secret://pique-default');
    }
  });
});

test('falla si PIQUE_DEFAULT no existe', async () => {
  const resolver = new WhatsappSenderResolver();

  await withMockedSenderRepo([], async () => {
    const result = await resolver.resolve({
      clubId: 10,
      recipientRole: 'CUSTOMER',
      eventType: 'BOOKING_CREATED'
    });

    assert.deepEqual(result, {
      ok: false,
      errorCode: 'WHATSAPP_SENDER_NOT_CONFIGURED',
      errorMessage:
        'PIQUE_DEFAULT no está configurado en DB. Debe bootstrapearse antes del cutover.'
    });
  });
});

test('falla si PIQUE_DEFAULT está disabled', async () => {
  const resolver = new WhatsappSenderResolver();

  await withMockedSenderRepo([
    {
      id: 'sender-1',
      code: PIQUE_DEFAULT_SENDER_CODE,
      mode: 'PIQUE_DEFAULT',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'phone-number-id',
      wabaId: 'waba-id',
      tokenSecretRef: 'secret://pique-default',
      status: 'DISABLED',
      clubId: null
    }
  ], async () => {
    const result = await resolver.resolve({
      clubId: 10,
      recipientRole: 'CLUB_STAFF',
      eventType: 'BOOKING_CREATED'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_SENDER_DISABLED');
    }
  });
});

test('falla si existe CLUB_OWN pero no hay sender activo utilizable para el club ni PIQUE_DEFAULT', async () => {
  const resolver = new WhatsappSenderResolver();

  await withMockedSenderRepo([
    {
      id: 'sender-club',
      code: 'CLUB_10',
      mode: 'CLUB_OWN',
      provider: 'META_CLOUD_API',
      phoneNumberId: 'club-phone',
      wabaId: 'club-waba',
      tokenSecretRef: 'secret://club',
      status: 'DISABLED',
      clubId: 10
    }
  ], async () => {
    const result = await resolver.resolve({
      clubId: 10,
      recipientRole: 'CUSTOMER',
      eventType: 'BOOKING_CREATED'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_SENDER_NOT_CONFIGURED');
    }
  });
});
