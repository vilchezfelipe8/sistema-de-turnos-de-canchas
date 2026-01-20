import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import PageShell from '../components/PageShell';
import AppModal from '../components/AppModal';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../services/CourtService';
import { 
    getAdminSchedule, 
    cancelBooking, 
    confirmBooking as confirmBookingService,
    createBooking,      
    createFixedBooking, 
    cancelFixedBooking  
} from '../services/BookingService';

// --- CONSTANTES ---
// Horarios válidos del club (Coinciden con tu backend)
const CLUB_TIME_SLOTS = [
  "08:00", "09:30", "11:00", "12:30", 
  "14:00", "15:30", "17:30", "19:00", 
  "20:30", "22:00"
];

// --- FUNCIÓN AUXILIAR: CALCULAR PRÓXIMA FECHA ---
// Busca la fecha del próximo "Lunes/Martes..." a partir de hoy
const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string) => {
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

  // Si es el mismo día y la hora ya pasó, saltar a la siguiente semana
  const now = new Date();
  let skippedPast = false;
  if (daysUntilTarget === 0 && resultDate.getTime() <= now.getTime()) {
    resultDate.setDate(resultDate.getDate() + 7);
    skippedPast = true;
  }
  
  return { date: resultDate, skippedPast };
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isPastSlot = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

const getTodayLocalDate = () => formatLocalDate(new Date());

const isPastTimeForDate = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

export default function AdminPage() {
  const router = useRouter();
  // --- ESTADOS DE LA PÁGINA ---
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS');
  const [scheduleDate, setScheduleDate] = useState(() => formatLocalDate(new Date()));
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: ReactNode;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => Promise<void> | void;
    onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({
      ...prev,
      show: false,
      onConfirm: undefined,
      onCancel: undefined
    }));
  };

  const wrapAction = (action?: () => Promise<void> | void) => async () => {
    closeModal();
    await action?.();
  };

  const showInfo = (message: ReactNode, title = 'Información') => {
    setModalState({
      show: true,
      title,
      message,
      cancelText: '',
      confirmText: 'OK'
    });
  };

  const showError = (message: ReactNode) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar'
    });
  };

  const showConfirm = (options: {
    title: string;
    message: ReactNode;
    confirmText?: string;
    cancelText?: string;
    isWarning?: boolean;
    onConfirm: () => Promise<void> | void;
    onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }) => {
    setModalState({
      show: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Aceptar',
      cancelText: options.cancelText ?? 'Cancelar',
      isWarning: options.isWarning ?? true,
      closeOnBackdrop: options.closeOnBackdrop,
      closeOnEscape: options.closeOnEscape,
      onConfirm: wrapAction(options.onConfirm),
      onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
    });
  };

  // --- GUARDIA DE ACCESO ADMIN ---
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    const user = rawUser ? JSON.parse(rawUser) : null;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!user || user.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    setAuthChecked(true);
  }, [router]);

  // --- ESTADOS PARA CREAR RESERVA MANUAL ---
  const [manualBooking, setManualBooking] = useState({
      guestFirstName: '',
      guestLastName: '',
      courtId: '',
      time: '19:00',  // CAMBIO: Iniciamos en un horario válido por defecto
      isFixed: false,       // Checkbox
      dayOfWeek: '1',       // Nuevo: 1=Lunes, 2=Martes...
      startDateBase: formatLocalDate(new Date()) // Base para calcular
  });

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      setScheduleBookings(data);
      setLastUpdate(new Date());
    } catch (error: any) {
      showError('Error: ' + error.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => { loadCourts(); }, []);
  useEffect(() => {
    if (!authChecked) {
      return;
    }
    loadSchedule();
  }, [scheduleDate, authChecked]);

  // --- CREAR CANCHA ---
  const handleCreateCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCourt(newName, newSport);
      showInfo('✅ Cancha creada', 'Listo');
      setNewName('');
      loadCourts();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  const handleSuspend = async (id: number) => {
    showConfirm({
      title: 'Suspender cancha',
      message: '¿Querés suspender esta cancha?',
      confirmText: 'Suspender',
      onConfirm: async () => {
        try {
          await suspendCourt(id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
      }
    });
  };

  const handleReactivate = async (id: number) => {
    showConfirm({
      title: 'Reactivar cancha',
      message: '¿Querés reactivar esta cancha?',
      confirmText: 'Reactivar',
      isWarning: false,
      onConfirm: async () => {
        try {
          await reactivateCourt(id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
      }
    });
  };

  // --- NUEVA LÓGICA: CREAR RESERVA (FIJA O NORMAL) ---
  const handleCreateBooking = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!manualBooking.courtId || !manualBooking.time) {
        showError('Faltan datos');
        return;
      }
      const firstName = manualBooking.guestFirstName.trim();
      const lastName = manualBooking.guestLastName.trim();
      if (!firstName || !lastName) {
        showError('Falta nombre y apellido');
        return;
      }

      try {
          let dateBase: Date;
          let skipNote = '';

          // 1. OBTENEMOS LA FECHA "LOCAL" (Tal cual la ves en tu reloj)
          if (manualBooking.isFixed) {
              const base = new Date(manualBooking.startDateBase);
              base.setHours(12,0,0,0); // Evitamos saltos de día
              
              const nextDateInfo = getNextDateForDay(
                  base, 
                  parseInt(manualBooking.dayOfWeek), 
                  manualBooking.time
              );
              dateBase = nextDateInfo.date;
              skipNote = nextDateInfo.skippedPast
                ? '⏭️ No se reservó para hoy porque el horario ya pasó.'
                : '';

              const todayStr = formatLocalDate(new Date());
              const dateStr = formatLocalDate(dateBase);
              if (!nextDateInfo.skippedPast && dateStr === todayStr) {
                try {
                  const schedule = await getAdminSchedule(dateStr);
                  const courtId = Number(manualBooking.courtId);
                  const hasConflict = schedule.some((slot: any) =>
                    slot.courtId === courtId &&
                    slot.slotTime === manualBooking.time &&
                    !slot.isAvailable
                  );
                  if (hasConflict) {
                    const nextWeek = new Date(dateBase);
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    dateBase = nextWeek;
                    skipNote = '⏭️ No se reservó para hoy porque ya hay un turno en ese horario.';
                  }
                } catch (error) {
                  // Si falla el chequeo, seguimos sin bloquear
                }
              }
          } else {
              dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
          }

          const dateToSend = dateBase;

          // 3. ENVIAMOS LA FECHA
          if (manualBooking.isFixed) {
              const guestName = `${manualBooking.guestFirstName.trim()} ${manualBooking.guestLastName.trim()}`.trim();
              await createFixedBooking(
                  undefined, 
                  Number(manualBooking.courtId), 
                  1, // Tu ID de Actividad real
                  dateToSend, // <--- Enviamos la fecha
                  guestName
              );
              const startLabel = dateBase.toLocaleDateString();
              const baseMessage = `✅ Turno FIJO creado. Arranca el: ${startLabel} a las ${manualBooking.time}`;
              const message = skipNote ? (
                <div>
                  <p className="mb-2">{skipNote}</p>
                  <p>{baseMessage}</p>
                </div>
              ) : baseMessage;
              showInfo(message, 'Listo');
          } else {
              const guestName = `${manualBooking.guestFirstName.trim()} ${manualBooking.guestLastName.trim()}`.trim();
              const guestIdentifier = `admin_${Date.now()}`;
              await createBooking(
                  Number(manualBooking.courtId), 
                  1, 
                  dateToSend, // <--- Enviamos la fecha ajustada
                  undefined,
                  { name: guestName },
                  { asGuest: true, guestIdentifier }
              );
              showInfo('✅ Reserva simple creada', 'Listo');
          }
          
          loadSchedule(); 
      } catch (error: any) {
          showError('Error al reservar: ' + error.message);
      }
  };

  // --- LÓGICA MEJORADA DE CANCELACIÓN ---
  const handleCancelBooking = async (booking: any) => {
    
    // 1. CASO TURNO FIJO
    if (booking.fixedBookingId) {
        showConfirm({
            title: '🛑 Atención: Turno Fijo',
            message: (
                <div>
                    <p>Este turno pertenece a una serie repetitiva.</p>
                    <p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p>
                </div>
            ),
            confirmText: 'Sí, borrar TODA la serie', // Botón Rojo fuerte
            cancelText: 'No, ver otras opciones',     // Botón Neutro
            
            // OPCIÓN A: Borrar todo
            onConfirm: async () => {
                try {
                    await cancelFixedBooking(booking.fixedBookingId);
                    showInfo('✅ Serie completa eliminada.', 'Éxito');
                    loadSchedule();
                } catch (error: any) {
                    showError('Error: ' + error.message);
                }
            },

            // OPCIÓN B: El usuario dijo "No borrar serie". Ahora preguntamos por "Solo hoy".
            onCancel: () => {
                // Lanzamos un SEGUNDO modal inmediatamente
                setTimeout(() => { // Pequeño delay para que no se solapen las animaciones
                    showConfirm({
                        title: '¿Borrar solo hoy?',
                        message: `¿Entonces deseas eliminar únicamente el turno de hoy (${booking.slotTime}) y mantener los futuros?`,
                        confirmText: 'Sí, borrar solo hoy',
                        cancelText: 'Cancelar (No tocar nada)', // AHORA SÍ ES SEGURO
                        
                        onConfirm: async () => {
                            try {
                                await cancelBooking(booking.id);
                                showInfo('✅ Turno del día eliminado.', 'Listo');
                                loadSchedule();
                            } catch (error: any) {
                                showError('Error: ' + error.message);
                            }
                        },
                        // onCancel aquí no hace nada, simplemente cierra el modal. Salida segura.
                        onCancel: () => {} 
                    });
                }, 200);
            },
            closeOnBackdrop: false,
            closeOnEscape: false
        });
    } 
    // 2. CASO TURNO NORMAL (Igual que antes)
    else {
        showConfirm({
            title: 'Cancelar turno',
            message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
            confirmText: 'Sí, Cancelar',
            cancelText: 'Volver',
            onConfirm: async () => {
                try {
                    await cancelBooking(booking.id);
                    showInfo('✅ Turno cancelado', 'Listo');
                    loadSchedule();
                } catch (error: any) {
                    showError('Error: ' + error.message);
                }
            }
        });
    }
};

  const handleConfirmBooking = async (booking: any) => {
    try {
      await confirmBookingService(booking.id);
      showInfo('✅ Turno confirmado', 'Listo');
      loadSchedule();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  if (!authChecked) {
    return null;
  }

  return (
    <PageShell title="Panel de Comando" subtitle="Bienvenido Administrador">
      <div className="mx-auto w-full max-w-4xl">
        
        
        {/* --- NUEVO: FORMULARIO DE RESERVA MANUAL --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4 transition-all relative overflow-hidden">
            <h2 className="text-lg font-bold text-text flex items-center gap-2">
              <span>{manualBooking.isFixed ? '🔄' : '📅'}</span> 
              {manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-border text-muted bg-surface">
                {manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}
              </span>
            </h2>
            
            <form onSubmit={handleCreateBooking} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(200px,220px)_minmax(110px,130px)_minmax(0,1fr)] gap-x-6 gap-y-4 items-end">
                
                {/* Nombre y apellido */}
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">NOMBRE</label>
                    <input type="text"
                      value={manualBooking.guestFirstName}
                      onChange={(e) => setManualBooking({...manualBooking, guestFirstName: e.target.value})}
                      className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
                      placeholder="Nombre"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">APELLIDO</label>
                    <input type="text"
                      value={manualBooking.guestLastName}
                      onChange={(e) => setManualBooking({...manualBooking, guestLastName: e.target.value})}
                      className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
                      placeholder="Apellido"
                      required
                    />
                  </div>
                </div>

                {/* Cancha */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">CANCHA</label>
                    <select 
                        value={manualBooking.courtId} 
                        onChange={(e) => setManualBooking({...manualBooking, courtId: e.target.value})}
                        className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
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
                        <label className="block text-xs font-bold text-slate-500 mb-2">DÍA A REPETIR</label>
                        <select 
                            value={manualBooking.dayOfWeek}
                            onChange={(e) => setManualBooking({...manualBooking, dayOfWeek: e.target.value})}
                            className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-white font-bold"
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
                   <div className="w-full">
                      <label className="block text-xs font-bold text-slate-500 mb-2">FECHA DEL TURNO</label>
                      <input 
                          type="date" 
                          value={manualBooking.startDateBase}
                          onChange={(e) => setManualBooking({...manualBooking, startDateBase: e.target.value})}
                          onClick={(e) => {
                            e.currentTarget.focus();
                            (e.currentTarget as HTMLInputElement).showPicker?.();
                          }}
                          min={getTodayLocalDate()}
                          className="w-full h-10 date-input bg-surface border border-border rounded-lg px-3 py-2 pr-12 text-white focus:outline-none focus:border-border"
                          required
                      />
                  </div>
                )}

                {/* --- CAMBIO AQUÍ: Hora con SELECT --- */}
                <div className="w-full">
                  <label className="block text-xs font-bold text-slate-500 mb-2">HORA</label>
                  <select 
                      value={manualBooking.time} 
                      onChange={(e) => setManualBooking({...manualBooking, time: e.target.value})}
                      // Estilos del Select cerrado
                      className="w-full h-10 bg-surface border border-border rounded-lg px-2 py-2 text-white cursor-pointer focus:outline-none focus:border-primary-500 appearance-none" 
                      required 
                  >
                      {CLUB_TIME_SLOTS.map((time) => {
                        const isPast = !manualBooking.isFixed && isPastTimeForDate(manualBooking.startDateBase, time);
                        return (
                          // 👇 AQUÍ ESTÁ LA MAGIA: Fondo oscuro y Texto blanco explícito
                          <option
                            key={time}
                            value={time}
                            className="bg-slate-800 text-white py-2"
                            disabled={isPast}
                          >
                              {time} hs
                          </option>
                        );
                      })}
                  </select>
                </div>

                {/* Checkbox y Botón */}
                <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-slate-300">
                        <input 
                            type="checkbox" 
                            checked={manualBooking.isFixed}
                            onChange={(e) => setManualBooking({...manualBooking, isFixed: e.target.checked})}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className={manualBooking.isFixed ? 'font-bold' : ''}>Es Fijo</span>
                    </label>

                    <button
                      type="submit"
                      className="btn btn-primary w-full py-2 bg-white/5 hover:bg-white/10 border-white/30 hover:border-white/60 text-text shadow-[0_0_16px_rgba(255,255,255,0.08)]"
                    >
                        {manualBooking.isFixed ? 'AGENDAR' : 'AGENDAR'}
                    </button>
                </div>
            </form>
            
            {/* Texto de ayuda dinámico */}
            <p className="text-xs text-slate-500 mt-3 border-t border-slate-700/50 pt-2">
                {manualBooking.isFixed 
                    ? `ℹ️ Se crearán reservas todos los ${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][parseInt(manualBooking.dayOfWeek)]} a las ${manualBooking.time} por 6 meses.`
                    : `ℹ️ Se reservará para el día seleccionado en este filtro (${manualBooking.startDateBase}).`
                }
            </p>
        </div>

        
        {/* --- GRILLA DE TURNOS --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-text">GRILLA DE TURNOS</h2>
          </div>
          
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">FECHA A VER</label>
              <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)}
                onClick={(e) => {
                  e.currentTarget.focus();
                  (e.currentTarget as HTMLInputElement).showPicker?.();
                }}
                className="date-input bg-surface border border-border rounded-lg px-4 py-2 text-text outline-none focus:border-border" />
            </div>
            <button
              onClick={loadSchedule}
              disabled={loadingSchedule}
              className="btn btn-primary relative min-w-[150px] px-6 py-2 bg-white/5 hover:bg-white/10 border-white/30 hover:border-white/60 shadow-[0_0_18px_rgba(255,255,255,0.08)] transition"
            >
              <span className={loadingSchedule ? 'opacity-0' : 'opacity-100'}>CARGAR DATOS</span>
              {loadingSchedule && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80"></span>
                </span>
              )}
            </button>
          </div>

          {lastUpdate && <p className="text-xs text-slate-500 font-mono mb-4 text-right">Última actualización: {lastUpdate.toLocaleTimeString()}</p>}

          {scheduleBookings.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60">
               <table className="w-full text-left">
                  <thead>
                  <tr className="bg-surface/60 text-muted text-xs uppercase tracking-wider border-b border-border/60">
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
                      <tr key={i} className="border-b border-border/60 hover:bg-surface-70/70 transition-colors">
                        <td className="p-3 text-slate-300">{slot.slotTime}</td>
                        <td className="p-3 text-white font-bold">{slot.courtName}</td>
                        <td className="p-3">
                           {slot.isAvailable ? (
                             isPastSlot(scheduleDate, slot.slotTime) ? (
                               <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-slate-500/30 text-slate-300 bg-slate-500/10">
                                 <span className="h-2 w-2 rounded-full bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.6)]"></span>
                                 NO JUGADO
                               </span>
                             ) : (
                             <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                               <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                               DISPONIBLE
                             </span>
                             )
                           ) : slot.booking?.status === 'CONFIRMED' ? (
                             <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-red-500/30 text-red-300 bg-red-500/10">
                               <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                              CONFIRMADO
                             </span>
                           ) : slot.booking?.status === 'COMPLETED' ? (
                             <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-blue-500/30 text-blue-200 bg-blue-500/10">
                               <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span>
                               COMPLETADO
                             </span>
                           ) : (
                             <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-yellow-500/30 text-yellow-200 bg-yellow-500/10">
                               <span className="h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></span>
                               PENDIENTE
                             </span>
                           )}
                           
                           {/* INDICADOR VISUAL DE FIJO */}
                           {slot.booking?.fixedBookingId && (
                               <span className="ml-2 text-xs bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded-full border border-blue-500/40" title="Turno Fijo">
                                   🔄 FIJO
                               </span>
                           )}
                        </td>
                        <td className="p-3 text-slate-300">
                          {slot.isAvailable
                            ? '-'
                            : slot.booking?.user
                              ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}`
                              : (slot.booking?.guestName || 'Invitado')}
                        </td>
                        <td className="p-3 text-slate-400">
                          {slot.isAvailable
                            ? '-'
                            : (slot.booking?.user?.phoneNumber ||
                              slot.booking?.guestPhone ||
                              slot.booking?.guestEmail ||
                              '-')}
                        </td>
                        
                        <td className="p-3 text-right">
                            {!slot.isAvailable && slot.booking && (
                                <div className="flex items-center justify-end gap-2 flex-nowrap whitespace-nowrap">
                                  {slot.booking.status === 'PENDING' && (
                                    <button
                                      onClick={() => handleConfirmBooking(slot.booking)}
                                      className="text-xs btn h-7 px-2.5 py-0 bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/70 leading-none whitespace-nowrap"
                                      title="Confirmar turno"
                                    >
                                      ✓ CONFIRMAR
                                    </button>
                                  )}
                                  <button 
                                      onClick={() => handleCancelBooking(slot.booking)} 
                                      className={`text-xs btn h-7 px-2.5 py-0 bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/70 leading-none whitespace-nowrap ${slot.booking.fixedBookingId ? 'shadow-[0_0_10px_rgba(239,68,68,0.25)]' : ''}`}
                                      title={slot.booking.fixedBookingId ? "Cancelar Turno Fijo" : "Cancelar"}
                                  >
                                      ✕ {slot.booking.fixedBookingId ? 'BAJA' : 'CANCELAR'}
                                  </button>
                                </div>
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

        {/* --- FORMULARIO DE CREACIÓN CANCHA --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-8 mb-4">
            <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
              <span>✚</span> NUEVA CANCHA
            </h2>
            <form onSubmit={handleCreateCourt} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label>
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" placeholder="Ej: Cancha Central" />
                </div>
                <div className="w-full sm:w-48">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Tipo</label>
                    <select value={newSport} onChange={(e) => setNewSport(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none">
                        <option value="TENNIS">🎾 Tenis</option>
                        <option value="PADEL">🏓 Pádel</option>
                        <option value="FUTBOL">⚽ Fútbol</option>
                    </select>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary w-full sm:w-auto px-6 py-2 bg-white/5 hover:bg-white/10 border-white/40 hover:border-white/70 shadow-[0_0_18px_rgba(255,255,255,0.08)] transition"
                >
                  CREAR
                </button>
            </form>
        </div>


        {/* --- LISTADO DE CANCHAS (Tabla) --- */}
            <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-text">ESTADO DE CANCHAS</h2>
                  <span className="px-3 py-1 bg-surface rounded-full text-xs font-mono text-emerald-300 border border-emerald-500/30">
                    {courts.length} ACTIVAS
                  </span>
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
                        {c.isUnderMaintenance ? (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-red-500/30 text-red-300 bg-red-500/10">
                            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                            MANTENIMIENTO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                            OPERATIVO
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {c.isUnderMaintenance ? (
                          <button
                            onClick={() => handleReactivate(c.id)}
                            className="text-xs btn px-3 py-1 bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/70"
                          >
                            REACTIVAR
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSuspend(c.id)}
                            className="text-xs btn px-3 py-1 bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/70"
                          >
                            SUSPENDER
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </div>

      </div>
      <AppModal
        show={modalState.show}
        onClose={closeModal}
        onCancel={modalState.onCancel}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop}
        closeOnEscape={modalState.closeOnEscape}
      />
    </PageShell>
  );
}