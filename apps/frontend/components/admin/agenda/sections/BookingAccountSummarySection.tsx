import { CreditCard, Receipt } from 'lucide-react';

type BookingAccountSummarySectionProps = {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  courtAmount: number;
  consumptionsAmount: number;
  isPending: boolean;
  onOpenOverview: () => void;
  onOpenPayment: () => void;
  disableOverview?: boolean;
  disablePayment?: boolean;
  helperMessage?: string | null;
  title?: string;
  statusLabel?: string | null;
  showStatusBadge?: boolean;
  showActionIcons?: boolean;
  className?: string;
};

function resolveStatusBadgeClasses(statusLabel: string | null | undefined): string {
  if (statusLabel === 'Pagado') return 'bg-p-positive-bg text-p-positive';
  if (statusLabel === 'Parcial') return 'bg-p-warning-bg text-p-warning';
  return 'bg-p-surface-3 text-p-text-secondary';
}

export default function BookingAccountSummarySection({
  totalAmount,
  paidAmount,
  remainingAmount,
  courtAmount,
  consumptionsAmount,
  isPending,
  onOpenOverview,
  onOpenPayment,
  disableOverview = false,
  disablePayment = false,
  helperMessage,
  title,
  statusLabel,
  showStatusBadge = false,
  showActionIcons = false,
  className = '',
}: BookingAccountSummarySectionProps) {
  return (
    <section className={`rounded-xl border border-p-border bg-p-surface-2 p-4 ${className}`.trim()}>
      {title ? (
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-semibold text-p-text">{title}</p>
          {showStatusBadge && statusLabel ? (
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${resolveStatusBadgeClasses(
                statusLabel
              )}`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={`${title ? 'mt-2' : ''} grid grid-cols-3 gap-2 text-[12px] text-p-text-muted`}>
        <div className="rounded-lg bg-p-surface px-2 py-1.5">
          <p>Total</p>
          <p className="text-[15px] font-semibold text-p-text">
            {isPending ? '--' : `${totalAmount.toFixed(2)} $`}
          </p>
        </div>
        <div className="rounded-lg bg-p-surface px-2 py-1.5">
          <p>Pagado</p>
          <p className="text-[15px] font-semibold text-p-positive">
            {isPending ? '--' : `${paidAmount.toFixed(2)} $`}
          </p>
        </div>
        <div className="rounded-lg bg-p-surface px-2 py-1.5">
          <p>Deuda</p>
          <p className="text-[15px] font-semibold text-p-warning">
            {isPending ? '--' : `${remainingAmount.toFixed(2)} $`}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-p-text-muted">
        Cancha: {courtAmount.toFixed(2)} $ · Consumos: {consumptionsAmount.toFixed(2)} $
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenOverview}
          disabled={disableOverview}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[14px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
        >
          {showActionIcons ? <Receipt size={14} /> : null}
          Ver cuenta
        </button>
        <button
          type="button"
          onClick={onOpenPayment}
          disabled={disablePayment}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-[14px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
        >
          {showActionIcons ? <CreditCard size={14} /> : null}
          Cobrar
        </button>
        {helperMessage ? <p className="text-[12px] text-p-text-muted">{helperMessage}</p> : null}
      </div>
    </section>
  );
}
