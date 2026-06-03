import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappOperationsService } from '../src/services/WhatsappOperationsService';

test('lista deliveries recientes con filtros y mascara telefono', async () => {
  let receivedWhere: any = null;
  const service = new WhatsappOperationsService({
    db: {
      whatsappDelivery: {
        findMany: async ({ where, take }: any) => {
          receivedWhere = where;
          assert.equal(take, 3);
          return [
            {
              id: 'delivery-2',
              outboxMessageId: 'outbox-2',
              clubId: 7,
              eventType: 'BOOKING_CANCELLED',
              recipientRole: 'CUSTOMER',
              recipientPhone: '5493511112222',
              provider: 'META_CLOUD_API',
              status: 'FAILED',
              senderId: 'sender-1',
              templateMappingId: 'template-2',
              providerMessageId: 'wamid-2',
              errorCode: 'WHATSAPP_META_AUTH_FAILED',
              errorMessage: 'bad auth',
              createdAt: new Date('2026-06-02T10:00:00.000Z'),
              updatedAt: new Date('2026-06-02T10:01:00.000Z')
            },
            {
              id: 'delivery-1',
              outboxMessageId: 'outbox-1',
              clubId: 7,
              eventType: 'BOOKING_CREATED',
              recipientRole: 'CUSTOMER',
              recipientPhone: '5493511234567',
              provider: 'META_CLOUD_API',
              status: 'ACCEPTED',
              senderId: 'sender-1',
              templateMappingId: 'template-1',
              providerMessageId: 'wamid-1',
              errorCode: null,
              errorMessage: null,
              createdAt: new Date('2026-06-02T09:00:00.000Z'),
              updatedAt: new Date('2026-06-02T09:01:00.000Z')
            },
            {
              id: 'delivery-older',
              outboxMessageId: 'outbox-older',
              clubId: 7,
              eventType: 'BOOKING_CREATED',
              recipientRole: 'CUSTOMER',
              recipientPhone: '5493510000000',
              provider: 'META_CLOUD_API',
              status: 'ACCEPTED',
              senderId: 'sender-1',
              templateMappingId: 'template-1',
              providerMessageId: 'wamid-older',
              errorCode: null,
              errorMessage: null,
              createdAt: new Date('2026-06-01T09:00:00.000Z'),
              updatedAt: new Date('2026-06-01T09:01:00.000Z')
            }
          ];
        }
      }
    } as any
  });

  const result = await service.listDeliveries({
    clubId: 7,
    status: 'ACCEPTED',
    eventType: 'BOOKING_CREATED',
    recipientRole: 'CUSTOMER',
    providerMessageId: 'wamid-1',
    limit: 2
  });

  assert.equal(receivedWhere.clubId, 7);
  assert.equal(receivedWhere.status, 'ACCEPTED');
  assert.equal(receivedWhere.eventType, 'BOOKING_CREATED');
  assert.equal(receivedWhere.recipientRole, 'CUSTOMER');
  assert.equal(receivedWhere.providerMessageId, 'wamid-1');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].recipientPhoneMasked, '*********2222');
  assert.equal(result.nextCursor, 'delivery-1');
});

test('detalle de delivery incluye outbox minimo y webhooks asociados sanitizados', async () => {
  const service = new WhatsappOperationsService({
    db: {
      whatsappDelivery: {
        findFirst: async () => ({
          id: 'delivery-1',
          clubId: 7,
          outboxMessageId: 'outbox-1',
          senderId: 'sender-1',
          templateMappingId: 'template-1',
          recipientRole: 'CUSTOMER',
          recipientPhone: '5493511234567',
          eventType: 'BOOKING_CREATED',
          provider: 'META_CLOUD_API',
          providerMessageId: 'wamid-1',
          providerConversationId: null,
          status: 'DELIVERED',
          errorCode: null,
          errorMessage: null,
          rawRequest: {
            to: '5493511234567',
            headers: { Authorization: 'Bearer abc' }
          },
          rawResponse: {
            contacts: [{ wa_id: '5493511234567' }]
          },
          createdAt: new Date('2026-06-02T09:00:00.000Z'),
          updatedAt: new Date('2026-06-02T09:05:00.000Z'),
          outboxMessage: {
            id: 'outbox-1',
            type: 'WHATSAPP_SEND_V2',
            aggregateType: 'BOOKING',
            aggregateId: 'booking-1',
            dedupeKey: 'key-1',
            status: 'SENT',
            attempts: 1,
            processedAt: new Date('2026-06-02T09:01:00.000Z'),
            lastError: null,
            createdAt: new Date('2026-06-02T09:00:00.000Z'),
            updatedAt: new Date('2026-06-02T09:01:00.000Z')
          },
          sender: {
            id: 'sender-1',
            code: 'PIQUE_DEFAULT',
            mode: 'PIQUE_DEFAULT',
            provider: 'META_CLOUD_API',
            displayName: 'Pique',
            status: 'ACTIVE'
          },
          templateMapping: {
            id: 'template-1',
            templateName: 'customer_booking_created_v1',
            languageCode: 'es_AR',
            category: 'UTILITY',
            status: 'ACTIVE',
            version: 1
          },
          webhookEvents: [
            {
              id: 'event-1',
              senderId: 'sender-1',
              deliveryId: 'delivery-1',
              providerMessageId: 'wamid-1',
              providerEventId: 'event-meta-1',
              eventType: 'message_status',
              status: 'DELIVERED',
              processedAt: new Date('2026-06-02T09:03:00.000Z'),
              createdAt: new Date('2026-06-02T09:02:00.000Z'),
              rawPayload: {
                statuses: [{ wa_id: '5493511234567' }],
                headers: { Authorization: 'Bearer abc' }
              }
            }
          ]
        })
      }
    } as any
  });

  const result = await service.getDeliveryDetail({ id: 'delivery-1' });
  assert.ok(result);
  assert.equal(result?.recipientPhoneMasked, '*********4567');
  assert.equal((result?.rawRequest as any).headers.Authorization, '[REDACTED]');
  assert.equal((result?.rawRequest as any).to, '*********4567');
  assert.equal((result?.webhookEvents[0].rawPayloadSummary as any).headers.Authorization, '[REDACTED]');
  assert.equal(result?.outboxMessage.id, 'outbox-1');
});

test('lista webhook events y marca huerfanos sin romper', async () => {
  const service = new WhatsappOperationsService({
    db: {
      whatsappDelivery: {
        findMany: async () => [{ providerMessageId: 'wamid-1' }]
      },
      whatsappWebhookEvent: {
        findMany: async () => [
          {
            id: 'event-1',
            senderId: 'sender-1',
            deliveryId: null,
            providerMessageId: 'wamid-1',
            providerEventId: 'provider-event-1',
            eventType: 'message_status',
            status: 'FAILED',
            processedAt: null,
            createdAt: new Date('2026-06-02T09:00:00.000Z'),
            rawPayload: {
              statuses: [{ wa_id: '5493519998888' }]
            }
          }
        ]
      }
    } as any
  });

  const result = await service.listWebhookEvents({ clubId: 7, limit: 10 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].orphan, true);
  assert.equal((result.items[0].rawPayloadSummary as any).statuses[0].wa_id, '*********8888');
});

test('summary agrega conteos por estado, rol, evento, errores y accepted sin webhook', async () => {
  const service = new WhatsappOperationsService({
    db: {
      whatsappDelivery: {
        count: async ({ where }: any) => {
          if (where.status === 'ACCEPTED') return 2;
          if (where.createdAt?.gte) {
            const diffHours =
              (where.createdAt.lte.getTime() - where.createdAt.gte.getTime()) /
              (60 * 60 * 1000);
            return diffHours <= 24 ? 4 : 9;
          }
          return 0;
        },
        groupBy: async ({ by }: any) => {
          if (by[0] === 'status') {
            return [
              { status: 'ACCEPTED', _count: { _all: 3 } },
              { status: 'DELIVERED', _count: { _all: 5 } }
            ];
          }
          if (by[0] === 'recipientRole') {
            return [
              { recipientRole: 'CUSTOMER', _count: { _all: 6 } },
              { recipientRole: 'CLUB_STAFF', _count: { _all: 2 } }
            ];
          }
          if (by[0] === 'eventType') {
            return [
              { eventType: 'BOOKING_CREATED', _count: { _all: 5 } },
              { eventType: 'BOOKING_CANCELLED', _count: { _all: 3 } }
            ];
          }
          return [
            { errorCode: 'WHATSAPP_META_AUTH_FAILED', _count: { _all: 2 } }
          ];
        },
        findMany: async () => [{ providerMessageId: 'wamid-1' }]
      },
      whatsappWebhookEvent: {
        count: async () => 1
      }
    } as any
  });

  const result = await service.getSummary({ clubId: 7 });
  assert.equal(result.totals.last24h, 4);
  assert.equal(result.totals.last7d, 9);
  assert.equal(result.countsByStatus.ACCEPTED, 3);
  assert.equal(result.countsByRecipientRole.CUSTOMER, 6);
  assert.equal(result.countsByEventType.BOOKING_CREATED, 5);
  assert.equal(result.topErrors[0].errorCode, 'WHATSAPP_META_AUTH_FAILED');
  assert.equal(result.orphanWebhookCount, 1);
  assert.equal(result.acceptedWithoutWebhookCount, 2);
});

test('preflight expone flags y checks sin secretos', async () => {
  const service = new WhatsappOperationsService({
    preflightService: {
      run: async () => ({
        ok: true,
        status: 'WARN',
        checks: [
          {
            key: 'flags.dryRunWins',
            severity: 'WARNING',
            ok: true,
            message: 'dry-run gana'
          }
        ]
      })
    } as any
  });

  const result = await service.getPreflight();
  assert.equal(result.ok, true);
  assert.equal(typeof result.flags.ENABLE_WHATSAPP_SEND_V2, 'boolean');
  assert.equal('token' in result, false);
});

