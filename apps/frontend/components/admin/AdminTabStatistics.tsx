import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  DollarSign,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { fetchWithAuth } from '../../utils/apiClient';
import { getApiUrl } from '../../utils/apiUrl';
import { reportUiError } from '../../utils/uiError';
import { AdminPanel } from './ui';
import ReportsEmptyState from '../../modules/informes/components/ReportsEmptyState';
import ReportsMetricGrid, { type ReportsMetric } from '../../modules/informes/components/ReportsMetricGrid';
import ReportsPeriodToolbar, { type ReportsPeriod } from '../../modules/informes/components/ReportsPeriodToolbar';
import RevenueChart, { type RevenueEvolutionPoint } from '../../modules/informes/components/RevenueChart';
import PaymentMethodsDonut, { type PaymentMethodDatum } from '../../modules/informes/components/PaymentMethodsDonut';
import ProductsRankingChart, { type ProductRankingDatum } from '../../modules/informes/components/ProductsRankingChart';
import ReportsRankingList from '../../modules/informes/components/ReportsRankingList';

const apiBase = () => `${getApiUrl()}/api`;

interface Props {
  slugProp?: string;
}

type Period = ReportsPeriod;

type ProductStats = {
  totals?: {
    quantityAll?: number;
    revenueAll?: number;
    quantityTop?: number;
    revenueTop?: number;
    unsoldCount?: number;
  };
  top?: ProductRankingDatum[];
  bottom?: ProductRankingDatum[];
  unsold?: ProductRankingDatum[];
};

type DashboardStats = {
  totalRevenue?: number;
  totalBookings?: number;
  dailyEvolution?: RevenueEvolutionPoint[];
  paymentMethods?: PaymentMethodDatum[];
  products?: ProductStats;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  BANK_ACCOUNT: 'Cuenta bancaria',
  VIRTUAL_WALLET: 'Billetera virtual',
  CASH_DRAWER: 'Caja',
  CARD_TERMINAL: 'Terminal',
  AUTO: 'Automatico',
};

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];

const toPaymentMethodLabel = (method?: string) => {
  const key = String(method || '').trim().toUpperCase();
  return PAYMENT_METHOD_LABELS[key] || method || 'Otro';
};

export const getDateRange = (period: Period, offset = 0) => {
  const start = new Date();
  const end = new Date();

  if (period === 'hoy') {
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0);

    end.setDate(end.getDate() + offset);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'semana') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1 + offset * 7);
    start.setHours(0, 0, 0, 0);

    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'mes') {
    start.setFullYear(start.getFullYear(), start.getMonth() + offset, 1);
    start.setHours(0, 0, 0, 0);

    end.setFullYear(end.getFullYear(), end.getMonth() + offset + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    rawStart: start,
    rawEnd: end,
  };
};

export default function AdminTabStatistics({ slugProp }: Props) {
  const finalSlug = slugProp;

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [activePeriod, setActivePeriod] = useState<Period>('hoy');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [adminToasts, setAdminToasts] = useState<Array<{ id: number; message: string }>>([]);
  const adminToastIdRef = useRef(1);
  const adminToastTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const showAdminToast = useCallback((message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = adminToastIdRef.current++;
    setAdminToasts((prev) => [...prev, { id, message: text }].slice(-4));
    const timeout = setTimeout(() => {
      setAdminToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3200);
    adminToastTimeoutsRef.current.push(timeout);
  }, []);

  useEffect(() => {
    return () => {
      adminToastTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      adminToastTimeoutsRef.current = [];
    };
  }, []);

  const handlePeriodChange = (newPeriod: Period) => {
    setActivePeriod(newPeriod);
    setPeriodOffset(0);
  };

  const getPeriodLabel = useCallback(() => {
    const { rawStart, rawEnd } = getDateRange(activePeriod, periodOffset);

    if (activePeriod === 'mes') {
      return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    }
    if (activePeriod === 'hoy') {
      if (periodOffset === 0) return 'Hoy';
      if (periodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    const formatWeekDay = (date: Date) => date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    }).replace('.', '').toLowerCase();
    return `${formatWeekDay(rawStart)} - ${formatWeekDay(rawEnd)}`;
  }, [activePeriod, periodOffset]);

  const loadStats = useCallback(async () => {
    if (!finalSlug) return;
    try {
      setLoading(true);
      setErrorMessage('');
      const { startDate, endDate } = getDateRange(activePeriod, periodOffset);
      const url = `${apiBase()}/clubs/${finalSlug}/admin/stats/dashboard?startDate=${startDate}&endDate=${endDate}`;
      const response = await fetchWithAuth(url);

      if (response.ok) {
        const data = await response.json();
        const normalizedPaymentMethods = Array.isArray(data?.paymentMethods)
          ? data.paymentMethods.map((row: any) => ({
              ...row,
              name: toPaymentMethodLabel(row?.name),
            }))
          : [];
        setStats({
          ...data,
          paymentMethods: normalizedPaymentMethods,
        });
      } else {
        reportUiError({ area: 'AdminTabStatistics', action: 'loadStats' }, new Error(`Error del servidor: ${response.status}`));
        const message = 'No se pudieron cargar las estadisticas para este periodo.';
        setErrorMessage(message);
        showAdminToast(message);
      }
    } catch (error) {
      reportUiError({ area: 'AdminTabStatistics', action: 'loadStats' }, error);
      const message = 'No se pudo conectar para traer estadisticas.';
      setErrorMessage(message);
      showAdminToast(message);
    } finally {
      setLoading(false);
    }
  }, [activePeriod, finalSlug, periodOffset, showAdminToast]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const dailyEvolution = useMemo(
    () => (
      Array.isArray(stats?.dailyEvolution)
        ? stats.dailyEvolution.map((row) => ({
            day: String(row?.day || ''),
            turnos: Number(row?.turnos || 0),
            bar: Number(row?.bar || 0),
          }))
        : []
    ),
    [stats?.dailyEvolution]
  );

  const paymentMethods = useMemo(
    () => (
      Array.isArray(stats?.paymentMethods)
        ? stats.paymentMethods.map((row) => ({
            name: String(row?.name || 'Otro'),
            value: Number(row?.value || 0),
          }))
        : []
    ),
    [stats?.paymentMethods]
  );

  const totalRevenue = Number(stats?.totalRevenue || 0);
  const totalBookings = Number(stats?.totalBookings || 0);
  const bookingsRevenue = dailyEvolution.reduce((sum, row) => sum + Number(row.turnos || 0), 0);
  const consumptionsRevenue = dailyEvolution.reduce((sum, row) => sum + Number(row.bar || 0), 0);
  const averageTicket = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  const productQuantity = Number(stats?.products?.totals?.quantityAll || 0);
  const productRevenue = Number(stats?.products?.totals?.revenueAll || 0);
  const unsoldCount = Number(stats?.products?.totals?.unsoldCount || 0);

  const topProducts = Array.isArray(stats?.products?.top) ? stats.products.top : [];
  const bottomProducts = Array.isArray(stats?.products?.bottom) ? stats.products.bottom : [];
  const unsoldProducts = Array.isArray(stats?.products?.unsold) ? stats.products.unsold : [];
  const soldTopProducts = topProducts.filter((row) => Number(row?.quantity || 0) > 0);
  const soldBottomProducts = bottomProducts.filter((row) => Number(row?.quantity || 0) > 0);

  const reportMetrics: ReportsMetric[] = [
    {
      label: 'Facturacion total',
      value: totalRevenue,
      format: 'money',
      icon: <DollarSign size={18} strokeWidth={2.4} />,
    },
    {
      label: 'Turnos finalizados',
      value: totalBookings,
      format: 'number',
      icon: <CalendarCheck size={18} strokeWidth={2.4} />,
    },
    {
      label: 'Ticket promedio',
      value: averageTicket,
      format: 'money',
      icon: <TrendingUp size={18} strokeWidth={2.4} />,
    },
    {
      label: 'Ingresos por consumos',
      value: consumptionsRevenue,
      format: 'money',
      icon: <ShoppingBag size={18} strokeWidth={2.4} />,
    },
  ];

  if (loading && !stats) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ReportsPeriodToolbar
          period={activePeriod}
          options={periodOptions}
          periodLabel={getPeriodLabel()}
          isCurrentPeriod={periodOffset === 0}
          onPeriodChange={handlePeriodChange}
          onPreviousPeriod={() => setPeriodOffset((prev) => prev - 1)}
          onNextPeriod={() => setPeriodOffset((prev) => prev + 1)}
        />
        <ReportsMetricGrid metrics={reportMetrics.map((metric) => ({ ...metric, loading: true }))} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <AdminPanel title="Ingresos por dia" description="Separacion entre reservas y consumos." className="lg:col-span-2">
            <div className="h-80 animate-pulse rounded-xl bg-[#f3f5fa]" />
          </AdminPanel>
          <AdminPanel title="Metodos de pago" description="Distribucion de cobros por medio.">
            <div className="h-80 animate-pulse rounded-xl bg-[#f3f5fa]" />
          </AdminPanel>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ReportsPeriodToolbar
          period={activePeriod}
          options={periodOptions}
          periodLabel={getPeriodLabel()}
          isCurrentPeriod={periodOffset === 0}
          onPeriodChange={handlePeriodChange}
          onPreviousPeriod={() => setPeriodOffset((prev) => prev - 1)}
          onNextPeriod={() => setPeriodOffset((prev) => prev + 1)}
        />
        <AdminPanel>
          <ReportsEmptyState
            title="No hay datos disponibles"
            description={errorMessage || 'No se encontraron estadisticas reales para el periodo seleccionado.'}
            actionLabel="Reintentar"
            onAction={() => void loadStats()}
          />
        </AdminPanel>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4" aria-busy={loading ? 'true' : undefined}>
      <ReportsPeriodToolbar
        period={activePeriod}
        options={periodOptions}
        periodLabel={getPeriodLabel()}
        isCurrentPeriod={periodOffset === 0}
        onPeriodChange={handlePeriodChange}
        onPreviousPeriod={() => setPeriodOffset((prev) => prev - 1)}
        onNextPeriod={() => setPeriodOffset((prev) => prev + 1)}
      />

      <ReportsMetricGrid metrics={reportMetrics} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminPanel
          title="Ingresos por dia"
          description="Pagos reales separados entre reservas y consumos."
          className="lg:col-span-2"
          actions={(
            <div className="flex items-center gap-3 text-[11px] font-semibold text-[#6f7890]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#1f2638]" />Reservas</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#3053e2]" />Consumos</span>
            </div>
          )}
        >
          <RevenueChart data={dailyEvolution} />
        </AdminPanel>

        <AdminPanel title="Metodos de pago" description="Distribucion de cobros por medio.">
          <PaymentMethodsDonut data={paymentMethods} />
        </AdminPanel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminPanel title="Productos vendidos" description="Resumen comercial del periodo." className="lg:col-span-3">
          <ReportsMetricGrid
            className="xl:grid-cols-3"
            metrics={[
              {
                label: 'Unidades vendidas',
                value: productQuantity,
                format: 'number',
                icon: <ShoppingBag size={18} strokeWidth={2.4} />,
              },
              {
                label: 'Facturacion productos',
                value: productRevenue,
                format: 'money',
                icon: <DollarSign size={18} strokeWidth={2.4} />,
              },
              {
                label: 'Productos sin ventas',
                value: unsoldCount,
                format: 'number',
                icon: <TrendingUp size={18} strokeWidth={2.4} />,
                valueColor: unsoldCount > 0 ? '#b42318' : undefined,
              },
            ]}
          />
        </AdminPanel>

        <AdminPanel title="Ranking de productos" description={`Ventas registradas en ${getPeriodLabel()}`} className="lg:col-span-2">
          <ProductsRankingChart data={topProducts} />
        </AdminPanel>

        <AdminPanel title="Lecturas accionables" description="Listas compactas para entender el comportamiento del catalogo.">
          <div className="space-y-3">
            <div className="rounded-xl border border-[#e7ebf3] bg-[#fbfcff] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#98a1b3]">
                Ingresos por reservas
              </p>
              <p className="mt-1 text-[24px] font-bold leading-none text-[#1a2035]">
                ${Number(bookingsRevenue || 0).toLocaleString('es-AR')}
              </p>
              <p className="mt-2 text-[12px] text-[#6f7890]">
                Calculado desde los pagos del periodo.
              </p>
            </div>
            <div className="rounded-xl border border-[#e7ebf3] bg-[#fbfcff] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#98a1b3]">
                Cobros por consumos
              </p>
              <p className="mt-1 text-[24px] font-bold leading-none text-[#3053e2]">
                ${Number(consumptionsRevenue || 0).toLocaleString('es-AR')}
              </p>
              <p className="mt-2 text-[12px] text-[#6f7890]">
                No incluye datos inventados ni proyecciones.
              </p>
            </div>
          </div>
        </AdminPanel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ReportsRankingList
          title="Mas vendidos"
          description="Productos con mayor cantidad vendida."
          rows={soldTopProducts}
          emptyLabel="Sin productos vendidos en este periodo."
        />
        <ReportsRankingList
          title="Menos vendidos"
          description="Productos con ventas bajas, sin contar los que no vendieron."
          rows={soldBottomProducts}
          emptyLabel="Todavia no hay ventas para comparar."
          tone="muted"
        />
        <ReportsRankingList
          title="Sin ventas"
          description="Productos activos sin movimientos en el periodo."
          rows={unsoldProducts}
          emptyLabel="No hay productos activos sin ventas."
          tone="muted"
          showRevenue={false}
        />
      </div>

      {adminToasts.length > 0 && (
        <div className="pointer-events-none fixed right-5 top-[84px] z-[150] flex w-full max-w-[360px] flex-col gap-2">
          {adminToasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-xl border border-[#dce2ee] bg-white px-3 py-2 text-[12px] font-semibold text-[#27314a] shadow-lg"
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
