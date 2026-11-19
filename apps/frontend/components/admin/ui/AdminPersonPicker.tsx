import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';

// Buscar y elegir personas (clientes, usuarios de la app, alumnos, profesores, staff).
// Una sola estética para todo el admin: mismo buscador, misma lista, misma fila, mismo "nuevo".
//
//   <AdminSearchInput value={q} onChange={setQ} placeholder="Buscá por nombre, teléfono o DNI" />
//   <AdminPersonList loading={loading} query={q} empty="No hay clientes con ese dato.">
//     {rows.map((r) => <AdminPersonOption key={r.id} name={r.name} detail={r.phone} selected={...} onClick={...} />)}
//     <AdminPersonCreateOption label="Cliente nuevo" value={q} onClick={...} />
//   </AdminPersonList>

// ── Buscador ──────────────────────────────────────────────────────────────────

type AdminSearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  /** md = filtros de listas (h-10), lg = elegir una persona en un formulario (h-11). */
  size?: 'md' | 'lg';
  /** Muestra una X para vaciar cuando hay texto. Por defecto vacía el valor. */
  onClear?: () => void;
  clearable?: boolean;
  wrapperClassName?: string;
};

const SEARCH_SIZE = {
  md: 'h-10 text-[13px] pl-9',
  lg: 'h-11 text-[15px] pl-10',
};

export const AdminSearchInput = forwardRef<HTMLInputElement, AdminSearchInputProps>(function AdminSearchInput(
  { value, onChange, size = 'md', onClear, clearable = true, wrapperClassName = '', className = '', ...rest },
  ref
) {
  const showClear = clearable && value.length > 0 && !rest.disabled;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <Search
        size={size === 'lg' ? 16 : 15}
        aria-hidden
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-p-text-muted ${size === 'lg' ? 'left-3.5' : 'left-3'}`}
      />
      <input
        ref={ref}
        type="search"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-xl border border-p-border bg-p-surface pr-9 text-p-text outline-none transition-colors placeholder:text-p-text-muted focus:border-p-border-strong disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden ${SEARCH_SIZE[size]} ${className}`}
        {...rest}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (onClear ? onClear() : onChange(''))}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-p-text-muted transition-colors hover:bg-p-surface-2 hover:text-p-text"
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
});

// ── Lista de resultados ──────────────────────────────────────────────────────

type AdminPersonListProps = {
  loading?: boolean;
  /** Lo que se escribió; con menos de minChars no se muestra "sin resultados". */
  query?: string;
  minChars?: number;
  /** Texto cuando no hay resultados. */
  empty?: ReactNode;
  /** Cantidad de resultados (para decidir si mostrar el vacío). */
  count: number;
  /** inline = dentro del formulario; floating = desplegable bajo el buscador. */
  variant?: 'inline' | 'floating';
  className?: string;
  style?: CSSProperties;
  /** Alto máximo del área con scroll (floating). */
  maxHeight?: CSSProperties['maxHeight'];
  children?: ReactNode;
};

export function AdminPersonList({
  loading = false,
  query = '',
  minChars = 2,
  empty = 'No encontramos a nadie con ese dato.',
  count,
  variant = 'inline',
  className = '',
  style,
  maxHeight,
  children,
}: AdminPersonListProps) {
  const typed = query.trim().length >= minChars;
  if (!loading && count === 0 && !typed) return null;
  const shell =
    variant === 'floating'
      ? 'p-motion-pop overflow-hidden rounded-xl border border-p-border bg-p-surface shadow-p-lg'
      : 'overflow-hidden rounded-xl border border-p-border bg-p-surface';
  return (
    <div role="listbox" className={`${shell} ${className}`} style={variant === 'floating' ? { transformOrigin: 'top', ...style } : style}>
      <div className={`overflow-y-auto overscroll-contain p-1 ${variant === 'inline' && maxHeight === undefined ? 'max-h-[40vh]' : ''}`} style={{ maxHeight }}>
        {loading ? <p className="px-3 py-2 text-[13px] text-p-text-muted">Buscando…</p> : null}
        {!loading && count === 0 && typed ? <p className="px-3 py-2 text-[13px] text-p-text-muted">{empty}</p> : null}
        {children}
      </div>
    </div>
  );
}

// ── Fila de una persona ──────────────────────────────────────────────────────

type AdminPersonOptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  name: ReactNode;
  /** Teléfono, email o lo que ayude a distinguirla. */
  detail?: ReactNode;
  /** Etiquetas cortas: "Socio", "Alumno", "App"… */
  badges?: string[];
  selected?: boolean;
};

const initialOf = (name: ReactNode) => (typeof name === 'string' ? name.trim().charAt(0).toUpperCase() || '?' : '?');

export function AdminPersonOption({ name, detail, badges, selected = false, className = '', ...rest }: AdminPersonOptionProps) {
  const cleanBadges = (badges || []).filter(Boolean);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      {...rest}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
      } ${className}`}
    >
      <span
        aria-hidden
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
          selected ? 'bg-p-brand text-p-brand-on' : 'bg-p-surface-2 text-p-text-secondary'
        }`}
      >
        {initialOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-p-text">{name}</span>
        {detail || cleanBadges.length ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-p-text-muted">
            {detail ? <span className="truncate">{detail}</span> : null}
            {cleanBadges.map((badge) => (
              <span key={badge} className="shrink-0 rounded-full bg-p-surface-2 px-1.5 py-px text-[11px] font-medium text-p-text-secondary">
                {badge}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {selected ? <Check size={16} aria-hidden className="shrink-0 text-p-accent" /> : null}
    </button>
  );
}

// ── "Crear nuevo" al final de la lista ───────────────────────────────────────

type AdminPersonCreateOptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** "Cliente nuevo", "Titular nuevo", "Alumno nuevo"… */
  label: ReactNode;
  /** Lo que se escribió, se muestra en negrita. */
  value?: string;
};

export function AdminPersonCreateOption({ label, value, className = '', ...rest }: AdminPersonCreateOptionProps) {
  return (
    <>
      <div className="mx-1 my-1 h-px bg-p-border" />
      <button
        type="button"
        {...rest}
        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[14px] text-p-text transition-colors hover:bg-p-surface-2 focus:outline-none focus-visible:bg-p-surface-2 disabled:opacity-40 ${className}`}
      >
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-p-border-strong text-p-accent">
          <Plus size={15} />
        </span>
        <span className="min-w-0 truncate">
          {label}
          {value ? (
            <>
              : <strong className="font-semibold">{value}</strong>
            </>
          ) : null}
        </span>
      </button>
    </>
  );
}

// ── Persona elegida ──────────────────────────────────────────────────────────

type AdminSelectedPersonProps = {
  name: ReactNode;
  detail?: ReactNode;
  badges?: string[];
  /** Texto del botón para elegir otra (default "Cambiar"). */
  changeLabel?: string;
  onChange?: () => void;
  disabled?: boolean;
  className?: string;
};

export function AdminSelectedPerson({
  name,
  detail,
  badges,
  changeLabel = 'Cambiar',
  onChange,
  disabled,
  className = '',
}: AdminSelectedPersonProps) {
  const cleanBadges = (badges || []).filter(Boolean);
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-p-border bg-p-surface px-3 py-2.5 ${className}`}>
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-p-brand text-[12px] font-semibold text-p-brand-on">
        {initialOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-p-text">{name}</span>
        {detail || cleanBadges.length ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-p-text-muted">
            {detail ? <span className="truncate">{detail}</span> : null}
            {cleanBadges.map((badge) => (
              <span key={badge} className="shrink-0 rounded-full bg-p-surface-2 px-1.5 py-px text-[11px] font-medium text-p-text-secondary">
                {badge}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          disabled={disabled}
          className="shrink-0 text-[13px] font-semibold text-p-accent underline-offset-2 hover:underline disabled:opacity-40"
        >
          {changeLabel}
        </button>
      ) : null}
    </div>
  );
}
