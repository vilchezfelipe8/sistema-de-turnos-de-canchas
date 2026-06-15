import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import ChartFollowTooltip from './ChartFollowTooltip';
import { isPointerInsideSvgFill } from './chartHoverGeometry';
import ReportsEmptyState from './ReportsEmptyState';
import {
  formatReportsCompactMoney,
  formatReportsMoney,
  formatReportsPercent,
} from './reportsFormatters';
import useChartTooltipPosition from './useChartTooltipPosition';

export type PaymentMethodDatum = {
  name: string;
  value: number;
};

type ActivePaymentMethod = {
  method: PaymentMethodDatum;
  index: number;
};

const COLORS = ['var(--ink-900)', 'var(--brand)', 'var(--positive-fg)', 'var(--warn-fg)', 'var(--accent-fg)', 'var(--info-fg)'];

const getMethodFromSector = (entry: any): PaymentMethodDatum => (entry?.payload || entry) as PaymentMethodDatum;

const isHoveringSectorPath = (target: EventTarget | null) => (
  target instanceof Element && target.tagName.toLowerCase() === 'path'
);

function PaymentMethodTooltip({
  active,
  total,
}: {
  active: ActivePaymentMethod;
  total: number;
}) {
  const value = Number(active.method.value || 0);
  const percent = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="h-[122px] w-[248px] rounded-lg border border-p-border bg-p-surface px-3 py-2 text-[12px] shadow-p-lg">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-p-text-muted">
        Metodo seleccionado
      </p>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-p-text">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: COLORS[active.index % COLORS.length] }}
          />
          <span className="truncate whitespace-nowrap">{active.method.name}</span>
        </span>
        <strong className="shrink-0 whitespace-nowrap text-p-text">
          {formatReportsMoney(value)}
        </strong>
      </div>
      <div className="mt-2 space-y-1 border-t border-p-border pt-2 text-p-text-muted">
        <p className="flex justify-between gap-4 whitespace-nowrap">
          <span>Participacion</span>
          <strong className="shrink-0 text-p-accent">{formatReportsPercent(percent)}</strong>
        </p>
        <p className="flex justify-between gap-4 whitespace-nowrap">
          <span>Total metodos</span>
          <strong className="shrink-0 text-p-text">{formatReportsMoney(total)}</strong>
        </p>
      </div>
    </div>
  );
}

type PaymentMethodsDonutProps = {
  data: PaymentMethodDatum[];
};

export default function PaymentMethodsDonut({
  data,
}: PaymentMethodsDonutProps) {
  const [activeMethod, setActiveMethod] = useState<ActivePaymentMethod | null>(null);
  const {
    tooltipPosition,
    handleTooltipMouseMove,
    handleTooltipMouseLeave,
  } = useChartTooltipPosition();
  const filteredData = data.filter((item) => Number(item.value || 0) > 0);
  const total = filteredData.reduce((sum, item) => sum + Number(item.value || 0), 0);

  const handleSectorHover = (entry: any, index: number, event: React.MouseEvent<SVGElement>) => {
    if (!isPointerInsideSvgFill(event)) {
      setActiveMethod(null);
      return;
    }
    setActiveMethod({
      method: getMethodFromSector(entry),
      index,
    });
  };

  if (filteredData.length === 0 || total <= 0) {
    return (
      <ReportsEmptyState
        title="Sin metodos de pago"
        description="Cuando haya cobros en el periodo, este panel va a mostrar la distribucion por medio de pago."
      />
    );
  }

  return (
    <div className="flex min-h-[320px] flex-col gap-4">
      <div
        className="relative mx-auto h-64 w-full max-w-[260px]"
        onMouseMove={(event) => {
          handleTooltipMouseMove(event);
          if (activeMethod && !isHoveringSectorPath(event.target)) {
            setActiveMethod(null);
          }
        }}
        onMouseLeave={() => {
          handleTooltipMouseLeave();
          setActiveMethod(null);
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={filteredData}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={94}
              paddingAngle={3}
              minAngle={2}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
              animationDuration={0}
              onMouseEnter={handleSectorHover}
              onMouseMove={handleSectorHover}
            >
              {filteredData.map((entry, index) => (
                <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {activeMethod && (
          <ChartFollowTooltip position={tooltipPosition}>
            <PaymentMethodTooltip active={activeMethod} total={total} />
          </ChartFollowTooltip>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-p-text-muted">
            Total
          </span>
          <span className="text-[24px] font-bold text-p-text">
            {formatReportsCompactMoney(total)}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {filteredData.map((item, index) => {
          const percent = total > 0 ? (Number(item.value || 0) / total) * 100 : 0;
          const active = activeMethod?.index === index;
          return (
            <div
              key={`${item.name}-${index}`}
              onMouseEnter={() => {
                setActiveMethod({
                  method: item,
                  index,
                });
              }}
              onMouseLeave={() => setActiveMethod(null)}
              onClick={() => {
                setActiveMethod((prev) => (
                  prev?.index === index
                    ? null
                    : { method: item, index }
                ));
              }}
              className={[
                'cursor-pointer space-y-1 rounded-lg border px-2 py-1.5 transition',
                active ? 'border-p-accent bg-p-surface-2' : 'border-transparent',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="truncate text-[13px] font-semibold text-p-text">
                    {item.name}
                  </span>
                </div>
                <span className="shrink-0 text-[12px] font-semibold text-p-text-secondary">
                  {formatReportsPercent(percent)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-p-surface-2">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${Math.max(percent, 4)}%`,
                    backgroundColor: COLORS[index % COLORS.length],
                  }}
                />
              </div>
              <p className="text-right text-[11px] font-medium text-p-text-muted">
                {formatReportsMoney(Number(item.value || 0))}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
