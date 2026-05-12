// modules/cuentas/components/AccountDrawer.tsx
//
// Drawer canónico de gestión de cuenta.
//
// Props:
//   accountId      — ID de la cuenta a mostrar. null = cerrado.
//   open           — controla visibilidad del drawer.
//   onClose        — callback para cerrar.
//   onSuccess      — invocado tras cada acción exitosa; el padre actualiza su lista.
//   onRefundRequest — abre el drawer de devolución en el padre (necesita contexto de allAccounts).
//   initialView    — intención de apertura: detalle, cobro o nuevo concepto.
//   context        — copia visible para identificar la cuenta dentro del drawer.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, X, AlertTriangle, Plus, Minus, CreditCard, Trash2, User } from 'lucide-react';
import AdminDrawer, { AdminDrawerSection } from '../../../components/admin/ui/AdminDrawer';
import PaymentRegistrationDrawer from '../../../components/admin/payments/PaymentRegistrationDrawer';
import { getAccountById, addAccountItem, registerPayment, closeAccount, voidPosAccount } from '../../../services/AccountService';
import type { PaymentMethod, PaymentChannel } from '../../../services/AccountService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import {
  ACCOUNT_PAYMENT_EPSILON,
  SYNTHETIC_ACCOUNT_TOTAL_ITEM_ID,
  formatMoney,
  shortCode,
  paymentMethodLabel,
  paymentChannelLabel,
  formatRelativeDate,
  itemTypeLabel,
  normalizeAccountDetail,
  buildPendingItemRows,
  resolvePresetItemIds,
  resolveCustomDraftAmount,
  computeConceptBasedMaxAmount,
  buildPaymentPreviewRows,
  type AccountDetail,
  type PaymentQuickPreset,
  type PaymentResultData,
} from '../accountUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountDrawerView =
  | 'overview'
  | 'add_item'
  | 'payment_form'
  | 'payment_preconfirm'
  | 'payment_result'
  | 'close_confirm';

export type AccountDrawerInitialView = 'overview' | 'add_item' | 'payment' | 'close';

export type AccountDrawerContext = {
  title?: string;
  subtitle?: string;
  accountStatus?: 'OPEN' | 'CLOSED';
};

export type AccountDrawerSuccessMeta = {
  accountId?: string;
  label?: string;
};

type AccountDrawerProps = {
  accountId: string | null;
  open: boolean;
  initialView?: AccountDrawerInitialView;
  context?: AccountDrawerContext;
  onClose: () => void;
  onSuccess?: (event: 'payment' | 'item_added' | 'closed', meta?: AccountDrawerSuccessMeta) => void;
  onRefundRequest?: (accountId: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DataRow = ({
  label,
  value,
  valueClassName = '',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) => (
  <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
    <span className="text-[13px] text-p-text-muted">{label}</span>
    <span className={`text-right text-[13px] font-medium text-p-text ${valueClassName}`}>
      {value}
    </span>
  </div>
);

const SummaryCard = ({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: string;
  variant?: 'default' | 'debt' | 'paid';
}) => {
  const colorMap = {
    default: 'bg-p-surface-2 text-p-text',
    debt: 'bg-p-error-bg text-[var(--error-fg)]',
    paid: 'bg-p-positive-bg text-p-positive',
  };
  return (
    <div className={`flex-1 rounded-xl px-3 py-2.5 ${colorMap[variant]}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="text-[16px] font-bold">{value}</p>
    </div>
  );
};

const createDefaultItemForm = () => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  type: 'PRODUCT' as 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT',
});

const sectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';
const sectionListClass = 'divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface';
const SUCCESS_ANIMATION_VARIANT: 'soft' | 'bold' = 'bold';

// ─── AccountDrawer ────────────────────────────────────────────────────────────

export default function AccountDrawer({
  accountId,
  open,
  initialView = 'overview',
  context,
  onClose,
  onSuccess,
  onRefundRequest,
}: AccountDrawerProps) {
  // ── Detail state ────────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // ── View state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<AccountDrawerView>('overview');
  const initialViewAppliedKeyRef = useRef('');

  // ── Action state ────────────────────────────────────────────────────────────
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);

  // ── Add item form ───────────────────────────────────────────────────────────
  const [itemForm, setItemForm] = useState(createDefaultItemForm);

  // ── Payment state ───────────────────────────────────────────────────────────
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [payChannel, setPayChannel] =
    useState<Extract<PaymentChannel, 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'>>('BANK_ACCOUNT');
  const [payPreset, setPayPreset] = useState<PaymentQuickPreset>('FULL');
  const [payAmountDraft, setPayAmountDraft] = useState('');
  const [paySelectedIds, setPaySelectedIds] = useState<string[]>([]);
  const [payCustomAmountById, setPayCustomAmountById] = useState<Record<string, string>>({});
  const [payError, setPayError] = useState('');
  const [payResult, setPayResult] = useState<PaymentResultData | null>(null);

  const normalizeDrawerDetail = useCallback(
    (raw: any, fallbackId: string) => {
      const rawStatus = String(raw?.status || '').toUpperCase();
      const contextStatus = String(context?.accountStatus || '').toUpperCase();
      const effectiveStatus = rawStatus || contextStatus;
      return normalizeAccountDetail(
        effectiveStatus ? { ...raw, status: effectiveStatus } : raw,
        fallbackId
      );
    },
    [context?.accountStatus]
  );

  const openPaymentFlowForDetail = useCallback((targetDetail: AccountDetail) => {
    if (targetDetail.status !== 'OPEN') {
      setActionError('La cuenta está cerrada.');
      setView('overview');
      return;
    }
    if (Number(targetDetail.remaining || 0) <= ACCOUNT_PAYMENT_EPSILON) {
      setActionError('La cuenta no tiene deuda pendiente.');
      setView('overview');
      return;
    }

    setActionError('');
    const rows = buildPendingItemRows(targetDetail);
    const allIds = rows.map((r) => String(r.id));
    setPayMethod('CASH');
    setPayChannel('BANK_ACCOUNT');
    setPayPreset('FULL');
    setPaySelectedIds(allIds);
    setPayCustomAmountById({});
    setPayAmountDraft(Number(targetDetail.remaining || 0).toFixed(2));
    setPayError('');
    setPayResult(null);
    setView('payment_form');
  }, []);

  const applyInitialViewForDetail = useCallback(
    (targetDetail: AccountDetail) => {
      setActionError('');
      setPayError('');

      if (initialView === 'add_item') {
        if (targetDetail.status === 'OPEN') {
          setView('add_item');
        } else {
          setActionError('La cuenta está cerrada.');
          setView('overview');
        }
        return;
      }

      if (initialView === 'payment') {
        openPaymentFlowForDetail(targetDetail);
        return;
      }

      if (initialView === 'close') {
        if (targetDetail.status !== 'OPEN') {
          setActionError('La cuenta ya está cerrada.');
          setView('overview');
          return;
        }
        if (Number(targetDetail.remaining || 0) > ACCOUNT_PAYMENT_EPSILON) {
          setActionError('Registrá el cobro pendiente antes de cerrar la cuenta.');
          setView('overview');
          return;
        }
        setView('close_confirm');
        return;
      }

      setView('overview');
    },
    [initialView, openPaymentFlowForDetail]
  );

  // ── Fetch on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !accountId) {
      setDetail(null);
      setView('overview');
      setLoadError('');
      setActionError('');
      setPayError('');
      setPayResult(null);
      setItemForm(createDefaultItemForm());
      setVoidConfirmOpen(false);
      initialViewAppliedKeyRef.current = '';
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setActionError('');
    setPayError('');
    setPayResult(null);
    setItemForm(createDefaultItemForm());
    setVoidConfirmOpen(false);
    setView('overview');
    initialViewAppliedKeyRef.current = '';
    getAccountById(accountId)
      .then((raw) => {
        if (cancelled) return;
        setDetail(normalizeDrawerDetail(raw, accountId));
      })
      .catch((err) => {
        if (cancelled) return;
        reportUiError({ area: 'AccountDrawer', action: 'fetchDetail' }, err);
        setLoadError(extractErrorMessage(err, 'No se pudo cargar la cuenta.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, accountId, normalizeDrawerDetail]);

  useEffect(() => {
    if (!open || !accountId || !detail) return;
    const key = `${accountId}:${initialView}`;
    if (initialViewAppliedKeyRef.current === key) return;
    initialViewAppliedKeyRef.current = key;
    applyInitialViewForDetail(detail);
  }, [open, accountId, detail, initialView, applyInitialViewForDetail]);

  // ── Reload helper ─────────────────────────────────────────────────────────
  const reloadDetail = useCallback(async () => {
    if (!accountId) return;
    try {
      const raw = await getAccountById(accountId);
      setDetail(normalizeDrawerDetail(raw, accountId));
    } catch (err) {
      reportUiError({ area: 'AccountDrawer', action: 'reloadDetail' }, err);
    }
  }, [accountId, normalizeDrawerDetail]);

  // ── Reset when going back ─────────────────────────────────────────────────
  const goToOverview = useCallback(async () => {
    // Si venimos de un pago exitoso, recarga el detail una vez más para certeza
    if (payResult?.variant === 'success') {
      await reloadDetail();
    }
    setView('overview');
    setActionError('');
    setPayError('');
  }, [payResult, reloadDetail]);

  // ── Payment derived state ─────────────────────────────────────────────────
  const pendingRows = useMemo(() => buildPendingItemRows(detail), [detail]);
  const accountMaxAmount = Number(detail?.remaining || 0);
  const hasCourtItems = pendingRows.some((r) => r.type === 'BOOKING');
  const pendingRowById = useMemo(() => {
    const map = new Map<string, (typeof pendingRows)[number]>();
    pendingRows.forEach((row) => {
      map.set(String(row.id), row);
    });
    return map;
  }, [pendingRows]);
  const customSelectedTotal = useMemo(() => {
    return paySelectedIds.reduce((sum, itemId) => {
      const row = pendingRowById.get(itemId);
      if (!row) return sum;
      const resolved = resolveCustomDraftAmount(
        itemId,
        Number(row.remainingAmount || 0),
        payCustomAmountById
      );
      return sum + resolved;
    }, 0);
  }, [paySelectedIds, pendingRowById, payCustomAmountById]);
  const payMethodOptions = useMemo(
    () => [
      { value: 'CASH', label: 'Efectivo' },
      { value: 'TRANSFER', label: 'Transferencia' },
      { value: 'CARD', label: 'Tarjeta' },
    ],
    []
  );
  const payPresetOptions = useMemo<Array<{ id: PaymentQuickPreset; label: string }>>(
    () => {
      const options: Array<{ id: PaymentQuickPreset; label: string }> = [
        { id: 'FULL', label: 'Todo pendiente' },
      ];
      if (hasCourtItems) {
        options.push({ id: 'COURT_ONLY', label: 'Solo cancha' });
      }
      options.push({ id: 'CUSTOM_ITEMS', label: 'Personalizado' });
      return options;
    },
    [hasCourtItems]
  );

  const conceptMaxAmount = useMemo(
    () =>
      computeConceptBasedMaxAmount(
        payPreset,
        pendingRows,
        accountMaxAmount,
        paySelectedIds,
        payCustomAmountById
      ),
    [payPreset, pendingRows, accountMaxAmount, paySelectedIds, payCustomAmountById]
  );
  const maxAllowed = Math.min(accountMaxAmount, conceptMaxAmount);
  const amountNumeric = Number(String(payAmountDraft || '').replace(',', '.'));
  const amountIsValid =
    Number.isFinite(amountNumeric) &&
    amountNumeric > ACCOUNT_PAYMENT_EPSILON &&
    amountNumeric <= maxAllowed + ACCOUNT_PAYMENT_EPSILON;

  const previewRows = useMemo(
    () =>
      buildPaymentPreviewRows(
        payPreset,
        pendingRows,
        paySelectedIds,
        payCustomAmountById,
        amountNumeric
      ),
    [payPreset, pendingRows, paySelectedIds, payCustomAmountById, amountNumeric]
  );

  // ── Open payment flow ─────────────────────────────────────────────────────
  const openPaymentFlow = useCallback(() => {
    if (!detail) return;
    openPaymentFlowForDetail(detail);
  }, [detail, openPaymentFlowForDetail]);

  const getSuccessMeta = useCallback((): AccountDrawerSuccessMeta => {
    const id = detail?.id || accountId || '';
    const label =
      String(context?.subtitle || '').trim() ||
      String(context?.title || '').trim() ||
      (id ? `Cuenta #${shortCode(id)}` : 'Cuenta');
    return {
      accountId: id || undefined,
      label,
    };
  }, [accountId, context?.subtitle, context?.title, detail?.id]);

  // ── Apply quick preset ────────────────────────────────────────────────────
  const applyPreset = useCallback(
    (preset: PaymentQuickPreset) => {
      setPayPreset(preset);
      const nextIds =
        preset === 'CUSTOM_ITEMS'
          ? paySelectedIds
          : resolvePresetItemIds(preset, pendingRows);
      if (preset !== 'CUSTOM_ITEMS') {
        setPaySelectedIds(nextIds);
        setPayCustomAmountById({});
      }
      setPayAmountDraft(
        String(
          computeConceptBasedMaxAmount(
            preset,
            pendingRows,
            accountMaxAmount,
            nextIds,
            {}
          ).toFixed(2)
        )
      );
    },
    [paySelectedIds, pendingRows, accountMaxAmount]
  );

  const handleSelectAllCustomItems = useCallback(() => {
    const nextIds = pendingRows.map((row) => String(row.id));
    const nextDrafts: Record<string, string> = {};
    pendingRows.forEach((row) => {
      nextDrafts[String(row.id)] = Number(row.remainingAmount || 0).toFixed(2);
    });
    setPaySelectedIds(nextIds);
    setPayCustomAmountById(nextDrafts);
    setPayAmountDraft(
      String(
        computeConceptBasedMaxAmount(
          'CUSTOM_ITEMS',
          pendingRows,
          accountMaxAmount,
          nextIds,
          nextDrafts
        ).toFixed(2)
      )
    );
  }, [pendingRows, accountMaxAmount]);

  const handleClearCustomItems = useCallback(() => {
    setPaySelectedIds([]);
    setPayCustomAmountById({});
    setPayAmountDraft('');
  }, []);

  const handleToggleCustomItem = useCallback(
    (itemId: string, checked: boolean) => {
      const nextIds = checked
        ? [...paySelectedIds, itemId]
        : paySelectedIds.filter((id) => id !== itemId);
      const nextDrafts = { ...payCustomAmountById };
      if (checked) {
        const row = pendingRowById.get(itemId);
        const fallback = Number(row?.remainingAmount || 0).toFixed(2);
        if (!String(nextDrafts[itemId] ?? '').trim()) {
          nextDrafts[itemId] = fallback;
        }
      } else {
        delete nextDrafts[itemId];
      }
      setPaySelectedIds(nextIds);
      setPayCustomAmountById(nextDrafts);
      setPayAmountDraft(
        String(
          computeConceptBasedMaxAmount(
            'CUSTOM_ITEMS',
            pendingRows,
            accountMaxAmount,
            nextIds,
            nextDrafts
          ).toFixed(2)
        )
      );
    },
    [paySelectedIds, payCustomAmountById, pendingRowById, pendingRows, accountMaxAmount]
  );

  const handleCustomItemAmountChange = useCallback(
    (itemId: string, value: string) => {
      const nextDrafts = { ...payCustomAmountById, [itemId]: value };
      setPayCustomAmountById(nextDrafts);
      setPayAmountDraft(
        String(
          computeConceptBasedMaxAmount(
            'CUSTOM_ITEMS',
            pendingRows,
            accountMaxAmount,
            paySelectedIds,
            nextDrafts
          ).toFixed(2)
        )
      );
    },
    [payCustomAmountById, pendingRows, accountMaxAmount, paySelectedIds]
  );

  // ── Submit payment ────────────────────────────────────────────────────────
  const submitPayment = useCallback(async () => {
    if (!accountId || !detail) return;
    const amount = amountNumeric;
    if (!Number.isFinite(amount) || amount <= ACCOUNT_PAYMENT_EPSILON) {
      setPayError('Ingresá un monto válido mayor a 0.');
      return;
    }
    if (amount > Number(detail.remaining || 0) + ACCOUNT_PAYMENT_EPSILON) {
      setPayError(`El monto no puede superar la deuda pendiente (${formatMoney(Number(detail.remaining))}).`);
      return;
    }
    if (amount > maxAllowed + ACCOUNT_PAYMENT_EPSILON) {
      setPayError('La suma por concepto debe coincidir con el monto final a cobrar.');
      return;
    }
    if (payMethod === 'TRANSFER' && !payChannel) {
      setPayError('Seleccioná el canal de transferencia.');
      return;
    }

    const appliedItems = previewRows.map((row) => ({
      id: row.id,
      label: row.label,
      amount: Number(row.amount.toFixed(2)),
    }));
    const itemAllocations = appliedItems
      .filter(
        (row) =>
          row.id !== SYNTHETIC_ACCOUNT_TOTAL_ITEM_ID &&
          Number(row.amount || 0) > ACCOUNT_PAYMENT_EPSILON
      )
      .map((row) => ({ accountItemId: row.id, amount: Number(row.amount.toFixed(2)) }));
    const canSendAllocations =
      itemAllocations.length > 0 &&
      itemAllocations.length === appliedItems.length &&
      Math.abs(
        itemAllocations.reduce((s, r) => s + Number(r.amount || 0), 0) - amount
      ) <= ACCOUNT_PAYMENT_EPSILON;
    const roundedAmount = Number(amount.toFixed(2));

    try {
      setSubmitting(true);
      setPayError('');
      await registerPayment({
        accountId,
        amount: roundedAmount,
        method: payMethod,
        channel: payMethod === 'TRANSFER' ? payChannel : undefined,
        allocations: canSendAllocations ? itemAllocations : undefined,
      });
      await reloadDetail();
      const reloaded = await getAccountById(accountId).then((r) =>
        normalizeDrawerDetail(r, accountId)
      );
      setDetail(reloaded);
      setPayResult({
        variant: 'success',
        title: 'Cobro registrado',
        detail: 'El cobro se registró correctamente.',
        requestedAmount: roundedAmount,
        appliedAmount: roundedAmount,
        remainingAfter: Number(reloaded.remaining || 0),
        methodLabel: paymentMethodLabel(payMethod),
        appliedItems,
      });
      setView('payment_result');
      onSuccess?.('payment', getSuccessMeta());
    } catch (err) {
      reportUiError({ area: 'AccountDrawer', action: 'submitPayment' }, err);
      const message = extractErrorMessage(err, 'No se pudo registrar el cobro.');
      setPayResult({
        variant: 'error',
        title: 'No se pudo registrar el cobro',
        detail: message,
        requestedAmount: roundedAmount,
        appliedAmount: 0,
        remainingAfter: Number(detail.remaining || 0),
        methodLabel: paymentMethodLabel(payMethod),
        appliedItems: [],
      });
      setView('payment_result');
    } finally {
      setSubmitting(false);
    }
  }, [
    accountId,
    detail,
    amountNumeric,
    maxAllowed,
    payMethod,
    payChannel,
    previewRows,
    reloadDetail,
    getSuccessMeta,
    normalizeDrawerDetail,
    onSuccess,
  ]);

  // ── Submit add item ────────────────────────────────────────────────────────
  const submitAddItem = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!accountId) return;
      if (!detail || detail.status !== 'OPEN') {
        setActionError('La cuenta está cerrada. No podés agregar conceptos.');
        setView('overview');
        return;
      }
      const description = itemForm.description.trim();
      const quantity = Number(itemForm.quantity);
      const unitPrice = Number(itemForm.unitPrice);

      if (description.length < 2) {
        setActionError('Ingresá una descripción válida.');
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setActionError('La cantidad debe ser mayor a 0.');
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        setActionError('El precio unitario debe ser mayor a 0.');
        return;
      }

      try {
        setSubmitting(true);
        setActionError('');
        await addAccountItem(accountId, {
          description,
          quantity,
          unitPrice,
          type: itemForm.type,
        });
        await reloadDetail();
        setItemForm(createDefaultItemForm());
        setView('overview');
        onSuccess?.('item_added', getSuccessMeta());
      } catch (err) {
        reportUiError({ area: 'AccountDrawer', action: 'submitAddItem' }, err);
        setActionError(extractErrorMessage(err, 'No se pudo agregar el concepto.'));
      } finally {
        setSubmitting(false);
      }
    },
    [accountId, detail, itemForm, reloadDetail, getSuccessMeta, onSuccess]
  );

  // ── Submit close account ──────────────────────────────────────────────────
  const submitCloseAccount = useCallback(async () => {
    if (!accountId) return;
    if (!detail) {
      setActionError('No se pudo validar el saldo de la cuenta.');
      return;
    }
    if (Number(detail.remaining || 0) > ACCOUNT_PAYMENT_EPSILON) {
      setActionError(
        `La cuenta todavía tiene ${formatMoney(Number(detail.remaining))} pendiente. Registrá el cobro antes de cerrarla.`
      );
      return;
    }
    try {
      setSubmitting(true);
      setActionError('');
      await closeAccount(accountId);
      await reloadDetail();
      setView('overview');
      onSuccess?.('closed', getSuccessMeta());
      onClose();
    } catch (err) {
      reportUiError({ area: 'AccountDrawer', action: 'submitCloseAccount' }, err);
      setActionError(extractErrorMessage(err, 'No se pudo cerrar la cuenta.'));
    } finally {
      setSubmitting(false);
    }
  }, [accountId, detail, reloadDetail, getSuccessMeta, onClose, onSuccess]);

  // ── P2-B: Void POS account handler ─────────────────────────────────────────
  const handleVoidPosAccount = useCallback(async () => {
    if (!accountId) return;
    try {
      setSubmitting(true);
      setActionError('');
      setVoidConfirmOpen(false);
      await voidPosAccount(accountId);
      onSuccess?.('closed', getSuccessMeta());
      onClose();
    } catch (err) {
      reportUiError({ area: 'AccountDrawer', action: 'voidPosAccount' }, err);
      setActionError(extractErrorMessage(err, 'No se pudo anular la venta.'));
    } finally {
      setSubmitting(false);
    }
  }, [accountId, getSuccessMeta, onClose, onSuccess]);

  // ── Close handler — guarda contra cierre accidental durante submit ─────────
  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isOpen = detail?.status === 'OPEN';
  const hasPendingDebt = Number(detail?.remaining || 0) > ACCOUNT_PAYMENT_EPSILON;
  const isPosOrBar = detail?.sourceType === 'BAR' || detail?.sourceType === 'POS';
  const hasNoPayments = Number(detail?.paid || 0) <= ACCOUNT_PAYMENT_EPSILON;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Title & status ─────────────────────────────────────────────────────────
  const contextTitle = String(context?.title || '').trim();
  const contextSubtitle = String(context?.subtitle || '').trim();
  const accountTitle = contextTitle || `Cuenta ${detail ? `#${shortCode(detail.id)}` : ''}`;
  const drawerSubtitle =
    view === 'payment_form'
      ? 'Elegi método y monto. Si hace falta, ajusta conceptos.'
      : detail && contextSubtitle
      ? contextSubtitle
      : detail && contextTitle
      ? `#${shortCode(detail.id)}`
      : undefined;

  const drawerTitle =
    view === 'add_item'
      ? 'Agregar concepto'
      : view === 'payment_form' || view === 'payment_preconfirm'
      ? 'Registrar cobro'
      : view === 'payment_result'
      ? payResult?.title || 'Cobro'
    : view === 'close_confirm'
    ? 'Cerrar cuenta'
    : accountTitle;

  const statusChip =
    view === 'overview' && detail
      ? detail.status === 'OPEN'
        ? hasPendingDebt
          ? 'Con deuda'
          : 'Al día'
        : 'Cerrada'
      : undefined;

  const statusChipClassName =
    detail?.status === 'CLOSED'
      ? 'bg-p-surface-3 text-p-text-muted'
      : hasPendingDebt
      ? 'bg-p-error-bg text-[var(--error-fg)]'
      : 'bg-p-positive-bg text-p-positive';

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footer = (() => {
    if (view === 'overview') {
      if (loading || !detail) return undefined;
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isOpen && (
            <button
              type="button"
              onClick={() => { setActionError(''); setView('add_item'); }}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-accent transition hover:bg-p-surface-2"
            >
              <Plus size={14} />
              Concepto
            </button>
          )}
          {isOpen && hasPendingDebt && (
            <button
              type="button"
              onClick={openPaymentFlow}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800"
            >
              <CreditCard size={14} />
              Cobrar
            </button>
          )}
          {onRefundRequest && detail.payments.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRefundRequest(detail.id);
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2"
            >
              <Minus size={14} />
              Devolución
            </button>
          )}
          {isOpen && !hasPendingDebt && (
            <button
              type="button"
              onClick={() => { setActionError(''); setView('close_confirm'); }}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-p-error bg-p-error-bg px-4 text-[13px] font-semibold text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50"
            >
              Cerrar cuenta
            </button>
          )}
          {/* P2-B: Anular venta mostrador */}
          {isOpen && isPosOrBar && hasNoPayments && (
            <button
              type="button"
              onClick={() => { setActionError(''); setVoidConfirmOpen((v) => !v); }}
              disabled={submitting}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:border-p-error hover:text-p-error disabled:opacity-40"
            >
              <Trash2 size={14} />
              Anular venta
            </button>
          )}
        </div>
      );
    }

    if (view === 'add_item') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToOverview}
            disabled={submitting}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="submit"
            form="add-item-form"
            disabled={submitting}
            className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:opacity-40"
          >
            {submitting ? 'Agregando...' : 'Agregar concepto'}
          </button>
        </div>
      );
    }

    if (view === 'payment_form') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToOverview}
            disabled={submitting}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!amountIsValid || submitting}
            onClick={() => setView('payment_preconfirm')}
            className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:opacity-40"
          >
            {submitting ? 'Cargando...' : 'Continuar'}
          </button>
        </div>
      );
    }

    if (view === 'payment_preconfirm') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('payment_form')}
            disabled={submitting}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Volver
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={submitting}
            onClick={submitPayment}
            className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:opacity-40"
          >
            {submitting ? 'Registrando...' : 'Confirmar cobro'}
          </button>
        </div>
      );
    }

    if (view === 'payment_result') {
      return (
        <div className="flex items-center gap-2">
          {payResult?.variant === 'error' && (
            <button
              type="button"
              onClick={() => setView('payment_form')}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2"
            >
              <ArrowLeft size={14} />
              Reintentar
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={goToOverview}
            className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800"
          >
            {payResult?.variant === 'success' ? 'Ver cuenta' : 'Cerrar'}
          </button>
        </div>
      );
    }

    if (view === 'close_confirm') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToOverview}
            disabled={submitting}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={submitting}
            onClick={submitCloseAccount}
            className="h-10 rounded-xl border border-p-error bg-p-error-bg px-5 text-[13px] font-semibold text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50 disabled:opacity-40"
          >
            {submitting ? 'Cerrando...' : 'Cerrar cuenta'}
          </button>
        </div>
      );
    }

    return undefined;
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  // BODY
  // ─────────────────────────────────────────────────────────────────────────────

  const body = (() => {
    // ── Loading / error states ───────────────────────────────────────────────
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-p-text-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-p-border border-p-accent-t" />
          <p className="text-[13px]">Cargando cuenta...</p>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-p-error bg-p-error-bg p-6 text-center">
          <AlertTriangle size={20} className="text-[var(--error-fg)]" />
          <p className="text-[13px] text-[var(--error-fg)]">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              if (!accountId) return;
              setLoading(true);
              setLoadError('');
              getAccountById(accountId)
                .then((raw) => setDetail(normalizeDrawerDetail(raw, accountId)))
                .catch((err) => setLoadError(extractErrorMessage(err, 'Error al cargar la cuenta.')))
                .finally(() => setLoading(false));
            }}
            className="text-[12px] font-medium text-p-accent underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      );
    }

    if (!detail) return null;

    // ── Overview ─────────────────────────────────────────────────────────────
    if (view === 'overview') {
      return (
        <>
          {/* Error banner */}
          {actionError && (
            <div className="flex items-start gap-2 rounded-xl border border-p-error bg-p-error-bg px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--error-fg)]" />
              <p className="text-[13px] text-[var(--error-fg)]">{actionError}</p>
            </div>
          )}

          {/* Summary cards */}
          <AdminDrawerSection className={sectionCardClass}>
            <div className="flex gap-2">
              <SummaryCard label="Total" value={formatMoney(detail.total)} />
              <SummaryCard
                label="Pagado"
                value={formatMoney(detail.paid)}
                variant={Number(detail.paid || 0) > ACCOUNT_PAYMENT_EPSILON ? 'paid' : 'default'}
              />
              <SummaryCard
                label="Pendiente"
                value={formatMoney(detail.remaining)}
                variant={hasPendingDebt ? 'debt' : 'default'}
              />
            </div>
          </AdminDrawerSection>

          {/* Cliente (P2-A) */}
          {detail.client && (
            <AdminDrawerSection className={sectionCardClass}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-p-accent/10">
                  <User size={14} className="text-p-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-p-text">{detail.client.name}</p>
                  {(detail.client.phone || detail.client.email) && (
                    <p className="truncate text-[11px] text-p-text-muted">
                      {detail.client.phone || detail.client.email}
                    </p>
                  )}
                </div>
              </div>
            </AdminDrawerSection>
          )}

          {/* Conceptos */}
          {detail.items.length > 0 && (
            <AdminDrawerSection title="Conceptos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {detail.items.map((item) => {
                  // Calcular cuánto se pagó de este item
                  const paidForItem = detail.payments.reduce(
                    (sum, payment) =>
                      sum +
                      (payment.allocations
                        .filter((a) => String(a.accountItemId) === String(item.id))
                        .reduce((s, a) => s + Number(a.amount || 0), 0) || 0),
                    0
                  );
                  const remainingForItem = Math.max(0, Number(item.total || 0) - paidForItem);
                  const itemIsPaid = remainingForItem < ACCOUNT_PAYMENT_EPSILON;

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col gap-2 px-4 py-3 ${
                        itemIsPaid ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-p-text">
                            {item.type === 'BOOKING' ? 'Cancha' : item.description}
                            {itemIsPaid && (
                              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                ✓ Pagado
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-p-text-muted">
                            {itemTypeLabel(item.type)}
                            {item.quantity > 1 && ` · ×${item.quantity}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold text-p-text">
                          {formatMoney(item.total)}
                        </span>
                      </div>
                      {!itemIsPaid && paidForItem > ACCOUNT_PAYMENT_EPSILON && (
                        <div className="flex items-center justify-between gap-2 border-t border-p-border pt-2 text-[11px]">
                          <span className="text-p-text-muted">
                            Pagado: {formatMoney(paidForItem)} | Pendiente: {formatMoney(remainingForItem)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </AdminDrawerSection>
          )}

          {/* Pagos registrados */}
          {detail.payments.length > 0 && (
            <AdminDrawerSection title="Pagos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {detail.payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-p-text">
                        {paymentMethodLabel(payment.method)}
                        {payment.channel &&
                          payment.method === 'TRANSFER' && (
                            <span className="ml-1 text-[11px] font-normal text-p-text-muted">
                              · {paymentChannelLabel(payment.channel)}
                            </span>
                          )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-p-text-muted">
                        {formatRelativeDate(payment.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-p-positive">
                      {formatMoney(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}

          {detail.items.length === 0 && detail.payments.length === 0 && (
            <p className="text-center text-[13px] text-p-text-muted">
              Esta cuenta no tiene conceptos ni pagos todavía.
            </p>
          )}

          {/* P2-B: Void confirm inline */}
          {voidConfirmOpen && (
            <div className="rounded-xl border border-p-error bg-p-error-bg px-4 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--error-fg)]" />
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-[var(--error-fg)]">¿Anular esta venta?</p>
                  <p className="mt-1 text-[12px] text-[var(--error-fg)] opacity-80">
                    Se restaurará el stock de los productos. Esta acción no se puede deshacer.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleVoidPosAccount()}
                      disabled={submitting}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-p-error px-3 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {submitting ? 'Anulando...' : 'Sí, anular'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoidConfirmOpen(false)}
                      disabled={submitting}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-medium text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      );
    }

    // ── Add item ─────────────────────────────────────────────────────────────
    if (view === 'add_item') {
      return (
        <form id="add-item-form" onSubmit={submitAddItem}>
          <AdminDrawerSection title="Concepto" className={sectionCardClass}>
            <div className="space-y-3">
              {actionError && (
                <p className="text-[13px] text-[var(--error-fg)]">{actionError}</p>
              )}

              <div>
                <label className="mb-1 block text-[12px] font-medium text-p-text-muted">
                  Tipo
                </label>
                <select
                  value={itemForm.type}
                  onChange={(e) =>
                    setItemForm((prev) => ({
                      ...prev,
                      type: e.target.value as typeof itemForm.type,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text focus:border-p-accent focus:outline-none"
                >
                  <option value="PRODUCT">Producto</option>
                  <option value="SERVICE">Servicio</option>
                  <option value="ADJUSTMENT">Ajuste</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-medium text-p-text-muted">
                  Descripción
                </label>
                <input
                  type="text"
                  value={itemForm.description}
                  onChange={(e) =>
                    setItemForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Ej: Empanadas ×3"
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text placeholder:text-p-text-muted focus:border-p-accent focus:outline-none"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[12px] font-medium text-p-text-muted">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={itemForm.quantity}
                    onChange={(e) =>
                      setItemForm((prev) => ({ ...prev, quantity: e.target.value }))
                    }
                    className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text focus:border-p-accent focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[12px] font-medium text-p-text-muted">
                    Precio unitario
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemForm.unitPrice}
                    onChange={(e) =>
                      setItemForm((prev) => ({ ...prev, unitPrice: e.target.value }))
                    }
                    placeholder="0.00"
                    className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text placeholder:text-p-text-muted focus:border-p-accent focus:outline-none"
                  />
                </div>
              </div>

              {itemForm.description && itemForm.unitPrice && (
                <div className="rounded-xl border border-p-border bg-p-surface">
                  <DataRow
                    label="Total"
                    value={formatMoney(
                      Number(itemForm.quantity || 1) * Number(itemForm.unitPrice || 0)
                    )}
                  />
                </div>
              )}
            </div>
          </AdminDrawerSection>
        </form>
      );
    }

    // ── Payment form ──────────────────────────────────────────────────────────
    if (view === 'payment_form') {
      return (
        <PaymentRegistrationDrawer
          methodOptions={payMethodOptions}
          methodValue={payMethod}
          onMethodChange={(value) => setPayMethod(value as PaymentMethod)}
          presetOptions={payPresetOptions}
          selectedPreset={payPreset}
          onPresetChange={applyPreset}
          pendingItems={pendingRows}
          selectedItemIds={paySelectedIds}
          customAmountById={payCustomAmountById}
          customSelectedTotal={customSelectedTotal}
          onSelectAll={handleSelectAllCustomItems}
          onClear={handleClearCustomItems}
          onToggleItem={handleToggleCustomItem}
          onItemAmountChange={handleCustomItemAmountChange}
          amountDraft={payAmountDraft}
          onAmountChange={setPayAmountDraft}
          maxInlineLabel={`Maximo: ${maxAllowed.toFixed(2)} $`}
          maxFooterLabel={`Máximo para este cobro: ${maxAllowed.toFixed(2)} $`}
        />
      );
    }

    // ── Payment preconfirm ────────────────────────────────────────────────────
    if (view === 'payment_preconfirm') {
      return (
        <>
          <AdminDrawerSection title="Resumen del cobro" className={sectionCardClass}>
            <div className={sectionListClass}>
              <DataRow
                label="Monto"
                value={formatMoney(amountNumeric)}
                valueClassName="font-bold text-p-text"
              />
              <DataRow label="Método" value={paymentMethodLabel(payMethod)} />
              {payMethod === 'TRANSFER' && (
                <DataRow label="Canal" value={paymentChannelLabel(payChannel)} />
              )}
            </div>
          </AdminDrawerSection>

          {previewRows.length > 0 && (
            <AdminDrawerSection title="Conceptos cubiertos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {previewRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-p-text">{row.label}</span>
                    <span className="text-[13px] font-semibold text-p-text">
                      {formatMoney(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}

          <div className="rounded-xl border border-p-warning bg-p-warning-bg px-4 py-3">
            <p className="text-[13px] text-p-warning">
              Revisá los datos antes de confirmar. Esta acción no se puede deshacer
              directamente.
            </p>
          </div>
        </>
      );
    }

    // ── Payment result ────────────────────────────────────────────────────────
    if (view === 'payment_result' && payResult) {
      const isSuccess = payResult.variant === 'success';
      return (
        <>
          <div
            className={[
              'flex flex-col items-center gap-3 rounded-2xl border p-6 text-center',
              isSuccess
                ? `account-success-card ${
                    SUCCESS_ANIMATION_VARIANT === 'bold' ? 'account-success-glow-bold' : 'account-success-glow-soft'
                  }`
                : '',
              isSuccess
                ? 'border-emerald-500/35 bg-p-surface text-p-text'
                : 'bg-p-error-bg text-[var(--error-fg)]',
            ].join(' ')}
          >
            <div
              className={[
                'grid h-12 w-12 place-items-center rounded-full',
                isSuccess
                  ? `account-success-icon ${
                      SUCCESS_ANIMATION_VARIANT === 'bold' ? 'account-success-icon-bold' : 'account-success-icon-soft'
                    }`
                  : '',
                isSuccess ? 'bg-emerald-500/20' : 'bg-[var(--error-fg)]',
              ].join(' ')}
            >
              {isSuccess ? (
                <Check size={24} className="text-emerald-300" />
              ) : (
                <X size={24} className="text-ink-50" />
              )}
            </div>
            <p className={`text-[18px] font-bold ${isSuccess ? 'text-p-text account-success-title' : ''}`}>
              {payResult.title}
            </p>
            <p
              className={`text-[13px] ${isSuccess ? 'text-p-text-muted account-success-detail' : 'opacity-80'}`}
            >
              {payResult.detail}
            </p>
          </div>

          {isSuccess && (
            <AdminDrawerSection title="Detalle" className={sectionCardClass}>
              <div className={sectionListClass}>
                <DataRow label="Cobrado" value={formatMoney(payResult.appliedAmount)} />
                <DataRow label="Método" value={payResult.methodLabel} />
                <DataRow label="Saldo restante" value={formatMoney(payResult.remainingAfter)} />
              </div>
            </AdminDrawerSection>
          )}

          {isSuccess && payResult.appliedItems.length > 0 && (
            <AdminDrawerSection title="Conceptos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {payResult.appliedItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-p-text">{item.label}</span>
                    <span className="text-[13px] font-semibold text-p-positive">
                      {formatMoney(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}
        </>
      );
    }

    // ── Close confirm ─────────────────────────────────────────────────────────
    if (view === 'close_confirm') {
      return (
        <>
          {actionError ? (
            <div className="flex items-start gap-2 rounded-xl border border-p-error bg-p-error-bg px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--error-fg)]" />
              <p className="text-[13px] text-[var(--error-fg)]">{actionError}</p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-p-warning bg-p-warning-bg px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-p-warning" />
              <p className="text-[13px] text-p-warning">
                Al cerrar la cuenta ya no se podrán agregar conceptos ni registrar cobros.
                Esta acción es definitiva.
              </p>
            </div>
          )}

          <AdminDrawerSection title="Estado actual" className={sectionCardClass}>
            <div className={sectionListClass}>
              <DataRow label="Total" value={formatMoney(detail.total)} />
              <DataRow label="Pagado" value={formatMoney(detail.paid)} />
              <DataRow label="Pendiente" value={formatMoney(detail.remaining)} />
            </div>
          </AdminDrawerSection>
        </>
      );
    }

    return null;
  })();

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <style jsx global>{`
        @media (prefers-reduced-motion: no-preference) {
          .account-success-card {
            animation: accountSuccessCardIn 280ms cubic-bezier(0.22, 1, 0.36, 1);
          }
          .account-success-glow-soft,
          .account-success-glow-bold {
            position: relative;
            overflow: hidden;
          }
          .account-success-glow-soft::before,
          .account-success-glow-bold::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: inherit;
            transform: translateX(-130%);
            pointer-events: none;
          }
          .account-success-glow-soft::after,
          .account-success-glow-bold::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
          }
          .account-success-glow-soft::before {
            background: linear-gradient(
              110deg,
              transparent 18%,
              rgba(52, 211, 153, 0.12) 35%,
              rgba(110, 231, 183, 0.2) 50%,
              rgba(52, 211, 153, 0.12) 65%,
              transparent 82%
            );
            animation: accountSuccessSweep 1200ms ease-out 130ms 1 both;
          }
          .account-success-glow-soft::after {
            box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.22);
            animation: accountSuccessHalo 900ms ease-out 120ms 1 both;
          }
          .account-success-glow-bold::before {
            background: linear-gradient(
              110deg,
              transparent 12%,
              rgba(16, 185, 129, 0.16) 30%,
              rgba(110, 231, 183, 0.3) 50%,
              rgba(16, 185, 129, 0.16) 70%,
              transparent 88%
            );
            animation: accountSuccessSweepBold 1350ms cubic-bezier(0.22, 1, 0.36, 1) 100ms 1 both;
          }
          .account-success-glow-bold::after {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.28);
            animation: accountSuccessHaloBold 1050ms ease-out 90ms 1 both;
          }
          .account-success-icon {
            animation: accountSuccessIconPop 360ms cubic-bezier(0.22, 1, 0.36, 1) 90ms both;
          }
          .account-success-icon-soft {
            animation-duration: 360ms;
          }
          .account-success-icon-bold {
            animation: accountSuccessIconPopBold 460ms cubic-bezier(0.22, 1, 0.36, 1) 70ms both;
          }
          .account-success-title {
            animation: accountSuccessContentIn 320ms cubic-bezier(0.22, 1, 0.36, 1) 140ms both;
          }
          .account-success-detail {
            animation: accountSuccessContentIn 320ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both;
          }
          @keyframes accountSuccessCardIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes accountSuccessSweep {
            0% {
              transform: translateX(-130%);
              opacity: 0;
            }
            20% {
              opacity: 1;
            }
            100% {
              transform: translateX(130%);
              opacity: 0;
            }
          }
          @keyframes accountSuccessSweepBold {
            0% {
              transform: translateX(-140%);
              opacity: 0;
            }
            18% {
              opacity: 1;
            }
            100% {
              transform: translateX(140%);
              opacity: 0;
            }
          }
          @keyframes accountSuccessHalo {
            0% {
              box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.22);
            }
            60% {
              box-shadow: 0 0 0 9px rgba(52, 211, 153, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
            }
          }
          @keyframes accountSuccessHaloBold {
            0% {
              box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.3);
            }
            55% {
              box-shadow: 0 0 0 13px rgba(16, 185, 129, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
            }
          }
          @keyframes accountSuccessIconPop {
            0% {
              transform: scale(0.85);
              opacity: 0;
            }
            55% {
              transform: scale(1.06);
              opacity: 1;
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes accountSuccessIconPopBold {
            0% {
              transform: scale(0.74);
              opacity: 0;
            }
            52% {
              transform: scale(1.12);
              opacity: 1;
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes accountSuccessContentIn {
            from {
              opacity: 0;
              transform: translateY(4px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        }
      `}</style>
      <AdminDrawer
        open={open}
        onClose={handleClose}
        title={drawerTitle}
        subtitle={drawerSubtitle}
        statusChip={statusChip}
        statusChipClassName={statusChipClassName}
        size="md"
        footer={footer}
      >
        {body ?? <></>}
      </AdminDrawer>
    </>
  );
}
