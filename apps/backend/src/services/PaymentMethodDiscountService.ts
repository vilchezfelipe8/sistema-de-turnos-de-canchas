import { PaymentMethod, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export const DISCOUNTABLE_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'CARD'] as const;
export type DiscountablePaymentMethod = (typeof DISCOUNTABLE_PAYMENT_METHODS)[number];
/** Claves de descuento: medios del mostrador + ONLINE (Mercado Pago desde la app). */
export type PaymentDiscountKey = DiscountablePaymentMethod | 'ONLINE';
export type PaymentMethodDiscounts = Record<PaymentDiscountKey, number>;

const MAX_PERCENT = 90;

const METHOD_LABELS: Record<PaymentDiscountKey, string> = {
  CASH: 'pago en efectivo',
  TRANSFER: 'pago por transferencia',
  CARD: 'pago con tarjeta',
  ONLINE: 'pago online',
};

/** Marca de las DiscountPolicy internas (no asignables a clientes, no se listan). */
export const PAYMENT_METHOD_POLICY_MARKER_PREFIX = 'SYSTEM:PAYMENT_METHOD:';

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const clampPercent = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Number(n.toFixed(2)), MAX_PERCENT);
};

/** Normaliza el JSON guardado en ClubSettings.paymentMethodDiscounts. */
export const normalizePaymentMethodDiscounts = (raw: unknown): PaymentMethodDiscounts => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    CASH: clampPercent(source.CASH),
    TRANSFER: clampPercent(source.TRANSFER),
    CARD: clampPercent(source.CARD),
    ONLINE: clampPercent(source.ONLINE),
  };
};

/** Si la app muestra el precio efectivo al jugador (default: sí). Vive en el mismo JSON. */
export const readShowCashPriceInApp = (raw: unknown) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return source.showCashPriceInApp !== false;
};

/** Lo que la app pública puede mostrarle al jugador. */
export const buildPublicPriceHints = (raw: unknown) => {
  const discounts = normalizePaymentMethodDiscounts(raw);
  return {
    cashPercent: readShowCashPriceInApp(raw) ? discounts.CASH : 0,
    onlinePercent: discounts.ONLINE,
  };
};

/** Monto con descuento, redondeando por ítem como al registrar el pago. */
export const applyPercentToAmounts = (amounts: number[], percent: number) =>
  roundMoney(
    splitAllocationsWithDiscount(
      amounts.map((amount, index) => ({ accountItemId: String(index), amount })),
      percent
    ).reduce((sum, split) => sum + split.chargedAmount, 0)
  );

export const getPaymentMethodDiscountPercent = (discounts: PaymentMethodDiscounts, method: PaymentMethod) =>
  (DISCOUNTABLE_PAYMENT_METHODS as readonly string[]).includes(method)
    ? discounts[method as DiscountablePaymentMethod] || 0
    : 0;

export type ListAllocation = { accountItemId: string; amount: number };

export type MethodDiscountSplit = {
  accountItemId: string;
  listAmount: number;
  discountAmount: number;
  chargedAmount: number;
};

/**
 * Parte cada asignación a precio de lista en descuento + monto a cobrar.
 * El descuento se redondea a centavos por ítem; lo cobrado es lista - descuento.
 */
export const splitAllocationsWithDiscount = (allocations: ListAllocation[], percent: number): MethodDiscountSplit[] =>
  allocations.map((allocation) => {
    const listAmount = roundMoney(allocation.amount);
    const discountAmount = roundMoney((listAmount * percent) / 100);
    return {
      accountItemId: allocation.accountItemId,
      listAmount,
      discountAmount,
      chargedAmount: roundMoney(listAmount - discountAmount),
    };
  });

export class PaymentMethodDiscountService {
  async getClubDiscountsTx(tx: Tx, clubId: number): Promise<PaymentMethodDiscounts> {
    const settings = await tx.clubSettings.findUnique({
      where: { clubId },
      select: { paymentMethodDiscounts: true },
    });
    return normalizePaymentMethodDiscounts(settings?.paymentMethodDiscounts);
  }

  /** Política interna por método (inactiva: nunca se aplica sola al crear ítems). */
  async getOrCreateSystemPolicyTx(tx: Tx, clubId: number, method: PaymentDiscountKey, percent: number) {
    const marker = `${PAYMENT_METHOD_POLICY_MARKER_PREFIX}${method}`;
    const existing = await tx.discountPolicy.findFirst({ where: { clubId, description: marker }, select: { id: true } });
    if (existing) {
      await tx.discountPolicy.update({ where: { id: existing.id }, data: { amountValue: new Prisma.Decimal(percent) } });
      return existing.id;
    }
    const created = await tx.discountPolicy.create({
      data: {
        clubId,
        name: `Descuento ${METHOD_LABELS[method]}`,
        description: marker,
        scope: 'ALL',
        amountType: 'PERCENT',
        amountValue: new Prisma.Decimal(percent),
        isActive: false,
        isStackable: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Aplica el descuento sobre los ítems cobrados: baja el total de cada ítem y de la cuenta,
   * registra el ajuste contable (ingreso ↓ / a cobrar ↓) y deja el detalle en AccountItemDiscount.
   */
  async applyToItemsTx(
    tx: Tx,
    params: {
      clubId: number;
      accountId: string;
      clientId?: string | null;
      method: PaymentDiscountKey;
      percent: number;
      splits: MethodDiscountSplit[];
      items: Array<{ id: string; type: string; total: Prisma.Decimal | number }>;
      actorUserId?: number | null;
      postAdjustment: (input: {
        accountItemId: string;
        amount: number;
        revenueAccount: 'BOOKING_REVENUE' | 'BAR_REVENUE' | 'ADJUSTMENTS';
        description: string;
      }) => Promise<unknown>;
    }
  ) {
    const discounted = params.splits.filter((split) => split.discountAmount > 0);
    if (discounted.length === 0) return 0;

    const policyId = await this.getOrCreateSystemPolicyTx(tx, params.clubId, params.method, params.percent);
    const itemById = new Map(params.items.map((item) => [item.id, item]));
    let totalDiscount = 0;

    for (const split of discounted) {
      const item = itemById.get(split.accountItemId);
      if (!item) continue;
      const previousTotal = roundMoney(Number(item.total || 0));
      const nextTotal = roundMoney(previousTotal - split.discountAmount);

      await tx.accountItem.update({
        where: { id: split.accountItemId },
        data: { total: new Prisma.Decimal(nextTotal) },
      });

      await tx.accountItemDiscount.upsert({
        where: { accountItemId_policyId: { accountItemId: split.accountItemId, policyId } },
        update: {
          discountAmount: { increment: new Prisma.Decimal(split.discountAmount) },
          finalAmount: new Prisma.Decimal(nextTotal),
        },
        create: {
          clubId: params.clubId,
          accountItemId: split.accountItemId,
          clientId: params.clientId ?? null,
          policyId,
          scope: 'ALL',
          amountType: 'PERCENT',
          amountValue: new Prisma.Decimal(params.percent),
          baseAmount: new Prisma.Decimal(previousTotal),
          discountAmount: new Prisma.Decimal(split.discountAmount),
          finalAmount: new Prisma.Decimal(nextTotal),
          appliedByUserId: params.actorUserId ?? null,
        },
      });

      await params.postAdjustment({
        accountItemId: split.accountItemId,
        amount: split.discountAmount,
        revenueAccount: item.type === 'BOOKING' ? 'BOOKING_REVENUE' : item.type === 'PRODUCT' ? 'BAR_REVENUE' : 'ADJUSTMENTS',
        description: `Descuento ${METHOD_LABELS[params.method]} (${params.percent}%)`,
      });

      itemById.set(split.accountItemId, { ...item, total: nextTotal });
      totalDiscount = roundMoney(totalDiscount + split.discountAmount);
    }

    await tx.account.update({
      where: { id: params.accountId },
      data: { totalAmount: { decrement: new Prisma.Decimal(totalDiscount) } },
    });

    return totalDiscount;
  }
}
