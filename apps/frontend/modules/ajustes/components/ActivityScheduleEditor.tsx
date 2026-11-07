import { CalendarDays, Plus, X } from 'lucide-react';

/** Mismo formato que guarda el club: listas en texto ("60, 90", "08:00-12:00\n16:00-23:00", "08:00-60"). */
export type ActivityScheduleConfig = {
  scheduleMode: 'FIXED' | 'RANGE';
  scheduleDurations: string;
  scheduleOpenTime: string;
  scheduleCloseTime: string;
  scheduleIntervalMinutes: string;
  scheduleWindows: string;
  scheduleFixedSlots: string;
};

type ActivityScheduleEditorProps = {
  activityName: string;
  config: ActivityScheduleConfig;
  onChange: (patch: Partial<ActivityScheduleConfig>) => void;
  hasPendingChanges?: boolean;
  exceptionsCount?: number;
  onOpenExceptions?: () => void;
};

const DURATION_PRESETS = [30, 45, 60, 90, 120, 150, 180];
const INTERVAL_PRESETS = [15, 30, 60];

const inputCls =
  'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-border-strong';

const rowInputCls =
  'h-10 w-32 rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-border-strong';

const parseDurations = (value: string) =>
  Array.from(
    new Set(
      String(value || '')
        .split(/[,\s]+/)
        .map((part) => Number(part))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ).sort((a, b) => a - b);

const parseLines = (value: string) =>
  String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
};

/**
 * Horario de un deporte en lenguaje simple: si abre de corrido o en turnos puntuales,
 * cuánto puede durar un turno y los cortes. Escribe en el mismo formato de texto de siempre.
 */
export default function ActivityScheduleEditor({
  activityName,
  config,
  onChange,
  hasPendingChanges = false,
  exceptionsCount = 0,
  onOpenExceptions,
}: ActivityScheduleEditorProps) {
  const durations = parseDurations(config.scheduleDurations);
  const durationOptions = Array.from(new Set([...DURATION_PRESETS, ...durations])).sort((a, b) => a - b);
  const windows = parseLines(config.scheduleWindows).map((line) => {
    const [from = '', to = ''] = line.split('-');
    return { from: from.trim(), to: to.trim() };
  });
  const fixedSlots = parseLines(config.scheduleFixedSlots).map((line) => {
    const [time = '', minutes = ''] = line.split('-');
    return { time: time.trim(), minutes: minutes.trim() || String(durations[0] || 60) };
  });
  const interval = Number(config.scheduleIntervalMinutes) || 30;

  const toggleDuration = (minutes: number) => {
    const next = durations.includes(minutes) ? durations.filter((d) => d !== minutes) : [...durations, minutes];
    onChange({ scheduleDurations: next.sort((a, b) => a - b).join(', ') });
  };

  const writeWindows = (rows: Array<{ from: string; to: string }>) =>
    onChange({ scheduleWindows: rows.filter((row) => row.from || row.to).map((row) => `${row.from}-${row.to}`).join('\n') });

  const writeFixed = (rows: Array<{ time: string; minutes: string }>) =>
    onChange({ scheduleFixedSlots: rows.filter((row) => row.time).map((row) => `${row.time}-${row.minutes}`).join('\n') });

  const sampleStarts = (() => {
    if (config.scheduleMode !== 'RANGE' || !config.scheduleOpenTime) return '';
    const [h, m] = config.scheduleOpenTime.split(':').map(Number);
    if (!Number.isFinite(h)) return '';
    const start = h * 60 + (m || 0);
    return [0, 1, 2]
      .map((i) => {
        const t = start + i * interval;
        return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      })
      .join(', ');
  })();

  return (
    <div className="rounded-xl border border-p-border p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-semibold text-p-text">{activityName}</p>
          {hasPendingChanges && (
            <span className="rounded-full bg-p-warning-bg px-2 py-0.5 text-[10px] font-semibold text-p-warning">Sin guardar</span>
          )}
        </div>
        {onOpenExceptions && (
          <button
            type="button"
            onClick={onOpenExceptions}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
          >
            <CalendarDays size={14} />
            Feriados y cierres{exceptionsCount > 0 ? ` (${exceptionsCount})` : ''}
          </button>
        )}
      </div>

      <div className="space-y-5">
        {/* Cómo se reserva */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-p-text">¿Cómo se reserva?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              { value: 'RANGE', title: 'De corrido', text: 'Se puede empezar a cualquier hora entre la apertura y el cierre.' },
              { value: 'FIXED', title: 'En horarios puntuales', text: 'Solo en los horarios que cargues (ej: 19:00, 20:30).' },
            ] as const).map((option) => {
              const active = config.scheduleMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ scheduleMode: option.value })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    active ? 'border-ink-900 bg-p-surface-2' : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                  }`}
                >
                  <span className="block text-[13px] font-semibold text-p-text">{option.title}</span>
                  <span className="block text-[12px] text-p-text-muted">{option.text}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Duraciones */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-p-text">¿Cuánto puede durar un turno?</p>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map((minutes) => {
              const active = durations.includes(minutes);
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDuration(minutes)}
                  className={`h-9 rounded-lg border px-3 text-[13px] font-semibold transition ${
                    active ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                  }`}
                >
                  {formatMinutes(minutes)}
                </button>
              );
            })}
          </div>
          {durations.length === 0 && <p className="mt-1 text-[12px] font-semibold text-p-warning">Elegí al menos una duración.</p>}
        </div>

        {config.scheduleMode === 'RANGE' ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-p-text">Abre</span>
                <input
                  type="time"
                  value={config.scheduleOpenTime}
                  onChange={(e) => onChange({ scheduleOpenTime: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-p-text">Cierra</span>
                <input
                  type="time"
                  value={config.scheduleCloseTime}
                  onChange={(e) => onChange({ scheduleCloseTime: e.target.value })}
                  className={inputCls}
                />
              </label>
              <div className="col-span-2 sm:col-span-1">
                <span className="mb-1 block text-[13px] font-medium text-p-text">Un turno empieza cada</span>
                <div className="flex gap-1">
                  {Array.from(new Set([...INTERVAL_PRESETS, interval])).sort((a, b) => a - b).map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={interval === minutes}
                      onClick={() => onChange({ scheduleIntervalMinutes: String(minutes) })}
                      className={`h-10 flex-1 rounded-lg border text-[13px] font-semibold transition ${
                        interval === minutes ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border bg-p-surface text-p-text-secondary'
                      }`}
                    >
                      {formatMinutes(minutes)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {sampleStarts && (
              <p className="-mt-2 text-[12px] text-p-text-muted">Se puede reservar a las {sampleStarts}…</p>
            )}

            {/* Cortes */}
            <div>
              <p className="text-[13px] font-medium text-p-text">¿Cierra en algún momento del día?</p>
              <p className="mb-2 text-[12px] text-p-text-muted">
                Si hay un corte (ej: al mediodía), cargá los horarios en que sí abre. Si abre de corrido, dejalo vacío.
              </p>
              <div className="space-y-2">
                {windows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label="Desde"
                      value={row.from}
                      onChange={(e) => writeWindows(windows.map((w, i) => (i === index ? { ...w, from: e.target.value } : w)))}
                      className={rowInputCls}
                    />
                    <span className="text-[13px] text-p-text-muted">a</span>
                    <input
                      type="time"
                      aria-label="Hasta"
                      value={row.to}
                      onChange={(e) => writeWindows(windows.map((w, i) => (i === index ? { ...w, to: e.target.value } : w)))}
                      className={rowInputCls}
                    />
                    <button
                      type="button"
                      aria-label="Sacar franja"
                      onClick={() => writeWindows(windows.filter((_, i) => i !== index))}
                      className="grid h-9 w-9 place-items-center rounded-lg text-p-text-muted hover:bg-p-surface-2 hover:text-p-text"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => writeWindows([...windows, { from: '08:00', to: '12:00' }])}
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
                >
                  <Plus size={14} />
                  Agregar franja
                </button>
              </div>
            </div>
          </>
        ) : (
          <div>
            <p className="mb-2 text-[13px] font-medium text-p-text">Horarios en que se puede reservar</p>
            <div className="space-y-2">
              {fixedSlots.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label="Hora"
                    value={row.time}
                    onChange={(e) => writeFixed(fixedSlots.map((slot, i) => (i === index ? { ...slot, time: e.target.value } : slot)))}
                    className={rowInputCls}
                  />
                  <select
                    aria-label="Duración"
                    value={row.minutes}
                    onChange={(e) => writeFixed(fixedSlots.map((slot, i) => (i === index ? { ...slot, minutes: e.target.value } : slot)))}
                    className={rowInputCls}
                  >
                    {durationOptions.map((minutes) => (
                      <option key={minutes} value={String(minutes)}>
                        {formatMinutes(minutes)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Sacar horario"
                    onClick={() => writeFixed(fixedSlots.filter((_, i) => i !== index))}
                    className="grid h-9 w-9 place-items-center rounded-lg text-p-text-muted hover:bg-p-surface-2 hover:text-p-text"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => writeFixed([...fixedSlots, { time: '19:00', minutes: String(durations[0] || 60) }])}
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
              >
                <Plus size={14} />
                Agregar horario
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
