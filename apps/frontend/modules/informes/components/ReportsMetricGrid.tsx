import type { ReactNode } from 'react';
import MetricCard from '../../../components/admin/ui/MetricCard';
import type { MetricCardFormat } from '../../../components/admin/ui/MetricCard';

export type ReportsMetric = {
  label: string;
  value: number;
  format?: MetricCardFormat;
  icon?: ReactNode;
  valueColor?: string;
  loading?: boolean;
};

type ReportsMetricGridProps = {
  metrics: ReportsMetric[];
  className?: string;
};

export default function ReportsMetricGrid({
  metrics,
  className,
}: ReportsMetricGridProps) {
  return (
    <div
      className={[
        'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          format={metric.format}
          icon={metric.icon}
          valueColor={metric.valueColor}
          loading={metric.loading}
        />
      ))}
    </div>
  );
}
