import { CashMovementMethod, PaymentMethod, PaymentSource, Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { AccountingService } from './AccountingService';
import { EventService } from './EventService';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';
import { ProjectionService } from './ProjectionService';
import { metricsService } from './MetricsService';

type ListPaymentsFilters = {
  clubId?: number;
  accountId?: string;
  method?: PaymentMethod;
  from?: Date;
  to?: Date;
  take?: number;
};

type CreatePaymentInput = {
  clubId?: number;
  accountId: string;
  amount: number;
  method: PaymentMethod;
  source?: PaymentSource;
  cashShiftId?: string;
  createdByUserId?: number;
  idempotencyKey?: string;
};

export class PaymentService {
  private readonly accountingService = new AccountingService();
  private readonly eventService = new EventService();
  private readonly outboxService = new OutboxService();
  private readonly projectionService = new ProjectionService();

  async list(filters: ListPaymentsFilters) {
    const where: Prisma.PaymentWhereInput = {
      ...(filters.clubId ? { account: { clubId: filters.clubId } } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {})
            }
          }
        : {})
    };

    return prismaRead.payment.findMany({
      where,
      include: {
        account: { include: { items: true } },
        cashMovement: true
      },
      orderBy: { createdAt: 'desc' },
      take: filters.take ?? 100
    });
  }

  async create(input: CreatePaymentInput) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('El monto debe ser mayor a 0');
    }

    return prisma.$transaction(async (tx) => {
      const source = input.source ?? 'POS';
      const scopedIdempotencyKey = input.idempotencyKey
        ? `payment:${input.accountId}:${input.idempotencyKey.trim()}`
        : undefined;

      if (scopedIdempotencyKey) {
        const existingPayment = await tx.payment.findFirst({
          where: {
            accountId: input.accountId,
            idempotencyKey: scopedIdempotencyKey
          }
        });
        if (existingPayment) {
          return existingPayment;
        }
      }

      const lockedAccounts = input.clubId
        ? await tx.$queryRaw<Array<{ id: string; clubId: number }>>`
            SELECT "id", "clubId"
            FROM "Account"
            WHERE "id" = ${input.accountId}
              AND "clubId" = ${input.clubId}
            FOR UPDATE
          `
        : await tx.$queryRaw<Array<{ id: string; clubId: number }>>`
            SELECT "id", "clubId"
            FROM "Account"
            WHERE "id" = ${input.accountId}
            FOR UPDATE
          `;

      if (lockedAccounts.length === 0) {
        throw new Error('Cuenta no encontrada');
      }

      const account = await tx.account.findUnique({
        where: {
          id: input.accountId
        },
        include: { payments: true, items: true }
      });
      if (!account) throw new Error('Cuenta no encontrada');
      if (input.clubId && account.clubId !== input.clubId) {
        throw new Error('Cuenta no encontrada');
      }
      if (account.status !== 'OPEN') throw new Error('Solo se pueden registrar pagos en cuentas abiertas');

      const accountTotal = Number(account.totalAmount || 0);
      const paidTotal = Number(account.paidAmount || 0);
      const remaining = Math.max(0, accountTotal - paidTotal);

      if (input.amount > remaining + 0.009) {
        throw new Error('El pago supera el saldo pendiente de la cuenta');
      }

      let resolvedCashShiftId: string | null = null;
      if (source === 'POS') {
        if (input.cashShiftId) {
          const providedShift = await tx.cashShift.findFirst({
            where: {
              id: input.cashShiftId,
              status: 'OPEN',
              cashRegister: { clubId: account.clubId }
            }
          });
          if (!providedShift) {
            throw new Error('El turno de caja indicado no está abierto o no pertenece al club');
          }
          resolvedCashShiftId = providedShift.id;
        } else {
          const openShift = await tx.cashShift.findFirst({
            where: {
              status: 'OPEN',
              cashRegister: { clubId: account.clubId }
            },
            orderBy: { openedAt: 'desc' }
          });
          if (!openShift) throw new Error('No hay turno de caja abierto para pagos POS');
          resolvedCashShiftId = openShift.id;
        }
      }

      if (source === 'ONLINE' && input.cashShiftId) {
        throw new Error('Los pagos ONLINE no pueden asociarse a un turno de caja');
      }

      const payment = await tx.payment.create({
        data: {
          amount: new Prisma.Decimal(input.amount),
          method: input.method,
          source,
          accountId: input.accountId,
          cashShiftId: source === 'POS' ? resolvedCashShiftId : null,
          idempotencyKey: scopedIdempotencyKey
        }
      });

      await this.accountingService.createPaymentTransaction(tx, {
        clubId: account.clubId,
        type: 'PAYMENT',
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        accountId: account.id,
        paymentId: payment.id,
        amount: input.amount,
        paymentMethod: input.method,
        description: `Pago registrado (${input.method})`,
        createdByUserId: input.createdByUserId ?? null
      });

      const newPaidAmount = Number((paidTotal + input.amount).toFixed(2));
      const shouldClose = newPaidAmount + 0.009 >= accountTotal;

      await tx.account.update({
        where: { id: account.id },
        data: {
          paidAmount: { increment: new Prisma.Decimal(input.amount) },
          ...(shouldClose
            ? { status: 'CLOSED', closedAt: new Date() }
            : {})
        }
      });

      if (source === 'POS' && resolvedCashShiftId) {
        const movementMethod: CashMovementMethod =
          input.method === 'MERCADO_PAGO' ? 'MP' :
          input.method === 'CARD' ? 'CARD' :
          input.method === 'TRANSFER' ? 'TRANSFER' : 'CASH';

        await tx.cashMovement.create({
          data: {
            type: 'PAYMENT_IN',
            amount: new Prisma.Decimal(input.amount),
            method: movementMethod,
            concept: `Pago cuenta ${input.accountId}`,
            clubId: account.clubId,
            paymentId: payment.id,
            cashShiftId: resolvedCashShiftId,
            createdByUserId: input.createdByUserId ?? null
          }
        });
      }

      await this.eventService.paymentReceived(account.clubId, {
        paymentId: payment.id,
        accountId: account.id,
        userId: input.createdByUserId ?? null,
        amount: input.amount,
        method: input.method,
        source
      }, tx);

      let notificationUserId: number | null = null;
      if (account.sourceType === 'BOOKING') {
        const booking = await tx.booking.findUnique({
          where: { id: Number(account.sourceId) },
          select: { userId: true }
        });
        notificationUserId = booking?.userId ?? null;
      }

      if (notificationUserId) {
        await this.outboxService.enqueue({
          clubId: account.clubId,
          type: OUTBOX_TYPES.NOTIFICATION_CREATE,
          aggregateType: 'PAYMENT',
          aggregateId: payment.id,
          dedupeKey: `payment:${payment.id}:notification:${notificationUserId}`,
          payload: {
            userId: notificationUserId,
            clubId: account.clubId,
            title: 'Pago registrado',
            message: `Se registró un pago por $${Number(input.amount).toFixed(2)}.`
          }
        }, tx);
      }

      await this.projectionService.refreshAccountSummary(account.id, tx);
      if (resolvedCashShiftId) {
        await this.projectionService.refreshCashShiftSummary(resolvedCashShiftId, tx);
        await this.projectionService.refreshDailyCashSummary(account.clubId, payment.createdAt, tx);
      }

      metricsService.recordPayment(source, input.method);

      return payment;
    });
  }
}
