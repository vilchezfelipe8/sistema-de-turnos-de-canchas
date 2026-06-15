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

describe('WhatsApp admin routes smoke', () => {
  test('deliveries admin esta registrado y protegido', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/whatsapp/deliveries`);
      assert.equal(response.status, 401);
    });
  });

  test('preflight admin esta registrado y protegido', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/whatsapp/preflight`);
      assert.equal(response.status, 401);
    });
  });
});
