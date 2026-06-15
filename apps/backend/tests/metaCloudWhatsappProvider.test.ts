import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { MetaCloudWhatsappProvider } from '../src/services/MetaCloudWhatsappProvider';
import { type SendTemplateMessageInput } from '../src/types/notifications';

type SenderRow = {
  id: string;
  provider: 'META_CLOUD_API';
  status: 'ACTIVE' | 'DISABLED';
  phoneNumberId: string | null;
  tokenSecretRef: string | null;
};

function withMockedSender(
  sender: SenderRow | null,
  run: () => Promise<void>
) {
  const original = (prisma as any).whatsappSender;

  (prisma as any).whatsappSender = {
    findUnique: async ({ where }: any) => {
      if (!sender) return null;
      return sender.id === where?.id ? sender : null;
    }
  };

  return run().finally(() => {
    (prisma as any).whatsappSender = original;
  });
}

function buildInput(overrides: Partial<SendTemplateMessageInput> = {}): SendTemplateMessageInput {
  return {
    senderId: 'sender-1',
    templateName: 'customer_booking_created_v1',
    languageCode: 'es_AR',
    toPhone: '5493511234567',
    recipientRole: 'CUSTOMER',
    eventType: 'BOOKING_CREATED',
    params: {
      client_name: 'Juan',
      club_name: 'Pique Club'
    },
    outboxMessageId: 'outbox-1',
    ...overrides
  };
}

test('construye body template correcto', async () => {
  const provider = new MetaCloudWhatsappProvider(async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.to, '5493511234567');
    assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'customer_booking_created_v1');
    assert.equal(body.template.language.code, 'es_AR');
    assert.deepEqual(body.template.components[0].parameters, [
      { type: 'text', text: 'Juan' },
      { type: 'text', text: 'Pique Club' }
    ]);
    return new Response(
      JSON.stringify({ messages: [{ id: 'wamid.123' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(
        buildInput({ templateParameterOrder: ['client_name', 'club_name'] })
      );
      assert.equal(result.status, 'ACCEPTED');
      assert.equal(result.providerMessageId, 'wamid.123');
    }
  );
});

test('usa Graph API version configurada', async () => {
  const previousVersion = process.env.WHATSAPP_META_GRAPH_API_VERSION;
  process.env.WHATSAPP_META_GRAPH_API_VERSION = 'v99.0';

  try {
    const provider = new MetaCloudWhatsappProvider(async (url) => {
      assert.match(String(url), /\/v99\.0\/phone-number-id\/messages$/);
      return new Response(
        JSON.stringify({ messages: [{ id: 'wamid.abc' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await withMockedSender(
      {
        id: 'sender-1',
        provider: 'META_CLOUD_API',
        status: 'ACTIVE',
        phoneNumberId: 'phone-number-id',
        tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
      },
      async () => {
        process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
        const result = await provider.sendTemplateMessage(buildInput());
        assert.equal(result.status, 'ACCEPTED');
      }
    );
  } finally {
    if (previousVersion == null) delete process.env.WHATSAPP_META_GRAPH_API_VERSION;
    else process.env.WHATSAPP_META_GRAPH_API_VERSION = previousVersion;
  }
});

test('falla si falta token', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    throw new Error('should not call fetch');
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      delete process.env.WHATSAPP_META_ACCESS_TOKEN;
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_TOKEN_NOT_CONFIGURED');
      assert.equal(String(result.errorMessage).includes('secret-token'), false);
    }
  );
});

test('falla si falta phoneNumberId', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    throw new Error('should not call fetch');
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: null,
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_PHONE_NUMBER_ID_MISSING');
    }
  );
});

test('401 o 403 => auth failed no retryable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    return new Response(
      JSON.stringify({ error: { message: 'invalid token' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_AUTH_FAILED');
      assert.equal(result.retryable, false);
    }
  );
});

test('429 => rate limited retryable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    return new Response(
      JSON.stringify({ error: { message: 'rate limit' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_RATE_LIMITED');
      assert.equal(result.retryable, true);
    }
  );
});

test('5xx => temporary retryable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    return new Response(
      JSON.stringify({ error: { message: 'server error' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_TEMPORARY_ERROR');
      assert.equal(result.retryable, true);
    }
  );
});

test('400 payload inválido => permanent no retryable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    return new Response(
      JSON.stringify({ error: { message: 'invalid template' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_PERMANENT_ERROR');
      assert.equal(result.retryable, false);
    }
  );
});

test('network error => temporary retryable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    throw new Error('socket hang up');
  });

  await withMockedSender(
    {
      id: 'sender-1',
      provider: 'META_CLOUD_API',
      status: 'ACTIVE',
      phoneNumberId: 'phone-number-id',
      tokenSecretRef: 'WHATSAPP_META_ACCESS_TOKEN'
    },
    async () => {
      process.env.WHATSAPP_META_ACCESS_TOKEN = 'secret-token';
      const result = await provider.sendTemplateMessage(buildInput());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'WHATSAPP_META_TEMPORARY_ERROR');
      assert.equal(result.retryable, true);
    }
  );
});

test('params sin orden explícito usan orden alfabético estable', async () => {
  const provider = new MetaCloudWhatsappProvider(async () => {
    throw new Error('should not fetch');
  });

  const parameters = provider.buildTemplateParameters(
    buildInput({
      params: {
        zeta: '2',
        alpha: '1'
      }
    })
  );

  assert.deepEqual(parameters, [
    { type: 'text', text: '1' },
    { type: 'text', text: '2' }
  ]);
});
