import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, DollarSign, Receipt, ShoppingBag, Wallet } from 'lucide-react';
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
import { type ReportsPeriod } from '../../modules/informes/components/ReportsPeriodToolbar';
import { formatReportsMoney, formatReportsNumber } from '../../modules/informes/components/reportsFormatters';

interface Props {
  slugProp?: string;
  /** Resumen: los 4 números. Plata: ingresos y deuda. Reservas. Mostrador (pos). */
  focus?: 'resumen' | 'plata' | 'reservas' | 'pos';
}

type Period = ReportsPeriod;

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Día' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];

const parseDateKey = (key: string) => new Date(`${key}T12:00:00`);

/** Mismo largo, justo antes: para comparar. */
const previousRangeOf = (startDate: string, endDate: string) => {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { startDate: toDateKeyLocal(prevStart), endDate: toDateKeyLocal(prevEnd) };
};

function toDateKeyLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const shortDay = (key: string) =>
  parseDateKey(key).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '');

/** "+12% vs octubre" con color según si subir es bueno o malo. */
function DeltaLine({
  current,
  previous,
  compareLabel,
  higherIsBetter,
  loading,
}: {
  current: number;
  previous: number | null;
  compareLabel: string;
  higherIsBetter: boolean;
  loading: boolean;
}) {
  if (loading || previous === null) return <p className="text-[12px] text-p-text-muted">&nbsp;</p>;
  if (previous <= 0 && current <= 0) return <p className="text-[12px] text-p-text-muted">Igual que {compareLabel}</p>;
  if (previous <= 0) return <p className="text-[12px] text-p-text-muted">Sin datos de {compareLabel}</p>;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <p className="text-[12px] text-p-text-muted">Igual que {compareLabel}</p>;
  const good = higherIsBetter ? pct > 0 : pct < 0;
  return (
    <p className={`text-[12px] font-semibold ${good ? 'text-p-positive' : 'text-p-warning'}`}>
      {pct > 0 ? '+' : '−'}
      {Math.abs(pct)}% vs {compareLabel}
    </p>
  );
}

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
) => {
  if (focus === 'plata') return section === 'ingresos' || section === 'pendientes';
  return focus === section;
};

export default function AdminTabStatistics({ slugProp, focus = 'resumen' }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<AdminDashboardReport | null>(null);
  const [previousReport, setPreviousReport] = useState<AdminDashboardReport | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<{ startDate: string; endDate: string } | null>(null);
  const [isCustomRange, setIsCustomRange] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activePeriod, setActivePeriod] = useState<Period>('mes');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [filters, setFilters] = useState(() => {
    const initial = getDateRange('mes', 0);
    return { startDate: initial.startDate, endDate: initial.endDate };
  });

  const periodLabel = useMemo(() => {
    if (isCustomRange) return `${shortDay(filters.startDate)} – ${shortDay(filters.endDate)}`;
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
  }, [activePeriod, filters.endDate, filters.startDate, isCustomRange, periodOffset]);

  /** Con qué se compara: "octubre", "la semana anterior", "ayer"… */
  const compareLabel = useMemo(() => {
    if (isCustomRange) return 'el período anterior';
    if (activePeriod === 'mes') {
      const { rawStart } = getDateRange('mes', periodOffset - 1);
      return rawStart.toLocaleDateString('es-AR', { month: 'long' });
    }
    if (activePeriod === 'semana') return 'la semana anterior';
    return periodOffset === 0 ? 'ayer' : 'el día anterior';
  }, [activePeriod, isCustomRange, periodOffset]);

  const loadReport = useCallback(async (nextFilters = filters) => {
    if (!slugProp) return;
    try {
      setLoading(true);
      setErrorMessage('');
      setFieldErrors({});
      const previousRange = previousRangeOf(nextFilters.startDate, nextFilters.endDate);
      const [data, previous] = await Promise.all([
        ReportsService.getDashboardReport(slugProp, nextFilters),
        ReportsService.getDashboardReport(slugProp, previousRange).catch(() => null),
      ]);
      setReport(data);
      setPreviousReport(previous);
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
    setIsCustomRange(false);
    setCustomOpen(false);
    setFilters({ startDate: nextRange.startDate, endDate: nextRange.endDate });
  };

  const handleShiftPeriod = (direction: -1 | 1) => {
    if (isCustomRange) {
      // Fechas a mano: se corre el mismo largo hacia atrás o adelante.
      const days =
        Math.round((parseDateKey(filters.endDate).getTime() - parseDateKey(filters.startDate).getTime()) / 86_400_000) + 1;
      const start = parseDateKey(filters.startDate);
      start.setDate(start.getDate() + direction * days);
      const end = new Date(start);
      end.setDate(end.getDate() + days - 1);
      setFilters({ startDate: toDateKeyLocal(start), endDate: toDateKeyLocal(end) });
      return;
    }
    const nextOffset = periodOffset + direction;
    const nextRange = getDateRange(activePeriod, nextOffset);
    setPeriodOffset(nextOffset);
    setFilters({ startDate: nextRange.startDate, endDate: nextRange.endDate });
  };

  const handleApplyCustomRange = () => {
    if (!customDraft?.startDate || !customDraft?.endDate) return;
    const ordered =
      customDraft.startDate <= customDraft.endDate
        ? customDraft
        : { startDate: customDraft.endDate, endDate: customDraft.startDate };
    setIsCustomRange(true);
    setCustomOpen(false);
    setFilters(ordered);
  };

  const cancelledCount = (report?.bookings.byStatus || []).find((row) => row.status === 'CANCELLED')?.count || 0;
  const previousCancelled = (previousReport?.bookings.byStatus || []).find((row) => row.status === 'CANCELLED')?.count || 0;
  const summaryCards: Array<{
    key: string;
    label: string;
    value: string;
    current: number;
    previous: number | null;
    higherIsBetter: boolean;
    note?: string;
  }> = [
    {
      key: 'collected',
      label: 'Cobrado',
      value: formatReportsMoney(Number(report?.income.totals.collectedTotal || 0)),
      current: Number(report?.income.totals.collectedTotal || 0),
      previous: previousReport ? Number(previousReport.income.totals.collectedTotal || 0) : null,
      higherIsBetter: true,
    },
    {
      key: 'owed',
      label: 'Te deben',
      value: formatReportsMoney(Number(report?.pendingAccounts.totalPending || 0)),
      current: Number(report?.pendingAccounts.totalPending || 0),
      previous: previousReport ? Number(previousReport.pendingAccounts.totalPending || 0) : null,
      higherIsBetter: false,
      note: `En ${formatReportsNumber(report?.pendingAccounts.openCount || 0)} cuentas`,
    },
    {
      key: 'bookings',
      label: 'Reservas',
      value: formatReportsNumber(Math.max(0, Number(report?.bookings.total || 0) - cancelledCount)),
      current: Math.max(0, Number(report?.bookings.total || 0) - cancelledCount),
      previous: previousReport ? Math.max(0, Number(previousReport.bookings.total || 0) - previousCancelled) : null,
      higherIsBetter: true,
      note: cancelledCount > 0 ? `Y ${formatReportsNumber(cancelledCount)} canceladas` : 'Sin cancelaciones',
    },
    {
      key: 'refunds',
      label: 'Devoluciones',
      value: formatReportsMoney(Number(report?.income.totals.refundedTotal || 0)),
      current: Number(report?.income.totals.refundedTotal || 0),
      previous: previousReport ? Number(previousReport.income.totals.refundedTotal || 0) : null,
      higherIsBetter: false,
    },
  ];

  const isCompletelyEmpty = Boolean(report)
    && Number(report.income.totals.collectedTotal || 0) <= 0
    && Number(report.pendingAccounts.totalPending || 0) <= 0
    && Number(report.bookings.total || 0) <= 0
    && Number(report.pos.totals.salesTotal || 0) <= 0;

  return (
    <div className="flex w-full flex-col gap-4" aria-busy={loading ? 'true' : undefined}>
      {/* Período: un solo control. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
          {periodOptions.map((option) => (
            <button
              key={`period-${option.value}`}
              type="button"
              aria-pressed={!isCustomRange && activePeriod === option.value}
              onClick={() => handlePeriodChange(option.value)}
              className={`h-8 rounded-lg px-3 text-[13px] font-semibold transition ${
                !isCustomRange && activePeriod === option.value
                  ? 'bg-ink-900 text-ink-50'
                  : 'text-p-text-secondary hover:bg-p-surface-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-p-border bg-p-surface p-1">
          <button
            type="button"
            aria-label="Período anterior"
            onClick={() => handleShiftPeriod(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted hover:bg-p-surface-2"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[132px] text-center text-[13px] font-semibold text-p-text">{periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}</span>
          <button
            type="button"
            aria-label="Período siguiente"
            onClick={() => handleShiftPeriod(1)}
            disabled={!isCustomRange && periodOffset === 0}
            className="grid h-8 w-8 place-items-center rounded-lg text-p-text-muted hover:bg-p-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setCustomDraft({ startDate: filters.startDate, endDate: filters.endDate });
            setCustomOpen((open) => !open);
          }}
          className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
        >
          {customOpen ? 'Cerrar' : 'Elegir fechas'}
        </button>
      </div>

      {customOpen && customDraft && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-p-border bg-p-surface p-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-p-text-muted">Desde</span>
            <AdminDateInput
              value={customDraft.startDate}
              onChange={(value) => setCustomDraft((prev) => (prev ? { ...prev, startDate: value } : prev))}
              placeholder="Desde"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-p-text-muted">Hasta</span>
            <AdminDateInput
              value={customDraft.endDate}
              onChange={(value) => setCustomDraft((prev) => (prev ? { ...prev, endDate: value } : prev))}
              placeholder="Hasta"
            />
          </label>
          <button
            type="button"
            onClick={handleApplyCustomRange}
            className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
          >
            Ver
          </button>
          {(fieldErrors.startDate || fieldErrors.endDate) && (
            <p className="w-full text-[12px] font-semibold text-p-error">{fieldErrors.startDate || fieldErrors.endDate}</p>
          )}
        </div>
      )}

      {errorMessage ? (
        <AdminFeedbackBanner tone="error" title="No se pudieron cargar los informes">
          {errorMessage}
        </AdminFeedbackBanner>
      ) : null}

      {focus === 'resumen' && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.key} className="rounded-2xl border border-p-border bg-p-surface p-4">
              <p className="text-[13px] text-p-text-muted">{card.label}</p>
              {loading && !report ? (
                <div className="mt-2 h-8 w-32 animate-pulse rounded bg-p-surface-3" />
              ) : (
                <p className="mt-1 text-[28px] font-bold leading-tight tracking-tight tabular-nums text-p-text">{card.value}</p>
              )}
              <DeltaLine
                current={card.current}
                previous={card.previous}
                compareLabel={compareLabel}
                higherIsBetter={card.higherIsBetter}
                loading={loading}
              />
              {card.note ? <p className="text-[12px] text-p-text-muted">{card.note}</p> : null}
            </div>
          ))}
        </div>
      )}

      {focus === 'resumen' && report && Number(report.pos.totals.salesTotal || 0) > 0 && (
        <p className="text-[14px] text-p-text-secondary">
          En el mostrador se vendieron <span className="font-semibold text-p-text">{formatReportsMoney(report.pos.totals.salesTotal)}</span>.
        </p>
      )}

      {!loading && report && isCompletelyEmpty ? (
        <AdminPanel>
          <ReportsEmptyState
            title="No hubo movimiento en este período"
            description="Probá con otro período."
            actionLabel="Ir a Caja"
            onAction={() => void router.push('/admin/caja')}
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
                label: 'Mostrador anulado',
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
          <AdminPanel title="Ventas de mostrador" description="Productos y servicios vendidos en el período.">
            <ReportsMetricGrid
              className="xl:grid-cols-3"
              metrics={[
                {
                  label: 'Vendido',
                  value: Number(report?.pos.totals.salesTotal || 0),
                  format: 'money',
                  icon: <ShoppingBag size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Cobrado',
                  value: Number(report?.pos.totals.paidTotal || 0),
                  format: 'money',
                  icon: <DollarSign size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Falta cobrar',
                  value: Number(report?.pos.totals.pendingTotal || 0),
                  format: 'money',
                  icon: <Clock3 size={18} strokeWidth={2.4} />,
                  loading,
                },
                {
                  label: 'Cuentas abiertas',
                  value: Number(report?.pos.openAccountsCount || 0),
                  format: 'number',
                  loading,
                },
                {
                  label: 'En productos',
                  value: Number(report?.pos.totals.productTotal || 0),
                  format: 'money',
                  loading,
                },
                {
                  label: 'En servicios',
                  value: Number(report?.pos.totals.serviceTotal || 0),
                  format: 'money',
                  loading,
                },
              ]}
            />
          </AdminPanel>

          <div className="grid grid-cols-1 gap-4">
            <AdminPanel title="Productos más vendidos">
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
                  title: 'No se vendieron productos',
                  description: 'No hubo productos vendidos en el rango.',
                }}
              />
            </AdminPanel>

            <AdminPanel title="Servicios más vendidos">
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
                  title: 'No se vendieron servicios',
                  description: 'No hubo servicios vendidos en el período.',
                }}
              />
            </AdminPanel>

            <AdminPanel title="Cobrado por medio de pago">
              <AdminDataTable
                columns={[
                  {
                    key: 'method',
                    label: 'Medio',
                    render: (row) => {
                      const m = String(row.method || '').toUpperCase();
                      return m === 'CASH' ? 'Efectivo' : m === 'CARD' ? 'Tarjeta' : m === 'TRANSFER' ? 'Transferencia' : row.method;
                    },
                  },
                  { key: 'count', label: 'Cobros', align: 'right' },
                  { key: 'total', label: 'Total', align: 'right', render: (row) => formatReportsMoney(row.total) },
                ]}
                data={report?.pos.paymentsByMethod || []}
                rowKey={(row) => row.method}
                loading={loading}
                empty={{
                  title: 'Sin cobros de mostrador',
                  description: 'No hubo cobros en el período.',
                }}
              />
            </AdminPanel>
          </div>
        </div>
      )}
    </div>
  );
}
