import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

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

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
  className="fixed inset-0 z-[99999] bg-[#347048]/80 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-200"
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
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
      >
        
        {/* CABECERA WIMBLEDON */}
        <div className={`p-6 border-b border-[#347048]/10 flex justify-between items-center ${isWarning ? 'bg-red-50' : 'bg-[#EBE1D8]'}`}>
          <h3 className={`text-2xl font-black flex items-center gap-3 uppercase italic tracking-tighter ${isWarning ? 'text-red-600' : 'text-[#347048]'}`}>
            {isWarning ? (
                <AlertTriangle size={28} className="text-red-500" strokeWidth={2.5} />
            ) : title.toLowerCase().includes('éxito') || title.toLowerCase().includes('listo') ? (
                <CheckCircle2 size={28} className="text-[#B9CF32]" strokeWidth={3} />
            ) : (
                <Info size={28} className="text-[#926699]" strokeWidth={3} />
            )}
            {title}
          </h3>
          <button 
            onClick={onClose} 
            className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
            title="Cerrar ventana"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {/* CUERPO DEL MODAL */}
        <div className="p-8 bg-white/40 flex flex-col gap-4">
          <div className="text-[#347048] text-base font-bold leading-relaxed">
            {typeof message === 'string' ? <p className="m-0">{message}</p> : message}
          </div>
          
          {/* INPUT (Si corresponde) */}
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
              className={`w-full px-4 py-3.5 text-sm font-black text-[#347048] bg-white border-2 rounded-xl outline-none shadow-sm transition-all placeholder-[#347048]/30 ${inputFocused ? 'border-[#B9CF32]' : 'border-transparent hover:border-[#B9CF32]/50'}`}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
          )}
        </div>

        {/* PIE Y BOTONES DE ACCIÓN */}
        <div className="p-6 border-t border-[#347048]/10 bg-[#EBE1D8] flex justify-end gap-3">
          {cancelText && (
            <button
              type="button"
              onClick={onCancel ?? onClose}
              className="px-6 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest bg-white border-2 border-transparent hover:border-[#347048]/20 text-[#347048]/60 hover:text-[#347048] transition-all shadow-sm active:scale-95"
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
            className={`relative overflow-hidden px-8 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest shadow-xl transition-all flex items-center gap-2 ${
                disabled 
                    ? 'opacity-40 cursor-not-allowed bg-gray-300 text-gray-500 shadow-none' 
                    : isWarning 
                        ? 'bg-red-600 text-white hover:bg-red-500 shadow-red-900/20 active:scale-95' 
                        : 'bg-[#B9CF32] text-[#347048] hover:bg-[#aebd2b] shadow-[#B9CF32]/20 active:scale-95'
            }`}
          >
            {/* Lógica de Barra de Progreso (Hold To Confirm) mantenida intacta */}
            {holdToConfirm && (
              <span
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none origin-left bg-white/40"
                style={{
                  transform: `scaleX(${holding ? holdProgress : 0})`,
                  transition: holding ? 'none' : 'transform 0.2s ease'
                }}
              />
            )}
            
            {!disabled && !holdToConfirm && (isWarning ? <AlertTriangle size={16} strokeWidth={3}/> : <CheckCircle2 size={16} strokeWidth={3}/>)}
            <span className="relative z-10">{holdToConfirm ? `Mantener presionado (${confirmText})` : confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
  
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}