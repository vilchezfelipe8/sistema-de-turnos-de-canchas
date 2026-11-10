import MetricCard from '../../../components/admin/ui/MetricCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashBalance = {
  total: number;
  cash: number;
  digital: number;
  income: number;
  expense: number;
};

type CashSummaryCardsProps = {
  balance: CashBalance;
  loading?: boolean;
  className?: string;
  /** Si no hubo movimientos, una frase en vez de cuatro tarjetas en $0. */
  emptyText?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashSummaryCards — fila de 5 MetricCards para la vista Resumen de Caja.
 *
 * Muestra Saldo Total, Ingresos, Egresos, Caja Efectivo y Caja Digital.
 * Ingresos y Egresos usan valueColor para reflejar su naturaleza financiera.
 */
export default function CashSummaryCards({
  balance,
  loading = false,
  className,
  emptyText,
}: CashSummaryCardsProps) {
  const isEmpty =
    !loading &&
    Math.abs(balance.income) < 0.01 &&
    Math.abs(balance.expense) < 0.01 &&
    Math.abs(balance.cash) < 0.01 &&
    Math.abs(balance.digital) < 0.01;
  if (isEmpty && emptyText) {
    return (
      <p
        className={['rounded-2xl border border-dashed border-p-border px-4 py-4 text-center text-[13px] text-p-text-muted', className]
          .filter(Boolean)
          .join(' ')}
      >
        {emptyText}
      </p>
    );
  }
  return (
    <div
      className={[
        'grid grid-cols-2 gap-3 md:grid-cols-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <MetricCard
        label="Cobrado"
        value={balance.income}
        format="money"
        loading={loading}
        valueColor="var(--positive-fg)"
      />
      <MetricCard
        label="Egresos"
        value={balance.expense}
        format="money"
        loading={loading}
        valueColor="var(--error-fg)"
      />
      <MetricCard
        label="En efectivo"
        value={balance.cash}
        format="money"
        loading={loading}
      />
      <MetricCard
        label="Digital"
        value={balance.digital}
        format="money"
        loading={loading}
      />
    </div>
  );
}
