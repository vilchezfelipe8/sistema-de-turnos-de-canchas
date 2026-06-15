import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricCardFormat = 'money' | 'number' | 'percent';

export type MetricCardDelta = {
  /** Numeric change. Positive = green ▲, negative = red ▼. */
  value: number;
  /** Context label shown after the formatted delta, e.g. "vs mes anterior". */
  label?: string;
};

export type MetricCardProps = {
  label: string;
  value: number;
  format?: MetricCardFormat;
  delta?: MetricCardDelta;
  icon?: ReactNode;
  loading?: boolean;
  /** Override the value text color. Prefer semantic tokens, e.g. `var(--positive-fg)`. */
  valueColor?: string;
  /** Extra class for the root element, e.g. for custom widths. */
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatValue = (value: number, format: MetricCardFormat): string => {
  switch (format) {
    case 'money':
      return `$${Number(value || 0).toLocaleString('es-AR')}`;
    case 'percent':
      return `${Number(value || 0).toFixed(1)}%`;
    default:
      return String(Math.round(value || 0));
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MetricCard — KPI card para cabeceras de módulo e Informes.
 *
 * Usar con `MetricCardFormat`:
 *   - `'money'`   → $1.500
 *   - `'number'`  → 47
 *   - `'percent'` → 68.0%
 *
 * @example
 * <MetricCard label="Ingresos" value={184000} format="money" delta={{ value: 12400, label: "vs sem. ant." }} />
 */
export default function MetricCard({
  label,
  value,
  format = 'number',
  delta,
  icon,
  loading = false,
  valueColor,
  className,
}: MetricCardProps) {
  const isPositive = delta ? delta.value >= 0 : null;

  return (
    <div
      className={[
        'flex flex-col gap-1 rounded-xl border border-p-border bg-p-surface px-5 py-4 shadow-p-card',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── Top row: label + icon ── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-p-text-muted">
          {label}
        </p>
        {icon && <span className="text-p-text-muted">{icon}</span>}
      </div>

      {/* ── Value ── */}
      {loading ? (
        <div className="mt-1 h-8 w-24 animate-pulse rounded-md bg-p-surface-2" />
      ) : (
        <p
          className="text-[28px] font-bold leading-none tracking-tight text-p-text"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {formatValue(value, format)}
        </p>
      )}

      {/* ── Delta ── */}
      {delta != null && !loading && (
        <p className="flex items-baseline gap-1 text-[12px]">
          <span
            className={
              isPositive
                ? 'font-semibold text-p-positive'
                : 'font-semibold text-p-error'
            }
          >
            {isPositive ? '▲' : '▼'} {formatValue(Math.abs(delta.value), format)}
          </span>
          {delta.label && (
            <span className="text-p-text-muted">{delta.label}</span>
          )}
        </p>
      )}
    </div>
  );
}
