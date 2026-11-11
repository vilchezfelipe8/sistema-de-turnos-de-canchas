import type { MouseEvent, ReactNode } from 'react';

type AgendaSlotLayerProps = {
  courtId: string;
  draggingBookingId: string | null;
  gridHeight: number;
  isDragging: boolean;
  nowLineTop: number | null;
  slotHeight: number;
  slotsPerHour: number;
  totalSlots: number;
  onSlotMouseDown: (event: MouseEvent<HTMLDivElement>, courtId: string, slot: number) => void;
  onSlotMouseEnter: (courtId: string, slot: number) => void;
  /** Slots donde el club acepta reservas. Sin máscara, todo es reservable. */
  bookableMask?: boolean[] | null;
  /** Slots que ya pasaron (desde el inicio de la grilla): se ven atenuados y no se reservan. */
  pastSlotCount?: number;
  children: ReactNode;
};

export default function AgendaSlotLayer({
  courtId,
  draggingBookingId,
  gridHeight,
  isDragging,
  nowLineTop,
  slotHeight,
  slotsPerHour,
  totalSlots,
  onSlotMouseDown,
  onSlotMouseEnter,
  bookableMask,
  pastSlotCount = 0,
  children,
}: AgendaSlotLayerProps) {
  return (
    <div className="relative select-none" style={{ height: gridHeight }}>
      {Array.from({ length: totalSlots }).map((_, slot) => {
        const isPast = slot < pastSlotCount;
        const isBookable = !isPast && (!bookableMask || bookableMask[slot] !== false);
        return (
        <div
          key={`${courtId}-slot-${slot}`}
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => onSlotMouseDown(event, courtId, slot)}
          onMouseEnter={() => onSlotMouseEnter(courtId, slot)}
          aria-disabled={!isBookable || undefined}
          className={`transition ${
            isPast
              ? 'cursor-not-allowed bg-p-surface-2/70'
              : !isBookable
              ? 'cursor-not-allowed bg-p-surface-2'
              : draggingBookingId || isDragging
                ? 'bg-p-surface'
                : 'bg-p-surface hover:bg-p-surface-2'
          }`}
          style={{
            height: slotHeight,
            borderBottom: (slot + 1) % slotsPerHour === 0 ? '1px solid var(--border)' : 'none',
            ...(isBookable || isPast
              ? {}
              : { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 7px)' }),
          }}
        />
        );
      })}
      {nowLineTop != null && (
        <div
          className="pointer-events-none absolute left-0 right-0 border-t border-p-accent"
          style={{ top: nowLineTop, zIndex: 24 }}
        />
      )}
      {children}
    </div>
  );
}
