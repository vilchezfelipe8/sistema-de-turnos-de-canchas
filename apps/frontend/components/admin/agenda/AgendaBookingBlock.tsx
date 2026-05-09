import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Calendar, Repeat, Check, Users } from 'lucide-react';

type BookingState = 'pending' | 'confirmed' | 'completed' | 'blocked';
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

type SportIconKind = 'tennis' | 'football' | null;

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

function PaymentStateCompactIcon({ state }: { state: PaymentState }) {
  if (state === 'paid') return <Check size={14} className="shrink-0" />;
  if (state === 'partial') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
        <path d="M12 3.5A8.5 8.5 0 0 0 12 20.5Z" fill="currentColor" />
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3.5V20.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function resolveSportIconKind(sportLabel: string): SportIconKind {
  const normalized = String(sportLabel || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('padel') || normalized.includes('padel')) return 'tennis';
  if (normalized.includes('tenis') || normalized.includes('tennis')) return 'tennis';
  if (normalized.includes('fut') || normalized.includes('football') || normalized.includes('soccer')) return 'football';
  return null;
}

function SportIcon({ kind, label }: { kind: SportIconKind; label: string }) {
  if (!kind) return null;

  if (kind === 'tennis') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-label={`Deporte: ${label}`}
        role="img"
        className="shrink-0 opacity-80"
      >
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M8 4.8c2 1.5 3.2 4.2 3.2 7.2S10 17.7 8 19.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M16 4.8c-2 1.5-3.2 4.2-3.2 7.2s1.2 5.7 3.2 7.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-label={`Deporte: ${label}`}
      role="img"
      className="shrink-0 opacity-80"
    >
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 8.2l2.1 1.5-.8 2.4h-2.6l-.8-2.4 2.1-1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 12.1l-1.9 1.7m7.1-1.7l1.9 1.7m-5.6 2.2h2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
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
  const debtAmount = typeof remainingAmount === 'number' ? remainingAmount : totalAmount;
  const showAmountPill = paymentState !== 'paid' && typeof debtAmount === 'number' && debtAmount > 0;
  const sportIconKind = resolveSportIconKind(sportLabel);

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
            <div className="mb-1 flex items-center gap-1 flex-wrap">
              <span
                className={`inline-flex items-center justify-center rounded-full px-2.5 py-[3px] leading-none ${paymentStatePillClass(paymentState)}`}
                title={paymentState === 'paid' ? 'Pagado' : paymentState === 'partial' ? 'Parcial' : 'Pendiente'}
                aria-label={paymentState === 'paid' ? 'Pagado' : paymentState === 'partial' ? 'Parcial' : 'Pendiente'}
              >
                <PaymentStateCompactIcon state={paymentState} />
              </span>
              {showAmountPill && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2.5 py-1 text-[13px] font-extrabold leading-none">
                  {formatAmount(debtAmount!)}
                </span>
              )}
              {participantsCount > 1 && (
                <span className="inline-flex items-center justify-center" title="Participantes">
                  <Users size={20} className="shrink-0 opacity-80" />
                </span>
              )}
              {isRecurring ? (
                <Repeat size={20} className="opacity-80 shrink-0" />
              ) : (
                <Calendar size={20} className="opacity-80 shrink-0" />
              )}
              {sportIconKind && (
                <span className="inline-flex items-center justify-center" title={`Deporte: ${sportLabel}`}>
                  <SportIcon kind={sportIconKind} label={sportLabel} />
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
                  {slotToTime(startSlot)} - {slotToTime(endSlot)}
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
              {slotToTime(startSlot)} - {slotToTime(endSlot)}
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
