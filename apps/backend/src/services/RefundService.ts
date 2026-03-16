import {
  CashMovementMethod,
  FiscalMode,
  PaymentMethod,
  Prisma,
  RefundExecutionMethod,
  RefundReasonType,
  RefundStatus
} from '@prisma/client';
import { prisma } from '../prisma';
import { AccountingService } from './AccountingService';
import { ProjectionService } from './ProjectionService';
import { AccountService } from './AccountService';
import { generateDisplayCode } from '../utils/displayCode';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';

const EPSILON = 0.009;

type TxClient = Prisma.TransactionClient;

type RefundPaymentInput = {
  clubId?: number;
  paymentId: string;
  amount: number;
  reason?: string | null;
  reasonType?: RefundReasonType;
  executionNotes?: string;
  executionMethod?: RefundExecutionMethod;
  cashShiftId?: string;
  fiscalMode?: FiscalMode;
  createdByUserId?: number;
};

type RequestRefundInput = RefundPaymentInput & {
  executeNow?: boolean;
};

type ExecuteRefundInput = {
  clubId?: number;
  refundId: string;
  cashShiftId?: string;
  executedByUserId?: number;
  executionReference?: string;
  executionNotes?: string;
};

type ApproveRefundInput = {
  clubId?: number;
  refundId: string;
  approvedByUserId?: number;
  executeNow?: boolean;
  cashShiftId?: string;
  executionReference?: string;
  executionNotes?: string;
};

type FailRefundInput = {
  clubId?: number;
  refundId: string;
  failedByUserId?: number;
  reason: string;
};

type CancelRefundInput = {
  clubId?: number;
  refundId: string;
  cancelledByUserId?: number;
  reason: string;
};

type RetryRefundInput = {
  clubId?: number;
  refundId: string;
  retriedByUserId?: number;
  executeNow?: boolean;
  cashShiftId?: string;
  executionReference?: string;
  executionNotes?: string;
};

export class RefundService {
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();
  private readonly accountService = new AccountService();
  private readonly outboxService = new OutboxService();

  private mapPaymentMethodToCashMovement(method: PaymentMethod): CashMovementMethod {
    if (method === 'CARD') return 'CARD';
    if (method === 'TRANSFER') return 'TRANSFER';
    return 'CASH';
  }

  private mapPaymentMethodToExecutionMethod(method: PaymentMethod): RefundExecutionMethod {
    if (method === 'CARD') return 'CARD_REVERSAL';
    if (method === 'TRANSFER') return 'TRANSFER';
    return 'CASH';
  }

  private toMoney(value: number) {
    return Number((Number(value || 0)).toFixed(2));
  }

  private normalizeReason(value: string, maxLen = 300) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  private buildCancellationNotes(existing: string | null, reason: string) {
    const prefix = '[CANCELLED] ';
    if (!existing || !existing.trim()) return `${prefix}${reason}`;
    return `${existing}\n${prefix}${reason}`.slice(0, 500);
  }

  private isRefundReservedStatus(status: RefundStatus) {
    return status !== 'CANCELLED' && status !== 'FAILED';
  }

  private async createAuditLogTx(tx: TxClient, input: {
    clubId: number;
    refundId: string;
    action: string;
    userId?: number | null;
    payload?: Record<string, unknown>;
  }) {
    await tx.auditLog.create({
      data: {
        clubId: input.clubId,
        userId: input.userId ?? null,
        entity: 'REFUND',
        entityId: input.refundId,
        action: input.action,
        payload: input.payload ? (input.payload as Prisma.InputJsonValue) : Prisma.JsonNull
      }
    });
  }

  private async markExecutionFailed(refundId: string, clubId: number | undefined, reason: string) {
    const failureReason = this.normalizeReason(reason || 'EXECUTION_FAILED', 500);
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Refund"
        WHERE "id" = ${refundId}
        FOR UPDATE
      `;
      if (rows.length === 0) return;

      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        select: { id: true, clubId: true, status: true, createdByUserId: true }
      });
      if (!refund) return;
      if (clubId && refund.clubId !== clubId) return;
      if (refund.status !== 'APPROVED' && refund.status !== 'READY_TO_EXECUTE') return;

      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failedReason: failureReason
        }
      });

      await this.createAuditLogTx(tx, {
        clubId: refund.clubId,
        refundId: refund.id,
        action: 'FAILED',
        userId: refund.createdByUserId ?? null,
        payload: { reason: failureReason, source: 'execute' }
      });
    });
  }

  private async lockPaymentTx(tx: TxClient, paymentId: string) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Payment"
      WHERE "id" = ${paymentId}
      FOR UPDATE
    `;
  }

  private async getRefundableForPaymentTx(tx: TxClient, paymentId: string, excludeRefundId?: string) {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        account: true,
        refunds: true
      }
    });

    if (!payment) throw new Error('Pago no encontrado');

    const reserved = payment.refunds
      .filter((row) => row.id !== excludeRefundId)
      .filter((row) => this.isRefundReservedStatus(row.status))
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const refundable = this.toMoney(Math.max(0, Number(payment.amount || 0) - reserved));
    return { payment, refundable };
  }

  private async resolveOpenCashShiftTx(tx: TxClient, params: {
    clubId: number;
    cashShiftId?: string;
  }) {
    if (params.cashShiftId) {
      const providedShift = await tx.cashShift.findFirst({
        where: {
          id: params.cashShiftId,
          status: 'OPEN',
          cashRegister: { clubId: params.clubId }
        }
      });
      if (!providedShift) {
        throw new Error('El turno de caja indicado no esta abierto o no pertenece al club');
      }
      return providedShift.id;
    }

    const openShift = await tx.cashShift.findFirst({
      where: {
        status: 'OPEN',
        cashRegister: { clubId: params.clubId }
      },
      orderBy: { openedAt: 'desc' }
    });

    if (!openShift) {
      throw new Error('No hay turno de caja abierto para ejecutar la devolucion en efectivo');
    }
    return openShift.id;
  }

  private async executeRefundTx(tx: TxClient, input: ExecuteRefundInput) {
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Refund"
      WHERE "id" = ${input.refundId}
      FOR UPDATE
    `;
    if (lockedRows.length === 0) throw new Error('Devolucion no encontrada');

    const refund = await tx.refund.findUnique({
      where: { id: input.refundId },
      include: {
        payment: {
          include: {
            account: true
          }
        }
      }
    });

    if (!refund) throw new Error('Devolucion no encontrada');
    if (input.clubId && refund.clubId !== input.clubId) throw new Error('Devolucion no encontrada');

    if (refund.status === 'EXECUTED') {
      return tx.refund.findUnique({
        where: { id: refund.id },
        include: { payment: true, cashMovement: true }
      });
    }

    if (refund.status === 'CANCELLED') {
      throw new Error('No se puede ejecutar una devolucion cancelada');
    }
    if (refund.status === 'REQUESTED') {
      throw new Error('La devolucion debe aprobarse antes de ejecutarse');
    }
    if (refund.status === 'FAILED') {
      throw new Error('La devolucion esta fallida, reintentala antes de ejecutar');
    }
    if (refund.status !== 'APPROVED' && refund.status !== 'READY_TO_EXECUTE') {
      throw new Error('La devolucion no esta en estado ejecutable');
    }

    const expectedMethod = this.mapPaymentMethodToExecutionMethod(refund.payment.method);
    const executionMethod = refund.executionMethod ?? expectedMethod;
    if (executionMethod !== expectedMethod) {
      throw new Error('El metodo de ejecucion no coincide con el metodo de pago original');
    }

    let resolvedCashShiftId: string | null = null;
    if (executionMethod === 'CASH') {
      resolvedCashShiftId = await this.resolveOpenCashShiftTx(tx, {
        clubId: refund.clubId,
        cashShiftId: input.cashShiftId ?? refund.cashShiftId ?? undefined
      });
    }

    await this.accountingService.createRefundTransaction(tx, {
      clubId: refund.clubId,
      type: 'REFUND',
      referenceType: 'REFUND',
      referenceId: refund.id,
      accountId: refund.accountId,
      refundId: refund.id,
      amount: Number(refund.amount || 0),
      paymentMethod: refund.payment.method,
      paymentChannel: refund.payment.channel ?? 'AUTO',
      description: `Devolucion pago ${refund.paymentId}`,
      createdByUserId: input.executedByUserId ?? refund.createdByUserId ?? null
    });

    await this.accountService.reconcilePaidAmountTx(tx, refund.accountId, {
      updateStatus: false,
      reopenIfRemaining: false
    });

    if (resolvedCashShiftId) {
      await tx.cashMovement.create({
        data: {
          type: 'REFUND',
          amount: new Prisma.Decimal(refund.amount),
          method: this.mapPaymentMethodToCashMovement(refund.payment.method),
          concept: `Refund pago ${refund.payment.id}`,
          clubId: refund.clubId,
          refundId: refund.id,
          cashShiftId: resolvedCashShiftId,
          createdByUserId: input.executedByUserId ?? refund.createdByUserId ?? null
        }
      });
    }

    const executedAt = new Date();
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'EXECUTED',
        cashShiftId: resolvedCashShiftId ?? refund.cashShiftId,
        executedAt,
        executedByUserId: input.executedByUserId ?? refund.executedByUserId ?? refund.createdByUserId ?? null,
        executionReference: input.executionReference ?? refund.executionReference,
        executionNotes: input.executionNotes ?? refund.executionNotes,
        cancelledAt: null,
        cancelledByUserId: null,
        cancelReason: null,
        failedAt: null,
        failedReason: null
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: refund.clubId,
      refundId: refund.id,
      action: 'EXECUTED',
      userId: input.executedByUserId ?? refund.createdByUserId ?? null,
      payload: {
        amount: Number(refund.amount || 0),
        method: executionMethod,
        cashShiftId: resolvedCashShiftId ?? refund.cashShiftId ?? null
      }
    });

    if (refund.fiscalMode === 'REQUIRED') {
      await this.outboxService.enqueue({
        clubId: refund.clubId,
        type: OUTBOX_TYPES.FISCAL_DOCUMENT_ISSUE,
        aggregateType: 'REFUND',
        aggregateId: refund.id,
        dedupeKey: `fiscal:refund:${refund.id}:auto`,
        payload: {
          clubId: refund.clubId,
          refundId: refund.id,
          documentType: 'CREDIT_NOTE_B'
        }
      }, tx);
    }

    await this.projectionService.refreshAccountSummary(refund.accountId, tx);
    if (resolvedCashShiftId) {
      await this.projectionService.refreshCashShiftSummary(resolvedCashShiftId, tx);
      await this.projectionService.refreshDailyCashSummary(refund.clubId, executedAt, tx);
    }

    return tx.refund.findUnique({
      where: { id: refund.id },
      include: {
        payment: true,
        cashMovement: true
      }
    });
  }

  private async requestRefundTx(tx: TxClient, input: RequestRefundInput) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('El monto de devolucion debe ser mayor a 0');
    }

    await this.lockPaymentTx(tx, input.paymentId);
    const { payment, refundable } = await this.getRefundableForPaymentTx(tx, input.paymentId);

    if (input.clubId && payment.account.clubId !== input.clubId) throw new Error('Pago no encontrado');
    if (input.amount > refundable + EPSILON) {
      throw new Error('El monto de devolucion supera el saldo refundable del pago');
    }

    if (payment.account.status !== 'OPEN') {
      if (payment.account.sourceType !== 'BOOKING') {
        throw new Error('No se puede devolver un pago de una cuenta cerrada');
      }
      const bookingForClosedAccount = await tx.booking.findUnique({
        where: { id: Number(payment.account.sourceId) },
        select: { status: true }
      });
      if (!bookingForClosedAccount || bookingForClosedAccount.status !== 'CANCELLED') {
        throw new Error('No se puede devolver un pago de una reserva no cancelada con cuenta cerrada');
      }
    }

    if (payment.account.sourceType === 'BOOKING') {
      const booking = await tx.booking.findUnique({
        where: { id: Number(payment.account.sourceId) },
        select: { status: true }
      });
      if (!booking) throw new Error('Reserva asociada al pago no encontrada');
      if (booking.status === 'COMPLETED') {
        throw new Error('No se permiten devoluciones sobre reservas completadas');
      }
    }

    const expectedMethod = this.mapPaymentMethodToExecutionMethod(payment.method);
    const executionMethod = input.executionMethod ?? expectedMethod;
    if (executionMethod !== expectedMethod) {
      throw new Error('El metodo de ejecucion no coincide con el metodo de pago original');
    }

    const executeNow = input.executeNow ?? false;
    const now = new Date();
    const initialStatus: RefundStatus = executeNow ? 'APPROVED' : 'REQUESTED';
    const fiscalMode = input.fiscalMode ?? 'ON_DEMAND';

    const refund = await tx.refund.create({
      data: {
        displayCode: generateDisplayCode('DEV'),
        paymentId: payment.id,
        accountId: payment.accountId,
        clubId: payment.account.clubId,
        amount: new Prisma.Decimal(input.amount),
        reason: input.reason ?? null,
        reasonType: input.reasonType ?? 'OTHER',
        executionNotes: input.executionNotes ?? null,
        status: initialStatus,
        executionMethod,
        fiscalMode,
        fiscalStatus: 'NOT_APPLICABLE',
        createdByUserId: input.createdByUserId ?? null,
        approvedAt: initialStatus === 'APPROVED' ? now : null,
        approvedByUserId: initialStatus === 'APPROVED' ? (input.createdByUserId ?? null) : null,
        cancelledAt: null,
        cancelledByUserId: null,
        cancelReason: null,
        cashShiftId: input.cashShiftId ?? null
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: payment.account.clubId,
      refundId: refund.id,
      action: executeNow ? 'REQUESTED_AND_EXECUTED' : 'REQUESTED',
      userId: input.createdByUserId ?? null,
      payload: {
        paymentId: payment.id,
        amount: Number(input.amount),
        reasonType: input.reasonType ?? 'OTHER',
        executionMethod
      }
    });

    if (!executeNow) {
      return tx.refund.findUnique({
        where: { id: refund.id },
        include: { payment: true, cashMovement: true }
      });
    }

    return this.executeRefundTx(tx, {
      clubId: input.clubId,
      refundId: refund.id,
      cashShiftId: input.cashShiftId,
      executedByUserId: input.createdByUserId,
      executionNotes: input.executionNotes
    });
  }

  private async approveRefundTx(tx: TxClient, input: ApproveRefundInput) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Refund"
      WHERE "id" = ${input.refundId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new Error('Devolucion no encontrada');

    const refund = await tx.refund.findUnique({
      where: { id: input.refundId },
      include: {
        payment: true
      }
    });
    if (!refund) throw new Error('Devolucion no encontrada');
    if (input.clubId && refund.clubId !== input.clubId) throw new Error('Devolucion no encontrada');

    if (refund.status === 'EXECUTED') {
      return tx.refund.findUnique({ where: { id: refund.id }, include: { payment: true, cashMovement: true } });
    }
    if (refund.status === 'CANCELLED') {
      throw new Error('No se puede aprobar una devolucion cancelada');
    }

    const expectedMethod = this.mapPaymentMethodToExecutionMethod(refund.payment.method);
    const executionMethod = refund.executionMethod ?? expectedMethod;
    if (executionMethod !== expectedMethod) {
      throw new Error('El metodo de ejecucion no coincide con el metodo de pago original');
    }

    const now = new Date();
    const targetStatus = executionMethod === 'CASH' ? 'READY_TO_EXECUTE' : 'APPROVED';

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: targetStatus,
        approvedAt: now,
        approvedByUserId: input.approvedByUserId ?? null,
        executionMethod,
        failedAt: null,
        failedReason: null
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: refund.clubId,
      refundId: refund.id,
      action: 'APPROVED',
      userId: input.approvedByUserId ?? null,
      payload: { status: targetStatus, executionMethod }
    });

    if (input.executeNow) {
      return this.executeRefundTx(tx, {
        clubId: input.clubId,
        refundId: refund.id,
        cashShiftId: input.cashShiftId,
        executedByUserId: input.approvedByUserId,
        executionReference: input.executionReference,
        executionNotes: input.executionNotes
      });
    }

    return tx.refund.findUnique({
      where: { id: refund.id },
      include: { payment: true, cashMovement: true }
    });
  }

  private async failRefundTx(tx: TxClient, input: FailRefundInput) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Refund"
      WHERE "id" = ${input.refundId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new Error('Devolucion no encontrada');

    const refund = await tx.refund.findUnique({
      where: { id: input.refundId },
      include: { payment: true }
    });
    if (!refund) throw new Error('Devolucion no encontrada');
    if (input.clubId && refund.clubId !== input.clubId) throw new Error('Devolucion no encontrada');
    if (refund.status === 'EXECUTED') throw new Error('No se puede fallar una devolucion ejecutada');
    if (refund.status === 'CANCELLED') throw new Error('No se puede fallar una devolucion cancelada');

    const reason = this.normalizeReason(input.reason, 500);
    if (!reason) throw new Error('La razon de falla es obligatoria');

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failedReason: reason
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: refund.clubId,
      refundId: refund.id,
      action: 'FAILED',
      userId: input.failedByUserId ?? null,
      payload: { reason, source: 'manual' }
    });

    return tx.refund.findUnique({
      where: { id: refund.id },
      include: { payment: true, cashMovement: true }
    });
  }

  private async cancelRefundTx(tx: TxClient, input: CancelRefundInput) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Refund"
      WHERE "id" = ${input.refundId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new Error('Devolucion no encontrada');

    const refund = await tx.refund.findUnique({
      where: { id: input.refundId },
      include: { payment: true }
    });
    if (!refund) throw new Error('Devolucion no encontrada');
    if (input.clubId && refund.clubId !== input.clubId) throw new Error('Devolucion no encontrada');

    if (refund.status === 'EXECUTED') throw new Error('No se puede cancelar una devolucion ejecutada');
    if (refund.status === 'CANCELLED') {
      return tx.refund.findUnique({
        where: { id: refund.id },
        include: { payment: true, cashMovement: true }
      });
    }

    const reason = this.normalizeReason(input.reason, 300);
    if (!reason) throw new Error('La razon de cancelacion es obligatoria');

    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledByUserId: input.cancelledByUserId ?? null,
        cancelReason: reason,
        executionNotes: this.buildCancellationNotes(refund.executionNotes, reason)
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: refund.clubId,
      refundId: refund.id,
      action: 'CANCELLED',
      userId: input.cancelledByUserId ?? null,
      payload: { reason }
    });

    return tx.refund.findUnique({
      where: { id: refund.id },
      include: { payment: true, cashMovement: true }
    });
  }

  private async retryRefundTx(tx: TxClient, input: RetryRefundInput) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Refund"
      WHERE "id" = ${input.refundId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new Error('Devolucion no encontrada');

    const refund = await tx.refund.findUnique({
      where: { id: input.refundId },
      include: {
        payment: true
      }
    });
    if (!refund) throw new Error('Devolucion no encontrada');
    if (input.clubId && refund.clubId !== input.clubId) throw new Error('Devolucion no encontrada');

    if (refund.status === 'EXECUTED') {
      return tx.refund.findUnique({ where: { id: refund.id }, include: { payment: true, cashMovement: true } });
    }
    if (refund.status === 'CANCELLED') {
      throw new Error('No se puede reintentar una devolucion cancelada');
    }
    if (refund.status !== 'FAILED') {
      throw new Error('Solo se pueden reintentar devoluciones en estado FAILED');
    }

    const expectedMethod = this.mapPaymentMethodToExecutionMethod(refund.payment.method);
    const executionMethod = refund.executionMethod ?? expectedMethod;
    if (executionMethod !== expectedMethod) {
      throw new Error('El metodo de ejecucion no coincide con el metodo de pago original');
    }

    const targetStatus: RefundStatus = executionMethod === 'CASH' ? 'READY_TO_EXECUTE' : 'APPROVED';
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: targetStatus,
        approvedAt: new Date(),
        approvedByUserId: input.retriedByUserId ?? refund.approvedByUserId ?? null,
        failedAt: null,
        failedReason: null
      }
    });

    await this.createAuditLogTx(tx, {
      clubId: refund.clubId,
      refundId: refund.id,
      action: 'RETRIED',
      userId: input.retriedByUserId ?? null,
      payload: { status: targetStatus }
    });

    if (input.executeNow) {
      return this.executeRefundTx(tx, {
        clubId: input.clubId,
        refundId: refund.id,
        cashShiftId: input.cashShiftId,
        executedByUserId: input.retriedByUserId,
        executionReference: input.executionReference,
        executionNotes: input.executionNotes
      });
    }

    return tx.refund.findUnique({
      where: { id: refund.id },
      include: { payment: true, cashMovement: true }
    });
  }

  async listPendingRefunds(filters: {
    clubId?: number;
    take?: number;
  }) {
    return prisma.refund.findMany({
      where: {
        ...(filters.clubId ? { clubId: filters.clubId } : {}),
        status: { in: ['REQUESTED', 'APPROVED', 'READY_TO_EXECUTE', 'FAILED'] }
      },
      include: {
        payment: true,
        account: true,
        createdByUser: true
      },
      orderBy: { createdAt: 'asc' },
      take: filters.take ?? 100
    });
  }

  async listRefunds(filters: {
    clubId?: number;
    status?: RefundStatus[];
    paymentId?: string;
    accountId?: string;
    from?: Date;
    to?: Date;
    take?: number;
  }) {
    return prisma.refund.findMany({
      where: {
        ...(filters.clubId ? { clubId: filters.clubId } : {}),
        ...(filters.status && filters.status.length > 0 ? { status: { in: filters.status } } : {}),
        ...(filters.paymentId ? { paymentId: filters.paymentId } : {}),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...((filters.from || filters.to)
          ? {
              createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {})
              }
            }
          : {})
      },
      include: {
        payment: true,
        account: true,
        createdByUser: true,
        approvedByUser: true,
        executedByUser: true,
        cancelledByUser: true
      },
      orderBy: { createdAt: 'desc' },
      take: filters.take ?? 100
    });
  }

  async requestRefund(input: RequestRefundInput) {
    return prisma.$transaction((tx) => this.requestRefundTx(tx, input));
  }

  async approveRefund(input: ApproveRefundInput) {
    return prisma.$transaction((tx) => this.approveRefundTx(tx, input));
  }

  async executeRefund(input: ExecuteRefundInput) {
    try {
      return await prisma.$transaction((tx) => this.executeRefundTx(tx, input));
    } catch (error: any) {
      await this.markExecutionFailed(
        input.refundId,
        input.clubId,
        error?.message || 'Error al ejecutar devolucion'
      );
      throw error;
    }
  }

  async failRefund(input: FailRefundInput) {
    return prisma.$transaction((tx) => this.failRefundTx(tx, input));
  }

  async cancelRefund(input: CancelRefundInput) {
    return prisma.$transaction((tx) => this.cancelRefundTx(tx, input));
  }

  async retryRefund(input: RetryRefundInput) {
    return prisma.$transaction((tx) => this.retryRefundTx(tx, input));
  }

  async refundPayment(input: RefundPaymentInput) {
    // Backward-compatible path used by current API endpoint.
    return this.requestRefund({
      ...input,
      executeNow: true
    });
  }

  async refundPaymentTx(tx: TxClient, input: RefundPaymentInput) {
    // Backward-compatible transactional path used by booking cancellation.
    return this.requestRefundTx(tx, {
      ...input,
      executeNow: true
    });
  }

  async refundBookingPaymentsTx(tx: TxClient, input: {
    bookingId: number;
    clubId: number;
    reason?: string;
    reasonType?: RefundReasonType;
    executionNotes?: string;
    createdByUserId?: number;
    amount?: number;
    executeNow?: boolean;
  }) {
    const account = await tx.account.findFirst({
      where: {
        clubId: input.clubId,
        sourceType: 'BOOKING',
        sourceId: String(input.bookingId)
      },
      include: {
        payments: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!account) throw new Error('Cuenta de reserva no encontrada');

    const refunds: any[] = [];
    const executeNow = input.executeNow ?? true;
    let remainingToRefund = Number.isFinite(input.amount as number)
      ? this.toMoney(Math.max(0, Number(input.amount)))
      : Number.POSITIVE_INFINITY;

    if (remainingToRefund <= EPSILON) {
      return refunds;
    }

    for (const payment of account.payments) {
      if (remainingToRefund <= EPSILON) break;

      await this.lockPaymentTx(tx, payment.id);
      const { refundable } = await this.getRefundableForPaymentTx(tx, payment.id);
      if (refundable <= EPSILON) continue;

      const amountToRefund = Number.isFinite(remainingToRefund)
        ? this.toMoney(Math.min(refundable, remainingToRefund))
        : refundable;
      if (amountToRefund <= EPSILON) continue;

      const refund = await this.requestRefundTx(tx, {
        clubId: input.clubId,
        paymentId: payment.id,
        amount: amountToRefund,
        reason: input.reason ?? `Cancelacion reserva #${input.bookingId}`,
        reasonType: input.reasonType ?? (amountToRefund + EPSILON < refundable ? 'PARTIAL_COMMERCIAL' : 'FULL'),
        executionNotes: input.executionNotes,
        createdByUserId: input.createdByUserId,
        executeNow
      });
      refunds.push(refund);

      if (Number.isFinite(remainingToRefund)) {
        remainingToRefund = this.toMoney(Math.max(0, remainingToRefund - amountToRefund));
      }
    }

    if (Number.isFinite(remainingToRefund) && remainingToRefund > EPSILON) {
      throw new Error('No hay saldo refundable suficiente para cubrir el monto solicitado');
    }

    return refunds;
  }
}
