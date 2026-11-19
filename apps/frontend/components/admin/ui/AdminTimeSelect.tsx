const defaultClass =
  'h-9 rounded-lg border border-p-border bg-p-surface px-2 text-[13px] tabular-nums text-p-text outline-none focus:border-p-text-secondary disabled:cursor-not-allowed disabled:opacity-50';

const optionsCache = new Map<number, string[]>();
const timeOptions = (step: number) => {
  const cached = optionsCache.get(step);
  if (cached) return cached;
  const list: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    list.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  optionsCache.set(step, list);
  return list;
};

type AdminTimeSelectProps = {
  /** "HH:MM" en 24 horas. */
  value: string;
  onChange: (value: string) => void;
  /** Minutos entre opciones (30 por defecto). */
  step?: number;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
  /** Reemplaza el estilo por defecto (para igualar los inputs del form). */
  className?: string;
};

/**
 * Único selector de hora del admin: siempre 24 h ("07:00", "23:30"), sin depender del idioma del navegador
 * (el <input type="time"> nativo muestra AM/PM en navegadores en inglés).
 */
export default function AdminTimeSelect({ value, onChange, step = 30, ariaLabel, disabled, required, className }: AdminTimeSelectProps) {
  const base = timeOptions(step);
  // Si viene un horario que no está en la lista (ej. 08:15 con pasos de 30), se agrega para no perderlo.
  const options = !value || base.includes(value) ? base : [...base, value].sort();
  return (
    <select
      aria-label={ariaLabel}
      className={className ?? defaultClass}
      value={value}
      disabled={disabled}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    >
      {!value ? <option value="">--:--</option> : null}
      {options.map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </select>
  );
}
