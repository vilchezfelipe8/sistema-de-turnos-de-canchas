import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Landmark,
  Plus,
  Play,
  RotateCcw,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/router';
import AdminPlaygroundShell from '../../components/admin/AdminPlaygroundShell';
import MetricCard from '../../components/admin/ui/MetricCard';
import CashSummaryCards from '../../modules/caja/components/CashSummaryCards';
import CashTodayToCollect, { type CashTodayItem } from '../../modules/caja/components/CashTodayToCollect';
import CashMovementsTimeline from '../../modules/caja/components/CashMovementsTimeline';
import CashAccountsList from '../../modules/caja/components/CashAccountsList';
import type { CashAccountItem } from '../../modules/caja/components/CashAccountsList';
import CashAccountDetailPanel from '../../modules/caja/components/CashAccountDetailPanel';
import CashCloseFlow from '../../modules/caja/components/CashCloseFlow';
import {
  CashCloseRecap,
  CashClosedShiftCard,
  CashClosesHistory,
  type CashClosedShift,
  type CashShiftBreakdown,
} from '../../modules/caja/components/CashCloseRecap';
import CashShiftPanel from '../../modules/caja/components/CashShiftPanel';
import AccountDrawer, {
  type AccountDrawerContext,
  type AccountDrawerInitialView,
  type AccountDrawerSuccessMeta,
} from '../../modules/cuentas/components/AccountDrawer';
import { AdminDrawer, AdminDrawerSection, AdminFeedbackBanner, AdminFilterToolbar, AdminPanel, AdminSegmentedControl } from '../../components/admin/ui';
import AdminAppModal from '../../components/admin/ui/AdminAppModal';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import {
  getAccountById,
  listAccounts,
  openAccount,
  type AccountStatus,
} from '../../services/AccountService';
import { CashService } from '../../services/CashService';
import { PlayerPricingService } from '../../services/PlayerPricingService';
import { searchClients } from '../../services/BookingService';
import { ClubService } from '../../services/ClubService';
import {
  approveRefund,
  cancelRefund,
  executeRefund,
  failRefund,
  listPendingRefunds,
  listRefunds,
  requestPaymentRefund,
  retryRefund,
  type RefundExecutionMethod,
  type RefundReasonType,
  type RefundRecord,
} from '../../services/PaymentService';
import { formatDateTime24 } from '../../utils/dateTime';
import { getActiveClubSlug, hasOperatorAccess, normalizeSessionUser } from '../../utils/session';
import { getFiscalConfig } from '../../services/FiscalConfigService';
import { showAdminToast } from '../../utils/adminToast';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type PaymentsTab = 'SUMMARY' | 'ACCOUNTS' | 'MOVEMENTS' | 'CLOSURE' | 'REFUNDS' | 'REPORTS';
type CashPeriod = 'hoy' | 'semana' | 'mes';
type PosReportScope = 'shift' | 'period';
type MovementTypeFilter = 'ALL' | 'INCOME' | 'EXPENSE';
type MovementMethodFilter = 'ALL' | 'CASH' | 'TRANSFER' | 'CARD';
type RefundStatusFilter = 'ALL' | 'REQUESTED' | 'APPROVED' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
type RefundMethodFilter = 'ALL' | 'CASH' | 'TRANSFER' | 'CARD_REVERSAL' | 'CREDIT_NOTE';
type RefundActionKind = 'approve' | 'approve_execute' | 'execute' | 'retry' | 'fail' | 'cancel';
type CashView = 'live' | 'movements' | 'closures';
type CashActionSidebarView = 'none' | 'open_shift' | 'close_shift' | 'movement_create' | 'close_report' | 'product_sale';
/** Por cobrar: todo lo que se debe, de cualquier fecha. Pagadas / Todas: por período. */
type AccountsFilter = 'DEBT' | 'PAID' | 'ALL';
type PosItem = {
  type: 'product' | 'service';
  id: number;
  name: string;
  price: number;
  stock: number | null;
  category: string;
};

type PosClientResult = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
};

type PosSerializedItem = {
  productId?: number;
  serviceId?: number;
  quantity: number;
};

type PosReport = {
  scope: { shiftId: string | null; startDate: string; endDate: string };
  totals: {
    salesTotal: number;
    paidTotal: number;
    pendingTotal: number;
    voidedTotal: number;
    productTotal: number;
    serviceTotal: number;
  };
  byProduct: Array<{ productId: number | null; name: string; quantity: number; total: number }>;
  byService: Array<{ name: string; quantity: number; total: number }>;
  paymentsByMethod: Array<{ method: string; count: number; total: number }>;
  accounts: Array<{
    id: string;
    label: string;
    clientName: string;
    status: 'OPEN' | 'CLOSED' | 'VOIDED';
    total: number;
    paid: number;
    pending: number;
    createdAt: string;
    closedAt: string | null;
  }>;
};

// Extrae el UUID del cliente descartando prefijos 'client-' / 'user-'
const resolvePosClientId = (client: PosClientResult | null | undefined): string => {
  const raw = String(client?.id || '').trim();
  if (!raw) return '';
  if (raw.startsWith('client-')) return raw.slice('client-'.length).trim();
  if (raw.startsWith('user-')) return ''; // usuarios del sistema no son clientes del club
  return raw;
};

const serializePosSaleItems = (
  rows: Array<{ productId: string; quantity: string }>,
  catalog: PosItem[]
): PosSerializedItem[] =>
  rows
    .filter((item) => item.productId.includes(':') && Number(item.quantity) >= 1)
    .map((item) => {
      const [itemType, itemIdStr] = item.productId.split(':');
      const itemId = Number(itemIdStr);
      const qty = Number(item.quantity);
      const catalogItem = catalog.find((entry) => entry.type === itemType && entry.id === itemId);
      if (catalogItem?.type === 'service') {
        return { serviceId: itemId, quantity: qty };
      }
      return { productId: itemId, quantity: qty };
    });
type AccountRow = {
  id: string;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT' | 'SUBSCRIPTION_INSTALLMENT';
  status: AccountStatus;
  createdAt: string;
  totalAmount?: number | null;
  paidAmount?: number | null;
  client?: { id?: string; name?: string | null } | null;
  booking?: {
    id?: number;
    startDateTime?: string | null;
    endDateTime?: string | null;
    courtName?: string | null;
    clientName?: string | null;
  } | null;
};

const accountKindLabel: Record<AccountRow['sourceType'], string> = {
  BOOKING: 'Reserva',
  BAR: 'Consumos',
  TABLE: 'Mesa',
  MANUAL: 'Cuenta suelta',
  CLASS_PASS: 'Pack de clases',
  CLASS_ENROLLMENT: 'Clase',
  SUBSCRIPTION_INSTALLMENT: 'Cuota de plan',
};

/** Fecha que importa de una cuenta: el turno si es una reserva, si no cuándo se abrió. */
const accountWhen = (account: AccountRow): Date => {
  const raw = account.booking?.startDateTime || account.createdAt;
  return new Date(raw);
};

const formatAccountDay = (date: Date): string =>
  Number.isNaN(date.getTime())
    ? '-'
    : date
        .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
        .replace(/,/g, '')
        .replace(/\./g, '');

const formatAccountTime = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

type AccountDetailItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  createdAt?: string;
  // Precio por jugador: parte de un jugador (lugar) y si su precio socio está pendiente de validar.
  playerSlot?: {
    bookingId: number;
    slotIndex: number;
    displayName: string | null;
    memberPricePending: boolean;
    memberCategoryName: string | null;
    isFrozen: boolean;
  } | null;
};

type AccountDetailPaymentAllocation = {
  id?: string;
  accountItemId: string;
  amount: number;
};

type AccountDetailPayment = {
  id: string;
  amount: number;
  method: string;
  channel?: string;
  allocations: AccountDetailPaymentAllocation[];
  createdAt?: string;
};

type AccountDetail = {
  id: string;
  status: AccountStatus;
  total: number;
  paid: number;
  remaining: number;
  items: AccountDetailItem[];
  payments: AccountDetailPayment[];
  createdAt?: string;
  updatedAt?: string;
};

type Movement = {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
  kind: 'PAYMENT' | 'REFUND' | 'MANUAL';
  who: string;
  what: string;
  accountId: string | null;
  paymentId: string | null;
};

type Balance = {
  total: number;
  cash: number;
  digital: number;
  income: number;
  expense: number;
};

type CashRegister = {
  id: string;
  name: string;
  location?: string | null;
};

type CashShift = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openingAmount: number;
  expectedCash?: number | null;
  digitalAmount?: number | null;
  breakdown?: CashShiftBreakdown | null;
  cashRegister?: {
    id: string;
    name: string;
    location?: string | null;
  };
};

type CashShiftCloseReport = {
  shift: {
    id: string;
    openedAt?: string;
    closedAt?: string | null;
  };
  expectedCash: number;
  countedCash: number;
  difference: number;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;
const formatRelativeDate = (isoString: string): string => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return '-';
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMin < 2) return 'Hace un momento';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Ayer';
  if (diffD < 7) return `Hace ${diffD} días`;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
};
const ACCOUNT_PAYMENT_EPSILON = 0.009;
/** Refresco automático de Caja (web y mobile). */
const CAJA_AUTO_REFRESH_MS = 30_000;
const CAJA_REFRESH_ON_FOCUS_MIN_GAP_MS = 10_000;
const EMPTY_REFUNDS: RefundRecord[] = [];
const drawerSectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';

const shortCode = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 5)}...${raw.slice(-3)}`;
};

const formatRefundStatus = (status: string) => {
  if (status === 'REQUESTED') return 'Falta aprobar';
  if (status === 'APPROVED' || status === 'READY_TO_EXECUTE') return 'Falta devolver';
  if (status === 'EXECUTED') return 'Devuelta';
  if (status === 'FAILED') return 'No se pudo devolver';
  if (status === 'CANCELLED') return 'Anulada';
  return status;
};

const REFUND_TODO_STATUSES = new Set(['REQUESTED', 'APPROVED', 'READY_TO_EXECUTE', 'FAILED']);

const refundStatusTone = (status: string) => {
  if (status === 'EXECUTED') return 'text-p-positive';
  if (status === 'CANCELLED') return 'text-p-text-muted';
  if (status === 'FAILED') return 'text-p-error';
  return 'text-p-warning';
};

/** Período: Día / Semana / Mes y flechas. Igual en Cuentas, Movimientos y Devoluciones. */
function CashPeriodPicker({
  period,
  label,
  offset,
  onPeriod,
  onOffset,
}: {
  period: CashPeriod;
  label: string;
  offset: number;
  onPeriod: (period: CashPeriod) => void;
  onOffset: (updater: (prev: number) => number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
      {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((value) => (
        <button
          key={`period-${value}`}
          type="button"
          aria-pressed={period === value}
          onClick={() => onPeriod(value)}
          className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition ${
            period === value ? 'bg-p-surface-3 text-p-text' : 'text-p-text-muted hover:text-p-text-secondary'
          }`}
        >
          {value === 'hoy' ? 'Día' : value === 'semana' ? 'Semana' : 'Mes'}
        </button>
      ))}
      <button
        type="button"
        aria-label="Período anterior"
        onClick={() => onOffset((prev) => prev - 1)}
        className="grid h-7 w-7 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-[96px] text-center text-[12px] font-semibold text-p-text-secondary">{label}</span>
      <button
        type="button"
        aria-label="Período siguiente"
        onClick={() => onOffset((prev) => Math.min(0, prev + 1))}
        disabled={offset === 0}
        className="grid h-7 w-7 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

const refundCodeLabel = (refund: RefundRecord) => {
  const display = String(refund?.displayCode || '').trim();
  if (display) return display;
  return `DV-${shortId(refund?.id || '') || 'S/N'}`;
};

const refundReasonTypeLabel = (reasonType: string) => {
  const normalized = String(reasonType || '').toUpperCase();
  if (normalized === 'FULL') return 'Total';
  if (normalized === 'PARTIAL_COMMERCIAL') return 'Parcial comercial';
  if (normalized === 'PARTIAL_SERVICE_FAILURE') return 'Parcial por servicio';
  if (normalized === 'PARTIAL_PRICING_ERROR') return 'Parcial por precio';
  return 'Otro';
};

const refundExecutionMethodLabel = (method: string | null | undefined) => {
  const normalized = String(method || '').toUpperCase();
  if (!normalized) return '-';
  if (normalized === 'CASH') return 'Efectivo';
  if (normalized === 'TRANSFER') return 'Transferencia';
  if (normalized === 'CARD_REVERSAL') return 'Reverso tarjeta';
  if (normalized === 'CREDIT_NOTE') return 'Nota de crédito';
  return method || '-';
};

const refundReasonOptions: Array<{ value: RefundReasonType; label: string }> = [
  { value: 'FULL', label: 'Total' },
  { value: 'PARTIAL_COMMERCIAL', label: 'Parcial comercial' },
  { value: 'PARTIAL_SERVICE_FAILURE', label: 'Falla del servicio' },
  { value: 'PARTIAL_PRICING_ERROR', label: 'Error de precio' },
  { value: 'OTHER', label: 'Otro motivo' },
];

const reservedRefundStatuses = new Set(['REQUESTED', 'APPROVED', 'READY_TO_EXECUTE', 'EXECUTED']);

const resolveRefundExecutionMethod = (paymentMethod: string): RefundExecutionMethod => {
  const normalized = String(paymentMethod || '').toUpperCase();
  if (normalized === 'TRANSFER') return 'TRANSFER';
  if (normalized === 'CARD') return 'CARD_REVERSAL';
  return 'CASH';
};

const refundActionCopy = (action: RefundActionKind) => {
  if (action === 'approve') {
    return {
      title: 'Aprobar devolución',
      message: 'La devolución quedará aprobada y lista para ejecutarse según el método.',
      confirm: 'Aprobar',
      needsReason: false,
    };
  }
  if (action === 'approve_execute') {
    return {
      title: 'Aprobar y ejecutar devolución',
      message: 'La devolución se aprobará y se ejecutará ahora. Esto impacta en caja.',
      confirm: 'Aprobar y ejecutar',
      needsReason: false,
    };
  }
  if (action === 'execute') {
    return {
      title: 'Ejecutar devolución',
      message: 'La devolución se registrará como ejecutada e impactará en caja.',
      confirm: 'Ejecutar',
      needsReason: false,
    };
  }
  if (action === 'retry') {
    return {
      title: 'Reintentar devolución',
      message: 'La devolución fallida volverá a intentarse y puede ejecutarse ahora.',
      confirm: 'Reintentar',
      needsReason: false,
    };
  }
  if (action === 'fail') {
    return {
      title: 'Marcar devolución como fallida',
      message: 'Registrá el motivo operativo por el que esta devolución no pudo completarse.',
      confirm: 'Marcar fallida',
      needsReason: true,
    };
  }
  return {
    title: 'Cancelar devolución',
    message: 'La solicitud quedará cancelada y no seguirá avanzando en el flujo.',
    confirm: 'Cancelar devolución',
    needsReason: true,
  };
};

const toDateLabel = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getCashDateRange = (period: CashPeriod, offset = 0) => {
  const base = new Date();
  const start = new Date(base);
  const end = new Date(base);

  if (period === 'hoy') {
    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset);
  } else if (period === 'semana') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1 + (offset * 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else {
    start.setFullYear(start.getFullYear(), start.getMonth() + offset, 1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    startDate: toDateLabel(start),
    endDate: toDateLabel(end),
    rawStart: start,
    rawEnd: end,
  };
};

const shortId = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const parsePaymentsTab = (value: unknown): PaymentsTab => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'cash') return 'SUMMARY';
  if (raw === 'summary') return 'SUMMARY';
  if (raw === 'movements') return 'MOVEMENTS';
  if (raw === 'closure') return 'SUMMARY';
  if (raw === 'refunds') return 'REFUNDS';
  if (raw === 'accounts') return 'ACCOUNTS';
  return 'SUMMARY';
};

const toPaymentsTabQuery = (value: PaymentsTab) => {
  if (value === 'SUMMARY') return 'summary';
  if (value === 'MOVEMENTS') return 'movements';
  if (value === 'CLOSURE') return 'closure';
  if (value === 'REFUNDS') return 'refunds';
  if (value === 'REPORTS') return 'reports';
  return 'accounts';
};

const isCashSectionTab = (value: PaymentsTab) =>
  value === 'SUMMARY' || value === 'MOVEMENTS' || value === 'CLOSURE';

const toCashViewByTab = (value: PaymentsTab): CashView => {
  if (value === 'MOVEMENTS') return 'movements';
  if (value === 'CLOSURE') return 'closures';
  return 'live';
};

const formatMovementConcept = (movement: any) => {
  const rawConcept = String(movement?.concept || '').trim();
  const sourceType = String(movement?.sourceType || '').toUpperCase();
  const accountId = String(movement?.accountId || '').trim();
  const paymentId = String(movement?.paymentId || '').trim();
  const refundId = String(movement?.refundId || '').trim();
  const booking = movement?.booking;

  const paymentMatch = rawConcept.match(/^pago\s+cuenta\s+(.+)$/i);
  if (paymentMatch) {
    if (sourceType === 'BOOKING' && booking) {
      const court = String(booking?.courtName || '').trim();
      const client = String(booking?.clientName || '').trim();
      if (court && client) return `Pago reserva ${court} - ${client}`;
      if (court) return `Pago reserva ${court}`;
      if (client) return `Pago reserva - ${client}`;
      return 'Pago de reserva';
    }

    if (sourceType === 'BAR') {
      return 'Pago de consumos';
    }

    return `Pago de cuenta ${accountId ? `#${shortId(accountId)}` : ''}`.trim();
  }

  const refundMatch = rawConcept.match(/^refund\s+pago\s+(.+)$/i);
  if (refundMatch) {
    const reference = refundId || paymentId || refundMatch[1];
    return `Reintegro de pago ${reference ? `#${shortId(reference)}` : ''}`.trim();
  }

  if (!rawConcept) return 'Movimiento de caja';
  return rawConcept;
};

const CASH_EXPENSE_PRESETS = ['Proveedor', 'Sueldos', 'Limpieza', 'Mantenimiento', 'Retiro del dueño'];
const CASH_INCOME_PRESETS = ['Cambio para la caja', 'Aporte del dueño', 'Alquiler de espacio'];
const CASH_MOVEMENT_PRESETS = [...CASH_EXPENSE_PRESETS, ...CASH_INCOME_PRESETS];

const formatMovementSlot = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  return `${day} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
};

/** "Lionel Messi" + "Cobro de reserva · Cancha 1 · mar 3 nov 22:00". */
const describeCashMovement = (item: any): Pick<Movement, 'kind' | 'who' | 'what' | 'accountId' | 'paymentId'> => {
  const rawType = String(item?.type || '').toUpperCase();
  const accountId = item?.accountId ? String(item.accountId) : null;
  const paymentId = item?.paymentId ? String(item.paymentId) : null;
  const sourceType = String(item?.sourceType || '').toUpperCase() as AccountRow['sourceType'];
  const booking = item?.booking;
  const isRefund = rawType === 'REFUND';
  const isPayment = rawType === 'PAYMENT_IN' && Boolean(accountId);
  if (isRefund || isPayment) {
    const who =
      String(booking?.clientName || '').trim() ||
      String(item?.accountClientName || '').trim() ||
      (sourceType === 'BAR' ? 'Venta mostrador' : accountKindLabel[sourceType] || 'Cuenta');
    const target =
      sourceType === 'BOOKING'
        ? ['reserva', String(booking?.courtName || '').trim(), formatMovementSlot(booking?.startDateTime)].filter(Boolean).join(' · ')
        : sourceType === 'BAR'
          ? 'consumos'
          : (accountKindLabel[sourceType] || 'cuenta').toLowerCase();
    return {
      kind: isRefund ? 'REFUND' : 'PAYMENT',
      who,
      what: `${isRefund ? 'Devolución de' : 'Cobro de'} ${target}`,
      accountId,
      paymentId,
    };
  }
  const concept = String(item?.concept || '').replace(/\s*#\S+/g, '').trim();
  const income = rawType === 'PAYMENT_IN' || rawType === 'DEPOSIT' || rawType === 'INCOME';
  return {
    kind: 'MANUAL',
    who: concept || (income ? 'Ingreso' : 'Egreso'),
    what: income ? 'Ingreso a mano' : 'Egreso a mano',
    accountId,
    paymentId,
  };
};

const movementMethodLabel = (method: Movement['method']) => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
};

const accountSourceLabel = (sourceType: AccountRow['sourceType']) => {
  if (sourceType === 'BOOKING') return 'Reserva';
  if (sourceType === 'BAR') return 'Consumos';
  if (sourceType === 'TABLE') return 'Mesa';
  if (sourceType === 'CLASS_PASS') return 'Pack de clases';
  if (sourceType === 'CLASS_ENROLLMENT') return 'Clase';
  if (sourceType === 'SUBSCRIPTION_INSTALLMENT') return 'Cuota de plan';
  return 'Manual';
};

const accountDisplayLabel = (account: AccountRow) => {
  const clientName = String(account.booking?.clientName || '').trim();
  const courtName = String(account.booking?.courtName || '').trim();
  if (clientName && courtName) return `${clientName} · ${courtName}`;
  if (clientName) return clientName;
  if (courtName) return courtName;
  return accountSourceLabel(account.sourceType);
};

const paymentMethodLabel = (method: string) => {
  const normalized = String(method || '').toUpperCase();
  if (normalized === 'CASH') return 'Efectivo';
  if (normalized === 'TRANSFER') return 'Transferencia';
  if (normalized === 'CARD') return 'Tarjeta';
  return method || '-';
};

const paymentChannelLabel = (channel: string) => {
  const normalized = String(channel || '').toUpperCase();
  if (!normalized) return '-';
  if (normalized === 'BANK_ACCOUNT') return 'Cuenta bancaria';
  if (normalized === 'VIRTUAL_WALLET') return 'Billetera virtual';
  if (normalized === 'CASH_DRAWER') return 'Caja';
  if (normalized === 'CARD_TERMINAL') return 'Terminal';
  return channel;
};

export default function AdminPaymentsPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const [activeTab, setActiveTab] = useState<PaymentsTab>(() => parsePaymentsTab(router.query.tab));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [openAccounts, setOpenAccounts] = useState<AccountRow[]>([]);
  const [closedAccounts, setClosedAccounts] = useState<AccountRow[]>([]);
  const [pendingRefunds, setPendingRefunds] = useState<RefundRecord[]>([]);
  const [recentRefunds, setRecentRefunds] = useState<RefundRecord[]>([]);
  const [accountsSearchTerm, setAccountsSearchTerm] = useState('');
  const [accountsFilter, setAccountsFilter] = useState<AccountsFilter>('DEBT');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [accountDrawerInitialView, setAccountDrawerInitialView] =
    useState<AccountDrawerInitialView>('overview');
  // "Emitir factura" en una cuenta, solo si el club factura.
  const [fiscalBillingEnabled, setFiscalBillingEnabled] = useState(false);
  const [accountDetailById, setAccountDetailById] = useState<Record<string, AccountDetail>>({});
  const [loadingAccountDetailById, setLoadingAccountDetailById] = useState<Record<string, boolean>>({});
  const [accountDetailError, setAccountDetailError] = useState('');
  const [openingAccount, setOpeningAccount] = useState(false);

  const [cashActivePeriod, setCashActivePeriod] = useState<CashPeriod>('hoy');
  const [cashPeriodOffset, setCashPeriodOffset] = useState(0);
  const [posReportScope, setPosReportScope] = useState<PosReportScope>('shift');
  const [loadingCashSummary, setLoadingCashSummary] = useState(false);
  const [loadingCashShift, setLoadingCashShift] = useState(false);
  const [submittingCashMovement, setSubmittingCashMovement] = useState(false);
  const [openingCashShift, setOpeningCashShift] = useState(false);
  const [closingCashShift, setClosingCashShift] = useState(false);

  const [cashBalance, setCashBalance] = useState<Balance>({
    total: 0,
    cash: 0,
    digital: 0,
    income: 0,
    expense: 0,
  });
  const [cashMovements, setCashMovements] = useState<Movement[]>([]);
  const [cashCurrentShift, setCashCurrentShift] = useState<CashShift | null>(null);
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([]);

  const [cashSummaryError, setCashSummaryError] = useState('');
  const [cashShiftError, setCashShiftError] = useState('');
  const [cashMovementError, setCashMovementError] = useState('');
  const [enforceCashShiftCloseWithOpenAccounts, setEnforceCashShiftCloseWithOpenAccounts] = useState(true);
  const [refundSearchTerm, setRefundSearchTerm] = useState('');
  const [refundStatusFilter, setRefundStatusFilter] = useState<RefundStatusFilter>('ALL');
  const [refundMethodFilter, setRefundMethodFilter] = useState<RefundMethodFilter>('ALL');
  /** Por hacer = falta aprobar o devolver; Hechas = ya devueltas. */
  const [refundStageFilter, setRefundStageFilter] = useState<'ALL' | 'TODO' | 'DONE'>('ALL');
  const [refundRequestOpen, setRefundRequestOpen] = useState(false);
  const [refundRequestAccountLocked, setRefundRequestAccountLocked] = useState(false);
  const [refundRequestAccountId, setRefundRequestAccountId] = useState('');
  const [refundRequestPaymentId, setRefundRequestPaymentId] = useState('');
  const [refundRequestAmountDraft, setRefundRequestAmountDraft] = useState('');
  const [refundRequestReasonType, setRefundRequestReasonType] = useState<RefundReasonType>('OTHER');
  const [refundRequestNotes, setRefundRequestNotes] = useState('');
  const [refundRequestExecuteNow, setRefundRequestExecuteNow] = useState(false);
  const [refundRequestError, setRefundRequestError] = useState('');
  const [submittingRefundRequest, setSubmittingRefundRequest] = useState(false);
  const [refundsByAccountId, setRefundsByAccountId] = useState<Record<string, RefundRecord[]>>({});
  const [loadingRefundsByAccountId, setLoadingRefundsByAccountId] = useState<Record<string, boolean>>({});
  const [selectedRefundId, setSelectedRefundId] = useState('');
  const [refundActionConfirm, setRefundActionConfirm] = useState<{
    action: RefundActionKind;
    refundId: string;
  } | null>(null);
  const [refundActionReason, setRefundActionReason] = useState('');
  const [refundActionError, setRefundActionError] = useState('');
  const [refundActionBusy, setRefundActionBusy] = useState(false);
  const [cashSearchTerm, setCashSearchTerm] = useState('');
  const [cashTypeFilter, setCashTypeFilter] = useState<MovementTypeFilter>('ALL');
  const [cashMethodFilter, setCashMethodFilter] = useState<MovementMethodFilter>('ALL');
  const [cashShowFilters, setCashShowFilters] = useState(false);
  const [cashSidebarView, setCashSidebarView] = useState<CashActionSidebarView>('none');
  const [cashLastCloseReport, setCashLastCloseReport] = useState<CashShiftCloseReport | null>(null);
  // Cierres anteriores (comprobantes) y cuál se está mirando.
  const [cashClosedShifts, setCashClosedShifts] = useState<CashClosedShift[]>([]);
  const [cashSelectedClosedId, setCashSelectedClosedId] = useState('');

  const [cashOpenShiftForm, setCashOpenShiftForm] = useState({
    cashRegisterId: '',
    openingAmount: '',
  });
  const [cashCloseShiftForm, setCashCloseShiftForm] = useState({ countedCash: '' });
  const [cashNewMovement, setCashNewMovement] = useState({
    type: 'EXPENSE' as 'INCOME' | 'EXPENSE',
    description: '',
    amount: '',
    method: 'CASH' as 'CASH' | 'TRANSFER' | 'CARD',
  });
  // El aviso de error se va apenas se corrige algo.
  useEffect(() => {
    setCashMovementError('');
  }, [cashNewMovement.amount, cashNewMovement.description, cashNewMovement.type, cashSidebarView]);

  // POS — Venta mostrador (Fase 1.6)
  const [posProducts, setPosProducts] = useState<PosItem[]>([]);
  const [posLoadingProducts, setPosLoadingProducts] = useState(false);
  const [posItems, setPosItems] = useState<Array<{ productId: string; quantity: string }>>(
    [{ productId: '', quantity: '1' }]
  );
  const [posSubmitting, setPosSubmitting] = useState(false);
  const [posError, setPosError] = useState('');
  // Selector de cliente opcional (Consumidor final si queda vacío)
  const [posClientSearch, setPosClientSearch] = useState('');
  const [posClientResults, setPosClientResults] = useState<PosClientResult[]>([]);
  const [posClientDropdownOpen, setPosClientDropdownOpen] = useState(false);
  const [posSelectedClient, setPosSelectedClient] = useState<PosClientResult | null>(null);
  const posClientWrapperRef = useRef<HTMLDivElement | null>(null);
  const posClientSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Quote reactivo — total real con descuentos
  const [posQuote, setPosQuote] = useState<{
    finalTotal: number;
    listTotal: number;
    discountTotal: number;
    hasDiscount: boolean;
  } | null>(null);
  const [posQuoteLoading, setPosQuoteLoading] = useState(false);

  const [posReport, setPosReport] = useState<PosReport | null>(null);
  const [posReportLoading, setPosReportLoading] = useState(false);
  const [posReportError, setPosReportError] = useState('');

  const paymentsContentScrollRef = useRef<HTMLElement | null>(null);
  const selectedAccountDetailFocusRef = useRef<HTMLDivElement | null>(null);
  const accountDetailRequestSeqRef = useRef<Record<string, number>>({});

  const focusSelectedAccountDetail = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const target = selectedAccountDetailFocusRef.current;
      if (!target) return;
      const scrollParent = paymentsContentScrollRef.current;
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const nextTop = scrollParent.scrollTop + targetRect.top - parentRect.top + 36;
        scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
      } else {
        const targetTop = target.getBoundingClientRect().top + window.scrollY + 36;
        window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    });
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/pagos-playground')}`);
  }, [authChecked, router, user]);

  useEffect(() => {
    // Los reportes de mostrador viven en Informes: el link viejo lleva ahí.
    if (String(router.query.tab || '').toLowerCase() === 'reports') {
      void router.replace('/admin/informes?tab=mostrador');
      return;
    }
    const nextTab = parsePaymentsTab(router.query.tab);
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [router, router.query.tab]);

  const cashActiveView = toCashViewByTab(activeTab);

  const navigateToPaymentsTab = useCallback(
    (nextTab: PaymentsTab) => {
      setActiveTab(nextTab);
      void router.replace(
        {
          pathname: '/admin/caja',
          query: { ...router.query, tab: toPaymentsTabQuery(nextTab) },
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [open, closed, pending, recent] = await Promise.all([
        listAccounts({ status: 'OPEN' }),
        listAccounts({ status: 'CLOSED' }),
        listPendingRefunds(20),
        listRefunds({ take: 30 }),
      ]);

      const nextOpen = Array.isArray(open) ? open : [];
      setOpenAccounts(nextOpen);
      setClosedAccounts(Array.isArray(closed) ? closed : []);
      setPendingRefunds(Array.isArray(pending) ? pending : []);
      setRecentRefunds(Array.isArray(recent) ? recent : []);
      if (silent) setError('');
      return nextOpen;
    } catch (loadError: any) {
      reportUiError({ area: 'PaymentsPlayground', action: silent ? 'autoRefresh' : 'refresh' }, loadError);
      if (!silent) setError(loadError?.message || 'No se pudo cargar el módulo de pagos.');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const ensureAccountDetail = useCallback(async (accountId: string, force = false, silent = false) => {
    const key = String(accountId || '').trim();
    if (!key) return null;
    if (!force && accountDetailById[key]) return accountDetailById[key];
    if (!force && loadingAccountDetailById[key]) return null;

    const requestSeq = (accountDetailRequestSeqRef.current[key] || 0) + 1;
    accountDetailRequestSeqRef.current[key] = requestSeq;
    try {
      if (!silent) {
        setLoadingAccountDetailById((prev) => ({ ...prev, [key]: true }));
        setAccountDetailError('');
      }
      const detail = await getAccountById(key);
      const normalized: AccountDetail = {
        id: String(detail?.id || key),
        status: String(detail?.status || 'OPEN') as AccountStatus,
        total: Number(detail?.total || 0),
        paid: Number(detail?.paid || 0),
        remaining: Number(detail?.remaining || 0),
        items: (Array.isArray(detail?.items) ? detail.items : []).map((item: any) => ({
          id: String(item?.id || ''),
          type: String(item?.type || 'OTHER'),
          description: String(item?.description || 'Concepto'),
          quantity: Number(item?.quantity || 1),
          total: Number(item?.total || 0),
          createdAt: String(item?.createdAt || ''),
          playerSlot: item?.playerSlot ?? null,
        })),
        payments: (Array.isArray(detail?.payments) ? detail.payments : []).map((payment: any) => ({
          id: String(payment?.id || ''),
          amount: Number(payment?.amount || 0),
          method: String(payment?.method || ''),
          channel: String(payment?.channel || ''),
          allocations: (Array.isArray(payment?.allocations) ? payment.allocations : []).map((allocation: any) => ({
            id: allocation?.id ? String(allocation.id) : undefined,
            accountItemId: String(allocation?.accountItemId || ''),
            amount: Number(allocation?.amount || 0),
          })).filter((allocation: AccountDetailPaymentAllocation) => allocation.accountItemId && allocation.amount > ACCOUNT_PAYMENT_EPSILON),
          createdAt: String(payment?.createdAt || ''),
        })),
        createdAt: String(detail?.createdAt || ''),
        updatedAt: String(detail?.updatedAt || ''),
      };
      if (accountDetailRequestSeqRef.current[key] === requestSeq) {
        setAccountDetailById((prev) => ({ ...prev, [key]: normalized }));
      }
      return normalized;
    } catch (detailError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'ensureAccountDetail' }, detailError);
      if (!silent) {
        setAccountDetailError(extractErrorMessage(detailError, 'No se pudo cargar el detalle de la cuenta.'));
      }
      return null;
    } finally {
      if (!silent && accountDetailRequestSeqRef.current[key] === requestSeq) {
        setLoadingAccountDetailById((prev) => ({ ...prev, [key]: false }));
      }
    }
  }, [accountDetailById, loadingAccountDetailById]);

  const ensureAccountRefunds = useCallback(async (accountId: string, force = false) => {
    const key = String(accountId || '').trim();
    if (!key) return [];
    if (!force && refundsByAccountId[key]) return refundsByAccountId[key];
    if (loadingRefundsByAccountId[key]) return refundsByAccountId[key] || [];

    try {
      setLoadingRefundsByAccountId((prev) => ({ ...prev, [key]: true }));
      const rows = await listRefunds({ accountId: key, take: 100 });
      const normalized = Array.isArray(rows) ? rows : [];
      setRefundsByAccountId((prev) => ({ ...prev, [key]: normalized }));
      return normalized;
    } catch (refundError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'ensureAccountRefunds' }, refundError);
      setRefundRequestError(extractErrorMessage(refundError, 'No se pudieron cargar las devoluciones de la cuenta.'));
      return [];
    } finally {
      setLoadingRefundsByAccountId((prev) => ({ ...prev, [key]: false }));
    }
  }, [loadingRefundsByAccountId, refundsByAccountId]);

  const closeAccountDrawer = useCallback(() => {
    setAccountDrawerOpen(false);
    setAccountDrawerInitialView('overview');
  }, []);

  const openAccountDrawer = useCallback((accountId: string, initialView: AccountDrawerInitialView = 'overview') => {
    setSelectedAccountId(accountId);
    setAccountDrawerInitialView(initialView);
    setAccountDrawerOpen(true);
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    void ensureAccountDetail(accountId);
    focusSelectedAccountDetail();
  }, [ensureAccountDetail, focusSelectedAccountDetail]);

  const handleQuickOpenAccount = useCallback(async () => {
    try {
      setOpeningAccount(true);
      const created = await openAccount({ sourceType: 'MANUAL', sourceId: `manual-${Date.now()}` });
      await refresh();
      if (created?.id) {
        openAccountDrawer(created.id, 'add_item');
      }
      showAdminToast('Cuenta creada. Agregá el primer concepto.');
    } catch (error) {
      reportUiError({ area: 'PaymentsPlayground', action: 'handleQuickOpenAccount' }, error);
    } finally {
      setOpeningAccount(false);
    }
  }, [openAccountDrawer, refresh]);

  const loadCashSummary = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setCashSummaryError('');
      setLoadingCashSummary(true);
    }
    try {
      const { startDate, endDate } = getCashDateRange(cashActivePeriod, cashPeriodOffset);
      const data = await CashService.getSummary({ startDate, endDate });
      const nextBalance = data?.balance || {};
      setCashBalance({
        total: Number(nextBalance.total || 0),
        cash: Number(nextBalance.cash || 0),
        digital: Number(nextBalance.digital || 0),
        income: Number(nextBalance.income || 0),
        expense: Number(nextBalance.expense || 0),
      });
      const normalizedMovements: Movement[] = (Array.isArray(data?.movements) ? data.movements : []).map((item: any) => {
        const type = String(item?.type || 'INCOME');
        const normalizedType: Movement['type'] =
          type === 'WITHDRAW' || type === 'REFUND' || type === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
        const described = describeCashMovement(item);
        return {
          id: Number(item?.id || 0),
          date: String(item?.createdAt || ''),
          type: normalizedType,
          amount: Number(item?.amount || 0),
          ...described,
          description: `${described.who} ${described.what} ${formatMovementConcept(item)}`,
          method: (['CASH', 'TRANSFER', 'CARD'].includes(String(item?.method))
            ? item.method
            : 'CASH') as Movement['method'],
        };
      });
      setCashMovements(normalizedMovements.filter((item) => Number.isFinite(item.id) && item.id > 0));
    } catch (loadError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'loadCashSummary' }, loadError);
      if (!silent) setCashSummaryError(extractErrorMessage(loadError, 'No se pudo cargar el resumen de caja.'));
    } finally {
      if (!silent) setLoadingCashSummary(false);
    }
  }, [cashActivePeriod, cashPeriodOffset]);

  const loadCashClosedShifts = useCallback(async (): Promise<CashClosedShift[]> => {
    try {
      const rows = await CashService.listClosedShifts(10);
      const list = Array.isArray(rows) ? (rows as CashClosedShift[]) : [];
      setCashClosedShifts(list);
      return list;
    } catch (loadError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'loadCashClosedShifts' }, loadError);
      return [];
    }
  }, []);

  useEffect(() => {
    void loadCashClosedShifts();
  }, [loadCashClosedShifts]);

  const openCashClosesView = useCallback(
    (shiftId?: string) => {
      setCashSelectedClosedId(shiftId || cashClosedShifts[0]?.id || '');
      setCashSidebarView('close_report');
      void loadCashClosedShifts();
    },
    [cashClosedShifts, loadCashClosedShifts]
  );

  const loadCashShiftContext = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setCashShiftError('');
      setLoadingCashShift(true);
    }
    try {
      const [shift, registers] = await Promise.all([
        CashService.getCurrentShift(),
        CashService.getCashRegisters(),
      ]);
      setCashCurrentShift(shift || null);
      const normalizedRegisters = Array.isArray(registers) ? registers : [];
      setCashRegisters(normalizedRegisters);
      if (!shift && normalizedRegisters.length > 0) {
        setCashOpenShiftForm((prev) => ({
          ...prev,
          cashRegisterId: prev.cashRegisterId || String(normalizedRegisters[0].id),
        }));
      }
    } catch (loadError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'loadCashShiftContext' }, loadError);
      if (!silent) setCashShiftError(extractErrorMessage(loadError, 'No se pudo cargar el estado del turno de caja.'));
    } finally {
      if (!silent) setLoadingCashShift(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    void refresh();
  }, [authChecked, refresh, user]);

  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    const slug = getActiveClubSlug(normalizeSessionUser(user as any));
    if (!slug) return;
    let cancelled = false;
    getFiscalConfig(slug)
      .then((config) => {
        if (cancelled) return;
        setFiscalBillingEnabled(
          Boolean(config?.facturacionHabilitada && config.modoFacturacion && config.modoFacturacion !== 'DESHABILITADA')
        );
      })
      .catch(() => {
        if (!cancelled) setFiscalBillingEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    const run = async () => {
      try {
        const slug = getActiveClubSlug(normalizeSessionUser(user as any));
        if (!slug) return;
        const club = await ClubService.getClubBySlug(slug);
        setEnforceCashShiftCloseWithOpenAccounts(
          club.enforceCashShiftCloseWithOpenAccounts ?? true
        );
      } catch (error) {
        reportUiError({ area: 'PaymentsPlayground', action: 'loadClubCloseShiftPolicy' }, error);
        setEnforceCashShiftCloseWithOpenAccounts(true);
      }
    };
    void run();
  }, [authChecked, user]);

  useEffect(() => {
    if (activeTab !== 'ACCOUNTS') return;
    if (selectedAccountId) return;
    const firstOpen = openAccounts[0]?.id || '';
    const firstClosed = closedAccounts[0]?.id || '';
    const first = firstOpen || firstClosed;
    if (first) setSelectedAccountId(first);
  }, [activeTab, closedAccounts, openAccounts, selectedAccountId]);

  useEffect(() => {
    if (activeTab !== 'ACCOUNTS') return;
    if (!selectedAccountId) return;
    void ensureAccountDetail(selectedAccountId);
  }, [activeTab, ensureAccountDetail, selectedAccountId]);

  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    if (!isCashSectionTab(activeTab)) return;
    void loadCashSummary();
  }, [activeTab, authChecked, loadCashSummary, user]);

  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    if (!isCashSectionTab(activeTab)) return;
    void loadCashShiftContext();
  }, [activeTab, authChecked, loadCashShiftContext, user]);

  useEffect(() => {
    if (isCashSectionTab(activeTab)) return;
    setCashSidebarView('none');
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'ACCOUNTS') return;
    setAccountDrawerOpen(false);
  }, [activeTab]);

  // P2-D: Load POS report when REPORTS tab is active
  const loadPosReport = useCallback(async () => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    setPosReportLoading(true);
    setPosReportError('');
    try {
      const { startDate, endDate } = getCashDateRange(cashActivePeriod, cashPeriodOffset);
      const data = await CashService.getPosReport({
        startDate,
        endDate,
        shiftId: posReportScope === 'shift' ? (cashCurrentShift?.id || undefined) : undefined
      });
      setPosReport(data);
    } catch (err) {
      reportUiError({ area: 'PaymentsPlayground', action: 'loadPosReport' }, err);
      setPosReportError(extractErrorMessage(err, 'No se pudo cargar el reporte POS.'));
    } finally {
      setPosReportLoading(false);
    }
  }, [authChecked, cashActivePeriod, cashCurrentShift?.id, cashPeriodOffset, posReportScope, user]);

  useEffect(() => {
    if (activeTab !== 'REPORTS') return;
    void loadPosReport();
  }, [activeTab, loadPosReport]);

  useEffect(() => {
    if (activeTab !== 'REPORTS') return;
    if (cashCurrentShift?.id) return;
    setPosReportScope('period');
    if (cashActivePeriod !== 'hoy' || cashPeriodOffset !== 0) return;
    setCashActivePeriod('mes');
  }, [activeTab, cashActivePeriod, cashCurrentShift?.id, cashPeriodOffset]);

  const cashPeriodLabel = useMemo(() => {
    const { rawStart, rawEnd } = getCashDateRange(cashActivePeriod, cashPeriodOffset);
    if (cashActivePeriod === 'hoy') {
      if (cashPeriodOffset === 0) return 'Hoy';
      if (cashPeriodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    if (cashActivePeriod === 'semana') {
      return `${rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} - ${rawEnd.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}`;
    }
    return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }, [cashActivePeriod, cashPeriodOffset]);

  const filteredCashMovements = useMemo(() => {
    const normalizedQuery = cashSearchTerm.trim().toLowerCase();
    return cashMovements.filter((movement) => {
      const matchesType = cashTypeFilter === 'ALL' || movement.type === cashTypeFilter;
      const matchesMethod = cashMethodFilter === 'ALL' || movement.method === cashMethodFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        movement.description.toLowerCase().includes(normalizedQuery) ||
        movementMethodLabel(movement.method).toLowerCase().includes(normalizedQuery);
      return matchesType && matchesMethod && matchesSearch;
    });
  }, [cashMethodFilter, cashMovements, cashSearchTerm, cashTypeFilter]);

  const filteredNetAmount = useMemo(
    () =>
      filteredCashMovements.reduce(
        (total, movement) => total + (movement.type === 'INCOME' ? movement.amount : -movement.amount),
        0
      ),
    [filteredCashMovements]
  );

  const filteredIncomeAmount = useMemo(
    () =>
      filteredCashMovements
        .filter((movement) => movement.type === 'INCOME')
        .reduce((sum, movement) => sum + movement.amount, 0),
    [filteredCashMovements]
  );

  const filteredExpenseAmount = useMemo(
    () =>
      filteredCashMovements
        .filter((movement) => movement.type === 'EXPENSE')
        .reduce((sum, movement) => sum + movement.amount, 0),
    [filteredCashMovements]
  );

  const hasOpenCurrentAccounts = openAccounts.length > 0;
  const shouldBlockCloseShiftWithOpenAccounts =
    enforceCashShiftCloseWithOpenAccounts && hasOpenCurrentAccounts;
  const closeShiftBlockedMessage = shouldBlockCloseShiftWithOpenAccounts
    ? `No podés cerrar caja: hay ${openAccounts.length} cuenta${openAccounts.length === 1 ? '' : 's'} corriente${openAccounts.length === 1 ? '' : 's'} abierta${openAccounts.length === 1 ? '' : 's'}.`
    : '';

  const filteredRecentRefunds = useMemo(() => {
    const { rawStart, rawEnd } = getCashDateRange(cashActivePeriod, cashPeriodOffset);
    const normalizedQuery = refundSearchTerm.trim().toLowerCase();
    return recentRefunds.filter((refund) => {
      const createdAt = new Date(refund.createdAt);
      const matchesDate = Number.isFinite(createdAt.getTime()) && createdAt >= rawStart && createdAt <= rawEnd;
      const normalizedStatus = String(refund.status || '').toUpperCase();
      const normalizedMethod = String(refund.executionMethod || '').toUpperCase();
      const matchesStatus = refundStatusFilter === 'ALL' || normalizedStatus === refundStatusFilter;
      const matchesMethod = refundMethodFilter === 'ALL' || normalizedMethod === refundMethodFilter;
      const matchesStage =
        refundStageFilter === 'ALL' ||
        (refundStageFilter === 'TODO' && REFUND_TODO_STATUSES.has(normalizedStatus)) ||
        (refundStageFilter === 'DONE' && normalizedStatus === 'EXECUTED');
      // Lo que falta hacer se ve siempre, aunque sea de otro período.
      const inPeriod = matchesDate || (refundStageFilter === 'TODO' && REFUND_TODO_STATUSES.has(normalizedStatus));
      const account =
        openAccounts.find((row) => row.id === refund.accountId) ||
        closedAccounts.find((row) => row.id === refund.accountId);
      const matchesSearch =
        normalizedQuery.length === 0 ||
        refundCodeLabel(refund).toLowerCase().includes(normalizedQuery) ||
        String(refund.reason || '').toLowerCase().includes(normalizedQuery) ||
        String(account?.booking?.clientName || account?.client?.name || '').toLowerCase().includes(normalizedQuery) ||
        String(account?.booking?.courtName || '').toLowerCase().includes(normalizedQuery);
      return inPeriod && matchesStatus && matchesMethod && matchesStage && matchesSearch;
    });
  }, [cashActivePeriod, closedAccounts, cashPeriodOffset, openAccounts, recentRefunds, refundMethodFilter, refundSearchTerm, refundStageFilter, refundStatusFilter]);

  const refundsTodo = useMemo(() => {
    const items = recentRefunds.filter((refund) => REFUND_TODO_STATUSES.has(String(refund.status || '').toUpperCase()));
    return { count: items.length, amount: items.reduce((sum, refund) => sum + Number(refund.amount || 0), 0) };
  }, [recentRefunds]);

  const filteredPendingRefunds = useMemo(() => {
    const visibleIds = new Set(filteredRecentRefunds.map((refund) => refund.id));
    return pendingRefunds.filter((refund) => visibleIds.has(refund.id));
  }, [filteredRecentRefunds, pendingRefunds]);

  const filteredPendingRefundAmount = useMemo(
    () => filteredPendingRefunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0),
    [filteredPendingRefunds]
  );

  const handleOpenShift = async (event: React.FormEvent) => {
    event.preventDefault();
    setCashShiftError('');

    const openingAmount = Number(cashOpenShiftForm.openingAmount);
    if (!cashOpenShiftForm.cashRegisterId) {
      setCashShiftError('Selecciona una caja registradora.');
      return;
    }
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      setCashShiftError('Ingresa un monto de apertura valido.');
      return;
    }

    try {
      setOpeningCashShift(true);
      await CashService.openShift({
        cashRegisterId: cashOpenShiftForm.cashRegisterId,
        openingAmount,
      });
      showAdminToast('Turno de caja abierto correctamente.');
      setCashSidebarView('none');
      await Promise.all([loadCashShiftContext(), loadCashSummary()]);
    } catch (openError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'openShift' }, openError);
      setCashShiftError(extractErrorMessage(openError, 'No se pudo abrir la caja.'));
    } finally {
      setOpeningCashShift(false);
    }
  };

  const handleCloseShift = async (event: React.FormEvent) => {
    event.preventDefault();
    setCashShiftError('');

    if (shouldBlockCloseShiftWithOpenAccounts) {
      showAdminToast(closeShiftBlockedMessage, 'warning');
      return;
    }

    const countedCash = Number(cashCloseShiftForm.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      setCashShiftError('Ingresa un monto contado valido.');
      return;
    }

    try {
      setClosingCashShift(true);
      const closedShift = await CashService.closeCurrentShift({ countedCash });
      if (closedShift?.id) {
        try {
          const report = await CashService.getShiftReport(String(closedShift.id));
          setCashLastCloseReport(report);
        } catch {
          setCashLastCloseReport(null);
        }
      }
      setCashCloseShiftForm({ countedCash: '' });
      showAdminToast('Caja cerrada.');
      await Promise.all([loadCashShiftContext(), loadCashSummary(), loadCashClosedShifts()]);
      setCashSelectedClosedId(closedShift?.id ? String(closedShift.id) : '');
      setCashSidebarView('close_report');
    } catch (closeError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'closeShift' }, closeError);
      setCashShiftError(extractErrorMessage(closeError, 'No se pudo cerrar la caja.'));
    } finally {
      setClosingCashShift(false);
    }
  };

  const handleCreateMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    setCashMovementError('');

    const amount = Number(cashNewMovement.amount);
    if (!cashCurrentShift) {
      setCashMovementError('Primero debes abrir la caja para registrar movimientos.');
      return;
    }
    if (cashNewMovement.description.trim().length < 3) {
      setCashMovementError('Escribí en qué se usó la plata (o tocá una opción).');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashMovementError('Poné cuánta plata fue.');
      return;
    }

    try {
      setSubmittingCashMovement(true);
      await CashService.createMovement({
        amount,
        description: cashNewMovement.description.trim(),
        type: cashNewMovement.type,
        method: cashNewMovement.method,
      });
      setCashNewMovement({ type: 'EXPENSE', description: '', amount: '', method: 'CASH' });
      showAdminToast(cashNewMovement.type === 'EXPENSE' ? 'Egreso anotado.' : 'Ingreso anotado.');
      setCashSidebarView('none');
      await loadCashSummary();
    } catch (movementError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'createMovement' }, movementError);
      setCashMovementError(extractErrorMessage(movementError, 'No se pudo registrar el movimiento.'));
    } finally {
      setSubmittingCashMovement(false);
    }
  };

  // POS — buscador de cliente opcional ------------------------------------------
  const handlePosClientSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setPosClientSearch(value);
    // Si el usuario edita, limpiamos el cliente seleccionado
    if (posSelectedClient) setPosSelectedClient(null);

    if (posClientSearchTimeoutRef.current) {
      clearTimeout(posClientSearchTimeoutRef.current);
      posClientSearchTimeoutRef.current = null;
    }

    const term = value.trim();
    if (term.length < 2) {
      setPosClientResults([]);
      setPosClientDropdownOpen(false);
      return;
    }

    posClientSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const slug = getActiveClubSlug(normalizeSessionUser(user as any));
        if (!slug) return;
        const results = await searchClients(slug, term);
        const valid = (Array.isArray(results) ? results : [])
          .filter((c: any) => resolvePosClientId(c).length > 0)
          .slice(0, 15);
        setPosClientResults(valid);
        setPosClientDropdownOpen(true);
      } catch {
        setPosClientResults([]);
        setPosClientDropdownOpen(false);
      }
    }, 300);
  }, [posSelectedClient, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePosSelectClient = useCallback((client: PosClientResult) => {
    const resolvedId = resolvePosClientId(client);
    if (!resolvedId) return;
    setPosSelectedClient({ ...client, id: resolvedId });
    setPosClientSearch(String(client.name || '').trim() || resolvedId);
    setPosClientResults([]);
    setPosClientDropdownOpen(false);
  }, []);

  const handlePosClearClient = useCallback(() => {
    setPosSelectedClient(null);
    setPosClientSearch('');
    setPosClientResults([]);
    setPosClientDropdownOpen(false);
  }, []);

  // Click fuera cierra el dropdown de cliente POS
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (posClientWrapperRef.current && !posClientWrapperRef.current.contains(event.target as Node)) {
        setPosClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Resetear estado POS al cerrar el drawer
  useEffect(() => {
    if (cashSidebarView !== 'product_sale') {
      // No reseteamos posProducts — se mantienen en caché
      setPosItems([{ productId: '', quantity: '1' }]);
      setPosError('');
      setPosClientSearch('');
      setPosClientResults([]);
      setPosClientDropdownOpen(false);
      setPosSelectedClient(null);
      setPosQuote(null);
      setPosQuoteLoading(false);
    }
  }, [cashSidebarView]);

  // POS — carga de productos del club (una sola vez por sesión).
  // Usamos ref como gate en lugar de state para evitar el loop:
  //   state deps en useCallback → nueva referencia → useEffect se re-dispara → loop infinito.
  const posLoadAttemptedRef = useRef(false);
  const loadPosProducts = useCallback(async () => {
    if (posLoadAttemptedRef.current) return;
    posLoadAttemptedRef.current = true;
    try {
      setPosLoadingProducts(true);
      const data = await CashService.getPosItems();
      setPosProducts(Array.isArray(data) ? data : []);
    } catch {
      posLoadAttemptedRef.current = false; // permite reintentar si el usuario reabre el drawer
    } finally {
      setPosLoadingProducts(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Disparar carga al abrir el drawer de venta mostrador
  useEffect(() => {
    if (cashSidebarView === 'product_sale') {
      void loadPosProducts();
    }
  }, [cashSidebarView, loadPosProducts]);

  // Quote reactivo — llama al backend con debounce para obtener total real con descuentos.
  // Usa deps explícitos (state primitivos), no callbacks → no hay riesgo de loop.
  useEffect(() => {
    if (cashSidebarView !== 'product_sale') return;

    const validItems = serializePosSaleItems(posItems, posProducts);

    if (validItems.length === 0) {
      setPosQuote(null);
      setPosQuoteLoading(false);
      return;
    }

    setPosQuoteLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const clientId = posSelectedClient ? resolvePosClientId(posSelectedClient) : undefined;
        const quote = await CashService.quoteProductSale({
          items: validItems,
          clientId: clientId || undefined,
        });
        setPosQuote({
          finalTotal: Number(quote.finalTotal || 0),
          listTotal: Number(quote.listTotal || 0),
          discountTotal: Number(quote.discountTotal || 0),
          hasDiscount: Boolean(quote.hasDiscount),
        });
      } catch {
        setPosQuote(null); // falla silenciosa — el submit sigue usando el total del backend
      } finally {
        setPosQuoteLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [cashSidebarView, posItems, posSelectedClient, posProducts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fase 1.6B: crea la cuenta de mostrador (sin cobrar) y abre el AccountDrawer en vista de pago.
  const handleCreatePosAccount = useCallback(async () => {
    const validItems = serializePosSaleItems(posItems, posProducts);

    if (validItems.length === 0) {
      setPosError('Agregá al menos un ítem válido.');
      return;
    }
    if (!cashCurrentShift) {
      setPosError('Abrí una caja antes de registrar ventas de mostrador.');
      return;
    }

    const resolvedClientId = posSelectedClient ? resolvePosClientId(posSelectedClient) : undefined;

    try {
      setPosSubmitting(true);
      setPosError('');
      const result = await CashService.createProductSaleAccount({
        items: validItems,
        clientId: resolvedClientId || undefined,
      });

      // Cerrar el drawer de POS y resetear productos (stock puede haber cambiado)
      setCashSidebarView('none');
      posLoadAttemptedRef.current = false;
      setPosProducts([]);

      // Refrescar resumen de caja
      void loadCashSummary();

      // Abrir AccountDrawer directamente en la vista de pago
      openAccountDrawer(result.accountId, 'payment');
    } catch (error: any) {
      reportUiError({ area: 'POS', action: 'handleCreatePosAccount' }, error);
      setPosError(extractErrorMessage(error, 'No se pudo crear la cuenta de venta.'));
    } finally {
      setPosSubmitting(false);
    }
  }, [cashCurrentShift, loadCashSummary, openAccountDrawer, posItems, posProducts, posSelectedClient]);

  const cashActionSidebarOpen = isCashSectionTab(activeTab) && cashSidebarView !== 'none';

  const closeActionSidebar = useCallback(() => {
    if (openingCashShift || closingCashShift || submittingCashMovement || posSubmitting) return;
    setCashSidebarView('none');
  }, [closingCashShift, openingCashShift, posSubmitting, submittingCashMovement]);

  useEffect(() => {
    if (!cashActionSidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActionSidebar();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [cashActionSidebarOpen, closeActionSidebar]);

  const allAccounts = useMemo(
    () => [
      ...openAccounts.map((account) => ({ ...account, hasDebt: true })),
      ...closedAccounts.map((account) => ({ ...account, hasDebt: false })),
    ],
    [closedAccounts, openAccounts]
  );

  useEffect(() => {
    if (activeTab !== 'ACCOUNTS' || !selectedAccountId) return;
    if (accountDetailById[selectedAccountId] || loadingAccountDetailById[selectedAccountId]) return;
    void ensureAccountDetail(selectedAccountId);
  }, [activeTab, selectedAccountId, accountDetailById, ensureAccountDetail, loadingAccountDetailById]);

  // Refresco automático de Caja (web y mobile). No corre con la pestaña oculta ni con
  // paneles/modales de acción abiertos, para no pisar formularios en curso.
  const cajaAutoRefreshBlockedRef = useRef(false);
  cajaAutoRefreshBlockedRef.current =
    accountDrawerOpen ||
    cashActionSidebarOpen ||
    refundRequestOpen ||
    Boolean(refundActionConfirm) ||
    submittingCashMovement ||
    openingCashShift ||
    closingCashShift ||
    posSubmitting ||
    openingAccount;
  const cajaAutoRefreshStateRef = useRef({
    activeTab,
    selectedAccountId,
    openAccountIds: [] as string[],
  });
  cajaAutoRefreshStateRef.current = {
    activeTab,
    selectedAccountId,
    openAccountIds: openAccounts.map((account) => String(account.id)),
  };
  const cajaAutoRefreshFnsRef = useRef({ refresh, ensureAccountDetail, loadCashSummary, loadCashShiftContext });
  cajaAutoRefreshFnsRef.current = { refresh, ensureAccountDetail, loadCashSummary, loadCashShiftContext };
  useEffect(() => {
    if (!authChecked || !user || !hasOperatorAccess(user)) return;
    let inFlight = false;
    let lastRunAt = Date.now();
    const runRefresh = async () => {
      if (inFlight || cajaAutoRefreshBlockedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      inFlight = true;
      lastRunAt = Date.now();
      try {
        const { activeTab: tab, selectedAccountId: selectedId, openAccountIds: previousOpenIds } =
          cajaAutoRefreshStateRef.current;
        const { refresh, ensureAccountDetail, loadCashSummary, loadCashShiftContext } = cajaAutoRefreshFnsRef.current;
        const tasks: Array<Promise<unknown>> = [];
        if (tab === 'ACCOUNTS' || tab === 'REFUNDS') {
          tasks.push(
            refresh({ silent: true }).then((nextOpen) => {
              if (!nextOpen || tab !== 'ACCOUNTS') return;
              // Actualiza saldos de cuentas abiertas (y de las que se cerraron desde la última vuelta).
              const ids = new Set<string>([
                ...nextOpen.map((account: any) => String(account.id)),
                ...previousOpenIds,
                ...(selectedId ? [String(selectedId)] : []),
              ]);
              return Promise.allSettled(
                Array.from(ids).slice(0, 40).map((id) => ensureAccountDetail(id, true, true))
              );
            })
          );
        }
        if (isCashSectionTab(tab)) {
          tasks.push(loadCashSummary({ silent: true }), loadCashShiftContext({ silent: true }));
        }
        await Promise.allSettled(tasks);
      } finally {
        inFlight = false;
      }
    };
    const intervalId = window.setInterval(() => void runRefresh(), CAJA_AUTO_REFRESH_MS);
    const handleReturn = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunAt < CAJA_REFRESH_ON_FOCUS_MIN_GAP_MS) return;
      void runRefresh();
    };
    document.addEventListener('visibilitychange', handleReturn);
    window.addEventListener('focus', handleReturn);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleReturn);
      window.removeEventListener('focus', handleReturn);
    };
  }, [authChecked, user]);

  const accountsWithRefundsIdSet = useMemo(() => {
    const set = new Set<string>();
    recentRefunds.forEach((refund) => {
      const accountId = String(refund.accountId || '').trim();
      if (accountId) set.add(accountId);
    });
    return set;
  }, [recentRefunds]);

  const periodAccounts = useMemo(() => {
    const { rawStart, rawEnd } = getCashDateRange(cashActivePeriod, cashPeriodOffset);
    return allAccounts.filter((account) => {
      const when = accountWhen(account);
      return Number.isFinite(when.getTime()) && when >= rawStart && when <= rawEnd;
    });
  }, [allAccounts, cashActivePeriod, cashPeriodOffset]);

  const accountRemaining = useCallback(
    (account: AccountRow) => {
      const d = accountDetailById[account.id];
      if (d) return Math.max(0, Number(d.remaining || 0));
      const total = Number(account.totalAmount || 0);
      const paid = Number(account.paidAmount || 0);
      return Math.max(0, Math.round((total - paid) * 100) / 100);
    },
    [accountDetailById]
  );

  const accountOwesMoney = useCallback(
    (account: AccountRow) => account.status === 'OPEN' && accountRemaining(account) > ACCOUNT_PAYMENT_EPSILON,
    [accountRemaining]
  );

  // Lo que se debe no depende del período: una deuda de la semana pasada sigue siendo deuda.
  const accountsDebtSummary = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const account of allAccounts) {
      if (!accountOwesMoney(account)) continue;
      count += 1;
      amount += accountRemaining(account);
    }
    return { count, amount: Math.round(amount * 100) / 100 };
  }, [accountOwesMoney, accountRemaining, allAccounts]);

  // Resumen: qué hay que cobrar hoy (turnos/cuentas de hoy con deuda) y lo que quedó de antes.
  const cashTodayToCollect = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const today: Array<{ when: number; item: CashTodayItem }> = [];
    let olderCount = 0;
    let olderAmount = 0;
    for (const account of allAccounts) {
      if (!accountOwesMoney(account)) continue;
      const when = accountWhen(account);
      if (!Number.isFinite(when.getTime())) continue;
      const owes = accountRemaining(account);
      if (when < startOfToday) {
        olderCount += 1;
        olderAmount += owes;
        continue;
      }
      if (when >= startOfTomorrow) continue;
      const startTime = formatAccountTime(account.booking?.startDateTime);
      const endTime = formatAccountTime(account.booking?.endDateTime);
      today.push({
        when: when.getTime(),
        item: {
          id: account.id,
          time: startTime ? (endTime ? `${startTime}–${endTime}` : startTime) : '',
          who:
            account.booking?.clientName?.trim() ||
            account.client?.name?.trim() ||
            (account.sourceType === 'BAR' ? 'Consumidor final' : accountKindLabel[account.sourceType]),
          what: account.booking?.courtName
            ? `${accountKindLabel[account.sourceType]} · ${account.booking.courtName}`
            : accountKindLabel[account.sourceType],
          owes,
        },
      });
    }
    today.sort((a, b) => a.when - b.when);
    return {
      items: today.map((row) => row.item),
      olderDebt: { count: olderCount, amount: Math.round(olderAmount * 100) / 100 },
    };
  }, [accountOwesMoney, accountRemaining, allAccounts]);

  const filteredAccounts = useMemo(() => {
    const search = accountsSearchTerm.trim().toLowerCase();
    const base =
      accountsFilter === 'DEBT'
        ? allAccounts.filter(accountOwesMoney)
        : accountsFilter === 'PAID'
          ? periodAccounts.filter((account) => {
              // Pagada = tenía algo que cobrar y quedó en cero. Las de $0 (canceladas) van solo en Todas.
              const total = Number(accountDetailById[account.id]?.total ?? account.totalAmount ?? 0);
              return total > ACCOUNT_PAYMENT_EPSILON && accountRemaining(account) <= ACCOUNT_PAYMENT_EPSILON;
            })
          : periodAccounts;
    return base
      .filter((account) => {
        if (!search) return true;
        const haystack = [
          account.booking?.clientName || '',
          account.client?.name || '',
          account.booking?.courtName || '',
          accountKindLabel[account.sourceType] || '',
          account.booking?.id ? String(account.booking.id) : '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => accountWhen(b).getTime() - accountWhen(a).getTime());
  }, [accountDetailById, accountOwesMoney, accountRemaining, accountsFilter, accountsSearchTerm, allAccounts, periodAccounts]);

  const selectedAccount = useMemo(
    () => allAccounts.find((account) => account.id === selectedAccountId) || null,
    [allAccounts, selectedAccountId]
  );
  const selectedAccountDetail = selectedAccountId ? accountDetailById[selectedAccountId] || null : null;

  // Precio por jugador (D9, opción D): el cajero valida al socio presente y su parte pasa a precio socio.
  const [validatingMemberItemId, setValidatingMemberItemId] = useState<string | null>(null);
  const handleValidateMemberFromCash = useCallback(async (accountId: string, item: AccountDetailItem) => {
    if (!item.playerSlot) return;
    try {
      setValidatingMemberItemId(item.id);
      await PlayerPricingService.validateMember(item.playerSlot.bookingId, item.playerSlot.slotIndex);
      await ensureAccountDetail(accountId, true);
      showAdminToast('Socio validado: se aplicó el precio socio.');
    } catch (validationError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'validateMemberFromCash' }, validationError);
      showAdminToast(extractErrorMessage(validationError, 'No se pudo validar al socio.'));
    } finally {
      setValidatingMemberItemId(null);
    }
  }, [ensureAccountDetail]);
  const accountDrawerContext = useMemo<AccountDrawerContext | undefined>(() => {
    if (!selectedAccount) return undefined;
    const startTime = formatAccountTime(selectedAccount.booking?.startDateTime);
    const endTime = formatAccountTime(selectedAccount.booking?.endDateTime);
    const subtitleParts = [
      formatAccountDay(accountWhen(selectedAccount)),
      startTime ? (endTime ? `${startTime}–${endTime}` : startTime) : '',
      selectedAccount.booking?.courtName
        ? `${accountKindLabel[selectedAccount.sourceType]} · ${selectedAccount.booking.courtName}`
        : accountKindLabel[selectedAccount.sourceType],
    ].filter(Boolean);
    return {
      title:
        selectedAccount.booking?.clientName?.trim() ||
        selectedAccount.client?.name?.trim() ||
        accountKindLabel[selectedAccount.sourceType],
      subtitle: subtitleParts.join(' · '),
      accountStatus: selectedAccount.status,
    };
  }, [selectedAccount]);

  useEffect(() => {
    if (activeTab !== 'ACCOUNTS') return;
    if (filteredAccounts.length === 0) return;
    if (selectedAccountId && filteredAccounts.some((account) => account.id === selectedAccountId)) return;
    setSelectedAccountId(filteredAccounts[0].id);
  }, [activeTab, filteredAccounts, selectedAccountId]);

  // Filas de la lista: cuándo, quién, qué y cuánto debe.
  const cashAccountItems: CashAccountItem[] = useMemo(
    () =>
      filteredAccounts.map((account) => {
        const d = accountDetailById[account.id];
        const total = d ? Number(d.total || 0) : Number(account.totalAmount || 0);
        const paid = d ? Number(d.paid || 0) : Number(account.paidAmount || 0);
        const startTime = formatAccountTime(account.booking?.startDateTime);
        const endTime = formatAccountTime(account.booking?.endDateTime);
        const title =
          account.booking?.clientName?.trim() ||
          account.client?.name?.trim() ||
          accountKindLabel[account.sourceType];
        const concept = account.booking?.courtName
          ? `${accountKindLabel[account.sourceType]} · ${account.booking.courtName}`
          : accountKindLabel[account.sourceType];
        return {
          id: account.id,
          status: account.status,
          sourceType: account.sourceType,
          title,
          concept,
          dateLabel: formatAccountDay(accountWhen(account)),
          timeLabel: startTime ? (endTime ? `${startTime}–${endTime}` : startTime) : null,
          bookingId: account.booking?.id ?? null,
          total,
          paid,
          remaining: accountRemaining(account),
        };
      }),
    [accountDetailById, accountRemaining, filteredAccounts]
  );
  const selectedAccountItem = useMemo(
    () => cashAccountItems.find((account) => account.id === selectedAccountId) || null,
    [cashAccountItems, selectedAccountId]
  );

  const selectedAccountDetailLoading = Boolean(
    selectedAccountId && loadingAccountDetailById[selectedAccountId]
  );
  const selectedAccountVisible = useMemo(
    () => filteredAccounts.some((account) => account.id === selectedAccountId),
    [filteredAccounts, selectedAccountId]
  );
  const refundRequestAccount = useMemo(
    () => allAccounts.find((account) => account.id === refundRequestAccountId) || null,
    [allAccounts, refundRequestAccountId]
  );
  const refundRequestAccountDetail = refundRequestAccountId ? accountDetailById[refundRequestAccountId] || null : null;
  const refundRequestAccountRefunds = refundRequestAccountId
    ? refundsByAccountId[refundRequestAccountId] || EMPTY_REFUNDS
    : EMPTY_REFUNDS;
  const refundRequestPaymentOptions = useMemo(() => {
    const payments = Array.isArray(refundRequestAccountDetail?.payments) ? refundRequestAccountDetail.payments : [];
    return payments.map((payment) => {
      const reserved = refundRequestAccountRefunds
        .filter((refund) => String(refund.paymentId) === String(payment.id))
        .filter((refund) => reservedRefundStatuses.has(String(refund.status || '').toUpperCase()))
        .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      const available = Number(Math.max(0, Number(payment.amount || 0) - reserved).toFixed(2));
      return {
        ...payment,
        refundedAmount: Number(reserved.toFixed(2)),
        availableAmount: available,
      };
    });
  }, [refundRequestAccountDetail, refundRequestAccountRefunds]);

  const accountsWithRefundablePayments = useMemo(() => {
    return allAccounts.filter((account) => {
      const detail = accountDetailById[account.id];
      // If detail is not yet loaded, include the account so the user can select it
      // and we will fetch its detail when opening the refund flow.
      if (!detail) return true;
      if (!Array.isArray(detail.payments) || detail.payments.length === 0) return false;
      const refunds = refundsByAccountId[account.id] || [];
      for (const payment of detail.payments) {
        const reserved = refunds
          .filter((refund) => String(refund.paymentId) === String(payment.id))
          .filter((refund) => reservedRefundStatuses.has(String(refund.status || '').toUpperCase()))
          .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
        const available = Number(Math.max(0, Number(payment.amount || 0) - reserved).toFixed(2));
        if (available > ACCOUNT_PAYMENT_EPSILON) return true;
      }
      return false;
    });
  }, [allAccounts, accountDetailById, refundsByAccountId]);
  const refundRequestSelectedPayment = useMemo(
    () => refundRequestPaymentOptions.find((payment) => payment.id === refundRequestPaymentId) || null,
    [refundRequestPaymentId, refundRequestPaymentOptions]
  );
  const refundRequestAmountNumeric = Number(String(refundRequestAmountDraft || '').replace(',', '.'));
  const refundRequestAmountIsValid =
    Number.isFinite(refundRequestAmountNumeric) &&
    refundRequestAmountNumeric > ACCOUNT_PAYMENT_EPSILON &&
    refundRequestSelectedPayment != null &&
    refundRequestAmountNumeric <= Number(refundRequestSelectedPayment.availableAmount || 0) + ACCOUNT_PAYMENT_EPSILON;
  const selectedRefund = useMemo(
    () => recentRefunds.find((refund) => refund.id === selectedRefundId) ||
      pendingRefunds.find((refund) => refund.id === selectedRefundId) ||
      Object.values(refundsByAccountId).flat().find((refund) => refund.id === selectedRefundId) ||
      null,
    [pendingRefunds, recentRefunds, refundsByAccountId, selectedRefundId]
  );
  const refundActionCopyValue = refundActionConfirm ? refundActionCopy(refundActionConfirm.action) : null;
  const refundQuickActions = useCallback((refund: RefundRecord): Array<{ key: string; label: string; icon: ReactNode; action: RefundActionKind; tone?: 'danger' | 'muted' }> => {
    if (refund.status === 'REQUESTED') {
      return [
        { key: 'approve', label: 'Aprobar', icon: <Check size={14} />, action: 'approve' },
        { key: 'cancel', label: 'Cancelar', icon: <X size={14} />, action: 'cancel', tone: 'danger' },
      ];
    }
    if (refund.status === 'APPROVED' || refund.status === 'READY_TO_EXECUTE') {
      return [
        { key: 'execute', label: 'Ejecutar', icon: <Play size={14} />, action: 'execute' },
        { key: 'fail', label: 'Marcar fallida', icon: <XCircle size={14} />, action: 'fail', tone: 'muted' },
      ];
    }
    if (refund.status === 'FAILED') {
      return [
        { key: 'retry', label: 'Reintentar', icon: <RotateCcw size={14} />, action: 'retry' },
        { key: 'cancel', label: 'Cancelar', icon: <X size={14} />, action: 'cancel', tone: 'danger' },
      ];
    }
    return [];
  }, []);

  const closeRefundRequestDrawer = useCallback(() => {
    if (submittingRefundRequest) return;
    setRefundRequestOpen(false);
    setRefundRequestError('');
  }, [submittingRefundRequest]);

  const openRefundRequestSelector = useCallback(() => {
    setRefundRequestAccountLocked(false);
    setRefundRequestAccountId('');
    setRefundRequestPaymentId('');
    setRefundRequestAmountDraft('');
    setRefundRequestReasonType('OTHER');
    setRefundRequestNotes('');
    setRefundRequestExecuteNow(false);
    setRefundRequestError('');
    setRefundRequestOpen(true);
  }, []);

  useEffect(() => {
    if (!refundRequestOpen) return;
    if (allAccounts.length === 0) return;
    const missingIds = allAccounts
      .map((account) => account.id)
      .filter((id) => !accountDetailById[id] && !loadingAccountDetailById[id]);
    if (missingIds.length === 0) return;
    void Promise.allSettled(missingIds.map((id) => ensureAccountDetail(id)));
  }, [refundRequestOpen, allAccounts, accountDetailById, ensureAccountDetail, loadingAccountDetailById]);

  const openRefundRequestForAccount = useCallback(async (accountId: string, options?: { lockAccount?: boolean }) => {
    const key = String(accountId || '').trim();
    if (!key) {
      showAdminToast('Seleccioná una cuenta con pagos para solicitar una devolución.', 'warning');
      return;
    }

    setRefundRequestAccountLocked(options?.lockAccount ?? true);
    setRefundRequestAccountId(key);
    setRefundRequestPaymentId('');
    setRefundRequestAmountDraft('');
    setRefundRequestReasonType('OTHER');
    setRefundRequestNotes('');
    setRefundRequestExecuteNow(false);
    setRefundRequestError('');
    setRefundRequestOpen(true);

    const [detail, refunds] = await Promise.all([
      ensureAccountDetail(key, true),
      ensureAccountRefunds(key, true),
    ]);

    const payments = Array.isArray(detail?.payments) ? detail.payments : [];
    const firstAvailable = payments
      .map((payment) => {
        const reserved = refunds
          .filter((refund) => String(refund.paymentId) === String(payment.id))
          .filter((refund) => reservedRefundStatuses.has(String(refund.status || '').toUpperCase()))
          .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
        return {
          id: String(payment.id),
          available: Number(Math.max(0, Number(payment.amount || 0) - reserved).toFixed(2)),
        };
      })
      .find((payment) => payment.available > ACCOUNT_PAYMENT_EPSILON);

    if (firstAvailable) {
      setRefundRequestPaymentId(firstAvailable.id);
      setRefundRequestAmountDraft(firstAvailable.available.toFixed(2));
      setRefundRequestReasonType('FULL');
    } else if (payments.length > 0) {
      setRefundRequestPaymentId(String(payments[0].id));
      setRefundRequestError('Los pagos de esta cuenta no tienen saldo disponible para devolver.');
    } else {
      setRefundRequestError('Esta cuenta no tiene pagos registrados para devolver.');
    }
  }, [ensureAccountDetail, ensureAccountRefunds]);

  const submitRefundRequest = useCallback(async () => {
    if (!refundRequestAccountId || !refundRequestSelectedPayment) return;
    const amount = Number(String(refundRequestAmountDraft || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= ACCOUNT_PAYMENT_EPSILON) {
      setRefundRequestError('Ingresá un monto válido mayor a 0.');
      return;
    }
    if (amount > Number(refundRequestSelectedPayment.availableAmount || 0) + ACCOUNT_PAYMENT_EPSILON) {
      setRefundRequestError(`El monto no puede superar ${formatMoney(refundRequestSelectedPayment.availableAmount)}.`);
      return;
    }

    try {
      setSubmittingRefundRequest(true);
      setRefundRequestError('');
      const executionMethod = resolveRefundExecutionMethod(refundRequestSelectedPayment.method);
      const created = await requestPaymentRefund(refundRequestSelectedPayment.id, {
        amount: Number(amount.toFixed(2)),
        reasonType: refundRequestReasonType,
        reason: refundRequestReasonType === 'FULL'
          ? 'Devolución total solicitada desde Caja'
          : 'Devolución solicitada desde Caja',
        executionMethod,
        executionNotes: refundRequestNotes.trim() || undefined,
        executeNow: refundRequestExecuteNow,
      });
      await Promise.all([
        refresh(),
        ensureAccountDetail(refundRequestAccountId, true),
        ensureAccountRefunds(refundRequestAccountId, true),
        loadCashSummary(),
        loadCashShiftContext(),
      ]);
      setSelectedRefundId(created.id);
      setRefundRequestOpen(false);
      navigateToPaymentsTab('REFUNDS');
      showAdminToast(refundRequestExecuteNow ? 'Devolución ejecutada correctamente.' : 'Devolución solicitada correctamente.');
    } catch (refundError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'submitRefundRequest' }, refundError);
      setRefundRequestError(extractErrorMessage(refundError, 'No se pudo solicitar la devolución.'));
    } finally {
      setSubmittingRefundRequest(false);
    }
  }, [
    ensureAccountDetail,
    ensureAccountRefunds,
    loadCashShiftContext,
    loadCashSummary,
    navigateToPaymentsTab,
    refresh,
    refundRequestAccountId,
    refundRequestAmountDraft,
    refundRequestExecuteNow,
    refundRequestNotes,
    refundRequestReasonType,
    refundRequestSelectedPayment,
  ]);

  const closeRefundDetailDrawer = useCallback(() => {
    if (refundActionBusy) return;
    setSelectedRefundId('');
    setRefundActionConfirm(null);
    setRefundActionError('');
    setRefundActionReason('');
  }, [refundActionBusy]);

  const openRefundActionConfirm = useCallback((refund: RefundRecord, action: RefundActionKind) => {
    setRefundActionConfirm({ refundId: refund.id, action });
    setRefundActionReason('');
    setRefundActionError('');
  }, []);

  const runRefundAction = useCallback(async () => {
    if (!refundActionConfirm) return;
    const { refundId, action } = refundActionConfirm;
    const copy = refundActionCopy(action);
    const reason = refundActionReason.trim();
    if (copy.needsReason && reason.length < 3) {
      setRefundActionError('Ingresá un motivo de al menos 3 caracteres.');
      return;
    }

    try {
      setRefundActionBusy(true);
      setRefundActionError('');
      if (action === 'approve') {
        await approveRefund(refundId, { executeNow: false });
      } else if (action === 'approve_execute') {
        await approveRefund(refundId, { executeNow: true });
      } else if (action === 'execute') {
        await executeRefund(refundId);
      } else if (action === 'retry') {
        await retryRefund(refundId, { executeNow: true });
      } else if (action === 'fail') {
        await failRefund(refundId, reason);
      } else {
        await cancelRefund(refundId, reason);
      }
      const accountId = String(selectedRefund?.accountId || '').trim();
      await Promise.all([
        refresh(),
        accountId ? ensureAccountDetail(accountId, true) : Promise.resolve(null),
        accountId ? ensureAccountRefunds(accountId, true) : Promise.resolve([]),
        loadCashSummary(),
        loadCashShiftContext(),
      ]);
      setRefundActionConfirm(null);
      setRefundActionReason('');
      showAdminToast('Devolución actualizada correctamente.');
    } catch (actionError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'runRefundAction' }, actionError);
      setRefundActionError(extractErrorMessage(actionError, 'No se pudo actualizar la devolución.'));
    } finally {
      setRefundActionBusy(false);
    }
  }, [
    ensureAccountDetail,
    ensureAccountRefunds,
    loadCashShiftContext,
    loadCashSummary,
    refresh,
    refundActionConfirm,
    refundActionReason,
    selectedRefund?.accountId,
  ]);


  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }
  if (!hasOperatorAccess(user)) {
    return <NotFound message="No tenés permiso para acceder al panel de administración." />;
  }

  return (
    <>
      <Head>
        <title>Caja | Pique Admin</title>
      </Head>
      <AdminPlaygroundShell activeItem="Caja" user={user} contentMuted={cashActionSidebarOpen}>
        <div className="flex h-full min-h-0 flex-col gap-3 p-3.5 lg:gap-4 lg:p-6">
          <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-p-text lg:hidden">Caja</h1>
          <AdminSegmentedControl
            ariaLabel="Secciones de caja"
            value={activeTab}
            onChange={(nextTab) => navigateToPaymentsTab(nextTab as PaymentsTab)}
            options={[
              { value: 'SUMMARY', label: 'Resumen' },
              { value: 'ACCOUNTS', label: 'Cuentas' },
              { value: 'MOVEMENTS', label: 'Movimientos' },
              { value: 'REFUNDS', label: 'Devoluciones' },
            ]}
            className="w-fit"
          />

          {error && (
            <AdminFeedbackBanner tone="error" compact>
              {error}
            </AdminFeedbackBanner>
          )}

          <section ref={paymentsContentScrollRef} className="min-h-0 flex-1 overflow-auto">
            {loading && (activeTab === 'ACCOUNTS' || activeTab === 'REFUNDS') ? (
              <div className="h-full grid place-items-center">
                <div className="inline-flex items-center gap-2 text-[13px] text-p-text-muted">
                  <span className="h-4 w-4 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                  Cargando módulo de pagos...
                </div>
              </div>
            ) : activeTab === 'ACCOUNTS' ? (
              <div className="space-y-4">
                {/* Qué mirar, buscar y crear: una sola fila. */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
                    {([
                      { id: 'DEBT', label: 'Por cobrar' },
                      { id: 'PAID', label: 'Pagadas' },
                      { id: 'ALL', label: 'Todas' },
                    ] as Array<{ id: AccountsFilter; label: string }>).map((option) => (
                      <button
                        key={`accounts-filter-${option.id}`}
                        type="button"
                        aria-pressed={accountsFilter === option.id}
                        onClick={() => setAccountsFilter(option.id)}
                        className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold transition ${
                          accountsFilter === option.id
                            ? 'bg-ink-900 text-ink-50'
                            : 'text-p-text-secondary hover:bg-p-surface-2'
                        }`}
                      >
                        {option.label}
                        {option.id === 'DEBT' && accountsDebtSummary.count > 0 ? ` (${accountsDebtSummary.count})` : ''}
                      </button>
                    ))}
                  </div>

                  {accountsFilter !== 'DEBT' && (
                    <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
                      {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                        <button
                          key={`accounts-${period}`}
                          type="button"
                          onClick={() => {
                            setCashActivePeriod(period);
                            setCashPeriodOffset(0);
                          }}
                          className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition ${
                            cashActivePeriod === period
                              ? 'bg-p-surface-3 text-p-text'
                              : 'text-p-text-muted hover:text-p-text-secondary'
                          }`}
                        >
                          {period === 'hoy' ? 'Día' : period === 'semana' ? 'Semana' : 'Mes'}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label="Período anterior"
                        onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span className="min-w-[96px] text-center text-[12px] font-semibold text-p-text-secondary">{cashPeriodLabel}</span>
                      <button
                        type="button"
                        aria-label="Período siguiente"
                        onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                        disabled={cashPeriodOffset === 0}
                        className="grid h-7 w-7 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  )}

                  <label className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                    <input
                      type="text"
                      value={accountsSearchTerm}
                      onChange={(event) => setAccountsSearchTerm(event.target.value)}
                      placeholder="Buscar cliente o cancha"
                      className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void handleQuickOpenAccount()}
                    disabled={openingAccount}
                    className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-3.5 text-[13px] font-semibold text-p-text hover:bg-p-surface-2 disabled:opacity-60"
                  >
                    <Plus size={15} strokeWidth={2.5} />
                    {openingAccount ? 'Creando...' : 'Cuenta suelta'}
                  </button>
                </div>

                {accountsFilter === 'DEBT' && (
                  <p className="text-[15px] text-p-text-secondary">
                    {accountsDebtSummary.count === 0 ? (
                      'Nadie debe nada. 🎉'
                    ) : (
                      <>
                        Te deben <span className="font-bold tabular-nums text-p-text">{formatMoney(accountsDebtSummary.amount)}</span>{' '}
                        en {accountsDebtSummary.count === 1 ? '1 cuenta' : `${accountsDebtSummary.count} cuentas`}.
                      </>
                    )}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className="lg:max-h-[640px] lg:overflow-y-auto lg:pr-1">
                    <CashAccountsList
                      accounts={cashAccountItems}
                      selectedId={selectedAccountId}
                      onSelect={handleSelectAccount}
                      onPay={(accountId) => openAccountDrawer(accountId, 'payment')}
                      emptyTitle={
                        accountsSearchTerm.trim()
                          ? 'Sin resultados'
                          : accountsFilter === 'DEBT'
                            ? 'No hay nada por cobrar'
                            : 'No hay cuentas en este período'
                      }
                      emptyDescription={
                        accountsSearchTerm.trim()
                          ? 'Probá con otro nombre o cancha.'
                          : accountsFilter === 'DEBT'
                            ? 'Todas las cuentas están al día.'
                            : 'Cambiá el período para ver otras fechas.'
                      }
                    />
                  </div>

                  <div
                    ref={selectedAccountDetailFocusRef}
                    tabIndex={-1}
                    className="min-w-0 scroll-mt-4 outline-none lg:sticky lg:top-0 lg:max-h-[640px]"
                  >
                    {selectedAccountVisible && selectedAccountItem ? (
                      <CashAccountDetailPanel
                        account={selectedAccountItem}
                        detail={selectedAccountDetail}
                        loading={selectedAccountDetailLoading}
                        error={accountDetailError}
                        onManage={() => openAccountDrawer(selectedAccountItem.id, 'add_item')}
                        onPay={() => openAccountDrawer(selectedAccountItem.id, 'payment')}
                        onRefund={() => void openRefundRequestForAccount(selectedAccountItem.id)}
                        onCloseAccount={() => openAccountDrawer(selectedAccountItem.id, 'close')}
                        onInvoice={fiscalBillingEnabled ? () => openAccountDrawer(selectedAccountItem.id, 'invoice') : undefined}
                        onValidateMember={(item) => void handleValidateMemberFromCash(selectedAccountItem.id, item as AccountDetailItem)}
                        validatingItemId={validatingMemberItemId}
                      />
                    ) : (
                      cashAccountItems.length > 0 && (
                        <CashAccountDetailPanel
                          account={null}
                          detail={null}
                          loading={false}
                          error=""
                          onManage={() => undefined}
                          onPay={() => undefined}
                          onRefund={() => undefined}
                          onCloseAccount={() => undefined}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>
            ) : isCashSectionTab(activeTab) ? (
              <div className="space-y-4">
                {cashActiveView === 'live' && (
                  <>
                    <CashShiftPanel
                      shift={cashCurrentShift}
                      loading={loadingCashShift}
                      onToggleShift={() => {
                        if (cashCurrentShift && shouldBlockCloseShiftWithOpenAccounts) {
                          showAdminToast(closeShiftBlockedMessage, 'warning');
                          return;
                        }
                        if (cashCurrentShift) setCashCloseShiftForm({ countedCash: '' });
                        setCashSidebarView(cashCurrentShift ? 'close_shift' : 'open_shift');
                      }}
                      onRegisterMovement={() => setCashSidebarView('movement_create')}
                      onProductSale={() => setCashSidebarView('product_sale')}
                      onViewLastClose={cashClosedShifts.length > 0 ? () => openCashClosesView() : undefined}
                    />
                    <CashTodayToCollect
                      items={cashTodayToCollect.items}
                      olderDebt={cashTodayToCollect.olderDebt}
                      loading={loading}
                      onPay={(accountId) => openAccountDrawer(accountId, 'payment')}
                      onSeeAccounts={() => {
                        setAccountsFilter('DEBT');
                        navigateToPaymentsTab('ACCOUNTS');
                      }}
                    />
                    <div className="w-full rounded-2xl border border-p-border bg-p-surface p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface-2 p-1">
                          {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                            <button
                              key={period}
                              type="button"
                              onClick={() => {
                                setCashActivePeriod(period);
                                setCashPeriodOffset(0);
                              }}
                              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                                cashActivePeriod === period
                                  ? 'bg-p-surface text-p-accent shadow-sm'
                                  : 'text-p-text-muted hover:text-p-text-secondary'
                              }`}
                            >
                              {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface px-1 py-1">
                          <button
                            type="button"
                            onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="min-w-[120px] text-center text-[12px] font-semibold text-p-text-secondary">{cashPeriodLabel}</span>
                          <button
                            type="button"
                            onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                            disabled={cashPeriodOffset === 0}
                            className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:text-p-text-muted disabled:hover:bg-transparent"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <CashSummaryCards
                      balance={cashBalance}
                      loading={loadingCashSummary}
                      emptyText={
                        cashActivePeriod === 'hoy' && cashPeriodOffset === 0
                          ? 'Hoy todavía no entró ni salió plata.'
                          : `En ${cashPeriodLabel.toLowerCase()} no entró ni salió plata.`
                      }
                    />
                  </>
                )}

                {(cashSummaryError || cashShiftError || cashMovementError) && (
                  <div className="space-y-2">
                    {cashSummaryError && <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">{cashSummaryError}</div>}
                    {cashShiftError && <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">{cashShiftError}</div>}
                    {cashMovementError && <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">{cashMovementError}</div>}
                  </div>
                )}


                {cashActiveView === 'movements' && (
                  <div className="space-y-4">
                    {/* Qué mirar, buscar y agregar: una sola fila. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <CashPeriodPicker
                        period={cashActivePeriod}
                        label={cashPeriodLabel}
                        offset={cashPeriodOffset}
                        onPeriod={(period) => {
                          setCashActivePeriod(period);
                          setCashPeriodOffset(0);
                        }}
                        onOffset={setCashPeriodOffset}
                      />
                      <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
                        {([
                          { id: 'ALL', label: 'Todo' },
                          { id: 'INCOME', label: 'Entradas' },
                          { id: 'EXPENSE', label: 'Salidas' },
                        ] as Array<{ id: MovementTypeFilter; label: string }>).map((option) => (
                          <button
                            key={`movement-type-${option.id}`}
                            type="button"
                            aria-pressed={cashTypeFilter === option.id}
                            onClick={() => setCashTypeFilter(option.id)}
                            className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition ${
                              cashTypeFilter === option.id ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
                        {([
                          { id: 'ALL', label: 'Todos' },
                          { id: 'CASH', label: 'Efectivo' },
                          { id: 'TRANSFER', label: 'Transferencia' },
                          { id: 'CARD', label: 'Tarjeta' },
                        ] as Array<{ id: MovementMethodFilter; label: string }>).map((option) => (
                          <button
                            key={`movement-method-${option.id}`}
                            type="button"
                            aria-pressed={cashMethodFilter === option.id}
                            onClick={() => setCashMethodFilter(option.id)}
                            className={`h-7 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold transition ${
                              cashMethodFilter === option.id ? 'bg-p-surface-3 text-p-text' : 'text-p-text-muted hover:text-p-text-secondary'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <label className="relative min-w-[180px] flex-1 sm:max-w-[260px]">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                        <input
                          type="text"
                          value={cashSearchTerm}
                          onChange={(event) => setCashSearchTerm(event.target.value)}
                          placeholder="Buscar"
                          className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                        />
                      </label>
                      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
                        <button
                          type="button"
                          onClick={() => setCashSidebarView('product_sale')}
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-3.5 text-[13px] font-semibold text-p-text hover:bg-p-surface-2"
                        >
                          <Plus size={15} strokeWidth={2.5} />
                          Venta mostrador
                        </button>
                        <button
                          type="button"
                          onClick={() => setCashSidebarView('movement_create')}
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
                        >
                          <Plus size={15} strokeWidth={2.5} />
                          Ingreso o egreso
                        </button>
                      </div>
                    </div>

                    {/* El resultado del período en una frase. */}
                    <p className="text-[15px] text-p-text-secondary">
                      {loadingCashSummary && filteredCashMovements.length === 0 ? (
                        'Cargando…'
                      ) : (
                        <>
                          Entró <span className="font-bold tabular-nums text-p-positive">{formatMoney(filteredIncomeAmount)}</span>
                          {' · '}salió <span className="font-bold tabular-nums text-p-error">{formatMoney(filteredExpenseAmount)}</span>
                          {' · '}
                          {'en total '}
                          <span className="font-bold tabular-nums text-p-text">
                            {filteredNetAmount < 0 ? '−' : '+'}
                            {formatMoney(Math.abs(filteredNetAmount))}
                          </span>
                        </>
                      )}
                    </p>

                    <CashMovementsTimeline
                      movements={filteredCashMovements}
                      allMovements={cashMovements}
                      onOpenAccount={(accountId) => openAccountDrawer(accountId, 'overview')}
                      loading={loadingCashSummary}
                      emptyTitle={
                        cashSearchTerm.trim() || cashTypeFilter !== 'ALL' || cashMethodFilter !== 'ALL'
                          ? 'Sin resultados'
                          : 'No hubo movimientos'
                      }
                      emptyDescription={
                        cashSearchTerm.trim() || cashTypeFilter !== 'ALL' || cashMethodFilter !== 'ALL'
                          ? 'Probá sacando algún filtro.'
                          : 'En este período no entró ni salió plata.'
                      }
                    />
                  </div>
                )}

                {cashActiveView === 'closures' && (
                  <CashCloseFlow
                    shift={cashCurrentShift}
                    lastReport={cashLastCloseReport}
                    onCloseShift={() => {
                      if (shouldBlockCloseShiftWithOpenAccounts) {
                        showAdminToast(closeShiftBlockedMessage, 'warning');
                        return;
                      }
                      setCashCloseShiftForm({ countedCash: '' });
                      setCashSidebarView('close_shift');
                    }}
                    onViewReport={() => setCashSidebarView('close_report')}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
                    {([
                      { id: 'ALL', label: 'Todas' },
                      { id: 'TODO', label: refundsTodo.count > 0 ? `Por hacer (${refundsTodo.count})` : 'Por hacer' },
                      { id: 'DONE', label: 'Devueltas' },
                    ] as Array<{ id: 'ALL' | 'TODO' | 'DONE'; label: string }>).map((option) => (
                      <button
                        key={`refund-stage-${option.id}`}
                        type="button"
                        aria-pressed={refundStageFilter === option.id}
                        onClick={() => setRefundStageFilter(option.id)}
                        className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold transition ${
                          refundStageFilter === option.id ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {refundStageFilter !== 'TODO' && (
                    <CashPeriodPicker
                      period={cashActivePeriod}
                      label={cashPeriodLabel}
                      offset={cashPeriodOffset}
                      onPeriod={(period) => {
                        setCashActivePeriod(period);
                        setCashPeriodOffset(0);
                      }}
                      onOffset={setCashPeriodOffset}
                    />
                  )}
                  <label className="relative min-w-[180px] flex-1 sm:max-w-[280px]">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                    <input
                      type="text"
                      value={refundSearchTerm}
                      onChange={(event) => setRefundSearchTerm(event.target.value)}
                      placeholder="Buscar cliente o motivo"
                      className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={openRefundRequestSelector}
                    className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
                  >
                    <Plus size={15} strokeWidth={2.5} />
                    Devolver plata
                  </button>
                </div>

                {refundsTodo.count > 0 && refundStageFilter !== 'TODO' && (
                  <button
                    type="button"
                    onClick={() => setRefundStageFilter('TODO')}
                    className="w-full rounded-xl bg-p-warning-bg px-4 py-3 text-left text-[14px] text-p-warning"
                  >
                    <span className="font-semibold">
                      {refundsTodo.count === 1 ? 'Hay 1 devolución por hacer' : `Hay ${refundsTodo.count} devoluciones por hacer`}
                    </span>{' '}
                    ({formatMoney(refundsTodo.amount)}). Ver →
                  </button>
                )}

                {filteredRecentRefunds.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-p-border px-4 py-10 text-center">
                    <p className="text-[14px] font-semibold text-p-text-secondary">
                      {refundStageFilter === 'TODO' ? 'No hay nada por devolver' : 'No hay devoluciones en este período'}
                    </p>
                    <p className="mt-1 text-[12px] text-p-text-muted">
                      {refundStageFilter === 'TODO'
                        ? 'Todas las devoluciones están hechas.'
                        : 'Cambiá el período para ver otras fechas.'}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {filteredRecentRefunds.map((refund) => {
                      const isSelected = selectedRefundId === refund.id;
                      const account = allAccounts.find((row) => row.id === refund.accountId);
                      const who =
                        account?.booking?.clientName?.trim() ||
                        account?.client?.name?.trim() ||
                        (account ? accountKindLabel[account.sourceType] : 'Cuenta');
                      const status = String(refund.status || '').toUpperCase();
                      const rawReason = refund.reason?.trim() || '';
                      const reason = /^Cancelaci[oó]n reserva/i.test(rawReason)
                        ? 'Reserva cancelada'
                        : rawReason.replace(/\s*#\S+/g, '').trim() || refundReasonTypeLabel(refund.reasonType);
                      const bookingWhere = account?.booking?.courtName
                        ? ` · ${account.booking.courtName}${
                            account.booking.startDateTime ? ` ${formatAccountDay(new Date(account.booking.startDateTime))}` : ''
                          }`
                        : '';
                      const actions = refundQuickActions(refund);
                      const created = new Date(refund.createdAt);
                      const when = Number.isNaN(created.getTime())
                        ? ''
                        : `${formatAccountDay(created)} ${formatAccountTime(refund.createdAt) || ''}`;
                      return (
                        <li key={`refund-row-${refund.id}`}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedRefundId(refund.id)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              setSelectedRefundId(refund.id);
                            }}
                            className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 outline-none transition sm:grid-cols-[104px_minmax(0,1fr)_auto] ${
                              isSelected ? 'border-ink-900 bg-p-surface-2' : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                            }`}
                          >
                            <p className="col-span-2 text-[12px] text-p-text-muted sm:col-span-1">{when}</p>
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold text-p-text">{who}</p>
                              <p className="truncate text-[12px] text-p-text-muted">
                                {reason}
                                {bookingWhere} · {refundExecutionMethodLabel(refund.executionMethod)}
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-3">
                              <div className="text-right">
                                <p className="text-[14px] font-bold tabular-nums text-p-text">{formatMoney(refund.amount)}</p>
                                <p className={`text-[11px] font-semibold ${refundStatusTone(status)}`}>{formatRefundStatus(status)}</p>
                              </div>
                              {actions.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openRefundActionConfirm(refund, actions[0].action);
                                  }}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  className="h-9 rounded-lg bg-ink-900 px-3.5 text-[12px] font-semibold text-ink-50 hover:bg-ink-800"
                                >
                                  {actions[0].action === 'approve'
                                    ? 'Aprobar'
                                    : actions[0].action === 'execute'
                                      ? 'Ya la devolví'
                                      : actions[0].action === 'retry'
                                        ? 'Reintentar'
                                        : actions[0].label}
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

        </div>
      </AdminPlaygroundShell>

      <AccountDrawer
        accountId={selectedAccountId || null}
        open={accountDrawerOpen}
        initialView={accountDrawerInitialView}
        context={accountDrawerContext}
        onClose={closeAccountDrawer}
        onSuccess={(event, meta?: AccountDrawerSuccessMeta) => {
          if (event === 'closed') {
            showAdminToast(`${meta?.label || 'Cuenta'} cerrada correctamente.`);
          }
          const accountId = meta?.accountId || selectedAccountId;
          void (async () => {
            await refresh();
            if (accountId) {
              await ensureAccountDetail(accountId, true);
              focusSelectedAccountDetail();
            }
            // Si hubo pago, refrescar también el resumen de caja (turno, movimientos)
            if (event === 'payment') {
              void loadCashSummary();
            }
          })();
        }}
        onRefundRequest={(acctId) => void openRefundRequestForAccount(acctId)}
      />


      <AdminDrawer
        open={refundRequestOpen}
        onClose={closeRefundRequestDrawer}
        title="Solicitar devolución"
        subtitle={
          refundRequestAccount
            ? `${refundRequestAccount.booking?.clientName || `Cuenta ${shortCode(refundRequestAccount.id)}`} · #${shortCode(refundRequestAccount.id)}`
            : 'Seleccioná una cuenta y un pago para devolver.'
        }
        statusChip={refundRequestAccount?.status === 'OPEN' ? 'Cuenta abierta' : refundRequestAccount ? 'Cuenta cerrada' : undefined}
        statusChipClassName={refundRequestAccount?.status === 'OPEN' ? 'bg-p-positive-bg text-p-accent' : 'bg-p-positive-bg text-p-positive'}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeRefundRequestDrawer}
              disabled={submittingRefundRequest}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2 disabled:opacity-60"
            >
              <X size={14} />
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submitRefundRequest()}
              disabled={submittingRefundRequest || !refundRequestAmountIsValid}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-900 disabled:opacity-60"
            >
              <Check size={14} />
              {submittingRefundRequest
                ? 'Procesando...'
                : refundRequestExecuteNow
                  ? 'Solicitar y ejecutar'
                  : 'Solicitar devolución'}
            </button>
          </div>
        }
      >
        <AdminDrawerSection title="Cuenta" className={drawerSectionCardClass}>
          <div className="space-y-3">
            {refundRequestAccountLocked && refundRequestAccount ? (
              <div className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-p-text-muted">Cuenta seleccionada</p>
                <p className="mt-1 text-[13px] font-semibold text-p-text">{accountDisplayLabel(refundRequestAccount)}</p>
                <p className="mt-0.5 text-[11px] text-p-text-muted">
                  #{shortCode(refundRequestAccount.id)} · {refundRequestAccount.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                </p>
              </div>
            ) : (
              <label className="block">
                <span className="text-[12px] font-medium text-p-text-secondary">Cuenta asociada</span>
                <select
                  value={refundRequestAccountId}
                  onChange={(event) => {
                    const nextAccountId = event.target.value;
                    if (!nextAccountId) {
                      setRefundRequestAccountLocked(false);
                      setRefundRequestAccountId('');
                      setRefundRequestPaymentId('');
                      setRefundRequestAmountDraft('');
                      setRefundRequestReasonType('OTHER');
                      setRefundRequestError('');
                      return;
                    }
                    void openRefundRequestForAccount(nextAccountId, { lockAccount: false });
                  }}
                  disabled={submittingRefundRequest}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent disabled:opacity-60"
                >
                  <option value="">Seleccionar cuenta</option>
                  {accountsWithRefundablePayments.map((account) => (
                    <option key={`refund-account-option-${account.id}`} value={account.id}>
                      {accountDisplayLabel(account)} · #{shortCode(account.id)} · {account.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!refundRequestAccountId && (
              <p className="text-[12px] text-p-text-muted">
                Elegí una cuenta para ver sus pagos disponibles y solicitar la devolución sobre un pago concreto.
              </p>
            )}
            {allAccounts.length === 0 && (
              <p className="border-t border-p-border pt-3 text-[12px] text-p-text-muted">
                No hay cuentas cargadas para iniciar una devolución.
              </p>
            )}
          </div>
        </AdminDrawerSection>

        <AdminDrawerSection title="Pago a devolver" className={drawerSectionCardClass}>
          <div className="space-y-2">
            {Boolean(refundRequestAccountId && loadingRefundsByAccountId[refundRequestAccountId]) && (
              <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[12px] font-semibold text-p-accent">
                Cargando pagos y devoluciones...
              </div>
            )}
            {refundRequestPaymentOptions.length === 0 ? (
              <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-4 text-center text-[12px] text-p-text-muted">
                {refundRequestAccountId
                  ? 'Esta cuenta no tiene pagos disponibles para devolver.'
                  : 'Seleccioná una cuenta para ver sus pagos disponibles.'}
              </div>
            ) : (
              refundRequestPaymentOptions.map((payment) => {
                const selected = payment.id === refundRequestPaymentId;
                const disabled = Number(payment.availableAmount || 0) <= ACCOUNT_PAYMENT_EPSILON;
                return (
                  <button
                    key={`refund-payment-${payment.id}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setRefundRequestPaymentId(payment.id);
                      setRefundRequestAmountDraft(Number(payment.availableAmount || 0).toFixed(2));
                      setRefundRequestReasonType(Number(payment.availableAmount || 0) + ACCOUNT_PAYMENT_EPSILON >= Number(payment.amount || 0) ? 'FULL' : 'PARTIAL_COMMERCIAL');
                      setRefundRequestError('');
                    }}
                className={[
                  'w-full rounded-xl border px-3 py-3 text-left transition',
                  selected ? 'border-p-accent bg-p-positive-bg' : 'border-p-border bg-p-surface hover:bg-p-surface-2',
                  disabled ? 'cursor-not-allowed opacity-50' : '',
                ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-p-text">Pago #{shortCode(payment.id)}</p>
                        <p className="mt-0.5 text-[11px] text-p-text-muted">
                          {paymentMethodLabel(payment.method)} · {paymentChannelLabel(payment.channel || '')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-bold text-p-text">{formatMoney(payment.amount)}</p>
                        <p className="mt-0.5 text-[11px] text-p-text-muted">Disponible {formatMoney(payment.availableAmount)}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </AdminDrawerSection>

        <AdminDrawerSection title="Datos de la devolución" className={drawerSectionCardClass}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-medium text-p-text-secondary">Monto a devolver</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={refundRequestAmountDraft}
                onChange={(event) => {
                  setRefundRequestAmountDraft(event.target.value);
                  setRefundRequestError('');
                }}
                className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="0.00"
              />
              <span className="mt-1 block text-[11px] text-p-text-muted">
                Máximo: {formatMoney(refundRequestSelectedPayment?.availableAmount || 0)}
              </span>
            </label>

            <label className="block">
              <span className="text-[12px] font-medium text-p-text-secondary">Motivo</span>
              <select
                value={refundRequestReasonType}
                onChange={(event) => setRefundRequestReasonType(event.target.value as RefundReasonType)}
                className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
              >
                {refundReasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[12px] font-medium text-p-text-secondary">Nota interna</span>
              <textarea
                value={refundRequestNotes}
                onChange={(event) => setRefundRequestNotes(event.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1 w-full resize-none rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Detalle operativo"
              />
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
              <input
                type="checkbox"
                checked={refundRequestExecuteNow}
                onChange={(event) => setRefundRequestExecuteNow(event.target.checked)}
                className="h-4 w-4 accent-p-brand"
              />
              <span className="text-[12px] font-semibold text-p-text">Ejecutar ahora</span>
            </label>
          </div>
          {refundRequestError && (
            <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
              {refundRequestError}
            </div>
          )}
        </AdminDrawerSection>
      </AdminDrawer>

      {(() => {
        // Devolución: a quién, cuánto, cómo y qué pasó. Sin códigos internos.
        const refund = selectedRefund;
        const account = refund ? allAccounts.find((row) => row.id === refund.accountId) : null;
        const who =
          account?.booking?.clientName?.trim() ||
          account?.client?.name?.trim() ||
          (account ? accountKindLabel[account.sourceType] : 'Devolución');
        const rawReason = refund?.reason?.trim() || '';
        const reason = refund
          ? /^Cancelaci[oó]n reserva/i.test(rawReason)
            ? 'Reserva cancelada'
            : rawReason.replace(/\s*#\S+/g, '').trim() || refundReasonTypeLabel(refund.reasonType)
          : '';
        const bookingLine = account?.booking?.courtName
          ? [
              account.booking.startDateTime ? formatAccountDay(new Date(account.booking.startDateTime)) : '',
              formatAccountTime(account.booking.startDateTime) || '',
              account.booking.courtName,
            ]
              .filter(Boolean)
              .join(' · ')
          : '';
        const when = (value?: string | null) => {
          if (!value) return '';
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return '';
          return `${formatAccountDay(d)} ${formatAccountTime(value) || ''}`.trim();
        };
        const steps = refund
          ? ([
              ['Pedida', refund.createdAt],
              ['Aprobada', refund.approvedAt],
              ['Devuelta', refund.executedAt],
              ['Anulada', refund.cancelledAt],
              ['No se pudo devolver', refund.failedAt],
            ] as Array<[string, string | null | undefined]>).filter(([, value]) => Boolean(value))
          : [];
        const notes = refund
          ? ([
              ['Nota', refund.executionNotes],
              ['Comprobante', refund.executionReference],
              ['Por qué se anuló', refund.cancelReason],
              ['Por qué falló', refund.failedReason],
            ] as Array<[string, string | null | undefined]>).filter(([, value]) => Boolean(String(value || '').trim()))
          : [];
        const status = String(refund?.status || '').toUpperCase();
        const secondaryClass =
          'text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2';
        const primaryClass =
          'h-11 rounded-xl bg-ink-900 px-5 text-[14px] font-semibold text-ink-50 transition hover:bg-ink-800';
        return (
          <AdminDrawer
            open={Boolean(refund)}
            onClose={closeRefundDetailDrawer}
            title={who}
            subtitle={refund ? [reason, bookingLine].filter(Boolean).join(' · ') : undefined}
            statusChip={refund && status !== 'EXECUTED' ? formatRefundStatus(status) : undefined}
            statusChipClassName={
              status === 'FAILED' || status === 'CANCELLED'
                ? 'bg-p-surface-3 text-p-text-secondary'
                : 'bg-p-warning-bg text-p-warning'
            }
            size="md"
            footer={
              refund && REFUND_TODO_STATUSES.has(status) ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="button" onClick={() => openRefundActionConfirm(refund, 'cancel')} className={secondaryClass}>
                    Anular
                  </button>
                  {status === 'REQUESTED' && (
                    <button type="button" onClick={() => openRefundActionConfirm(refund, 'approve')} className={secondaryClass}>
                      Solo aprobar
                    </button>
                  )}
                  {(status === 'APPROVED' || status === 'READY_TO_EXECUTE') && (
                    <button type="button" onClick={() => openRefundActionConfirm(refund, 'fail')} className={secondaryClass}>
                      No se pudo devolver
                    </button>
                  )}
                  <div className="flex-1" />
                  {status === 'REQUESTED' && (
                    <button type="button" onClick={() => openRefundActionConfirm(refund, 'approve_execute')} className={primaryClass}>
                      Aprobar y devolver
                    </button>
                  )}
                  {(status === 'APPROVED' || status === 'READY_TO_EXECUTE') && (
                    <button type="button" onClick={() => openRefundActionConfirm(refund, 'execute')} className={primaryClass}>
                      Ya la devolví
                    </button>
                  )}
                  {status === 'FAILED' && (
                    <button type="button" onClick={() => openRefundActionConfirm(refund, 'retry')} className={primaryClass}>
                      Reintentar
                    </button>
                  )}
                </div>
              ) : undefined
            }
          >
            {refund && (
              <div className="space-y-5">
                <div>
                  <p className="text-[13px] text-p-text-muted">{status === 'EXECUTED' ? 'Se devolvió' : 'A devolver'}</p>
                  <p className="text-[30px] font-bold leading-tight tabular-nums text-p-text">{formatMoney(refund.amount)}</p>
                  <p className="text-[13px] text-p-text-secondary">En {refundExecutionMethodLabel(refund.executionMethod).toLowerCase()}</p>
                </div>

                {steps.length > 0 && (
                  <div className="border-t border-p-border pt-4">
                    <p className="text-[13px] font-semibold text-p-text">Qué pasó</p>
                    <ul className="mt-1 divide-y divide-p-border">
                      {steps.map(([label, value]) => (
                        <li key={label} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                          <span className="text-p-text">{label}</span>
                          <span className="tabular-nums text-p-text-muted">{when(value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {notes.length > 0 && (
                  <div className="border-t border-p-border pt-4">
                    <ul className="space-y-2">
                      {notes.map(([label, value]) => (
                        <li key={label} className="text-[13px]">
                          <span className="text-p-text-muted">{label}: </span>
                          <span className="text-p-text">{String(value).trim()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </AdminDrawer>
        );
      })()}

      <AdminAppModal
        show={Boolean(refundActionConfirm && refundActionCopyValue)}
        onClose={() => {
          if (refundActionBusy) return;
          setRefundActionConfirm(null);
          setRefundActionError('');
          setRefundActionReason('');
        }}
        onCancel={() => {
          if (refundActionBusy) return;
          setRefundActionConfirm(null);
          setRefundActionError('');
          setRefundActionReason('');
        }}
        title={refundActionCopyValue?.title || 'Confirmar acción'}
        message={
          refundActionCopyValue ? (
            <div className="space-y-4">
              <p>{refundActionCopyValue.message}</p>
              {refundActionCopyValue.needsReason && (
                <label className="block">
                  <span className="text-[12px] font-medium text-p-text-secondary">Motivo</span>
                  <textarea
                    value={refundActionReason}
                    onChange={(event) => {
                      setRefundActionReason(event.target.value);
                      setRefundActionError('');
                    }}
                    rows={3}
                    maxLength={500}
                    className="mt-1 w-full resize-none rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none transition focus:border-p-accent"
                    placeholder="Detalle operativo"
                  />
                </label>
              )}
              {refundActionError && (
                <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
                  {refundActionError}
                </div>
              )}
            </div>
          ) : null
        }
        cancelText="Volver"
        confirmText={refundActionBusy ? 'Procesando...' : refundActionCopyValue?.confirm || 'Confirmar'}
        isWarning={refundActionConfirm?.action === 'cancel' || refundActionConfirm?.action === 'fail'}
        confirmDisabled={refundActionBusy}
        closeOnBackdrop={!refundActionBusy}
        closeOnEscape={!refundActionBusy}
        onConfirm={() => void runRefundAction()}
      />


      <AdminDrawer
        open={cashActionSidebarOpen}
        onClose={closeActionSidebar}
        title={
          cashSidebarView === 'open_shift'
            ? 'Abrir caja'
            : cashSidebarView === 'close_shift'
              ? 'Cerrar caja'
              : cashSidebarView === 'movement_create'
                ? 'Ingreso o egreso'
                : cashSidebarView === 'close_report'
                  ? 'Cierres de caja'
                  : cashSidebarView === 'product_sale'
                    ? 'Venta mostrador'
                    : 'Caja'
        }
        subtitle={
          cashSidebarView === 'open_shift'
            ? 'Configura caja registradora y monto inicial.'
            : cashSidebarView === 'close_shift'
              ? 'Mirá qué pasó en el turno, contá el efectivo y anotá cuánto hay.'
              : cashSidebarView === 'movement_create'
                ? 'Plata que entra o sale de la caja sin ser un cobro: un pago a un proveedor, cambio para el cajón…'
                : cashSidebarView === 'close_report'
                  ? 'Lo que se contó en cada cierre.'
                  : cashSidebarView === 'product_sale'
                    ? 'Tocá lo que lleva y cobrá. El medio de pago se elige en el paso siguiente.'
                    : undefined
        }
        statusChip={cashCurrentShift ? 'Caja abierta' : 'Caja cerrada'}
        statusChipClassName={cashCurrentShift ? 'border-p-positive bg-p-positive-bg text-p-positive' : 'border-p-accent bg-p-positive-bg text-p-accent'}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeActionSidebar}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              <X size={14} />
              {cashSidebarView === 'close_report' ? 'Cerrar' : 'Cancelar'}
            </button>

            {cashSidebarView === 'open_shift' && (
              <button
                type="submit"
                form="cash-open-shift-form"
                disabled={openingCashShift}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Landmark size={14} />
                {openingCashShift ? 'Abriendo...' : 'Abrir caja'}
              </button>
            )}

            {cashSidebarView === 'close_shift' && (
              <button
                type="submit"
                form="cash-close-shift-form"
                disabled={closingCashShift || !cashCurrentShift}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check size={14} />
                {closingCashShift ? 'Cerrando...' : 'Cerrar caja'}
              </button>
            )}

            {cashSidebarView === 'movement_create' && (
              <button
                type="submit"
                form="cash-new-movement-form"
                disabled={submittingCashMovement || !cashCurrentShift}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus size={14} />
                {submittingCashMovement ? 'Guardando...' : cashNewMovement.type === 'EXPENSE' ? 'Anotar egreso' : 'Anotar ingreso'}
              </button>
            )}

            {cashSidebarView === 'product_sale' && (
              <button
                type="button"
                onClick={() => void handleCreatePosAccount()}
                disabled={posSubmitting || !cashCurrentShift}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CreditCard size={14} />
                {posSubmitting ? 'Preparando...' : posQuote && posQuote.finalTotal > 0 ? `Cobrar ${formatMoney(posQuote.finalTotal)}` : 'Cobrar'}
              </button>
            )}
          </div>
        }
      >
        {cashSidebarView === 'open_shift' && (
          <form id="cash-open-shift-form" className="space-y-5" onSubmit={handleOpenShift}>
            <AdminDrawerSection title="Caja" className={drawerSectionCardClass}>
              <label className="block">
                <span className="text-[12px] font-medium text-p-text-secondary">Caja registradora</span>
                <select
                  value={cashOpenShiftForm.cashRegisterId}
                  onChange={(event) => setCashOpenShiftForm((prev) => ({ ...prev, cashRegisterId: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                >
                  <option value="">Seleccionar</option>
                  {cashRegisters.map((register) => (
                    <option key={register.id} value={register.id}>
                      {register.name}
                    </option>
                  ))}
                </select>
              </label>
            </AdminDrawerSection>

            <AdminDrawerSection title="Monto inicial" className={drawerSectionCardClass}>
              <label className="block">
                <span className="text-[12px] font-medium text-p-text-secondary">Monto inicial</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashOpenShiftForm.openingAmount}
                  onChange={(event) => setCashOpenShiftForm((prev) => ({ ...prev, openingAmount: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                  placeholder="0"
                />
              </label>
            </AdminDrawerSection>
          </form>
        )}

        {cashSidebarView === 'close_shift' && (
          <form id="cash-close-shift-form" className="space-y-5" onSubmit={handleCloseShift}>
            {(() => {
              const expectedCash = Number(
                cashCurrentShift?.expectedCash ?? cashCurrentShift?.openingAmount ?? 0
              );
              const countedRaw = cashCloseShiftForm.countedCash.trim();
              const counted = Number(countedRaw);
              const hasCounted = countedRaw.length > 0 && Number.isFinite(counted);
              const difference = hasCounted ? Math.round((counted - expectedCash) * 100) / 100 : 0;
              return (
                <div className="space-y-4">
                  <CashCloseRecap
                    openingAmount={Number(cashCurrentShift?.openingAmount || 0)}
                    breakdown={cashCurrentShift?.breakdown}
                    expectedCash={expectedCash}
                    openedAt={cashCurrentShift?.openedAt}
                    registerName={cashCurrentShift?.cashRegister?.name}
                  />
                  {accountsDebtSummary.count > 0 && (
                    <p className="rounded-xl bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-secondary">
                      Quedan {accountsDebtSummary.count} {accountsDebtSummary.count === 1 ? 'cuenta' : 'cuentas'} sin cobrar (
                      {formatMoney(accountsDebtSummary.amount)}). No pasa nada si cerrás: siguen en Cuentas.
                    </p>
                  )}
                  <label className="block">
                    <span className="text-[13px] font-medium text-p-text">¿Cuánto contaste?</span>
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={cashCloseShiftForm.countedCash}
                      onChange={(event) => setCashCloseShiftForm({ countedCash: event.target.value })}
                      className="mt-1 h-12 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[18px] font-semibold tabular-nums text-p-text outline-none focus:border-p-border-strong"
                      placeholder="0"
                    />
                  </label>
                  {hasCounted && (
                    <p
                      className={`rounded-xl px-3 py-2.5 text-[14px] font-semibold ${
                        Math.abs(difference) <= 0.009
                          ? 'bg-p-positive-bg text-p-positive'
                          : 'bg-p-warning-bg text-p-warning'
                      }`}
                    >
                      {Math.abs(difference) <= 0.009
                        ? 'Coincide con lo esperado.'
                        : difference > 0
                          ? `Sobran ${formatMoney(difference)}. Queda anotado en el cierre.`
                          : `Faltan ${formatMoney(Math.abs(difference))}. Queda anotado en el cierre.`}
                    </p>
                  )}
                </div>
              );
            })()}
          </form>
        )}

        {cashSidebarView === 'movement_create' && (
          <form id="cash-new-movement-form" className="space-y-5" onSubmit={handleCreateMovement}>
            {cashMovementError && (
              <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">{cashMovementError}</div>
            )}
            {!cashCurrentShift && (
              <p className="rounded-xl bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">Abrí la caja para anotar ingresos o egresos.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'EXPENSE', label: 'Sale plata', hint: 'Pago, compra, retiro', active: 'border-p-error bg-p-error-bg text-p-error' },
                { id: 'INCOME', label: 'Entra plata', hint: 'Cambio, aporte', active: 'border-p-positive bg-p-positive-bg text-p-positive' },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={cashNewMovement.type === option.id}
                  onClick={() =>
                    setCashNewMovement((prev) => ({
                      ...prev,
                      type: option.id,
                      // Una opción rápida del otro tipo no tiene sentido acá.
                      description: CASH_MOVEMENT_PRESETS.includes(prev.description) ? '' : prev.description,
                    }))
                  }
                  className={`rounded-xl border px-3 py-2.5 text-left ${
                    cashNewMovement.type === option.id ? option.active : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                  }`}
                >
                  <span className="block text-[14px] font-bold">{option.label}</span>
                  <span className="block text-[11px] opacity-80">{option.hint}</span>
                </button>
              ))}
            </div>

            <div>
              <p className="text-[12px] font-semibold text-p-text-secondary">¿Para qué?</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(cashNewMovement.type === 'EXPENSE' ? CASH_EXPENSE_PRESETS : CASH_INCOME_PRESETS).map((concept) => (
                  <button
                    key={concept}
                    type="button"
                    aria-pressed={cashNewMovement.description === concept}
                    onClick={() => setCashNewMovement((prev) => ({ ...prev, description: concept }))}
                    className={`h-8 rounded-lg px-3 text-[12px] font-semibold ${
                      cashNewMovement.description === concept
                        ? 'bg-ink-900 text-ink-50'
                        : 'bg-p-surface-2 text-p-text-secondary hover:brightness-95'
                    }`}
                  >
                    {concept}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={cashNewMovement.description}
                onChange={(event) => setCashNewMovement((prev) => ({ ...prev, description: event.target.value }))}
                className="mt-2 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder={cashNewMovement.type === 'EXPENSE' ? 'O escribí: compra de pelotas, luz…' : 'O escribí de dónde vino'}
                aria-label="Para qué"
              />
            </div>

            <label className="block">
              <span className="text-[12px] font-semibold text-p-text-secondary">¿Cuánto?</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={cashNewMovement.amount}
                onChange={(event) => setCashNewMovement((prev) => ({ ...prev, amount: event.target.value }))}
                className="mt-1 h-12 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[18px] font-semibold tabular-nums text-p-text outline-none focus:border-p-accent"
                placeholder="0"
              />
            </label>

            <div>
              <p className="text-[12px] font-semibold text-p-text-secondary">¿Cómo?</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {([
                  { id: 'CASH', label: 'Efectivo' },
                  { id: 'TRANSFER', label: 'Transferencia' },
                  { id: 'CARD', label: 'Tarjeta' },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={cashNewMovement.method === option.id}
                    onClick={() => setCashNewMovement((prev) => ({ ...prev, method: option.id }))}
                    className={`h-9 rounded-lg text-[12px] font-semibold ${
                      cashNewMovement.method === option.id
                        ? 'bg-ink-900 text-ink-50'
                        : 'border border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {cashNewMovement.method === 'CASH' && (
                <p className="mt-1.5 text-[11px] text-p-text-muted">
                  {cashNewMovement.type === 'EXPENSE' ? 'Se descuenta del efectivo del cajón.' : 'Se suma al efectivo del cajón.'}
                </p>
              )}
            </div>
          </form>
        )}

        {cashSidebarView === 'close_report' && (
          <div className="space-y-5">
            {(() => {
              const selected =
                cashClosedShifts.find((item) => item.id === cashSelectedClosedId) || cashClosedShifts[0] || null;
              return selected ? <CashClosedShiftCard shift={selected} /> : null;
            })()}
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-p-text">Cierres anteriores</p>
              <CashClosesHistory
                items={cashClosedShifts}
                selectedId={cashSelectedClosedId || cashClosedShifts[0]?.id || ''}
                onSelect={setCashSelectedClosedId}
              />
            </div>
          </div>
        )}

        {cashSidebarView === 'product_sale' && (
          <div className="space-y-5">
            {/* Guardia: caja cerrada */}
            {!cashCurrentShift && (
              <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2.5 text-[12px] text-p-error">
                Abrí una caja antes de registrar ventas de mostrador.
              </div>
            )}

            {/* Cliente opcional */}
            <AdminDrawerSection title="Cliente" className={drawerSectionCardClass}>
              {posSelectedClient ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-p-text">
                      {posSelectedClient.name || posSelectedClient.id}
                    </p>
                    {(posSelectedClient.phone || posSelectedClient.email) && (
                      <p className="truncate text-[11px] text-p-text-muted">
                        {posSelectedClient.phone || posSelectedClient.email}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handlePosClearClient}
                    disabled={posSubmitting}
                    title="Limpiar — volver a Consumidor final"
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:bg-p-error-bg hover:text-p-error disabled:opacity-60"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="relative" ref={posClientWrapperRef}>
                  <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                  <input
                    type="text"
                    value={posClientSearch}
                    onChange={handlePosClientSearchChange}
                    onFocus={() => posClientResults.length > 0 && setPosClientDropdownOpen(true)}
                    disabled={posSubmitting}
                    placeholder="Buscar por nombre o teléfono… (opcional)"
                    className="h-9 w-full rounded-xl border border-p-border bg-p-surface pl-8 pr-3 text-[13px] text-p-text outline-none focus:border-p-accent disabled:opacity-60"
                  />
                  {posClientDropdownOpen && posClientResults.length > 0 && (
                    <div
                      className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-xl border border-p-border bg-p-surface shadow-lg"
                      style={{ zIndex: ADMIN_Z_INDEX.dropdown }}
                    >
                      {posClientResults.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => handlePosSelectClient(client)}
                          className="flex w-full flex-col px-3 py-2.5 text-left transition hover:bg-p-surface-2 first:rounded-t-xl last:rounded-b-xl"
                        >
                          <span className="text-[12px] font-semibold text-p-text">
                            {client.name || client.id}
                          </span>
                          {(client.phone || client.email) && (
                            <span className="text-[11px] text-p-text-muted">
                              {client.phone || client.email}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-p-text-muted">
                Sin cliente seleccionado la venta queda como <span className="font-medium">Consumidor final</span>.
              </p>
            </AdminDrawerSection>

            {/* Productos y servicios: tocar suma uno */}
            <AdminDrawerSection title="¿Qué lleva?" className={drawerSectionCardClass}>
              {(() => {
                const qtyOf = (key: string) =>
                  posItems.filter((i) => i.productId === key).reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
                const addOne = (key: string) => {
                  setPosError('');
                  setPosItems((prev) => {
                    const clean = prev.filter((i) => i.productId);
                    const idx = clean.findIndex((i) => i.productId === key);
                    if (idx >= 0) {
                      const next = [...clean];
                      next[idx] = { ...next[idx], quantity: String((Number(next[idx].quantity) || 0) + 1) };
                      return next;
                    }
                    return [...clean, { productId: key, quantity: '1' }];
                  });
                };
                const removeOne = (key: string) => {
                  setPosError('');
                  setPosItems((prev) =>
                    prev
                      .filter((i) => i.productId)
                      .flatMap((i) =>
                        i.productId !== key
                          ? [i]
                          : (Number(i.quantity) || 0) > 1
                            ? [{ ...i, quantity: String((Number(i.quantity) || 0) - 1) }]
                            : []
                      )
                  );
                };
                const chosen = posItems
                  .filter((i) => i.productId)
                  .map((i) => {
                    const [itemType, itemId] = i.productId.split(':');
                    return {
                      key: i.productId,
                      qty: Number(i.quantity) || 0,
                      product: posProducts.find((p) => p.type === itemType && p.id === Number(itemId)),
                    };
                  })
                  .filter((row) => row.product && row.qty > 0);
                const sections = [
                  { label: 'Productos', rows: posProducts.filter((p) => p.type === 'product') },
                  { label: 'Servicios', rows: posProducts.filter((p) => p.type === 'service') },
                ].filter((section) => section.rows.length > 0);
                return (
                  <div className="space-y-3">
                    {posLoadingProducts && <p className="text-[12px] text-p-text-muted">Cargando productos...</p>}
                    {!posLoadingProducts && sections.length === 0 && (
                      <p className="text-[12px] text-p-text-muted">No hay productos cargados. Se cargan en Tienda.</p>
                    )}
                    {sections.map((section) => (
                      <div key={section.label}>
                        {sections.length > 1 && (
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">{section.label}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          {section.rows.map((product) => {
                            const key = `${product.type}:${product.id}`;
                            const qty = qtyOf(key);
                            const stock = product.type === 'product' ? product.stock : null;
                            const soldOut = stock === 0;
                            const atLimit = stock !== null && stock > 0 && qty >= stock;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => addOne(key)}
                                disabled={posSubmitting || soldOut || atLimit}
                                className={`relative min-h-[64px] rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed ${
                                  qty > 0
                                    ? 'border-ink-900 bg-p-surface'
                                    : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                                } ${soldOut ? 'opacity-50' : ''}`}
                              >
                                <span className="block pr-6 text-[13px] font-semibold leading-tight text-p-text">{product.name}</span>
                                <span className="mt-0.5 block text-[12px] tabular-nums text-p-text-secondary">{formatMoney(product.price)}</span>
                                {stock !== null && (
                                  <span
                                    className={`block text-[11px] ${
                                      soldOut || atLimit ? 'text-p-error' : stock <= 3 ? 'text-amber-600' : 'text-p-text-muted'
                                    }`}
                                  >
                                    {soldOut ? 'Sin stock' : atLimit ? `No hay más (${stock})` : stock <= 3 ? `Quedan ${stock}` : `${stock} en stock`}
                                  </span>
                                )}
                                {qty > 0 && (
                                  <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-full bg-ink-900 px-1.5 text-[12px] font-bold text-ink-50">
                                    {qty}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {chosen.length > 0 && (
                      <div className="rounded-xl border border-p-border">
                        <p className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">Lleva</p>
                        <ul className="divide-y divide-p-border">
                          {chosen.map((row) => (
                            <li key={row.key} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                              <span className="min-w-0 flex-1 truncate text-p-text">{row.product?.name}</span>
                              <button
                                type="button"
                                onClick={() => removeOne(row.key)}
                                disabled={posSubmitting}
                                aria-label={`Sacar uno de ${row.product?.name}`}
                                className="grid h-7 w-7 place-items-center rounded-lg border border-p-border text-p-text-secondary hover:bg-p-surface-2"
                              >
                                −
                              </button>
                              <span className="w-5 text-center font-semibold tabular-nums">{row.qty}</span>
                              <button
                                type="button"
                                onClick={() => addOne(row.key)}
                                disabled={
                                  posSubmitting ||
                                  (row.product?.type === 'product' &&
                                    row.product.stock !== null &&
                                    row.qty >= Number(row.product.stock))
                                }
                                aria-label={`Sumar uno de ${row.product?.name}`}
                                className="grid h-7 w-7 place-items-center rounded-lg border border-p-border text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-40"
                              >
                                +
                              </button>
                              <span className="w-20 text-right font-semibold tabular-nums text-p-text">
                                {formatMoney(Number(row.product?.price || 0) * row.qty)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Total real del quote (con descuentos si aplica) */}
              {(posQuoteLoading || posQuote) && (
                <div className="mt-3 space-y-1 rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
                  {posQuoteLoading ? (
                    <p className="text-[12px] text-p-text-muted">Calculando...</p>
                  ) : posQuote && (
                    <>
                      {posQuote.hasDiscount && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-p-text-muted">Subtotal</span>
                            <span className="text-[12px] text-p-text-muted line-through">{formatMoney(posQuote.listTotal)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-p-positive">Descuento</span>
                            <span className="text-[12px] text-p-positive">−{formatMoney(posQuote.discountTotal)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-p-text">Total</span>
                        <span className="text-[16px] font-bold text-p-text">{formatMoney(posQuote.finalTotal)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </AdminDrawerSection>


            {/* Error */}
            {posError && (
              <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
                {posError}
              </div>
            )}
          </div>
        )}
      </AdminDrawer>
    </>
  );
}
