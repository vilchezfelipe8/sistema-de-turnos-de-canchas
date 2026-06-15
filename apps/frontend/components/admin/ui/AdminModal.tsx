import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';

type AdminModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeOnEscape?: boolean;
  maxWidthClassName?: string;
};

export default function AdminModal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeOnEscape = true,
  maxWidthClassName = 'max-w-[560px]',
}: AdminModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[1px]"
      style={{ zIndex: ADMIN_Z_INDEX.modal }}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${maxWidthClassName} rounded-2xl border border-p-border bg-p-surface shadow-p-lg`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-p-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold tracking-[-0.01em] text-p-text">{title}</h2>
            {description && <p className="mt-1 text-[12px] text-p-text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-p-border text-p-text-muted hover:bg-p-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40"
            aria-label={`Cerrar ${title}`}
          >
            <X size={14} />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}
