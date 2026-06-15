import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappSendV2Dispatcher } from '../src/services/WhatsappSendV2Dispatcher';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function buildOutboxMessage(overrides: Partial<any> = {}) {
  const payloadOverrides = overrides.payload || {};
  const { payload: _ignoredPayload, ...restOverrides } = overrides;
  return {
    id: 'outbox-1',
    clubId: 10,
    type: OUTBOX_TYPES.WHATSAPP_SEND_V2,
    aggregateType: 'BOOKING',
    aggregateId: 'booking-1',
    dedupeKey: 'wa-v2:booking-1:customer',
    payload: {
      version: 2,
      channel: 'WHATSAPP',
      eventType: 'BOOKING_CREATED',
      recipientRole: 'CUSTOMER',
      clubId: 10,
      recipientPhone: '5493511234567',
      referenceType: 'BOOKING',
      referenceId: 'booking-1',
      dedupeKey: 'wa-v2:booking-1:customer',
      templateParams: {
        clubName: 'Pique Club',
        date: '2026-06-10',
      },
      ...payloadOverrides,
    },
    ...restOverrides,
  };
}

function createDbHarness() {
  let deliveryCounter = 0;
  const deliveriesById = new Map<string, any>();
  const deliveriesByOutboxId = new Map<string, any>();

  const db = {
    whatsappDelivery: {
      findUnique: async ({ where }: any) => {
        if (where.outboxMessageId) {
          return deliveriesByOutboxId.get(where.outboxMessageId) || null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const record = {
          id: `delivery-${++deliveryCounter}`,
          ...data,
          senderId: data.senderId ?? null,
          templateMappingId: data.templateMappingId ?? null,
          providerMessageId: data.providerMessageId ?? null,
          rawRequest: data.rawRequest ?? null,
          rawResponse: data.rawResponse ?? null,
          errorCode: data.errorCode ?? null,
          errorMessage: data.errorMessage ?? null,
          providerConversationId: data.providerConversationId ?? null,
        };
        deliveriesById.set(record.id, record);
        deliveriesByOutboxId.set(record.outboxMessageId, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const current = deliveriesById.get(where.id);
        const updated = { ...current, ...data };
        deliveriesById.set(where.id, updated);
        deliveriesByOutboxId.set(updated.outboxMessageId, updated);
        return updated;
      },
    },
  };

  return {
    db,
    deliveriesById,
    deliveriesByOutboxId,
  };
}

function withEnv(name: string, value: string | undefined, run: () => Promise<void>) {
  const previous = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;

  return run().finally(() => {
    if (previous == null) delete process.env[name];
    else process.env[name] = previous;
  });
}

test('dispatcher exitoso deja delivery en ACCEPTED con providerMessageId', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();
  let providerCalls = 0;

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: true,
        sender: {
          id: 'sender-1',
          code: 'PIQUE_DEFAULT',
          mode: 'PIQUE_DEFAULT',
          provider: 'META_CLOUD_API',
          phoneNumberId: 'phone-number-1',
          wabaId: 'waba-1',
          tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
          status: 'ACTIVE',
        },
      }),
    } as any,
    templateResolver: {
      resolve: async () => ({
        ok: true,
        template: {
          id: 'template-1',
          templateName: 'customer_booking_created_v1',
          languageCode: 'es_AR',
          category: 'UTILITY',
          status: 'ACTIVE',
        },
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: (input: any) => ({
        to: input.toPhone,
        template: { name: input.templateName },
      }),
      sendTemplateMessage: async () => {
        providerCalls += 1;
        return {
          status: 'ACCEPTED',
          providerMessageId: 'wamid-accepted-1',
          rawResponse: { messages: [{ id: 'wamid-accepted-1' }] },
        };
      },
    } as any,
  });

  const result = await dispatcher.dispatch(buildOutboxMessage());

  assert.equal(result.ok, true);
  assert.equal(providerCalls, 1);
  const delivery = deliveriesByOutboxId.get('outbox-1');
  assert.equal(delivery.status, 'ACCEPTED');
  assert.equal(delivery.providerMessageId, 'wamid-accepted-1');
  assert.equal(delivery.senderId, 'sender-1');
  assert.equal(delivery.templateMappingId, 'template-1');
});

test('falta sender deja delivery en FAILED y no llama provider', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();
  let providerCalls = 0;

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: false,
        errorCode: 'WHATSAPP_SENDER_NOT_CONFIGURED',
        errorMessage: 'PIQUE_DEFAULT faltante',
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: () => ({}),
      sendTemplateMessage: async () => {
        providerCalls += 1;
        return { status: 'ACCEPTED' };
      },
    } as any,
  });

  const result = await dispatcher.dispatch(buildOutboxMessage());

  assert.equal(result.ok, false);
  assert.equal(providerCalls, 0);
  const delivery = deliveriesByOutboxId.get('outbox-1');
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.errorCode, 'WHATSAPP_SENDER_NOT_CONFIGURED');
});

test('falta template deja delivery en FAILED y no llama provider', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();
  let providerCalls = 0;

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: true,
        sender: {
          id: 'sender-1',
          code: 'PIQUE_DEFAULT',
          mode: 'PIQUE_DEFAULT',
          provider: 'META_CLOUD_API',
          phoneNumberId: 'phone-number-1',
          wabaId: 'waba-1',
          tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
          status: 'ACTIVE',
        },
      }),
    } as any,
    templateResolver: {
      resolve: async () => ({
        ok: false,
        errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED',
        errorMessage: 'template faltante',
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: () => ({}),
      sendTemplateMessage: async () => {
        providerCalls += 1;
        return { status: 'ACCEPTED' };
      },
    } as any,
  });

  const result = await dispatcher.dispatch(buildOutboxMessage());

  assert.equal(result.ok, false);
  assert.equal(providerCalls, 0);
  const delivery = deliveriesByOutboxId.get('outbox-1');
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.errorCode, 'WHATSAPP_TEMPLATE_NOT_CONFIGURED');
});

test('provider permanent error deja delivery en FAILED sin retry', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: true,
        sender: {
          id: 'sender-1',
          code: 'PIQUE_DEFAULT',
          mode: 'PIQUE_DEFAULT',
          provider: 'META_CLOUD_API',
          phoneNumberId: 'phone-number-1',
          wabaId: 'waba-1',
          tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
          status: 'ACTIVE',
        },
      }),
    } as any,
    templateResolver: {
      resolve: async () => ({
        ok: true,
        template: {
          id: 'template-1',
          templateName: 'customer_booking_created_v1',
          languageCode: 'es_AR',
          category: 'UTILITY',
          status: 'ACTIVE',
        },
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: () => ({ sample: true }),
      sendTemplateMessage: async () => ({
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_AUTH_FAILED',
        errorMessage: 'bad auth',
        retryable: false,
        rawResponse: { error: { message: 'bad auth' } },
      }),
    } as any,
  });

  const result = await dispatcher.dispatch(buildOutboxMessage());

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  const delivery = deliveriesByOutboxId.get('outbox-1');
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.errorCode, 'WHATSAPP_META_AUTH_FAILED');
});

test('provider retryable deja delivery en FAILED pero marca retryable', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: true,
        sender: {
          id: 'sender-1',
          code: 'PIQUE_DEFAULT',
          mode: 'PIQUE_DEFAULT',
          provider: 'META_CLOUD_API',
          phoneNumberId: 'phone-number-1',
          wabaId: 'waba-1',
          tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
          status: 'ACTIVE',
        },
      }),
    } as any,
    templateResolver: {
      resolve: async () => ({
        ok: true,
        template: {
          id: 'template-1',
          templateName: 'customer_booking_created_v1',
          languageCode: 'es_AR',
          category: 'UTILITY',
          status: 'ACTIVE',
        },
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: () => ({ sample: true }),
      sendTemplateMessage: async () => ({
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_RATE_LIMITED',
        errorMessage: 'slow down',
        retryable: true,
        rawResponse: { error: { message: 'slow down' } },
      }),
    } as any,
  });

  const result = await dispatcher.dispatch(buildOutboxMessage());

  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  const delivery = deliveriesByOutboxId.get('outbox-1');
  assert.equal(delivery.status, 'FAILED');
  assert.equal(delivery.errorCode, 'WHATSAPP_META_RATE_LIMITED');
});

test('usa templateParameterOrder si viene en payload', async () => {
  const { db } = createDbHarness();
  let capturedInput: any = null;

  const dispatcher = new WhatsappSendV2Dispatcher({
    db: db as any,
    senderResolver: {
      resolve: async () => ({
        ok: true,
        sender: {
          id: 'sender-1',
          code: 'PIQUE_DEFAULT',
          mode: 'PIQUE_DEFAULT',
          provider: 'META_CLOUD_API',
          phoneNumberId: 'phone-number-1',
          wabaId: 'waba-1',
          tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
          status: 'ACTIVE',
        },
      }),
    } as any,
    templateResolver: {
      resolve: async () => ({
        ok: true,
        template: {
          id: 'template-1',
          templateName: 'customer_booking_created_v1',
          languageCode: 'es_AR',
          category: 'UTILITY',
          status: 'ACTIVE',
        },
      }),
    } as any,
    provider: {
      buildTemplateRequestBody: (input: any) => {
        capturedInput = input;
        return { sample: true };
      },
      sendTemplateMessage: async () => ({
        status: 'ACCEPTED',
        providerMessageId: 'wamid-accepted-1',
      }),
    } as any,
  });

  await dispatcher.dispatch(
    buildOutboxMessage({
      payload: {
        templateParameterOrder: ['date', 'clubName'],
      },
    })
  );

  assert.deepEqual(capturedInput.templateParameterOrder, ['date', 'clubName']);
});

test('dry-run true no llama provider y deja delivery en SKIPPED sin ACCEPTED', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();
  let providerCalls = 0;

  await withEnv('ENABLE_WHATSAPP_V2_DRY_RUN', 'true', async () => {
    const dispatcher = new WhatsappSendV2Dispatcher({
      db: db as any,
      senderResolver: {
        resolve: async () => ({
          ok: true,
          sender: {
            id: 'sender-1',
            code: 'PIQUE_DEFAULT',
            mode: 'PIQUE_DEFAULT',
            provider: 'META_CLOUD_API',
            phoneNumberId: 'phone-number-1',
            wabaId: 'waba-1',
            tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
            status: 'ACTIVE',
          },
        }),
      } as any,
      templateResolver: {
        resolve: async () => ({
          ok: true,
          template: {
            id: 'template-1',
            templateName: 'customer_booking_created_v1',
            languageCode: 'es_AR',
            category: 'UTILITY',
            status: 'ACTIVE',
          },
        }),
      } as any,
      provider: {
        buildTemplateRequestBody: () => ({ sample: true }),
        sendTemplateMessage: async () => {
          providerCalls += 1;
          return { status: 'ACCEPTED', providerMessageId: 'wamid-accepted-1' };
        },
      } as any,
    });

    const result = await dispatcher.dispatch(buildOutboxMessage());
    const delivery = deliveriesByOutboxId.get('outbox-1');

    assert.equal(result.ok, true);
    assert.equal(result.providerMessageId, null);
    assert.equal(providerCalls, 0);
    assert.equal(delivery.status, 'SKIPPED');
    assert.equal(delivery.errorCode, 'WHATSAPP_V2_DRY_RUN');
  });
});

test('allowlist vacia permite continuar al provider', async () => {
  const { db } = createDbHarness();
  let providerCalls = 0;

  await withEnv('WHATSAPP_META_RECIPIENT_ALLOWLIST', '', async () => {
    const dispatcher = new WhatsappSendV2Dispatcher({
      db: db as any,
      senderResolver: {
        resolve: async () => ({
          ok: true,
          sender: {
            id: 'sender-1',
            code: 'PIQUE_DEFAULT',
            mode: 'PIQUE_DEFAULT',
            provider: 'META_CLOUD_API',
            phoneNumberId: 'phone-number-1',
            wabaId: 'waba-1',
            tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
            status: 'ACTIVE',
          },
        }),
      } as any,
      templateResolver: {
        resolve: async () => ({
          ok: true,
          template: {
            id: 'template-1',
            templateName: 'customer_booking_created_v1',
            languageCode: 'es_AR',
            category: 'UTILITY',
            status: 'ACTIVE',
          },
        }),
      } as any,
      provider: {
        buildTemplateRequestBody: () => ({ sample: true }),
        sendTemplateMessage: async () => {
          providerCalls += 1;
          return { status: 'ACCEPTED', providerMessageId: 'wamid-accepted-1' };
        },
      } as any,
    });

    const result = await dispatcher.dispatch(buildOutboxMessage());
    assert.equal(result.ok, true);
    assert.equal(providerCalls, 1);
  });
});

test('allowlist configurada bloquea destinatario no incluido y no llama provider', async () => {
  const { db, deliveriesByOutboxId } = createDbHarness();
  let providerCalls = 0;

  await withEnv('WHATSAPP_META_RECIPIENT_ALLOWLIST', '5493510000000', async () => {
    const dispatcher = new WhatsappSendV2Dispatcher({
      db: db as any,
      senderResolver: {
        resolve: async () => ({
          ok: true,
          sender: {
            id: 'sender-1',
            code: 'PIQUE_DEFAULT',
            mode: 'PIQUE_DEFAULT',
            provider: 'META_CLOUD_API',
            phoneNumberId: 'phone-number-1',
            wabaId: 'waba-1',
            tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
            status: 'ACTIVE',
          },
        }),
      } as any,
      templateResolver: {
        resolve: async () => ({
          ok: true,
          template: {
            id: 'template-1',
            templateName: 'customer_booking_created_v1',
            languageCode: 'es_AR',
            category: 'UTILITY',
            status: 'ACTIVE',
          },
        }),
      } as any,
      provider: {
        buildTemplateRequestBody: () => ({ sample: true }),
        sendTemplateMessage: async () => {
          providerCalls += 1;
          return { status: 'ACCEPTED', providerMessageId: 'wamid-accepted-1' };
        },
      } as any,
    });

    const result = await dispatcher.dispatch(buildOutboxMessage());
    const delivery = deliveriesByOutboxId.get('outbox-1');

    assert.equal(result.ok, true);
    assert.equal(result.providerMessageId, null);
    assert.equal(providerCalls, 0);
    assert.equal(delivery.status, 'SKIPPED');
    assert.equal(delivery.errorCode, 'WHATSAPP_RECIPIENT_NOT_ALLOWLISTED');
  });
});

test('allowlist configurada permite destinatario incluido', async () => {
  const { db } = createDbHarness();
  let providerCalls = 0;

  await withEnv('WHATSAPP_META_RECIPIENT_ALLOWLIST', '5493511234567', async () => {
    const dispatcher = new WhatsappSendV2Dispatcher({
      db: db as any,
      senderResolver: {
        resolve: async () => ({
          ok: true,
          sender: {
            id: 'sender-1',
            code: 'PIQUE_DEFAULT',
            mode: 'PIQUE_DEFAULT',
            provider: 'META_CLOUD_API',
            phoneNumberId: 'phone-number-1',
            wabaId: 'waba-1',
            tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
            status: 'ACTIVE',
          },
        }),
      } as any,
      templateResolver: {
        resolve: async () => ({
          ok: true,
          template: {
            id: 'template-1',
            templateName: 'customer_booking_created_v1',
            languageCode: 'es_AR',
            category: 'UTILITY',
            status: 'ACTIVE',
          },
        }),
      } as any,
      provider: {
        buildTemplateRequestBody: () => ({ sample: true }),
        sendTemplateMessage: async () => {
          providerCalls += 1;
          return { status: 'ACCEPTED', providerMessageId: 'wamid-accepted-1' };
        },
      } as any,
    });

    const result = await dispatcher.dispatch(buildOutboxMessage());
    assert.equal(result.ok, true);
    assert.equal(providerCalls, 1);
  });
});
