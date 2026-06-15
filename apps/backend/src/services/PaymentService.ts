import { CashMovementMethod, PaymentChannel, PaymentMethod, PaymentSource, Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { badRequest, notFound, conflict, ErrorCodes } from '../errors';
import { AccountingService } from './AccountingService';
import { EventService } from './EventService';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';
import { ProjectionService } from './ProjectionService';
import { metricsService } from './MetricsService';
import { BookingDomainService } from './BookingDomainService';
import { AccountService } from './AccountService';
import { generateDisplayCode } from '../utils/displayCode';
import { BookingHistoryService } from './BookingHistoryService';
import { getDerivedPaymentStatus } from '../domain/bookingDomain';

const EPSILON = 0.009;

type ListPaymentsFilters = {
  clubId?: number;
  accountId?: string;
  method?: PaymentMethod;
  channel?: PaymentChannel;
  externalReference?: string;
  from?: Date;
  to?: Date;
  take?: number;
};

type CreatePaymentInput = {
  clubId?: number;
  accountId: string;
  amount: number;
  method: PaymentMethod;
  channel?: PaymentChannel;
  collectorAccountLabel?: string;
  externalReference?: string;
  source?: PaymentSource;
  cashShiftId?: string;
  payerParticipantRef?: string;
  payerParticipantName?: string;
  coveredParticipantRef?: string;
  coveredParticipantName?: string;
  createdByUserId?: number;
  idempotencyKey?: string;
  allocations?: Array<{
    accountItemId: string;
    amount: number;
  }>;
};

export class PaymentService {
  private readonly accountingService = new AccountingService();
  private readonly eventService = new EventService();
  private readonly outboxService = new OutboxService();
  private readonly projectionService = new ProjectionService();
  private readonly bookingDomainService = new BookingDomainService();
  private readonly accountService = new AccountService();
  private readonly bookingHistoryService = new BookingHistoryService();

  private roundMoney(value: number) {
    return Number((Number(value || 0)).toFixed(2));
  }

  private normalizeText(value: unknown, maxLen: number): string | null {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  private resolvePaymentChannel(method: PaymentMethod, channel?: PaymentChannel): PaymentChannel {
    if (method === 'CASH') return 'CASH_DRAWER';
    if (method === 'CARD') return 'CARD_TERMINAL';
    if (method === 'TRANSFER') {
      if (channel === 'VIRTUAL_WALLET') return 'VIRTUAL_WALLET';
      if (channel === 'BANK_ACCOUNT') return 'BANK_ACCOUNT';
      throw badRequest('El canal es obligatorio para pagos por transferencia.', ErrorCodes.PAYMENT_METHOD_INVALID);
    }
    if (channel && channel !== 'AUTO') return channel;
    return 'OTHER';
  }

  private resolveBookingOwnerRef(booking: { clientId?: string | null; userId?: number | null }) {
    const clientId = String(booking.clientId || '').trim();
    if (clientId) return `booking-client:${clientId}`;
    const userId = Number(booking.userId || 0);
    if (Number.isFinite(userId) && userId > 0) return `booking-user:${userId}`;
    return 'guest:booking-responsible';
  }

  private resolveBookingOwnerName(booking: {
    client?: { name?: string | null } | null;
    user?: { firstName?: string | null; lastName?: string | null } | null;
  }) {
    const clientName = this.normalizeText(booking.client?.name, 120);
    if (clientName) return clientName;

    const fullName = `${String(booking.user?.firstName || '').trim()} ${String(booking.user?.lastName || '').trim()}`.trim();
    const userName = this.normalizeText(fullName, 120);
    if (userName) return userName;

    return null;
  }

  private async syncClassEnrollmentFinancialStateTx(
    tx: Prisma.TransactionClient,
    params: {
      clubId: number;
      enrollmentId: string;
      total: number;
      netPaid: number;
    }
  ) {
    const enrollment = await tx.classEnrollment.findFirst({
      where: {
        id: params.enrollmentId,
        clubId: params.clubId,
      },
      select: {
        id: true,
        paymentStatus: true,
      }
    });

    if (!enrollment) {
      throw notFound(
        'La inscripción asociada a la cuenta no existe.',
        ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND
      );
    }

    if (String(enrollment.paymentStatus) === 'COVERED_BY_CREDIT') {
      throw conflict(
        'La inscripción ya está cubierta por crédito y no admite sincronización de cobro.',
        ErrorCodes.CLASS_ENROLLMENT_INVALID_STATUS
      );
    }

    const nextPaymentStatus = getDerivedPaymentStatus(params.total, params.netPaid);
    await tx.classEnrollment.update({
      where: { id: params.enrollmentId },
      data: {
        paymentStatus: nextPaymentStatus,
        paidAmount: new Prisma.Decimal(this.roundMoney(params.netPaid)),
      }
    });
  }

  private async getAllocatedByItemTx(
    tx: Prisma.TransactionClient,
    accountId: string,
    itemIds: string[]
  ) {
    if (itemIds.length === 0) return new Map<string, number>();

    const rows = await tx.paymentAllocation.groupBy({
      by: ['accountItemId'],
      where: {
        accountId,
        accountItemId: { in: itemIds }
      },
      _sum: { amount: true }
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.accountItemId, this.roundMoney(Number(row._sum.amount || 0)));
    }
    return map;
  }

  private async resolvePaymentAllocationsTx(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      paymentAmount: number;
      requested?: Array<{ accountItemId: string; amount: number }>;
    }
  ) {
    const paymentAmount = this.roundMoney(params.paymentAmount);
    if (paymentAmount <= 0) return [] as Array<{ accountItemId: string; amount: number }>;

    if (Array.isArray(params.requested) && params.requested.length > 0) {
      const merged = new Map<string, number>();
      for (const allocation of params.requested) {
        const accountItemId = String(allocation.accountItemId || '').trim();
        const amount = this.roundMoney(Number(allocation.amount || 0));
        if (!accountItemId || amount <= 0) continue;
        merged.set(accountItemId, this.roundMoney((merged.get(accountItemId) || 0) + amount));
      }

      const resolved = Array.from(merged.entries()).map(([accountItemId, amount]) => ({ accountItemId, amount }));
      if (resolved.length === 0) {
        throw badRequest('Asignaciones de pago inválidas.', ErrorCodes.INVALID_INPUT);
      }

      const totalRequested = this.roundMoney(resolved.reduce((sum, allocation) => sum + allocation.amount, 0));
      if (Math.abs(totalRequested - paymentAmount) > EPSILON) {
        throw badRequest('La suma de asignaciones debe coincidir con el monto del pago.', ErrorCodes.INVALID_INPUT);
      }

      const requestedIds = resolved.map((allocation) => allocation.accountItemId);
      const items = await tx.accountItem.findMany({
        where: {
          accountId: params.accountId,
          id: { in: requestedIds }
        },
        select: {
          id: true,
          total: true
        }
      });

      if (items.length !== requestedIds.length) {
        throw badRequest('Hay asignaciones a ítems que no pertenecen a la cuenta.', ErrorCodes.INVALID_INPUT);
      }

      const allocatedByItem = await this.getAllocatedByItemTx(tx, params.accountId, requestedIds);
      const itemTotals = new Map(items.map((item) => [item.id, this.roundMoney(Number(item.total || 0))]));

      for (const allocation of resolved) {
        const currentAllocated = allocatedByItem.get(allocation.accountItemId) || 0;
        const itemTotal = itemTotals.get(allocation.accountItemId) || 0;
        const remaining = this.roundMoney(Math.max(0, itemTotal - currentAllocated));
        if (allocation.amount > remaining + EPSILON) {
          throw conflict('Una asignación supera el saldo pendiente del ítem.', ErrorCodes.PAYMENT_OVERPAY);
        }
      }

      return resolved;
    }

    const items = await tx.accountItem.findMany({
      where: { accountId: params.accountId },
      select: { id: true, total: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    });

    if (items.length === 0) {
      throw conflict('No se puede registrar pago: la cuenta no tiene ítems para asignar.', ErrorCodes.INVALID_INPUT);
    }

    const itemIds = items.map((item) => item.id);
    const allocatedByItem = await this.getAllocatedByItemTx(tx, params.accountId, itemIds);

    let remainingToAssign = paymentAmount;
    const generated: Array<{ accountItemId: string; amount: number }> = [];

    for (const item of items) {
      if (remainingToAssign <= EPSILON) break;
      const total = this.roundMoney(Number(item.total || 0));
      const allocated = allocatedByItem.get(item.id) || 0;
      const outstanding = this.roundMoney(Math.max(0, total - allocated));
      if (outstanding <= EPSILON) continue;

      const chunk = this.roundMoney(Math.min(outstanding, remainingToAssign));
      if (chunk <= 0) continue;
      generated.push({ accountItemId: item.id, amount: chunk });
      remainingToAssign = this.roundMoney(remainingToAssign - chunk);
    }

    if (remainingToAssign > EPSILON) {
      throw conflict('El monto excede el saldo pendiente de los ítems de la cuenta.', ErrorCodes.PAYMENT_OVERPAY);
    }

    const generatedTotal = this.roundMoney(generated.reduce((sum, entry) => sum + entry.amount, 0));
    if (Math.abs(generatedTotal - paymentAmount) > EPSILON) {
      throw conflict('No se pudo asignar correctamente el pago a los ítems.', ErrorCodes.INVALID_INPUT);
    }

    return generated;
  }

  async list(filters: ListPaymentsFilters) {
    const where: Prisma.PaymentWhereInput = {
      ...(filters.clubId ? { account: { clubId: filters.clubId } } : {}),
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.externalReference ? { externalReference: filters.externalReference.trim() } : {}),
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
      throw badRequest('El monto debe ser mayor a 0.', ErrorCodes.PAYMENT_INVALID_AMOUNT);
    }

    return prisma.$transaction((tx) => this.createTx(tx, input));
  }

  async createInTransaction(tx: Prisma.TransactionClient, input: CreatePaymentInput) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw badRequest('El monto debe ser mayor a 0.', ErrorCodes.PAYMENT_INVALID_AMOUNT);
    }
    return this.createTx(tx, input);
  }

  private async createTx(tx: Prisma.TransactionClient, input: CreatePaymentInput) {
      const source = input.source ?? 'POS';
      const channel = this.resolvePaymentChannel(input.method, input.channel);
      const collectorAccountLabel = this.normalizeText(input.collectorAccountLabel, 120);
      const externalReference = this.normalizeText(input.externalReference, 120);
      const payerParticipantRefRaw = this.normalizeText(input.payerParticipantRef, 191);
      const payerParticipantNameRaw = this.normalizeText(input.payerParticipantName, 120);
      const coveredParticipantRefRaw = this.normalizeText(input.coveredParticipantRef, 191);
      const coveredParticipantNameRaw = this.normalizeText(input.coveredParticipantName, 120);
      let payerParticipantRef = payerParticipantRefRaw;
      let payerParticipantName = payerParticipantNameRaw;
      let coveredParticipantRef = coveredParticipantRefRaw;
      let coveredParticipantName = coveredParticipantNameRaw;
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
        throw notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND);
      }

      const account = await tx.account.findUnique({
        where: {
          id: input.accountId
        },
        include: { payments: true, items: true }
      });
      if (!account || (input.clubId && account.clubId !== input.clubId)) {
        throw notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND);
      }
      if (account.status !== 'OPEN') throw conflict('Solo se pueden registrar pagos en cuentas abiertas.', ErrorCodes.ACCOUNT_CLOSED);

      if (account.sourceType === 'BOOKING') {
        const booking = await tx.booking.findUnique({
          where: { id: Number(account.sourceId) },
          select: {
            id: true,
            status: true,
            clientId: true,
            userId: true,
            client: { select: { name: true } },
            user: { select: { firstName: true, lastName: true } }
          }
        });
        if (!booking) throw notFound('La reserva asociada a la cuenta no existe.', ErrorCodes.BOOKING_NOT_FOUND);
        if (booking.status === 'CANCELLED') throw conflict('No se pueden registrar pagos sobre una reserva cancelada.', ErrorCodes.BOOKING_INVALID_STATUS);
        if (booking.status === 'PENDING') {
          const clubSettings = await tx.clubSettings.findUnique({
            where: { clubId: account.clubId },
            select: { bookingConfirmationMode: true }
          });
          const confirmationMode = String(clubSettings?.bookingConfirmationMode || 'MANUAL');
          if (confirmationMode === 'MANUAL') {
            throw conflict(
              'No se puede registrar un pago sobre una reserva pendiente en modo MANUAL. Primero debe confirmarse.',
              ErrorCodes.BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN
            );
          }
        }

        const bookingOwnerRef = this.resolveBookingOwnerRef({
          clientId: booking.clientId,
          userId: booking.userId
        });
        const bookingOwnerName = this.resolveBookingOwnerName({
          client: booking.client,
          user: booking.user
        });

        // Regla transversal: si no viene participante explícito, imputar al titular.
        if (!payerParticipantRef) payerParticipantRef = bookingOwnerRef;
        if (!coveredParticipantRef) coveredParticipantRef = bookingOwnerRef;
        if (!payerParticipantName) payerParticipantName = bookingOwnerName;
        if (!coveredParticipantName) coveredParticipantName = bookingOwnerName;
      }

      const accountTotal = Number(account.totalAmount || 0);
      const { netPaid: paidTotal } = await this.accountService.reconcilePaidAmountTx(tx, account.id);
      const remaining = Math.max(0, accountTotal - paidTotal);

      if (input.amount > remaining + EPSILON) {
        throw conflict('El pago supera el saldo pendiente de la cuenta.', ErrorCodes.PAYMENT_OVERPAY);
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
            throw notFound('El turno de caja indicado no está abierto o no pertenece al club.', ErrorCodes.CASH_SHIFT_NOT_FOUND);
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
          if (!openShift) throw conflict('No hay turno de caja abierto para pagos POS.', ErrorCodes.NO_ACTIVE_CASH_SHIFT);
          resolvedCashShiftId = openShift.id;
        }
      }

      if (source === 'ONLINE' && input.cashShiftId) {
        throw badRequest('Los pagos ONLINE no pueden asociarse a un turno de caja.', ErrorCodes.INVALID_INPUT);
      }

      const payment = await tx.payment.create({
        data: {
          displayCode: generateDisplayCode('PAG'),
          amount: new Prisma.Decimal(input.amount),
          method: input.method,
          channel,
          collectorAccountLabel,
          externalReference,
          payerParticipantRef,
          payerParticipantName,
          coveredParticipantRef,
          coveredParticipantName,
          source,
          accountId: input.accountId,
          cashShiftId: source === 'POS' ? resolvedCashShiftId : null,
          idempotencyKey: scopedIdempotencyKey
        }
      });

      const allocations = await this.resolvePaymentAllocationsTx(tx, {
        accountId: account.id,
        paymentAmount: input.amount,
        requested: input.allocations
      });

      if (allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((allocation) => ({
            accountId: account.id,
            paymentId: payment.id,
            accountItemId: allocation.accountItemId,
            amount: new Prisma.Decimal(allocation.amount)
          }))
        });
      }

      await this.accountingService.createPaymentTransaction(tx, {
        clubId: account.clubId,
        type: 'PAYMENT',
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        accountId: account.id,
        paymentId: payment.id,
        amount: input.amount,
        paymentMethod: input.method,
        paymentChannel: channel,
        description: `Pago registrado (${input.method})`,
        createdByUserId: input.createdByUserId ?? null
      });

      const accountBalance = await this.accountService.reconcilePaidAmountTx(tx, account.id, { updateStatus: true });

      if (account.sourceType === 'CLASS_ENROLLMENT') {
        await this.syncClassEnrollmentFinancialStateTx(tx, {
          clubId: account.clubId,
          enrollmentId: String(account.sourceId),
          total: accountBalance.total,
          netPaid: accountBalance.netPaid,
        });
      }

      if (source === 'POS' && resolvedCashShiftId) {
        const movementMethod: CashMovementMethod =
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

      if (account.sourceType === 'BOOKING') {
        await this.bookingDomainService.reevaluateBookingConfirmationTx(tx, Number(account.sourceId));
      }

      await this.eventService.paymentReceived(account.clubId, {
        paymentId: payment.id,
        accountId: account.id,
        bookingId: account.sourceType === 'BOOKING' ? Number(account.sourceId) : null,
        userId: input.createdByUserId ?? null,
        amount: input.amount,
        method: input.method,
        channel,
        source,
        payerParticipantRef,
        payerParticipantName,
        coveredParticipantRef,
        coveredParticipantName
      }, tx);

      if (account.sourceType === 'BOOKING') {
        await this.bookingHistoryService.appendBookingHistoryEntryTx(tx, {
          bookingId: Number(account.sourceId),
          clubId: account.clubId,
          action: 'PAYMENT_RECEIVED',
          category: 'PAYMENT',
          source: source === 'ONLINE' ? 'PAYMENT_ONLINE' : 'PAYMENT_POS',
          summary: 'Pago recibido',
          actorUserId: input.createdByUserId ?? null,
          paymentId: payment.id,
          accountId: account.id,
          detail: {
            amount: input.amount,
            method: input.method,
            channel,
            source,
            payerParticipantRef,
            payerParticipantName,
            coveredParticipantRef,
            coveredParticipantName,
          },
          nextState: {
            amount: input.amount,
            method: input.method,
            channel,
            source,
          },
          idempotencyKey: `payment-history:${payment.id}`,
          occurredAt: payment.createdAt,
        });
      }

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

      const createdPayment = await tx.payment.findUnique({
        where: { id: payment.id },
        include: { allocations: true }
      });

      return createdPayment || payment;
  }
}
