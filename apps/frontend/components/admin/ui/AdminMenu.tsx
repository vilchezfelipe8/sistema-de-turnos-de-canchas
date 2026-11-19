import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { POP_EXIT_MS, usePresence } from '../../../hooks/usePresence';
import { useOverlayLayer } from './AdminOverlay';

// Menú desplegable del admin ("Más acciones", "⋯"). Uno solo para todo el admin:
// misma forma, misma animación (sale del botón), cierra con Escape o tocando afuera.
// Va dentro de un contenedor `relative` junto al botón que lo abre.

type Placement = 'bottom-end' | 'bottom-start' | 'top-start' | 'top-end';

const PLACEMENT: Record<Placement, { cls: string; origin: string }> = {
  'bottom-end': { cls: 'right-0 top-[calc(100%+6px)]', origin: 'top right' },
  'bottom-start': { cls: 'left-0 top-[calc(100%+6px)]', origin: 'top left' },
  'top-start': { cls: 'left-0 bottom-[calc(100%+6px)]', origin: 'bottom left' },
  'top-end': { cls: 'right-0 bottom-[calc(100%+6px)]', origin: 'bottom right' },
};

type AdminMenuProps = {
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  /** Ancho del menú (default w-60). */
  widthClassName?: string;
  ariaLabel?: string;
  children: ReactNode;
};

export default function AdminMenu({
  open,
  onClose,
  placement = 'bottom-end',
  widthClassName = 'w-60',
  ariaLabel,
  children,
}: AdminMenuProps) {
  const presence = usePresence(open, POP_EXIT_MS);
  useOverlayLayer(open, onClose);
  if (!presence.rendered) return null;
  const { cls, origin } = PLACEMENT[placement];
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="fixed inset-0 z-30 cursor-default"
          onClick={onClose}
        />
      ) : null}
      <div
        role="menu"
        aria-label={ariaLabel}
        data-state={presence.state}
        style={{ transformOrigin: origin }}
        className={`p-motion-pop absolute z-40 ${cls} ${widthClassName} rounded-xl border border-p-border bg-p-surface p-1 shadow-p-lg`}
      >
        {children}
      </div>
    </>
  );
}

type AdminMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'default' | 'danger';
  /** Línea secundaria debajo del texto. */
  hint?: ReactNode;
  icon?: ReactNode;
};

export function AdminMenuItem({ tone = 'default', hint, icon, className = '', children, ...rest }: AdminMenuItemProps) {
  const danger = tone === 'danger';
  return (
    <button
      type="button"
      role="menuitem"
      {...rest}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-p-error hover:bg-p-error-bg' : 'text-p-text hover:bg-p-surface-2'
      } ${hint ? 'font-semibold' : ''} ${className}`}
    >
      {icon ? <span className={`mt-0.5 shrink-0 ${danger ? 'text-p-error' : 'text-p-text-secondary'}`}>{icon}</span> : null}
      <span className="min-w-0">
        {children}
        {hint ? <span className="mt-0.5 block text-[12px] font-normal text-p-text-muted">{hint}</span> : null}
      </span>
    </button>
  );
}

export const AdminMenuDivider = () => <div role="separator" className="my-1 h-px bg-p-border" />;
