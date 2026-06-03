import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { WhatsappTemplateResolver } from '../src/services/WhatsappTemplateResolver';

function withMockedTemplateRepo(rows: any[], run: () => Promise<void>) {
  const original = (prisma as any).whatsappTemplateMapping;

  (prisma as any).whatsappTemplateMapping = {
    findFirst: async ({ where }: any) =>
      rows.find((row) => {
        if (where?.senderId && row.senderId !== where.senderId) return false;
        if (where?.eventType && row.eventType !== where.eventType) return false;
        if (where?.recipientRole && row.recipientRole !== where.recipientRole) return false;
        if (where?.languageCode && row.languageCode !== where.languageCode) return false;
        if (where?.status && row.status !== where.status) return false;
        if (where?.NOT?.recipientRole && row.recipientRole === where.NOT.recipientRole) return false;
        return true;
      }) || null
  };

  return run().finally(() => {
    (prisma as any).whatsappTemplateMapping = original;
  });
}

test('resuelve template activo para CUSTOMER + BOOKING_CREATED', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-1',
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      languageCode: 'es_AR',
      templateName: 'customer_booking_created_v1',
      category: 'UTILITY',
      status: 'ACTIVE'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER'
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.template.templateName, 'customer_booking_created_v1');
      assert.equal(result.template.languageCode, 'es_AR');
    }
  });
});

test('resuelve template activo para CLUB_STAFF + BOOKING_CREATED', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-2',
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CLUB_STAFF',
      languageCode: 'es_AR',
      templateName: 'staff_booking_created_v1',
      category: 'UTILITY',
      status: 'ACTIVE'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CLUB_STAFF'
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.template.templateName, 'staff_booking_created_v1');
    }
  });
});

test('no mezcla templates customer/staff', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-1',
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      languageCode: 'es_AR',
      templateName: 'customer_booking_created_v1',
      category: 'UTILITY',
      status: 'ACTIVE'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CLUB_STAFF'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_TEMPLATE_INVALID_ROLE');
    }
  });
});

test('falla si template no existe', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CANCELLED',
      recipientRole: 'CUSTOMER'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_TEMPLATE_NOT_CONFIGURED');
    }
  });
});

test('falla si template está disabled o rejected', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-1',
      senderId: 'sender-1',
      eventType: 'BOOKING_CANCELLED',
      recipientRole: 'CUSTOMER',
      languageCode: 'es_AR',
      templateName: 'customer_booking_cancelled_v1',
      category: 'UTILITY',
      status: 'DISABLED'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CANCELLED',
      recipientRole: 'CUSTOMER'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_TEMPLATE_DISABLED');
    }
  });
});

test('respeta languageCode', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-1',
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      languageCode: 'pt_BR',
      templateName: 'customer_booking_created_v1_pt',
      category: 'UTILITY',
      status: 'ACTIVE'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      languageCode: 'pt_BR'
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.template.languageCode, 'pt_BR');
    }
  });
});

test('soporta BOOKING_PENDING_WARNING para customer', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([
    {
      id: 'tpl-1',
      senderId: 'sender-1',
      eventType: 'BOOKING_PENDING_WARNING',
      recipientRole: 'CUSTOMER',
      languageCode: 'es_AR',
      templateName: 'customer_booking_pending_warning_v1',
      category: 'UTILITY',
      status: 'ACTIVE'
    }
  ], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_PENDING_WARNING',
      recipientRole: 'CUSTOMER'
    });

    assert.equal(result.ok, true);
  });
});

test('staff pending warning queda opcional y falla limpio si no existe', async () => {
  const resolver = new WhatsappTemplateResolver();

  await withMockedTemplateRepo([], async () => {
    const result = await resolver.resolve({
      senderId: 'sender-1',
      eventType: 'BOOKING_PENDING_WARNING',
      recipientRole: 'CLUB_STAFF'
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, 'WHATSAPP_TEMPLATE_NOT_CONFIGURED');
    }
  });
});
