import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { BarRectangleItem } from 'recharts';
import ChartFollowTooltip from './ChartFollowTooltip';
import {
  getBarRect,
  getRelativePoint,
  isPointInsideRect,
  isPointerInsideBarRect,
  type ChartRect,
} from './chartHoverGeometry';
import ReportsEmptyState from './ReportsEmptyState';
import { formatReportsMoney } from './reportsFormatters';
import useChartTooltipPosition from './useChartTooltipPosition';

export type RevenueEvolutionPoint = {
  day: string;
  turnos: number;
  bar: number;
};

type RevenueChartProps = {
  data: RevenueEvolutionPoint[];
};

type RevenueSeriesKey = 'turnos' | 'bar';

type ActiveRevenuePoint = {
  point: RevenueEvolutionPoint;
  rect: ChartRect;
  key: RevenueSeriesKey;
};

const revenueSeriesMeta: Record<RevenueSeriesKey, { label: string; color: string }> = {
  turnos: { label: 'Reservas', color: 'var(--ink-900)' },
  bar: { label: 'Consumos', color: 'var(--brand)' },
};

function RevenueTooltip({
  point,
  activeKey,
}: {
  point: RevenueEvolutionPoint;
  activeKey: RevenueSeriesKey;
}) {
  const bookings = Number(point.turnos || 0);
  const consumptions = Number(point.bar || 0);
  const total = bookings + consumptions;
  const activeValue = activeKey === 'turnos' ? bookings : consumptions;
  const activeMeta = revenueSeriesMeta[activeKey];

  return (
    <div className="w-[236px] rounded-lg border border-p-border bg-p-surface px-3 py-2 text-[12px] shadow-p-lg">
      <p className="font-semibold text-p-text">{point.day}</p>
      <div className="mt-2 space-y-1 text-p-text-secondary">
        <p className="flex min-w-[170px] justify-between gap-4 rounded-md bg-p-surface-2 px-2 py-1">
          <span className="inline-flex items-center gap-1.5 font-semibold text-p-text">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeMeta.color }} />
            {activeMeta.label}
          </span>
          <strong style={{ color: activeMeta.color }}>{formatReportsMoney(activeValue)}</strong>
        </p>
        <p className="flex min-w-[170px] justify-between gap-4">
          <span>{activeKey === 'turnos' ? 'Consumos' : 'Reservas'}</span>
          <strong className="text-p-text-secondary">
            {formatReportsMoney(activeKey === 'turnos' ? consumptions : bookings)}
          </strong>
        </p>
        <p className="flex min-w-[170px] justify-between gap-4 border-t border-p-border pt-1">
          <span>Total</span>
          <strong className="text-p-text">{formatReportsMoney(total)}</strong>
        </p>
      </div>
    </div>
  );
}

export default function RevenueChart({ data }: RevenueChartProps) {
  const [activePoint, setActivePoint] = useState<ActiveRevenuePoint | null>(null);
  const {
    tooltipPosition,
    handleTooltipMouseMove,
    handleTooltipMouseLeave,
  } = useChartTooltipPosition();
  const hasData = data.some((point) => Number(point.turnos || 0) > 0 || Number(point.bar || 0) > 0);

  const handleBarHover = (
    key: RevenueSeriesKey,
    entry: BarRectangleItem,
    _index: number,
    event: React.MouseEvent<SVGPathElement>
  ) => {
    if (!isPointerInsideBarRect(entry, event)) {
      setActivePoint(null);
      return;
    }
    setActivePoint({
      point: entry.payload as RevenueEvolutionPoint,
      rect: getBarRect(entry),
      key,
    });
  };

  if (!hasData) {
    return (
      <ReportsEmptyState
        title="Sin ingresos para graficar"
        description="Cuando existan pagos registrados en el periodo, el grafico va a separar reservas y consumos."
      />
    );
  }

  return (
    <div
      className="relative h-80 w-full"
      onMouseMoveCapture={(event) => {
        handleTooltipMouseMove(event);
        if (activePoint && !isPointInsideRect(getRelativePoint(event), activePoint.rect)) {
          setActivePoint(null);
        }
      }}
      onMouseLeave={() => {
        handleTooltipMouseLeave();
        setActivePoint(null);
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, left: -12, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}
            tickFormatter={(value) => (Number(value) >= 1000 ? `$${Math.round(Number(value) / 1000)}k` : `$${value}`)}
          />
          <Bar
            dataKey="turnos"
            name="Reservas"
            stackId="revenue"
            fill="var(--ink-900)"
            radius={[0, 0, 0, 0]}
            barSize={34}
            isAnimationActive={false}
            onMouseEnter={(entry, index, event) => handleBarHover('turnos', entry, index, event)}
            onMouseMove={(entry, index, event) => handleBarHover('turnos', entry, index, event)}
          />
          <Bar
            dataKey="bar"
            name="Consumos"
            stackId="revenue"
            fill="var(--brand)"
            radius={[7, 7, 0, 0]}
            barSize={34}
            isAnimationActive={false}
            onMouseEnter={(entry, index, event) => handleBarHover('bar', entry, index, event)}
            onMouseMove={(entry, index, event) => handleBarHover('bar', entry, index, event)}
          />
        </BarChart>
      </ResponsiveContainer>
      {activePoint && (
        <ChartFollowTooltip position={tooltipPosition}>
          <RevenueTooltip point={activePoint.point} activeKey={activePoint.key} />
        </ChartFollowTooltip>
      )}
    </div>
  );
}
