import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../services/CourtService';
import { 
    getAdminSchedule, 
    cancelBooking, 
    createBooking,      
    createFixedBooking, 
    cancelFixedBooking  
} from '../services/BookingService';

// --- FUNCIÓN AUXILIAR: CALCULAR PRÓXIMA FECHA ---
// Busca la fecha del próximo "Lunes/Martes..." a partir de hoy
const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string): Date => {
  const resultDate = new Date(startDate);
  const currentDay = resultDate.getDay(); // 0=Domingo, 1=Lunes...
  
  // Calcular cuántos días faltan para llegar al día objetivo
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) {
    daysUntilTarget += 7; // Si ya pasó esta semana, saltamos a la siguiente
  }
  
  // Ajustar la fecha
  resultDate.setDate(resultDate.getDate() + daysUntilTarget);
  
  // Ajustar la hora
  const [hours, minutes] = timeStr.split(':').map(Number);
  resultDate.setHours(hours, minutes, 0, 0);
  
  return resultDate;
};

export default function AdminPage() {
  // --- ESTADOS DE LA PÁGINA ---
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS');
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // --- ESTADOS PARA CREAR RESERVA MANUAL ---
  const [manualBooking, setManualBooking] = useState({
      userId: '',     
      courtId: '',
      time: '18:00',
      isFixed: false,       // Checkbox
      dayOfWeek: '1',       // Nuevo: 1=Lunes, 2=Martes...
      startDateBase: new Date().toISOString().split('T')[0] // Base para calcular
  });

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

  // --- CREAR CANCHA ---
  const handleCreateCourt = async (e: React.FormEvent) => {
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

  // --- NUEVA LÓGICA: CREAR RESERVA (FIJA O NORMAL) ---
  const handleCreateBooking = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!manualBooking.courtId || !manualBooking.userId) return alert("Faltan datos");

      try {
          let dateBase: Date;

          // 1. OBTENEMOS LA FECHA "LOCAL" (Tal cual la ves en tu reloj)
          if (manualBooking.isFixed) {
              const base = new Date(manualBooking.startDateBase);
              base.setHours(12,0,0,0); // Evitamos saltos de día
              
              dateBase = getNextDateForDay(
                  base, 
                  parseInt(manualBooking.dayOfWeek), 
                  manualBooking.time
              );
          } else {
              dateBase = new Date(`${scheduleDate}T${manualBooking.time}:00`);
          }

          const offsetMinutes = dateBase.getTimezoneOffset(); // En Arg es 180 min (3hs)
          const dateToSend = new Date(dateBase.getTime() - (offsetMinutes * 60000));

          // 3. ENVIAMOS LA FECHA TRUCADA
          if (manualBooking.isFixed) {
              await createFixedBooking(
                  Number(manualBooking.userId), 
                  Number(manualBooking.courtId), 
                  1, // Tu ID de Actividad real
                  dateToSend // <--- Enviamos la fecha ajustada
              );
              alert(`✅ Turno FIJO creado. Arranca el: ${dateBase.toLocaleDateString()} a las ${manualBooking.time}`);
          } else {
              await createBooking(
                  Number(manualBooking.courtId), 
                  1, 
                  dateToSend, // <--- Enviamos la fecha ajustada
                  Number(manualBooking.userId)
              );
              alert("✅ Reserva simple creada");
          }
          
          loadSchedule(); 
      } catch (error: any) {
          alert('Error al reservar: ' + error.message);
      }
  };

  // --- LÓGICA MEJORADA DE CANCELACIÓN ---
  const handleCancelBooking = async (booking: any) => {
    
    // 1. CASO TURNO FIJO
    if (booking.fixedBookingId) {
        const confirmacion = confirm(
            `🔄 ESTE ES UN TURNO FIJO \n\n` +
            `[Aceptar] = Eliminar TODA la serie futura (Dar de baja)\n` +
            `[Cancelar] = Eliminar SOLO el turno de hoy`
        );

        try {
            if (confirmacion) {
                // Borrar toda la serie
                await cancelFixedBooking(booking.fixedBookingId);
                alert('✅ Serie de turnos fijos dada de baja.');
            } else {
                // Borrar solo hoy
                await cancelBooking(booking.id);
                alert('✅ Turno del día cancelado.');
            }
        } catch (error: any) {
            alert('Error: ' + error.message);
        }
    } 
    // 2. CASO TURNO NORMAL
    else {
        if (!confirm('⚠️ ¿Cancelar este turno simple?')) return;
        try {
            await cancelBooking(booking.id);
            alert('✅ Turno cancelado');
        } catch (error: any) {
            alert('Error: ' + error.message);
        }
    }
    
    loadSchedule();
  };

  return (
    <PageShell title="Panel de Comando" subtitle="Bienvenido Administrador">
      <div className="mx-auto w-full max-w-4xl">
        
        <div className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">PANEL DE COMANDO</h1>
          <p className="text-slate-500 font-mono text-sm">BIENVENIDO ADMINISTRADOR</p>
        </div>

        {/* --- FORMULARIO DE CREACIÓN CANCHA --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8">
            <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
              <span>✚</span> NUEVA CANCHA
            </h2>
            <form onSubmit={handleCreateCourt} className="flex flex-col sm:flex-row gap-4 items-end">
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

        {/* --- NUEVO: FORMULARIO DE RESERVA MANUAL --- */}
        <div className={`bg-surface-70 backdrop-blur-sm border rounded-2xl p-6 mb-8 border-l-4 transition-all ${manualBooking.isFixed ? 'border-l-blue-500 bg-blue-900/10' : 'border-l-green-500'}`}>
            <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
              <span>{manualBooking.isFixed ? '🔄' : '📅'}</span> 
              {manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
            </h2>
            
            <form onSubmit={handleCreateBooking} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                
                {/* Usuario */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">ID USUARIO</label>
                    <input type="number" 
                        value={manualBooking.userId} 
                        onChange={(e) => setManualBooking({...manualBooking, userId: e.target.value})}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-text" 
                        placeholder="ID" required 
                    />
                </div>

                {/* Cancha */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">CANCHA</label>
                    <select 
                        value={manualBooking.courtId} 
                        onChange={(e) => setManualBooking({...manualBooking, courtId: e.target.value})}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-text"
                        required
                    >
                        <option value="">Seleccionar...</option>
                        {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>

                {/* LÓGICA VISUAL: FECHA vs DÍA SEMANA */}
                {manualBooking.isFixed ? (
                    // MODO FIJO: Eliges Día de la Semana
                    <div>
                        <label className="block text-xs font-bold text-blue-400 mb-2">DÍA A REPETIR</label>
                        <select 
                            value={manualBooking.dayOfWeek}
                            onChange={(e) => setManualBooking({...manualBooking, dayOfWeek: e.target.value})}
                            className="w-full bg-surface border border-blue-500/50 rounded-lg px-3 py-2 text-white font-bold"
                        >
                            <option value="1">Lunes</option>
                            <option value="2">Martes</option>
                            <option value="3">Miércoles</option>
                            <option value="4">Jueves</option>
                            <option value="5">Viernes</option>
                            <option value="6">Sábado</option>
                            <option value="0">Domingo</option>
                        </select>
                    </div>
                ) : (
                   // MODO SIMPLE: Solo informativo
                   <div className="opacity-50">
                        <label className="block text-xs font-bold text-slate-500 mb-2">FECHA</label>
                        <div className="px-3 py-2 border border-border rounded-lg text-sm text-slate-400 bg-surface/50">
                            Ver grilla abajo 👇
                        </div>
                   </div>
                )}

                {/* Hora */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">HORA</label>
                    <input type="time" 
                        value={manualBooking.time} 
                        onChange={(e) => setManualBooking({...manualBooking, time: e.target.value})}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-text" 
                        required 
                    />
                </div>

                {/* Checkbox y Botón */}
                <div className="flex flex-col gap-2">
                     <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            checked={manualBooking.isFixed}
                            onChange={(e) => setManualBooking({...manualBooking, isFixed: e.target.checked})}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={manualBooking.isFixed ? "text-blue-400 font-bold" : ""}>Es Fijo</span>
                    </label>

                    <button type="submit" className={`btn w-full py-2 ${manualBooking.isFixed ? 'btn-primary bg-blue-600 hover:bg-blue-500' : 'btn-primary'}`}>
                        {manualBooking.isFixed ? 'CREAR SERIE' : 'AGENDAR'}
                    </button>
                </div>
            </form>
            
            {/* Texto de ayuda dinámico */}
            <p className="text-xs text-slate-500 mt-3 border-t border-slate-700/50 pt-2">
                {manualBooking.isFixed 
                    ? `ℹ️ Se crearán reservas todos los ${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][parseInt(manualBooking.dayOfWeek)]} a las ${manualBooking.time} por 6 meses.`
                    : `ℹ️ Se reservará para el día seleccionado en el filtro de abajo (${scheduleDate}).`
                }
            </p>
        </div>

        {/* --- LISTADO DE CANCHAS (Tabla) --- */}
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

        {/* --- GRILLA DE TURNOS --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-8">
          <h2 className="text-lg font-bold text-text mb-6">GRILLA DE TURNOS</h2>
          
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">FECHA A VER</label>
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
                            
                            {/* INDICADOR VISUAL DE FIJO */}
                            {slot.booking?.fixedBookingId && (
                                <span className="ml-2 text-xs bg-blue-900 text-blue-200 px-1 rounded border border-blue-700" title="Turno Fijo">
                                    🔄 FIJO
                                </span>
                            )}
                        </td>
                        <td className="p-3 text-slate-300">{slot.booking?.user ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}` : '-'}</td>
                        <td className="p-3 text-slate-400">{slot.booking?.user?.phoneNumber || '-'}</td>
                        
                        <td className="p-3 text-right">
                            {!slot.isAvailable && slot.booking && (
                                <button 
                                    onClick={() => handleCancelBooking(slot.booking)} 
                                    className={`text-xs btn px-2 py-1 ${slot.booking.fixedBookingId ? 'border-red-500 text-red-400' : ''}`}
                                    title={slot.booking.fixedBookingId ? "Cancelar Turno Fijo" : "Cancelar"}
                                >
                                    ✕ {slot.booking.fixedBookingId ? 'BAJA' : 'CANCELAR'}
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