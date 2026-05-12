// modules/cuentas/accountUtils.ts
//
// Tipos, constantes y helpers compartidos para gestión de cuentas.
// Usado por AccountDrawer, pagos-playground y clientes-playground2.
// ──────────────────────────────────────────────────────────────────

export type { PaymentMethod, PaymentChannel } from '../../services/AccountService';

// ─── Constantes ───────────────────────────────────────────────────────────────

export const ACCOUNT_PAYMENT_EPSILON = 0.009;
/** ID sintético cuando la cuenta no tiene items con datos de allocación. */
export const SYNTHETIC_ACCOUNT_TOTAL_ITEM_ID = '__account-total__';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AccountStatus = 'OPEN' | 'CLOSED';

export type PaymentQuickPreset = 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';

export type AccountDetailPaymentAllocation = {
  id?: string;
  accountItemId: string;
  amount: number;
};

export type AccountDetailItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  createdAt: string;
};

export type AccountDetailPayment = {
  id: string;
  amount: number;
  method: string;
  channel: string;
  allocations: AccountDetailPaymentAllocation[];
  createdAt: string;
};

export type AccountDetail = {
  id: string;
  status: AccountStatus;
  sourceType: string;
  total: number;
  paid: number;
  remaining: number;
  items: AccountDetailItem[];
  payments: AccountDetailPayment[];
  client: { id: string; name: string; phone: string | null; email: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PendingItemRow = {
  id: string;
  type: string;
  label: string;
  remainingAmount: number;
};

export type PaymentPreviewRow = {
  id: string;
  label: string;
  amount: number;
};

export type PaymentResultData = {
  variant: 'success' | 'error';
  title: string;
  detail: string;
  requestedAmount: number;
  appliedAmount: number;
  remainingAfter: number;
  methodLabel: string;
  appliedItems: Array<{ id: string; label: string; amount: number }>;
};

// ─── Formatters ───────────────────────────────────────────────────────────────

export const formatMoney = (value: number) =>
  `$${Number(value || 0).toLocaleString('es-AR')}`;

export const shortCode = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 5)}...${raw.slice(-3)}`;
};

export const paymentMethodLabel = (method: string): string => {
  const n = String(method || '').toUpperCase();
  if (n === 'CASH') return 'Efectivo';
  if (n === 'TRANSFER') return 'Transferencia';
  if (n === 'CARD') return 'Tarjeta';
  return method || '-';
};

export const paymentChannelLabel = (channel: string): string => {
  const n = String(channel || '').toUpperCase();
  if (!n) return '-';
  if (n === 'BANK_ACCOUNT') return 'Cuenta bancaria';
  if (n === 'VIRTUAL_WALLET') return 'Billetera virtual';
  if (n === 'CASH_DRAWER') return 'Caja';
  if (n === 'CARD_TERMINAL') return 'Terminal';
  return channel;
};

export const formatRelativeDate = (isoString: string): string => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return '-';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return 'Hace un momento';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Ayer';
  if (diffD < 7) return `Hace ${diffD} días`;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
};

export const itemTypeLabel = (type: string): string => {
  const n = String(type || '').toUpperCase();
  if (n === 'BOOKING') return 'Cancha';
  if (n === 'PRODUCT') return 'Producto';
  if (n === 'SERVICE') return 'Servicio';
  if (n === 'ADJUSTMENT') return 'Ajuste';
  return 'Concepto';
};

// ─── Normalizador de detalle crudo de API ────────────────────────────────────

export const normalizeAccountDetail = (raw: any, fallbackId: string): AccountDetail => {
  // The API returns { account: {...}, items: [...], payments: [...], total, paid, remaining }
  // sourceType and client are nested in raw.account (or directly on raw if pre-flattened)
  const accountMeta = raw?.account ?? raw;
  const rawClient = accountMeta?.client ?? null;
  return {
    id: String(raw?.id || accountMeta?.id || fallbackId),
    status: String(raw?.status || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
    sourceType: String(accountMeta?.sourceType || ''),
    total: Number(raw?.total || 0),
    paid: Number(raw?.paid || 0),
    remaining: Number(raw?.remaining || 0),
    client: rawClient
      ? {
          id: String(rawClient.id || ''),
          name: String(rawClient.name || ''),
          phone: rawClient.phone ? String(rawClient.phone) : null,
          email: rawClient.email ? String(rawClient.email) : null,
        }
      : null,
    items: (Array.isArray(raw?.items) ? raw.items : []).map((item: any) => ({
      id: String(item?.id || ''),
      type: String(item?.type || 'OTHER'),
      description: String(item?.description || 'Concepto'),
      quantity: Number(item?.quantity || 1),
      total: Number(item?.total || 0),
      createdAt: String(item?.createdAt || ''),
    })),
    payments: (Array.isArray(raw?.payments) ? raw.payments : []).map((payment: any) => ({
      id: String(payment?.id || ''),
      amount: Number(payment?.amount || 0),
      method: String(payment?.method || ''),
      channel: String(payment?.channel || ''),
      allocations: (Array.isArray(payment?.allocations) ? payment.allocations : [])
        .map((a: any) => ({
          id: a?.id ? String(a.id) : undefined,
          accountItemId: String(a?.accountItemId || ''),
          amount: Number(a?.amount || 0),
        }))
        .filter(
          (a: AccountDetailPaymentAllocation) =>
            a.accountItemId && a.amount > ACCOUNT_PAYMENT_EPSILON
        ),
      createdAt: String(payment?.createdAt || ''),
    })),
    createdAt: String(raw?.createdAt || ''),
    updatedAt: String(raw?.updatedAt || ''),
  };
};

// ─── Helpers de cómputo de cobro ─────────────────────────────────────────────

/**
 * Devuelve una fila por cada item pendiente de cobro en la cuenta.
 * Si no hay items con datos de allocación usa `SYNTHETIC_ACCOUNT_TOTAL_ITEM_ID`.
 */
export const buildPendingItemRows = (detail: AccountDetail | null): PendingItemRow[] => {
  const items = Array.isArray(detail?.items) ? detail!.items : [];
  const remaining = Math.max(0, Number(detail?.remaining || 0));

  if (items.length === 0 && remaining > ACCOUNT_PAYMENT_EPSILON) {
    return [
      {
        id: SYNTHETIC_ACCOUNT_TOTAL_ITEM_ID,
        type: 'OTHER',
        label: 'Saldo pendiente',
        remainingAmount: Number(remaining.toFixed(2)),
      },
    ];
  }

  const buildRow = (item: AccountDetailItem, amount: number): PendingItemRow => ({
    id: String(item.id),
    type: String(item.type || 'OTHER').toUpperCase(),
    label:
      String(item.type || '').toUpperCase() === 'BOOKING'
        ? 'Cancha'
        : String(item.description || 'Concepto'),
    remainingAmount: Number(Math.max(0, amount).toFixed(2)),
  });

  // Construir mapa de allocaciones ya cobradas por item
  const allocatedByItemId = new Map<string, number>();
  const payments = Array.isArray(detail?.payments) ? detail!.payments : [];
  for (const payment of payments) {
    for (const allocation of payment.allocations || []) {
      const itemId = String(allocation.accountItemId || '').trim();
      if (!itemId) continue;
      const prev = Number(allocatedByItemId.get(itemId) || 0);
      allocatedByItemId.set(
        itemId,
        Number((prev + Number(allocation.amount || 0)).toFixed(2))
      );
    }
  }

  if (allocatedByItemId.size > 0) {
    const rows = items
      .map((item) => {
        const total = Math.max(0, Number(item.total || 0));
        const allocated = Math.max(
          0,
          Number(allocatedByItemId.get(String(item.id)) || 0)
        );
        return buildRow(item, total - allocated);
      })
      .filter((item) => item.remainingAmount > ACCOUNT_PAYMENT_EPSILON);
    const rowsTotal = rows.reduce(
      (sum, item) => sum + Number(item.remainingAmount || 0),
      0
    );
    if (rowsTotal + ACCOUNT_PAYMENT_EPSILON >= remaining) return rows;
  }

  // Fallback: distribuir remaining proporcionalmente
  let remainingDraft = remaining;
  return items
    .map((item) => {
      const requested = Math.max(0, Number(item.total || 0));
      const amount = Number(
        Math.min(requested, Math.max(0, remainingDraft)).toFixed(2)
      );
      remainingDraft = Number(Math.max(0, remainingDraft - amount).toFixed(2));
      return buildRow(item, amount);
    })
    .filter((item) => item.remainingAmount > ACCOUNT_PAYMENT_EPSILON);
};

export const resolvePresetItemIds = (
  preset: PaymentQuickPreset,
  pendingRows: PendingItemRow[]
): string[] => {
  if (preset === 'COURT_ONLY') {
    return pendingRows
      .filter((item) => item.type === 'BOOKING')
      .map((item) => String(item.id));
  }
  return pendingRows.map((item) => String(item.id));
};

export const resolveCustomDraftAmount = (
  itemId: string,
  maxForItem: number,
  customDraftById: Record<string, string>
): number => {
  const normalizedMax = Math.max(0, Number(maxForItem || 0));
  const hasDraft = Object.prototype.hasOwnProperty.call(customDraftById, itemId);
  if (!hasDraft) return normalizedMax;
  const rawDraft = String(customDraftById[itemId] ?? '').trim();
  if (rawDraft === '') return 0;
  const parsed = Number(rawDraft.replace(',', '.'));
  if (!Number.isFinite(parsed)) return normalizedMax;
  return Math.max(0, Math.min(normalizedMax, parsed));
};

export const computeConceptBasedMaxAmount = (
  preset: PaymentQuickPreset,
  pendingRows: PendingItemRow[],
  accountMaxAmount: number,
  selectedIds?: string[],
  customAmountDraftById?: Record<string, string>
): number => {
  const customDrafts = customAmountDraftById ?? {};
  const allowedIds =
    preset === 'CUSTOM_ITEMS'
      ? new Set(
          (selectedIds || []).map((v) => String(v || '').trim()).filter(Boolean)
        )
      : new Set(resolvePresetItemIds(preset, pendingRows));

  if (preset === 'CUSTOM_ITEMS') {
    return Number(
      Math.min(
        accountMaxAmount,
        pendingRows
          .filter((item) => allowedIds.has(String(item.id)))
          .reduce((sum, item) => {
            const resolved = resolveCustomDraftAmount(
              String(item.id),
              Number(item.remainingAmount || 0),
              customDrafts
            );
            return sum + resolved;
          }, 0)
      ).toFixed(2)
    );
  }

  return Number(
    Math.min(
      accountMaxAmount,
      pendingRows
        .filter((item) => allowedIds.has(String(item.id)))
        .reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0)
    ).toFixed(2)
  );
};

export const buildPaymentPreviewRows = (
  preset: PaymentQuickPreset,
  pendingRows: PendingItemRow[],
  selectedIds: string[],
  customAmountDraftById: Record<string, string>,
  amountNumeric: number
): PaymentPreviewRow[] => {
  const activeIds =
    preset === 'CUSTOM_ITEMS'
      ? selectedIds
      : resolvePresetItemIds(preset, pendingRows);
  const selectedSet = new Set(
    activeIds.map((v) => String(v || '').trim()).filter(Boolean)
  );
  let remaining = Number(Math.max(0, amountNumeric).toFixed(2));
  const rows: PaymentPreviewRow[] = [];

  for (const item of pendingRows) {
    if (!selectedSet.has(String(item.id))) continue;
    if (remaining <= ACCOUNT_PAYMENT_EPSILON) break;
    const itemId = String(item.id);
    const maxForItem = Number(item.remainingAmount || 0);
    const desired =
      preset === 'CUSTOM_ITEMS'
        ? resolveCustomDraftAmount(itemId, maxForItem, customAmountDraftById)
        : maxForItem;
    const amount = Number(Math.min(desired, remaining).toFixed(2));
    if (amount <= ACCOUNT_PAYMENT_EPSILON) continue;
    rows.push({ id: itemId, label: item.label, amount });
    remaining = Number((remaining - amount).toFixed(2));
  }

  return rows;
};
