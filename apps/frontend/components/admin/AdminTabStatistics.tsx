import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Clock3, DollarSign, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { useRouter } from 'next/router';
import { reportUiError } from '../../utils/uiError';
import { getApiFieldErrors, normalizeApiError } from '../../utils/apiError';
import { ReportsService, type AdminDashboardReport } from '../../services/ReportsService';
import {
  AdminDataTable,
  AdminDateInput,
  AdminFeedbackBanner,
  AdminPanel,
} from './ui';
import ReportsEmptyState from '../../modules/informes/components/ReportsEmptyState';
import ReportsMetricGrid, { type ReportsMetric } from '../../modules/informes/components/ReportsMetricGrid';
import ReportsPeriodToolbar, { type ReportsPeriod } from '../../modules/informes/components/ReportsPeriodToolbar';
import { formatReportsMoney, formatReportsNumber } from '../../modules/informes/components/reportsFormatters';

interface Props {
  slugProp?: string;
  focus?: 'resumen' | 'ingresos' | 'reservas' | 'pendientes' | 'pos';
}

type Period = ReportsPeriod;

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getDateRange = (period: Period, offset = 0) => {
  const start = new Date();
  const end = new Date();

  if (period === 'hoy') {
    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset);
  } else if (period === 'semana') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1 + offset * 7);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else {
    start.setFullYear(start.getFullYear(), start.getMonth() + offset, 1);
    end.setFullYear(end.getFullYear(), end.getMonth() + offset + 1, 0);
  }

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    rawStart: start,
    rawEnd: end,
  };
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatStatusLabel = (status: string) => {
  switch (status) {
    case 'PENDING':
      return 'Pendientes';
    case 'CONFIRMED':
      return 'Confirmadas';
    case 'COMPLETED':
      return 'Completadas';
    case 'CANCELLED':
      return 'Canceladas';
    default:
      return status;
  }
};

const showSection = (
  focus: Props['focus'],
  section: 'ingresos' | 'reservas' | 'pendientes' | 'pos'
) => !focus || focus === 'resumen' || focus === section;

export default function AdminTabStatistics({ slugProp, focus = 'resumen' }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<AdminDashboardReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activePeriod, setActivePeriod] = useState<Period>('mes');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [filters, setFilters] = useState(() => {
    const initial = getDateRange('mes', 0);
    return { startDate: initial.startDate, endDate: initial.endDate };
  });

  const periodLabel = useMemo(() => {
    const { rawStart, rawEnd } = getDateRange(activePeriod, periodOffset);
    if (activePeriod === 'mes') {
      return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    }
    if (activePeriod === 'hoy') {
      if (periodOffset === 0) return 'Hoy';
      if (periodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    return `${rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} - ${rawEnd.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}`;
  }, [activePeriod, periodOffset]);

  const loadReport = useCallback(async (nextFilters = filters) => {
    if (!slugProp) return;
    try {
      setLoading(true);
      setErrorMessage('');
      setFieldErrors({});
      const data = await ReportsService.getDashboardReport(slugProp, nextFilters);
      setReport(data);
    } catch (error) {
      reportUiError({ area: 'AdminTabStatistics', action: 'loadReport' }, error);
      const normalized = normalizeApiError(error, 'No se pudieron cargar los informes.');
      setErrorMessage(normalized.message);
      setFieldErrors(getApiFieldErrors(error));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [filters, slugProp]);

  useEffect(() => {
    void loadReport(filters);
  }, [filters, loadReport]);

  const handlePeriodChange = (nextPeriod: Period) => {
    const nextRange = getDateRange(nextPeriod, 0);
    setActivePeriod(nextPeriod);
    setPeriodOffset(0);
    setFilters({ startDate: nextRange.startDate, endDate: nextRange.endDate });
  };

  const handleShiftPeriod = (direction: -1 | 1) => {
    const nextOffset = periodOffset + direction;
    const nextRange = getDateRange(activePeriod, nextOffset);
    setPeriodOffset(nextOffset);
    setFilters({ startDate: nextRange.startDate, endDate: nextRange.endDate });
  };

  const handleApplyCustomRange = () => {
    void loadReport(filters);
  };

  const metrics: ReportsMetric[] = [
    {
      label: 'Cobrado',
      value: Number(report?.income.totals.collectedTotal || 0),
      format: 'money',
      icon: <DollarSign size={18} strokeWidth={2.4} />,
      loading,
    },
    {
      label: 'Pendiente',
      value: Number(report?.pendingAccounts.totalPending || 0),
      format: 'money',
      icon: <Clock3 size={18} strokeWidth={2.4} />,
      loading,
    },
    {
      label: 'Reservas del período',
      value: Number(report?.bookings.total || 0),
      format: 'number',
      icon: <CalendarCheck size={18} strokeWidth={2.4} />,
      loading,
    },
    {
      label: 'Ventas POS',
      value: Number(report?.pos.totals.salesTotal || 0),
      format: 'money',
      icon: <ShoppingBag size={18} strokeWidth={2.4} />,
      loading,
    },
  ];

  const isCompletelyEmpty = Boolean(report)
    && Number(report.income.totals.collectedTotal || 0) <= 0
    && Number(report.pendingAccounts.totalPending || 0) <= 0
    && Number(report.bookings.total || 0) <= 0
    && Number(report.pos.totals.salesTotal || 0) <= 0;

  return (
    <div className="flex w-full flex-col gap-4" aria-busy={loading ? 'true' : undefined}>
      <ReportsPeriodToolbar
        period={activePeriod}
        options={periodOptions}
        periodLabel={periodLabel}
        isCurrentPeriod={periodOffset === 0}
        onPeriodChange={handlePeriodChange}
        onPreviousPeriod={() => handleShiftPeriod(-1)}
        onNextPeriod={() => handleShiftPeriod(1)}
      />

      <AdminPanel
        title="Rango"
        description="Elegí el período a analizar. Los montos se calculan siempre en backend."
        actions={(
          <button
            type="button"
            onClick={handleApplyCustomRange}
            className="rounded-xl bg-p-text px-3 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
          >
            Aplicar rango
          </button>
        )}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="mb-1 text-[12px] font-semibold text-p-text-muted">Desde</p>
            <AdminDateInput
              value={filters.startDate}
              onChange={(value) => setFilters((prev) => ({ ...prev, startDate: value }))}
              placeholder="Fecha desde"
            />
            {fieldErrors.startDate ? (
              <p className="mt-1 text-[12px] font-semibold text-p-error">{fieldErrors.startDate}</p>
            ) : null}
          </div>
          <div>
            <p className="mb-1 text-[12px] font-semibold text-p-text-muted">Hasta</p>
            <AdminDateInput
              value={filters.endDate}
              onChange={(value) => setFilters((prev) => ({ ...prev, endDate: value }))}
              placeholder="Fecha hasta"
            />
            {fieldErrors.endDate ? (
              <p className="mt-1 text-[12px] font-semibold text-p-error">{fieldErrors.endDate}</p>
            ) : null}
          </div>
          <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">Rango activo</p>
            <p className="mt-1 text-[13px] font-semibold text-p-text">
              {filters.startDate} → {filters.endDate}
            </p>
          </div>
          <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">Zona horaria</p>
            <p className="mt-1 text-[13px] font-semibold text-p-text">
              {report?.scope.timeZone || 'Club'}
            </p>
          </div>
        </div>
      </AdminPanel>

      {errorMessage ? (
        <AdminFeedbackBanner tone="error" title="No se pudieron cargar los informes">
          {errorMessage}
        </AdminFeedbackBanner>
      ) : null}

      <ReportsMetricGrid metrics={metrics} />

      {!loading && report && isCompletelyEmpty ? (
        <AdminPanel>
          <ReportsEmptyState
            title="Todavía no hay movimientos para este rango"
            description="Probá con otro período o empezá por revisar Caja y Reservas."
            actionLabel="Ir a Caja"
            onAction={() => void router.push('/admin/caja?tab=reports')}
          />
        </AdminPanel>
      ) : null}

      {showSection(focus, 'ingresos') && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AdminPanel title="Ingresos por método" description="Cobros reales registrados en el período.">
            <AdminDataTable
              columns={[
                { key: 'label', label: 'Método' },
                { key: 'count', label: 'Pagos', align: 'right' },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  render: (row) => <span className="font-semibold text-p-text">{formatReportsMoney(row.total)}</span>,
                },
              ]}
              data={report?.income.byMethod || []}
              rowKey={(row) => row.method}
              loading={loading}
              empty={{
                title: 'Sin cobros registrados',
                description: 'No hubo pagos en el rango seleccionado.',
              }}
            />
          </AdminPanel>

          <AdminPanel title="Ingresos por origen" description="Cómo entra la plata según tipo de cuenta.">
            <AdminDataTable
              columns={[
                { key: 'label', label: 'Origen' },
                { key: 'count', label: 'Pagos', align: 'right' },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  render: (row) => <span className="font-semibold text-p-text">{formatReportsMoney(row.total)}</span>,
                },
              ]}
              data={report?.income.byAccountSource || []}
              rowKey={(row) => row.sourceType}
              loading={loading}
              empty={{
                title: 'Sin ingresos por origen',
                description: 'Todavía no hay pagos para clasificar.',
              }}
            />
          </AdminPanel>
        </div>
      )}

      {showSection(focus, 'ingresos') && (
        <AdminPanel title="Totales del período" description="Cobrado, deuda abierta y ajustes operativos.">
          <ReportsMetricGrid
            className="xl:grid-cols-4"
            metrics={[
              {
                label: 'Cobrado',
                value: Number(report?.income.totals.collectedTotal || 0),
                format: 'money',
                icon: <Wallet size={18} strokeWidth={2.4} />,
                loading,
              },
              {
                label: 'Pendiente actual',
                value: Number(report?.income.totals.pendingTotal || 0),
                format: 'money',
                icon: <Clock3 size={18} strokeWidth={2.4} />,
                loading,
              },
              {
                label: 'Devoluciones ejecutadas',
                value: Number(report?.income.totals.refundedTotal || 0),
                format: 'money',
                icon: <Receipt size={18} strokeWidth={2.4} />,
                loading,
              },
              {
                label: 'POS anulado',
                value: Number(report?.income.totals.voidedTotal || 0),
                format: 'money',
                icon: <ShoppingBag size={18} strokeWidth={2.4} />,
                loading,
              },
            ]}
          />
        </AdminPanel>
      )}

      {showSection(focus, 'reservas') && (
        <AdminPanel title="Reservas por estado" description="Reservas del rango según estado operativo.">
          <ReportsMetricGrid
            metrics={(report?.bookings.byStatus || []).map((row) => ({
              label: formatStatusLabel(row.status),
              value: Number(row.count || 0),
              format: 'number',
              loading,
            }))}
          />
        </AdminPanel>
      )}

      {showSection(focus, 'pendientes') && (
        <AdminPanel title="Cuentas pendientes de cobro" description="Snapshot operativo de deuda abierta hasta la fecha final elegida.">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-p-text-muted">
            <span>Cuentas abiertas: <strong className="text-p-text">{formatReportsNumber(report?.pendingAccounts.openCount || 0)}</strong></span>
            <span>Total pendiente: <strong className="text-p-text">{formatReportsMoney(report?.pendingAccounts.totalPending || 0)}</strong></span>
          </div>
          <AdminDataTable
            columns={[
              { key: 'label', label: 'Cuenta' },
              { key: 'clientName', label: 'Cliente / titular' },
              { key: 'sourceLabel', label: 'Origen' },
              { key: 'ageDays', label: 'Antigüedad', align: 'right', render: (row) => `${formatReportsNumber(row.ageDays)} d` },
              { key: 'pending', label: 'Pendiente', align: 'right', render: (row) => <span className="font-semibold text-p-text">{formatReportsMoney(row.pending)}</span> },
            ]}
            data={report?.pendingAccounts.accounts || []}
            rowKey={(row) => row.id}
            loading={loading}
            empty={{
              title: 'No hay cuentas pendientes',
              description: 'El club no tiene saldos abiertos para este corte.',
            }}
          />
        </AdminPanel>
      )}

      {showSection(focus, 'pos') && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AdminPanel
            title="Resumen POS"
            description="Se reutiliza el mismo reporte POS de Caja para evitar divergencias."
            actions={(
              <button
                type="button"
                onClick={() => void router.push('/admin/caja?tab=reports')}
                className="rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[12px] font-semibold text-p-text transition hover:bg-p-surface-2"
              >
                Abrir reporte POS en Caja
              </button>
            )}
          >
            <ReportsMetricGrid
              className="xl:grid-cols-3"
              metrics={[
                {
                  label: 'Ventas POS',
                  value: Number(report?.pos.totals.salesTotal || 0),
                  format: 'money',
                  icon: <ShoppingBag size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Cobrado POS',
                  value: Number(report?.pos.totals.paidTotal || 0),
                  format: 'money',
                  icon: <DollarSign size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Pendiente POS',
                  value: Number(report?.pos.totals.pendingTotal || 0),
                  format: 'money',
                  icon: <Clock3 size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Cuentas abiertas POS',
                  value: Number(report?.pos.openAccountsCount || 0),
                  format: 'number',
                  loading,
                },
                {
                  label: 'Productos POS',
                  value: Number(report?.pos.totals.productTotal || 0),
                  format: 'money',
                  loading,
                },
                {
                  label: 'Servicios POS',
                  value: Number(report?.pos.totals.serviceTotal || 0),
                  format: 'money',
                  loading,
                },
              ]}
            />
          </AdminPanel>

          <div className="grid grid-cols-1 gap-4">
            <AdminPanel title="Top productos POS" description="Ventas POS agrupadas por producto.">
              <AdminDataTable
                columns={[
                  { key: 'name', label: 'Producto' },
                  { key: 'quantity', label: 'Cantidad', align: 'right' },
                  { key: 'total', label: 'Total', align: 'right', render: (row) => formatReportsMoney(row.total) },
                ]}
                data={report?.pos.byProduct || []}
                rowKey={(row) => `${row.productId ?? row.name}`}
                loading={loading}
                empty={{
                  title: 'Sin ventas POS de productos',
                  description: 'No hubo productos vendidos en el rango.',
                }}
              />
            </AdminPanel>

            <AdminPanel title="Top servicios POS" description="Ventas POS agrupadas por servicio.">
              <AdminDataTable
                columns={[
                  { key: 'name', label: 'Servicio' },
                  { key: 'quantity', label: 'Cantidad', align: 'right' },
                  { key: 'total', label: 'Total', align: 'right', render: (row) => formatReportsMoney(row.total) },
                ]}
                data={report?.pos.byService || []}
                rowKey={(row) => row.name}
                loading={loading}
                empty={{
                  title: 'Sin ventas POS de servicios',
                  description: 'No hubo servicios POS vendidos en el rango.',
                }}
              />
            </AdminPanel>
          </div>
        </div>
      )}
    </div>
  );
}
