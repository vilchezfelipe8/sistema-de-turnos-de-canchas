import type { ReactNode } from 'react';
import type { Booking, Court } from './types/agendaTypes';
import { slotMinutes, slotToTime, totalSlots } from './utils/agendaDateUtils';

const EPSILON = 0.009;
/** Hueco mínimo para mostrarlo como "más libre" (1 h). */
const MIN_FREE_SLOTS = 60 / slotMinutes;

export type AgendaFreeStretch = {
  courtId: string;
  courtName: string;
  startSlot: number;
  endSlot: number;
};

export type AgendaDaySummaryData = {
  bookings: number;
  pending: number;
  owingCount: number;
  owingAmount: number;
  classes: number;
  /** Hueco libre más largo desde ahora. null si no queda ninguno de 1 h o más. */
  freest: AgendaFreeStretch | null;
  /** El día ya pasó entero: no tiene sentido buscar huecos. */
  dayIsOver: boolean;
};

/**
 * Resumen del día para la agenda: cuántas reservas, quién debe y dónde queda más lugar.
 * `courtMasks` marca, por cancha, los slots en que el club acepta reservas (sin máscara = todo abierto).
 */
export function computeAgendaDaySummary(input: {
  bookings: Booking[];
  courts: Court[];
  courtMasks?: Map<string, boolean[]>;
  pastSlotCount: number;
}): AgendaDaySummaryData {
  const { bookings, courts, courtMasks, pastSlotCount } = input;
  const real = bookings.filter((booking) => booking.state !== 'blocked' && booking.state !== 'class');
  const owing = real.filter((booking) => Number(booking.hoverPayment?.remainingAmount || 0) > EPSILON);
  const dayIsOver = pastSlotCount >= totalSlots;

  let freest: AgendaFreeStretch | null = null;
  if (!dayIsOver) {
    courts.forEach((court) => {
      const mask = courtMasks?.get(court.id);
      const taken = new Array<boolean>(totalSlots).fill(false);
      bookings
        .filter((booking) => booking.courtId === court.id)
        .forEach((booking) => {
          for (let slot = Math.max(0, booking.startSlot); slot < Math.min(totalSlots, booking.endSlot); slot += 1) {
            taken[slot] = true;
          }
        });
      let runStart = -1;
      // Si el día ya empezó, el slot en curso ya no sirve: arrancar en el siguiente.
      const firstSlot = pastSlotCount > 0 ? pastSlotCount + 1 : 0;
      for (let slot = firstSlot; slot <= totalSlots; slot += 1) {
        const free = slot < totalSlots && !taken[slot] && (mask ? Boolean(mask[slot]) : true);
        if (free && runStart < 0) runStart = slot;
        if (!free && runStart >= 0) {
          const length = slot - runStart;
          if (length >= MIN_FREE_SLOTS && (!freest || length > freest.endSlot - freest.startSlot)) {
            freest = { courtId: court.id, courtName: court.name, startSlot: runStart, endSlot: slot };
          }
          runStart = -1;
        }
      }
    });
  }

  return {
    bookings: real.length,
    pending: real.filter((booking) => booking.state === 'pending').length,
    owingCount: owing.length,
    owingAmount: owing.reduce((sum, booking) => sum + Number(booking.hoverPayment?.remainingAmount || 0), 0),
    classes: bookings.filter((booking) => booking.state === 'class').length,
    freest,
    dayIsOver,
  };
}

const formatCompactAmount = (amount: number) =>
  amount >= 1000 ? `$${Math.round(amount / 1000)}k` : `$${Math.round(amount)}`;

/** "14:00" → "14", "08:00" → "8", "14:30" queda igual. */
const shortTime = (slot: number) => slotToTime(slot).replace(/:00$/, '').replace(/^0(\d)/, '$1');

type AgendaDaySummaryProps = {
  summary: AgendaDaySummaryData;
  className?: string;
};

/** Una línea que se lee de un vistazo: reservas, sin confirmar, deudas, clases y el hueco más largo. */
export default function AgendaDaySummary({ summary, className = '' }: AgendaDaySummaryProps) {
  const parts: Array<{ key: string; node: ReactNode }> = [];
  parts.push({
    key: 'bookings',
    node: summary.bookings === 0 ? (
      <span>Sin reservas</span>
    ) : (
      <span>
        <b className="text-p-text">{summary.bookings}</b> {summary.bookings === 1 ? 'reserva' : 'reservas'}
      </span>
    ),
  });
  if (summary.pending > 0) {
    parts.push({
      key: 'pending',
      node: (
        <span>
          <b className="text-p-warning">{summary.pending}</b> sin confirmar
        </span>
      ),
    });
  }
  if (summary.owingCount > 0) {
    parts.push({
      key: 'owing',
      node: (
        <span>
          <b className="text-p-warning">{summary.owingCount}</b> {summary.owingCount === 1 ? 'debe' : 'deben'}{' '}
          <b className="text-p-warning">{formatCompactAmount(summary.owingAmount)}</b>
        </span>
      ),
    });
  }
  if (summary.classes > 0) {
    parts.push({
      key: 'classes',
      node: (
        <span>
          <b className="text-p-text">{summary.classes}</b> {summary.classes === 1 ? 'clase' : 'clases'}
        </span>
      ),
    });
  }
  if (!summary.dayIsOver) {
    parts.push({
      key: 'free',
      node: summary.freest ? (
        <span>
          Más libre: <b className="text-p-text">{summary.freest.courtName}</b> de{' '}
          <span className="tabular-nums">
            {shortTime(summary.freest.startSlot)} a {shortTime(summary.freest.endSlot)}
          </span>
        </span>
      ) : (
        <span>No quedan huecos de 1 h</span>
      ),
    });
  }

  return (
    <div className={`flex items-center gap-x-1.5 whitespace-nowrap text-p-text-muted ${className}`}>
      {parts.map((part, index) => (
        <span key={part.key} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden className="opacity-50">·</span>}
          {part.node}
        </span>
      ))}
    </div>
  );
}
