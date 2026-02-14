import React from 'react';
import { createPortal } from 'react-dom';
import DatePicker, { registerLocale, DatePickerProps } from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { es } from 'date-fns/locale/es';

registerLocale('es', es);

type DatePickerDarkProps = DatePickerProps & {
  showIcon?: boolean;
  inputClassName?: string;
  variant?: 'dark' | 'light';
  inputSize?: 'default' | 'compact';
};

// 👇 SOLUCIÓN: Usamos directamente DatePickerProps sin inventar interfaces nuevas.
// Esto evita el conflicto de tipos con el 'onChange' original.
const DatePickerDark = ({ className, inputClassName, showIcon = true, variant = 'dark', inputSize = 'default', ...props }: DatePickerDarkProps) => {
  const popperContainer = ({ children }: { children: React.ReactNode }) => {
    if (typeof document === 'undefined') return <>{children}</>;
    return createPortal(children, document.body);
  };
  const theme = variant === 'light'
    ? {
        background: '#ffffff',
        border: 'rgba(52, 112, 72, 0.12)',
        text: '#347048',
        muted: '#6b7a67',
        hover: '#B9CF32',
        selected: '#347048',
        selectedText: '#EBE1D8'

      }
    : {
        background: '#111827',
        border: '#374151',
        text: '#f3f4f6',
        muted: '#9ca3af',
        hover: '#374151',
        selected: '#10b981',
        selectedText: '#ffffff'
      };
  const baseInputClass = variant === 'light'
    ? 'bg-transparent border-none text-[#347048] placeholder-[#347048]/40'
    : 'bg-gray-950 border border-gray-800 text-white placeholder-gray-500';
  const focusClass = variant === 'light'
    ? 'focus:ring-0 focus:border-transparent'
    : 'focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500';
  const sizingClass = inputSize === 'compact'
    ? 'w-full'
    : 'w-full h-12 rounded-lg px-4 py-3 text-base';

  return (
    <div className="relative w-full group">
      {/* 🎨 ESTILOS CLONADOS DE TU DISEÑO OSCURO */}
      <style>{`
        /* Ancho total */
        .react-datepicker-wrapper { width: 100%; }
        
        /* El recuadro principal del calendario */
        .react-datepicker {
          font-family: inherit;
          background-color: ${theme.background} !important;
          border: 1px solid ${theme.border} !important;
          border-radius: 1rem;
          color: ${theme.text} !important;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.12), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }
        
        /* El encabezado (Donde dice Febrero 2026) */
        .react-datepicker__header {
          background-color: ${variant === 'light' ? 'rgba(235, 225, 216, 0.6)' : theme.background} !important;
          border-bottom: 1px solid ${theme.border} !important;
          padding-top: 1rem;
          border-top-left-radius: 1rem;
          border-top-right-radius: 1rem;
        }
        
        /* Título del Mes */
        .react-datepicker__current-month {
          color: ${theme.text} !important;
          font-weight: 600;
          text-transform: capitalize;
          margin-bottom: 0.5rem;
        }
        
        /* Nombres de días (lu, ma, mi...) */
        .react-datepicker__day-name {
          color: ${theme.muted} !important;
          width: 2rem;
          text-transform: capitalize;
        }
        
        /* Los números de los días */
        .react-datepicker__day {
          color: ${theme.text} !important;
          width: 2rem;
          line-height: 2rem;
          margin: 0.1rem;
          border-radius: 9999px;
        }
        
        /* Hover sobre los días */
        .react-datepicker__day:hover {
          background-color: ${theme.hover} !important;
          color: ${variant === 'light' ? '#347048' : '#ffffff'} !important;
        }
        
        /* Días deshabilitados */
        .react-datepicker__day--disabled {
          color: ${theme.muted} !important;
          opacity: 0.3;
        }

        /* Día Seleccionado (TU VERDE) */
        .react-datepicker__day--selected, .react-datepicker__day--keyboard-selected {
          background-color: ${theme.selected} !important;
          color: ${theme.selectedText} !important;
          font-weight: bold;
        }
        
        /* Ocultar triángulo feo */
        .react-datepicker__triangle { display: none; }

  /* Asegurar que el popper quede visible sobre el buscador */
  .react-datepicker-popper { z-index: 200 !important; }
        
        /* Flechas de navegación blancas */
        .react-datepicker__navigation-icon::before {
          border-color: ${theme.text} !important;
          border-width: 2px 2px 0 0;
        }
      `}</style>

      <div className="relative">
        <DatePicker
          {...props}
          locale="es"
          dateFormat="dd MMM yyyy"
          showPopperArrow={false}
          popperPlacement="bottom-start"
          popperClassName="react-datepicker-popper"
          popperContainer={popperContainer}
          // Combinamos tus estilos con los props que vengan
          className={`${sizingClass} focus:outline-none transition-all ${baseInputClass} ${focusClass} ${className || ''} ${inputClassName || ''}`}
          placeholderText="Selecciona fecha"
          disabledKeyboardNavigation
        />
        
        {/* Icono de calendario (Decorativo) */}
        {showIcon && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatePickerDark;