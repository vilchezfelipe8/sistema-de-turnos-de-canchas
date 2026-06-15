import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MovementsTimelineItemType = 'income' | 'expense' | 'adjustment' | 'neutral';

export type MovementsTimelineItem = {
  id: string | number;
  /** Timestamp or date string used to derive display time. */
  timestamp?: string | null;
  /** Pre-formatted time string to display (overrides timestamp). */
  timeLabel?: string;
  /** Primary label, e.g. "Juan Pérez · Efectivo" */
  label: string;
  /** Secondary detail, e.g. "Reserva Cancha 1 · 19:00" */
  sublabel?: string;
  /** Numeric amount (always positive; sign is derived from `type`). */
  amount: number;
  /** Controls amount color. 'income' = green, 'expense' = red, 'adjustment'/'neutral' = muted. */
  type: MovementsTimelineItemType;
  /** Optional right-side badge (e.g. método de pago). */
  badge?: ReactNode;
};

type MovementsTimelineProps = {
  items: MovementsTimelineItem[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (amount: number) =>
  `$${Number(amount || 0).toLocaleString('es-AR')}`;

const formatTimestamp = (ts: string): string => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const amountColorClass: Record<MovementsTimelineItemType, string> = {
  income: 'text-p-positive',
  expense: 'text-p-error',
  adjustment: 'text-p-warning',
  neutral: 'text-p-text-secondary',
};

const amountPrefix: Record<MovementsTimelineItemType, string> = {
  income: '+',
  expense: '−',
  adjustment: '±',
  neutral: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MovementsTimeline — lista cronológica de movimientos financieros.
 *
 * Usar en:
 *   - Caja → Movimientos
 *   - Clientes → Perfil (cuenta corriente)
 *   - Cualquier vista de actividad financiera ordenada por tiempo
 *
 * @example
 * <MovementsTimeline
 *   items={[
 *     { id: 1, timeLabel: '10:32', label: 'Juan Pérez · Efectivo', sublabel: 'Reserva Cancha 1', amount: 3000, type: 'income' },
 *     { id: 2, timeLabel: '09:45', label: 'Ajuste manual', amount: 500, type: 'adjustment' },
 *   ]}
 * />
 */
export default function MovementsTimeline({
  items,
  loading = false,
  emptyTitle = 'Sin movimientos',
  emptyDescription,
  className,
}: MovementsTimelineProps) {
  if (loading) {
    return (
      <div className={['space-y-3', className].filter(Boolean).join(' ')}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="mt-0.5 h-4 w-10 animate-pulse rounded bg-p-surface-2" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/2 animate-pulse rounded bg-p-surface-2" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-p-surface-2" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-p-surface-2" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={[
          'grid min-h-[120px] place-items-center rounded-xl border border-dashed border-p-border bg-p-surface-2 px-4 py-6 text-center',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div>
          <p className="text-[14px] font-semibold text-p-text-muted">{emptyTitle}</p>
          {emptyDescription && (
            <p className="mt-1 text-[12px] text-p-text-muted">{emptyDescription}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={['divide-y divide-p-border', className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const timeStr =
          item.timeLabel ??
          (item.timestamp ? formatTimestamp(item.timestamp) : null);

        return (
          <div key={item.id} className="flex items-start gap-3 py-3">
            {/* Timestamp */}
            <span className="w-10 shrink-0 pt-px font-mono text-[11px] text-p-text-muted">
              {timeStr ?? '—'}
            </span>

            {/* Labels */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-p-text">
                {item.label}
              </p>
              {item.sublabel && (
                <p className="mt-0.5 truncate text-[11px] text-p-text-muted">
                  {item.sublabel}
                </p>
              )}
            </div>

            {/* Badge (opcional) */}
            {item.badge && (
              <div className="shrink-0">{item.badge}</div>
            )}

            {/* Amount */}
            <span
              className={[
                'shrink-0 text-[13px] font-semibold tabular-nums',
                amountColorClass[item.type],
              ].join(' ')}
            >
              {amountPrefix[item.type]}
              {formatMoney(item.amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
