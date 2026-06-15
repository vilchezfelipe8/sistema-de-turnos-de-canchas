/**
 * DatePickerDark — público (páginas de reserva de cancha).
 * Para el panel admin usá AdminDateInput en su lugar.
 */
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { shift } from '@floating-ui/react';

type DatePickerDarkProps = {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  minDate?: Date;
  maxDate?: Date;
  /** @deprecated no tiene efecto — conservado por compatibilidad */
  showIcon?: boolean;
  /** 'compact' aplica estilos más ajustados */
  inputSize?: 'compact' | 'normal';
  dateFormat?: string;
  inputClassName?: string;
  variant?: 'dark' | 'light';
  placeholderText?: string;
};

export default function DatePickerDark({
  selected,
  onChange,
  minDate,
  maxDate,
  inputSize = 'normal',
  dateFormat = 'EEE dd MMM yyyy',
  inputClassName,
  placeholderText,
}: DatePickerDarkProps) {
  const defaultInputCls =
    inputSize === 'compact'
      ? 'bg-transparent border-none outline-none text-sm w-full cursor-pointer focus:ring-0 p-0 h-auto'
      : 'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] outline-none';

  return (
    <DatePicker
      selected={selected}
      onChange={onChange}
      minDate={minDate}
      maxDate={maxDate}
      dateFormat={dateFormat}
      placeholderText={placeholderText}
      className={inputClassName ?? defaultInputCls}
      calendarClassName="rdp-calendar-dark"
      portalId="datepicker-portal"
      popperPlacement="bottom-start"
      popperClassName="date-picker-popper date-picker-popper--public"
      popperModifiers={[shift({ padding: 8 })]}
      showPopperArrow={false}
    />
  );
}
