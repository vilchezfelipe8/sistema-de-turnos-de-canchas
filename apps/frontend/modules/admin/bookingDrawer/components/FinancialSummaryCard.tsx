import type { ChargeMode, FinancialSummary } from '../types';

type Props = {
  summary: FinancialSummary;
  chargeMode: ChargeMode;
  chargeResponsibleName?: string;
  warnings?: string[];
  onRegisterPayment?: () => void;
  onCollectRemaining?: () => void;
};

export default function FinancialSummaryCard({
  summary,
  chargeMode,
  chargeResponsibleName,
  warnings = [],
  onRegisterPayment,
  onCollectRemaining,
}: Props) {
  const paymentStatusLabel =
    summary.paymentStatus === 'PAID'
      ? 'Pagada'
      : summary.paymentStatus === 'PARTIAL'
        ? 'Parcial'
        : 'Sin pago';

  const paymentStatusTone =
    summary.paymentStatus === 'PAID'
      ? 'bg-p-positive-bg text-p-positive'
      : summary.paymentStatus === 'PARTIAL'
        ? 'bg-p-warning-bg text-p-warning'
        : 'bg-p-surface-3 text-p-text-secondary';

  return (
    <div className="rounded-xl border border-p-border bg-p-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-p-text">Resumen de cobro</p>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-p-surface border border-p-border px-2 py-0.5 text-[11px] text-p-text-secondary">
            {chargeMode === 'INDIVIDUAL' ? 'Individual' : 'Compartida'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${paymentStatusTone}`}>
            {paymentStatusLabel}
          </span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div className="rounded-lg bg-p-surface border border-p-border px-2 py-1.5">
          <p className="text-p-text-muted">Total</p>
          <p className="font-semibold text-p-text">{summary.totalAmount.toFixed(2)} $</p>
        </div>
        <div className="rounded-lg bg-p-surface border border-p-border px-2 py-1.5">
          <p className="text-p-text-muted">Pagado</p>
          <p className="font-semibold text-p-positive">{summary.paidAmount.toFixed(2)} $</p>
        </div>
        <div className="rounded-lg bg-p-surface border border-p-border px-2 py-1.5">
          <p className="text-p-text-muted">Restante</p>
          <p className="font-semibold text-p-warning">{summary.remainingAmount.toFixed(2)} $</p>
        </div>
      </div>
      {chargeMode === 'INDIVIDUAL' && (
        <p className="mt-2 text-[12px] text-p-text-secondary">
          Responsable del cobro: <strong>{chargeResponsibleName || '-'}</strong>
        </p>
      )}
      {warnings.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--error-fg)]">
          Hay {warnings.length} advertencia{warnings.length === 1 ? '' : 's'} de consistencia para revisar.
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onRegisterPayment && (
          <button
            type="button"
            onClick={onRegisterPayment}
            className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-accent"
          >
            Registrar pago
          </button>
        )}
        {onCollectRemaining && summary.remainingAmount > 0.009 && (
          <button
            type="button"
            onClick={onCollectRemaining}
            className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50"
          >
            Agregar saldo
          </button>
        )}
      </div>
    </div>
  );
}
