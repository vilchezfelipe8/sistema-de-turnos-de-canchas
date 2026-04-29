import { useCallback, useState, type MouseEvent } from 'react';

type ChartTooltipPosition = {
  x: number;
  y: number;
};

export default function useChartTooltipPosition(offset = 14) {
  const [tooltipPosition, setTooltipPosition] = useState<ChartTooltipPosition | undefined>();

  const handleTooltipMouseMove = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setTooltipPosition({
        x: Math.max(0, event.clientX - rect.left + offset),
        y: Math.max(0, event.clientY - rect.top + offset),
      });
    },
    [offset]
  );

  const handleTooltipMouseLeave = useCallback(() => {
    setTooltipPosition(undefined);
  }, []);

  return {
    tooltipPosition,
    handleTooltipMouseMove,
    handleTooltipMouseLeave,
  };
}
