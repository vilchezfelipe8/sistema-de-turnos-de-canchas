import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Landmark,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useRouter } from 'next/router';
import AgendaLikeRightSidebar from '../../components/admin/AgendaLikeRightSidebar';
import AdminPlaygroundShell from '../../components/admin/AdminPlaygroundShell';
import MetricCard from '../../components/admin/ui/MetricCard';
import CashSummaryCards from '../../modules/caja/components/CashSummaryCards';
import CashMovementsTimeline from '../../modules/caja/components/CashMovementsTimeline';
import CashAccountsList from '../../modules/caja/components/CashAccountsList';
import type { CashAccountItem } from '../../modules/caja/components/CashAccountsList';
import CashAccountDetailPanel from '../../modules/caja/components/CashAccountDetailPanel';
import CashCloseFlow from '../../modules/caja/components/CashCloseFlow';
import CashShiftPanel from '../../modules/caja/components/CashShiftPanel';
import {
  AdminPaymentFormModal,
  AdminPaymentPreconfirmModal,
  AdminPaymentResultModal,
} from '../../components/admin/payments/AdminPaymentFlowModals';
import { AdminFilterToolbar, AdminPanel, AdminSegmentedControl } from '../../components/admin/ui';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import {
  addAccountItem,
  closeAccount,
  getAccountById,
  listAccounts,
  openAccount,
  registerPayment,
  type AccountStatus,
  type PaymentMethod,
  type PaymentChannel,
} from '../../services/AccountService';
import { CashService } from '../../services/CashService';
import { ClubService } from '../../services/ClubService';
import { listPendingRefunds, listRefunds, type RefundRecord } from '../../services/PaymentService';
import { formatDateTime24 } from '../../utils/dateTime';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type PaymentsTab = 'SUMMARY' | 'ACCOUNTS' | 'MOVEMENTS' | 'CLOSURE' | 'REFUNDS';
type CashPeriod = 'hoy' | 'semana' | 'mes';
type MovementTypeFilter = 'ALL' | 'INCOME' | 'EXPENSE';
type MovementMethodFilter = 'ALL' | 'CASH' | 'TRANSFER' | 'CARD';
type RefundStatusFilter = 'ALL' | 'REQUESTED' | 'APPROVED' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
type RefundMethodFilter = 'ALL' | 'CASH' | 'TRANSFER' | 'CARD_REVERSAL' | 'CREDIT_NOTE';
type CashView = 'live' | 'movements' | 'closures';
type CashActionSidebarView = 'none' | 'open_shift' | 'close_shift' | 'movement_create' | 'close_report';
type AccountsFilter = 'ALL' | 'OPEN' | 'CLOSED' | 'WITH_DEBT' | 'WITH_REFUNDS';
type AccountActionSidebarView = 'none' | 'overview' | 'add_item' | 'register_payment' | 'close_account' | 'create_account';
type AccountPaymentModalStep = 'form' | 'preconfirm' | 'result';
type PaymentQuickPreset = 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';

type AccountPaymentResultModal = {
  variant: 'success' | 'error';
  title: string;
  detail: string;
  requestedAmount: number;
  appliedAmount: number;
  remainingAfter: number;
  methodLabel: string;
  appliedItems?: Array<{ id: string; label: string; amount: number }>;
};

type AccountRow = {
  id: string;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  status: AccountStatus;
  createdAt: string;
  booking?: {
    id?: number;
    courtName?: string | null;
    clientName?: string | null;
  } | null;
};

type AccountDetailItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  createdAt?: string;
};

type AccountDetailPayment = {
  id: string;
  amount: number;
  method: string;
  channel?: string;
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
const ACCOUNT_PAYMENT_EPSILON = 0.009;

const shortCode = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 5)}...${raw.slice(-3)}`;
};

const formatRefundStatus = (status: string) => {
  if (status === 'REQUESTED') return 'Solicitada';
  if (status === 'APPROVED') return 'Aprobada';
  if (status === 'READY_TO_EXECUTE') return 'Lista';
  if (status === 'EXECUTED') return 'Ejecutada';
  if (status === 'FAILED') return 'Fallida';
  if (status === 'CANCELLED') return 'Cancelada';
  return status;
};

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
  if (raw === 'closure') return 'CLOSURE';
  if (raw === 'refunds') return 'REFUNDS';
  if (raw === 'accounts') return 'ACCOUNTS';
  return 'SUMMARY';
};

const toPaymentsTabQuery = (value: PaymentsTab) => {
  if (value === 'SUMMARY') return 'summary';
  if (value === 'MOVEMENTS') return 'movements';
  if (value === 'CLOSURE') return 'closure';
  if (value === 'REFUNDS') return 'refunds';
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

const movementMethodLabel = (method: Movement['method']) => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
};

const accountSourceLabel = (sourceType: AccountRow['sourceType']) => {
  if (sourceType === 'BOOKING') return 'Reserva';
  if (sourceType === 'BAR') return 'Consumos';
  if (sourceType === 'TABLE') return 'Mesa';
  return 'Manual';
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
  const [accountsFilter, setAccountsFilter] = useState<AccountsFilter>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountSidebarView, setAccountSidebarView] = useState<AccountActionSidebarView>('none');
  const [accountDetailById, setAccountDetailById] = useState<Record<string, AccountDetail>>({});
  const [loadingAccountDetailById, setLoadingAccountDetailById] = useState<Record<string, boolean>>({});
  const [accountDetailError, setAccountDetailError] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [submittingAccountItem, setSubmittingAccountItem] = useState(false);
  const [submittingAccountPayment, setSubmittingAccountPayment] = useState(false);
  const [submittingAccountClose, setSubmittingAccountClose] = useState(false);
  const [openingAccount, setOpeningAccount] = useState(false);
  const [accountPaymentModalStep, setAccountPaymentModalStep] = useState<AccountPaymentModalStep | null>(null);
  const [accountPaymentAmountDraft, setAccountPaymentAmountDraft] = useState('');
  const [accountPaymentMethodDraft, setAccountPaymentMethodDraft] = useState<PaymentMethod>('CASH');
  const [accountPaymentChannelDraft, setAccountPaymentChannelDraft] =
    useState<Extract<PaymentChannel, 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'>>('BANK_ACCOUNT');
  const [accountPaymentQuickPreset, setAccountPaymentQuickPreset] = useState<PaymentQuickPreset>('FULL');
  const [accountPaymentSelectedItemIdsDraft, setAccountPaymentSelectedItemIdsDraft] = useState<string[]>([]);
  const [accountPaymentCustomItemAmountDraftById, setAccountPaymentCustomItemAmountDraftById] = useState<
    Record<string, string>
  >({});
  const [accountPaymentModalError, setAccountPaymentModalError] = useState('');
  const [accountPaymentResultModal, setAccountPaymentResultModal] = useState<AccountPaymentResultModal | null>(null);
  const accountModalBackdropPointerDownTargetRef = useRef<EventTarget | null>(null);
  const [newAccountItemForm, setNewAccountItemForm] = useState({
    description: '',
    quantity: '1',
    unitPrice: '',
    type: 'PRODUCT' as 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT',
  });

  const [cashActivePeriod, setCashActivePeriod] = useState<CashPeriod>('hoy');
  const [cashPeriodOffset, setCashPeriodOffset] = useState(0);
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
  const [cashSearchTerm, setCashSearchTerm] = useState('');
  const [cashTypeFilter, setCashTypeFilter] = useState<MovementTypeFilter>('ALL');
  const [cashMethodFilter, setCashMethodFilter] = useState<MovementMethodFilter>('ALL');
  const [cashShowFilters, setCashShowFilters] = useState(false);
  const [cashSidebarView, setCashSidebarView] = useState<CashActionSidebarView>('none');
  const [cashLastCloseReport, setCashLastCloseReport] = useState<CashShiftCloseReport | null>(null);

  const [cashOpenShiftForm, setCashOpenShiftForm] = useState({
    cashRegisterId: '',
    openingAmount: '',
  });
  const [cashCloseShiftForm, setCashCloseShiftForm] = useState({ countedCash: '' });
  const [cashNewMovement, setCashNewMovement] = useState({
    type: 'INCOME' as 'INCOME' | 'EXPENSE',
    description: '',
    amount: '',
    method: 'CASH' as 'CASH' | 'TRANSFER' | 'CARD',
  });
  const [adminToasts, setAdminToasts] = useState<Array<{ id: number; message: string }>>([]);
  const adminToastIdRef = useRef(1);
  const adminToastTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const showAdminToast = useCallback((message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = adminToastIdRef.current++;
    setAdminToasts((prev) => [...prev, { id, message: text }].slice(-4));
    const timeout = setTimeout(() => {
      setAdminToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2400);
    adminToastTimeoutsRef.current.push(timeout);
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/pagos-playground')}`);
  }, [authChecked, router, user]);

  useEffect(() => {
    return () => {
      adminToastTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      adminToastTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const nextTab = parsePaymentsTab(router.query.tab);
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [router.query.tab]);

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [open, closed, pending, recent] = await Promise.all([
        listAccounts({ status: 'OPEN' }),
        listAccounts({ status: 'CLOSED' }),
        listPendingRefunds(20),
        listRefunds({ take: 30 }),
      ]);

      setOpenAccounts(Array.isArray(open) ? open : []);
      setClosedAccounts(Array.isArray(closed) ? closed : []);
      setPendingRefunds(Array.isArray(pending) ? pending : []);
      setRecentRefunds(Array.isArray(recent) ? recent : []);
    } catch (loadError: any) {
      reportUiError({ area: 'PaymentsPlayground', action: 'refresh' }, loadError);
      setError(loadError?.message || 'No se pudo cargar el módulo de pagos.');
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureAccountDetail = useCallback(async (accountId: string, force = false) => {
    const key = String(accountId || '').trim();
    if (!key) return null;
    if (!force && accountDetailById[key]) return accountDetailById[key];
    if (loadingAccountDetailById[key]) return null;

    try {
      setLoadingAccountDetailById((prev) => ({ ...prev, [key]: true }));
      setAccountDetailError('');
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
        })),
        payments: (Array.isArray(detail?.payments) ? detail.payments : []).map((payment: any) => ({
          id: String(payment?.id || ''),
          amount: Number(payment?.amount || 0),
          method: String(payment?.method || ''),
          channel: String(payment?.channel || ''),
          createdAt: String(payment?.createdAt || ''),
        })),
        createdAt: String(detail?.createdAt || ''),
        updatedAt: String(detail?.updatedAt || ''),
      };
      setAccountDetailById((prev) => ({ ...prev, [key]: normalized }));
      return normalized;
    } catch (detailError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'ensureAccountDetail' }, detailError);
      setAccountDetailError(extractErrorMessage(detailError, 'No se pudo cargar el detalle de la cuenta.'));
      return null;
    } finally {
      setLoadingAccountDetailById((prev) => ({ ...prev, [key]: false }));
    }
  }, [accountDetailById, loadingAccountDetailById]);

  const accountSidebarOpen = activeTab === 'ACCOUNTS' && accountSidebarView !== 'none';

  const closeAccountSidebar = useCallback(() => {
    if (submittingAccountItem || submittingAccountPayment || submittingAccountClose || openingAccount) return;
    setAccountSidebarView('none');
    setAccountPaymentModalStep(null);
    setAccountPaymentModalError('');
    setAccountPaymentResultModal(null);
    setAccountActionError('');
  }, [openingAccount, submittingAccountClose, submittingAccountItem, submittingAccountPayment]);

  const handleCreateAccountItem = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAccountId) return;
    const description = newAccountItemForm.description.trim();
    const quantity = Number(newAccountItemForm.quantity);
    const unitPrice = Number(newAccountItemForm.unitPrice);

    if (description.length < 2) {
      setAccountActionError('Ingresa una descripción válida.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setAccountActionError('La cantidad debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setAccountActionError('El precio unitario debe ser mayor a 0.');
      return;
    }

    try {
      setSubmittingAccountItem(true);
      setAccountActionError('');
      await addAccountItem(selectedAccountId, {
        description,
        quantity,
        unitPrice,
        type: newAccountItemForm.type,
      });
      await Promise.all([refresh(), ensureAccountDetail(selectedAccountId, true)]);
      showAdminToast('Concepto agregado correctamente.');
      setNewAccountItemForm({ description: '', quantity: '1', unitPrice: '', type: 'PRODUCT' });
      setAccountSidebarView('overview');
    } catch (error) {
      reportUiError({ area: 'PaymentsPlayground', action: 'handleCreateAccountItem' }, error);
      setAccountActionError(extractErrorMessage(error, 'No se pudo agregar el concepto.'));
    } finally {
      setSubmittingAccountItem(false);
    }
  }, [ensureAccountDetail, newAccountItemForm, refresh, selectedAccountId, showAdminToast]);

  const closeAccountPaymentModal = useCallback(() => {
    if (submittingAccountPayment) return;
    setAccountPaymentModalStep(null);
    setAccountPaymentModalError('');
    setAccountPaymentResultModal(null);
  }, [submittingAccountPayment]);

  const openAccountPaymentModal = useCallback(() => {
    if (!selectedAccountId) return;
    const detail = accountDetailById[selectedAccountId];
    const isOpenByList = openAccounts.some((account) => account.id === selectedAccountId);
    const isOpenByDetail = detail?.status === 'OPEN';
    if (!isOpenByList && !isOpenByDetail) return;
    const remaining = Number(detail?.remaining || 0);
    if (remaining <= 0.009) {
      setAccountActionError('La cuenta no tiene deuda pendiente.');
      return;
    }
    setAccountActionError('');
    const nextIds = (Array.isArray(detail?.items) ? detail.items : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    setAccountPaymentAmountDraft(remaining.toFixed(2));
    setAccountPaymentMethodDraft('CASH');
    setAccountPaymentChannelDraft('BANK_ACCOUNT');
    setAccountPaymentQuickPreset('FULL');
    setAccountPaymentSelectedItemIdsDraft(nextIds);
    setAccountPaymentCustomItemAmountDraftById({});
    setAccountPaymentModalError('');
    setAccountPaymentResultModal(null);
    setAccountPaymentModalStep('form');
  }, [accountDetailById, openAccounts, selectedAccountId]);

  const handleAccountModalBackdropPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    accountModalBackdropPointerDownTargetRef.current = event.target;
  }, []);

  const handleAccountModalBackdropPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const startedOnBackdrop = accountModalBackdropPointerDownTargetRef.current === event.currentTarget;
      const endedOnBackdrop = event.target === event.currentTarget;
      accountModalBackdropPointerDownTargetRef.current = null;
      if (startedOnBackdrop && endedOnBackdrop) {
        closeAccountPaymentModal();
      }
    },
    [closeAccountPaymentModal]
  );

  const handleCloseSelectedAccount = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      setSubmittingAccountClose(true);
      setAccountActionError('');
      await closeAccount(selectedAccountId);
      await Promise.all([refresh(), ensureAccountDetail(selectedAccountId, true)]);
      showAdminToast('Cuenta cerrada correctamente.');
      setAccountSidebarView('overview');
    } catch (error) {
      reportUiError({ area: 'PaymentsPlayground', action: 'handleCloseSelectedAccount' }, error);
      setAccountActionError(extractErrorMessage(error, 'No se pudo cerrar la cuenta.'));
    } finally {
      setSubmittingAccountClose(false);
    }
  }, [ensureAccountDetail, refresh, selectedAccountId, showAdminToast]);

  const handleQuickOpenAccount = useCallback(async () => {
    try {
      setOpeningAccount(true);
      setAccountActionError('');
      const created = await openAccount({ sourceType: 'MANUAL', sourceId: `manual-${Date.now()}` });
      await refresh();
      if (created?.id) {
        setSelectedAccountId(created.id);
        await ensureAccountDetail(created.id, true);
      }
      setAccountSidebarView('overview');
      showAdminToast('Cuenta creada correctamente.');
    } catch (error) {
      reportUiError({ area: 'PaymentsPlayground', action: 'handleQuickOpenAccount' }, error);
      setAccountActionError(extractErrorMessage(error, 'No se pudo crear la cuenta.'));
    } finally {
      setOpeningAccount(false);
    }
  }, [ensureAccountDetail, refresh, showAdminToast]);

  const loadCashSummary = useCallback(async () => {
    setCashSummaryError('');
    setLoadingCashSummary(true);
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
        return {
          id: Number(item?.id || 0),
          date: String(item?.createdAt || ''),
          type: normalizedType,
          amount: Number(item?.amount || 0),
          description: formatMovementConcept(item),
          method: (['CASH', 'TRANSFER', 'CARD'].includes(String(item?.method))
            ? item.method
            : 'CASH') as Movement['method'],
        };
      });
      setCashMovements(normalizedMovements.filter((item) => Number.isFinite(item.id) && item.id > 0));
    } catch (loadError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'loadCashSummary' }, loadError);
      setCashSummaryError(extractErrorMessage(loadError, 'No se pudo cargar el resumen de caja.'));
    } finally {
      setLoadingCashSummary(false);
    }
  }, [cashActivePeriod, cashPeriodOffset]);

  const loadCashShiftContext = useCallback(async () => {
    setCashShiftError('');
    setLoadingCashShift(true);
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
      setCashShiftError(extractErrorMessage(loadError, 'No se pudo cargar el estado del turno de caja.'));
    } finally {
      setLoadingCashShift(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void refresh();
  }, [authChecked, refresh, user]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
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
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    if (!isCashSectionTab(activeTab)) return;
    void loadCashSummary();
  }, [activeTab, authChecked, loadCashSummary, user]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    if (!isCashSectionTab(activeTab)) return;
    void loadCashShiftContext();
  }, [activeTab, authChecked, loadCashShiftContext, user]);

  useEffect(() => {
    if (isCashSectionTab(activeTab)) return;
    setCashSidebarView('none');
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'ACCOUNTS') return;
    setAccountSidebarView('none');
    setAccountPaymentModalStep(null);
  }, [activeTab]);

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
      const matchesSearch =
        normalizedQuery.length === 0 ||
        refundCodeLabel(refund).toLowerCase().includes(normalizedQuery) ||
        String(refund.reason || '').toLowerCase().includes(normalizedQuery) ||
        shortId(refund.accountId).toLowerCase().includes(normalizedQuery) ||
        shortId(refund.paymentId).toLowerCase().includes(normalizedQuery);
      return matchesDate && matchesStatus && matchesMethod && matchesSearch;
    });
  }, [cashActivePeriod, cashPeriodOffset, recentRefunds, refundMethodFilter, refundSearchTerm, refundStatusFilter]);

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
      showAdminToast(closeShiftBlockedMessage);
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
      showAdminToast('Turno de caja cerrado correctamente.');
      setCashSidebarView('none');
      await Promise.all([loadCashShiftContext(), loadCashSummary()]);
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
      setCashMovementError('Describe el movimiento con al menos 3 caracteres.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashMovementError('Ingresa un monto valido mayor a 0.');
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
      setCashNewMovement({ type: 'INCOME', description: '', amount: '', method: 'CASH' });
      showAdminToast('Movimiento registrado correctamente.');
      setCashSidebarView('none');
      await loadCashSummary();
    } catch (movementError) {
      reportUiError({ area: 'PaymentsPlayground', action: 'createMovement' }, movementError);
      setCashMovementError(extractErrorMessage(movementError, 'No se pudo registrar el movimiento.'));
    } finally {
      setSubmittingCashMovement(false);
    }
  };

  const cashActionSidebarOpen = isCashSectionTab(activeTab) && cashSidebarView !== 'none';

  const closeActionSidebar = useCallback(() => {
    if (openingCashShift || closingCashShift || submittingCashMovement) return;
    setCashSidebarView('none');
  }, [closingCashShift, openingCashShift, submittingCashMovement]);

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
    if (activeTab !== 'ACCOUNTS') return;
    if (allAccounts.length === 0) return;
    const missingIds = allAccounts
      .map((account) => account.id)
      .filter((id) => !accountDetailById[id] && !loadingAccountDetailById[id]);
    if (missingIds.length === 0) return;
    void Promise.allSettled(missingIds.map((id) => ensureAccountDetail(id)));
  }, [activeTab, allAccounts, accountDetailById, ensureAccountDetail, loadingAccountDetailById]);

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
      const createdAt = new Date(account.createdAt);
      return Number.isFinite(createdAt.getTime()) && createdAt >= rawStart && createdAt <= rawEnd;
    });
  }, [allAccounts, cashActivePeriod, cashPeriodOffset]);

  const filteredAccounts = useMemo(() => {
    const search = accountsSearchTerm.trim().toLowerCase();
    return periodAccounts.filter((account) => {
      const matchesFilter =
        accountsFilter === 'ALL' ||
        (accountsFilter === 'OPEN' && account.status === 'OPEN') ||
        (accountsFilter === 'CLOSED' && account.status === 'CLOSED') ||
        (accountsFilter === 'WITH_DEBT' && account.hasDebt) ||
        (accountsFilter === 'WITH_REFUNDS' && accountsWithRefundsIdSet.has(account.id));

      if (!matchesFilter) return false;

      if (!search) return true;
      const haystack = [
        account.id,
        account.sourceType,
        account.booking?.clientName || '',
        account.booking?.courtName || '',
        account.booking?.id ? String(account.booking.id) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [accountsFilter, accountsSearchTerm, accountsWithRefundsIdSet, periodAccounts]);

  const selectedAccount = useMemo(
    () => allAccounts.find((account) => account.id === selectedAccountId) || null,
    [allAccounts, selectedAccountId]
  );
  const selectedAccountDetail = selectedAccountId ? accountDetailById[selectedAccountId] || null : null;

  useEffect(() => {
    if (activeTab !== 'ACCOUNTS') return;
    if (filteredAccounts.length === 0) return;
    if (selectedAccountId && filteredAccounts.some((account) => account.id === selectedAccountId)) return;
    setSelectedAccountId(filteredAccounts[0].id);
  }, [activeTab, filteredAccounts, selectedAccountId]);

  // Derived list for CashAccountsList — merges account rows with lazy-loaded detail.
  const cashAccountItems: CashAccountItem[] = useMemo(
    () =>
      filteredAccounts.map((account) => {
        const d = accountDetailById[account.id];
        return {
          id: account.id,
          status: account.status,
          sourceType: account.sourceType,
          hasDebt: account.hasDebt,
          booking: account.booking ?? null,
          detail: d
            ? {
                total: d.total,
                paid: d.paid,
                remaining: d.remaining,
                lastPaymentAt:
                  d.payments?.length
                    ? d.payments[d.payments.length - 1]?.createdAt ?? null
                    : null,
              }
            : null,
        };
      }),
    [filteredAccounts, accountDetailById]
  );

  const selectedAccountDetailLoading = Boolean(
    selectedAccountId && loadingAccountDetailById[selectedAccountId]
  );
  const selectedAccountVisible = useMemo(
    () => filteredAccounts.some((account) => account.id === selectedAccountId),
    [filteredAccounts, selectedAccountId]
  );
  const visibleOpenAccounts = useMemo(
    () => filteredAccounts.filter((account) => account.status === 'OPEN'),
    [filteredAccounts]
  );
  const visibleClosedAccounts = useMemo(
    () => filteredAccounts.filter((account) => account.status === 'CLOSED'),
    [filteredAccounts]
  );
  const visibleAccountsWithDebtCount = useMemo(
    () =>
      visibleOpenAccounts.filter((account) => {
        const d = accountDetailById[account.id];
        return !d || d.remaining > 0.009;
      }).length,
    [accountDetailById, visibleOpenAccounts]
  );
  const visibleAccountsWithRefundsCount = useMemo(
    () => filteredAccounts.filter((account) => accountsWithRefundsIdSet.has(account.id)).length,
    [accountsWithRefundsIdSet, filteredAccounts]
  );
  const accountPaymentMaxAmount = Number(selectedAccountDetail?.remaining || 0);
  const accountPaymentPendingItems = useMemo(() => {
    const items = Array.isArray(selectedAccountDetail?.items) ? selectedAccountDetail.items : [];
    const remaining = Math.max(0, Number(selectedAccountDetail?.remaining || 0));
    if (items.length === 0 && remaining > ACCOUNT_PAYMENT_EPSILON) {
      return [
        {
          id: '__account-total__',
          type: 'OTHER',
          label: 'Saldo pendiente',
          remainingAmount: Number(remaining.toFixed(2)),
        },
      ];
    }
    let remainingDraft = remaining;
    return items
      .map((item) => {
        const requested = Math.max(0, Number(item.total || 0));
        const amount = Number(Math.min(requested, Math.max(0, remainingDraft)).toFixed(2));
        remainingDraft = Number(Math.max(0, remainingDraft - amount).toFixed(2));
        return {
          id: String(item.id),
          type: String(item.type || 'OTHER').toUpperCase(),
          label: String(item.type || '').toUpperCase() === 'BOOKING' ? 'Cancha' : String(item.description || 'Concepto'),
          remainingAmount: amount,
        };
      })
      .filter((item) => item.remainingAmount > ACCOUNT_PAYMENT_EPSILON);
  }, [selectedAccountDetail]);
  const resolveAccountPresetItemIds = useCallback(
    (preset: PaymentQuickPreset) => {
      if (preset === 'COURT_ONLY') {
        return accountPaymentPendingItems
          .filter((item) => item.type === 'BOOKING')
          .map((item) => String(item.id));
      }
      return accountPaymentPendingItems.map((item) => String(item.id));
    },
    [accountPaymentPendingItems]
  );
  const resolveAccountCustomDraftAmount = useCallback(
    (itemId: string, maxForItem: number, customDraftById: Record<string, string>) => {
      const normalizedMax = Math.max(0, Number(maxForItem || 0));
      const hasDraft = Object.prototype.hasOwnProperty.call(customDraftById, itemId);
      if (!hasDraft) return normalizedMax;
      const rawDraft = String(customDraftById[itemId] ?? '').trim();
      if (rawDraft === '') return 0;
      const parsed = Number(rawDraft.replace(',', '.'));
      if (!Number.isFinite(parsed)) return normalizedMax;
      return Math.max(0, Math.min(normalizedMax, parsed));
    },
    []
  );
  const computeAccountConceptBasedMaxAmount = useCallback(
    (
      preset: PaymentQuickPreset,
      selectedIds?: string[],
      customAmountDraftById?: Record<string, string>
    ) => {
      const allowedIds =
        preset === 'CUSTOM_ITEMS'
          ? new Set((selectedIds || []).map((value) => String(value || '').trim()).filter(Boolean))
          : new Set(resolveAccountPresetItemIds(preset));
      if (preset === 'CUSTOM_ITEMS') {
        const customDrafts = customAmountDraftById ?? accountPaymentCustomItemAmountDraftById;
        return Number(
          Math.min(
            accountPaymentMaxAmount,
            accountPaymentPendingItems
              .filter((item) => allowedIds.has(String(item.id)))
              .reduce((sum, item) => {
                const itemId = String(item.id);
                const fallback = Number(item.remainingAmount || 0);
                const resolved = resolveAccountCustomDraftAmount(itemId, fallback, customDrafts);
                return sum + resolved;
              }, 0)
          ).toFixed(2)
        );
      }
      return Number(
        Math.min(
          accountPaymentMaxAmount,
          accountPaymentPendingItems
            .filter((item) => allowedIds.has(String(item.id)))
            .reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0)
        ).toFixed(2)
      );
    },
    [
      accountPaymentCustomItemAmountDraftById,
      accountPaymentMaxAmount,
      accountPaymentPendingItems,
      resolveAccountCustomDraftAmount,
      resolveAccountPresetItemIds,
    ]
  );
  const computeAccountCustomSelectedAmount = useCallback(
    (selectedIds: string[], customAmountDraftById: Record<string, string>) => {
      const selectedSet = new Set((selectedIds || []).map((value) => String(value || '').trim()).filter(Boolean));
      return Number(
        Math.min(
          accountPaymentMaxAmount,
          accountPaymentPendingItems
            .filter((item) => selectedSet.has(String(item.id)))
            .reduce((sum, item) => {
              const itemId = String(item.id);
              const fallback = Number(item.remainingAmount || 0);
              const resolved = resolveAccountCustomDraftAmount(itemId, fallback, customAmountDraftById);
              return sum + resolved;
            }, 0)
        ).toFixed(2)
      );
    },
    [accountPaymentMaxAmount, accountPaymentPendingItems, resolveAccountCustomDraftAmount]
  );
  const accountPaymentConceptDebt = useMemo(
    () =>
      computeAccountConceptBasedMaxAmount(
        accountPaymentQuickPreset,
        accountPaymentSelectedItemIdsDraft,
        accountPaymentCustomItemAmountDraftById
      ),
    [
      accountPaymentCustomItemAmountDraftById,
      accountPaymentQuickPreset,
      accountPaymentSelectedItemIdsDraft,
      computeAccountConceptBasedMaxAmount,
    ]
  );
  const accountPaymentMaxAllowedAmount = Math.min(accountPaymentMaxAmount, accountPaymentConceptDebt);
  const accountPaymentAmountNumeric = Number(String(accountPaymentAmountDraft || '').replace(',', '.'));
  const accountPaymentAmountIsValid =
    Number.isFinite(accountPaymentAmountNumeric) &&
    accountPaymentAmountNumeric > ACCOUNT_PAYMENT_EPSILON &&
    accountPaymentAmountNumeric <= accountPaymentMaxAllowedAmount + ACCOUNT_PAYMENT_EPSILON;
  const accountPaymentPreviewRows = useMemo(() => {
    const selectedIds =
      accountPaymentQuickPreset === 'CUSTOM_ITEMS'
        ? accountPaymentSelectedItemIdsDraft
        : resolveAccountPresetItemIds(accountPaymentQuickPreset);
    const selectedSet = new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean));
    let remaining = Number(Math.max(0, accountPaymentAmountNumeric).toFixed(2));
    const rows: Array<{ id: string; label: string; amount: number }> = [];
    for (const item of accountPaymentPendingItems) {
      if (!selectedSet.has(String(item.id))) continue;
      if (remaining <= ACCOUNT_PAYMENT_EPSILON) break;
      const itemId = String(item.id);
      const maxForItem = Number(item.remainingAmount || 0);
      const desiredForItem =
        accountPaymentQuickPreset === 'CUSTOM_ITEMS'
          ? resolveAccountCustomDraftAmount(itemId, maxForItem, accountPaymentCustomItemAmountDraftById)
          : maxForItem;
      const amount = Number(Math.min(desiredForItem, remaining).toFixed(2));
      if (amount <= ACCOUNT_PAYMENT_EPSILON) continue;
      rows.push({ id: itemId, label: item.label, amount });
      remaining = Number((remaining - amount).toFixed(2));
    }
    return rows;
  }, [
    accountPaymentAmountNumeric,
    accountPaymentCustomItemAmountDraftById,
    accountPaymentPendingItems,
    accountPaymentQuickPreset,
    accountPaymentSelectedItemIdsDraft,
    resolveAccountCustomDraftAmount,
    resolveAccountPresetItemIds,
  ]);

  const submitAccountPaymentFromModal = useCallback(async () => {
    if (!selectedAccountId) return;
    const detail = accountDetailById[selectedAccountId];
    const amount = Number(String(accountPaymentAmountDraft || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= ACCOUNT_PAYMENT_EPSILON) {
      setAccountPaymentModalError('Ingresá un monto válido mayor a 0.');
      return;
    }
    const remaining = Number(detail?.remaining || 0);
    if (amount > remaining + ACCOUNT_PAYMENT_EPSILON) {
      setAccountPaymentModalError(`El monto no puede superar la deuda pendiente (${formatMoney(remaining)}).`);
      return;
    }
    if (amount > accountPaymentMaxAllowedAmount + ACCOUNT_PAYMENT_EPSILON) {
      setAccountPaymentModalError('La suma por concepto debe coincidir con el monto final a cobrar.');
      return;
    }
    if (accountPaymentMethodDraft === 'TRANSFER' && !accountPaymentChannelDraft) {
      setAccountPaymentModalError('Seleccioná el canal de transferencia.');
      return;
    }

    const appliedItems = accountPaymentPreviewRows.map((row) => ({
      id: row.id,
      label: row.label,
      amount: Number(row.amount.toFixed(2)),
    }));

    try {
      setSubmittingAccountPayment(true);
      setAccountPaymentModalError('');
      await registerPayment({
        accountId: selectedAccountId,
        amount,
        method: accountPaymentMethodDraft,
        channel: accountPaymentMethodDraft === 'TRANSFER' ? accountPaymentChannelDraft : undefined,
      });
      await Promise.all([refresh(), ensureAccountDetail(selectedAccountId, true)]);
      const reloaded = await ensureAccountDetail(selectedAccountId, true);
      const remainingAfter = Number(reloaded?.remaining || 0);
      showAdminToast(`Pago registrado: ${formatMoney(amount)}.`);
      setAccountPaymentResultModal({
        variant: 'success',
        title: 'Cobro registrado',
        detail: 'El cobro se registró correctamente.',
        requestedAmount: Number(amount.toFixed(2)),
        appliedAmount: Number(amount.toFixed(2)),
        remainingAfter,
        methodLabel: paymentMethodLabel(accountPaymentMethodDraft),
        appliedItems,
      });
      setAccountPaymentModalStep('result');
      setAccountSidebarView('overview');
    } catch (error) {
      reportUiError({ area: 'PaymentsPlayground', action: 'submitAccountPaymentFromModal' }, error);
      const message = extractErrorMessage(error, 'No se pudo registrar el cobro.');
      setAccountPaymentResultModal({
        variant: 'error',
        title: 'No se pudo registrar el cobro',
        detail: message,
        requestedAmount: Number(amount.toFixed(2)),
        appliedAmount: 0,
        remainingAfter: Number(detail?.remaining || 0),
        methodLabel: paymentMethodLabel(accountPaymentMethodDraft),
        appliedItems: [],
      });
      setAccountPaymentModalStep('result');
    } finally {
      setSubmittingAccountPayment(false);
    }
  }, [
    accountPaymentAmountDraft,
    accountPaymentChannelDraft,
    accountPaymentMaxAllowedAmount,
    accountPaymentMethodDraft,
    accountPaymentPreviewRows,
    accountDetailById,
    ensureAccountDetail,
    refresh,
    selectedAccountId,
    showAdminToast,
  ]);

  const applyAccountPaymentQuickPreset = useCallback(
    (preset: PaymentQuickPreset) => {
      setAccountPaymentQuickPreset(preset);
      const nextIds =
        preset === 'CUSTOM_ITEMS'
          ? accountPaymentSelectedItemIdsDraft
          : resolveAccountPresetItemIds(preset);
      if (preset !== 'CUSTOM_ITEMS') {
        setAccountPaymentSelectedItemIdsDraft(nextIds);
        setAccountPaymentCustomItemAmountDraftById({});
      }
      setAccountPaymentAmountDraft(
        String(
          computeAccountConceptBasedMaxAmount(
            preset,
            nextIds,
            accountPaymentCustomItemAmountDraftById
          ).toFixed(2)
        )
      );
    },
    [
      accountPaymentCustomItemAmountDraftById,
      accountPaymentSelectedItemIdsDraft,
      computeAccountConceptBasedMaxAmount,
      resolveAccountPresetItemIds,
    ]
  );

  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }
  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenés permiso para acceder al panel de administración." />;
  }

  return (
    <>
      <Head>
        <title>Caja | TuCancha Admin</title>
      </Head>
      <AdminPlaygroundShell activeItem="Caja" user={user} contentMuted={cashActionSidebarOpen}>
        <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
          <AdminSegmentedControl
            ariaLabel="Secciones de caja"
            value={activeTab}
            onChange={(nextTab) => navigateToPaymentsTab(nextTab as PaymentsTab)}
            options={[
              { value: 'SUMMARY', label: 'Resumen' },
              { value: 'ACCOUNTS', label: 'Cuentas' },
              { value: 'MOVEMENTS', label: 'Movimientos' },
              { value: 'CLOSURE', label: 'Cierre' },
              { value: 'REFUNDS', label: 'Devoluciones' },
            ]}
            className="w-fit"
          />

          {error && (
            <div className="rounded-xl border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2 text-[12px] font-semibold text-[#b42346]">
              {error}
            </div>
          )}

          <section className="min-h-0 flex-1 overflow-auto">
            {loading && (activeTab === 'ACCOUNTS' || activeTab === 'REFUNDS') ? (
              <div className="h-full grid place-items-center">
                <div className="inline-flex items-center gap-2 text-[13px] text-[#6f7890]">
                  <span className="h-4 w-4 rounded-full border-2 border-[#b9c6f4] border-t-[#3053e2] animate-spin" />
                  Cargando módulo de pagos...
                </div>
              </div>
            ) : activeTab === 'ACCOUNTS' ? (
              <div className="space-y-4">
                <div className="w-full rounded-2xl border border-[#dce2ee] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-1">
                      {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                        <button
                          key={`accounts-${period}`}
                          type="button"
                          onClick={() => {
                            setCashActivePeriod(period);
                            setCashPeriodOffset(0);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                            cashActivePeriod === period
                              ? 'bg-white text-[#3053e2] shadow-sm'
                              : 'text-[#6f7890] hover:text-[#4e5870]'
                          }`}
                        >
                          {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb]"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="min-w-[120px] text-center text-[12px] font-semibold text-[#4e5870]">{cashPeriodLabel}</span>
                      <button
                        type="button"
                        onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                        disabled={cashPeriodOffset === 0}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:cursor-not-allowed disabled:text-[#b8c1d4] disabled:hover:bg-transparent"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MetricCard label="Cuentas abiertas" value={visibleOpenAccounts.length} format="number" />
                  <MetricCard
                    label="Con deuda"
                    value={visibleAccountsWithDebtCount}
                    format="number"
                    valueColor="#9a5a00"
                  />
                  <MetricCard label="Cerradas" value={visibleClosedAccounts.length} format="number" valueColor="#2f5e46" />
                  <MetricCard label="Con devoluciones" value={visibleAccountsWithRefundsCount} format="number" valueColor="#7b3fb4" />
                </div>
                <AdminPanel
                  title="Cuentas"
                  description="Gestión operativa de cuentas abiertas y cerradas."
                  headerClassName="pl-4 pr-2 py-3"
                  actions={(
                    <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-1 sm:flex-nowrap sm:justify-end">
                      <label className="relative w-full sm:w-[300px] sm:flex-none">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b93a5]" />
                        <input
                          type="text"
                          value={accountsSearchTerm}
                          onChange={(event) => setAccountsSearchTerm(event.target.value)}
                          placeholder="Buscar por cliente, cuenta, reserva o cancha"
                          className="h-8 w-full rounded-xl border border-[#dce2ee] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-[#3053e2]"
                        />
                      </label>
                      <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white p-1">
                        {[
                          { id: 'ALL', label: 'Todas' },
                          { id: 'OPEN', label: 'Abiertas' },
                          { id: 'CLOSED', label: 'Cerradas' },
                          { id: 'WITH_REFUNDS', label: 'Con devolución' },
                        ].map((option) => (
                          <button
                            key={`accounts-filter-${option.id}`}
                            type="button"
                            onClick={() => setAccountsFilter(option.id as AccountsFilter)}
                            className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                              accountsFilter === option.id
                                ? 'bg-[#edf1ff] text-[#3053e2]'
                                : 'text-[#6f7890] hover:bg-[#f4f6fb]'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountActionError('');
                          setAccountSidebarView('create_account');
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#3053e2] px-2.5 text-[11px] font-semibold text-white hover:bg-[#2748cc]"
                      >
                        <Plus size={14} strokeWidth={2.5} />
                        Nueva cuenta
                      </button>
                    </AdminFilterToolbar>
                  )}
                >
                  {filteredAccounts.length === 0 ? (
                    <div className="rounded-xl border border-[#dce2ee] bg-white px-4 py-10 text-center">
                      <p className="text-[13px] font-semibold text-[#44506b]">No hay cuentas para este período</p>
                      <p className="mt-1 text-[12px] text-[#7a8398]">Cambiá el rango o ajustá los filtros para encontrar registros.</p>
                    </div>
                  ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="max-h-[560px] overflow-y-auto pr-1">
                      <CashAccountsList
                        accounts={cashAccountItems}
                        selectedId={selectedAccountId}
                        onSelect={(id) => setSelectedAccountId(id)}
                        onPay={(id) => {
                          setSelectedAccountId(id);
                          setAccountSidebarView('overview');
                        }}
                      />
                    </div>

                    {selectedAccountVisible && selectedAccount ? (
                      <CashAccountDetailPanel
                        account={selectedAccount}
                        detail={selectedAccountDetail}
                        loading={selectedAccountDetailLoading}
                        error={accountDetailError}
                        onManage={() => {
                          setAccountActionError('');
                          setAccountSidebarView('overview');
                        }}
                        onPay={() => {
                          setAccountActionError('');
                          setAccountSidebarView('overview');
                        }}
                      />
                    ) : (
                      <div className="rounded-xl border border-[#dce2ee] bg-white px-4 py-10 text-center">
                        <p className="text-[13px] font-semibold text-[#44506b]">Seleccioná una cuenta</p>
                        <p className="mt-1 text-[12px] text-[#7a8398]">Elegí un registro de la lista para ver su detalle y deuda actual.</p>
                      </div>
                    )}
                  </div>
                  )}
                </AdminPanel>
              </div>
            ) : isCashSectionTab(activeTab) ? (
              <div className="space-y-4">
                {cashActiveView === 'live' && (
                  <>
                    <div className="w-full rounded-2xl border border-[#dce2ee] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-1">
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
                                  ? 'bg-white text-[#3053e2] shadow-sm'
                                  : 'text-[#6f7890] hover:text-[#4e5870]'
                              }`}
                            >
                              {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white px-1 py-1">
                          <button
                            type="button"
                            onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb]"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="min-w-[120px] text-center text-[12px] font-semibold text-[#4e5870]">{cashPeriodLabel}</span>
                          <button
                            type="button"
                            onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                            disabled={cashPeriodOffset === 0}
                            className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:cursor-not-allowed disabled:text-[#b8c1d4] disabled:hover:bg-transparent"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <CashSummaryCards balance={cashBalance} loading={loadingCashSummary} />
                  </>
                )}

                {cashActiveView === 'movements' && (
                  <div className="w-full rounded-2xl border border-[#dce2ee] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-1">
                        {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                          <button
                            key={`movements-${period}`}
                            type="button"
                            onClick={() => {
                              setCashActivePeriod(period);
                              setCashPeriodOffset(0);
                            }}
                            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                              cashActivePeriod === period
                                ? 'bg-white text-[#3053e2] shadow-sm'
                                : 'text-[#6f7890] hover:text-[#4e5870]'
                            }`}
                          >
                            {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white px-1 py-1">
                        <button
                          type="button"
                          onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb]"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span className="min-w-[120px] text-center text-[12px] font-semibold text-[#4e5870]">{cashPeriodLabel}</span>
                        <button
                          type="button"
                          onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                          disabled={cashPeriodOffset === 0}
                          className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:cursor-not-allowed disabled:text-[#b8c1d4] disabled:hover:bg-transparent"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {(cashSummaryError || cashShiftError || cashMovementError) && (
                  <div className="space-y-2">
                    {cashSummaryError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{cashSummaryError}</div>}
                    {cashShiftError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{cashShiftError}</div>}
                    {cashMovementError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{cashMovementError}</div>}
                  </div>
                )}

                {cashActiveView === 'live' && (
                  <CashShiftPanel
                    shift={cashCurrentShift}
                    loading={loadingCashShift}
                    onToggleShift={() => {
                      if (cashCurrentShift && shouldBlockCloseShiftWithOpenAccounts) {
                        showAdminToast(closeShiftBlockedMessage);
                        return;
                      }
                      setCashSidebarView(cashCurrentShift ? 'close_shift' : 'open_shift');
                    }}
                    onRegisterMovement={() => {
                      navigateToPaymentsTab('MOVEMENTS');
                      setCashSidebarView('movement_create');
                    }}
                    onGoToClosures={() => navigateToPaymentsTab('CLOSURE')}
                  />
                )}

                {cashActiveView === 'movements' && (
                  <AdminPanel
                    title="Movimientos"
                    description="Timeline de ingresos y egresos del período visible."
                    headerClassName="pl-4 pr-2 py-3"
                    actions={(
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCashSidebarView('movement_create')}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#3053e2] px-2.5 text-[11px] font-semibold text-white shadow-[0_6px_16px_rgba(48,83,226,0.24)] transition hover:bg-[#2746c9]"
                        >
                          <Plus size={14} strokeWidth={2.5} />
                          Nuevo movimiento
                        </button>
                        <button
                          type="button"
                          onClick={() => setCashShowFilters((prev) => !prev)}
                          className="h-8 rounded-lg border border-[#dce2ee] bg-white px-2.5 text-[12px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
                        >
                          {cashShowFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
                        </button>
                        <div className="inline-flex items-center gap-2 text-[12px] text-[#6f7890]">
                          <Landmark size={14} />
                          <span>{loadingCashSummary ? 'Actualizando...' : `${filteredCashMovements.length} de ${cashMovements.length}`}</span>
                        </div>
                      </div>
                    )}
                    bodyClassName="p-4"
                  >

                    <div className="mb-3 grid grid-cols-3 gap-2">
                      <MetricCard
                        label="Resultado visible"
                        value={Math.abs(filteredNetAmount)}
                        format="money"
                        valueColor={filteredNetAmount >= 0 ? '#15803d' : '#b91c1c'}
                      />
                      <MetricCard
                        label="Ingresos visibles"
                        value={filteredIncomeAmount}
                        format="money"
                        valueColor="#15803d"
                      />
                      <MetricCard
                        label="Egresos visibles"
                        value={filteredExpenseAmount}
                        format="money"
                        valueColor="#b91c1c"
                      />
                    </div>

                    {cashShowFilters && (
                      <AdminFilterToolbar className="mb-3 grid grid-cols-1 md:grid-cols-[1fr_140px_160px_auto]">
                        <label className="relative">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b93a5]" />
                          <input
                            type="text"
                            value={cashSearchTerm}
                            onChange={(event) => setCashSearchTerm(event.target.value)}
                            placeholder="Buscar por concepto o método"
                            className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#3053e2]"
                          />
                        </label>

                        <select
                          value={cashTypeFilter}
                          onChange={(event) => setCashTypeFilter(event.target.value as MovementTypeFilter)}
                          className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                        >
                          <option value="ALL">Todos los tipos</option>
                          <option value="INCOME">Solo ingresos</option>
                          <option value="EXPENSE">Solo egresos</option>
                        </select>

                        <select
                          value={cashMethodFilter}
                          onChange={(event) => setCashMethodFilter(event.target.value as MovementMethodFilter)}
                          className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                        >
                          <option value="ALL">Todos los métodos</option>
                          <option value="CASH">Efectivo</option>
                          <option value="TRANSFER">Transferencia</option>
                          <option value="CARD">Tarjeta</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            setCashSearchTerm('');
                            setCashTypeFilter('ALL');
                            setCashMethodFilter('ALL');
                          }}
                          className="h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[12px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
                        >
                          Limpiar filtros
                        </button>
                      </AdminFilterToolbar>
                    )}

                    <div className="overflow-auto rounded-xl border border-[#dce2ee] bg-white max-h-[68vh] px-4 py-2">
                      <CashMovementsTimeline movements={filteredCashMovements} />
                    </div>
                  </AdminPanel>
                )}

                {cashActiveView === 'closures' && (
                  <CashCloseFlow
                    shift={cashCurrentShift}
                    lastReport={cashLastCloseReport}
                    onCloseShift={() => {
                      if (shouldBlockCloseShiftWithOpenAccounts) {
                        showAdminToast(closeShiftBlockedMessage);
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
                <div className="w-full rounded-2xl border border-[#dce2ee] bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-1">
                      {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                        <button
                          key={`refunds-${period}`}
                          type="button"
                          onClick={() => {
                            setCashActivePeriod(period);
                            setCashPeriodOffset(0);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                            cashActivePeriod === period
                              ? 'bg-white text-[#3053e2] shadow-sm'
                              : 'text-[#6f7890] hover:text-[#4e5870]'
                          }`}
                        >
                          {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setCashPeriodOffset((prev) => prev - 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb]"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="min-w-[120px] text-center text-[12px] font-semibold text-[#4e5870]">{cashPeriodLabel}</span>
                      <button
                        type="button"
                        onClick={() => setCashPeriodOffset((prev) => Math.min(0, prev + 1))}
                        disabled={cashPeriodOffset === 0}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:cursor-not-allowed disabled:text-[#b8c1d4] disabled:hover:bg-transparent"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MetricCard label="Pendientes (período)" value={filteredPendingRefunds.length} format="number" valueColor="#3053e2" />
                  <MetricCard label="Total recientes (período)" value={filteredRecentRefunds.length} format="number" valueColor="#2f5e46" />
                  <MetricCard label="Monto pendiente (período)" value={filteredPendingRefundAmount} format="money" />
                </div>

                <AdminPanel
                  title="Devoluciones recientes"
                  description="Listado real del período según filtros seleccionados."
                  headerClassName="pl-4 pr-2 py-3"
                  actions={(
                    <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-1 sm:flex-nowrap sm:justify-end">
                      <label className="relative w-full sm:w-[260px] sm:flex-none">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b93a5]" />
                        <input
                          type="text"
                          value={refundSearchTerm}
                          onChange={(event) => setRefundSearchTerm(event.target.value)}
                          placeholder="Buscar por código, motivo o referencia"
                          className="h-8 w-full rounded-xl border border-[#dce2ee] bg-white pl-9 pr-3 text-[12px] outline-none focus:border-[#3053e2]"
                        />
                      </label>

                      <select
                        value={refundStatusFilter}
                        onChange={(event) => setRefundStatusFilter(event.target.value as RefundStatusFilter)}
                        className="h-8 min-w-[145px] rounded-xl border border-[#dce2ee] bg-white px-2.5 text-[12px] outline-none focus:border-[#3053e2]"
                      >
                        <option value="ALL">Todos los estados</option>
                        <option value="REQUESTED">Solicitada</option>
                        <option value="APPROVED">Aprobada</option>
                        <option value="READY_TO_EXECUTE">Lista</option>
                        <option value="EXECUTED">Ejecutada</option>
                        <option value="FAILED">Fallida</option>
                        <option value="CANCELLED">Cancelada</option>
                      </select>

                      <select
                        value={refundMethodFilter}
                        onChange={(event) => setRefundMethodFilter(event.target.value as RefundMethodFilter)}
                        className="h-8 min-w-[165px] rounded-xl border border-[#dce2ee] bg-white px-2.5 text-[12px] outline-none focus:border-[#3053e2]"
                      >
                        <option value="ALL">Todos los métodos</option>
                        <option value="CASH">Efectivo</option>
                        <option value="TRANSFER">Transferencia</option>
                        <option value="CARD_REVERSAL">Reverso tarjeta</option>
                        <option value="CREDIT_NOTE">Nota de crédito</option>
                      </select>
                    </AdminFilterToolbar>
                  )}
                  bodyClassName="p-0"
                >
                  {filteredRecentRefunds.length > 0 && (
                    <>
                      <div className="hidden grid-cols-[130px_140px_minmax(0,1fr)_140px_140px_150px_120px] border-b border-[#eef2f8] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#6f7890] lg:grid">
                        <p>Código</p>
                        <p>Fecha</p>
                        <p>Motivo</p>
                        <p>Método</p>
                        <p>Pago / Cuenta</p>
                        <p>Estado</p>
                        <p className="text-right">Monto</p>
                      </div>
                      <div className="hidden divide-y divide-[#eef2f8] lg:block">
                        {filteredRecentRefunds.map((refund) => (
                          <div key={`refund-grid-${refund.id}`} className="grid grid-cols-[130px_140px_minmax(0,1fr)_140px_140px_150px_120px] items-center px-3 py-2 text-[12px] text-[#4b5672]">
                            <p className="font-semibold text-[#2a3245]">{refundCodeLabel(refund)}</p>
                            <p>{formatDateTime24(refund.createdAt)}</p>
                            <p className="truncate">{refund.reason?.trim() || refundReasonTypeLabel(refund.reasonType)}</p>
                            <p>{refundExecutionMethodLabel(refund.executionMethod)}</p>
                            <p className="truncate text-[#5f6984]">P:{shortId(refund.paymentId)} · C:{shortId(refund.accountId)}</p>
                            <div>
                              <span className="rounded-full bg-[#eef1f7] px-2 py-0.5 text-[10px] font-semibold text-[#55617f]">
                                {formatRefundStatus(refund.status)}
                              </span>
                            </div>
                            <p className="text-right font-semibold text-[#27314a]">{formatMoney(refund.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {filteredRecentRefunds.length === 0 && (
                    <div className="hidden px-3 py-8 text-center lg:block">
                      <p className="text-[13px] font-semibold text-[#44506b]">No hay devoluciones para este período</p>
                      <p className="mt-1 text-[12px] text-[#7a8398]">Proba otro rango o ajustá los filtros para ver resultados.</p>
                    </div>
                  )}
                  <div className="divide-y divide-[#eef2f8] lg:hidden">
                    {filteredRecentRefunds.map((refund) => (
                      <div key={refund.id} className="px-3 py-2 text-[12px] text-[#4b5672]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-[#2a3245]">{refundCodeLabel(refund)}</p>
                          <span className="rounded-full bg-[#eef1f7] px-2 py-0.5 text-[10px] font-semibold text-[#55617f]">
                            {formatRefundStatus(refund.status)}
                          </span>
                        </div>
                        <p>{formatMoney(refund.amount)} · {formatDateTime24(refund.createdAt)}</p>
                      </div>
                    ))}
                    {filteredRecentRefunds.length === 0 && (
                      <div className="px-3 py-8 text-center">
                        <p className="text-[13px] font-semibold text-[#44506b]">No hay devoluciones para este período</p>
                        <p className="mt-1 text-[12px] text-[#7a8398]">Proba otro rango o ajustá los filtros para ver resultados.</p>
                      </div>
                    )}
                  </div>
                </AdminPanel>
              </div>
            )}
          </section>

          {adminToasts.length > 0 && (
            <div className="pointer-events-none fixed right-5 top-[84px] z-[150] flex w-full max-w-[360px] flex-col gap-2">
              {adminToasts.map((toast) => (
                <div
                  key={toast.id}
                  className="rounded-xl border border-[#dce2ee] bg-white px-3 py-2 text-[12px] font-semibold text-[#27314a] shadow-lg"
                >
                  {toast.message}
                </div>
              ))}
            </div>
          )}

        </div>
      </AdminPlaygroundShell>

      <AgendaLikeRightSidebar
        open={accountSidebarOpen}
        onClose={closeAccountSidebar}
        title="Gestionar cuenta"
        subtitle={
          <>
            {accountSidebarView === 'create_account'
              ? 'Crea una cuenta manual para carga rápida de conceptos.'
              : selectedAccount
              ? `${selectedAccount.booking?.clientName || `Cuenta ${shortCode(selectedAccount.id)}`} · #${shortCode(selectedAccount.id)}`
              : 'Sin cuenta seleccionada'}
          </>
        }
        statusChip={selectedAccount?.status === 'OPEN' ? 'Cuenta abierta' : selectedAccount ? 'Cuenta cerrada' : undefined}
        statusChipClassName={
          selectedAccount?.status === 'OPEN'
            ? 'bg-[#edf1ff] text-[#3155df]'
            : 'bg-[#e8f8ec] text-[#16733f]'
        }
        tabs={
          accountSidebarView === 'create_account'
            ? [{ id: 'create_account', label: 'Nueva cuenta' }]
            : selectedAccount?.status === 'OPEN'
            ? [
                { id: 'overview', label: 'Resumen' },
                { id: 'add_item', label: 'Conceptos' },
                { id: 'register_payment', label: 'Cobro' },
                { id: 'close_account', label: 'Cierre' },
              ]
            : selectedAccount
              ? [{ id: 'overview', label: 'Resumen' }]
              : []
        }
        activeTabId={accountSidebarView}
        onTabChange={(tabId) => {
          if (
            tabId === 'overview' ||
            tabId === 'add_item' ||
            tabId === 'register_payment' ||
            tabId === 'close_account' ||
            tabId === 'create_account'
          ) {
            setAccountActionError('');
            setAccountSidebarView(tabId as AccountActionSidebarView);
          }
        }}
        footer={
          accountSidebarView === 'create_account' ? (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeAccountSidebar}
                className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleQuickOpenAccount()}
                disabled={openingAccount}
                className="h-10 rounded-xl bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-60"
              >
                {openingAccount ? 'Creando...' : 'Crear cuenta'}
              </button>
            </div>
          ) : selectedAccount ? (
            <div className="flex items-center justify-end gap-2">
              {accountSidebarView === 'overview' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('add_item')}
                    disabled={selectedAccount.status !== 'OPEN'}
                    className="h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd] disabled:opacity-50"
                  >
                    Agregar concepto
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('register_payment')}
                    disabled={selectedAccount.status !== 'OPEN'}
                    className="h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd] disabled:opacity-50"
                  >
                    Registrar cobro
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('close_account')}
                    disabled={selectedAccount.status !== 'OPEN'}
                    className="h-10 rounded-xl bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-50"
                  >
                    Cerrar cuenta
                  </button>
                </>
              )}

              {accountSidebarView === 'add_item' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('overview')}
                    className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    form="account-add-item-form"
                    disabled={submittingAccountItem}
                    className="h-10 rounded-xl bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-60"
                  >
                    {submittingAccountItem ? 'Guardando...' : 'Guardar concepto'}
                  </button>
                </>
              )}

              {accountSidebarView === 'register_payment' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('overview')}
                    className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={openAccountPaymentModal}
                    disabled={
                      submittingAccountPayment ||
                      selectedAccount.status !== 'OPEN' ||
                      Number(selectedAccountDetail?.remaining || 0) <= 0.009
                    }
                    className="h-10 rounded-xl bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-60"
                  >
                    Abrir modal de cobro
                  </button>
                </>
              )}

              {accountSidebarView === 'close_account' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAccountSidebarView('overview')}
                    className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fd]"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCloseSelectedAccount()}
                    disabled={submittingAccountClose || selectedAccount.status !== 'OPEN'}
                    className="h-10 rounded-xl bg-[#b42346] px-4 text-[13px] font-semibold text-white transition hover:bg-[#9a1c3d] disabled:opacity-60"
                  >
                    {submittingAccountClose ? 'Cerrando...' : 'Confirmar cierre'}
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        {accountSidebarView === 'create_account' ? (
          <section className="space-y-3 rounded-2xl border border-[#dce2ee] bg-white p-3">
            <p className="text-[12px] font-semibold text-[#2a3245]">Nueva cuenta manual</p>
            <p className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2 text-[12px] text-[#5b667f]">
              Se creará una cuenta manual para registrar consumos o ajustes fuera de una reserva.
            </p>
          </section>
        ) : !selectedAccount ? (
          <p className="text-[12px] text-[#6f7890]">Seleccioná una cuenta para gestionar.</p>
        ) : (
          <div className="space-y-4">
            {accountActionError && (
              <div className="space-y-2">
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                  {accountActionError}
                </div>
              </div>
            )}

            {accountSidebarView === 'overview' && (
              <section className="rounded-2xl border border-[#dce2ee] bg-white px-3 py-3">
                <p className="text-[12px] font-semibold text-[#2a3245]">Acciones de cuenta</p>
                <div className="mt-2 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2 text-[12px] text-[#5b667f]">
                  {selectedAccount.status === 'OPEN'
                    ? 'Usá las acciones del pie para agregar conceptos, registrar cobros o cerrar la cuenta.'
                    : 'La cuenta ya está cerrada. Podés revisar su resumen desde este panel.'}
                </div>
              </section>
            )}

            {accountSidebarView === 'add_item' && (
              <form id="account-add-item-form" className="space-y-3 rounded-2xl border border-[#dce2ee] bg-white p-3" onSubmit={handleCreateAccountItem}>
                <p className="text-[12px] font-semibold text-[#2a3245]">Nuevo concepto</p>
                <label className="block">
                  <span className="text-[12px] font-medium text-[#4e5870]">Descripción</span>
                  <input
                    type="text"
                    value={newAccountItemForm.description}
                    onChange={(event) => setNewAccountItemForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                    placeholder="Ej: Pelota de pádel"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[12px] font-medium text-[#4e5870]">Cantidad</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={newAccountItemForm.quantity}
                      onChange={(event) => setNewAccountItemForm((prev) => ({ ...prev, quantity: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                    />
                  </label>
                  <label className="col-span-2 block">
                    <span className="text-[12px] font-medium text-[#4e5870]">Precio unitario</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newAccountItemForm.unitPrice}
                      onChange={(event) => setNewAccountItemForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                      placeholder="0.00"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[12px] font-medium text-[#4e5870]">Tipo</span>
                  <select
                    value={newAccountItemForm.type}
                    onChange={(event) =>
                      setNewAccountItemForm((prev) => ({
                        ...prev,
                        type: event.target.value as 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT',
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  >
                    <option value="PRODUCT">Producto</option>
                    <option value="SERVICE">Servicio</option>
                    <option value="ADJUSTMENT">Ajuste</option>
                    <option value="BOOKING">Cancha</option>
                  </select>
                </label>
              </form>
            )}

            {accountSidebarView === 'register_payment' && (
              <section className="space-y-3 rounded-2xl border border-[#dce2ee] bg-white p-3">
                <p className="text-[12px] font-semibold text-[#2a3245]">Registrar cobro</p>
                <p className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2 text-[12px] text-[#5b667f]">
                  Pendiente actual: <span className="font-semibold">{formatMoney(selectedAccountDetail?.remaining || 0)}</span>
                </p>
                <p className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2 text-[12px] text-[#5b667f]">
                  El cobro se registra desde un modal dedicado para mantener el mismo flujo que usamos en agenda.
                </p>
              </section>
            )}

            {accountSidebarView === 'close_account' && (
              <section className="space-y-3 rounded-2xl border border-[#dce2ee] bg-white p-3">
                <p className="text-[12px] font-semibold text-[#2a3245]">Cierre de cuenta</p>
                <div className="rounded-xl border border-[#f3d0d0] bg-[#fff6f6] px-3 py-2 text-[12px] text-[#8f3b3b]">
                  Esta acción cierra la cuenta. Solo debe hacerse cuando no quede deuda pendiente.
                </div>
                <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2 text-[12px] text-[#4e5870]">
                  Pendiente actual: <span className="font-semibold">{formatMoney(selectedAccountDetail?.remaining || 0)}</span>
                </div>
              </section>
            )}
          </div>
        )}
      </AgendaLikeRightSidebar>

      {accountPaymentModalStep === 'form' && selectedAccount && (
        <AdminPaymentFormModal
          title="Registrar cobro"
          subtitle="Elegi metodo y monto. Si hace falta, ajusta conceptos."
          onClose={closeAccountPaymentModal}
          onBackdropPointerDown={handleAccountModalBackdropPointerDown}
          onBackdropPointerUp={handleAccountModalBackdropPointerUp}
          footer={
            <>
              <button
                type="button"
                onClick={closeAccountPaymentModal}
                className="h-10 rounded-xl border border-[#dce2ee] px-4 text-[14px] font-semibold text-[#5d667f] hover:bg-[#f7f9fc]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!accountPaymentAmountIsValid) {
                    setAccountPaymentModalError('Ingresá un monto válido dentro del saldo pendiente.');
                    return;
                  }
                  setAccountPaymentModalError('');
                  setAccountPaymentModalStep('preconfirm');
                }}
                disabled={submittingAccountPayment}
                className="h-10 rounded-xl bg-[#3053e2] px-4 text-[14px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-50"
              >
                Continuar
              </button>
            </>
          }
        >
                <div className={`grid gap-3 ${accountPaymentMethodDraft === 'TRANSFER' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                  <label className="block">
                    <span className="text-[12px] font-medium text-[#79829a]">Método</span>
                    <select
                      value={accountPaymentMethodDraft}
                      onChange={(event) => setAccountPaymentMethodDraft(event.target.value as PaymentMethod)}
                      className="mt-1 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] outline-none focus:border-[#3053e2]"
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="TRANSFER">Transferencia</option>
                      <option value="CARD">Tarjeta</option>
                    </select>
                  </label>
                  {accountPaymentMethodDraft === 'TRANSFER' && (
                    <label className="block">
                      <span className="text-[12px] font-medium text-[#79829a]">Canal de transferencia</span>
                      <select
                        value={accountPaymentChannelDraft}
                        onChange={(event) =>
                          setAccountPaymentChannelDraft(
                            event.target.value as Extract<PaymentChannel, 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'>
                          )
                        }
                        className="mt-1 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] outline-none focus:border-[#3053e2]"
                      >
                        <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                        <option value="VIRTUAL_WALLET">Billetera virtual</option>
                      </select>
                    </label>
                  )}
                </div>

                <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2">
                  <p className="text-[12px] font-semibold text-[#44506b]">Conceptos a cobrar</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                    {[
                      { id: 'FULL', label: 'Todo pendiente' },
                      { id: 'COURT_ONLY', label: 'Solo cancha' },
                      { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
                    ].map((option) => {
                      const isActive = accountPaymentQuickPreset === option.id;
                      return (
                        <button
                          key={`account-payment-preset-${option.id}`}
                          type="button"
                          onClick={() => applyAccountPaymentQuickPreset(option.id as PaymentQuickPreset)}
                          className={`h-9 rounded-lg border text-[12px] font-semibold transition ${
                            isActive
                              ? 'border-[#3155df] bg-[#eef2ff] text-[#3155df]'
                              : 'border-[#dce2ee] bg-white text-[#5f6880] hover:bg-[#f5f7fc]'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {accountPaymentQuickPreset === 'CUSTOM_ITEMS' && (
                  <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-[#44506b]">Selección manual</p>
                      <span className="text-[11px] font-semibold text-[#6f7890]">
                        Total: {computeAccountConceptBasedMaxAmount('CUSTOM_ITEMS', accountPaymentSelectedItemIdsDraft, accountPaymentCustomItemAmountDraftById).toFixed(2)} $
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const nextIds = accountPaymentPendingItems.map((item) => String(item.id));
                            const nextCustomDrafts: Record<string, string> = {};
                            accountPaymentPendingItems.forEach((item) => {
                              nextCustomDrafts[String(item.id)] = Number(item.remainingAmount || 0).toFixed(2);
                            });
                            setAccountPaymentSelectedItemIdsDraft(nextIds);
                            setAccountPaymentCustomItemAmountDraftById(nextCustomDrafts);
                            setAccountPaymentAmountDraft(
                              String(computeAccountConceptBasedMaxAmount('CUSTOM_ITEMS', nextIds, nextCustomDrafts).toFixed(2))
                            );
                          }}
                          className="h-7 rounded-md border border-[#d9e0ed] bg-white px-2 text-[11px] font-semibold text-[#4d5875] hover:bg-[#f4f7fc]"
                        >
                          Seleccionar todo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAccountPaymentSelectedItemIdsDraft([]);
                            setAccountPaymentCustomItemAmountDraftById({});
                            setAccountPaymentAmountDraft('');
                          }}
                          className="h-7 rounded-md border border-[#d9e0ed] bg-white px-2 text-[11px] font-semibold text-[#4d5875] hover:bg-[#f4f7fc]"
                        >
                          Limpiar
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 max-h-[180px] overflow-auto rounded-lg border border-[#dce2ee] bg-white p-2">
                      {accountPaymentPendingItems.length === 0 ? (
                        <p className="px-1 py-2 text-[12px] text-[#7a8398]">No hay conceptos con deuda pendiente.</p>
                      ) : (
                        <div className="space-y-1">
                          {accountPaymentPendingItems.map((item) => {
                            const checked = accountPaymentSelectedItemIdsDraft.includes(String(item.id));
                            return (
                              <div
                                key={`account-payment-concept-item-${item.id}`}
                                onClick={() => {
                                  const nextChecked = !checked;
                                  const nextSet = new Set(accountPaymentSelectedItemIdsDraft.map((value) => String(value || '').trim()).filter(Boolean));
                                  const itemId = String(item.id);
                                  const nextDrafts: Record<string, string> = { ...accountPaymentCustomItemAmountDraftById };
                                  if (nextChecked) {
                                    nextSet.add(itemId);
                                    const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                    if (!prevDraft) {
                                      nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                    }
                                  } else {
                                    nextSet.delete(itemId);
                                    delete nextDrafts[itemId];
                                  }
                                  const nextIds = Array.from(nextSet);
                                  setAccountPaymentSelectedItemIdsDraft(nextIds);
                                  setAccountPaymentCustomItemAmountDraftById(nextDrafts);
                                  setAccountPaymentAmountDraft(
                                    String(computeAccountConceptBasedMaxAmount('CUSTOM_ITEMS', nextIds, nextDrafts).toFixed(2))
                                  );
                                }}
                                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[#f5f7fc]"
                              >
                                <span className="min-w-0 flex items-center gap-2 text-[12px] text-[#2a3245]">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => {
                                      const nextChecked = event.target.checked;
                                      const nextSet = new Set(accountPaymentSelectedItemIdsDraft.map((value) => String(value || '').trim()).filter(Boolean));
                                      const itemId = String(item.id);
                                      const nextDrafts: Record<string, string> = { ...accountPaymentCustomItemAmountDraftById };
                                      if (nextChecked) {
                                        nextSet.add(itemId);
                                        const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                        if (!prevDraft) {
                                          nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                        }
                                      } else {
                                        nextSet.delete(itemId);
                                        delete nextDrafts[itemId];
                                      }
                                      const nextIds = Array.from(nextSet);
                                      setAccountPaymentSelectedItemIdsDraft(nextIds);
                                      setAccountPaymentCustomItemAmountDraftById(nextDrafts);
                                      setAccountPaymentAmountDraft(
                                        String(computeAccountConceptBasedMaxAmount('CUSTOM_ITEMS', nextIds, nextDrafts).toFixed(2))
                                      );
                                    }}
                                    className="h-4 w-4 accent-[#3053e2]"
                                  />
                                  <span className="truncate">{item.type === 'BOOKING' ? 'Cancha' : item.label}</span>
                                </span>
                                <div className="flex items-center gap-2">
                                  <div className="flex h-8 w-[116px] items-center rounded-md border border-[#dce2ee] bg-white px-2">
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      disabled={!checked}
                                      onClick={(event) => event.stopPropagation()}
                                      value={
                                        checked
                                          ? String(
                                              accountPaymentCustomItemAmountDraftById[String(item.id)] ??
                                                Number(item.remainingAmount || 0).toFixed(2)
                                            )
                                          : ''
                                      }
                                      onChange={(event) => {
                                        const itemId = String(item.id);
                                        const nextDrafts: Record<string, string> = {
                                          ...accountPaymentCustomItemAmountDraftById,
                                          [itemId]: event.target.value,
                                        };
                                        setAccountPaymentCustomItemAmountDraftById(nextDrafts);
                                        setAccountPaymentAmountDraft(
                                          String(
                                            computeAccountConceptBasedMaxAmount(
                                              'CUSTOM_ITEMS',
                                              accountPaymentSelectedItemIdsDraft,
                                              nextDrafts
                                            ).toFixed(2)
                                          )
                                        );
                                      }}
                                      className="w-full bg-transparent text-right text-[12px] font-semibold text-[#2a3245] outline-none disabled:text-[#9ca5ba]"
                                    />
                                    <span className="ml-1 text-[11px] font-semibold text-[#8a92a5]">$</span>
                                  </div>
                                  <span className="w-[88px] text-right text-[11px] font-semibold text-[#62708f]">
                                    {Number(item.remainingAmount || 0).toFixed(2)} $
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="text-[12px] font-medium text-[#79829a]">Monto final</span>
                  <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={accountPaymentAmountDraft}
                      onChange={(event) => setAccountPaymentAmountDraft(event.target.value)}
                      className="w-full bg-transparent text-[16px] text-[#2a3245] outline-none"
                    />
                    <span className="text-[15px] font-semibold text-[#8a92a5]">$</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#6f7890]">
                    Maximo: {accountPaymentMaxAmount.toFixed(2)} $
                  </p>
                </label>

                {accountPaymentModalError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                    {accountPaymentModalError}
                  </div>
                )}
        </AdminPaymentFormModal>
      )}

      {accountPaymentModalStep === 'preconfirm' && selectedAccount && (
        <AdminPaymentPreconfirmModal
          onBackdropPointerDown={handleAccountModalBackdropPointerDown}
          onBackdropPointerUp={(event) => {
            const startedOnBackdrop = accountModalBackdropPointerDownTargetRef.current === event.currentTarget;
            const endedOnBackdrop = event.target === event.currentTarget;
            accountModalBackdropPointerDownTargetRef.current = null;
            if (startedOnBackdrop && endedOnBackdrop) {
              setAccountPaymentModalStep('form');
            }
          }}
          methodValue={`${paymentMethodLabel(accountPaymentMethodDraft)}${
            accountPaymentMethodDraft === 'TRANSFER' ? ` - ${paymentChannelLabel(accountPaymentChannelDraft)}` : ''
          }`}
          summaryRows={[
            { label: 'Monto a cobrar', value: `${accountPaymentAmountNumeric.toFixed(2)} $` },
            {
              label: 'Saldo luego del cobro',
              value: `${Math.max(
                0,
                accountPaymentMaxAmount - (Number.isFinite(accountPaymentAmountNumeric) ? accountPaymentAmountNumeric : 0)
              ).toFixed(2)} $`,
            },
          ]}
          showConcepts={false}
          onBack={() => setAccountPaymentModalStep('form')}
          onClose={() => setAccountPaymentModalStep('form')}
          confirmLabel={submittingAccountPayment ? 'Registrando...' : 'Confirmar cobro'}
          confirmDisabled={submittingAccountPayment}
          onConfirm={() => void submitAccountPaymentFromModal()}
        />
      )}

      {accountPaymentModalStep === 'result' && accountPaymentResultModal && selectedAccount && (
        <AdminPaymentResultModal
          onBackdropPointerDown={handleAccountModalBackdropPointerDown}
          onBackdropPointerUp={handleAccountModalBackdropPointerUp}
          title={accountPaymentResultModal.title}
          detail={accountPaymentResultModal.detail}
          variant={accountPaymentResultModal.variant}
          summaryRows={[
            { label: 'Solicitado', value: `${accountPaymentResultModal.requestedAmount.toFixed(2)} $` },
            { label: 'Aplicado', value: `${accountPaymentResultModal.appliedAmount.toFixed(2)} $` },
            { label: 'Método', value: accountPaymentResultModal.methodLabel },
            { label: 'Saldo actual', value: `${accountPaymentResultModal.remainingAfter.toFixed(2)} $` },
          ]}
          onClose={closeAccountPaymentModal}
          onRetry={accountPaymentResultModal.variant !== 'success' ? () => setAccountPaymentModalStep('form') : null}
        />
      )}

      <AgendaLikeRightSidebar
        open={cashActionSidebarOpen}
        onClose={closeActionSidebar}
        title={
          <>
            {cashSidebarView === 'open_shift' && 'Abrir caja'}
            {cashSidebarView === 'close_shift' && 'Cerrar caja'}
            {cashSidebarView === 'movement_create' && 'Registrar movimiento'}
            {cashSidebarView === 'close_report' && 'Detalle de arqueo'}
          </>
        }
        subtitle={
          <>
            {cashSidebarView === 'open_shift' && 'Configura caja registradora y monto inicial.'}
            {cashSidebarView === 'close_shift' && 'Ingresa el efectivo contado para cerrar el turno.'}
            {cashSidebarView === 'movement_create' && 'Crea ingresos o egresos sin saturar la vista principal.'}
            {cashSidebarView === 'close_report' && 'Resumen ampliado del último cierre registrado.'}
          </>
        }
        statusChip={cashCurrentShift ? 'Caja abierta' : 'Caja cerrada'}
        statusChipClassName={cashCurrentShift ? 'bg-[#e8f8ec] text-[#16733f]' : 'bg-[#edf1ff] text-[#3155df]'}
      >
        <div>
          {cashSidebarView === 'open_shift' && (
            <form className="space-y-3" onSubmit={handleOpenShift}>
              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Caja registradora</label>
                <select
                  value={cashOpenShiftForm.cashRegisterId}
                  onChange={(event) => setCashOpenShiftForm((prev) => ({ ...prev, cashRegisterId: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                >
                  <option value="">Seleccionar</option>
                  {cashRegisters.map((register) => (
                    <option key={register.id} value={register.id}>
                      {register.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Monto inicial</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashOpenShiftForm.openingAmount}
                  onChange={(event) => setCashOpenShiftForm((prev) => ({ ...prev, openingAmount: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeActionSidebar}
                  className="h-9 rounded-lg border border-[#dce2ee] bg-white px-3 text-[12px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={openingCashShift}
                  className="h-9 rounded-lg bg-[#3053e2] px-3 text-[12px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-60"
                >
                  {openingCashShift ? 'Abriendo...' : 'Abrir caja'}
                </button>
              </div>
            </form>
          )}

          {cashSidebarView === 'close_shift' && (
            <form className="space-y-3" onSubmit={handleCloseShift}>
              <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3 text-[12px] text-[#4e5870]">
                <p><span className="font-semibold">Caja:</span> {cashCurrentShift?.cashRegister?.name || '-'}</p>
                <p><span className="font-semibold">Apertura:</span> {cashCurrentShift?.openedAt ? formatDateTime24(cashCurrentShift.openedAt) : '-'}</p>
                <p><span className="font-semibold">Monto inicial:</span> {formatMoney(Number(cashCurrentShift?.openingAmount || 0))}</p>
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Dinero contado al cierre</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashCloseShiftForm.countedCash}
                  onChange={(event) => setCashCloseShiftForm({ countedCash: event.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="0"
                />
              </div>

              <button
                type="submit"
                disabled={closingCashShift || !cashCurrentShift}
                className="h-10 w-full rounded-xl bg-[#3053e2] text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {closingCashShift ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </form>
          )}

          {cashSidebarView === 'movement_create' && (
            <form className="space-y-3" onSubmit={handleCreateMovement}>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCashNewMovement((prev) => ({ ...prev, type: 'INCOME' }))}
                  className={`h-10 rounded-xl border text-[12px] font-semibold ${
                    cashNewMovement.type === 'INCOME'
                      ? 'border-[#d4f0dc] bg-[#e8f8ec] text-[#16733f]'
                      : 'border-[#dce2ee] bg-white text-[#4e5870]'
                  }`}
                >
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setCashNewMovement((prev) => ({ ...prev, type: 'EXPENSE' }))}
                  className={`h-10 rounded-xl border text-[12px] font-semibold ${
                    cashNewMovement.type === 'EXPENSE'
                      ? 'border-[#f5c8d0] bg-[#fff0f2] text-[#b42346]'
                      : 'border-[#dce2ee] bg-white text-[#4e5870]'
                  }`}
                >
                  Egreso
                </button>
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Concepto</label>
                <input
                  type="text"
                  value={cashNewMovement.description}
                  onChange={(event) => setCashNewMovement((prev) => ({ ...prev, description: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="Descripción del movimiento"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Monto</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashNewMovement.amount}
                  onChange={(event) => setCashNewMovement((prev) => ({ ...prev, amount: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#4e5870]">Método</label>
                <select
                  value={cashNewMovement.method}
                  onChange={(event) =>
                    setCashNewMovement((prev) => ({ ...prev, method: event.target.value as 'CASH' | 'TRANSFER' | 'CARD' }))
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                >
                  <option value="CASH">Efectivo</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="CARD">Tarjeta</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submittingCashMovement || !cashCurrentShift}
                className="h-10 w-full rounded-xl bg-[#3053e2] text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingCashMovement ? 'Registrando...' : 'Registrar movimiento'}
              </button>
              {!cashCurrentShift && (
                <p className="text-[12px] text-[#7a8398]">Abrí caja para habilitar movimientos.</p>
              )}
            </form>
          )}

          {cashSidebarView === 'close_report' && (
            <div className="space-y-3 text-[13px] text-[#4e5870]">
              {cashLastCloseReport ? (
                <>
                  <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                    <p><span className="font-semibold">Esperado:</span> {formatMoney(cashLastCloseReport.expectedCash)}</p>
                    <p><span className="font-semibold">Contado:</span> {formatMoney(cashLastCloseReport.countedCash)}</p>
                    <p><span className="font-semibold">Diferencia:</span> {formatMoney(cashLastCloseReport.difference)}</p>
                  </div>
                  <p className="text-[12px] text-[#6f7890]">
                    ID cierre: {cashLastCloseReport.shift?.id || '-'}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-[#6f7890]">No hay arqueo disponible en esta sesión.</p>
              )}
            </div>
          )}
        </div>
      </AgendaLikeRightSidebar>
    </>
  );
}
