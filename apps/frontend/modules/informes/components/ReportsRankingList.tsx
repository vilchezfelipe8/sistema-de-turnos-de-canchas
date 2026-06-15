import type { ProductRankingDatum } from './ProductsRankingChart';
import {
  formatReportsMoney,
  formatReportsNumber,
} from './reportsFormatters';

type ReportsRankingListProps = {
  title: string;
  description?: string;
  rows: ProductRankingDatum[];
  emptyLabel: string;
  tone?: 'primary' | 'muted';
  showRevenue?: boolean;
};

export default function ReportsRankingList({
  title,
  description,
  rows,
  emptyLabel,
  tone = 'primary',
  showRevenue = true,
}: ReportsRankingListProps) {
  const accentClass = tone === 'primary' ? 'bg-p-positive-bg text-p-accent' : 'bg-p-surface-3 text-p-text-muted';

  return (
    <article className="rounded-xl border border-p-border bg-p-surface-2 p-4">
      <header>
        <h3 className="text-[13px] font-semibold text-p-text">{title}</h3>
        {description && <p className="mt-1 text-[12px] text-p-text-muted">{description}</p>}
      </header>

      <div className="mt-4 space-y-3">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-p-border bg-p-surface px-3 py-4 text-center text-[12px] font-semibold text-p-text-muted">
            {emptyLabel}
          </p>
        )}
        {rows.slice(0, 6).map((row, index) => (
          <div key={`${row.productId || row.name}-${index}`} className="flex items-center gap-3">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${accentClass}`}>
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-p-text">
                {row.name || 'Producto'}
              </p>
              <p className="text-[11px] text-p-text-muted">
                {formatReportsNumber(Number(row.quantity || 0))} u.
                {showRevenue && row.revenue != null ? ` - ${formatReportsMoney(Number(row.revenue || 0))}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
