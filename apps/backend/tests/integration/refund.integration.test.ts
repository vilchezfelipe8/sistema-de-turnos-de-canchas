import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/prisma';
import { PaymentService } from '../../src/services/PaymentService';
import { RefundService } from '../../src/services/RefundService';

const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

const paymentService = new PaymentService();
const refundService = new RefundService();

async function createClubFixture() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const club = await prisma.club.create({
    data: {
      slug: `it-refund-${suffix}`,
      name: `IT Refund ${suffix}`,
      addressLine: 'Test 123',
      city: 'Cordoba',
      province: 'Cordoba',
      country: 'AR',
      contactInfo: 'test',
      settings: {
        create: {
          timeZone: 'America/Argentina/Buenos_Aires',
          bookingConfirmationMode: 'MANUAL'
        }
      }
    },
    include: { settings: true }
  });

  return club;
}

async function cleanupClubFixture(clubId: number) {
  const accounts = await prisma.account.findMany({
    where: { clubId },
    select: { id: true }
  });
  const accountIds = accounts.map((a) => a.id);

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

const it = RUN_DB_INTEGRATION ? test : test.skip;

async function integrationPrerequisitesReady() {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ClubSettings'
        AND column_name = 'bookingConfirmationMode'
    ) AS ok
  `;
  return Boolean(rows[0]?.ok);
}

it('integration: requestRefund parcial crea devolucion REQUESTED sin impactar paidAmount hasta ejecutar', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de refunds');
    return;
  }
  const club = await createClubFixture();

  try {
    const account = await prisma.account.create({
      data: {
        clubId: club.id,
        sourceType: 'MANUAL',
        sourceId: `manual-${Date.now()}`,
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(10000),
        paidAmount: new Prisma.Decimal(0)
      }
    });

    const payment = await paymentService.create({
      clubId: club.id,
      accountId: account.id,
      amount: 8000,
      method: 'TRANSFER',
      source: 'BACKOFFICE',
      createdByUserId: undefined,
      idempotencyKey: `it-${Date.now()}-p1`
    });

    const refund = await refundService.requestRefund({
      clubId: club.id,
      paymentId: payment.id,
      amount: 3000,
      reason: 'Ajuste integration',
      executeNow: false
    });

    assert.ok(refund);

    const refreshed = await prisma.account.findUnique({ where: { id: account.id } });
    assert.ok(refreshed);
    assert.equal(Number(refreshed!.paidAmount), 8000);
    assert.equal(refund?.status, 'REQUESTED');
  } finally {
    await cleanupClubFixture(club.id);
  }
});

it('integration: no permite refund en cuenta cerrada no-cancelada (politica estricta)', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de refunds');
    return;
  }
  const club = await createClubFixture();

  try {
    const account = await prisma.account.create({
      data: {
        clubId: club.id,
        sourceType: 'MANUAL',
        sourceId: `manual-${Date.now()}`,
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(5000),
        paidAmount: new Prisma.Decimal(0)
      }
    });

    const payment = await paymentService.create({
      clubId: club.id,
      accountId: account.id,
      amount: 5000,
      method: 'TRANSFER',
      source: 'BACKOFFICE',
      idempotencyKey: `it-${Date.now()}-p2`
    });

    await prisma.account.update({
      where: { id: account.id },
      data: { status: 'CLOSED' }
    });

    await assert.rejects(
      () => refundService.requestRefund({
        clubId: club.id,
        paymentId: payment.id,
        amount: 1000,
        reason: 'Debe fallar'
      }),
      /cuenta cerrada/
    );
  } finally {
    await cleanupClubFixture(club.id);
  }
});

it('integration: refunds concurrentes no exceden monto refundable', async (t) => {
  if (!(await integrationPrerequisitesReady())) {
    t.skip('Schema local no migrado para integration tests de refunds');
    return;
  }
  const club = await createClubFixture();

  try {
    const account = await prisma.account.create({
      data: {
        clubId: club.id,
        sourceType: 'MANUAL',
        sourceId: `manual-${Date.now()}`,
        status: 'OPEN',
        totalAmount: new Prisma.Decimal(20000),
        paidAmount: new Prisma.Decimal(0)
      }
    });

    const payment = await paymentService.create({
      clubId: club.id,
      accountId: account.id,
      amount: 10000,
      method: 'TRANSFER',
      source: 'BACKOFFICE',
      idempotencyKey: `it-${Date.now()}-p3`
    });

    const results = await Promise.allSettled([
      refundService.requestRefund({ clubId: club.id, paymentId: payment.id, amount: 7000, reason: 'r1', executeNow: false }),
      refundService.requestRefund({ clubId: club.id, paymentId: payment.id, amount: 7000, reason: 'r2', executeNow: false })
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const totalRefunded = await prisma.refund.aggregate({
      where: { paymentId: payment.id },
      _sum: { amount: true }
    });
    assert.equal(Number(totalRefunded._sum.amount || 0), 7000);
  } finally {
    await cleanupClubFixture(club.id);
  }
});
