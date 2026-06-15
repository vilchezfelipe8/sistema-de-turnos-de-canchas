import { useRef } from 'react';
import { CalendarDays } from 'lucide-react';

type AdminDateInputProps = {
  value: string;            // YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Styled native date input.
 *
 * Renders a custom-styled button with a CalendarDays icon and the formatted
 * date (or a placeholder). Clicking anywhere on the button opens the native
 * date picker via a programmatic `.showPicker()` / `.click()` call on the
 * hidden input, which is more reliable across browsers (incl. Safari/iOS)
 * than the old `opacity-0 absolute inset-0` trick.
 */
export default function AdminDateInput({
  value,
  onChange,
  min,
  max,
  placeholder = 'Seleccionar fecha',
  disabled = false,
  className = '',
}: AdminDateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = value
    ? (() => {
        // Format YYYY-MM-DD → DD/MM/YYYY without timezone shifting
        const [y, m, d] = value.split('-');
        return `${d}/${m}/${y}`;
      })()
    : '';

  const handleClick = () => {
    if (disabled || !inputRef.current) return;
    try {
      // showPicker() is the modern way; fall back to .click() for older browsers
      if (typeof inputRef.current.showPicker === 'function') {
        inputRef.current.showPicker();
      } else {
        inputRef.current.click();
      }
    } catch {
      // Some browsers throw if the element is not visible — ignore
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={placeholder}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      className={`relative flex h-10 cursor-pointer items-center rounded-xl border border-p-border bg-p-surface px-3 transition-all focus-within:border-p-accent hover:border-p-border-strong ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`}
    >
      <CalendarDays size={14} className="mr-2 shrink-0 text-p-text-muted" />
      <span
        className={`pointer-events-none flex-1 truncate text-[13px] ${displayValue ? 'text-p-text' : 'text-p-text-muted'}`}
      >
        {displayValue || placeholder}
      </span>
      {/* Hidden real input — positioned off-screen to preserve native interaction */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
      />
    </div>
  );
}
