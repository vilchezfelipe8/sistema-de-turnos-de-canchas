import React, { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const AdminDevDashboard = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      if (!res.ok) throw new Error('Error fetching health');
      const data = await res.json();
      setMetrics(data);
      setError(false);
    } catch (err) {
      console.error(err);
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
    <div className="flex items-center justify-center p-12 bg-gray-950 rounded-xl border border-gray-800">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
    </div>
  );
  
  if (error || !metrics) return (
    <div className="p-6 bg-red-950/30 border border-red-900 text-red-400 rounded-xl flex items-center gap-4">
      <span className="text-xl">❌</span>
      <span className="font-bold">Offline</span>
    </div>
  );

  // Convertimos el porcentaje "15%" a número 15 para pintar la barra
  const cpuPercent = parseFloat(metrics.server.cpu.usage);
  // Color dinámico: Verde (<50%), Amarillo (<80%), Rojo (>80%)
  const barColor = cpuPercent > 80 ? 'bg-red-500' : cpuPercent > 50 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-gray-950 text-white p-6 rounded-lg shadow-2xl border border-gray-800">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
            <h2 className="text-xl font-bold tracking-widest font-mono">SYSTEM_MONITOR_V2</h2>
          </div>
          <div className="text-xs text-gray-500 font-mono">
             REALTIME
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* COLUMNA 1 */}
          <div className="space-y-6">
            {/* DB Status */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
              <p className="text-gray-500 text-xs uppercase mb-2 font-bold">Database Status</p>
              <div className="flex justify-between items-end">
                <span className="text-white font-bold text-lg">{metrics.database.status}</span>
                <span className="text-2xl font-bold text-emerald-400 font-mono">{metrics.database.latency}</span>
              </div>
            </div>

            {/* Server Uptime */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
              <p className="text-gray-500 text-xs uppercase mb-2 font-bold">Server Uptime</p>
              <p className="text-white text-xl font-mono">{metrics.server.uptime}</p>
            </div>
            
            {/* OS Info */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
               <p className="text-gray-500 text-xs uppercase mb-2 font-bold">Platform</p>
               <p className="text-gray-400 text-sm">{metrics.server.platform}</p>
            </div>
          </div>

          {/* COLUMNA 2 */}
          <div className="space-y-6">
            
            {/* CPU COMPLETO (Núcleos + Consumo) */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
              <p className="text-blue-400 text-xs font-bold uppercase mb-2">Procesador (CPU)</p>
              
              {/* Parte 1: Hardware disponible */}
              <div className="flex items-baseline gap-2 mb-4">
                 <p className="text-4xl font-bold text-white font-mono">{metrics.server.cpu.cores}</p>
                 <span className="text-sm text-gray-500">núcleos físicos</span>
              </div>

              {/* Parte 2: Consumo actual */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Uso Actual:</span>
                  <span className="text-white font-bold font-mono">{metrics.server.cpu.usage}</span>
                </div>
                {/* Barra de progreso */}
                <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${barColor}`} 
                    style={{ width: metrics.server.cpu.usage }}
                  ></div>
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-3 font-mono truncate">
                {metrics.server.cpu.model}
              </p>
            </div>

            {/* RAM USAGE */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
              <p className="text-purple-400 text-xs font-bold uppercase mb-1">Memory Usage (RSS)</p>
              <p className="text-4xl font-bold text-white font-mono mb-4">{metrics.server.memory.rss}</p>
              <div className="w-full bg-gray-800 h-1 rounded-full overflow-hidden">
                <div className="bg-purple-500 h-full w-1/3 animate-pulse"></div>
              </div>
            </div>

            {/* HEAP */}
            <div className="bg-gray-900 p-5 rounded border border-gray-800">
                <p className="text-gray-500 text-xs uppercase mb-1 font-bold">Heap Objects</p>
                <p className="text-white text-lg font-mono">{metrics.server.memory.heap}</p>
            </div>
            
            <div className="text-right pt-2">
                <p className="text-xs text-gray-600 font-mono">Updated: {metrics.timestamp.split('T')[1].split('.')[0]}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDevDashboard;