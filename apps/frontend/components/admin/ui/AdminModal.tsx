import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';
import AdminOverlay from './AdminOverlay';
import {
  modalBodyCls,
  modalCloseButtonCls,
  modalDescriptionCls,
  modalFooterCls,
  modalHeaderCls,
  modalPanelCls,
  modalTitleCls,
} from './adminModalStyles';

type AdminModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeOnEscape?: boolean;
  maxWidthClassName?: string;
  zIndex?: number;
};

// Tailwind solo genera las clases que ve escritas enteras: armar `sm:${x}` en runtime
// deja el modal sin ancho máximo (ocupa toda la pantalla). Por eso la tabla es literal.
const MODAL_WIDTHS: Record<string, string> = {
  'max-w-md': 'sm:max-w-md',
  'max-w-lg': 'sm:max-w-lg',
  'max-w-xl': 'sm:max-w-xl',
  'max-w-2xl': 'sm:max-w-2xl',
  'max-w-3xl': 'sm:max-w-3xl',
  'max-w-[480px]': 'sm:max-w-[480px]',
  'max-w-[560px]': 'sm:max-w-[560px]',
  'max-w-[640px]': 'sm:max-w-[640px]',
};

function modalWidthClass(value: string) {
  if (value.startsWith('sm:')) return value;
  const mapped = MODAL_WIDTHS[value];
  if (!mapped && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`AdminModal: ancho "${value}" sin mapear; pasalo como "sm:${value}" o sumalo a MODAL_WIDTHS.`);
  }
  return mapped || 'sm:max-w-[560px]';
}

export default function AdminModal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeOnEscape = true,
  maxWidthClassName = 'sm:max-w-[560px]',
  zIndex = ADMIN_Z_INDEX.modal,
}: AdminModalProps) {
  const widthCls = modalWidthClass(maxWidthClassName);
  return (
    <AdminOverlay open={open} onClose={onClose} closeOnEscape={closeOnEscape} zIndex={zIndex}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`${modalPanelCls} ${widthCls}`}>
        <header className={modalHeaderCls}>
          <div className="min-w-0">
            <h2 className={modalTitleCls}>{title}</h2>
            {description && <p className={modalDescriptionCls}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} className={modalCloseButtonCls} aria-label={`Cerrar ${title}`}>
            <X size={14} />
          </button>
        </header>
        <div className={modalBodyCls}>{children}</div>
        {footer && <footer className={modalFooterCls}>{footer}</footer>}
      </div>
    </AdminOverlay>
  );
}
