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
  children,
}: AgendaSlotLayerProps) {
  return (
    <div className="relative select-none" style={{ height: gridHeight }}>
      {Array.from({ length: totalSlots }).map((_, slot) => (
        <div
          key={`${courtId}-slot-${slot}`}
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => onSlotMouseDown(event, courtId, slot)}
          onMouseEnter={() => onSlotMouseEnter(courtId, slot)}
          className={`transition ${draggingBookingId || isDragging ? 'bg-p-surface' : 'bg-p-surface hover:bg-p-surface-2'}`}
          style={{
            height: slotHeight,
            borderBottom: (slot + 1) % slotsPerHour === 0 ? '1px solid var(--border)' : 'none',
          }}
        />
      ))}
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
