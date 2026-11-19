import { ChevronLeft, ChevronRight } from 'lucide-react';
import AdminSegmentedControl from './AdminSegmentedControl';

export type AdminPeriod = 'hoy' | 'semana' | 'mes';

const DEFAULT_OPTIONS: Array<{ value: AdminPeriod; label: string }> = [
  { value: 'hoy', label: 'Día' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];

type AdminPeriodPickerProps = {
  period: AdminPeriod;
  onPeriodChange: (period: AdminPeriod) => void;
  /** Texto del período que se está viendo ("Hoy", "Noviembre de 2026"). */
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  /** No se puede ir más adelante (ya es el período actual). */
  nextDisabled?: boolean;
  /** false cuando se eligió un rango a mano: ningún período queda marcado. */
  periodSelected?: boolean;
  options?: Array<{ value: AdminPeriod; label: string }>;
  className?: string;
};

const navButtonCls =
  'grid h-8 w-8 place-items-center rounded-lg text-p-text-muted transition-colors duration-150 hover:bg-p-surface-2 hover:text-p-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/** Único selector de período del admin (Caja, Informes): Día / Semana / Mes + anterior / siguiente. */
export default function AdminPeriodPicker({
  period,
  onPeriodChange,
  label,
  onPrevious,
  onNext,
  nextDisabled = false,
  periodSelected = true,
  options = DEFAULT_OPTIONS,
  className,
}: AdminPeriodPickerProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className || ''}`}>
      <AdminSegmentedControl
        variant="filter"
        ariaLabel="Período"
        value={periodSelected ? period : ''}
        onChange={(value) => onPeriodChange(value as AdminPeriod)}
        options={options}
      />
      <div className="inline-flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
        <button type="button" aria-label="Período anterior" onClick={onPrevious} className={navButtonCls}>
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[120px] px-1 text-center text-[12px] font-semibold text-p-text">{label}</span>
        <button type="button" aria-label="Período siguiente" onClick={onNext} disabled={nextDisabled} className={navButtonCls}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
