import { Check, CreditCard, Receipt } from 'lucide-react';
import { formatMoney } from '../../../../modules/cuentas/accountUtils';

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

/**
 * Cuánto debe la reserva, de un vistazo, y el botón para cobrarlo.
 * Lo que se mira primero es la deuda; el detalle (total, pagado, cancha, consumos) va abajo en chico.
 */
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
  className = '',
}: BookingAccountSummarySectionProps) {
  const isPaid = !isPending && remainingAmount <= 0.009 && totalAmount > 0;
  const detail = [
    `Total ${formatMoney(totalAmount)}`,
    paidAmount > 0.009 ? `pagado ${formatMoney(paidAmount)}` : null,
    consumptionsAmount > 0.009
      ? `cancha ${formatMoney(courtAmount)} + consumos ${formatMoney(consumptionsAmount)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className={className}>
      {title ? <p className="text-[13px] font-semibold text-p-text-muted">{title}</p> : null}
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {isPending ? (
            <p className="text-[24px] font-bold leading-tight text-p-text-muted">—</p>
          ) : isPaid ? (
            <p className="inline-flex items-center gap-1.5 text-[24px] font-bold leading-tight text-p-positive">
              <Check size={22} strokeWidth={3} />
              Pagada
            </p>
          ) : (
            <p className="text-[24px] font-bold leading-tight tabular-nums text-p-text">
              Debe {formatMoney(remainingAmount)}
            </p>
          )}
          {!isPending && <p className="mt-0.5 text-[12px] tabular-nums text-p-text-muted">{detail}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isPaid && (
          <button
            type="button"
            onClick={onOpenPayment}
            disabled={disablePayment}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-5 text-[14px] font-semibold text-ink-50 hover:bg-ink-800 disabled:opacity-50 sm:flex-none"
          >
            <CreditCard size={15} />
            {isPending ? 'Cobrar' : `Cobrar ${formatMoney(remainingAmount)}`}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenOverview}
          disabled={disableOverview}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[14px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
        >
          <Receipt size={15} />
          Ver cuenta
        </button>
      </div>
      {helperMessage ? <p className="mt-2 text-[12px] text-p-text-muted">{helperMessage}</p> : null}
    </section>
  );
}
