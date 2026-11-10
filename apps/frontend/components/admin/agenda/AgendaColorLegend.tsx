import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { bookingColor } from './utils/agendaDisplayUtils';

const BLOCK_ITEMS: Array<{ state: Parameters<typeof bookingColor>[0]; label: string }> = [
  { state: 'pending', label: 'Sin confirmar' },
  { state: 'confirmed', label: 'Confirmada' },
  { state: 'completed', label: 'Finalizada' },
  { state: 'class', label: 'Clase' },
  { state: 'blocked', label: 'Bloqueo' },
];

const PAYMENT_ITEMS = [
  { className: 'bg-lima-200/90 text-ink-900', label: 'Pagado', hint: 'No debe nada' },
  { className: 'bg-amber-300/90 text-ink-900', label: 'Debe $', hint: 'Pagó una parte' },
  { className: 'bg-ink-300/90 text-ink-900', label: 'Debe $', hint: 'Todavía no pagó' },
];

type AgendaColorLegendProps = {
  /** Estilo del botón: compacto en celular. */
  variant?: 'desktop' | 'mobile';
  /** Lado hacia el que abre el cartel. */
  align?: 'left' | 'right';
};

/** Botón "Colores": explica qué significa cada color de bloque y cada etiqueta de pago. */
export default function AgendaColorLegend({ variant = 'desktop', align = 'right' }: AgendaColorLegendProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={
          variant === 'mobile'
            ? 'inline-flex items-center gap-1 text-[11px] font-bold text-p-text-muted underline-offset-2 hover:underline'
            : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-2.5 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2'
        }
      >
        <Palette size={variant === 'mobile' ? 12 : 14} />
        Colores
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Qué significa cada color"
          className={`absolute top-full z-50 mt-2 w-[260px] rounded-2xl border border-p-border bg-p-surface p-3.5 text-left shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <p className="mb-2 text-[12px] font-extrabold text-p-text">Color del bloque</p>
          <ul className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {BLOCK_ITEMS.map((item) => (
              <li key={item.state} className="flex items-center gap-2 text-[12px] font-semibold text-p-text-secondary">
                <span
                  className={`h-3.5 w-5 shrink-0 rounded ${
                    item.state === 'blocked'
                      ? 'bg-[repeating-linear-gradient(135deg,#FEE2E2,#FEE2E2_3px,#FECACA_3px,#FECACA_6px)]'
                      : bookingColor(item.state)
                  }`}
                />
                {item.label}
              </li>
            ))}
          </ul>
          <p className="mb-2 text-[12px] font-extrabold text-p-text">Etiqueta de pago</p>
          <ul className="mb-3 space-y-1.5">
            {PAYMENT_ITEMS.map((item) => (
              <li key={item.hint} className="flex items-center gap-2 text-[12px] font-semibold text-p-text-secondary">
                <span className={`w-[58px] shrink-0 rounded-full px-2 py-[3px] text-center text-[11px] font-extrabold leading-none ${item.className}`}>
                  {item.label}
                </span>
                {item.hint}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-p-text-muted">
            Lo que ya pasó y no debe nada se ve más claro. Si todavía debe, se sigue viendo fuerte.
          </p>
        </div>
      )}
    </div>
  );
}
