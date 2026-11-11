import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, DollarSign, Lock, Plus, Repeat, Search, Users, X } from 'lucide-react';
import type { Booking, Court } from './types/agendaTypes';
import { slotMinutes, slotToTime, startHour, totalSlots } from './utils/agendaDateUtils';
import { bookingColor, isSettledPastBooking } from './utils/agendaDisplayUtils';
import AgendaColorLegend from './AgendaColorLegend';
import type { AgendaRuleSlot } from './utils/agendaBookingRules';
import AgendaDaySummary, { computeAgendaDaySummary } from './AgendaDaySummary';

/** Turnos que el club acepta en una cancha: inicios, duraciones y slots reservables. */
export type AgendaMobileCourtRules = {
  ruleSlots: AgendaRuleSlot[];
  mask: boolean[];
  durations: number[];
};

type AgendaMobileGridProps = {
  courts: Court[];
  bookings: Booking[];
  availableSports: string[];
  sportFilter: string;
  selectedDate: Date;
  onSportFilterChange: (sport: string) => void;
  onDateChange: (date: Date) => void;
  onMoveDate: (days: number) => void;
  onOpenBooking: (booking: Booking) => void;
  onCreateAt: (courtId: string, startSlot: number, endSlot: number) => void;
  onCreateBooking: () => void;
  onConfirmBooking: (booking: Booking) => Promise<void>;
  onChargeBooking: (booking: Booking) => void;
  /** Reglas por cancha (id). Sin reglas, la cancha usa duraciones libres. */
  courtRules?: Map<string, AgendaMobileCourtRules>;
  /** Slots del día que ya pasaron. */
  pastSlotCount?: number;
  /** Abre el buscador "¿Hay lugar?". */
  onFindFreeSlot?: () => void;
};

type FreeSelection = {
  courtId: string;
  startSlot: number;
  maxEndSlot: number;
  durationSlots: number;
};

/** Alto en px de un slot de 15 minutos en mobile (68px por hora). */
const MOBILE_SLOT_PX = 17;
const GUTTER_PX = 44;
const MIN_COLUMN_PX = 84;
const DURATION_OPTIONS_MIN = [60, 90, 120];
const EPSILON = 0.009;

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatAmount = (amount: number) => `$ ${Math.round(amount).toLocaleString('es-AR')}`;

const formatCompactAmount = (amount: number) =>
  amount >= 1000 ? `$${Math.round(amount / 1000)}k` : `$${Math.round(amount)}`;

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
};

function paymentPillClass(state: Booking['paymentState']) {
  if (state === 'paid') return 'bg-lima-200/90 text-ink-900';
  if (state === 'partial') return 'bg-amber-300/90 text-ink-900';
  return 'bg-ink-300/90 text-ink-900';
}

function stateChip(state: Booking['state']) {
  if (state === 'confirmed') return { label: 'Confirmada', className: 'bg-p-positive-bg text-p-accent' };
  if (state === 'completed') return { label: 'Finalizada', className: 'bg-blue-100 text-ink-900' };
  if (state === 'blocked') return { label: 'Bloqueo', className: 'bg-red-100 text-red-900' };
  if (state === 'class') return { label: 'Clase', className: 'bg-sky-100 text-sky-900' };
  return { label: 'Sin confirmar', className: 'bg-p-warning-bg text-p-warning' };
}

function stateStripeClass(state: Booking['state']) {
  if (state === 'confirmed') return 'bg-lima-100';
  if (state === 'completed') return 'bg-blue-100';
  if (state === 'blocked') return 'bg-red-100';
  if (state === 'class') return 'bg-sky-200';
  return 'bg-amber-200';
}

export default function AgendaMobileGrid({
  courts,
  bookings,
  availableSports,
  sportFilter,
  selectedDate,
  onSportFilterChange,
  onDateChange,
  onMoveDate,
  onOpenBooking,
  onCreateAt,
  onCreateBooking,
  onConfirmBooking,
  onChargeBooking,
  courtRules,
  pastSlotCount = 0,
  onFindFreeSlot,
}: AgendaMobileGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoScrollKeyRef = useRef('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [freeSelection, setFreeSelection] = useState<FreeSelection | null>(null);
  const [previewBookingId, setPreviewBookingId] = useState<string | null>(null);
  const [confirmingPreview, setConfirmingPreview] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dateKey = formatLocalDate(selectedDate);

  useEffect(() => {
    setFreeSelection(null);
    setPreviewBookingId(null);
  }, [dateKey, sportFilter]);

  const now = new Date(nowTick);
  const isToday = isSameDay(selectedDate, now);
  const minutesFromStart = now.getHours() * 60 + now.getMinutes() - startHour * 60;
  const nowTop = isToday ? (minutesFromStart / slotMinutes) * MOBILE_SLOT_PX : null;
  const showNowLine = nowTop !== null && nowTop >= 0 && nowTop <= totalSlots * MOBILE_SLOT_PX;
  const gridHeight = totalSlots * MOBILE_SLOT_PX;

  const bookingsByCourt = useMemo(() => {
    const map = new Map<string, Booking[]>();
    bookings.forEach((booking) => {
      const list = map.get(booking.courtId) || [];
      list.push(booking);
      map.set(booking.courtId, list);
    });
    map.forEach((list) => list.sort((a, b) => a.startSlot - b.startSlot));
    return map;
  }, [bookings]);

  const summary = useMemo(() => {
    const courtMasks = new Map<string, boolean[]>();
    courtRules?.forEach((rules, courtId) => courtMasks.set(courtId, rules.mask));
    return computeAgendaDaySummary({ bookings, courts, courtMasks, pastSlotCount });
  }, [bookings, courts, courtRules, pastSlotCount]);

  const previewBooking = useMemo(
    () => (previewBookingId ? bookings.find((booking) => String(booking.id) === previewBookingId) || null : null),
    [bookings, previewBookingId]
  );

  // Si el refresco automático hace desaparecer el turno abierto en la vista rápida, la cerramos.
  useEffect(() => {
    if (previewBookingId && !previewBooking) setPreviewBookingId(null);
  }, [previewBooking, previewBookingId]);

  // Scroll inicial por fecha: hoy → hora actual; otro día → primer turno.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || lastAutoScrollKeyRef.current === dateKey) return;
    let targetTop: number | null = null;
    if (isToday && nowTop !== null) {
      targetTop = Math.max(0, nowTop - 96);
    } else if (bookings.length > 0) {
      const firstSlot = Math.min(...bookings.map((booking) => booking.startSlot));
      targetTop = Math.max(0, firstSlot * MOBILE_SLOT_PX - 24);
    }
    if (targetTop === null) return;
    container.scrollTop = targetTop;
    lastAutoScrollKeyRef.current = dateKey;
  }, [bookings, dateKey, isToday, nowTop]);

  const handleColumnClick = (event: ReactMouseEvent<HTMLDivElement>, court: Court) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const rawSlot = Math.floor(offsetY / MOBILE_SLOT_PX);
    const tappedSlot = Math.max(0, Math.min(totalSlots - 1, rawSlot));
    const courtBookings = bookingsByCourt.get(court.id) || [];
    if (tappedSlot < pastSlotCount) {
      setPreviewBookingId(null);
      setFreeSelection(null);
      return;
    }
    const rules = courtRules?.get(court.id);
    let startSlot = Math.max(0, Math.min(totalSlots - 1, tappedSlot - (tappedSlot % 2)));
    if (rules) {
      // El inicio válido más cercano antes (o en) el toque, que no choque con otra reserva.
      const isFree = (slot: AgendaRuleSlot) =>
        slot.startSlot >= pastSlotCount &&
        !courtBookings.some((booking) => slot.startSlot < booking.endSlot && slot.endSlot > booking.startSlot);
      const candidates = rules.ruleSlots.filter(
        (slot) => rules.durations.includes(slot.durationMinutes) && slot.startSlot <= tappedSlot && tappedSlot < slot.endSlot && isFree(slot)
      );
      if (candidates.length === 0) {
        setPreviewBookingId(null);
        setFreeSelection(null);
        return;
      }
      startSlot = Math.max(...candidates.map((slot) => slot.startSlot));
    }
    if (courtBookings.some((booking) => startSlot < booking.endSlot && startSlot + 1 > booking.startSlot)) return;
    const nextBooking = courtBookings.find((booking) => booking.startSlot > startSlot);
    const maxEndSlot = nextBooking ? nextBooking.startSlot : totalSlots;
    const ruleDurationsHere = rules
      ? rules.ruleSlots
          .filter((slot) => slot.startSlot === startSlot && slot.endSlot <= maxEndSlot && rules.durations.includes(slot.durationMinutes))
          .map((slot) => slot.durationMinutes)
          .sort((a, b) => a - b)
      : [];
    const defaultMinutes = ruleDurationsHere.includes(Number(court.defaultDurationMinutes))
      ? Number(court.defaultDurationMinutes)
      : ruleDurationsHere[0] ?? Number(court.defaultDurationMinutes || 60);
    const defaultSlots = Math.max(1, Math.round(defaultMinutes / slotMinutes));
    setPreviewBookingId(null);
    setFreeSelection({
      courtId: court.id,
      startSlot,
      maxEndSlot,
      durationSlots: Math.min(defaultSlots, maxEndSlot - startSlot),
    });
  };

  const selectionCourt = freeSelection ? courts.find((court) => court.id === freeSelection.courtId) : null;
  const previewCourt = previewBooking ? courts.find((court) => court.id === previewBooking.courtId) : null;
  const durationOptions = useMemo(() => {
    const rules = freeSelection ? courtRules?.get(freeSelection.courtId) : undefined;
    if (rules && freeSelection) {
      // Solo las duraciones que el club ofrece a ese horario.
      const fromRules = rules.ruleSlots
        .filter((slot) => slot.startSlot === freeSelection.startSlot && rules.durations.includes(slot.durationMinutes))
        .map((slot) => slot.durationMinutes);
      const unique = Array.from(new Set(fromRules)).sort((a, b) => a - b);
      if (unique.length > 0) return unique;
    }
    const defaults = new Set(DURATION_OPTIONS_MIN);
    if (selectionCourt?.defaultDurationMinutes) defaults.add(Number(selectionCourt.defaultDurationMinutes));
    return Array.from(defaults).sort((a, b) => a - b);
  }, [courtRules, freeSelection, selectionCourt?.defaultDurationMinutes]);

  const dateLabel = selectedDate.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  const showSportChips = availableSports.length > 2;
  const hasSheetOpen = Boolean(freeSelection || previewBooking);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-p-bg">
      {/* ── Barra fija: fecha, filtros y resumen ── */}
      <div className="shrink-0 space-y-2 border-b border-p-border bg-p-bg px-3.5 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 items-center overflow-hidden rounded-xl border border-p-border bg-p-surface">
            <button
              type="button"
              onClick={() => onMoveDate(-1)}
              className="grid h-9 w-9 place-items-center text-p-text-muted transition hover:bg-p-surface-2"
              aria-label="Día anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <label className="relative inline-flex h-9 items-center gap-1.5 px-1 text-[14px] font-extrabold capitalize text-p-text">
              <CalendarDays size={14} className="text-p-text-muted" />
              <span className="tabular-nums">{dateLabel}</span>
              <input
                ref={dateInputRef}
                type="date"
                value={dateKey}
                onClick={() => {
                  const input = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
                  try {
                    input?.showPicker?.();
                  } catch {
                    // El navegador abre su selector nativo al tocar el input.
                  }
                }}
                onChange={(event) => {
                  const next = new Date(`${event.target.value}T12:00:00`);
                  if (!Number.isNaN(next.getTime())) onDateChange(next);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Seleccionar fecha"
              />
            </label>
            <button
              type="button"
              onClick={() => onMoveDate(1)}
              className="grid h-9 w-9 place-items-center text-p-text-muted transition hover:bg-p-surface-2"
              aria-label="Día siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isToday) onDateChange(new Date());
              const container = scrollRef.current;
              if (container && nowTop !== null && isToday) container.scrollTo({ top: Math.max(0, nowTop - 96), behavior: 'smooth' });
            }}
            className={`h-9 rounded-xl border px-3 text-[12px] font-extrabold transition ${
              isToday
                ? 'border-lima-300/50 bg-p-positive-bg text-p-accent'
                : 'border-p-border bg-p-surface text-p-text-secondary'
            }`}
          >
            Hoy
          </button>
          {onFindFreeSlot && (
            <button
              type="button"
              onClick={onFindFreeSlot}
              className="ml-auto inline-flex h-9 items-center gap-1 rounded-xl border border-p-border bg-p-surface px-2.5 text-[12px] font-extrabold text-p-text-secondary"
              aria-label="¿Hay lugar?"
            >
              <Search size={14} />
              Lugar
            </button>
          )}
        </div>

        {showSportChips && (
          <div className="-mx-3.5 overflow-x-auto px-3.5">
            <div className="flex w-max gap-1.5">
              {availableSports.map((sport) => (
                <button
                  key={`mobile-grid-sport-${sport}`}
                  type="button"
                  onClick={() => onSportFilterChange(sport)}
                  className={`h-[30px] rounded-[9px] px-3 text-[12px] transition ${
                    sportFilter === sport
                      ? 'bg-ink-900 font-bold text-ink-50'
                      : 'bg-p-surface-2 font-semibold text-p-text-muted'
                  }`}
                >
                  {sport}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <AgendaDaySummary summary={summary} className="min-w-0 flex-wrap gap-y-0.5 text-[11px] font-bold" />
          <div className="shrink-0">
            <AgendaColorLegend variant="mobile" align="right" />
          </div>
        </div>
      </div>

      {/* ── Grilla ── */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        {courts.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center text-[13px] text-p-text-muted">
            No hay canchas para mostrar con este filtro.
          </div>
        ) : (
          <div className="relative w-max min-w-full pb-24">
            {/* Encabezado de canchas */}
            <div className="sticky top-0 z-20 flex border-b border-p-border bg-p-surface">
              <div className="sticky left-0 z-10 shrink-0 bg-p-surface" style={{ width: GUTTER_PX }} />
              {courts.map((court) => (
                <div
                  key={`mobile-grid-head-${court.id}`}
                  className="border-l border-p-border px-1 py-1.5 text-center"
                  style={{ flex: `1 0 ${MIN_COLUMN_PX}px` }}
                >
                  <p className="truncate text-[11px] font-extrabold text-p-text-secondary">{court.name}</p>
                  {court.sport && <p className="truncate text-[9px] font-semibold text-p-text-muted">{court.sport}</p>}
                </div>
              ))}
            </div>

            <div className="relative flex pt-2">
              {/* Columna de horas */}
              <div className="sticky left-0 z-10 shrink-0 bg-p-bg" style={{ width: GUTTER_PX, height: gridHeight }}>
                {Array.from({ length: totalSlots / 4 + 1 }).map((_, hourIndex) => (
                  <span
                    key={`mobile-grid-hour-${hourIndex}`}
                    className="absolute left-0 w-full -translate-y-1.5 text-center text-[10px] font-bold text-p-text-muted tabular-nums"
                    style={{ top: hourIndex * 4 * MOBILE_SLOT_PX }}
                  >
                    {slotToTime(hourIndex * 4)}
                  </span>
                ))}
                {showNowLine && (
                  <span
                    className="absolute left-0.5 z-10 -translate-y-1/2 rounded-md bg-red-300 px-1 py-px text-[9px] font-extrabold text-ink-900 tabular-nums"
                    style={{ top: nowTop as number }}
                  >
                    {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                  </span>
                )}
              </div>

              {courts.map((court) => {
                const courtBookings = bookingsByCourt.get(court.id) || [];
                const isSelectionColumn = freeSelection?.courtId === court.id;
                return (
                  <div
                    key={`mobile-grid-col-${court.id}`}
                    role="presentation"
                    onClick={(event) => handleColumnClick(event, court)}
                    className="relative border-l border-p-border"
                    style={{
                      flex: `1 0 ${MIN_COLUMN_PX}px`,
                      height: gridHeight,
                      backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${MOBILE_SLOT_PX * 4}px)`,
                    }}
                  >
                    {pastSlotCount > 0 && (
                      <div
                        className="pointer-events-none absolute inset-x-0 top-0 bg-p-surface-2/70"
                        style={{ height: Math.min(pastSlotCount, totalSlots) * MOBILE_SLOT_PX }}
                      />
                    )}
                    {(() => {
                      const mask = courtRules?.get(court.id)?.mask;
                      if (!mask) return null;
                      const ranges: Array<[number, number]> = [];
                      let rangeStart = -1;
                      for (let slot = 0; slot <= totalSlots; slot += 1) {
                        const blocked = slot < totalSlots && mask[slot] === false && slot >= pastSlotCount;
                        if (blocked && rangeStart < 0) rangeStart = slot;
                        if (!blocked && rangeStart >= 0) {
                          ranges.push([rangeStart, slot]);
                          rangeStart = -1;
                        }
                      }
                      return ranges.map(([from, to]) => (
                        <div
                          key={`mobile-closed-${court.id}-${from}`}
                          className="pointer-events-none absolute inset-x-0 bg-p-surface-2"
                          style={{
                            top: from * MOBILE_SLOT_PX,
                            height: (to - from) * MOBILE_SLOT_PX,
                            backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 7px)',
                          }}
                        />
                      ));
                    })()}
                    {courtBookings.map((booking) => {
                      const top = booking.startSlot * MOBILE_SLOT_PX + 2;
                      const height = Math.max(14, (booking.endSlot - booking.startSlot) * MOBILE_SLOT_PX - 4);
                      const isBlocked = booking.state === 'blocked';
                      const isClass = booking.state === 'class';
                      const remaining = Number(booking.hoverPayment?.remainingAmount || 0);
                      const isPreviewed = previewBookingId === String(booking.id);
                      return (
                        <button
                          key={`mobile-grid-booking-${booking.id}`}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setFreeSelection(null);
                            setPreviewBookingId(String(booking.id));
                          }}
                          className={`absolute left-[3px] right-[3px] flex flex-col gap-0.5 overflow-hidden rounded-[9px] px-1.5 py-1 text-left leading-tight ${bookingColor(
                            booking.state
                          )} ${isBlocked ? 'bg-[repeating-linear-gradient(135deg,#FEE2E2,#FEE2E2_6px,#FECACA_6px,#FECACA_12px)] text-red-900' : ''} ${
                            isPreviewed ? 'ring-2 ring-p-brand ring-offset-1 ring-offset-[var(--bg)]' : ''
                          } ${isSettledPastBooking(booking, pastSlotCount) && !isPreviewed ? 'opacity-50' : ''}`}
                          style={{ top, height }}
                        >
                          <span className="flex min-w-0 items-center gap-1">
                            {isBlocked && <Lock size={10} className="shrink-0" />}
                            <span className="truncate text-[11px] font-extrabold">{booking.title || (isBlocked ? 'Bloqueo' : 'Reserva')}</span>
                            {booking.isRecurring && <Repeat size={10} className="shrink-0 opacity-70" />}
                          </span>
                          {height >= 30 && (
                            <span className="truncate text-[10px] font-semibold opacity-70 tabular-nums">
                              {booking.startTimeLabel && booking.endTimeLabel ? `${booking.startTimeLabel}–${booking.endTimeLabel}` : `${slotToTime(booking.startSlot)}–${slotToTime(booking.endSlot)}`}
                            </span>
                          )}
                          {height >= 52 && isClass && booking.classInfo?.enrolled != null && (
                            <span className="self-start rounded-full bg-sky-700 px-1.5 py-px text-[9px] font-extrabold text-white">
                              {booking.classInfo.enrolled}/{booking.classInfo.capacity}
                            </span>
                          )}
                          {height >= 52 && !isBlocked && !isClass && (
                            <span
                              className={`self-start rounded-full px-1.5 py-px text-[9px] font-extrabold ${paymentPillClass(
                                booking.paymentState
                              )}`}
                            >
                              {booking.paymentState !== 'paid' && remaining > EPSILON ? formatCompactAmount(remaining) : 'Pagado'}
                            </span>
                          )}
                          {booking.hasPendingNotification && (
                            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink-900/80" />
                          )}
                        </button>
                      );
                    })}

                    {isSelectionColumn && freeSelection && (
                      <div
                        className="pointer-events-none absolute left-[3px] right-[3px] flex flex-col items-center justify-center rounded-[9px] border-2 border-p-brand bg-p-positive-bg text-p-accent"
                        style={{
                          top: freeSelection.startSlot * MOBILE_SLOT_PX + 2,
                          height: freeSelection.durationSlots * MOBILE_SLOT_PX - 4,
                        }}
                      >
                        <span className="text-[11px] font-extrabold">Nuevo</span>
                        <span className="text-[10px] font-bold tabular-nums">
                          {slotToTime(freeSelection.startSlot)}–{slotToTime(freeSelection.startSlot + freeSelection.durationSlots)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {showNowLine && (
                <div
                  className="pointer-events-none absolute right-0 z-[5] h-0.5 bg-red-300"
                  style={{ top: (nowTop as number) + 8, left: GUTTER_PX - 4 }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {!hasSheetOpen && (
        <button
          type="button"
          onClick={onCreateBooking}
          className="absolute bottom-4 right-4 z-30 inline-flex h-12 items-center gap-2 rounded-2xl bg-p-brand px-4 text-[14px] font-extrabold text-p-brand-on shadow-p-lg"
        >
          <Plus size={17} strokeWidth={2.75} />
          Nueva reserva
        </button>
      )}

      {/* ── Hoja: hueco libre ── */}
      {freeSelection && selectionCourt && (
        <section className="absolute inset-x-0 bottom-0 z-40 space-y-3 rounded-t-[22px] border border-b-0 border-p-border bg-p-surface px-4 pb-4 pt-2.5 shadow-p-lg">
          <span className="mx-auto block h-1 w-10 rounded-full bg-p-border-strong" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-extrabold text-p-text">
                {selectionCourt.name}
                {selectionCourt.sport ? <span className="font-semibold text-p-text-muted"> · {selectionCourt.sport}</span> : null}
              </p>
              <p className="mt-0.5 text-[12px] font-semibold capitalize text-p-text-secondary">
                {dateLabel} · {slotToTime(freeSelection.startSlot)} a {slotToTime(freeSelection.startSlot + freeSelection.durationSlots)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFreeSelection(null)}
              aria-label="Cerrar"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-p-border text-p-text-muted"
            >
              <X size={14} />
            </button>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold text-p-text-muted">Duración</p>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${durationOptions.length}, minmax(0, 1fr))` }}>
              {durationOptions.map((minutes) => {
                const slots = Math.max(1, Math.round(minutes / slotMinutes));
                const fits = freeSelection.startSlot + slots <= freeSelection.maxEndSlot;
                const active = freeSelection.durationSlots === slots;
                return (
                  <button
                    key={`mobile-grid-duration-${minutes}`}
                    type="button"
                    disabled={!fits}
                    onClick={() => setFreeSelection((current) => (current ? { ...current, durationSlots: slots } : current))}
                    className={`h-9 rounded-[10px] border text-[12px] font-bold transition disabled:cursor-not-allowed disabled:text-p-text-muted disabled:line-through disabled:opacity-50 ${
                      active
                        ? 'border-lima-300/60 bg-p-positive-bg text-p-accent'
                        : 'border-p-border bg-p-surface-2 text-p-text-secondary'
                    }`}
                  >
                    {formatDuration(minutes)}
                  </button>
                );
              })}
            </div>
            {freeSelection.maxEndSlot - freeSelection.startSlot < Math.round((durationOptions[0] ?? DURATION_OPTIONS_MIN[0]) / slotMinutes) && (
              <p className="mt-1.5 text-[11px] text-p-text-muted">
                Hay {formatDuration((freeSelection.maxEndSlot - freeSelection.startSlot) * slotMinutes)} libres hasta la próxima reserva.
              </p>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <button
              type="button"
              onClick={() => setFreeSelection(null)}
              className="h-[46px] rounded-xl border border-p-border text-[13px] font-bold text-p-text-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                const selection = freeSelection;
                setFreeSelection(null);
                onCreateAt(selection.courtId, selection.startSlot, selection.startSlot + selection.durationSlots);
              }}
              className="h-[46px] rounded-xl bg-p-brand text-[14px] font-extrabold text-p-brand-on"
            >
              Continuar reserva
            </button>
          </div>
        </section>
      )}

      {/* ── Hoja: vista rápida del turno ── */}
      {previewBooking && (
        <>
          <button
            type="button"
            aria-label="Cerrar vista rápida"
            className="absolute inset-0 z-30 bg-ink-900/45"
            onClick={() => setPreviewBookingId(null)}
          />
          <section className="absolute inset-x-0 bottom-0 z-40 space-y-3.5 rounded-t-[22px] border border-b-0 border-p-border bg-p-surface px-4 pb-4 pt-2.5 shadow-p-lg">
            <span className="mx-auto block h-1 w-10 rounded-full bg-p-border-strong" />
            {(() => {
              const chip = stateChip(previewBooking.state);
              const payment = previewBooking.hoverPayment;
              const remaining = Number(payment?.remainingAmount || 0);
              const isBlocked = previewBooking.state === 'blocked';
              const isClass = previewBooking.state === 'class';
              const canConfirm = previewBooking.state === 'pending';
              const canCharge =
                (previewBooking.state === 'confirmed' || previewBooking.state === 'completed') && remaining > EPSILON;
              return (
                <>
                  <div className="flex items-start gap-3">
                    <span className={`w-1.5 self-stretch rounded-full ${stateStripeClass(previewBooking.state)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[17px] font-extrabold text-p-text">
                          {previewBooking.title || (isBlocked ? 'Bloqueo' : 'Reserva')}
                        </p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${chip.className}`}>{chip.label}</span>
                        {previewBooking.isRecurring && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-p-surface-2 px-2 py-0.5 text-[10px] font-bold text-p-text-secondary">
                            <Repeat size={10} /> Fijo
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] font-semibold text-p-text-secondary">
                        <span>{previewCourt?.name || 'Cancha'}</span>
                        {previewCourt?.sport ? <span>· {previewCourt.sport}</span> : null}
                        <span className="tabular-nums">
                          · {previewBooking.startTimeLabel ?? slotToTime(previewBooking.startSlot)} a {previewBooking.endTimeLabel ?? slotToTime(previewBooking.endSlot)}
                        </span>
                        {!isBlocked && !isClass && Number(previewBooking.participantsCount || 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            · <Users size={11} /> {previewBooking.participantsCount}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {isClass && previewBooking.classInfo && (
                    <p className="text-[13px] text-p-text-secondary">
                      {previewBooking.classInfo.teacherName ? `Con ${previewBooking.classInfo.teacherName}` : 'Clase de Academia'}
                      {previewBooking.classInfo.enrolled != null
                        ? ` · ${previewBooking.classInfo.enrolled} de ${previewBooking.classInfo.capacity} anotados`
                        : ''}
                      . La cancha queda ocupada.
                    </p>
                  )}

                  {!isBlocked && !isClass && payment && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-[10px] bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Total</p>
                        <p className="mt-0.5 text-[14px] font-bold text-p-text tabular-nums">{formatAmount(Number(payment.totalAmount || 0))}</p>
                      </div>
                      <div className="rounded-[10px] bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Pagado</p>
                        <p className="mt-0.5 text-[14px] font-bold text-p-positive tabular-nums">{formatAmount(Number(payment.paidAmount || 0))}</p>
                      </div>
                      <div className="rounded-[10px] bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Deuda</p>
                        <p className={`mt-0.5 text-[14px] font-bold tabular-nums ${remaining > EPSILON ? 'text-p-warning' : 'text-p-text'}`}>
                          {formatAmount(remaining)}
                        </p>
                      </div>
                    </div>
                  )}

                  {(canConfirm || canCharge) && (
                    <div className={`grid gap-2 ${canConfirm && canCharge ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {canConfirm && (
                        <button
                          type="button"
                          disabled={confirmingPreview}
                          onClick={async () => {
                            try {
                              setConfirmingPreview(true);
                              await onConfirmBooking(previewBooking);
                            } finally {
                              setConfirmingPreview(false);
                            }
                          }}
                          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-lima-300/50 text-[13px] font-extrabold text-p-accent disabled:opacity-50"
                        >
                          <Check size={15} strokeWidth={2.75} />
                          {confirmingPreview ? 'Confirmando...' : 'Confirmar'}
                        </button>
                      )}
                      {canCharge && (
                        <button
                          type="button"
                          onClick={() => {
                            const booking = previewBooking;
                            setPreviewBookingId(null);
                            onChargeBooking(booking);
                          }}
                          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-p-border bg-p-surface-2 text-[13px] font-extrabold text-p-text"
                        >
                          <DollarSign size={15} />
                          Cobrar
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const booking = previewBooking;
                      setPreviewBookingId(null);
                      onOpenBooking(booking);
                    }}
                    className="h-12 w-full rounded-xl bg-p-brand text-[14px] font-extrabold text-p-brand-on"
                  >
                    {isClass ? 'Ver clase en Academia' : isBlocked ? 'Ver bloqueo' : 'Ver reserva completa'}
                  </button>
                </>
              );
            })()}
          </section>
        </>
      )}
    </div>
  );
}
