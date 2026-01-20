import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
};

/**
 * Modal genérico reutilizable para la aplicación
 * Soporta diferentes variantes: información, advertencia, confirmación, input
 */
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
  closeOnEscape = true
}: AppModalProps) {
  const [mounted, setMounted] = useState(false);
  const [inputText, setInputText] = useState(inputValue);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [confirmHover, setConfirmHover] = useState(false);
  const [cancelHover, setCancelHover] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (show) {
      setInputText(inputValue);
      cancelHold();
    }
  }, [show, inputValue]);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [show, onClose, closeOnEscape]);

  const handleConfirm = () => {
    if (onConfirm) {
      if (showInput) {
        onConfirm(inputText);
      } else {
        onConfirm();
      }
      return;
    }
    onClose();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInputText(value);
    if (onInputChange) {
      onInputChange(value);
    }
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
  const confirmBackground = isWarning ? '#e74c3c' : 'var(--surface)';
  const confirmBorder = isWarning ? '#e74c3c' : 'var(--border)';
  const confirmHoverBackground = isWarning ? '#d84335' : 'rgba(255,255,255,0.06)';
  const confirmHoverBorder = isWarning ? '#d84335' : 'var(--border)';

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
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
              if (startedOnBackdrop && event.target === event.currentTarget) {
                onClose();
              }
            }
          : undefined
      }
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem'
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
          color: 'var(--text)',
          fontFamily: 'var(--font-sans)'
        }}
      >
        <div style={{ padding: '1rem 1.25rem 0.5rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>{title}</div>
        </div>
        <div style={{ padding: '0 1.25rem 1rem' }}>
          <div
            style={{
              margin: 0,
              fontSize: '0.9rem',
              color: 'var(--muted)',
              marginBottom: showInput ? '1rem' : 0
            }}
          >
            {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
          </div>
          {showInput && (
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={inputPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && inputText.trim()) {
                  handleConfirm();
                }
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: '0.9rem',
                borderRadius: '8px',
                border: `1px solid ${inputFocused ? 'var(--accent)' : 'var(--border)'}`,
                backgroundColor: 'rgba(255,255,255,0.02)',
                color: 'var(--text)',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
                transition: 'border-color 0.2s ease',
                boxSizing: 'border-box'
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
          )}
        </div>
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            padding: '0.75rem 1.25rem 1rem',
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end'
          }}
        >
          {cancelText && (
            <button
              type="button"
              onClick={onCancel ?? onClose}
              onMouseEnter={() => setCancelHover(true)}
              onMouseLeave={() => setCancelHover(false)}
              style={{
                background: cancelHover ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: 'none',
                color: cancelHover ? 'var(--text)' : 'var(--muted)',
                cursor: 'pointer',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                borderRadius: '8px',
                transition: 'all 0.2s ease',
                fontFamily: 'var(--font-sans)'
              }}
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
            onMouseEnter={() => setConfirmHover(true)}
            onMouseLeave={() => {
              setConfirmHover(false);
              if (holdToConfirm) releaseHold();
            }}
            disabled={disabled}
            style={{
              background: confirmHover ? confirmHoverBackground : confirmBackground,
              border: `1px solid ${confirmHover ? confirmHoverBorder : confirmBorder}`,
              color: isWarning ? '#fff' : 'var(--text)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              opacity: disabled ? 0.5 : 1,
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {holdToConfirm && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(255,255,255,0.12)',
                  transformOrigin: 'left center',
                  transform: `scaleX(${holding ? holdProgress : 0})`,
                  transition: holding ? 'none' : 'transform 0.2s ease',
                  pointerEvents: 'none'
                }}
              />
            )}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
