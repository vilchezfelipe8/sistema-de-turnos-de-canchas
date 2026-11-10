import { Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { AccountingService } from './AccountingService';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';
import { ProjectionService } from './ProjectionService';
import { badRequest, notFound, conflict } from '../errors';
import { ErrorCodes } from '../errors';

const USE_PROJECTION_READ_MODELS = String(process.env.READ_MODEL_SOURCE || '').toLowerCase() === 'projection';
const EPSILON = 0.009;

type OpenAccountsSummary = {
  openAccounts: number;
  pendingAmount: number;
  openAccountsWithPending: number;
};

export class CashShiftService {
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();

  private roundMoney(value: number) {
    return Number(Number(value || 0).toFixed(2));
  }

  private async getOpenAccountsSummaryTx(tx: Prisma.TransactionClient | typeof prismaRead, clubId: number): Promise<OpenAccountsSummary> {
    const accounts = await tx.account.findMany({
      where: { clubId, status: 'OPEN' },
      select: { totalAmount: true, paidAmount: true }
    });

    let pendingAmount = 0;
    let openAccountsWithPending = 0;
    for (const account of accounts) {
      const total = Number(account.totalAmount || 0);
      const paid = Number(account.paidAmount || 0);
      const remaining = Math.max(0, this.roundMoney(total - paid));
      pendingAmount += remaining;
      if (remaining > EPSILON) openAccountsWithPending += 1;
    }

    return {
      openAccounts: accounts.length,
      pendingAmount: this.roundMoney(pendingAmount),
      openAccountsWithPending
    };
  }

  private async getClosePolicyTx(tx: Prisma.TransactionClient | typeof prismaRead, clubId: number) {
    const settings = await tx.clubSettings.findUnique({
      where: { clubId },
      select: { enforceCashShiftCloseWithOpenAccounts: true }
    });
    return {
      strict: Boolean(settings?.enforceCashShiftCloseWithOpenAccounts)
    };
  }

  async open(clubId: number, openedByUserId: number, input: { cashRegisterId: string; openingAmount: number }) {
    if (!Number.isFinite(input.openingAmount) || input.openingAmount < 0) {
      throw badRequest('Monto de apertura inválido.', ErrorCodes.INVALID_INPUT);
    }

    return prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `cash-shift:${input.cashRegisterId}`);

      const register = await tx.cashRegister.findFirst({ where: { id: input.cashRegisterId, clubId } });
      if (!register) throw notFound('Caja no encontrada.', ErrorCodes.CASH_REGISTER_NOT_FOUND);

      const alreadyOpen = await tx.cashShift.findFirst({
        where: { cashRegisterId: input.cashRegisterId, status: 'OPEN' }
      });
      if (alreadyOpen) throw conflict('Ya existe un turno abierto para esta caja.', ErrorCodes.CASH_SHIFT_ALREADY_OPEN);

      const shift = await tx.cashShift.create({
        data: {
          cashRegisterId: input.cashRegisterId,
          clubId,
          openedByUserId,
          openingAmount: new Prisma.Decimal(input.openingAmount),
          status: 'OPEN'
        }
      });

      await this.projectionService.refreshCashShiftSummary(shift.id, tx);
      return shift;
    });
  }

  /** Efectivo que entra y sale del cajón (lo que hay que contar al cerrar). */
  private cashDelta(movements: Array<{ amount: unknown; method: string; type: string }>) {
    return movements.reduce((sum, movement) => {
      const amount = Number(movement.amount || 0);
      if (movement.method !== 'CASH') return sum;
      if (movement.type === 'PAYMENT_IN' || movement.type === 'DEPOSIT') return sum + amount;
      if (movement.type === 'WITHDRAW' || movement.type === 'REFUND') return sum - amount;
      return sum;
    }, 0);
  }

  /** Lo cobrado por medios digitales (transferencia, tarjeta, etc.) en el turno. */
  private digitalDelta(movements: Array<{ amount: unknown; method: string; type: string }>) {
    return movements.reduce((sum, movement) => {
      const amount = Number(movement.amount || 0);
      if (movement.method === 'CASH') return sum;
      if (movement.type === 'PAYMENT_IN' || movement.type === 'DEPOSIT') return sum + amount;
      if (movement.type === 'WITHDRAW' || movement.type === 'REFUND') return sum - amount;
      return sum;
    }, 0);
  }

  /** Qué pasó en el turno, en palabras del mostrador: efectivo que entró/salió y lo digital por medio. */
  private breakdown(movements: Array<{ amount: unknown; method: string; type: string }>) {
    const result = { cashIn: 0, cashOut: 0, transfer: 0, card: 0, other: 0 };
    movements.forEach((movement) => {
      const amount = Number(movement.amount || 0);
      const sign =
        movement.type === 'PAYMENT_IN' || movement.type === 'DEPOSIT'
          ? 1
          : movement.type === 'WITHDRAW' || movement.type === 'REFUND'
            ? -1
            : 0;
      if (!sign) return;
      if (movement.method === 'CASH') {
        if (sign > 0) result.cashIn += amount;
        else result.cashOut += amount;
      } else if (movement.method === 'TRANSFER') result.transfer += sign * amount;
      else if (movement.method === 'CARD') result.card += sign * amount;
      else result.other += sign * amount;
    });
    return {
      cashIn: this.roundMoney(result.cashIn),
      cashOut: this.roundMoney(result.cashOut),
      transfer: this.roundMoney(result.transfer),
      card: this.roundMoney(result.card),
      other: this.roundMoney(result.other)
    };
  }

  /** Últimos cierres de caja del club, del más nuevo al más viejo. */
  async listClosed(clubId: number, limit = 10) {
    const rows = await prismaRead.cashShift.findMany({
      where: { status: 'CLOSED', cashRegister: { clubId } },
      include: { cashRegister: true, movements: { select: { amount: true, method: true, type: true } } },
      orderBy: { closedAt: 'desc' },
      take: Math.min(50, Math.max(1, Math.floor(limit)))
    });
    return rows.map((shift) => ({
      ...shift,
      digitalAmount: this.roundMoney(this.digitalDelta(shift.movements as any)),
      breakdown: this.breakdown(shift.movements as any)
    }));
  }

  async current(clubId: number) {
    const shift = await prismaRead.cashShift.findFirst({
      where: {
        status: 'OPEN',
        cashRegister: { clubId }
      },
      include: {
        cashRegister: true,
        movements: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { openedAt: 'desc' }
    });
    if (!shift) return null;

    const [summary, policy] = await Promise.all([
      this.getOpenAccountsSummaryTx(prismaRead, clubId),
      this.getClosePolicyTx(prismaRead, clubId)
    ]);

    return {
      ...shift,
      // Turno abierto: lo esperado en el cajón se calcula en vivo (al cerrar queda guardado).
      expectedCash: this.roundMoney(Number(shift.openingAmount || 0) + this.cashDelta(shift.movements as any)),
      digitalAmount: this.roundMoney(this.digitalDelta(shift.movements as any)),
      breakdown: this.breakdown(shift.movements as any),
      openAccountsSummary: summary,
      closePolicy: policy
    };
  }

  async close(clubId: number, shiftId: string, countedCash: number, actorUserId?: number) {
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      throw badRequest('Monto contado en efectivo inválido.', ErrorCodes.INVALID_INPUT);
    }

    return prisma.$transaction(async (tx) => {
      const shift = await tx.cashShift.findFirst({
        where: {
          id: shiftId,
          status: 'OPEN',
          cashRegister: { clubId }
        },
        include: { movements: true, payments: true }
      });

      if (!shift) throw notFound('Turno de caja abierto no encontrado.', ErrorCodes.NO_ACTIVE_CASH_SHIFT);

      const [openAccountsSummary, closePolicy] = await Promise.all([
        this.getOpenAccountsSummaryTx(tx, clubId),
        this.getClosePolicyTx(tx, clubId)
      ]);

      if (closePolicy.strict && openAccountsSummary.openAccounts > 0) {
        throw conflict('No se puede cerrar la caja: hay cuentas abiertas con saldo pendiente.', ErrorCodes.CASH_SHIFT_CLOSE_BLOCKED, { openAccounts: openAccountsSummary.openAccounts, pendingAmount: openAccountsSummary.pendingAmount });
      }

      const movementDelta = this.cashDelta(shift.movements as any);

      const expectedCash = Number(shift.openingAmount || 0) + movementDelta;
      const difference = countedCash - expectedCash;

      const closeResult = await tx.cashShift.updateMany({
        where: {
          id: shift.id,
          status: 'OPEN'
        },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCash: new Prisma.Decimal(expectedCash),
          countedCash: new Prisma.Decimal(countedCash),
          difference: new Prisma.Decimal(difference)
        }
      });

      if (closeResult.count === 0) {
        throw conflict('El turno de caja ya estaba cerrado.', ErrorCodes.CASH_SHIFT_NOT_FOUND);
      }

      const closedShift = await tx.cashShift.findUnique({ where: { id: shift.id } });
      if (!closedShift) {
        throw notFound('Turno de caja no encontrado luego del cierre.', ErrorCodes.CASH_SHIFT_NOT_FOUND);
      }

      if (Math.abs(difference) > 0.009) {
        await this.accountingService.createCashDifferenceAdjustment(tx, {
          clubId,
          referenceId: closedShift.id,
          amount: difference,
          description: `Ajuste cierre caja turno ${closedShift.id}`,
          createdByUserId: actorUserId ?? null
        });
      }

      await this.projectionService.refreshCashShiftSummary(closedShift.id, tx);
      return {
        ...closedShift,
        openAccountsSummary,
        closePolicy
      };
    });
  }

  async report(clubId: number, shiftId: string) {
    const shift = await prismaRead.cashShift.findFirst({
      where: { id: shiftId, cashRegister: { clubId } },
      include: {
        cashRegister: true,
        movements: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!shift) throw notFound('Turno no encontrado.', ErrorCodes.CASH_SHIFT_NOT_FOUND);

    const totals = shift.movements.reduce(
      (acc, movement) => {
        const amount = Number(movement.amount || 0);
        if (movement.type === 'PAYMENT_IN') acc.paymentIn += amount;
        if (movement.type === 'DEPOSIT') acc.deposit += amount;
        if (movement.type === 'WITHDRAW') acc.withdraw += amount;
        if (movement.type === 'REFUND') acc.refund += amount;
        return acc;
      },
      { paymentIn: 0, deposit: 0, withdraw: 0, refund: 0 }
    );

    const projection = USE_PROJECTION_READ_MODELS
      ? await prismaRead.cashShiftSummaryProjection.findUnique({ where: { shiftId } })
      : null;

    return {
      shift: {
        ...shift,
        digitalAmount: this.roundMoney(this.digitalDelta(shift.movements as any)),
        breakdown: this.breakdown(shift.movements as any)
      },
      totals: projection
        ? {
            paymentIn: Number(projection.paymentIn || 0),
            deposit: Number(projection.deposit || 0),
            withdraw: Number(projection.withdraw || 0),
            refund: Number(projection.refund || 0)
          }
        : totals,
      expectedCash: projection ? Number(projection.expectedCash || 0) : Number(shift.expectedCash || 0),
      countedCash: projection ? Number(projection.countedCash || 0) : Number(shift.countedCash || 0),
      difference: projection ? Number(projection.difference || 0) : Number(shift.difference || 0)
    };
  }
}
