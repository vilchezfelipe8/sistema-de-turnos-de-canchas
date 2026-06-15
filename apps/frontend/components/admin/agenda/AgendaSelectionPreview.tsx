import { Calendar, Repeat, Check } from 'lucide-react';

type DraftRange = {
  start: number;
  end: number;
};

type BlockContentVisibility = {
  showDurationOnly: boolean;
  showBadge: boolean;
  showTitle: boolean;
  showTimeRange: boolean;
  inlineTimeWithBadges?: boolean;
};

type BookingState = 'pending' | 'confirmed' | 'completed' | 'blocked';
type PaymentState = 'paid' | 'partial' | 'unpaid';

type AgendaSelectionPreviewProps = {
  range: DraftRange;
  slotHeight: number;
  slotMinutes: number;
  visibility: BlockContentVisibility;
  slotToTime: (slot: number) => string;
  isEditingMovedBookingPreview: boolean;
  isConflict: boolean;
  title: string;
  state?: BookingState;
  paymentState?: PaymentState;
  isRecurring?: boolean;
};

function paymentStatePillClass(state: PaymentState): string {
  if (state === 'paid') return 'bg-lima-200/90 text-ink-900';
  if (state === 'partial') return 'bg-amber-300/90 text-ink-900';
  return 'bg-ink-300/90 text-ink-900';
}

function paymentStatePillLabel(state: PaymentState): string {
  if (state === 'paid') return 'Pagado';
  if (state === 'partial') return 'Parcial';
  return 'Pendiente';
}

export default function AgendaSelectionPreview({
  range,
  slotHeight,
  slotMinutes,
  visibility,
  slotToTime,
  isEditingMovedBookingPreview,
  isConflict,
  title,
  state = 'pending',
  paymentState = 'unpaid',
  isRecurring = false,
}: AgendaSelectionPreviewProps) {
  const top = range.start * slotHeight + 2;
  const height = (range.end - range.start) * slotHeight - 4;
  const durationMinutes = (range.end - range.start) * slotMinutes;

  return (
    <div
      className={`pointer-events-none absolute left-1 right-1 rounded-lg text-xs subpixel-antialiased overflow-hidden ${
        visibility.showDurationOnly ? 'px-2 flex items-center' : 'px-2 py-1.5 leading-tight'
      } ${
        isEditingMovedBookingPreview
          ? isConflict
            ? 'bg-red-200 text-ink-900 border-2 border-red-300'
            : 'bg-lima-100 text-ink-900 opacity-80'
          : 'bg-lima-100 text-ink-900'
      }`}
      style={{ top, height }}
    >
      {visibility.showDurationOnly ? (
        <p className="w-full truncate text-xs font-bold leading-none">{title}</p>
      ) : (
        <>
          {visibility.showBadge && (
            <div className="mb-1 flex items-center gap-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-extrabold leading-none ${paymentStatePillClass(paymentState)}`}>
                {paymentState === 'paid' && <Check size={14} className="shrink-0" />}
                {paymentStatePillLabel(paymentState)}
              </span>
              {isRecurring ? (
                <Repeat size={20} className="opacity-80 shrink-0" />
              ) : (
                <Calendar size={20} className="opacity-80 shrink-0" />
              )}
            </div>
          )}
          {visibility.showTitle && (
            visibility.inlineTimeWithBadges && visibility.showTimeRange ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold truncate min-w-0">
                  {isConflict ? 'Superposicion' : title}
                </p>
                <span className="text-[12px] font-bold opacity-80 whitespace-nowrap">
                  {slotToTime(range.start)} - {slotToTime(range.end)}
                </span>
              </div>
            ) : (
              <p className="text-xs font-bold truncate">
                {isConflict ? 'Superposicion' : title}
              </p>
            )
          )}
          {isConflict && visibility.showTimeRange && (
            <p className="text-xs font-bold text-red-700">Superposicion</p>
          )}
          {visibility.showTimeRange && !visibility.inlineTimeWithBadges && (
            <p className="text-[11px] font-semibold opacity-75">
              {slotToTime(range.start)} - {slotToTime(range.end)}
            </p>
          )}
          {!visibility.showTitle && !visibility.showTimeRange && (
            <p className="text-xs font-bold leading-none">{durationMinutes} min</p>
          )}
        </>
      )}
    </div>
  );
}
