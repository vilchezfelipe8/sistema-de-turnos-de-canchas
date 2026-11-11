import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, DollarSign, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { useRouter } from 'next/router';
import { reportUiError } from '../../utils/uiError';
import { getApiFieldErrors, normalizeApiError } from '../../utils/apiError';
import { ReportsService, type AdminDashboardReport, type ReportsOccupancy } from '../../services/ReportsService';
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

/** Barras por día: una serie, sin leyenda (el título la nombra), detalle al pasar el mouse. */
function DailyBars({ days, loading }: { days: Array<{ date: string; collected: number; count: number }>; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  if (loading && days.length === 0) return <div className="h-40 animate-pulse rounded-xl bg-p-surface-2" />;
  const max = Math.max(1, ...days.map((day) => day.collected));
  const labelEvery = days.length > 16 ? 5 : days.length > 8 ? 2 : 1;
  const hovered = hover === null ? null : days[hover];
  return (
    <div>
      <div className="mb-1 h-5 text-[12px] text-p-text-secondary">
        {hovered ? (
          <>
            <span className="font-semibold text-p-text">{shortDay(hovered.date)}</span>
            {' · '}
            {formatReportsMoney(hovered.collected)}
            {hovered.count > 0 ? ` en ${hovered.count} ${hovered.count === 1 ? 'cobro' : 'cobros'}` : ''}
          </>
        ) : (
          <span className="text-p-text-muted">Pasá el mouse por una barra para ver el día.</span>
        )}
      </div>
      <div className="relative h-40 border-b border-p-border" onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((day, index) => {
            const height = day.collected > 0 ? Math.max(3, Math.round((day.collected / max) * 100)) : 0;
            return (
              <div
                key={day.date}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(index)}
                role="img"
                aria-label={`${shortDay(day.date)}: ${formatReportsMoney(day.collected)}`}
              >
                <div
                  className={`w-full rounded-t-[4px] transition-opacity ${hover === null || hover === index ? 'opacity-100' : 'opacity-40'} bg-p-accent`}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px]">
        {days.map((day, index) => (
          <span key={`label-${day.date}`} className="flex-1 text-center text-[10px] tabular-nums text-p-text-muted">
            {index % labelEvery === 0 ? parseDateKey(day.date).getDate() : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Barras horizontales con monto y porcentaje: "Efectivo $309.050 · 87%". */
function ShareBars({ rows, loading, empty }: { rows: Array<{ key: string; label: string; total: number; count: number }>; loading: boolean; empty: string }) {
  if (loading && rows.length === 0) return <div className="h-24 animate-pulse rounded-xl bg-p-surface-2" />;
  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  if (rows.length === 0 || sum <= 0) return <p className="text-[13px] text-p-text-muted">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.total));
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = Math.round((row.total / sum) * 100);
        return (
          <li key={row.key} title={`${row.count} ${row.count === 1 ? 'cobro' : 'cobros'}`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-p-text">{row.label}</span>
              <span className="tabular-nums text-p-text">
                <span className="font-semibold">{formatReportsMoney(row.total)}</span>
                <span className="text-p-text-muted"> · {pct}%</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-p-surface-2">
              <div className="h-2 rounded-full bg-p-accent" style={{ width: `${Math.max(2, Math.round((row.total / max) * 100))}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const WEEKDAYS: Array<{ value: number; short: string; long: string }> = [
  { value: 1, short: 'Lun', long: 'lunes' },
  { value: 2, short: 'Mar', long: 'martes' },
  { value: 3, short: 'Mié', long: 'miércoles' },
  { value: 4, short: 'Jue', long: 'jueves' },
  { value: 5, short: 'Vie', long: 'viernes' },
  { value: 6, short: 'Sáb', long: 'sábados' },
  { value: 0, short: 'Dom', long: 'domingos' },
];

const formatHours = (minutes: number) => {
  const hours = minutes / 60;
  return `${
    hours >= 10 || Number.isInteger(hours) ? Math.round(hours).toLocaleString('es-AR') : hours.toFixed(1).replace('.', ',')
  } h`;
};

/** Escala de un solo color, de claro a oscuro, en 5 escalones (mezcla el acento con la superficie). */
const heatStyle = (pct: number): { backgroundColor: string } => {
  const step = pct <= 0 ? 0 : pct < 0.2 ? 22 : pct < 0.4 ? 40 : pct < 0.6 ? 58 : pct < 0.8 ? 78 : 100;
  return {
    backgroundColor: step === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--accent-fg) ${step}%, var(--surface-2))`,
  };
};

/** Mapa día × hora: qué tan llenas estuvieron las canchas. */
function OccupancyHeatmap({ cells }: { cells: ReportsOccupancy['heatmap'] }) {
  const [hover, setHover] = useState<string | null>(null);
  const hours = Array.from(new Set(cells.map((cell) => cell.hour))).sort((a, b) => a - b);
  const byKey = new Map(cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));
  const hovered = hover ? byKey.get(hover) : null;
  const hoveredDay = hovered ? WEEKDAYS.find((day) => day.value === hovered.weekday) : null;
  if (hours.length === 0) return <p className="text-[13px] text-p-text-muted">No hay horarios abiertos en este período.</p>;
  return (
    <div>
      <div className="mb-2 h-5 text-[12px] text-p-text-secondary">
        {hovered && hoveredDay ? (
          <>
            <span className="font-semibold text-p-text">
              {hoveredDay.long.charAt(0).toUpperCase() + hoveredDay.long.slice(1)} {hovered.hour}–{hovered.hour + 1} h
            </span>
            {' · '}
            {Math.round((hovered.bookedMinutes / Math.max(1, hovered.openMinutes)) * 100)}% ocupado ({formatHours(hovered.bookedMinutes)} de{' '}
            {formatHours(hovered.openMinutes)})
          </>
        ) : (
          <span className="text-p-text-muted">Tocá o pasá el mouse por un cuadrito para ver el detalle.</span>
        )}
      </div>
      <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="w-10" />
              {hours.map((hour) => (
                <th key={`h-${hour}`} className="min-w-[26px] text-center text-[10px] font-normal tabular-nums text-p-text-muted">
                  {hour}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((day) => (
              <tr key={`d-${day.value}`}>
                <th className="pr-1 text-left text-[11px] font-medium text-p-text-secondary">{day.short}</th>
                {hours.map((hour) => {
                  const key = `${day.value}-${hour}`;
                  const cell = byKey.get(key);
                  if (!cell) return <td key={key} className="h-6 min-w-[26px]" />;
                  const pct = cell.bookedMinutes / Math.max(1, cell.openMinutes);
                  return (
                    <td
                      key={key}
                      onMouseEnter={() => setHover(key)}
                      onClick={() => setHover(key)}
                      aria-label={`${day.long} ${hour} h: ${Math.round(pct * 100)}%`}
                      style={heatStyle(pct)}
                      className={`h-6 min-w-[26px] rounded-[4px] ${hover === key ? 'ring-2 ring-p-text' : ''}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-p-text-muted">
        <span>Vacío</span>
        {[0, 0.1, 0.3, 0.5, 0.7, 0.9].map((value) => (
          <span key={`legend-${value}`} className="h-3 w-5 rounded-[3px]" style={heatStyle(value)} />
        ))}
        <span>Lleno</span>
      </div>
    </div>
  );
}

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

      {showSection(focus, 'ingresos') && (() => {
        const days = report?.income.byDay || [];
        const collected = Number(report?.income.totals.collectedTotal || 0);
        const activeDays = days.filter((day) => day.collected > 0);
        const best = activeDays.reduce<(typeof days)[number] | null>(
          (top, day) => (!top || day.collected > top.collected ? day : top),
          null
        );
        const average = days.length > 0 ? collected / days.length : 0;
        const refunded = Number(report?.income.totals.refundedTotal || 0);
        const voided = Number(report?.income.totals.voidedTotal || 0);
        return (
          <>
            <AdminPanel title="Cobrado por día">
              <p className="mb-3 text-[14px] text-p-text-secondary">
                <span className="text-[22px] font-bold tabular-nums text-p-text">{formatReportsMoney(collected)}</span>
                {days.length > 1 && collected > 0 && (
                  <>
                    {' · '}promedio {formatReportsMoney(Math.round(average))} por día
                    {best ? <> · mejor día {shortDay(best.date)} ({formatReportsMoney(best.collected)})</> : null}
                  </>
                )}
              </p>
              {days.length > 1 ? (
                <DailyBars days={days} loading={loading} />
              ) : (
                <p className="text-[13px] text-p-text-muted">Elegí Semana o Mes para ver el gráfico por día.</p>
              )}
            </AdminPanel>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <AdminPanel title="Cómo te pagaron">
                <ShareBars
                  loading={loading}
                  empty="No hubo cobros en este período."
                  rows={(report?.income.byMethod || []).map((row) => ({
                    key: row.method,
                    label: row.label,
                    total: Number(row.total || 0),
                    count: Number(row.count || 0),
                  }))}
                />
              </AdminPanel>
              <AdminPanel title="De dónde vino la plata">
                <ShareBars
                  loading={loading}
                  empty="No hubo cobros en este período."
                  rows={(report?.income.byAccountSource || []).map((row) => ({
                    key: row.sourceType,
                    label: row.label,
                    total: Number(row.total || 0),
                    count: Number(row.count || 0),
                  }))}
                />
              </AdminPanel>
            </div>

            {(refunded > 0 || voided > 0) && (
              <p className="text-[14px] text-p-text-secondary">
                {refunded > 0 && (
                  <>
                    Se devolvieron <span className="font-semibold tabular-nums text-p-text">{formatReportsMoney(refunded)}</span>
                  </>
                )}
                {refunded > 0 && voided > 0 ? ' · ' : ''}
                {voided > 0 && (
                  <>
                    se anularon ventas por <span className="font-semibold tabular-nums text-p-text">{formatReportsMoney(voided)}</span>
                  </>
                )}
                .
              </p>
            )}
          </>
        );
      })()}

      {showSection(focus, 'reservas') && (() => {
        const occupancy = report?.occupancy || null;
        const previousOccupancy = previousReport?.occupancy || null;
        const pct = occupancy && occupancy.totals.openMinutes > 0 ? occupancy.totals.bookedMinutes / occupancy.totals.openMinutes : null;
        const previousPct =
          previousOccupancy && previousOccupancy.totals.openMinutes > 0
            ? previousOccupancy.totals.bookedMinutes / previousOccupancy.totals.openMinutes
            : null;
        const statusCount = (status: string) => (report?.bookings.byStatus || []).find((row) => row.status === status)?.count || 0;
        const pending = statusCount('PENDING');
        const confirmed = statusCount('CONFIRMED');
        const completed = statusCount('COMPLETED');
        const cancelled = statusCount('CANCELLED');
        const total = Number(report?.bookings.total || 0);
        const busiest = (occupancy?.heatmap || [])
          .filter((cell) => cell.openMinutes > 0 && cell.bookedMinutes > 0)
          .sort((a, b) => b.bookedMinutes / b.openMinutes - a.bookedMinutes / a.openMinutes)[0];
        const busiestDay = busiest ? WEEKDAYS.find((day) => day.value === busiest.weekday) : null;
        return (
          <>
            <AdminPanel title="Ocupación de canchas">
              {loading && !report ? (
                <div className="h-24 animate-pulse rounded-xl bg-p-surface-2" />
              ) : !occupancy ? (
                <p className="text-[13px] text-p-text-muted">
                  La ocupación se calcula para períodos de hasta 2 meses. Elegí Día, Semana o Mes.
                </p>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-[14px] text-p-text-secondary">
                      <span className="text-[28px] font-bold tabular-nums text-p-text">{Math.round((pct || 0) * 100)}%</span>{' '}
                      ocupado · {formatHours(occupancy.totals.bookedMinutes)} reservadas de {formatHours(occupancy.totals.openMinutes)} abiertas
                    </p>
                    {previousPct === null || loading ? null : (() => {
                      const points = Math.round(((pct || 0) - previousPct) * 100);
                      if (points === 0) return <p className="text-[12px] text-p-text-muted">Igual que {compareLabel}</p>;
                      return (
                        <p className={points > 0 ? 'text-[12px] font-semibold text-p-positive' : 'text-[12px] font-semibold text-p-warning'}>
                          {points > 0 ? '+' : '−'}{Math.abs(points)} {Math.abs(points) === 1 ? 'punto' : 'puntos'} vs {compareLabel}
                        </p>
                      );
                    })()}
                    {busiest && busiestDay ? (
                      <p className="text-[13px] text-p-text-muted">
                        Lo más lleno: {busiestDay.long} de {busiest.hour} a {busiest.hour + 1} h (
                        {Math.round((busiest.bookedMinutes / busiest.openMinutes) * 100)}%).
                      </p>
                    ) : null}
                  </div>
                  <ul className="space-y-3">
                    {occupancy.courts.map((court) => {
                      const courtPct = court.openMinutes > 0 ? court.bookedMinutes / court.openMinutes : 0;
                      return (
                        <li key={`court-${court.courtId}`}>
                          <div className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="text-p-text">{court.name}</span>
                            <span className="tabular-nums text-p-text">
                              <span className="font-semibold">{Math.round(courtPct * 100)}%</span>
                              <span className="text-p-text-muted"> · {formatHours(court.bookedMinutes)} de {formatHours(court.openMinutes)}</span>
                            </span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-p-surface-2">
                            <div className="h-2 rounded-full bg-p-accent" style={{ width: `${Math.min(100, Math.round(courtPct * 100))}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </AdminPanel>

            {occupancy && occupancy.heatmap.length > 0 && (
              <AdminPanel title="Horarios más pedidos">
                <OccupancyHeatmap cells={occupancy.heatmap} />
              </AdminPanel>
            )}

            <AdminPanel title="Reservas del período">
              <p className="text-[14px] text-p-text-secondary">
                <span className="text-[22px] font-bold tabular-nums text-p-text">{formatReportsNumber(total - cancelled)}</span>{' '}
                reservas
                {completed > 0 ? <> · {formatReportsNumber(completed)} jugadas</> : null}
                {confirmed > 0 ? <> · {formatReportsNumber(confirmed)} confirmadas</> : null}
                {pending > 0 ? <> · <span className="text-p-warning">{formatReportsNumber(pending)} sin confirmar</span></> : null}
              </p>
              {cancelled > 0 ? (
                <p className="mt-1 text-[13px] text-p-text-muted">
                  Se cancelaron {formatReportsNumber(cancelled)} ({Math.round((cancelled / Math.max(1, total)) * 100)}% de las pedidas).
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-p-text-muted">No hubo cancelaciones.</p>
              )}
            </AdminPanel>
          </>
        );
      })()}

      {showSection(focus, 'pendientes') && (
        <AdminPanel
          title="Por cobrar"
          actions={(
            <button
              type="button"
              onClick={() => void router.push('/admin/caja?tab=accounts')}
              className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
            >
              Cobrar en Caja →
            </button>
          )}
        >
          <p className="mb-3 text-[14px] text-p-text-secondary">
            Te deben{' '}
            <span className="font-bold tabular-nums text-p-text">{formatReportsMoney(report?.pendingAccounts.totalPending || 0)}</span> en{' '}
            {formatReportsNumber(report?.pendingAccounts.openCount || 0)}{' '}
            {Number(report?.pendingAccounts.openCount || 0) === 1 ? 'cuenta' : 'cuentas'}.
          </p>
          {loading && !report ? (
            <div className="h-24 animate-pulse rounded-xl bg-p-surface-2" />
          ) : (report?.pendingAccounts.accounts || []).length === 0 ? (
            <p className="text-[13px] text-p-text-muted">Nadie debe nada.</p>
          ) : (
            <ul className="divide-y divide-p-border">
              {(report?.pendingAccounts.accounts || []).map((account) => {
                const when = new Date(account.when || account.createdAt);
                const whenLabel = Number.isNaN(when.getTime())
                  ? ''
                  : when
                      .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
                      .replace(/,/g, '')
                      .replace(/\./g, '');
                const timeLabel =
                  account.courtName && !Number.isNaN(when.getTime())
                    ? when.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
                    : '';
                return (
                  <li key={account.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
                    <p className="col-span-2 text-[12px] text-p-text-muted sm:col-span-1">
                      {whenLabel}
                      {timeLabel ? ` · ${timeLabel}` : ''}
                    </p>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-p-text">{account.clientName}</p>
                      <p className="truncate text-[12px] text-p-text-muted">
                        {account.courtName ? `Reserva · ${account.courtName}` : account.sourceLabel}
                      </p>
                    </div>
                    <p className="text-[14px] font-semibold tabular-nums text-p-warning">{formatReportsMoney(account.pending)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminPanel>
      )}

      {showSection(focus, 'pos') && report && !loading && Number(report.pos.totals.salesTotal || 0) <= 0 && Number(report.pos.openAccountsCount || 0) === 0 && (
        <AdminPanel>
          <ReportsEmptyState
            title="No hubo ventas de mostrador en este período"
            description="Cuando vendas productos o servicios desde Caja, acá vas a ver qué se vende más y cómo te pagan."
            actionLabel="Ir a Caja"
            onAction={() => void router.push('/admin/caja')}
          />
        </AdminPanel>
      )}

      {showSection(focus, 'pos') && !(report && !loading && Number(report.pos.totals.salesTotal || 0) <= 0 && Number(report.pos.openAccountsCount || 0) === 0) && (
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
