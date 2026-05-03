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
import { ArrowLeft, Check, X, AlertTriangle, Plus, Minus, CreditCard, Banknote, ArrowRightLeft } from 'lucide-react';
import AdminDrawer, { AdminDrawerSection } from '../../../components/admin/ui/AdminDrawer';
import { getAccountById, addAccountItem, registerPayment, closeAccount } from '../../../services/AccountService';
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
    <span className="text-[13px] text-[#6f7890]">{label}</span>
    <span className={`text-right text-[13px] font-medium text-[#1a2035] ${valueClassName}`}>
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
    default: 'bg-[#f8f9fc] text-[#1a2035]',
    debt: 'bg-[#fff3f0] text-[#b42318]',
    paid: 'bg-[#f0faf4] text-[#1a7a4a]',
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

const sectionCardClass = 'rounded-2xl border border-[#dce2ee] bg-[#f8f9fd] p-4';
const sectionListClass = 'divide-y divide-[#edf0f6] overflow-hidden rounded-xl border border-[#dce2ee] bg-white';

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
  const goToOverview = useCallback(() => {
    setView('overview');
    setActionError('');
    setPayError('');
  }, []);

  // ── Payment derived state ─────────────────────────────────────────────────
  const pendingRows = useMemo(() => buildPendingItemRows(detail), [detail]);
  const accountMaxAmount = Number(detail?.remaining || 0);
  const hasCourtItems = pendingRows.some((r) => r.type === 'BOOKING');

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

  // ── Close handler — guarda contra cierre accidental durante submit ─────────
  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isOpen = detail?.status === 'OPEN';
  const hasPendingDebt = Number(detail?.remaining || 0) > ACCOUNT_PAYMENT_EPSILON;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Title & status ─────────────────────────────────────────────────────────
  const contextTitle = String(context?.title || '').trim();
  const contextSubtitle = String(context?.subtitle || '').trim();
  const accountTitle = contextTitle || `Cuenta ${detail ? `#${shortCode(detail.id)}` : ''}`;
  const drawerSubtitle =
    detail && contextSubtitle
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
      ? 'bg-[#f0f2f7] text-[#6f7890]'
      : hasPendingDebt
      ? 'bg-[#fff3f0] text-[#b42318]'
      : 'bg-[#f0faf4] text-[#1a7a4a]';

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
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#3053e2] transition hover:bg-[#f4f6fb]"
            >
              <Plus size={14} />
              Concepto
            </button>
          )}
          {isOpen && hasPendingDebt && (
            <button
              type="button"
              onClick={openPaymentFlow}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
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
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb]"
            >
              <Minus size={14} />
              Devolución
            </button>
          )}
          {isOpen && !hasPendingDebt && (
            <button
              type="button"
              onClick={() => { setActionError(''); setView('close_confirm'); }}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-4 text-[13px] font-semibold text-[#b42318] transition hover:bg-[#b42318] hover:text-white"
            >
              Cerrar cuenta
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
            className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="submit"
            form="add-item-form"
            disabled={submitting}
            className="h-10 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-40"
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
            className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!amountIsValid || submitting}
            onClick={() => setView('payment_preconfirm')}
            className="h-10 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-40"
          >
            Continuar →
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
            className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Volver
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={submitting}
            onClick={submitPayment}
            className="h-10 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-40"
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
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb]"
            >
              <ArrowLeft size={14} />
              Reintentar
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={goToOverview}
            className="h-10 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
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
            className="flex h-10 items-center gap-1.5 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb] disabled:opacity-40"
          >
            <ArrowLeft size={14} />
            Cancelar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={submitting}
            onClick={submitCloseAccount}
            className="h-10 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-5 text-[13px] font-semibold text-[#b42318] transition hover:bg-[#b42318] hover:text-white disabled:opacity-40"
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
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#98a1b3]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#dce2ee] border-t-[#3053e2]" />
          <p className="text-[13px]">Cargando cuenta...</p>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] p-6 text-center">
          <AlertTriangle size={20} className="text-[#b42318]" />
          <p className="text-[13px] text-[#b42318]">{loadError}</p>
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
            className="text-[12px] font-medium text-[#3053e2] underline underline-offset-2"
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
            <div className="flex items-start gap-2 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#b42318]" />
              <p className="text-[13px] text-[#b42318]">{actionError}</p>
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

          {/* Conceptos */}
          {detail.items.length > 0 && (
            <AdminDrawerSection title="Conceptos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {detail.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#1a2035]">
                        {item.type === 'BOOKING' ? 'Cancha' : item.description}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#98a1b3]">
                        {itemTypeLabel(item.type)}
                        {item.quantity > 1 && ` · ×${item.quantity}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-[#1a2035]">
                      {formatMoney(item.total)}
                    </span>
                  </div>
                ))}
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
                      <p className="text-[13px] font-medium text-[#1a2035]">
                        {paymentMethodLabel(payment.method)}
                        {payment.channel &&
                          payment.method === 'TRANSFER' && (
                            <span className="ml-1 text-[11px] font-normal text-[#98a1b3]">
                              · {paymentChannelLabel(payment.channel)}
                            </span>
                          )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#98a1b3]">
                        {formatRelativeDate(payment.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-[#1a7a4a]">
                      {formatMoney(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}

          {detail.items.length === 0 && detail.payments.length === 0 && (
            <p className="text-center text-[13px] text-[#98a1b3]">
              Esta cuenta no tiene conceptos ni pagos todavía.
            </p>
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
                <p className="text-[13px] text-[#b42318]">{actionError}</p>
              )}

              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#6f7890]">
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
                  className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#1a2035] focus:border-[#3053e2] focus:outline-none"
                >
                  <option value="PRODUCT">Producto</option>
                  <option value="SERVICE">Servicio</option>
                  <option value="ADJUSTMENT">Ajuste</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#6f7890]">
                  Descripción
                </label>
                <input
                  type="text"
                  value={itemForm.description}
                  onChange={(e) =>
                    setItemForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Ej: Empanadas ×3"
                  className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#1a2035] placeholder-[#c0c7d4] focus:border-[#3053e2] focus:outline-none"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[12px] font-medium text-[#6f7890]">
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
                    className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#1a2035] focus:border-[#3053e2] focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[12px] font-medium text-[#6f7890]">
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
                    className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#1a2035] placeholder-[#c0c7d4] focus:border-[#3053e2] focus:outline-none"
                  />
                </div>
              </div>

              {itemForm.description && itemForm.unitPrice && (
                <div className="rounded-xl border border-[#dce2ee] bg-white">
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
        <>
          {payError && (
            <div className="flex items-start gap-2 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#b42318]" />
              <p className="text-[13px] text-[#b42318]">{payError}</p>
            </div>
          )}

          {/* Quick presets */}
          <AdminDrawerSection title="Cobrar" className={sectionCardClass}>
            <div className="flex gap-2">
              {(
                [
                  { id: 'FULL', label: 'Todo pendiente' },
                  ...(hasCourtItems ? [{ id: 'COURT_ONLY', label: 'Solo cancha' }] : []),
                  { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
                ] as Array<{ id: PaymentQuickPreset; label: string }>
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={[
                    'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
                    payPreset === id
                      ? 'border-[#3053e2] bg-[#3053e2] text-white'
                      : 'border-[#dce2ee] bg-white text-[#6f7890] hover:border-[#3053e2] hover:text-[#3053e2]',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </AdminDrawerSection>

          {/* Custom item checkboxes */}
          {payPreset === 'CUSTOM_ITEMS' && pendingRows.length > 0 && (
            <AdminDrawerSection title="Conceptos" className={sectionCardClass}>
              <div className={sectionListClass}>
                {pendingRows.map((row) => {
                  const checked = paySelectedIds.includes(row.id);
                  return (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...paySelectedIds, row.id]
                            : paySelectedIds.filter((id) => id !== row.id);
                          setPaySelectedIds(next);
                          setPayAmountDraft(
                            String(
                              computeConceptBasedMaxAmount(
                                'CUSTOM_ITEMS',
                                pendingRows,
                                accountMaxAmount,
                                next,
                                payCustomAmountById
                              ).toFixed(2)
                            )
                          );
                        }}
                        className="h-4 w-4 rounded border-[#dce2ee] text-[#3053e2] accent-[#3053e2]"
                      />
                      <span className="flex-1 text-[13px] text-[#1a2035]">{row.label}</span>
                      {checked && (
                        <input
                          type="number"
                          min="0"
                          max={row.remainingAmount}
                          step="0.01"
                          value={
                            payCustomAmountById[row.id] !== undefined
                              ? payCustomAmountById[row.id]
                              : row.remainingAmount.toFixed(2)
                          }
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = { ...payCustomAmountById, [row.id]: e.target.value };
                            setPayCustomAmountById(next);
                            setPayAmountDraft(
                              String(
                                computeConceptBasedMaxAmount(
                                  'CUSTOM_ITEMS',
                                  pendingRows,
                                  accountMaxAmount,
                                  paySelectedIds,
                                  next
                                ).toFixed(2)
                              )
                            );
                          }}
                          className="h-8 w-24 rounded-lg border border-[#dce2ee] bg-[#f8f9fc] px-2 text-right text-[12px] text-[#1a2035] focus:border-[#3053e2] focus:outline-none"
                        />
                      )}
                      {!checked && (
                        <span className="text-[12px] text-[#98a1b3]">
                          {formatMoney(row.remainingAmount)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </AdminDrawerSection>
          )}

          {/* Amount */}
          <AdminDrawerSection title="Monto a cobrar" className={sectionCardClass}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-medium text-[#98a1b3]">
                $
              </span>
              <input
                type="number"
                min="0"
                max={maxAllowed}
                step="0.01"
                value={payAmountDraft}
                onChange={(e) => setPayAmountDraft(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#dce2ee] bg-white pl-7 pr-4 text-[16px] font-semibold text-[#1a2035] focus:border-[#3053e2] focus:outline-none"
              />
            </div>
            <p className="text-[12px] text-[#98a1b3]">
              Máximo: {formatMoney(maxAllowed)}
            </p>
          </AdminDrawerSection>

          {/* Method */}
          <AdminDrawerSection title="Método de cobro" className={sectionCardClass}>
            <div className="flex gap-2">
              {(
                [
                  { value: 'CASH', label: 'Efectivo', Icon: Banknote },
                  { value: 'TRANSFER', label: 'Transferencia', Icon: ArrowRightLeft },
                  { value: 'CARD', label: 'Tarjeta', Icon: CreditCard },
                ] as Array<{ value: PaymentMethod; label: string; Icon: React.FC<any> }>
              ).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPayMethod(value)}
                  className={[
                    'flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[12px] font-medium transition',
                    payMethod === value
                      ? 'border-[#3053e2] bg-[#f0f4ff] text-[#3053e2]'
                      : 'border-[#dce2ee] bg-white text-[#6f7890] hover:border-[#b0bcda]',
                  ].join(' ')}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>

            {payMethod === 'TRANSFER' && (
              <div className="mt-2 flex gap-2">
                {(
                  [
                    { value: 'BANK_ACCOUNT', label: 'Cuenta bancaria' },
                    { value: 'VIRTUAL_WALLET', label: 'Billetera virtual' },
                  ] as Array<{ value: typeof payChannel; label: string }>
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPayChannel(value)}
                    className={[
                      'flex-1 rounded-xl border px-3 py-2 text-[12px] font-medium transition',
                      payChannel === value
                        ? 'border-[#3053e2] bg-[#f0f4ff] text-[#3053e2]'
                        : 'border-[#dce2ee] bg-white text-[#6f7890] hover:border-[#b0bcda]',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </AdminDrawerSection>
        </>
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
                valueClassName="font-bold text-[#1a2035]"
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
                    <span className="text-[13px] text-[#1a2035]">{row.label}</span>
                    <span className="text-[13px] font-semibold text-[#1a2035]">
                      {formatMoney(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}

          <div className="rounded-xl border border-[#fff1c4] bg-[#fffbeb] px-4 py-3">
            <p className="text-[13px] text-[#7a5a00]">
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
                ? 'bg-[#f0faf4] text-[#1a7a4a]'
                : 'bg-[#fff5f5] text-[#b42318]',
            ].join(' ')}
          >
            <div
              className={[
                'grid h-12 w-12 place-items-center rounded-full',
                isSuccess ? 'bg-[#1a7a4a]' : 'bg-[#b42318]',
              ].join(' ')}
            >
              {isSuccess ? (
                <Check size={24} className="text-white" />
              ) : (
                <X size={24} className="text-white" />
              )}
            </div>
            <p className="text-[18px] font-bold">{payResult.title}</p>
            <p className="text-[13px] opacity-80">{payResult.detail}</p>
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
                    <span className="text-[13px] text-[#1a2035]">{item.label}</span>
                    <span className="text-[13px] font-semibold text-[#1a7a4a]">
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
            <div className="flex items-start gap-2 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#b42318]" />
              <p className="text-[13px] text-[#b42318]">{actionError}</p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-[#fff1c4] bg-[#fffbeb] px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#9a5a00]" />
              <p className="text-[13px] text-[#7a5a00]">
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
  );
}
