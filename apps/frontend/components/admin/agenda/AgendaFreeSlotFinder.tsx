import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import AdminOverlay from '../ui/AdminOverlay';
import { modalCloseButtonCls, modalPanelCls, modalTitleCls } from '../ui/adminModalStyles';
import type { Booking, Court } from './types/agendaTypes';
import type { AgendaRuleSlot } from './utils/agendaBookingRules';
import { slotMinutes, slotToTime, totalSlots } from './utils/agendaDateUtils';
import { adminButton } from '../ui/adminButton';
import { adminChip } from '../ui/adminChip';

export type AgendaFinderCourtRules = {
  ruleSlots: AgendaRuleSlot[];
  durations: number[];
};

export type AgendaFinderDay = 'today' | 'tomorrow' | 'other';

export type AgendaFreeSlotPick = {
  courtId: string;
  startSlot: number;
  endSlot: number;
  sport: string;
};

type AgendaFreeSlotFinderProps = {
  show: boolean;
  onClose: () => void;
  sports: string[];
  initialSport?: string;
  courts: Court[];
  /** Todo lo que ocupa cancha en el día cargado (reservas, bloqueos, clases). */
  bookings: Booking[];
  /** Turnos que acepta cada cancha. Sin reglas, la cancha acepta cualquier inicio en punto o y media. */
  courtRules: Map<string, AgendaFinderCourtRules>;
  pastSlotCount: number;
  /** false mientras llegan las reservas del día elegido. */
  ready: boolean;
  day: AgendaFinderDay;
  dayLabel: string;
  onDayChange: (day: 'today' | 'tomorrow') => void;
  onPick: (pick: AgendaFreeSlotPick) => void;
};

const FREE_MODE_DURATIONS = [60, 90, 120];

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
};

const chipClass = (active: boolean) => adminChip(active);

/** "¿Hay lugar?": horarios libres por deporte y duración, listos para tocar y reservar. */
function AgendaFreeSlotFinderPanel({
  show,
  onClose,
  sports,
  initialSport,
  courts,
  bookings,
  courtRules,
  pastSlotCount,
  ready,
  day,
  dayLabel,
  onDayChange,
  onPick,
}: AgendaFreeSlotFinderProps) {
  const [sport, setSport] = useState(() => initialSport && sports.includes(initialSport) ? initialSport : sports[0] || '');
  const [duration, setDuration] = useState(60);

  useEffect(() => {
    if (!show) return;
    setSport((current) => {
      if (initialSport && sports.includes(initialSport)) return initialSport;
      return sports.includes(current) ? current : sports[0] || '';
    });
  }, [show, initialSport, sports]);


  const sportCourts = useMemo(() => courts.filter((court) => court.sport === sport), [courts, sport]);

  const durationOptions = useMemo(() => {
    const set = new Set<number>();
    let anyWithoutRules = false;
    sportCourts.forEach((court) => {
      const rules = courtRules.get(court.id);
      if (!rules) {
        anyWithoutRules = true;
        return;
      }
      rules.durations.forEach((value) => set.add(value));
    });
    if (anyWithoutRules || set.size === 0) FREE_MODE_DURATIONS.forEach((value) => set.add(value));
    return Array.from(set).filter((value) => value % slotMinutes === 0).sort((a, b) => a - b);
  }, [sportCourts, courtRules]);

  useEffect(() => {
    if (durationOptions.length && !durationOptions.includes(duration)) {
      setDuration(durationOptions.includes(60) ? 60 : durationOptions[0]);
    }
  }, [durationOptions, duration]);

  const dayIsOver = pastSlotCount >= totalSlots;
  const minStartSlot = pastSlotCount > 0 ? pastSlotCount + 1 : 0;

  /** Horarios libres agrupados por inicio: { startSlot, endSlot, courts[] }. */
  const groups = useMemo(() => {
    if (dayIsOver) return [];
    const durationSlots = duration / slotMinutes;
    const byStart = new Map<number, { startSlot: number; endSlot: number; courts: Court[] }>();
    sportCourts.forEach((court) => {
      const courtBookings = bookings.filter((booking) => booking.courtId === court.id);
      const rules = courtRules.get(court.id);
      const candidates: Array<{ startSlot: number; endSlot: number }> = rules
        ? rules.ruleSlots.filter((slot) => slot.durationMinutes === duration)
        : Array.from({ length: Math.floor(totalSlots / 2) }, (_, index) => ({
            startSlot: index * 2,
            endSlot: index * 2 + durationSlots,
          })).filter((slot) => slot.endSlot <= totalSlots);
      candidates.forEach((slot) => {
        if (slot.startSlot < minStartSlot) return;
        const busy = courtBookings.some(
          (booking) => slot.startSlot < booking.endSlot && slot.endSlot > booking.startSlot
        );
        if (busy) return;
        const group = byStart.get(slot.startSlot) || { startSlot: slot.startSlot, endSlot: slot.endSlot, courts: [] };
        group.courts.push(court);
        byStart.set(slot.startSlot, group);
      });
    });
    return Array.from(byStart.values()).sort((a, b) => a.startSlot - b.startSlot);
  }, [dayIsOver, duration, sportCourts, bookings, courtRules, minStartSlot]);

  if (!show) return null;

  const dayWord = day === 'today' ? 'hoy' : day === 'tomorrow' ? 'mañana' : `el ${dayLabel}`;

  return (
    <div role="dialog" aria-modal="true" className={`${modalPanelCls} sm:max-w-[520px]`}>
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className={modalTitleCls}>¿Hay lugar?</h2>
          <p className="mt-1 text-[13px] text-p-text-muted">Elegí deporte y duración. Tocá un horario para reservarlo.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={modalCloseButtonCls}
          aria-label="Cerrar"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3 px-5 pb-3">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chipClass(day === 'today')} aria-pressed={day === 'today'} onClick={() => onDayChange('today')}>
            Hoy
          </button>
          <button type="button" className={chipClass(day === 'tomorrow')} aria-pressed={day === 'tomorrow'} onClick={() => onDayChange('tomorrow')}>
            Mañana
          </button>
          {day === 'other' && (
            <span className="inline-flex h-9 items-center rounded-xl border border-p-border px-3 text-[13px] font-bold capitalize text-p-text-secondary">
              {dayLabel}
            </span>
          )}
        </div>
        {sports.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {sports.map((item) => (
              <button key={item} type="button" className={chipClass(sport === item)} aria-pressed={sport === item} onClick={() => setSport(item)}>
                {item}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {durationOptions.map((value) => (
            <button key={value} type="button" className={chipClass(duration === value)} aria-pressed={duration === value} onClick={() => setDuration(value)}>
              {formatDuration(value)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[140px] flex-1 overflow-y-auto border-t border-p-border px-5 py-3">
        {!ready ? (
          <p className="py-6 text-center text-[13px] text-p-text-muted">Buscando lugar…</p>
        ) : dayIsOver ? (
          <p className="py-6 text-center text-[13px] text-p-text-muted">Este día ya pasó. Elegí hoy o mañana.</p>
        ) : sportCourts.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-p-text-muted">No hay canchas de {sport}.</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-p-text-muted">
            No queda lugar de {formatDuration(duration)} para {sport} {dayWord}. Probá otra duración u otro día.
          </p>
        ) : (
          <ul className="space-y-1.5">
            <li className="pb-1 text-[12px] font-bold text-p-text-muted">
              {groups.length} {groups.length === 1 ? 'horario libre' : 'horarios libres'} {dayWord}
            </li>
            {groups.map((group) => (
              <li key={group.startSlot} className="flex items-center gap-3 rounded-xl bg-p-surface-2 px-3 py-2">
                <span className="w-[104px] shrink-0 text-[14px] font-extrabold tabular-nums text-p-text">
                  {slotToTime(group.startSlot)} a {slotToTime(group.endSlot)}
                </span>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {group.courts.map((court) => (
                    <button
                      key={court.id}
                      type="button"
                      onClick={() => onPick({ courtId: court.id, startSlot: group.startSlot, endSlot: group.endSlot, sport })}
                      className={adminButton('secondary', 'sm')}
                    >
                      {court.name}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


export default function AgendaFreeSlotFinder(props: AgendaFreeSlotFinderProps) {
  return (
    <AdminOverlay open={props.show} onClose={props.onClose}>
      {props.show ? <AgendaFreeSlotFinderPanel {...props} /> : null}
    </AdminOverlay>
  );
}
