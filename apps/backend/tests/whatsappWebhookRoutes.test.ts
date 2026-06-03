import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';

const withServer = async (fn: (baseUrl: string) => Promise<void>) => {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  assert.ok(address?.port, 'server must expose a port');

  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

describe('WhatsApp webhook routes', () => {
  test('GET verify con token correcto devuelve challenge', async () => {
    const originalToken = process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = 'verify-token-test';

    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-test&hub.challenge=abc123`
        );
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'abc123');
      });
    } finally {
      process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = originalToken;
    }
  });

  test('GET verify con token incorrecto devuelve 403', async () => {
    const originalToken = process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = 'verify-token-test';

    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=abc123`
        );
        assert.equal(response.status, 403);
      });
    } finally {
      process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = originalToken;
    }
  });

  test('GET verify con mode inválido devuelve 400', async () => {
    const originalToken = process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN;
    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = 'verify-token-test';

    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/webhooks/meta/whatsapp?hub.mode=ping&hub.verify_token=verify-token-test&hub.challenge=abc123`
        );
        assert.equal(response.status, 400);
      });
    } finally {
      process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN = originalToken;
    }
  });

  test('POST webhook con flag apagada responde OK controlado', async () => {
    const originalFlag = process.env.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR;
    process.env.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR = 'false';

    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/webhooks/meta/whatsapp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [],
          }),
        });

        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.ignored, true);
        assert.equal(payload.reason, 'FEATURE_DISABLED');
      });
    } finally {
      process.env.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR = originalFlag;
    }
  });
});
