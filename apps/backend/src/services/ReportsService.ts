import { BookingStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../prisma';
import { TimeHelper } from '../utils/TimeHelper';
import { ErrorCodes, badRequest, validationError } from '../errors';
import { CashService } from './CashService';
import { CashRepository } from '../repositories/CashRepository';

type SourceType = 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT';

type ReportsServiceDeps = {
  prismaClient?: typeof prisma;
  cashService?: Pick<CashService, 'getPosReport'>;
};

const ACCOUNT_SOURCE_LABELS: Record<SourceType, string> = {
  BOOKING: 'Reservas',
  BAR: 'POS',
  TABLE: 'Mesa',
  MANUAL: 'Manual',
  CLASS_PASS: 'Academia',
  CLASS_ENROLLMENT: 'Academia',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

type LocalDateRange = {
  timeZone: string;
  startDate: string;
  endDate: string;
  startUtc: Date;
  endUtc: Date;
};

export class ReportsService {
  private readonly prismaClient: typeof prisma;
  private readonly cashService: Pick<CashService, 'getPosReport'>;

  constructor(deps?: ReportsServiceDeps) {
    this.prismaClient = deps?.prismaClient ?? prisma;
    this.cashService = deps?.cashService ?? new CashService(new CashRepository());
  }

  private roundMoney(value: number) {
    return Number(Number(value || 0).toFixed(2));
  }

  private parseLocalDateInput(value: string): Date | null {
    const normalized = String(value || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const [year, month, day] = normalized.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return new Date(year, month - 1, day);
  }

  private async resolveRange(clubId: number, startDate?: string, endDate?: string): Promise<LocalDateRange> {
    const club = await this.prismaClient.club.findUnique({
      where: { id: clubId },
      include: { settings: true },
    });
    const timeZone = String(club?.settings?.timeZone || '').trim();
    if (!timeZone) {
      throw badRequest('Configuración de club inválida: timeZone es obligatorio.', ErrorCodes.CLUB_CONFIG_INVALID);
    }

    const nowLocal = TimeHelper.utcToLocal(new Date(), timeZone);
    let startLocal = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), 1);
    let endLocal = new Date(nowLocal.getFullYear(), nowLocal.getMonth() + 1, 0);

    if (startDate || endDate) {
      if (!startDate || !endDate) {
        throw validationError('Revisá los campos marcados.', {
          startDate: 'Completá la fecha desde.',
          endDate: 'Completá la fecha hasta.',
        });
      }

      const parsedStart = this.parseLocalDateInput(startDate);
      const parsedEnd = this.parseLocalDateInput(endDate);
      if (!parsedStart || !parsedEnd) {
        throw validationError('Revisá los campos marcados.', {
          startDate: 'Ingresá una fecha válida.',
          endDate: 'Ingresá una fecha válida.',
        });
      }
      if (parsedStart.getTime() > parsedEnd.getTime()) {
        throw validationError('Revisá los campos marcados.', {
          startDate: 'La fecha desde no puede ser mayor a la fecha hasta.',
          endDate: 'La fecha hasta debe ser igual o posterior a la fecha desde.',
        });
      }

      const diffDays = Math.floor((parsedEnd.getTime() - parsedStart.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays > 366) {
        throw validationError('Revisá los campos marcados.', {
          endDate: 'El rango máximo permitido es de 366 días.',
        });
      }

      startLocal = parsedStart;
      endLocal = parsedEnd;
    }

    const startRange = TimeHelper.getUtcRangeForLocalDate(startLocal, timeZone);
    const endRange = TimeHelper.getUtcRangeForLocalDate(endLocal, timeZone);

    const toLocalDate = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

    return {
      timeZone,
      startDate: toLocalDate(startLocal),
      endDate: toLocalDate(endLocal),
      startUtc: startRange.startUtc,
      endUtc: endRange.endUtc,
    };
  }

  async getAdminDashboardReport(clubId: number, startDate?: string, endDate?: string) {
    const range = await this.resolveRange(clubId, startDate, endDate);

    const [payments, bookings, pendingAccountsRaw, refundsExecuted, posReport] = await Promise.all([
      this.prismaClient.payment.findMany({
        where: {
          account: { clubId },
          createdAt: { gte: range.startUtc, lte: range.endUtc },
        },
        select: {
          id: true,
          amount: true,
          method: true,
          account: {
            select: {
              sourceType: true,
            },
          },
        },
      }),
      this.prismaClient.booking.findMany({
        where: {
          clubId,
          startDateTime: { gte: range.startUtc, lte: range.endUtc },
        },
        select: {
          status: true,
        },
      }),
      this.prismaClient.account.findMany({
        where: {
          clubId,
          createdAt: { lte: range.endUtc },
        },
        select: {
          id: true,
          displayCode: true,
          sourceType: true,
          sourceId: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          createdAt: true,
          client: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaClient.refund.findMany({
        where: {
          clubId,
          status: 'EXECUTED',
          executedAt: { gte: range.startUtc, lte: range.endUtc },
        },
        select: {
          amount: true,
        },
      }),
      this.cashService.getPosReport(clubId, range.startDate, range.endDate),
    ]);

    const byMethodMap = new Map<string, { method: PaymentMethod | 'OTHER'; label: string; count: number; total: number }>();
    const bySourceMap = new Map<SourceType, { sourceType: SourceType; label: string; count: number; total: number }>();
    let collectedTotal = 0;

    for (const payment of payments) {
      const amount = this.roundMoney(Number(payment.amount || 0));
      const method = (String(payment.method || 'OTHER').toUpperCase() || 'OTHER') as PaymentMethod | 'OTHER';
      const sourceType = (String(payment.account?.sourceType || 'MANUAL').toUpperCase() || 'MANUAL') as SourceType;

      collectedTotal = this.roundMoney(collectedTotal + amount);

      const methodEntry = byMethodMap.get(method) || {
        method,
        label: PAYMENT_METHOD_LABELS[method] || method,
        count: 0,
        total: 0,
      };
      methodEntry.count += 1;
      methodEntry.total = this.roundMoney(methodEntry.total + amount);
      byMethodMap.set(method, methodEntry);

      const sourceEntry = bySourceMap.get(sourceType) || {
        sourceType,
        label: ACCOUNT_SOURCE_LABELS[sourceType] || sourceType,
        count: 0,
        total: 0,
      };
      sourceEntry.count += 1;
      sourceEntry.total = this.roundMoney(sourceEntry.total + amount);
      bySourceMap.set(sourceType, sourceEntry);
    }

    const bookingCounts: Record<BookingStatus, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    for (const booking of bookings) {
      const status = booking.status as BookingStatus;
      bookingCounts[status] = Number(bookingCounts[status] || 0) + 1;
    }

    const pendingAccounts = pendingAccountsRaw
      .map((account) => {
        const total = this.roundMoney(Number(account.totalAmount || 0));
        const paid = this.roundMoney(Number(account.paidAmount || 0));
        const pending = this.roundMoney(Math.max(0, total - paid));
        const isVoided = String(account.sourceId || '').startsWith('VOID-');
        const createdAt = new Date(account.createdAt);
        const ageDays = Math.max(
          0,
          Math.floor((range.endUtc.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
        );

        return {
          id: account.id,
          label: account.displayCode || account.id,
          sourceType: account.sourceType,
          sourceLabel: ACCOUNT_SOURCE_LABELS[account.sourceType as SourceType] || account.sourceType,
          status: isVoided ? 'VOIDED' : account.status,
          clientName: account.client?.name || 'Consumidor final',
          total,
          paid,
          pending,
          ageDays,
          createdAt: account.createdAt,
        };
      })
      .filter((account) => account.pending > 0 && account.status !== 'VOIDED')
      .sort((a, b) => b.ageDays - a.ageDays || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const pendingTotal = pendingAccounts.reduce((sum, account) => this.roundMoney(sum + account.pending), 0);
    const refundedTotal = refundsExecuted.reduce(
      (sum, refund) => this.roundMoney(sum + Number(refund.amount || 0)),
      0
    );

    return {
      scope: {
        startDate: range.startDate,
        endDate: range.endDate,
        timeZone: range.timeZone,
      },
      income: {
        totals: {
          collectedTotal,
          pendingTotal,
          refundedTotal,
          voidedTotal: this.roundMoney(Number(posReport?.totals?.voidedTotal || 0)),
        },
        byMethod: Array.from(byMethodMap.values()).sort((a, b) => b.total - a.total),
        byAccountSource: Array.from(bySourceMap.values()).sort((a, b) => b.total - a.total),
      },
      bookings: {
        total: bookings.length,
        byStatus: (['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as BookingStatus[]).map((status) => ({
          status,
          count: bookingCounts[status] || 0,
        })),
      },
      pendingAccounts: {
        openCount: pendingAccounts.length,
        totalPending: pendingTotal,
        accounts: pendingAccounts.slice(0, 50),
      },
      pos: {
        totals: posReport.totals,
        paymentsByMethod: posReport.paymentsByMethod,
        openAccountsCount: posReport.accounts.filter((account) => account.status === 'OPEN').length,
        closedAccountsCount: posReport.accounts.filter((account) => account.status === 'CLOSED').length,
        byProduct: posReport.byProduct.slice(0, 8),
        byService: posReport.byService.slice(0, 8),
      },
    };
  }
}
