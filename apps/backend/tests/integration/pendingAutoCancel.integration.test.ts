import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/prisma';
import { PendingBookingAutoCancelService } from '../../src/services/PendingBookingAutoCancelService';

const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const it = RUN_DB_INTEGRATION ? test : test.skip;

const service = new PendingBookingAutoCancelService();

async function integrationPrerequisitesReady() {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ClubSettings'
        AND column_name = 'autoCancelPendingBookingsEnabled'
    ) AS ok
  `;
  return Boolean(rows[0]?.ok);
}

async function createClubFixture(config: {
  autoCancelEnabled: boolean;
  cancelMinutesBefore: number | null;
  onlyIfUnpaid: boolean;
  warningEnabled: boolean;
  warningMinutesBefore: number | null;
}) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.club.create({
    data: {
      slug: `it-auto-cancel-${suffix}`,
      name: `IT AutoCancel ${suffix}`,
      addressLine: 'Test 123',
      city: 'Cordoba',
      province: 'Cordoba',
      country: 'AR',
      contactInfo: 'test',
      phone: '+5493511111111',
      settings: {
        create: {
          timeZone: 'America/Argentina/Buenos_Aires',
          bookingConfirmationMode: 'MANUAL',
          autoCancelPendingBookingsEnabled: config.autoCancelEnabled,
          autoCancelPendingBookingsMinutesBefore: config.cancelMinutesBefore,
          autoCancelPendingBookingsOnlyIfUnpaid: config.onlyIfUnpaid,
          autoCancelPendingWarningEnabled: config.warningEnabled,
          autoCancelPendingWarningMinutesBefore: config.warningMinutesBefore
        }
      }
    },
    include: { settings: true }
  });
}

async function createBookingFixture(input: {
  clubId: number;
  status?: 'PENDING' | 'CONFIRMED';
  minutesUntilStart: number;
  withAccount?: boolean;
  withPayment?: boolean;
}) {
  const activity = await prisma.activityType.create({
    data: {
      name: `IT AutoCancel Act ${Date.now()}`,
      description: 'test',
      defaultDurationMinutes: 90,
      clubId: input.clubId
    }
  });

  const court = await prisma.court.create({
    data: {
      name: `IT AutoCancel Court ${Date.now()}`,
      isIndoor: false,
      surface: 'SYNTHETIC',
      clubId: input.clubId,
      activityTypeId: activity.id,
      price: new Prisma.Decimal(12000)
    }
  });

  const client = await prisma.client.create({
    data: {
      clubId: input.clubId,
      name: `Cliente ${Date.now()}`,
      phone: `+549351${Math.floor(Math.random() * 9000000 + 1000000)}`,
      dni: String(Math.floor(Math.random() * 90000000 + 10000000))
    }
  });

  const startDateTime = new Date(Date.now() + input.minutesUntilStart * 60_000);
  const endDateTime = new Date(startDateTime.getTime() + 90 * 60_000);

  const booking = await prisma.booking.create({
    data: {
      clubId: input.clubId,
      courtId: court.id,
      activityId: activity.id,
      clientId: client.id,
      startDateTime,
      endDateTime,
      price: new Prisma.Decimal(12000),
      status: input.status ?? 'PENDING'
    }
  });

  if (input.withAccount !== false) {
    const account = await prisma.account.create({
      data: {
        clubId: input.clubId,
        sourceType: 'BOOKING',
        sourceId: String(booking.id),
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(12000),
        paidAmount: new Prisma.Decimal(0)
      }
    });

    await prisma.accountItem.create({
      data: {
        accountId: account.id,
        type: 'BOOKING',
        description: `Reserva #${booking.id}`,
        quantity: 1,
        unitPrice: new Prisma.Decimal(12000),
        total: new Prisma.Decimal(12000)
      }
    });

    if (input.withPayment) {
      await prisma.payment.create({
        data: {
          accountId: account.id,
          amount: new Prisma.Decimal(2000),
          method: 'TRANSFER',
          source: 'BACKOFFICE'
        }
      });
    }
  }

  return { bookingId: booking.id, activityId: activity.id, courtId: court.id, clientId: client.id };
}

async function cleanupClubFixture(clubId: number) {
  const accounts = await prisma.account.findMany({
    where: { clubId },
    select: { id: true }
  });
  const accountIds = accounts.map((a) => a.id);

  const bookings = await prisma.booking.findMany({
    where: { clubId },
    select: { id: true }
  });
  const bookingIds = bookings.map((b) => b.id);

  const payments = accountIds.length > 0
    ? await prisma.payment.findMany({ where: { accountId: { in: accountIds } }, select: { id: true } })
    : [];
  const paymentIds = payments.map((p) => p.id);

  const refunds = paymentIds.length > 0
    ? await prisma.refund.findMany({ where: { paymentId: { in: paymentIds } }, select: { id: true } })
    : [];
  const refundIds = refunds.map((r) => r.id);

  await prisma.$transaction(async (tx) => {
    if (refundIds.length > 0) {
      await tx.cashMovement.deleteMany({ where: { refundId: { in: refundIds } } });
      await tx.ledgerEntry.deleteMany({ where: { refundId: { in: refundIds } } });
      await tx.refund.deleteMany({ where: { id: { in: refundIds } } });
    }

    if (paymentIds.length > 0) {
      await tx.cashMovement.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await tx.ledgerEntry.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }

    if (accountIds.length > 0) {
      await tx.ledgerEntry.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.accountItem.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.account.deleteMany({ where: { id: { in: accountIds } } });
    }

    if (bookingIds.length > 0) {
      await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
    }

    await tx.court.deleteMany({ where: { clubId } });
    await tx.activityType.deleteMany({ where: { clubId } });
    await tx.client.deleteMany({ where: { clubId } });
    await tx.ledgerTransaction.deleteMany({ where: { clubId } });
    await tx.event.deleteMany({ where: { clubId } });
    await tx.notification.deleteMany({ where: { clubId } });
    await tx.auditLog.deleteMany({ where: { clubId } });
    await tx.outboxMessage.deleteMany({ where: { clubId } });
    await tx.cashShift.deleteMany({ where: { clubId } });
    await tx.cashRegister.deleteMany({ where: { clubId } });
    await tx.clubSettings.deleteMany({ where: { clubId } });
    await tx.club.deleteMany({ where: { id: clubId } });
  });
}

it('integration: envía warning una sola vez y solo al cliente', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de auto-cancel');
    return;
  }

  const club = await createClubFixture({
    autoCancelEnabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: true,
    warningMinutesBefore: 180
  });

  try {
    const fixture = await createBookingFixture({
      clubId: club.id,
      status: 'PENDING',
      minutesUntilStart: 120
    });

    await service.processPendingBookingWarnings({ limit: 50 });
    await service.processPendingBookingWarnings({ limit: 50 });

    const booking = await prisma.booking.findUnique({ where: { id: fixture.bookingId } });
    assert.ok(booking?.autoCancelWarningSentAt);

    const outbox = await prisma.outboxMessage.findMany({
      where: {
        clubId: club.id,
        aggregateType: 'BOOKING',
        aggregateId: String(fixture.bookingId),
        dedupeKey: { contains: 'booking-auto-cancel-warning' }
      }
    });
    const whatsapp = outbox.filter((m) => m.type === 'WHATSAPP_SEND');
    assert.equal(whatsapp.length, 1);
    assert.ok(!whatsapp.some((m) => String(m.dedupeKey || '').includes(':club:')));
  } finally {
    await cleanupClubFixture(club.id);
  }
});

it('integration: auto-cancela pending dentro del umbral y marca autoCancelledAt', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de auto-cancel');
    return;
  }

  const club = await createClubFixture({
    autoCancelEnabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: false,
    warningMinutesBefore: null
  });

  try {
    const fixture = await createBookingFixture({
      clubId: club.id,
      status: 'PENDING',
      minutesUntilStart: 30
    });

    await service.processPendingBookingAutoCancellations({ limit: 50 });
    await service.processPendingBookingAutoCancellations({ limit: 50 });

    const booking = await prisma.booking.findUnique({ where: { id: fixture.bookingId } });
    assert.equal(booking?.status, 'CANCELLED');
    assert.ok(booking?.autoCancelledAt);
    assert.equal(booking?.autoCancelReason, 'AUTO_CANCEL_UNCONFIRMED');

    const cancelMsgs = await prisma.outboxMessage.findMany({
      where: {
        clubId: club.id,
        aggregateType: 'BOOKING',
        aggregateId: String(fixture.bookingId),
        dedupeKey: { contains: 'booking-cancelled' },
        type: 'WHATSAPP_SEND'
      }
    });
    const clientCancelMsgs = cancelMsgs.filter((msg) => String(msg.dedupeKey || '').includes(':client:'));
    assert.equal(clientCancelMsgs.length, 1);
  } finally {
    await cleanupClubFixture(club.id);
  }
});

it('integration: no auto-cancela reservas CONFIRMED', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de auto-cancel');
    return;
  }

  const club = await createClubFixture({
    autoCancelEnabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: false,
    warningMinutesBefore: null
  });

  try {
    const fixture = await createBookingFixture({
      clubId: club.id,
      status: 'CONFIRMED',
      minutesUntilStart: 30
    });

    await service.processPendingBookingAutoCancellations({ limit: 50 });

    const booking = await prisma.booking.findUnique({ where: { id: fixture.bookingId } });
    assert.equal(booking?.status, 'CONFIRMED');
    assert.equal(booking?.autoCancelledAt, null);
  } finally {
    await cleanupClubFixture(club.id);
  }
});

it('integration: no auto-cancela cuando hay pagos y onlyIfUnpaid=true', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de auto-cancel');
    return;
  }

  const club = await createClubFixture({
    autoCancelEnabled: true,
    cancelMinutesBefore: 60,
    onlyIfUnpaid: true,
    warningEnabled: false,
    warningMinutesBefore: null
  });

  try {
    const fixture = await createBookingFixture({
      clubId: club.id,
      status: 'PENDING',
      minutesUntilStart: 30,
      withPayment: true
    });

    await service.processPendingBookingAutoCancellations({ limit: 50 });

    const booking = await prisma.booking.findUnique({ where: { id: fixture.bookingId } });
    assert.equal(booking?.status, 'PENDING');
    assert.equal(booking?.autoCancelledAt, null);
  } finally {
    await cleanupClubFixture(club.id);
  }
});
