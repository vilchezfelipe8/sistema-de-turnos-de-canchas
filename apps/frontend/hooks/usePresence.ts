import { useEffect, useRef, useState } from 'react';

/** Debe coincidir con --dur-overlay-out en pique.css. */
export const OVERLAY_EXIT_MS = 190;
/** Debe coincidir con --dur-pop-out en pique.css. */
export const POP_EXIT_MS = 130;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mantiene algo montado mientras hace su animación de salida.
 * - `rendered`: si hay que renderizarlo.
 * - `state`: 'open' | 'closed', para `data-state` (las clases p-motion-* animan según eso).
 */
export function usePresence(open: boolean, exitMs: number = OVERLAY_EXIT_MS) {
  const [rendered, setRendered] = useState(open);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;
    const delay = prefersReducedMotion() ? 0 : exitMs;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setRendered(false);
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { rendered: open || rendered, state: (open ? 'open' : 'closed') as 'open' | 'closed' };
}

/**
 * Guarda lo último que se mostró mientras estaba abierto, para que la salida
 * anime el mismo contenido aunque los datos ya se hayan limpiado.
 */
export function useLastWhileOpen<T>(open: boolean, value: T): T {
  const ref = useRef(value);
  if (open) ref.current = value;
  return open ? value : ref.current;
}
