import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell';
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
    <PageShell title="Panel de Comando" subtitle="Bienvenido Administrador">
      <div className="mx-auto w-full max-w-4xl">
        
        <div className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">PANEL DE COMANDO</h1>
          <p className="text-slate-500 font-mono text-sm">BIENVENIDO ADMINISTRADOR</p>
        </div>

        {/* --- FORMULARIO DE CREACIÓN (Panel Oscuro) --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8">
            <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
              <span>✚</span> NUEVA CANCHA
            </h2>
            <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label>
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" placeholder="Ej: Court Central" />
                </div>
                <div className="w-full sm:w-48">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Tipo</label>
                    <select value={newSport} onChange={(e) => setNewSport(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none">
                        <option value="TENNIS">🎾 Tenis</option>
                        <option value="PADEL">🏓 Padel</option>
                        <option value="FUTBOL">⚽ Fútbol</option>
                    </select>
                </div>
                <button type="submit" className="btn btn-primary w-full sm:w-auto px-6 py-2">
                  CREAR
                </button>
            </form>
        </div>

        {/* --- LISTADO DE CANCHAS (Tabla Tech) --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-text">ESTADO DE CANCHAS</h2>
              <span className="px-3 py-1 bg-surface rounded-full text-xs font-mono text-muted">{courts.length} ACTIVAS</span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                <tr className="border-b border-border text-muted text-xs uppercase tracking-wider">
                    <th className="p-4">ID</th>
                    <th className="p-4">Nombre</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4 text-right">Controles</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-medium">
                  {courts.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-surface-70 transition-colors group">
                      <td className="p-4 font-mono text-muted">#{c.id.toString().padStart(3, '0')}</td>
                      <td className="p-4 text-text font-bold">{c.name}</td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded text-xs text-muted border border-border">{c.sport || c.surface || '-'}</span>
                      </td>
                      <td className="p-4">
                        {c.isUnderMaintenance 
                          ? <span className="text-muted flex items-center gap-1 text-xs">● MANTENIMIENTO</span> 
                          : <span className="text-text flex items-center gap-1 text-xs">● OPERATIVO</span>}
                      </td>
                      <td className="p-4 text-right">
                        {c.isUnderMaintenance ? (
                          <button onClick={() => handleReactivate(c.id)} className="text-xs btn px-3 py-1">REACTIVAR</button>
                        ) : (
                          <button onClick={() => handleSuspend(c.id)} className="text-xs btn px-3 py-1">SUSPENDER</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        </div>
        </div>

        {/* --- GRILLA DE TURNOS (Data Grid) --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-8">
          <h2 className="text-lg font-bold text-text mb-6">GRILLA DE TURNOS</h2>
          
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">FECHA</label>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                className="bg-surface border border-border rounded-lg px-4 py-2 text-text outline-none focus:border-border" />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="btn px-6 py-2">
              {loadingSchedule ? 'ESCANEANDO...' : 'CARGAR DATOS'}
            </button>
          </div>

          {lastUpdate && <p className="text-xs text-slate-500 font-mono mb-4 text-right">LAST_SYNC: {lastUpdate.toLocaleTimeString()}</p>}

          {scheduleBookings.length > 0 ? (
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                  <tr className="bg-surface text-muted text-xs uppercase">
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
                      <tr key={i} className="border-b border-border hover:bg-surface-70">
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
                                    className="text-xs btn px-2 py-1"
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
            <div className="text-center py-12 border border-dashed border-border rounded-xl bg-surface-70">
               <p className="text-muted">Sin datos cargados para esta fecha</p>
            </div>
          )}
        </div>

      </div>
    </PageShell>
  );
}