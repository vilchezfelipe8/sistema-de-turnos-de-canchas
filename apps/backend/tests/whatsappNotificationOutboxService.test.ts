import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { WhatsappNotificationOutboxService } from '../src/services/WhatsappNotificationOutboxService';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function withMockedPrisma(
  run: (state: { outboxMessages: any[]; deliveries: any[] }) => Promise<void>
) {
  const original = {
    transaction: (prisma as any).$transaction,
    outboxMessage: (prisma as any).outboxMessage,
    whatsappDelivery: (prisma as any).whatsappDelivery
  };

  const outboxMessages: any[] = [];
  const deliveries: any[] = [];

  const outboxRepo = {
    findUnique: async ({ where }: any) =>
      outboxMessages.find((row) => row.dedupeKey === where?.dedupeKey) || null,
    create: async ({ data }: any) => {
      const created = {
        id: `outbox-${outboxMessages.length + 1}`,
        ...data,
        status: 'PENDING',
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        whatsappDelivery: null
      };
      outboxMessages.push(created);
      return created;
    }
  };

  const deliveryRepo = {
    create: async ({ data }: any) => {
      const created = {
        id: `delivery-${deliveries.length + 1}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      deliveries.push(created);
      const outbox = outboxMessages.find((row) => row.id === data.outboxMessageId);
      if (outbox) outbox.whatsappDelivery = created;
      return created;
    }
  };

  (prisma as any).outboxMessage = outboxRepo;
  (prisma as any).whatsappDelivery = deliveryRepo;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      outboxMessage: outboxRepo,
      whatsappDelivery: deliveryRepo
    });

  return run({ outboxMessages, deliveries }).finally(() => {
    (prisma as any).$transaction = original.transaction;
    (prisma as any).outboxMessage = original.outboxMessage;
    (prisma as any).whatsappDelivery = original.whatsappDelivery;
  });
}

test('enqueueSendV2 crea OutboxMessage WHATSAPP_SEND_V2 y WhatsappDelivery QUEUED', async () => {
  const service = new WhatsappNotificationOutboxService();

  await withMockedPrisma(async ({ outboxMessages, deliveries }) => {
    const result = await service.enqueueSendV2({
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      clubId: 10,
      recipientPhone: '+54 9 351 123-4567',
      referenceType: 'BOOKING',
      referenceId: 'booking-1',
      dedupeKey: 'wa-v2:booking-1:customer',
      templateParams: { bookingId: 'booking-1' }
    });

    assert.equal(result.created, true);
    assert.equal(outboxMessages.length, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(outboxMessages[0].type, OUTBOX_TYPES.WHATSAPP_SEND_V2);
    assert.equal(outboxMessages[0].payload.version, 2);
    assert.equal(outboxMessages[0].payload.channel, 'WHATSAPP');
    assert.equal(deliveries[0].status, 'QUEUED');
    assert.equal(deliveries[0].provider, 'META_CLOUD_API');
  });
});

test('enqueueSendV2 respeta dedupeKey y no duplica', async () => {
  const service = new WhatsappNotificationOutboxService();

  await withMockedPrisma(async ({ outboxMessages, deliveries }) => {
    const first = await service.enqueueSendV2({
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      clubId: 10,
      recipientPhone: '5493511234567',
      referenceType: 'BOOKING',
      referenceId: 'booking-2',
      dedupeKey: 'wa-v2:booking-2:customer',
      templateParams: { bookingId: 'booking-2' }
    });

    const second = await service.enqueueSendV2({
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      clubId: 10,
      recipientPhone: '5493511234567',
      referenceType: 'BOOKING',
      referenceId: 'booking-2',
      dedupeKey: 'wa-v2:booking-2:customer',
      templateParams: { bookingId: 'booking-2' }
    });

    assert.equal(outboxMessages.length, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(first.outboxMessage.id, second.outboxMessage.id);
    assert.equal(second.created, false);
  });
});
