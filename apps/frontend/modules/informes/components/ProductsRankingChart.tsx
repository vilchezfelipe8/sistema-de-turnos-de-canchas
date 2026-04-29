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

export type ProductRankingDatum = {
  productId?: number;
  name: string;
  quantity?: number;
  revenue?: number;
};

type ProductsRankingChartProps = {
  data: ProductRankingDatum[];
};

type ActiveProduct = {
  row: ProductRankingDatum;
  rect: ChartRect;
};

function ProductTooltip({ row }: { row: ProductRankingDatum }) {
  return (
    <div className="w-[236px] rounded-lg border border-[#dce2ee] bg-white px-3 py-2 text-[12px] shadow-[0_10px_28px_rgba(31,38,56,0.10)]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#98a1b3]">
        Producto seleccionado
      </p>
      <p className="mt-1 max-w-[240px] truncate font-semibold text-[#1f2638]">
        {row.name || 'Producto'}
      </p>
      <div className="mt-2 space-y-1 border-t border-[#eef2f8] pt-2 text-[#6f7890]">
        <p className="flex min-w-[180px] justify-between gap-4">
          <span>Unidades</span>
          <strong className="text-[#3053e2]">
            {Number(row.quantity || 0).toLocaleString('es-AR')} u.
          </strong>
        </p>
        <p className="flex min-w-[180px] justify-between gap-4">
          <span>Facturacion</span>
          <strong className="text-[#1f2638]">
            {formatReportsMoney(Number(row.revenue || 0))}
          </strong>
        </p>
      </div>
    </div>
  );
}

export default function ProductsRankingChart({ data }: ProductsRankingChartProps) {
  const [activeProduct, setActiveProduct] = useState<ActiveProduct | null>(null);
  const {
    tooltipPosition,
    handleTooltipMouseMove,
    handleTooltipMouseLeave,
  } = useChartTooltipPosition();
  const chartData = data
    .filter((row) => Number(row.quantity || 0) > 0)
    .slice(0, 8)
    .map((row) => ({
      ...row,
      shortName: row.name.length > 18 ? `${row.name.slice(0, 18)}...` : row.name,
    }));

  const handleBarHover = (entry: BarRectangleItem, _index: number, event: React.MouseEvent<SVGPathElement>) => {
    if (!isPointerInsideBarRect(entry, event)) {
      setActiveProduct(null);
      return;
    }
    setActiveProduct({
      row: entry.payload as ProductRankingDatum,
      rect: getBarRect(entry),
    });
  };

  if (chartData.length === 0) {
    return (
      <ReportsEmptyState
        title="Sin ventas de productos"
        description="El ranking se completa automaticamente cuando los productos tengan ventas en el periodo."
      />
    );
  }

  return (
    <div
      className="relative h-80 w-full"
      onMouseMove={(event) => {
        handleTooltipMouseMove(event);
        if (activeProduct && !isPointInsideRect(getRelativePoint(event), activeProduct.rect)) {
          setActiveProduct(null);
        }
      }}
      onMouseLeave={() => {
        handleTooltipMouseLeave();
        setActiveProduct(null);
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 18, left: 4, bottom: 8 }}>
          <CartesianGrid stroke="#e7ebf3" strokeDasharray="4 6" horizontal={false} />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tick={{ fill: '#8b95aa', fontSize: 11, fontWeight: 600 }}
          />
          <YAxis
            type="category"
            dataKey="shortName"
            width={112}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#46516a', fontSize: 11, fontWeight: 600 }}
          />
          <Bar
            dataKey="quantity"
            name="Unidades"
            fill="#3053e2"
            radius={[0, 6, 6, 0]}
            barSize={18}
            isAnimationActive={false}
            onMouseEnter={handleBarHover}
            onMouseMove={handleBarHover}
            onMouseLeave={() => setActiveProduct(null)}
          />
        </BarChart>
      </ResponsiveContainer>
      {activeProduct && (
        <ChartFollowTooltip position={tooltipPosition}>
          <ProductTooltip row={activeProduct.row} />
        </ChartFollowTooltip>
      )}
    </div>
  );
}
