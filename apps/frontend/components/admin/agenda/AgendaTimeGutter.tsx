type AgendaTimeGutterProps = {
  gridHeight: number;
  nowLineTop: number | null;
  slotHeight: number;
  slotsPerHour: number;
  totalSlots: number;
  slotToTime: (slot: number) => string;
};

export default function AgendaTimeGutter({
  gridHeight,
  nowLineTop,
  slotHeight,
  slotsPerHour,
  totalSlots,
  slotToTime,
}: AgendaTimeGutterProps) {
  return (
    <div className="w-[78px] shrink-0">
      <div className="sticky top-0 z-30 h-10 border-b border-[#eef1f3] bg-white" />
      <div className="relative" style={{ height: gridHeight }}>
        {Array.from({ length: totalSlots }).map((_, slot) => {
          const showHourLabel = slot % slotsPerHour === 0;
          return (
            <div
              key={`time-${slot}`}
              className={`absolute left-0 right-0 ${(slot + 1) % slotsPerHour === 0 ? 'border-b border-[#edf0f2]' : ''}`}
              style={{ top: slot * slotHeight, height: slotHeight }}
            >
              {showHourLabel && (
                <span className="absolute top-[4px] left-0 text-[11px] font-medium text-[#8b93a2]">
                  {slotToTime(slot)}
                </span>
              )}
            </div>
          );
        })}
        {nowLineTop != null && (
          <div
            className="pointer-events-none absolute right-[2px] -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-[#3a66e0] shadow-[0_0_0_2px_#ffffff]"
            style={{ top: nowLineTop, zIndex: 25 }}
          />
        )}
      </div>
    </div>
  );
}
