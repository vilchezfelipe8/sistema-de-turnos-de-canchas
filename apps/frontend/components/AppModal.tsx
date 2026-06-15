import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { lockBodyScroll } from '../utils/bodyScrollLock';

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
  zIndexClass?: string;
  hideCloseButton?: boolean;
};

const FONT = "'Geist',system-ui,sans-serif";

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
  zIndexClass = 'z-[2147483200]',
  hideCloseButton = false
}: AppModalProps) {
  const [mounted, setMounted] = useState(false);
  const [inputText, setInputText] = useState(inputValue);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const holdRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const backdropMouseDownRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (show) { setInputText(inputValue); cancelHold(); }
  }, [show, inputValue]);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e: KeyboardEvent) => { if (closeOnEscape && e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    const release = lockBodyScroll();
    return () => { document.removeEventListener('keydown', onKeyDown); release(); };
  }, [show, onClose, closeOnEscape]);

  const handleConfirm = () => {
    if (onConfirm) { showInput ? onConfirm(inputText) : onConfirm(); return; }
    onClose();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    onInputChange?.(e.target.value);
  };

  const cancelHold = () => {
    if (holdRef.current) { cancelAnimationFrame(holdRef.current); holdRef.current = null; }
    holdStartRef.current = 0;
    setHolding(false);
    setHoldProgress(0);
  };

  useEffect(() => cancelHold, []);

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

  const releaseHold = () => { cancelHold(); };

  if (!show) return null;

  const disabled = confirmDisabled || (showInput && !inputText.trim());

  // Colour tokens
  const confirmBg = disabled
    ? 'var(--surface-3)'
    : isWarning
    ? 'var(--error-fg)'
    : 'var(--brand)';
  const confirmColor = disabled ? 'var(--text-muted)' : isWarning ? 'var(--surface-1)' : 'var(--brand-on)';
  const confirmHoverBg = isWarning ? 'var(--error-fg)' : 'var(--brand-hover)';

  const titleIcon = isWarning
    ? <AlertTriangle size={20} style={{ color: 'var(--error-fg)', flexShrink: 0 }} />
    : title.toLowerCase().includes('éxito') || title.toLowerCase().includes('listo') || title.toLowerCase().includes('confirmad')
    ? <CheckCircle2 size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
    : <Info size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 ${zIndexClass}`}
      style={{ background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'am-fadein .15s ease' }}
      onMouseDown={e => { if (!closeOnBackdrop) return; backdropMouseDownRef.current = e.target === e.currentTarget; }}
      onTouchStart={e => { if (!closeOnBackdrop) return; backdropMouseDownRef.current = e.target === e.currentTarget; }}
      onClick={closeOnBackdrop ? e => {
        const started = backdropMouseDownRef.current;
        backdropMouseDownRef.current = false;
        if (started && e.target === e.currentTarget) onClose();
      } : undefined}
    >
      <style>{`
        @keyframes am-fadein { from { opacity:0 } to { opacity:1 } }
        @keyframes am-scalein { from { opacity:0; transform:scale(.95) } to { opacity:1; transform:scale(1) } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440, maxHeight: '90vh',
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'am-scalein .2s ease',
          fontFamily: FONT,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '18px 22px',
          borderBottom: '1px solid var(--border)',
          background: isWarning ? 'var(--error-bg)' : 'transparent',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {titleIcon}
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: isWarning ? 'var(--error-fg)' : 'var(--text-primary)', letterSpacing: '-.02em' }}>
              {title}
            </h3>
          </div>
          {!hideCloseButton && (
            <button
              onClick={onClose}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0, transition: 'background .15s, color .15s' }}
              title="Cerrar"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, fontWeight: 400 }}>
            {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
          </div>

          {showInput && (
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={inputPlaceholder}
              onKeyDown={e => { if (e.key === 'Enter' && inputText.trim()) handleConfirm(); }}
              autoFocus
              style={{
                width: '100%', padding: '11px 14px', boxSizing: 'border-box',
                background: 'var(--surface-1)',
                border: `1px solid ${inputFocused ? 'var(--accent-border-strong)' : 'var(--border)'}`,
                borderRadius: 12, outline: 'none',
                fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
                fontFamily: FONT,
                boxShadow: inputFocused ? 'var(--shadow-focus)' : 'none',
                transition: 'border-color .2s, box-shadow .2s',
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
          padding: '14px 22px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {cancelText && (
            <button
              type="button"
              onClick={onCancel ?? onClose}
              style={{
                padding: '9px 18px', borderRadius: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700,
                letterSpacing: '.01em',
                cursor: 'pointer', fontFamily: FONT, transition: 'background .15s, color .15s',
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
            onMouseLeave={() => { if (holdToConfirm) releaseHold(); }}
            disabled={disabled}
            style={{
              position: 'relative', overflow: 'hidden',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 10, border: 'none',
              background: confirmBg, color: confirmColor,
              fontSize: 12, fontWeight: 800, letterSpacing: '.01em',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              fontFamily: FONT, transition: 'background .15s, opacity .15s',
            }}
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
            {!disabled && !holdToConfirm && (
              isWarning
                ? <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                : <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>
              {holdToConfirm ? `Mantener (${confirmText})` : confirmText}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
