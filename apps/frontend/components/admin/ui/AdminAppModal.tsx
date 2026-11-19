import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ADMIN_Z_INDEX, ADMIN_Z_INDEX_CLASS } from '../../../utils/adminZIndex';
import AdminOverlay from './AdminOverlay';
import {
  modalBodyCls,
  modalCloseButtonCls,
  modalFooterCls,
  modalHeaderCls,
  modalPanelCls,
  modalSecondaryButtonCls,
  modalTitleCls,
} from './adminModalStyles';

type AdminAppModalProps = {
  show: boolean;
  onClose: () => void;
  onCancel?: () => void;
  title?: string;
  message?: React.ReactNode;
  cancelText?: string;
  confirmText?: string;
  onConfirm?: (value?: string) => void;
  isWarning?: boolean;
  showInput?: boolean;
  inputValue?: string;
  inputPlaceholder?: string;
  onInputChange?: (value: string) => void;
  holdToConfirm?: boolean;
  holdDuration?: number;
  confirmDisabled?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  zIndexClass?: string;
  hideCloseButton?: boolean;
};

export default function AdminAppModal({
  show,
  onClose,
  onCancel,
  title = 'Información',
  message = '',
  cancelText = 'Cancelar',
  confirmText = 'Aceptar',
  onConfirm,
  isWarning = false,
  showInput = false,
  inputValue = '',
  inputPlaceholder = '',
  onInputChange,
  holdToConfirm = false,
  holdDuration = 1200,
  confirmDisabled = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  zIndexClass = ADMIN_Z_INDEX_CLASS.modal,
  hideCloseButton = false
}: AdminAppModalProps) {
  const [inputText, setInputText] = useState(inputValue);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  useEffect(() => {
    if (!show) return;
    setInputText(inputValue);
    cancelHold();
  }, [show, inputValue]);


  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm(showInput ? inputText : undefined);
      return;
    }
    onClose();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInputText(value);
    onInputChange?.(value);
  };

  const cancelHold = () => {
    if (holdRef.current) {
      cancelAnimationFrame(holdRef.current);
      holdRef.current = null;
    }
    holdStartRef.current = 0;
    setHolding(false);
    setHoldProgress(0);
  };

  useEffect(() => cancelHold, []);

  const stepHold = (timestamp: number) => {
    if (!holdStartRef.current) holdStartRef.current = timestamp;
    const elapsed = timestamp - holdStartRef.current;
    const progress = Math.min(1, elapsed / holdDuration);
    setHoldProgress(progress);
    if (progress >= 1) {
      cancelHold();
      handleConfirm();
      return;
    }
    holdRef.current = requestAnimationFrame(stepHold);
  };

  const startHold = (event: React.MouseEvent | React.TouchEvent) => {
    if (confirmDisabled || (showInput && !inputText.trim())) return;
    event.preventDefault();
    cancelHold();
    setHolding(true);
    holdStartRef.current = 0;
    holdRef.current = requestAnimationFrame(stepHold);
  };

  const releaseHold = () => {
    cancelHold();
  };

  const disabled = confirmDisabled || (showInput && !inputText.trim());
  const titleLower = String(title || '').toLowerCase();
  const isSuccess = !isWarning && (titleLower.includes('exito') || titleLower.includes('listo') || titleLower.includes('ok'));
  const icon = isWarning ? (
    <AlertTriangle size={16} />
  ) : isSuccess ? (
    <CheckCircle2 size={16} />
  ) : (
    <Info size={16} />
  );

  const zIndex = Number(zIndexClass.match(/\d+/)?.[0]) || ADMIN_Z_INDEX.modal;

  return (
    <AdminOverlay
      open={show}
      onClose={onClose}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      zIndex={zIndex}
      portal
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`${modalPanelCls} sm:max-w-[480px]`}>
        <div className={modalHeaderCls}>
          <div className="min-w-0">
            <h3 className={`flex items-center gap-2 ${modalTitleCls}`}>
              <span className={isWarning ? 'text-p-error' : isSuccess ? 'text-p-positive' : 'text-p-accent'}>{icon}</span>
              <span className="truncate">{title}</span>
            </h3>
          </div>
          {!hideCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className={modalCloseButtonCls}
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className={`${modalBodyCls} space-y-4`}>
          <div className="text-[13px] leading-5 text-p-text-secondary">
            {typeof message === 'string' ? <p className="m-0">{message}</p> : message}
          </div>

          {showInput && (
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={inputPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && inputText.trim()) handleConfirm();
              }}
              autoFocus
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
            />
          )}
        </div>

        <div className={modalFooterCls}>
          {cancelText && (
            <button
              type="button"
              onClick={onCancel ?? onClose}
              className={modalSecondaryButtonCls}
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            onClick={holdToConfirm ? undefined : handleConfirm}
            onMouseDown={holdToConfirm ? startHold : undefined}
            onMouseUp={holdToConfirm ? releaseHold : undefined}
            onTouchStart={holdToConfirm ? startHold : undefined}
            onTouchEnd={holdToConfirm ? releaseHold : undefined}
            onTouchCancel={holdToConfirm ? releaseHold : undefined}
            onMouseLeave={() => {
              if (holdToConfirm) releaseHold();
            }}
            disabled={disabled}
            className={`relative inline-flex h-9 select-none items-center justify-center overflow-hidden rounded-lg px-4 text-[13px] font-semibold transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.97] ${
              disabled
                ? 'cursor-not-allowed bg-p-surface-3 text-p-text-muted'
                : isWarning
                  ? 'bg-p-error text-white hover:opacity-90'
                  : 'bg-ink-900 text-ink-50 hover:bg-ink-800'
            }`}
          >
            {holdToConfirm && (
              <>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 left-0 ${
                    isWarning ? 'bg-black/20' : 'bg-ink-700'
                  }`}
                  style={{
                    width: `${(holding ? holdProgress : 0) * 100}%`,
                    transition: holding ? 'none' : 'width 0.18s var(--ease-out)'
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))]"
                />
              </>
            )}
            <span className="relative z-10">{holdToConfirm ? `Mantener (${confirmText})` : confirmText}</span>
          </button>
        </div>
      </div>
    </AdminOverlay>
  );
}
