import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Repeat } from 'lucide-react';

type BookingState = 'pending' | 'confirmed' | 'completed' | 'blocked';
type PaymentState = 'paid' | 'partial' | 'unpaid';

type BlockContentVisibility = {
  showDurationOnly: boolean;
  showBadge: boolean;
  showTitle: boolean;
  showTimeRange: boolean;
};

type AgendaBookingBlockProps = {
  title: string;
  state: BookingState;
  paymentState: PaymentState;
  startSlot: number;
  endSlot: number;
  slotMinutes: number;
  visibility: BlockContentVisibility;
  slotToTime: (slot: number) => string;
  bookingBadgeColor: (state: BookingState) => string;
  bookingStatusLabel: (state: BookingState) => string;
  bookingPaymentBadgeColor: (state: PaymentState) => string;
  bookingPaymentLabel: (state: PaymentState) => string;
  colorClass: string;
  isRecurring?: boolean;
  isConflict?: boolean;
  conflictLabel?: string;
  className?: string;
  style?: CSSProperties;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseMove?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  children?: ReactNode;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export default function AgendaBookingBlock({
  title,
  state,
  paymentState,
  startSlot,
  endSlot,
  slotMinutes,
  visibility,
  slotToTime,
  bookingBadgeColor,
  bookingStatusLabel,
  bookingPaymentBadgeColor,
  bookingPaymentLabel,
  colorClass,
  isRecurring = false,
  isConflict = false,
  conflictLabel = 'Superposición',
  className,
  style,
  onMouseDown,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  children,
}: AgendaBookingBlockProps) {
  const durationMinutes = (endSlot - startSlot) * slotMinutes;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cx(
        'absolute left-1 right-1 rounded-lg text-[10px] shadow-sm overflow-visible',
        visibility.showDurationOnly ? 'px-2 flex items-center' : 'px-2 py-1.5 leading-tight',
        colorClass,
        className
      )}
      style={style}
    >
      <div className={cx('h-full rounded-lg overflow-hidden', visibility.showDurationOnly && 'flex items-center')}>
        {visibility.showDurationOnly ? (
          <p className="w-full truncate text-[11px] font-semibold leading-none">
            {isConflict ? conflictLabel : title}
          </p>
        ) : (
          <>
            {visibility.showBadge && (
              <div className="mb-0.5 flex flex-wrap gap-1">
                {isRecurring && <Repeat size={12} className="text-current" />}
                <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingBadgeColor(state)}`}>
                  {bookingStatusLabel(state)}
                </div>
                <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingPaymentBadgeColor(paymentState)}`}>
                  {bookingPaymentLabel(paymentState)}
                </div>
              </div>
            )}
            {visibility.showTitle && <p className="font-semibold truncate">{isConflict ? conflictLabel : title}</p>}
            {isConflict && visibility.showTimeRange && (
              <p className="font-semibold text-[#b42346]">{conflictLabel}</p>
            )}
            {visibility.showTimeRange && (
              <p className="opacity-70">
                {slotToTime(startSlot)} - {slotToTime(endSlot)}
              </p>
            )}
            {!visibility.showTitle && !visibility.showTimeRange && (
              <p className="text-[10px] font-bold leading-none">{durationMinutes} min</p>
            )}
            {children}
          </>
        )}
      </div>
    </div>
  );
}
