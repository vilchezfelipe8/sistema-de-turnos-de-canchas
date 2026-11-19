import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../../../utils/bodyScrollLock';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';
import { useLastWhileOpen, usePresence } from '../../../hooks/usePresence';

// Pila de capas abiertas (modales y drawers): Escape cierra solo la de arriba.
const layerStack: number[] = [];
let nextLayerId = 1;

/** Registra una capa mientras está abierta; Escape solo llega a la de más arriba. */
export function useOverlayLayer(open: boolean, onEscape?: () => void, enabled = true) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  // Por ref: cambiar "enabled" no re-registra la capa (no la mueve arriba de otra).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    if (!open) return;
    const id = nextLayerId++;
    layerStack.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (layerStack[layerStack.length - 1] !== id) return;
      if (!enabledRef.current) return;
      if (!onEscapeRef.current) return;
      event.preventDefault();
      onEscapeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = layerStack.indexOf(id);
      if (index >= 0) layerStack.splice(index, 1);
    };
  }, [open]);
}

type AdminOverlayProps = {
  open: boolean;
  /** Se llama con Escape o al tocar el fondo. Sin esto, el modal solo se cierra desde adentro. */
  onClose?: () => void;
  /**
   * El panel del modal (un solo elemento). Recibe la animación de entrada/salida:
   * centrado en desktop, hoja desde abajo en el celular.
   */
  children: ReactElement<{ className?: string; 'data-state'?: string }>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  zIndex?: number;
  /** Renderiza en document.body (para escapar de contenedores con overflow o transform). */
  portal?: boolean;
  /** Bloquea el scroll de la página mientras está abierto. */
  lockScroll?: boolean;
  ariaLabel?: string;
};

/**
 * Base de todos los modales del admin: fondo, cierre con Escape / click afuera,
 * bloqueo de scroll y la misma animación de entrada y salida en todos lados.
 */
export default function AdminOverlay({
  open,
  onClose,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  zIndex = ADMIN_Z_INDEX.modal,
  portal = false,
  lockScroll = true,
  ariaLabel,
}: AdminOverlayProps) {
  const { rendered, state } = usePresence(open);
  const panel = useLastWhileOpen(open, children);
  const pressedBackdropRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useOverlayLayer(open, onClose ? () => onCloseRef.current?.() : undefined, closeOnEscape);

  useEffect(() => {
    if (!open || !lockScroll) return;
    return lockBodyScroll();
  }, [open, lockScroll]);

  if (!rendered || !isValidElement(panel)) return null;

  const content = (
    <div
      className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4"
      style={{ zIndex }}
      role="presentation"
      aria-hidden={state === 'closed' || undefined}
    >
      <div
        aria-hidden="true"
        data-state={state}
        className="p-motion-backdrop absolute inset-0 bg-[var(--overlay)]"
        onPointerDown={(event) => {
          pressedBackdropRef.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          const startedHere = pressedBackdropRef.current;
          pressedBackdropRef.current = false;
          if (startedHere && event.target === event.currentTarget && closeOnBackdrop && open) onCloseRef.current?.();
        }}
      />
      {/* El panel va siempre dentro de esta capa: queda arriba del fondo y anima igual,
          sea un <div> o un componente que no reenvía className. */}
      <div
        data-state={state}
        className="p-motion-dialog pointer-events-none relative flex w-full justify-center [&>*]:pointer-events-auto"
      >
        {ariaLabel ? cloneElement(panel, { 'aria-label': ariaLabel } as any) : panel}
      </div>
    </div>
  );

  if (portal) {
    if (!mounted || typeof document === 'undefined') return null;
    return createPortal(content, document.body);
  }
  return content;
}
