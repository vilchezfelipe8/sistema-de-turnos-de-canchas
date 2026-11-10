import type { ReactNode, RefObject } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';

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
  /** Volver al día de hoy (y a la hora actual). */
  onGoToday?: () => void;
  /** Línea de resumen del día, a la derecha de los deportes. */
  summary?: ReactNode;
  /** Abre el buscador "¿Hay lugar?". */
  onFindFreeSlot?: () => void;
};

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

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
  onGoToday,
  summary,
  onFindFreeSlot,
}: AgendaToolbarProps) {
  const isToday = isSameLocalDay(selectedDate, new Date());
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
          {summary && (
            <div className="ml-2 border-l border-p-border pl-3 text-[12px] font-semibold">{summary}</div>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {onGoToday && (
            <button
              type="button"
              onClick={onGoToday}
              className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition ${
                isToday
                  ? 'border border-p-border bg-p-surface text-p-text-muted hover:bg-p-surface-2'
                  : 'bg-p-positive-bg text-p-accent hover:brightness-95'
              }`}
              title={isToday ? 'Ir a la hora actual' : 'Volver a hoy'}
            >
              Hoy
            </button>
          )}
          <div className="relative inline-flex h-8 items-center rounded-lg border border-p-border bg-p-surface overflow-hidden">
            <button
              type="button"
              onClick={() => onMoveDate(-1)}
              className="grid h-8 w-8 place-items-center text-p-text-muted hover:bg-p-surface-2 transition"
              aria-label="Dia anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={openNativeDatePicker}
              className="inline-flex h-8 flex-1 items-center gap-1.5 px-2 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2 transition"
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
            <button
              type="button"
              onClick={() => onMoveDate(1)}
              className="grid h-8 w-8 place-items-center text-p-text-muted hover:bg-p-surface-2 transition"
              aria-label="Dia siguiente"
            >
              <ChevronRight size={16} />
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
          {onFindFreeSlot && (
            <button
              type="button"
              onClick={onFindFreeSlot}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-2.5 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
            >
              <Search size={14} />
              ¿Hay lugar?
            </button>
          )}
          <button
            type="button"
            onClick={onCreateBooking}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
          >
            <Plus size={14} strokeWidth={2.5} />
            Crear reserva
          </button>
        </div>
      </div>
    </div>
  );
}
