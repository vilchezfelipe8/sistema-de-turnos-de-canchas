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
  const widthCls = maxWidthClassName.startsWith('sm:') ? maxWidthClassName : `sm:${maxWidthClassName}`;
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
