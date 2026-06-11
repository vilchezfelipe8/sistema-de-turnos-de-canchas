import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { OutboxWorker } from '../src/services/OutboxWorker';
import { metricsService } from '../src/services/MetricsService';
import { OUTBOX_TYPES } from '../src/services/OutboxService';

function buildOutboxRow(overrides: Partial<any> = {}) {
  return {
    id: 'outbox-1',
    clubId: 10,
    type: OUTBOX_TYPES.WHATSAPP_SEND_V2,
    aggregateType: 'BOOKING',
    aggregateId: 'booking-1',
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
      templateParams: { bookingId: 'booking-1' }
    },
    dedupeKey: 'wa-v2:booking-1:customer',
    status: 'PENDING',
    attempts: 0,
    availableAt: new Date(),
    claimedAt: null,
    claimedBy: null,
    processedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function withMockedWorkerPrisma(
  run: (state: {
    outboxUpdates: any[];
    deliveryUpdates: any[];
    sentMessages: Array<{ phone: string; message: string }>;
    metrics: Array<{ type: string; result: 'sent' | 'failed' }>;
  }) => Promise<void>
) {
  const original = {
    queryRaw: (prisma as any).$queryRaw,
    outboxMessage: (prisma as any).outboxMessage,
    whatsappDelivery: (prisma as any).whatsappDelivery,
    recordOutbox: (metricsService as any).recordOutbox
  };

  const outboxUpdates: any[] = [];
  const deliveryUpdates: any[] = [];
  const sentMessages: Array<{ phone: string; message: string }> = [];
  const metrics: Array<{ type: string; result: 'sent' | 'failed' }> = [];

  (prisma as any).outboxMessage = {
    update: async ({ data }: any) => {
      outboxUpdates.push(data);
      return data;
    }
  };
  (prisma as any).whatsappDelivery = {
    updateMany: async ({ data }: any) => {
      deliveryUpdates.push(data);
      return { count: 1 };
    }
  };
  (metricsService as any).recordOutbox = (type: string, result: 'sent' | 'failed') => {
    metrics.push({ type, result });
  };

  return run({ outboxUpdates, deliveryUpdates, sentMessages, metrics })
    .finally(() => {
      (prisma as any).$queryRaw = original.queryRaw;
      (prisma as any).outboxMessage = original.outboxMessage;
      (prisma as any).whatsappDelivery = original.whatsappDelivery;
      (metricsService as any).recordOutbox = original.recordOutbox;
    });
}

test('worker con ENABLE_WHATSAPP_SEND_V2=false mantiene stub y marca delivery SKIPPED', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_SEND_V2;
  const originalCloudFlag = process.env.ENABLE_WHATSAPP_CLOUD_API;
  process.env.ENABLE_WHATSAPP_SEND_V2 = 'false';
  process.env.ENABLE_WHATSAPP_CLOUD_API = 'false';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, deliveryUpdates, metrics }) => {
      (prisma as any).$queryRaw = async () => [buildOutboxRow()];
      const worker = new OutboxWorker();

      await worker.processPending(1);

      assert.equal(deliveryUpdates.length, 1);
      assert.equal(deliveryUpdates[0].status, 'SKIPPED');
      assert.equal(deliveryUpdates[0].errorCode, 'FEATURE_DISABLED');
      assert.equal(outboxUpdates.length, 1);
      assert.equal(outboxUpdates[0].status, 'SENT');
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND_V2, result: 'sent' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_SEND_V2;
    else process.env.ENABLE_WHATSAPP_SEND_V2 = originalFlag;
    if (originalCloudFlag == null) delete process.env.ENABLE_WHATSAPP_CLOUD_API;
    else process.env.ENABLE_WHATSAPP_CLOUD_API = originalCloudFlag;
  }
});

test('worker con Cloud API apagada no llama dispatcher y marca SKIPPED controlado', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_SEND_V2;
  const originalCloudFlag = process.env.ENABLE_WHATSAPP_CLOUD_API;
  process.env.ENABLE_WHATSAPP_SEND_V2 = 'true';
  process.env.ENABLE_WHATSAPP_CLOUD_API = 'false';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, deliveryUpdates, metrics }) => {
      (prisma as any).$queryRaw = async () => [buildOutboxRow()];
      const worker: any = new OutboxWorker();
      worker.whatsappSendV2Dispatcher = {
        dispatch: async () => {
          throw new Error('dispatcher no deberia ejecutarse');
        }
      };

      await worker.processPending(1);

      assert.equal(deliveryUpdates.length, 1);
      assert.equal(deliveryUpdates[0].status, 'SKIPPED');
      assert.equal(deliveryUpdates[0].errorCode, 'WHATSAPP_CLOUD_API_DISABLED');
      assert.equal(outboxUpdates[0].status, 'SENT');
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND_V2, result: 'sent' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_SEND_V2;
    else process.env.ENABLE_WHATSAPP_SEND_V2 = originalFlag;
    if (originalCloudFlag == null) delete process.env.ENABLE_WHATSAPP_CLOUD_API;
    else process.env.ENABLE_WHATSAPP_CLOUD_API = originalCloudFlag;
  }
});

test('worker con ambas flags true usa dispatcher y procesa ACCEPTED', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_SEND_V2;
  const originalCloudFlag = process.env.ENABLE_WHATSAPP_CLOUD_API;
  process.env.ENABLE_WHATSAPP_SEND_V2 = 'true';
  process.env.ENABLE_WHATSAPP_CLOUD_API = 'true';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, deliveryUpdates, metrics }) => {
      (prisma as any).$queryRaw = async () => [buildOutboxRow()];
      const worker: any = new OutboxWorker();
      let calls = 0;
      worker.whatsappSendV2Dispatcher = {
        dispatch: async () => {
          calls += 1;
          return {
            ok: true,
            providerMessageId: 'wamid-1',
            outboxLastError: null
          };
        }
      };

      await worker.processPending(1);

      assert.equal(calls, 1);
      assert.equal(deliveryUpdates.length, 0);
      assert.equal(outboxUpdates[0].status, 'SENT');
      assert.equal(outboxUpdates[0].lastError, null);
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND_V2, result: 'sent' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_SEND_V2;
    else process.env.ENABLE_WHATSAPP_SEND_V2 = originalFlag;
    if (originalCloudFlag == null) delete process.env.ENABLE_WHATSAPP_CLOUD_API;
    else process.env.ENABLE_WHATSAPP_CLOUD_API = originalCloudFlag;
  }
});

test('worker con error retryable del dispatcher deja outbox FAILED para retry', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_SEND_V2;
  const originalCloudFlag = process.env.ENABLE_WHATSAPP_CLOUD_API;
  process.env.ENABLE_WHATSAPP_SEND_V2 = 'true';
  process.env.ENABLE_WHATSAPP_CLOUD_API = 'true';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, metrics }) => {
      (prisma as any).$queryRaw = async () => [buildOutboxRow()];
      const worker: any = new OutboxWorker();
      worker.whatsappSendV2Dispatcher = {
        dispatch: async () => ({
          ok: false,
          retryable: true,
          errorCode: 'WHATSAPP_META_RATE_LIMITED',
          errorMessage: 'slow down',
          outboxLastError: 'WHATSAPP_META_RATE_LIMITED: slow down'
        })
      };

      await worker.processPending(1);

      assert.equal(outboxUpdates.length, 1);
      assert.equal(outboxUpdates[0].status, 'FAILED');
      assert.match(String(outboxUpdates[0].lastError), /WHATSAPP_META_RATE_LIMITED/);
      assert.equal(outboxUpdates[0].attempts, 1);
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND_V2, result: 'failed' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_SEND_V2;
    else process.env.ENABLE_WHATSAPP_SEND_V2 = originalFlag;
    if (originalCloudFlag == null) delete process.env.ENABLE_WHATSAPP_CLOUD_API;
    else process.env.ENABLE_WHATSAPP_CLOUD_API = originalCloudFlag;
  }
});

test('worker con error no retryable del dispatcher cierra outbox como procesado', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_SEND_V2;
  const originalCloudFlag = process.env.ENABLE_WHATSAPP_CLOUD_API;
  process.env.ENABLE_WHATSAPP_SEND_V2 = 'true';
  process.env.ENABLE_WHATSAPP_CLOUD_API = 'true';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, metrics }) => {
      (prisma as any).$queryRaw = async () => [buildOutboxRow()];
      const worker: any = new OutboxWorker();
      worker.whatsappSendV2Dispatcher = {
        dispatch: async () => ({
          ok: false,
          retryable: false,
          errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED',
          errorMessage: 'faltante',
          outboxLastError: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED: faltante'
        })
      };

      await worker.processPending(1);

      assert.equal(outboxUpdates.length, 1);
      assert.equal(outboxUpdates[0].status, 'SENT');
      assert.match(String(outboxUpdates[0].lastError), /WHATSAPP_TEMPLATE_NOT_CONFIGURED/);
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND_V2, result: 'sent' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_SEND_V2;
    else process.env.ENABLE_WHATSAPP_SEND_V2 = originalFlag;
    if (originalCloudFlag == null) delete process.env.ENABLE_WHATSAPP_CLOUD_API;
    else process.env.ENABLE_WHATSAPP_CLOUD_API = originalCloudFlag;
  }
});

test('worker legacy WHATSAPP_SEND sigue enviando sin cambios', async () => {
  const originalFlag = process.env.ENABLE_WHATSAPP_WORKER;
  process.env.ENABLE_WHATSAPP_WORKER = 'true';

  try {
    await withMockedWorkerPrisma(async ({ outboxUpdates, sentMessages, metrics }) => {
      (prisma as any).$queryRaw = async () => [
        buildOutboxRow({
          type: OUTBOX_TYPES.WHATSAPP_SEND,
          payload: { phone: '5493511234567', message: 'hola' },
          dedupeKey: 'legacy:1'
        })
      ];

      const worker: any = new OutboxWorker();
      worker.whatsappDelivery = {
        sendMessage: async (phone: string, message: string) => {
          sentMessages.push({ phone, message });
        }
      };

      await worker.processPending(1);

      assert.deepEqual(sentMessages, [{ phone: '5493511234567', message: 'hola' }]);
      assert.equal(outboxUpdates.length, 1);
      assert.equal(outboxUpdates[0].status, 'SENT');
      assert.deepEqual(metrics, [{ type: OUTBOX_TYPES.WHATSAPP_SEND, result: 'sent' }]);
    });
  } finally {
    if (originalFlag == null) delete process.env.ENABLE_WHATSAPP_WORKER;
    else process.env.ENABLE_WHATSAPP_WORKER = originalFlag;
  }
});
