import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { lockBodyScroll } from '../../../utils/bodyScrollLock';
import { ADMIN_Z_INDEX_CLASS } from '../../../utils/adminZIndex';

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
  const [mounted, setMounted] = useState(false);
  const [inputText, setInputText] = useState(inputValue);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    setInputText(inputValue);
    cancelHold();
  }, [show, inputValue]);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const releaseBodyScrollLock = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      releaseBodyScrollLock();
    };
  }, [show, onClose, closeOnEscape]);

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

  if (!show) return null;

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

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-[var(--overlay)] p-4`}
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return;
        backdropMouseDownRef.current = event.target === event.currentTarget;
      }}
      onTouchStart={(event) => {
        if (!closeOnBackdrop) return;
        backdropMouseDownRef.current = event.target === event.currentTarget;
      }}
      onClick={
        closeOnBackdrop
          ? (event) => {
              const startedOnBackdrop = backdropMouseDownRef.current;
              backdropMouseDownRef.current = false;
              if (startedOnBackdrop && event.target === event.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-p-border bg-p-surface shadow-p-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-p-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-p-text">
              <span className={isWarning ? 'text-p-error' : isSuccess ? 'text-p-positive' : 'text-p-accent'}>{icon}</span>
              <span className="truncate">{title}</span>
            </h3>
          </div>
          {!hideCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-p-border text-p-text-muted hover:bg-p-surface-2"
              title="Cerrar"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="text-[13px] text-p-text-secondary leading-5">
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

        <div className="flex justify-end gap-2 border-t border-p-border px-5 py-4">
          {cancelText && (
            <button
              type="button"
              onClick={onCancel ?? onClose}
              className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
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
            className={`relative h-9 overflow-hidden rounded-lg px-4 text-[12px] font-semibold transition ${
              disabled
                ? 'cursor-not-allowed bg-p-surface-3 text-p-text-muted'
                : isWarning
                  ? 'bg-[#ea6b67] text-ink-50 hover:bg-[#e35b57]'
                  : 'bg-ink-900 text-ink-50 hover:bg-ink-800'
            }`}
          >
            {holdToConfirm && (
              <>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 left-0 ${
                    isWarning ? 'bg-[#cf4742]' : 'bg-ink-700'
                  }`}
                  style={{
                    width: `${(holding ? holdProgress : 0) * 100}%`,
                    transition: holding ? 'none' : 'width 0.18s ease'
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
    </div>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
