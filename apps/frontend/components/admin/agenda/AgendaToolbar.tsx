import type { RefObject } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

type AgendaToolbarProps = {
  availableSports: string[];
  sportFilter: string;
  selectedDate: Date;
  quickDateInputRef: RefObject<HTMLInputElement | null>;
  isQuickDatePickerOpen: boolean;
  onSportFilterChange: (sport: string) => void;
  onQuickDatePickerOpenChange: (open: boolean) => void;
  onDateChange: (date: Date) => void;
  onMoveDate: (days: number) => void;
  onCreateBooking: () => void;
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AgendaToolbar({
  availableSports,
  sportFilter,
  selectedDate,
  quickDateInputRef,
  isQuickDatePickerOpen,
  onSportFilterChange,
  onQuickDatePickerOpenChange,
  onDateChange,
  onMoveDate,
  onCreateBooking,
}: AgendaToolbarProps) {
  const openNativeDatePicker = () => {
    const input = quickDateInputRef.current;
    if (!input) return;

    if (isQuickDatePickerOpen) {
      input.blur();
      onQuickDatePickerOpenChange(false);
      return;
    }

    const dateInput = input as HTMLInputElement & { showPicker?: () => void };
    onQuickDatePickerOpenChange(true);
    if (typeof dateInput.showPicker === 'function') {
      dateInput.showPicker();
      return;
    }
    input.focus();
    input.click();
  };

  return (
    <div className="rounded-2xl border border-p-border bg-p-surface px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex w-max items-center gap-2 pr-1">
          {availableSports.map((sport) => (
            <button
              key={sport}
              type="button"
              onClick={() => onSportFilterChange(sport)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                sportFilter === sport
                  ? 'bg-ink-900 text-ink-50 shadow-sm'
                  : 'bg-p-surface-2 text-p-text-muted hover:bg-p-surface-2'
              }`}
            >
              {sport}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onMoveDate(-1)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-p-border text-p-text-muted hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
            aria-label="Dia anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative h-9 w-[170px]">
            <button
              type="button"
              onClick={openNativeDatePicker}
              className="inline-flex h-9 w-full items-center gap-2 rounded-lg border border-p-border bg-p-surface px-3 text-sm font-medium text-p-text hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
              aria-label="Seleccionar fecha"
            >
              <CalendarDays size={14} className="text-p-text-muted" />
              <span className="truncate tabular-nums">
                {selectedDate.toLocaleDateString('es-AR', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
            </button>
            <input
              ref={quickDateInputRef}
              type="date"
              value={formatLocalDate(selectedDate)}
              onFocus={() => onQuickDatePickerOpenChange(true)}
              onBlur={() => onQuickDatePickerOpenChange(false)}
              onChange={(event) => {
                const next = new Date(`${event.target.value}T12:00:00`);
                if (!Number.isNaN(next.getTime())) {
                  onDateChange(next);
                }
                onQuickDatePickerOpenChange(false);
              }}
              className="absolute inset-0 opacity-0 pointer-events-none"
              aria-label="Fecha de agenda"
            />
          </div>
          <button
            type="button"
            onClick={() => onMoveDate(1)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-p-border text-p-text-muted hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
            aria-label="Dia siguiente"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={onCreateBooking}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent-fg)] px-3 text-sm font-semibold text-ink-900 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
          >
            <Plus size={14} />
            Crear reserva
          </button>
        </div>
      </div>
    </div>
  );
}
