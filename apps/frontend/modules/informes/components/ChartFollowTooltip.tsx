import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type ChartFollowTooltipProps = {
  position?: { x: number; y: number };
  children: ReactNode;
};

export default function ChartFollowTooltip({
  position,
  children,
}: ChartFollowTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [clampedPosition, setClampedPosition] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!position || !tooltipRef.current) {
      setClampedPosition(null);
      return;
    }

    const margin = 8;
    const tooltipEl = tooltipRef.current;
    const parentEl = tooltipEl.offsetParent as HTMLElement | null;

    if (!parentEl) {
      setClampedPosition({ x: position.x, y: position.y });
      return;
    }

    const maxX = parentEl.clientWidth - tooltipEl.offsetWidth - margin;
    const maxY = parentEl.clientHeight - tooltipEl.offsetHeight - margin;

    const nextX = Math.min(Math.max(position.x, margin), Math.max(margin, maxX));
    const nextY = Math.min(Math.max(position.y, margin), Math.max(margin, maxY));

    setClampedPosition({ x: nextX, y: nextY });
  }, [position, children]);

  if (!position) return null;
  const visible = clampedPosition != null;

  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none absolute z-20"
      style={{
        left: clampedPosition?.x ?? position.x,
        top: clampedPosition?.y ?? position.y,
        visibility: visible ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  );
}
