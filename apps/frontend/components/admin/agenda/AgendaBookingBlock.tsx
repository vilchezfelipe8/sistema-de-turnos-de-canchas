import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Repeat, Check } from 'lucide-react';

type BookingState = 'pending' | 'confirmed' | 'completed' | 'blocked' | 'class';
type PaymentState = 'paid' | 'partial' | 'unpaid';

type BlockContentVisibility = {
  showDurationOnly: boolean;
  showBadge: boolean;
  showTitle: boolean;
  showTimeRange: boolean;
  inlineTimeWithBadges?: boolean;
};

type AgendaBookingBlockProps = {
  title: string;
  state: BookingState;
  paymentState: PaymentState;
  totalAmount?: number;
  remainingAmount?: number;
  startSlot: number;
  endSlot: number;
  slotMinutes: number;
  visibility: BlockContentVisibility;
  slotToTime: (slot: number) => string;
  colorClass: string;
  isRecurring?: boolean;
  participantsCount?: number;
  sportLabel?: string;
  hasPendingNotification?: boolean;
  /** Reemplaza la etiqueta de pago (ej: clases). */
  badgeLabel?: string;
  /** Horario real a mostrar (si no, se arma con los slots, que se recortan al final de la grilla). */
  timeRangeLabel?: string;
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

function formatAmount(amount: number): string {
  if (amount >= 1000) return `$${Math.round(amount / 1000)}k`;
  return `$${Math.round(amount)}`;
}

function paymentStatePillClass(state: PaymentState): string {
  if (state === 'paid') return 'bg-lima-200/90 text-ink-900';
  if (state === 'partial') return 'bg-amber-300/90 text-ink-900';
  return 'bg-ink-300/90 text-ink-900';
}

export default function AgendaBookingBlock({
  title,
  state,
  paymentState,
  totalAmount,
  remainingAmount,
  startSlot,
  endSlot,
  slotMinutes,
  visibility,
  slotToTime,
  colorClass,
  isRecurring = false,
  participantsCount = 0,
  sportLabel = '',
  hasPendingNotification = false,
  badgeLabel,
  timeRangeLabel,
  isConflict = false,
  conflictLabel = 'Superposicion',
  className,
  style,
  onMouseDown,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  children,
}: AgendaBookingBlockProps) {
  const durationMinutes = (endSlot - startSlot) * slotMinutes;
  const timeLabel = timeRangeLabel || `${slotToTime(startSlot)} - ${slotToTime(endSlot)}`;
  const debtAmount = typeof remainingAmount === 'number' ? remainingAmount : totalAmount;
  const showAmountPill = paymentState !== 'paid' && typeof debtAmount === 'number' && debtAmount > 0;
  // Una sola etiqueta que se lee de un vistazo: pagado, o cuánto falta cobrar.
  const paymentLabel = badgeLabel
    ? badgeLabel
    : state === 'blocked'
      ? 'Bloqueado'
      : paymentState === 'paid'
      ? 'Pagado'
      : showAmountPill
        ? `Debe ${formatAmount(debtAmount!)}`
        : paymentState === 'partial'
          ? 'Parcial'
          : 'Sin cobrar';

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cx(
        'absolute left-1 right-1 rounded-lg text-xs subpixel-antialiased overflow-hidden',
        visibility.showDurationOnly ? 'px-2 flex items-center' : 'px-2 py-1.5 leading-tight',
        colorClass,
        className
      )}
      style={style}
    >
      {hasPendingNotification && (
        <span
          className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink-900/80"
          aria-label="Notificacion pendiente"
          title="Notificacion pendiente"
        />
      )}
      {visibility.showDurationOnly ? (
        <p className="w-full truncate text-xs font-bold leading-none">
          {isConflict ? conflictLabel : title}
        </p>
      ) : (
        <>
          {visibility.showBadge && (
            <div className="mb-1 flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-extrabold leading-none ${
                  state === 'blocked'
                    ? 'bg-ink-900/80 text-ink-50'
                    : state === 'class'
                      ? 'bg-sky-700 text-white'
                      : paymentStatePillClass(paymentState)
                }`}
              >
                {state !== 'blocked' && state !== 'class' && paymentState === 'paid' && <Check size={12} className="shrink-0" />}
                {paymentLabel}
              </span>
              {isRecurring && (
                <span title="Reserva fija" aria-label="Reserva fija" className="inline-flex">
                  <Repeat size={14} className="shrink-0 opacity-70" />
                </span>
              )}
            </div>
          )}

          {visibility.showTitle && (
            visibility.inlineTimeWithBadges && visibility.showTimeRange ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold truncate min-w-0">
                  {isConflict ? conflictLabel : title}
                </p>
                <span className="text-[12px] font-bold opacity-80 whitespace-nowrap">
                  {timeLabel}
                </span>
              </div>
            ) : (
              <p className="text-xs font-bold truncate">
                {isConflict ? conflictLabel : title}
              </p>
            )
          )}
          {isConflict && visibility.showTimeRange && (
            <p className="text-xs font-bold text-p-error">{conflictLabel}</p>
          )}
          {visibility.showTimeRange && !visibility.inlineTimeWithBadges && (
            <p className="text-[11px] font-semibold opacity-75">
              {timeLabel}
            </p>
          )}
          {!visibility.showTitle && !visibility.showTimeRange && (
            <p className="text-xs font-bold leading-none">{durationMinutes} min</p>
          )}
          {children}
        </>
      )}
    </div>
  );
}
