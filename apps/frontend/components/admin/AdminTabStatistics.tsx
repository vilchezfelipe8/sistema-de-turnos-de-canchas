import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ClubAdminService } from '../../services/ClubAdminService';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { DollarSign, Calendar, TrendingUp, CreditCard, Activity, RefreshCw } from 'lucide-react';

// Colores del gráfico de torta (Verde Club, Lila, Verde Claro, Naranja)
const COLORS = ['#347048', '#926699', '#B9CF32', '#FF8042'];

interface Props {
  slugProp?: string;
}

export default function AdminTabStatistics({ slugProp }: Props) {
  // 1. Intentamos obtener el slug de la URL
  const params = useParams<{ slug: string }>();
  
  // 2. LÓGICA CLAVE: Si no está en la URL, usamos el que nos pasan por props
  const finalSlug = params?.slug || slugProp;

  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Solo cargamos si tenemos algún slug válido
    if (finalSlug) {
      loadStats();
    }
  }, [finalSlug]);

  const loadStats = async () => {
    if (!finalSlug) return;

    try {
      setLoading(true);
      const data = await ClubAdminService.getDashboardStats(finalSlug);
      setStats(data);
    } catch (error) {
      console.error("Error cargando estadísticas:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
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

  // Calculamos el ticket promedio de forma segura
  const averageTicket = stats.totalBookings > 0 
    ? Math.round(stats.totalRevenue / stats.totalBookings) 
    : 0;

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* TÍTULO DE SECCIÓN - ESTILO CAJA */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black text-[#EBE1D8] flex items-center gap-3 uppercase italic tracking-tighter">
            <div className="bg-[#B9CF32] text-[#347048] p-2 rounded-xl shadow-lg shadow-[#B9CF32]/20">
              <Activity size={28} strokeWidth={3} />
            </div>
            Estadísticas y Métricas
          </h2>
          <p className="text-[#EBE1D8]/60 text-xs font-bold uppercase tracking-[0.2em] mt-1 ml-14">
            Resumen de rendimiento del mes actual
          </p>
        </div>

        {/* Acciones de la derecha */}
        <div className="flex items-center gap-3">
          {/* Fecha */}
          <div className="bg-[#347048]/40 border border-[#EBE1D8]/10 px-4 py-2 rounded-2xl backdrop-blur-sm">
            <span className="text-[#EBE1D8] font-black text-sm uppercase italic">
              {new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}
            </span>
          </div>
          
          {/* Botón Actualizar */}
          <button 
            onClick={loadStats}
            className="bg-[#B9CF32] text-[#347048] p-3 rounded-2xl shadow-lg hover:scale-105 transition-transform"
            title="Actualizar datos"
          >
            <RefreshCw size={20} strokeWidth={3} />
          </button>
        </div>
      </div>

      {/* KPI CARDS (TARJETAS SUPERIORES) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Card 1: Facturación */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <DollarSign size={100} className="text-[#347048]" />
          </div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors">
              <DollarSign size={24} strokeWidth={2.5} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#347048] bg-[#347048]/10 px-2 py-1 rounded-lg">
              Este Mes
            </span>
          </div>
          <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Facturación Total</p>
          <h3 className="text-4xl font-black text-[#347048] relative z-10">
            ${stats.totalRevenue?.toLocaleString('es-AR')}
          </h3>
        </div>

        {/* Card 2: Reservas */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Calendar size={100} className="text-[#347048]" />
          </div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors">
              <Calendar size={24} strokeWidth={2.5} />
            </div>
          </div>
          <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Turnos Confirmados</p>
          <h3 className="text-4xl font-black text-[#347048] relative z-10">
            {stats.totalBookings}
          </h3>
        </div>

        {/* Card 3: Ticket Promedio */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#347048]/5 hover:shadow-md transition-all group relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <TrendingUp size={100} className="text-[#347048]" />
          </div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="p-3 bg-[#EBE1D8] rounded-xl text-[#347048] group-hover:bg-[#347048] group-hover:text-white transition-colors">
              <TrendingUp size={24} strokeWidth={2.5} />
            </div>
          </div>
          <p className="text-[#347048]/60 text-xs font-black uppercase tracking-widest mb-1 relative z-10">Ticket Promedio</p>
          <h3 className="text-4xl font-black text-[#347048] relative z-10">
            ${averageTicket.toLocaleString('es-AR')}
          </h3>
        </div>
      </div>

      {/* SECCIÓN DE GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm lg:col-span-2 border border-[#347048]/5 relative overflow-hidden">
  <h3 className="text-lg font-black text-[#347048] mb-6 uppercase tracking-tight flex items-center gap-2 border-b border-[#347048]/10 pb-2">
     Evolución: Turnos vs Bar
  </h3>
  <div className="h-80 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={stats.dailyEvolution} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 11, fontWeight: 600}} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 11, fontWeight: 600}} tickFormatter={(val) => `$${val/1000}k`} />
        
        {/* Tooltip personalizado para sumar ambos */}
        <Tooltip 
          cursor={{fill: '#F3F4F6'}}
          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}}
        />
        <Legend />

        {/* BARRAS APILADAS: El stackId="a" es la clave */}
        <Bar dataKey="turnos" name="Turnos" stackId="a" fill="#347048" radius={[0, 0, 0, 0]} barSize={40} />
        <Bar dataKey="bar" name="Bar/Productos" stackId="a" fill="#B9CF32" radius={[6, 6, 0, 0]} barSize={40} />
      </BarChart>
    </ResponsiveContainer>
  </div>
</div>

        {/* GRÁFICO 2: Métodos de Pago (Torta) - Ocupa 1 columna */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-[#347048]/5 flex flex-col">
          <h3 className="text-lg font-black text-[#347048] mb-6 uppercase tracking-tight flex items-center gap-2 border-b border-[#347048]/10 pb-2">
            <CreditCard size={20} /> Métodos de Pago
          </h3>
          <div className="h-80 w-full relative flex-grow">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.paymentMethods}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {stats.paymentMethods?.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Total']} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Centro del gráfico: Total Resumido */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
               <span className="text-[#347048]/40 font-black text-[10px] uppercase tracking-widest">TOTAL</span>
               <span className="text-[#347048] font-black text-2xl">
                 ${(stats.totalRevenue / 1000).toFixed(0)}k
               </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}