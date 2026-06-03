import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappV2PreflightService } from '../src/services/WhatsappV2PreflightService';

function createDb(options?: {
  sender?: any | null;
  templates?: any[];
}) {
  const sender = options?.sender ?? null;
  const templates = options?.templates ?? [];

  return {
    whatsappSender: {
      findFirst: async () => sender
    },
    whatsappTemplateMapping: {
      findFirst: async ({ where }: any) =>
        templates.find(
          (template) =>
            template.senderId === where.senderId &&
            template.eventType === where.eventType &&
            template.recipientRole === where.recipientRole &&
            template.languageCode === where.languageCode &&
            template.status === where.status
        ) || null
    }
  };
}

function buildActiveSender(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sender-1',
    status: 'ACTIVE',
    provider: 'META_CLOUD_API',
    phoneNumberId: 'phone-id',
    wabaId: 'waba-id',
    tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN',
    ...overrides
  };
}

function buildTemplates() {
  return [
    { senderId: 'sender-1', eventType: 'BOOKING_CREATED', recipientRole: 'CUSTOMER', languageCode: 'es_AR', status: 'ACTIVE', templateName: 'customer_booking_created_v1' },
    { senderId: 'sender-1', eventType: 'BOOKING_CANCELLED', recipientRole: 'CUSTOMER', languageCode: 'es_AR', status: 'ACTIVE', templateName: 'customer_booking_cancelled_v1' },
    { senderId: 'sender-1', eventType: 'BOOKING_PENDING_WARNING', recipientRole: 'CUSTOMER', languageCode: 'es_AR', status: 'ACTIVE', templateName: 'customer_booking_pending_warning_v1' },
    { senderId: 'sender-1', eventType: 'BOOKING_CREATED', recipientRole: 'CLUB_STAFF', languageCode: 'es_AR', status: 'ACTIVE', templateName: 'staff_booking_created_v1' },
    { senderId: 'sender-1', eventType: 'BOOKING_CANCELLED', recipientRole: 'CLUB_STAFF', languageCode: 'es_AR', status: 'ACTIVE', templateName: 'staff_booking_cancelled_v1' }
  ];
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

test('preflight OK con PIQUE_DEFAULT activo, templates activos y envs presentes', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'OK');
  });
});

test('preflight falla si falta PIQUE_DEFAULT', async () => {
  const service = new WhatsappV2PreflightService({
    db: createDb({
      sender: null,
      templates: []
    }) as any,
    flags: {
      ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
      ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
      ENABLE_WHATSAPP_SEND_V2: false,
      ENABLE_WHATSAPP_CLOUD_API: false,
      ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
      ENABLE_WHATSAPP_V2_DRY_RUN: false
    },
    metaConfig: {
      webhookVerifyToken: ''
    }
  });

  const result = await service.run();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.checks.some((check) => check.key === 'sender.exists' && check.ok === false), true);
});

test('preflight falla si sender está disabled', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender({ status: 'DISABLED' }),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.key === 'sender.active' && check.ok === false), true);
  });
});

test('preflight falla si falta token env', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', undefined, async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.key === 'sender.tokenEnv' && check.ok === false), true);
  });
});

test('preflight falla si falta template customer requerido', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const templates = buildTemplates().filter((template) => template.templateName !== 'customer_booking_pending_warning_v1');
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.key === 'template.customer_booking_pending_warning_v1' && check.ok === false), true);
  });
});

test('preflight falla si falta template staff requerido', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const templates = buildTemplates().filter((template) => template.templateName !== 'staff_booking_cancelled_v1');
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.key === 'template.staff_booking_cancelled_v1' && check.ok === false), true);
  });
});

test('preflight falla si webhook processor activo sin verify token', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: true,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, false);
    assert.equal(result.checks.some((check) => check.key === 'webhook.verifyToken' && check.ok === false), true);
  });
});

test('preflight marca warning si customer o staff V2 está activo pero send V2 apagado', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: true,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: true,
        ENABLE_WHATSAPP_SEND_V2: false,
        ENABLE_WHATSAPP_CLOUD_API: false,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: false
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'WARN');
    assert.equal(result.checks.some((check) => check.key === 'flags.customerWithoutSendV2'), true);
    assert.equal(result.checks.some((check) => check.key === 'flags.staffWithoutSendV2'), true);
  });
});

test('preflight marca warning si send V2 está activo pero cloud api apagado y si dry-run gana', async () => {
  await withEnv('WHATSAPP_META_ACCESS_TOKEN', 'secret-token', async () => {
    const service = new WhatsappV2PreflightService({
      db: createDb({
        sender: buildActiveSender(),
        templates: buildTemplates()
      }) as any,
      flags: {
        ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: false,
        ENABLE_WHATSAPP_STAFF_EVENTS_V2: false,
        ENABLE_WHATSAPP_SEND_V2: true,
        ENABLE_WHATSAPP_CLOUD_API: true,
        ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: false,
        ENABLE_WHATSAPP_V2_DRY_RUN: true
      },
      metaConfig: {
        webhookVerifyToken: ''
      }
    });

    const result = await service.run();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'WARN');
    assert.equal(result.checks.some((check) => check.key === 'flags.dryRunWins'), true);
  });
});
