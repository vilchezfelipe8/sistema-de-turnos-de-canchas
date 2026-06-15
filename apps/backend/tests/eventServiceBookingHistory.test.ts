import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { EventService } from '../src/services/EventService';

function withMockedPrisma(overrides: Record<string, any>, run: () => Promise<void>) {
  const original: Record<string, any> = {};
  Object.keys(overrides).forEach((key) => {
    original[key] = (prisma as any)[key];
    (prisma as any)[key] = overrides[key];
  });
  return run().finally(() => {
    Object.keys(overrides).forEach((key) => {
      (prisma as any)[key] = original[key];
    });
  });
}

test('EventService.createEvent crea solo el evento genérico y no escribe BookingHistoryEntry', async () => {
  const createdEvents: any[] = [];
  let createdHistory = 0;
  const service = new EventService();

  await withMockedPrisma({
    event: {
      create: async ({ data }: any) => {
        createdEvents.push(data);
        return {
          id: 'evt-1',
          ...data,
          createdAt: new Date('2026-05-21T20:00:00.000Z'),
        };
      },
    },
    bookingHistoryEntry: {
      create: async () => {
        createdHistory += 1;
        return { id: 'bhe-1' };
      },
    },
  }, async () => {
    await service.createEvent(7, 'BOOKING_CONFIRMED', {
      bookingId: 44,
      actorUserId: 18,
      source: 'MANUAL',
    });
  });

  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].clubId, 7);
  assert.equal(createdEvents[0].type, 'BOOKING_CONFIRMED');
  assert.equal(createdHistory, 0);
});

test('EventService.createEvent no depende de bookingId ni accountId para persistirse', async () => {
  const createdEvents: any[] = [];
  const service = new EventService();

  await withMockedPrisma({
    event: {
      create: async ({ data }: any) => {
        createdEvents.push(data);
        return {
          id: 'evt-2',
          ...data,
          createdAt: new Date('2026-05-21T21:00:00.000Z'),
        };
      },
    },
  }, async () => {
    await service.createEvent(7, 'PAYMENT_RECEIVED', {
      accountId: 'acc-1',
      amount: 15000,
    });
  });

  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].type, 'PAYMENT_RECEIVED');
  assert.equal(createdEvents[0].payload.accountId, 'acc-1');
});
