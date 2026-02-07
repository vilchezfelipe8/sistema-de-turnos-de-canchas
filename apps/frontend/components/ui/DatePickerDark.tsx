import React from 'react';
import DatePicker, { registerLocale, DatePickerProps } from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { es } from 'date-fns/locale/es';

registerLocale('es', es);

// 👇 SOLUCIÓN: Usamos directamente DatePickerProps sin inventar interfaces nuevas.
// Esto evita el conflicto de tipos con el 'onChange' original.
const DatePickerDark = ({ className, ...props }: DatePickerProps) => {
  return (
    <div className="relative w-full group">
      {/* 🎨 ESTILOS CLONADOS DE TU DISEÑO OSCURO */}
      <style>{`
        /* Ancho total */
        .react-datepicker-wrapper { width: 100%; }
        
        /* El recuadro principal del calendario */
        .react-datepicker {
          font-family: inherit;
          background-color: #111827 !important; /* gray-900 */
          border: 1px solid #374151 !important; /* gray-700 */
          border-radius: 0.5rem;
          color: #f3f4f6 !important;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
        }
        
        /* El encabezado (Donde dice Febrero 2026) */
        .react-datepicker__header {
          background-color: #111827 !important; /* MISMO gray-900 para que se vea plano */
          border-bottom: 1px solid #374151 !important;
          padding-top: 1rem;
        }
        
        /* Título del Mes */
        .react-datepicker__current-month {
          color: #f3f4f6 !important;
          font-weight: 600;
          text-transform: capitalize;
          margin-bottom: 0.5rem;
        }
        
        /* Nombres de días (lu, ma, mi...) */
        .react-datepicker__day-name {
          color: #9ca3af !important; /* gray-400 */
          width: 2rem;
          text-transform: capitalize;
        }
        
        /* Los números de los días */
        .react-datepicker__day {
          color: #e5e7eb !important; /* gray-200 */
          width: 2rem;
          line-height: 2rem;
          margin: 0.1rem;
          border-radius: 9999px; /* Círculos perfectos */
        }
        
        /* Hover sobre los días */
        .react-datepicker__day:hover {
          background-color: #374151 !important; /* gray-700 */
          color: white !important;
        }
        
        /* Días deshabilitados */
        .react-datepicker__day--disabled {
          color: #4b5563 !important; /* gray-600 */
          opacity: 0.3;
        }

        /* Día Seleccionado (TU VERDE) */
        .react-datepicker__day--selected, .react-datepicker__day--keyboard-selected {
          background-color: #10b981 !important; /* emerald-500 */
          color: white !important;
          font-weight: bold;
        }
        
        /* Ocultar triángulo feo */
        .react-datepicker__triangle { display: none; }
        
        /* Flechas de navegación blancas */
        .react-datepicker__navigation-icon::before {
          border-color: #f3f4f6 !important;
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
          // Combinamos tus estilos con los props que vengan
          className={`w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all ${className || ''}`}
          placeholderText="Selecciona fecha"
          disabledKeyboardNavigation
        />
        
        {/* Icono de calendario (Decorativo) */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
      </div>
    </div>
  );
};

export default DatePickerDark;