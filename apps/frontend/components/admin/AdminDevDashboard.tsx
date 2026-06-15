import React, { useEffect, useState } from 'react';
import { Activity, Database, Server, Cpu, HardDrive, Clock, AlertTriangle } from 'lucide-react';
import { getApiUrl } from '../../utils/apiUrl';
import { reportUiError } from '../../utils/uiError';

const AdminDevDashboard = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/health`);
      if (!res.ok) throw new Error('Error al obtener el estado de salud del sistema');
      const data = await res.json();
      setMetrics(data);
      setError(false);
    } catch (err) {
      reportUiError({ area: 'AdminDevDashboard', action: 'fetchMetrics' }, err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20 bg-ink-50 rounded-[2rem] border-4 border-white shadow-xl">
      <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-lima-900"></div>
      <p className="text-ink-900 font-black uppercase tracking-widest mt-4">Escaneando Sistema...</p>
    </div>
  );
  
  if (error || !metrics) return (
    <div className="p-10 bg-p-error-bg border-4 border-white text-p-error rounded-[2rem] flex flex-col items-center gap-4 shadow-xl">
      <AlertTriangle size={36} className="text-p-error" />
      <span className="font-black uppercase tracking-widest italic">Servidor fuera de línea</span>
      <button onClick={fetchMetrics} className="mt-2 text-xs font-bold underline uppercase">Reintentar conexión</button>
    </div>
  );

  const cpuPercent = parseFloat(metrics.server.cpu.usage); 
  const physicalCpus = 1;
  const barColor = cpuPercent > 80 ? 'bg-p-error' : cpuPercent > 50 ? 'bg-p-accent' : 'bg-lima-300';

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* TARJETA PRINCIPAL BEIGE */}
      <div className="bg-ink-50 text-ink-900 p-8 rounded-[2.5rem] shadow-2xl border-4 border-white relative overflow-hidden">
        
        {/* Decoración de fondo */}
        <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none">
            <Activity size={300} strokeWidth={1} />
        </div>

        {/* Header Pique */}
        <div className="flex justify-between items-center mb-10 border-b border-lima-900/10 pb-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="bg-lima-300 p-2 rounded-xl shadow-lg shadow-lima-300/20">
                <Activity size={24} className="text-ink-900" strokeWidth={3} />
            </div>
            <div>
                <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none">Estado del Sistema</h2>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/40 mt-1">Monitor de Salud en Tiempo Real</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-p-surface/40 px-4 py-2 rounded-full border border-white/60 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-lima-300 animate-pulse"></div>
            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Servidor Activo</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
          
          {/* COLUMNA 1: INFRAESTRUCTURA */}
          <div className="space-y-6">
            {/* DATABASE */}
            <div className="bg-p-surface/60 p-6 rounded-2xl border border-white shadow-sm hover:bg-p-surface transition-colors">
              <div className="flex items-center gap-3 mb-4 text-p-accent">
                <Database size={18} strokeWidth={2.5} />
                <p className="text-[10px] font-black uppercase tracking-widest">Base de Datos (PostgreSQL)</p>
              </div>
              <div className="flex justify-between items-end">
                <span className="text-ink-900 font-black text-xl italic uppercase tracking-tight">{metrics.database.status}</span>
                <div className="text-right">
                    <span className="block text-[9px] font-black uppercase opacity-40">Latencia</span>
                    <span className="text-2xl font-black text-lima-300 italic tracking-tighter drop-shadow-sm">{metrics.database.latency}</span>
                </div>
              </div>
            </div>

            {/* UPTIME */}
            <div className="bg-p-surface/60 p-6 rounded-2xl border border-white shadow-sm">
              <div className="flex items-center gap-3 mb-4 text-ink-900/50">
                <Clock size={18} strokeWidth={2.5} />
                <p className="text-[10px] font-black uppercase tracking-widest">Tiempo de Actividad</p>
              </div>
              <p className="text-ink-900 text-2xl font-black italic tracking-tighter">{metrics.server.uptime}</p>
            </div>
            
            {/* PLATFORM */}
            <div className="bg-lima-700 p-6 rounded-2xl border border-lima-900 shadow-lg shadow-lima-900/20">
               <div className="flex items-center gap-3 mb-2 text-ink-50/40">
                 <Server size={18} />
                 <p className="text-[10px] font-black uppercase tracking-widest">Entorno de Ejecución</p>
               </div>
               <p className="text-ink-50 font-black text-sm uppercase tracking-wider italic">{metrics.server.platform}</p>
            </div>
          </div>

          {/* COLUMNA 2: HARDWARE */}
          <div className="space-y-6">
            
            {/* CPU */}
            <div className="bg-p-surface p-6 rounded-3xl border-2 border-lima-900/5 shadow-xl">
              <div className="flex items-center gap-3 mb-4 text-ink-900/60">
                <Cpu size={18} strokeWidth={2.5} />
                <p className="text-[10px] font-black uppercase tracking-widest">Unidad de Procesamiento</p>
              </div>
              
              <div className="flex items-baseline gap-3 mb-4">
                <p className="text-6xl font-black text-ink-900 italic tracking-tighter">{physicalCpus}</p>
                <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-tight italic">Socket Físico</span>
                    <span className="text-[10px] font-bold opacity-40 uppercase">{metrics.server.cpu.cores} Núcleos Lógicos</span>
                </div>
              </div>

              {/* Barra de carga */}
              <div className="space-y-2 bg-lima-700/5 p-4 rounded-2xl border border-lima-900/5">
                 <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1">
                    <span className="opacity-40">Carga Actual:</span>
                    <span className="text-ink-900">{metrics.server.cpu.usage}</span>
                 </div>
                 <div className="w-full bg-lima-700/10 h-3 rounded-full overflow-hidden p-0.5">
                    <div 
                        className={`h-full rounded-full transition-all duration-700 ${barColor}`} 
                        style={{ width: metrics.server.cpu.usage }}
                    ></div>
                 </div>
              </div>

              <p className="text-[9px] text-ink-900/30 mt-4 font-bold uppercase tracking-widest truncate italic" title={metrics.server.cpu.model}>
                {metrics.server.cpu.model}
              </p>
            </div>

            {/* RAM & HEAP */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-p-accent p-5 rounded-2xl shadow-lg shadow-p-card">
                    <p className="text-ink-50/60 text-[9px] font-black uppercase tracking-widest mb-1">Memoria (RSS)</p>
                    <p className="text-xl font-black text-ink-50 italic tracking-tighter">{metrics.server.memory.rss}</p>
                    <div className="w-full bg-p-surface/20 h-1 rounded-full mt-3 overflow-hidden">
                        <div className="bg-lima-300 h-full w-1/3 animate-pulse"></div>
                    </div>
                </div>
                <div className="bg-p-surface/60 p-5 rounded-2xl border border-white">
                    <p className="text-ink-900/40 text-[9px] font-black uppercase tracking-widest mb-1">Heap Objects</p>
                    <p className="text-xl font-black text-ink-900 italic tracking-tighter">{metrics.server.memory.heap}</p>
                </div>
            </div>
            
            <div className="text-right pt-4 border-t border-lima-900/5">
                <p className="text-[10px] font-black text-ink-900/30 uppercase tracking-[0.2em]">Último análisis: {metrics.timestamp.split('T')[1].split('.')[0]}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDevDashboard;
