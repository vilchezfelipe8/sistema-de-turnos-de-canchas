import type { ReactNode } from 'react';

type AdminCheckboxProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto chico debajo del label. */
  hint?: ReactNode;
  disabled?: boolean;
  /** Con borde, como fila de opción dentro de un form. */
  boxed?: boolean;
};

/** Único checkbox del admin: casilla con el color de la marca, label clickeable. */
export default function AdminCheckbox({ label, checked, onChange, hint, disabled, boxed = false }: AdminCheckboxProps) {
  return (
    <label
      className={`flex items-start gap-2.5 text-[13px] text-p-text ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${
        boxed ? 'rounded-xl border border-p-border bg-p-surface px-3 py-2' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-[inherit] rounded border-p-border accent-p-text"
      />
      <span className="min-w-0">
        {label}
        {hint ? <span className="mt-0.5 block text-[12px] text-p-text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
