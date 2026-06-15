import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AdminPanel } from '../../../components/admin/ui';

export type ReportsPeriod = 'hoy' | 'semana' | 'mes';

type ReportsPeriodOption = {
  value: ReportsPeriod;
  label: string;
};

type ReportsPeriodToolbarProps = {
  period: ReportsPeriod;
  options: ReportsPeriodOption[];
  periodLabel: string;
  isCurrentPeriod: boolean;
  onPeriodChange: (period: ReportsPeriod) => void;
  onPreviousPeriod: () => void;
  onNextPeriod: () => void;
};

export default function ReportsPeriodToolbar({
  period,
  options,
  periodLabel,
  isCurrentPeriod,
  onPeriodChange,
  onPreviousPeriod,
  onNextPeriod,
}: ReportsPeriodToolbarProps) {
  return (
    <AdminPanel bodyClassName="flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface-2 p-1">
        {options.map((option) => {
          const isActive = option.value === period;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriodChange(option.value)}
              className={[
                'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/80',
                isActive
                  ? 'bg-p-surface text-p-accent shadow-sm'
                  : 'text-p-text-muted hover:text-p-text-secondary',
              ].join(' ')}
              aria-pressed={isActive}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface px-1 py-1">
        <button
          type="button"
          onClick={onPreviousPeriod}
          aria-label="Periodo anterior"
          className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/80"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[120px] truncate px-2 text-center text-[12px] font-semibold text-p-text-secondary">
          {periodLabel}
        </span>
        <button
          type="button"
          onClick={onNextPeriod}
          disabled={isCurrentPeriod}
          aria-label="Periodo siguiente"
          className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted transition hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/80 disabled:cursor-not-allowed disabled:text-p-text-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </AdminPanel>
  );
}
