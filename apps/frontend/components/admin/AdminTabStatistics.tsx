import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { DollarSign, Calendar, TrendingUp, CreditCard, Activity, RefreshCw, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { fetchWithAuth } from '../../utils/apiClient';
import { getApiUrl } from '../../utils/apiUrl';
import { reportUiError } from '../../utils/uiError';

const apiBase = () => `${getApiUrl()}/api`;

// Colores del gráfico de torta
const COLORS = ['#347048', '#926699', '#B9CF32', '#FF8042'];

interface Props {
  slugProp?: string;
}

type Period = 'hoy' | 'semana' | 'mes';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  BANK_ACCOUNT: 'Cuenta bancaria',
  VIRTUAL_WALLET: 'Billetera virtual',
  CASH_DRAWER: 'Caja',
  CARD_TERMINAL: 'Terminal',
  AUTO: 'Automático'
};

const toPaymentMethodLabel = (method?: string) => {
  const key = String(method || '').trim().toUpperCase();
  return PAYMENT_METHOD_LABELS[key] || method || 'Otro';
};

export const getDateRange = (period: Period, offset: number = 0) => {
  const start = new Date();
  const end = new Date();

  if (period === 'hoy') {
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0);
    
    end.setDate(end.getDate() + offset);
    end.setHours(23, 59, 59, 999);
  } 
  else if (period === 'semana') {
    const day = start.getDay() || 7; 
    start.setDate(start.getDate() - day + 1 + (offset * 7));
    start.setHours(0, 0, 0, 0);
    
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } 
  else if (period === 'mes') {
    start.setFullYear(start.getFullYear(), start.getMonth() + offset, 1);
    start.setHours(0, 0, 0, 0);
    
    end.setFullYear(end.getFullYear(), end.getMonth() + offset + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    rawStart: start, 
    rawEnd: end
  };
};

export default function AdminTabStatistics({ slugProp }: Props) {
  // 1. Obtención del slug
  const params = useParams<{ slug: string }>();
  const finalSlug = params?.slug || slugProp;

  // 2. Estados limpios
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null); 
  const [errorMessage, setErrorMessage] = useState('');
  const [activePeriod, setActivePeriod] = useState<Period>('mes');
  const [periodOffset, setPeriodOffset] = useState<number>(0);

  // 3. Funciones de UI
  const handlePeriodChange = (newPeriod: Period) => {
    setActivePeriod(newPeriod);
    setPeriodOffset(0);
  };

  const getPeriodLabel = () => {
    const { rawStart, rawEnd } = getDateRange(activePeriod, periodOffset);
    
    if (activePeriod === 'mes') {
      return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    }
    if (activePeriod === 'hoy') {
      if (periodOffset === 0) return 'Hoy';
      if (periodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    if (activePeriod === 'semana') {
      if (periodOffset === 0) return 'Esta Semana';
      if (periodOffset === -1) return 'Semana Pasada';
      return `${rawStart.getDate()} al ${rawEnd.getDate()} ${rawEnd.toLocaleDateString('es-AR', { month: 'short' })}`;
    }
  };

  // 4. Lógica de conexión con el Backend
  const loadStats = useCallback(async () => {
    try {
      setLoading(true); // Prendemos el loader al buscar datos nuevos
      setErrorMessage('');
      const { startDate, endDate } = getDateRange(activePeriod, periodOffset);
      
      const url = `${apiBase()}/clubs/${finalSlug}/admin/stats/dashboard?startDate=${startDate}&endDate=${endDate}`;
      
      const response = await fetchWithAuth(url);
      
      if (response.ok) {
        const data = await response.json();
        const normalizedPaymentMethods = Array.isArray(data?.paymentMethods)
          ? data.paymentMethods.map((row: any) => ({
              ...row,
              name: toPaymentMethodLabel(row?.name)
            }))
          : [];
        setStats({
          ...data,
          paymentMethods: normalizedPaymentMethods
        });
      } else {
        reportUiError({ area: 'AdminTabStatistics', action: 'loadStats' }, new Error(`Error del servidor: ${response.status}`));
        setErrorMessage('No se pudieron cargar las estadisticas para este periodo.');
      }
    } catch (error) {
      reportUiError({ area: 'AdminTabStatistics', action: 'loadStats' }, error);
      setErrorMessage('No se pudo conectar para traer estadisticas.');
    } finally {
      setLoading(false); // 🔥 TRAMPA EVITADA: Apagamos el loader falle o no la petición
    }
  }, [activePeriod, periodOffset, finalSlug]);

  // ÚNICO VIGILANTE: Escucha cambios en los filtros o el slug y carga los datos
  useEffect(() => {
    if (finalSlug) { 
      loadStats();
    }
  }, [finalSlug, loadStats]);

  // 5. Renders condicionales
  if (loading && !stats) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#347048]"></div>
    </div>
  );

  if (!stats) return (
    <div className="p-8 text-center">
        <p className="text-[#347048] font-bold text-lg">No hay datos disponibles para este período.</p>
        <button onClick={loadStats} className="mt-4 px-4 py-2 bg-[#347048] text-white rounded-lg">Reintentar</button>
    </div>
  );

  const averageTicket = stats?.totalBookings > 0 ? stats.totalRevenue / stats.totalBookings : 0;

  // 6. UI Principal
  return (
    <div className="density-compact p-4 space-y-6 animate-in fade-in duration-500 pb-12">
      
      <div className="flex items-center justify-between gap-3 mb-5">
        <h2 className="text-xl sm:text-2xl font-black text-[#EBE1D8] uppercase italic tracking-tight">Estadísticas y métricas</h2>
        <button
          onClick={loadStats}
          className="h-9 w-9 rounded-full border border-[#EBE1D8]/20 bg-[#347048]/35 text-[#B9CF32] flex items-center justify-center shadow-sm hover:shadow-md hover:border-[#B9CF32]/60 transition-all shrink-0"
          title="Actualizar datos"
        >
          <RefreshCw size={16} strokeWidth={3} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
          {errorMessage}
        </div>
      )}

      {/* KPI CARDS (Se mantienen iguales) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ... (Tus tarjetas siguen aquí tal cual) ... */}
        <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
           {/* ... Contenido Card 1 ... */}
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><DollarSign size={100} className="text-[#347048]" /></div>
           <div className="flex justify-between items-start mb-4 relative z-10">
             <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors"><DollarSign size={24} strokeWidth={2.5} /></div>
             <span className="text-[10px] font-black uppercase tracking-widest text-[#347048] bg-[#347048]/10 px-2 py-1 rounded-lg">{activePeriod === 'hoy' ? 'Hoy' : activePeriod === 'semana' ? 'Semana' : 'Mes'}</span>
           </div>
           <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Facturación Total</p>
           <h3 className="text-3xl font-black text-[#347048] relative z-10">${stats?.totalRevenue?.toLocaleString('es-AR') || 0}</h3>
        </div>
        <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
           {/* ... Contenido Card 2 ... */}
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Calendar size={100} className="text-[#347048]" /></div>
           <div className="flex justify-between items-start mb-4 relative z-10">
             <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors"><Calendar size={24} strokeWidth={2.5} /></div>
           </div>
           <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Turnos Finalizados</p>
           <h3 className="text-3xl font-black text-[#347048] relative z-10">{stats?.totalBookings || 0}</h3>
        </div>
        <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
           {/* ... Contenido Card 3 ... */}
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><TrendingUp size={100} className="text-[#347048]" /></div>
           <div className="flex justify-between items-start mb-4 relative z-10">
             <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors"><TrendingUp size={24} strokeWidth={2.5} /></div>
           </div>
           <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Ticket Promedio</p>
           <h3 className="text-3xl font-black text-[#347048] relative z-10">${averageTicket?.toLocaleString('es-AR') || 0}</h3>
        </div>
      </div>

      {/* SECCIÓN DE GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Gráfico 1: Evolución (CON TODO EL PANEL DE CONTROL INTEGRADO) */}
        <div className="bg-white p-5 rounded-[1.5rem] shadow-sm lg:col-span-2 border border-[#347048]/5 relative overflow-hidden">
          
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-[#347048]/10 pb-4">
            <h3 className="text-lg font-black text-[#347048] uppercase tracking-tight flex items-center gap-2">
              Evolución: Turnos vs Bar
            </h3>
            
            {/* PANEL DE CONTROL INTEGRADO */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Navegación de Fecha */}
              <div className="flex items-center bg-[#EBE1D8]/50 rounded-xl overflow-hidden border border-[#347048]/10">
                <button onClick={() => setPeriodOffset(prev => prev - 1)} className="p-2 text-[#347048] hover:bg-[#347048]/10 transition-colors">
                  <ChevronLeft size={18} strokeWidth={3} />
                </button>
                <span className="text-[#347048] font-black text-xs uppercase italic px-3 min-w-[100px] text-center">
                  {getPeriodLabel()}
                </span>
                <button onClick={() => setPeriodOffset(prev => prev + 1)} disabled={periodOffset === 0} className={`p-2 transition-colors ${periodOffset === 0 ? 'text-[#347048]/20' : 'text-[#347048] hover:bg-[#347048]/10'}`}>
                  <ChevronRight size={18} strokeWidth={3} />
                </button>
              </div>

              {/* Filtros HOY/SEMANA/MES */}
              <div className="flex items-center gap-1 bg-[#EBE1D8]/50 p-1 rounded-lg border border-[#347048]/10">
                <button onClick={() => handlePeriodChange('hoy')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'hoy' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Hoy</button>
                <button onClick={() => handlePeriodChange('semana')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'semana' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Semana</button>
                <button onClick={() => handlePeriodChange('mes')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'mes' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Mes</button>
              </div>
            </div>
          </div>

          <div className="h-72 w-full">
             <ResponsiveContainer width="100%" height="100%">
                {/* ... tu BarChart ... */}
                <BarChart data={stats?.dailyEvolution || []} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 11, fontWeight: 600}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 11, fontWeight: 600}} tickFormatter={(val) => `$${val/1000}k`} />
                  <Tooltip cursor={{fill: '#F3F4F6'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                  <Legend />
                  <Bar dataKey="turnos" name="Turnos" stackId="a" fill="#347048" radius={[0, 0, 0, 0]} barSize={40} />
                  <Bar dataKey="bar" name="Bar/Productos" stackId="a" fill="#B9CF32" radius={[6, 6, 0, 0]} barSize={40} />
                </BarChart>
             </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Métodos de Pago */}
        <div className="bg-white p-5 rounded-[1.5rem] shadow-sm border border-[#347048]/5 flex flex-col">
          <h3 className="text-lg font-black text-[#347048] mb-6 uppercase tracking-tight flex items-center gap-2 border-b border-[#347048]/10 pb-2">
            <CreditCard size={20} /> Métodos de Pago
          </h3>
          <div className="h-72 w-full relative flex-grow">
             {/* ... tu PieChart ... */}
             <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats?.paymentMethods || []} cx="50%" cy="50%" innerRadius={70} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none">
                    {stats?.paymentMethods?.map((entry: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Total']} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
             </ResponsiveContainer>
             <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
               <span className="text-[#347048]/40 font-black text-[10px] uppercase tracking-widest">TOTAL</span>
               <span className="text-[#347048] font-black text-2xl">${((stats?.totalRevenue || 0) / 1000).toFixed(0)}k</span>
             </div>
          </div>
        </div>
      </div>

      {/* SECCIÓN: PRODUCTOS VENDIDOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Resumen + listas */}
        <div className="bg-white p-5 rounded-[1.5rem] shadow-sm border border-[#347048]/5 flex flex-col">
          <h3 className="text-lg font-black text-[#347048] mb-6 uppercase tracking-tight flex items-center gap-2 border-b border-[#347048]/10 pb-2">
            <ShoppingBag size={20} /> Productos vendidos
          </h3>

          <div className="space-y-4">
            <div className="rounded-2xl bg-[#EBE1D8]/40 border border-[#347048]/10 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-1">Unidades (período)</p>
              <p className="text-3xl font-black text-[#347048]">
                {Number(stats?.products?.totals?.quantityAll || 0).toLocaleString('es-AR')}
              </p>
              <p className="text-[#347048]/50 text-xs font-bold mt-1">Total de unidades vendidas en el período</p>
            </div>

            <div className="rounded-2xl bg-[#EBE1D8]/40 border border-[#347048]/10 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-1">Facturación (período)</p>
              <p className="text-3xl font-black text-[#347048]">
                ${Number(stats?.products?.totals?.revenueAll || 0).toLocaleString('es-AR')}
              </p>
              <p className="text-[#347048]/50 text-xs font-bold mt-1">Total facturado por productos en el período</p>
            </div>

            <div className="rounded-2xl bg-[#EBE1D8]/40 border border-[#347048]/10 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-1">Productos sin ventas</p>
              <p className="text-3xl font-black text-[#347048]">
                {Number(stats?.products?.totals?.unsoldCount || 0).toLocaleString('es-AR')}
              </p>
              <p className="text-[#347048]/50 text-xs font-bold mt-1">
                Cantidad de productos activos con 0 ventas
              </p>
            </div>
          </div>
        </div>

        {/* Ranking */}
        <div className="bg-white p-5 rounded-[1.5rem] shadow-sm border border-[#347048]/5 lg:col-span-2 relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-[#347048]/10 pb-4">
            <div>
              <h3 className="text-lg font-black text-[#347048] uppercase tracking-tight flex items-center gap-2">
                Ranking de productos (unidades)
              </h3>
              <p className="text-[#347048]/50 text-[10px] font-black uppercase tracking-widest mt-1">
                Período activo: {getPeriodLabel()}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#347048] bg-[#347048]/10 px-2 py-1 rounded-lg">
                Top 12
              </span>

              <div className="flex items-center bg-[#EBE1D8]/50 rounded-xl overflow-hidden border border-[#347048]/10">
                <button onClick={() => setPeriodOffset(prev => prev - 1)} className="p-2 text-[#347048] hover:bg-[#347048]/10 transition-colors">
                  <ChevronLeft size={18} strokeWidth={3} />
                </button>
                <span className="text-[#347048] font-black text-xs uppercase italic px-3 min-w-[100px] text-center">
                  {getPeriodLabel()}
                </span>
                <button onClick={() => setPeriodOffset(prev => prev + 1)} disabled={periodOffset === 0} className={`p-2 transition-colors ${periodOffset === 0 ? 'text-[#347048]/20' : 'text-[#347048] hover:bg-[#347048]/10'}`}>
                  <ChevronRight size={18} strokeWidth={3} />
                </button>
              </div>

              <div className="flex items-center gap-1 bg-[#EBE1D8]/50 p-1 rounded-lg border border-[#347048]/10">
                <button onClick={() => handlePeriodChange('hoy')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'hoy' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Hoy</button>
                <button onClick={() => handlePeriodChange('semana')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'semana' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Semana</button>
                <button onClick={() => handlePeriodChange('mes')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activePeriod === 'mes' ? 'bg-[#347048] text-white shadow-md' : 'text-[#347048] hover:bg-[#347048]/10'}`}>Mes</button>
              </div>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={Array.isArray(stats?.products?.top) ? stats.products.top : []}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9CA3AF', fontSize: 11, fontWeight: 600 }}
                  interval={0}
                  angle={0}
                  textAnchor="middle"
                  height={40}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#9CA3AF', fontSize: 11, fontWeight: 600 }}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(value: any, _name: any, props: any) => {
                    const qty = Number(value || 0);
                    const revenue = Number(props?.payload?.revenue || 0);
                    return [`${qty.toLocaleString('es-AR')} u. ($${revenue.toLocaleString('es-AR')})`, 'Vendidas'];
                  }}
                />
                <Bar dataKey="quantity" name="Unidades" fill="#926699" radius={[6, 6, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detalle: Top / Menos / No vendidos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="rounded-2xl border border-[#347048]/10 bg-[#EBE1D8]/30 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-3">Más vendidos</p>
              <div className="space-y-2">
                {(Array.isArray(stats?.products?.top) ? stats.products.top : []).slice(0, 6).map((row: any, idx: number) => (
                  <div key={`${row?.productId || 'p'}-top-${idx}`} className="flex items-center justify-between gap-3">
                    <span className="text-[#347048] font-bold text-sm truncate">{row?.name || 'Producto'}</span>
                    <span className="text-[#347048]/70 font-black text-xs shrink-0">{Number(row?.quantity || 0)} u.</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#347048]/10 bg-[#EBE1D8]/30 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-3">Menos vendidos</p>
              <div className="space-y-2">
                {(Array.isArray(stats?.products?.bottom) ? stats.products.bottom : []).slice(0, 6).map((row: any, idx: number) => (
                  <div key={`${row?.productId || 'p'}-bottom-${idx}`} className="flex items-center justify-between gap-3">
                    <span className="text-[#347048] font-bold text-sm truncate">{row?.name || 'Producto'}</span>
                    <span className="text-[#347048]/70 font-black text-xs shrink-0">{Number(row?.quantity || 0)} u.</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#347048]/10 bg-[#EBE1D8]/30 p-5">
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mb-3">Sin ventas</p>
              <div className="space-y-2">
                {(Array.isArray(stats?.products?.unsold) ? stats.products.unsold : []).slice(0, 6).map((row: any, idx: number) => (
                  <div key={`${row?.productId || 'p'}-unsold-${idx}`} className="flex items-center justify-between gap-3">
                    <span className="text-[#347048] font-bold text-sm truncate">{row?.name || 'Producto'}</span>
                    <span className="text-[#347048]/70 font-black text-xs shrink-0">0 u.</span>
                  </div>
                ))}
              </div>
              {Number(stats?.products?.totals?.unsoldCount || 0) > 12 && (
                <p className="text-[#347048]/50 text-xs font-bold mt-3">
                  Mostrando 6 de {Number(stats?.products?.totals?.unsoldCount || 0)} productos sin ventas
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
