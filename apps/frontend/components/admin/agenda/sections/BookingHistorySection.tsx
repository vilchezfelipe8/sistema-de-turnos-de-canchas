import type { BookingHistoryTimelineGroup } from '../types/agendaTypes';

type BookingHistorySectionProps = {
  groups: BookingHistoryTimelineGroup[];
  loading: boolean;
  error?: string;
  title?: string;
  className?: string;
};

export default function BookingHistorySection({
  groups,
  loading,
  error,
  title = 'Historial de la reserva',
  className = '',
}: BookingHistorySectionProps) {
  return (
    <section className={`rounded-xl border border-p-border bg-p-surface-2 p-4 ${className}`.trim()}>
      <p className="text-[18px] font-semibold text-p-text">{title}</p>

      {loading && groups.length > 0 && (
        <p className="mt-3 text-[12px] text-p-text-muted">Actualizando historial...</p>
      )}
      {error && <p className="mt-3 text-[13px] text-p-error">{error}</p>}

      {loading && groups.length === 0 ? (
        <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-p-border bg-p-surface px-4 py-5">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-p-accent border-t-p-accent" />
          <p className="text-[13px] text-p-text-secondary">Cargando historial de la reserva...</p>
        </div>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-[13px] text-p-text-muted">Todavía no hay eventos en el historial.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={`history-group-${group.dateKey}`}>
              <div className="inline-flex rounded-full border border-p-border bg-p-surface px-3 py-1 text-[11px] font-semibold text-p-text-secondary">
                {group.dateLabel}
              </div>
              <div className="mt-2 space-y-0 rounded-xl border border-p-border bg-p-surface px-3 py-2">
                {group.events.map((event, index) => (
                  <div
                    key={`history-event-${event.id}`}
                    className="grid grid-cols-[18px_1fr_auto] gap-2"
                  >
                    <div className="relative pt-1">
                      <span className="absolute left-[4px] top-1.5 h-2.5 w-2.5 rounded-full bg-p-accent" />
                      {index < group.events.length - 1 && (
                        <span className="absolute bottom-[-12px] left-[8px] top-4 w-px bg-p-positive-bg" />
                      )}
                    </div>
                    <div className="pb-3">
                      <p className="text-[14px] font-semibold leading-[1.3] text-p-text">{event.title}</p>
                      <p className="mt-0.5 text-[12px] text-p-text-muted">{event.detail}</p>
                    </div>
                    <p className="pt-0.5 text-[12px] font-semibold text-p-text-secondary">
                      {event.timeLabel}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
