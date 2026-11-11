import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { lockBodyScroll } from '../../utils/bodyScrollLock';

export type ModalTone = 'default' | 'warning' | 'success';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  // Texto chico debajo del título.
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: ModalTone;
  children?: React.ReactNode;
  // Botones de abajo (usar .p-modal-btn / -primary / -danger).
  footer?: React.ReactNode;
  // Mientras se guarda: no se cierra con la X, Escape ni tocando afuera.
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  hideCloseButton?: boolean;
  maxWidth?: number;
}

// Modal único de la app. Estilos en pique.css (.p-modal-*).
// Se cierra con la X, con Escape y tocando afuera (solo si el toque empezó afuera:
// arrastrar desde el contenido hacia el fondo no lo cierra).
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = 'default',
  children,
  footer,
  closeDisabled = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideCloseButton = false,
  maxWidth = 440,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const backdropPressRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape && !closeDisabled) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const release = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      release();
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, closeOnEscape, closeDisabled]);

  if (!open || !mounted) return null;

  const content = (
    <div
      className="p-modal-overlay"
      onMouseDown={(event) => { backdropPressRef.current = event.target === event.currentTarget; }}
      onTouchStart={(event) => { backdropPressRef.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        const startedOutside = backdropPressRef.current;
        backdropPressRef.current = false;
        if (startedOutside && event.target === event.currentTarget && closeOnBackdrop && !closeDisabled) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`p-modal p-modal-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
      >
        <div className="p-modal-head">
          <div className="p-modal-heading">
            {icon ? <span className="p-modal-icon" aria-hidden="true">{icon}</span> : null}
            <div style={{ minWidth: 0 }}>
              <h2 id={titleId} className="p-modal-title">{title}</h2>
              {subtitle ? <p className="p-modal-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          {!hideCloseButton && (
            <button type="button" className="p-public-close-btn" onClick={onClose} disabled={closeDisabled} aria-label="Cerrar" title="Cerrar">
              <X size={15} />
            </button>
          )}
        </div>
        {children ? <div className="p-modal-body">{children}</div> : null}
        {footer ? <div className="p-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
