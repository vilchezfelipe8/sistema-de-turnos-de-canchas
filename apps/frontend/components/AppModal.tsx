import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import Modal from './ui/Modal';

type AppModalProps = {
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
  // Se mantiene por compatibilidad: el modal compartido ya va por encima de todo.
  zIndexClass?: string;
  hideCloseButton?: boolean;
};

// Modal de aviso/confirmación. Usa el modal compartido (components/ui/Modal + .p-modal-* en pique.css).
export default function AppModal({
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
  hideCloseButton = false
}: AppModalProps) {
  const [inputText, setInputText] = useState(inputValue);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  const cancelHold = () => {
    if (holdRef.current) { cancelAnimationFrame(holdRef.current); holdRef.current = null; }
    holdStartRef.current = 0;
    setHolding(false);
    setHoldProgress(0);
  };

  useEffect(() => {
    if (show) { setInputText(inputValue); cancelHold(); }
  }, [show, inputValue]);

  useEffect(() => cancelHold, []);

  const handleConfirm = () => {
    if (onConfirm) { showInput ? onConfirm(inputText) : onConfirm(); return; }
    onClose();
  };

  const stepHold = (ts: number) => {
    if (!holdStartRef.current) holdStartRef.current = ts;
    const progress = Math.min(1, (ts - holdStartRef.current) / holdDuration);
    setHoldProgress(progress);
    if (progress >= 1) { cancelHold(); handleConfirm(); return; }
    holdRef.current = requestAnimationFrame(stepHold);
  };

  const startHold = (e: React.MouseEvent | React.TouchEvent) => {
    if (confirmDisabled || (showInput && !inputText.trim())) return;
    e.preventDefault();
    cancelHold();
    setHolding(true);
    holdStartRef.current = 0;
    holdRef.current = requestAnimationFrame(stepHold);
  };

  const disabled = confirmDisabled || (showInput && !inputText.trim());
  const isSuccess = /éxito|listo|confirmad/i.test(title);
  const icon = isWarning ? <AlertTriangle size={20} /> : isSuccess ? <CheckCircle2 size={20} /> : <Info size={20} />;

  return (
    <Modal
      open={show}
      onClose={onClose}
      title={title}
      icon={icon}
      tone={isWarning ? 'warning' : isSuccess ? 'success' : 'default'}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      hideCloseButton={hideCloseButton}
      footer={(
        <>
          {cancelText && (
            <button type="button" className="p-modal-btn" onClick={onCancel ?? onClose}>
              {cancelText}
            </button>
          )}
          <button
            type="button"
            className={`p-modal-btn ${isWarning ? 'p-modal-btn-danger' : 'p-modal-btn-primary'}`}
            onClick={holdToConfirm ? undefined : handleConfirm}
            onMouseDown={holdToConfirm ? startHold : undefined}
            onMouseUp={holdToConfirm ? cancelHold : undefined}
            onTouchStart={holdToConfirm ? startHold : undefined}
            onTouchEnd={holdToConfirm ? cancelHold : undefined}
            onTouchCancel={holdToConfirm ? cancelHold : undefined}
            onMouseLeave={() => { if (holdToConfirm) cancelHold(); }}
            disabled={disabled}
          >
            {/* Hold-to-confirm progress bar */}
            {holdToConfirm && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', transformOrigin: 'left',
                  background: 'var(--accent-bg-strong)',
                  transform: `scaleX(${holding ? holdProgress : 0})`,
                  transition: holding ? 'none' : 'transform .2s ease',
                }}
              />
            )}
            {!disabled && !holdToConfirm && (isWarning ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />)}
            <span style={{ position: 'relative', zIndex: 1 }}>
              {holdToConfirm ? `Mantener (${confirmText})` : confirmText}
            </span>
          </button>
        </>
      )}
    >
      {typeof message === 'string' ? <p>{message}</p> : message}
      {showInput && (
        <input
          type="text"
          className="p-modal-input"
          value={inputText}
          onChange={(e) => { setInputText(e.target.value); onInputChange?.(e.target.value); }}
          placeholder={inputPlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter' && inputText.trim()) handleConfirm(); }}
          autoFocus
        />
      )}
    </Modal>
  );
}
