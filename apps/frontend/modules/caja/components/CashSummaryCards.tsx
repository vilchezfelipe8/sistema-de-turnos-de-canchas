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
}: CashSummaryCardsProps) {
  return (
    <div
      className={[
        'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <MetricCard
        label="Saldo Total"
        value={balance.total}
        format="money"
        loading={loading}
      />
      <MetricCard
        label="Ingresos"
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
        label="Caja Efectivo"
        value={balance.cash}
        format="money"
        loading={loading}
      />
      <MetricCard
        label="Caja Digital"
        value={balance.digital}
        format="money"
        loading={loading}
      />
    </div>
  );
}
