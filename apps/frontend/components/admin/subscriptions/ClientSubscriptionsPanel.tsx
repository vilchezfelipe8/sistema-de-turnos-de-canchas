import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminModal from '../ui/AdminModal';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import AccountDrawer from '../../../modules/cuentas/components/AccountDrawer';
import { formatMoney } from '../../../modules/cuentas/accountUtils';
import {
  SUBSCRIPTION_STATUS_LABELS,
  SubscriptionAdminService,
  type ClientSubscription,
  type SubscriptionInstallment,
  type SubscriptionPlan,
} from '../../../services/SubscriptionAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type ClientSubscriptionsPanelProps = {
  clubSlug: string;
  clientId: string;
  clientName: string;
  // Solo ADMIN cancela planes. Vender y cobrar puede también STAFF.
  canManage: boolean;
  onChanged?: () => void;
};

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';
const buttonClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center rounded-lg bg-ink-900 px-4 text-[12px] font-semibold !text-ink-50 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

const formatDay = (key: string | null) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '—');
const formatShortDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  PAUSED: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  PAST_DUE: 'bg-red-500/10 text-red-700 dark:text-red-300',
  EXPIRED: 'bg-p-surface-2 text-p-text-muted',
  CANCELLED: 'bg-p-surface-2 text-p-text-muted',
};

const installmentLabel = (row: SubscriptionInstallment, periodCount: number) => {
  if (row.kind === 'ENROLLMENT_FEE') return 'Matrícula';
  const range = `${formatShortDay(row.coversFrom)} al ${formatShortDay(row.coversTo)}`;
  return periodCount > 1 ? `Cuota ${row.sequence} · ${range}` : range;
};

const installmentState = (row: SubscriptionInstallment) => {
  if (row.status === 'PAID') return { label: 'Pagada', className: 'text-emerald-700 dark:text-emerald-300' };
  if (row.status === 'VOID') return { label: 'Anulada', className: 'text-p-text-muted' };
  if (row.isOverdue) return { label: 'Vencida', className: 'text-red-700 dark:text-red-300' };
  if (row.account && row.account.paidAmount > 0) return { label: 'Pago parcial', className: 'text-amber-700 dark:text-amber-300' };
  return { label: `Vence ${formatShortDay(row.dueDate)}`, className: 'text-p-text-secondary' };
};

export default function ClientSubscriptionsPanel({ clubSlug, clientId, clientName, canManage, onChanged }: ClientSubscriptionsPanelProps) {
  const [rows, setRows] = useState<ClientSubscription[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sellOpen, setSellOpen] = useState(false);
  const [sellPlanId, setSellPlanId] = useState('');
  const [sellOptionId, setSellOptionId] = useState('');
  const [sellStartDate, setSellStartDate] = useState('');
  const [cancelTarget, setCancelTarget] = useState<ClientSubscription | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    if (!clubSlug || !clientId) return;
    setLoading(true);
    try {
      const [subscriptionRows, planRows] = await Promise.all([
        SubscriptionAdminService.listByClient(clubSlug, clientId),
        SubscriptionAdminService.listPlans(clubSlug),
      ]);
      setRows(subscriptionRows);
      setPlans(planRows);
      setError('');
    } catch (err) {
      reportUiError({ area: 'ClientSubscriptionsPanel', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar los planes.'));
    } finally {
      setLoading(false);
    }
  }, [clientId, clubSlug]);

  useEffect(() => {
    setShowClosed(false);
    void load();
  }, [load]);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === sellPlanId) || null, [plans, sellPlanId]);
  const sellOptions = useMemo(() => (selectedPlan?.options || []).filter((option) => option.isActive), [selectedPlan]);
  const selectedOption = useMemo(() => sellOptions.find((option) => option.id === sellOptionId) || null, [sellOptions, sellOptionId]);

  const visibleRows = useMemo(
    () => rows.filter((row) => showClosed || (row.status !== 'CANCELLED' && row.status !== 'EXPIRED')),
    [rows, showClosed]
  );
  const hiddenCount = rows.length - visibleRows.length;

  const openSell = () => {
    const firstPlan = plans[0];
    setSellPlanId(firstPlan?.id || '');
    setSellOptionId(firstPlan?.options.find((option) => option.isActive)?.id || '');
    setSellStartDate('');
    setSellOpen(true);
  };

  const handleSell = async () => {
    if (!selectedPlan || !selectedOption) return;
    try {
      setSubmitting(true);
      setError('');
      const created = await SubscriptionAdminService.sell(clubSlug, {
        clientId,
        planId: selectedPlan.id,
        optionId: selectedOption.id,
        startDate: sellStartDate || null,
      });
      setSellOpen(false);
      showAdminToast('Plan vendido. Ya podés cobrar la primera cuota.');
      await load();
      onChanged?.();
      const first = created.installments.find((row) => row.status === 'PENDING' && row.account);
      if (first?.account) {
        setDrawerTitle(`${created.planName} · ${installmentLabel(first, created.installments.filter((r) => r.kind === 'PERIOD').length)}`);
        setDrawerAccountId(first.account.id);
      }
    } catch (err) {
      reportUiError({ area: 'ClientSubscriptionsPanel', action: 'sell' }, err);
      setError(extractErrorMessage(err, 'No se pudo vender el plan.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      setSubmitting(true);
      setError('');
      await SubscriptionAdminService.cancel(clubSlug, cancelTarget.id, cancelReason.trim() || null);
      setCancelTarget(null);
      setCancelReason('');
      showAdminToast('Plan cancelado.');
      await load();
      onChanged?.();
    } catch (err) {
      reportUiError({ area: 'ClientSubscriptionsPanel', action: 'cancel' }, err);
      setError(extractErrorMessage(err, 'No se pudo cancelar el plan.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !rows.length && !plans.length) {
    return <p className="text-[12px] text-p-text-muted">Cargando planes...</p>;
  }
  // Clubes sin planes configurados y cliente sin historial: no mostramos nada.
  if (!plans.length && !rows.length) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-p-text">Planes</p>
        <div className="flex items-center gap-3">
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2"
              onClick={() => setShowClosed((prev) => !prev)}
            >
              {showClosed ? 'Ocultar terminados' : `Ver terminados (${hiddenCount})`}
            </button>
          ) : null}
          {plans.length ? (
            <button
              type="button"
              className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2 disabled:opacity-50"
              disabled={submitting}
              onClick={openSell}
            >
              Vender plan
            </button>
          ) : null}
        </div>
      </div>
      <div className="space-y-3 text-[13px]">
        {error ? <AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner> : null}

        {visibleRows.length === 0 ? <p className="text-[13px] text-p-text-muted">No tiene planes activos.</p> : null}

        {visibleRows.map((row) => {
          const periodCount = row.installments.filter((inst) => inst.kind === 'PERIOD').length;
          const isPayer = row.payerClient.id === clientId && row.client.id !== clientId;
          return (
            <div key={row.id} className="space-y-2 rounded-lg border border-p-border p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-p-text">{row.planName}</p>
                  <p className="text-[12px] text-p-text-muted">
                    {row.optionLabel} · desde {formatDay(row.startDate)}
                    {row.endDate ? ` hasta ${formatDay(row.endDate)}` : ' · se renueva solo'}
                  </p>
                  {isPayer ? <p className="text-[12px] text-p-text-muted">Lo usa {row.client.name}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[row.status] || ''}`}>
                  {row.hasOverdue && row.status === 'ACTIVE' ? 'Cuota vencida' : SUBSCRIPTION_STATUS_LABELS[row.status]}
                </span>
              </div>

              <p className="text-[12px] text-p-text-secondary">
                Al día hasta: <strong className="text-p-text">{row.paidThrough ? formatDay(row.paidThrough) : 'sin cuotas pagas'}</strong>
                {row.pendingAmount > 0 ? <> · Debe {formatMoney(row.pendingAmount)}</> : null}
              </p>

              <ul className="divide-y divide-p-border border-t border-p-border">
                {row.installments.map((inst) => {
                  const state = installmentState(inst);
                  const canPay = inst.status === 'PENDING' && inst.account && inst.account.status === 'OPEN';
                  return (
                    <li key={inst.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                      <span className="min-w-0 truncate text-p-text">{installmentLabel(inst, periodCount)}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={`tabular-nums ${inst.status === 'VOID' ? 'text-p-text-muted line-through' : 'text-p-text'}`}>
                          {formatMoney(
                            inst.status === 'VOID' || !inst.account
                              ? inst.listAmount
                              : inst.status === 'PAID'
                                ? inst.account.paidAmount
                                : inst.account.remainingAmount
                          )}
                        </span>
                        <span className={state.className}>{state.label}</span>
                        {canPay ? (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => {
                              setDrawerTitle(`${row.planName} · ${installmentLabel(inst, periodCount)}`);
                              setDrawerAccountId(inst.account!.id);
                            }}
                          >
                            Cobrar
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {canManage && row.status !== 'CANCELLED' && row.status !== 'EXPIRED' ? (
                <div className="flex justify-end">
                  <button type="button" className={buttonClass} disabled={submitting} onClick={() => setCancelTarget(row)}>
                    Cancelar plan
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

      </div>

      <AdminModal
        open={sellOpen}
        title="Vender plan"
        description={`Para ${clientName}. Se generan las cuotas en su cuenta y se cobran como cualquier otra.`}
        onClose={() => setSellOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setSellOpen(false)}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} disabled={submitting || !selectedOption} onClick={() => void handleSell()}>
              {submitting ? 'Guardando...' : 'Vender'}
            </button>
          </div>
        }
      >
        <div className="grid gap-3">
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            Plan
            <select
              className={inputClass}
              value={sellPlanId}
              onChange={(event) => {
                const plan = plans.find((row) => row.id === event.target.value);
                setSellPlanId(event.target.value);
                setSellOptionId(plan?.options.find((option) => option.isActive)?.id || '');
              }}
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          {selectedPlan ? (
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-semibold text-p-text-secondary">Forma de pago</legend>
              {sellOptions.map((option) => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                    option.id === sellOptionId ? 'border-p-text-secondary bg-p-surface-2' : 'border-p-border'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="sell-option" checked={option.id === sellOptionId} onChange={() => setSellOptionId(option.id)} />
                    {option.label}
                  </span>
                  <span className="tabular-nums text-p-text">
                    {option.installmentsCount > 1
                      ? `${option.installmentsCount} × ${formatMoney(option.installmentPrice)}`
                      : formatMoney(option.installmentPrice)}
                  </span>
                </label>
              ))}
              {selectedPlan.enrollmentFee ? (
                <p className="text-[12px] text-p-text-muted">Más matrícula de {formatMoney(selectedPlan.enrollmentFee)}.</p>
              ) : null}
              <p className="text-[12px] text-p-text-muted">
                Precios de lista. El descuento por medio de pago (efectivo) se aplica al cobrar cada cuota.
              </p>
            </fieldset>
          ) : null}
          <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
            Fecha de inicio (vacío = hoy)
            <input type="date" className={inputClass} value={sellStartDate} onChange={(event) => setSellStartDate(event.target.value)} />
          </label>
        </div>
      </AdminModal>

      <AdminModal
        open={cancelTarget !== null}
        title="Cancelar plan"
        description="Se anulan las cuotas pendientes sin pagos. Lo ya cobrado no se devuelve solo: si corresponde, hacelo desde Devoluciones."
        onClose={() => setCancelTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setCancelTarget(null)}>
              Volver
            </button>
            <button type="button" className={primaryButtonClass} disabled={submitting} onClick={() => void handleCancel()}>
              Cancelar plan
            </button>
          </div>
        }
      >
        <label className="space-y-1 text-[12px] font-semibold text-p-text-secondary">
          Motivo (opcional)
          <input className={inputClass} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej: se mudó" />
        </label>
      </AdminModal>

      <AccountDrawer
        accountId={drawerAccountId}
        open={drawerAccountId !== null}
        initialView="payment"
        context={{ title: clientName, subtitle: drawerTitle }}
        onClose={() => setDrawerAccountId(null)}
        onSuccess={(event) => {
          if (event === 'payment') {
            showAdminToast('Cuota cobrada.');
            void load();
            onChanged?.();
          }
        }}
      />
    </div>
  );
}
