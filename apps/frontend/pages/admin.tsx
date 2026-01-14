import { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../services/CourtService';
// ASEGÚRATE DE EXPORTAR cancelBooking EN TU SERVICE
import { getAdminSchedule, cancelBooking } from '../services/BookingService';

export default function AdminPage() {
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS');
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      setScheduleBookings(data);
      setLastUpdate(new Date());
    } catch (error: any) { alert('Error: ' + error.message); } finally { setLoadingSchedule(false); }
  };

  useEffect(() => { loadCourts(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await createCourt(newName, newSport); alert('✅ Cancha creada'); setNewName(''); loadCourts(); } 
    catch (error: any) { alert('Error: ' + error.message); }
  };

  const handleSuspend = async (id: number) => {
    if (!confirm('¿Suspender?')) return;
    try { await suspendCourt(id); loadCourts(); } catch (error: any) { alert('Error: ' + error.message); }
  };

  const handleReactivate = async (id: number) => {
    if (!confirm('¿Reactivar?')) return;
    try { await reactivateCourt(id); loadCourts(); } catch (error: any) { alert('Error: ' + error.message); }
  };

  // --- NUEVA FUNCIÓN DE CANCELACIÓN ---
  const handleCancelBooking = async (bookingId: number) => {
    if (!confirm('⚠️ ¿Estás seguro de cancelar este turno?\nLa cancha quedará libre inmediatamente.')) return;
    
    try {
        await cancelBooking(bookingId); // Llama al endpoint del backend
        alert('✅ Turno cancelado correctamente');
        loadSchedule(); // Recarga la grilla para ver el hueco libre
    } catch (error: any) {
        alert('Error al cancelar: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20">
      <Navbar />
      <div className="container mx-auto max-w-4xl p-4 lg:p-8 pt-28 lg:pt-32">
        
        <div className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">PANEL DE COMANDO</h1>
          <p className="text-slate-500 font-mono text-sm">BIENVENIDO ADMINISTRADOR</p>
        </div>

        {/* --- FORMULARIO DE CREACIÓN (Panel Oscuro) --- */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 mb-8">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span className="text-lime-500">✚</span> NUEVA CANCHA
            </h2>
            <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label>
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-lime-500 focus:ring-1 focus:ring-lime-500 outline-none" placeholder="Ej: Court Central" />
                </div>
                <div className="w-full sm:w-48">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Tipo</label>
                    <select value={newSport} onChange={(e) => setNewSport(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-lime-500 outline-none">
                        <option value="TENNIS">🎾 Tenis</option>
                        <option value="PADEL">🏓 Padel</option>
                        <option value="FUTBOL">⚽ Fútbol</option>
                    </select>
                </div>
                <button type="submit" className="w-full sm:w-auto px-6 py-2 bg-lime-600 hover:bg-lime-500 text-black font-bold rounded-lg transition-colors">
                  CREAR
                </button>
            </form>
        </div>

        {/* --- LISTADO DE CANCHAS (Tabla Tech) --- */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 mb-8 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">ESTADO DE CANCHAS</h2>
              <span className="px-3 py-1 bg-slate-800 rounded-full text-xs font-mono text-lime-400">{courts.length} ACTIVAS</span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="p-4">ID</th>
                    <th className="p-4">Nombre</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4 text-right">Controles</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-medium">
                  {courts.map((c) => (
                    <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                      <td className="p-4 font-mono text-slate-600">#{c.id.toString().padStart(3, '0')}</td>
                      <td className="p-4 text-white font-bold">{c.name}</td>
                      <td className="p-4">
                        <span className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300 border border-slate-700">{c.sport || c.surface || '-'}</span>
                      </td>
                      <td className="p-4">
                        {c.isUnderMaintenance 
                          ? <span className="text-red-500 flex items-center gap-1 text-xs">● MANTENIMIENTO</span> 
                          : <span className="text-emerald-500 flex items-center gap-1 text-xs">● OPERATIVO</span>}
                      </td>
                      <td className="p-4 text-right">
                        {c.isUnderMaintenance ? (
                          <button onClick={() => handleReactivate(c.id)} className="text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-800 px-3 py-1 rounded hover:bg-emerald-900/50">REACTIVAR</button>
                        ) : (
                          <button onClick={() => handleSuspend(c.id)} className="text-xs bg-red-900/30 text-red-400 border border-red-800 px-3 py-1 rounded hover:bg-red-900/50">SUSPENDER</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </div>

        {/* --- GRILLA DE TURNOS (Data Grid) --- */}
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-white mb-6">GRILLA DE TURNOS</h2>
          
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">FECHA</label>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-blue-500" />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors disabled:opacity-50">
              {loadingSchedule ? 'ESCANEANDO...' : 'CARGAR DATOS'}
            </button>
          </div>

          {lastUpdate && <p className="text-xs text-slate-500 font-mono mb-4 text-right">LAST_SYNC: {lastUpdate.toLocaleTimeString()}</p>}

          {scheduleBookings.length > 0 ? (
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-950 text-slate-500 text-xs uppercase">
                      <th className="p-3">Hora</th>
                      <th className="p-3">Cancha</th>
                      <th className="p-3">Estado</th>
                      <th className="p-3">Usuario</th>
                      <th className="p-3">Contacto</th>
                      {/* NUEVA COLUMNA ACCIONES */}
                      <th className="p-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm font-mono">
                    {scheduleBookings.map((slot, i) => (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/20">
                        <td className="p-3 text-slate-300">{slot.slotTime}</td>
                        <td className="p-3 text-white font-bold">{slot.courtName}</td>
                        <td className="p-3">
                           {slot.isAvailable ? <span className="text-slate-600">--</span> :
                            slot.booking?.status === 'CONFIRMED' ? <span className="text-red-400">OCUPADO</span> :
                            <span className="text-yellow-400">PENDIENTE</span>}
                        </td>
                        <td className="p-3 text-slate-300">{slot.booking?.user ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}` : '-'}</td>
                        <td className="p-3 text-slate-400">{slot.booking?.user?.phoneNumber || '-'}</td>
                        
                        {/* --- BOTÓN DE CANCELAR --- */}
                        <td className="p-3 text-right">
                            {/* Solo mostramos el botón si hay reserva y no está disponible */}
                            {!slot.isAvailable && slot.booking && (
                                <button 
                                    onClick={() => handleCancelBooking(slot.booking.id)}
                                    className="text-xs bg-red-900/20 text-red-500 border border-red-900/50 px-2 py-1 rounded hover:bg-red-900/40 hover:text-red-400 transition-colors"
                                    title="Cancelar este turno"
                                >
                                    ✕ CANCELAR
                                </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
          ) : (
            <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/30">
               <p className="text-slate-500">Sin datos cargados para esta fecha</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}