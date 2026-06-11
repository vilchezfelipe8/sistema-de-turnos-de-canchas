import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatsappWebhookProcessor,
  mapMetaStatusToWhatsappDeliveryStatus,
  shouldApplyWhatsappDeliveryStatusTransition,
} from '../src/services/WhatsappWebhookProcessor';

function createProcessorHarness() {
  const deliveries = new Map<string, any>();
  const webhookEvents = new Map<string, any>();
  const webhookEventsById = new Map<string, any>();
  const senders = new Map<string, any>();

  let eventCounter = 0;

  const tx = {
    whatsappWebhookEvent: {
      create: async ({ data }: any) => {
        if (data.providerEventId && webhookEvents.has(data.providerEventId)) {
          const error: any = new Error('duplicate webhook event');
          error.code = 'P2002';
          throw error;
        }

        const id = `event-${++eventCounter}`;
        const created = {
          id,
          ...data,
        };
        webhookEventsById.set(id, created);
        if (data.providerEventId) {
          webhookEvents.set(data.providerEventId, created);
        }
        return created;
      },
      update: async ({ where, data }: any) => {
        const current = webhookEventsById.get(where.id);
        const updated = { ...current, ...data };
        webhookEventsById.set(where.id, updated);
        if (updated.providerEventId) {
          webhookEvents.set(updated.providerEventId, updated);
        }
        return updated;
      },
    },
    whatsappDelivery: {
      findUnique: async ({ where }: any) =>
        deliveries.get(where.providerMessageId) || null,
      update: async ({ where, data }: any) => {
        for (const [key, value] of deliveries.entries()) {
          if (value.id === where.id) {
            const updated = { ...value, ...data };
            deliveries.set(key, updated);
            return updated;
          }
        }
        throw new Error('delivery not found');
      },
    },
    whatsappSender: {
      findFirst: async ({ where }: any) => {
        if (!where.phoneNumberId) {
          return null;
        }
        return senders.get(where.phoneNumberId) || null;
      },
    },
  };

  const db = {
    ...tx,
    $transaction: async (callback: any) => callback(tx),
  };

  const flags = {
    ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: true,
  } as any;

  return {
    processor: new WhatsappWebhookProcessor({ db: db as any, flags }),
    deliveries,
    webhookEvents,
    webhookEventsById,
    senders,
    flags,
  };
}

const buildStatusPayload = (status: string, overrides: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: {
              phone_number_id: 'phone-number-1',
            },
            statuses: [
              {
                id: 'wamid-1',
                status,
                timestamp: '1710000000',
                recipient_id: '5491111111111',
                ...overrides,
              },
            ],
          },
        },
      ],
    },
  ],
});

describe('WhatsappWebhookProcessor helpers', () => {
  test('mapea estados Meta soportados y nunca expone ACCEPTED desde webhook', () => {
    assert.equal(mapMetaStatusToWhatsappDeliveryStatus('sent'), 'SENT');
    assert.equal(mapMetaStatusToWhatsappDeliveryStatus('delivered'), 'DELIVERED');
    assert.equal(mapMetaStatusToWhatsappDeliveryStatus('read'), 'READ');
    assert.equal(mapMetaStatusToWhatsappDeliveryStatus('failed'), 'FAILED');
    assert.equal(mapMetaStatusToWhatsappDeliveryStatus('accepted'), null);
  });

  test('aplica transiciones sin degradar READ o DELIVERED', () => {
    assert.equal(
      shouldApplyWhatsappDeliveryStatusTransition('DELIVERED', 'READ'),
      true
    );
    assert.equal(
      shouldApplyWhatsappDeliveryStatusTransition('READ', 'DELIVERED'),
      false
    );
    assert.equal(
      shouldApplyWhatsappDeliveryStatusTransition('DELIVERED', 'SENT'),
      false
    );
    assert.equal(
      shouldApplyWhatsappDeliveryStatusTransition('READ', 'FAILED'),
      false
    );
  });
});

describe('WhatsappWebhookProcessor processWebhook', () => {
  test('flag apagada responde OK sin procesar', async () => {
    const harness = createProcessorHarness();
    harness.flags.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR = false;

    const result = await harness.processor.processWebhook(buildStatusPayload('sent'));

    assert.equal(result.acknowledged, true);
    assert.equal(result.ignored, true);
    assert.equal(result.persistedEvents, 0);
  });

  test('status sent actualiza delivery a SENT', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'ACCEPTED',
    });
    harness.senders.set('phone-number-1', { id: 'sender-1' });

    const result = await harness.processor.processWebhook(buildStatusPayload('sent'));

    assert.equal(result.updatedDeliveries, 1);
    assert.equal(harness.deliveries.get('wamid-1').status, 'SENT');
    assert.equal(harness.deliveries.get('wamid-1').providerConversationId, null);
  });

  test('status delivered actualiza delivery a DELIVERED', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'SENT',
    });

    const result = await harness.processor.processWebhook(
      buildStatusPayload('delivered', {
        conversation: { id: 'conversation-1' },
      })
    );

    assert.equal(result.updatedDeliveries, 1);
    assert.equal(harness.deliveries.get('wamid-1').status, 'DELIVERED');
    assert.equal(
      harness.deliveries.get('wamid-1').providerConversationId,
      'conversation-1'
    );
  });

  test('status read actualiza delivery a READ', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'DELIVERED',
    });

    const result = await harness.processor.processWebhook(buildStatusPayload('read'));

    assert.equal(result.updatedDeliveries, 1);
    assert.equal(harness.deliveries.get('wamid-1').status, 'READ');
  });

  test('status failed actualiza delivery a FAILED y guarda error', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'SENT',
    });

    const result = await harness.processor.processWebhook(
      buildStatusPayload('failed', {
        errors: [
          {
            code: 131026,
            title: 'Message undeliverable',
            details: 'Recipient is not on WhatsApp',
          },
        ],
      })
    );

    assert.equal(result.updatedDeliveries, 1);
    assert.equal(harness.deliveries.get('wamid-1').status, 'FAILED');
    assert.equal(harness.deliveries.get('wamid-1').errorCode, '131026');
    assert.match(
      String(harness.deliveries.get('wamid-1').errorMessage),
      /Message undeliverable/
    );
  });

  test('evento duplicado no reprocesa dos veces', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'ACCEPTED',
    });

    const first = await harness.processor.processWebhook(buildStatusPayload('sent'));
    const second = await harness.processor.processWebhook(buildStatusPayload('sent'));

    assert.equal(first.updatedDeliveries, 1);
    assert.equal(second.duplicateEvents, 1);
    assert.equal(second.updatedDeliveries, 0);
  });

  test('evento sin delivery queda huérfano pero se persiste', async () => {
    const harness = createProcessorHarness();

    const result = await harness.processor.processWebhook(buildStatusPayload('sent'));

    assert.equal(result.orphanEvents, 1);
    assert.equal(result.updatedDeliveries, 0);
    assert.equal(harness.webhookEventsById.size, 1);
  });

  test('inbound message se guarda como ignored y no crea inbox', async () => {
    const harness = createProcessorHarness();

    const result = await harness.processor.processWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-number-1' },
                messages: [
                  {
                    id: 'wamid-inbound-1',
                    from: '5491111111111',
                    type: 'text',
                    text: { body: 'hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    assert.equal(result.inboundEvents, 1);
    assert.equal(result.updatedDeliveries, 0);
    const persisted = Array.from(harness.webhookEventsById.values())[0];
    assert.equal(persisted.eventType, 'message_inbound_ignored');
  });

  test('evento desconocido se guarda y no falla', async () => {
    const harness = createProcessorHarness();

    const result = await harness.processor.processWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-number-1' },
                contacts: [{ wa_id: '5491111111111' }],
              },
            },
          ],
        },
      ],
    });

    assert.equal(result.unknownEvents, 1);
    const persisted = Array.from(harness.webhookEventsById.values())[0];
    assert.equal(persisted.eventType, 'webhook_event_ignored');
  });

  test('no baja estado de READ a DELIVERED ni de DELIVERED a SENT', async () => {
    const harness = createProcessorHarness();
    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'READ',
    });

    const deliveredResult = await harness.processor.processWebhook(
      buildStatusPayload('delivered')
    );
    assert.equal(deliveredResult.updatedDeliveries, 0);
    assert.equal(harness.deliveries.get('wamid-1').status, 'READ');

    harness.deliveries.set('wamid-1', {
      id: 'delivery-1',
      providerMessageId: 'wamid-1',
      senderId: 'sender-1',
      providerConversationId: null,
      status: 'DELIVERED',
    });

    const sentResult = await harness.processor.processWebhook(
      buildStatusPayload('sent', { timestamp: '1710000001' })
    );
    assert.equal(sentResult.updatedDeliveries, 0);
    assert.equal(harness.deliveries.get('wamid-1').status, 'DELIVERED');
  });
});
