import MovementsTimeline, {
  type MovementsTimelineItem,
} from '../../../components/admin/ui/MovementsTimeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashMovement = {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
};

type CashMovementsTimelineProps = {
  movements: CashMovement[];
  loading?: boolean;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const methodLabel = (method: CashMovement['method']): string => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
};

const methodBadgeClasses: Record<CashMovement['method'], string> = {
  CASH: 'border-p-positive bg-p-positive-bg text-p-positive',
  TRANSFER: 'border-p-info bg-p-info-bg text-p-info',
  CARD: 'border-p-warning bg-p-warning-bg text-p-warning',
};

const toTimelineItems = (movements: CashMovement[]): MovementsTimelineItem[] =>
  movements.map((m) => ({
    id: m.id,
    timestamp: m.date,
    label: m.description,
    sublabel: methodLabel(m.method),
    amount: m.amount,
    type: m.type === 'INCOME' ? 'income' : 'expense',
    badge: (
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${methodBadgeClasses[m.method]}`}
      >
        {methodLabel(m.method)}
      </span>
    ),
  }));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashMovementsTimeline — timeline de movimientos de caja.
 *
 * Reemplaza la tabla plana de movimientos por una lista cronológica
 * con color-coding de tipo (ingreso/egreso) y badge de método de pago.
 */
export default function CashMovementsTimeline({
  movements,
  loading = false,
  className,
}: CashMovementsTimelineProps) {
  return (
    <MovementsTimeline
      items={toTimelineItems(movements)}
      loading={loading}
      emptyTitle="Sin movimientos"
      emptyDescription="No hay movimientos para el período o filtros seleccionados."
      className={className}
    />
  );
}
