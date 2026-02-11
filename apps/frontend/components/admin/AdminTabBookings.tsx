import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import DatePicker from 'react-datepicker';
import { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale/es';
import 'react-datepicker/dist/react-datepicker.css';
import { getCourts } from '../../services/CourtService';
import {
  getAdminSchedule,
  cancelBooking,
  confirmBooking as confirmBookingService,
  createBooking,
  createFixedBooking,
  cancelFixedBooking,
  searchClients 
} from '../../services/BookingService';
import AppModal from '../AppModal';
import BookingConsumption from '../BookingConsumption';
import { useParams } from 'react-router-dom';
import DatePickerDark from '../../components/ui/DatePickerDark';
import { Trash2, Check, ShoppingCart } from 'lucide-react'; 

registerLocale('es', es);

const CLUB_TIME_SLOTS = [
  '08:00', '09:30', '11:00', '12:30',
  '14:00', '15:30', '17:30', '19:00',
  '20:30', '22:00'
];

// --- COMPONENTE PORTAL (VERSIÓN BLACK) ---
const ModalPortal = ({ children, onClose }: { children: ReactNode, onClose: () => void }) => {
  if (typeof document === 'undefined') return null;
  
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-xl bg-black border border-gray-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="overflow-y-auto p-6 custom-scrollbar">
            {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

// --- FUNCIONES AUXILIARES ---
const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string) => {
  const resultDate = new Date(startDate);
  const currentDay = resultDate.getDay();
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  resultDate.setDate(resultDate.getDate() + daysUntilTarget);
  const [hours, minutes] = timeStr.split(':').map(Number);
  resultDate.setHours(hours, minutes, 0, 0);
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

const getTodayLocalDate = () => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
};

const isPastTimeForDate = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

export default function AdminTabBookings() {
  const [courts, setCourts] = useState<any[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => getTodayLocalDate());
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);

  
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const params = useParams();
  const urlSlug = params.slug;

  const handleOpenPaymentModal = (bookingId: number) => {
    setSelectedBookingId(bookingId);
    setShowPaymentModal(true);
};



  const [manualBooking, setManualBooking] = useState({
    guestFirstName: '',
    guestLastName: '',
    guestPhone: '',
    guestDni: '',
    courtId: '',
    time: '19:00',
    isFixed: false,
    dayOfWeek: '1',
    startDateBase: getTodayLocalDate()
  });

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // --- OBTENER SLUG (INTELIGENTE) ---
  const getClubSlug = () => {
    if (urlSlug) return urlSlug;
    try {
      const userStored = localStorage.getItem('user');
      if (userStored) {
        const user = JSON.parse(userStored);
        const foundSlug = user.slug || user.clubSlug || (user.club && user.club.slug);
        if (foundSlug) return foundSlug;

        // Fallbacks por apellido/nombre si falta el slug
        if (user.lastName && user.lastName.toLowerCase() !== 'admin') {
             return user.lastName.toLowerCase().trim().replace(/\s+/g, '-');
        }
        if (user.firstName && user.firstName.toLowerCase() !== 'admin') {
             return user.firstName.toLowerCase().trim().replace(/\s+/g, '-');
        }
      }
    } catch (e) {
      console.error(e);
    }
    return ''; 
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setManualBooking({ ...manualBooking, guestFirstName: value });
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (value.length >= 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const currentSlug = getClubSlug();
          if (!currentSlug) {
              console.warn("⚠️ Búsqueda cancelada: No hay slug.");
              return; 
          }
          const results = await searchClients(currentSlug, value);
          setSearchResults(results || []);
          setShowDropdown(true);
        } catch (error) {
          console.error("Error buscando:", error);
        }
      }, 300);
    } else {
      setShowDropdown(false);
    }
  };

  const selectClient = (client: any) => {
    let fName = client.firstName || '';
    let lName = client.lastName || '';
    
    // Si el nombre viene todo junto, lo separamos
    if (!lName && fName.includes(' ')) {
      const parts = fName.split(' ');
      fName = parts[0];
      lName = parts.slice(1).join(' ');
    }

    // 👇 LÓGICA DE LIMPIEZA DEL TELÉFONO 👇
    let rawPhone = client.phoneNumber || client.phone || client.celular || '';
    
    // Si existe el teléfono, le sacamos el +549 o el 549 del principio
    if (rawPhone) {
        rawPhone = rawPhone.toString().replace(/^(\+?549)/, '');
    }

    setManualBooking({
      ...manualBooking,
      guestFirstName: fName,
      guestLastName: lName,
      guestPhone: rawPhone, // <--- Ahora va limpio (ej: 351...)
      guestDni: client.dni || client.dniNumber || client.document || '' 
    });
    setShowDropdown(false);
  };;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  const wrapAction = (action?: () => Promise<void> | void) => async () => { closeModal(); await action?.(); };
  
  const showConfirm = (options: {
    title: string; message: ReactNode; confirmText?: string; cancelText?: string; isWarning?: boolean;
    onConfirm: () => Promise<void> | void; onCancel?: () => Promise<void> | void; closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }) => setModalState({
    show: true, title: options.title, message: options.message,
    confirmText: options.confirmText ?? 'Aceptar', cancelText: options.cancelText ?? 'Cancelar',
    isWarning: options.isWarning ?? true, closeOnBackdrop: options.closeOnBackdrop, closeOnEscape: options.closeOnEscape,
    onConfirm: wrapAction(options.onConfirm), onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
  });

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      let mergedSlots = data;
      try {
        if (courts && courts.length > 0) {
          const slotMap = new Map();
          (data || []).forEach((s: any) => slotMap.set(`${s.slotTime}::${s.courtId}`, s));
          mergedSlots = [];
          for (const time of CLUB_TIME_SLOTS) {
            for (const c of courts) {
              const key = `${time}::${c.id}`;
              mergedSlots.push(slotMap.get(key) || { slotTime: time, courtId: c.id, courtName: c.name, isAvailable: true });
            }
          }
        }
      } catch (err) {
        console.warn('Error merging schedule with courts:', err);
      }
      setScheduleBookings(mergedSlots);
      setLastUpdate(new Date());
    } catch (error: any) {
      showError('Error: ' + error.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => { loadCourts(); }, []);
  useEffect(() => { loadSchedule(); }, [scheduleDate, courts]);

  // --- 🔥 LOGICA DE CREACIÓN DE RESERVA CORREGIDA (DNI) 🔥 ---
  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos'); return; }
    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    if (!firstName || !lastName) { showError('Falta nombre y apellido'); return; }
    
    try {
      const rawPhone = (manualBooking.guestPhone || '').replace(/\D/g, '');
      const phoneToSend = rawPhone ? `+549${rawPhone}` : '';
      const guestName = `${firstName} ${lastName}`.trim();
      let dateBase: Date;
      let skipNote = '';
      
      if (manualBooking.isFixed) {
        const base = new Date(manualBooking.startDateBase);
        base.setHours(12, 0, 0, 0);
        const nextDateInfo = getNextDateForDay(base, parseInt(manualBooking.dayOfWeek), manualBooking.time);
        dateBase = nextDateInfo.date;
        skipNote = nextDateInfo.skippedPast ? '⏭️ No se reservó para hoy porque el horario ya pasó.' : '';
        const dateStr = formatLocalDate(dateBase);
        
        if (!nextDateInfo.skippedPast && dateStr === formatLocalDate(new Date())) {
          try {
            const schedule = await getAdminSchedule(dateStr);
            const courtId = Number(manualBooking.courtId);
            const hasConflict = Array.isArray(schedule) && schedule.some((slot: any) =>
              slot.courtId === courtId && slot.slotTime === manualBooking.time && !slot.isAvailable);
            if (hasConflict) {
              const nextWeek = new Date(dateBase);
              nextWeek.setDate(nextWeek.getDate() + 7);
              dateBase = nextWeek;
              skipNote = '⏭️ No se reservó para hoy porque ya hay un turno en ese horario.';
            }
          } catch { /* ignore */ }
        }
      } else {
        dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
      }

      // 🔥 FIX: OBJETO COMPLETO CON DNI PARA RESERVA SIMPLE
      const guestData = { 
        name: guestName, 
        phone: phoneToSend,
        dni: manualBooking.guestDni,
        document: manualBooking.guestDni, // Redundancia por seguridad
        dniNumber: manualBooking.guestDni
      };

      if (manualBooking.isFixed) {
        // 🔥 FIX: PASAMOS EL DNI COMO ARGUMENTO AL FINAL
        await createFixedBooking(
            undefined, 
            Number(manualBooking.courtId), 
            1, 
            dateBase, 
            guestName, 
            phoneToSend || undefined,
            manualBooking.guestDni // <--- ¡AHORA SÍ!
        );
        const message = skipNote ? <div><p className="mb-2">{skipNote}</p><p>✅ Turno FIJO creado. Arranca el: {dateBase.toLocaleDateString()} a las {manualBooking.time}</p></div> : `✅ Turno FIJO creado. Arranca el: ${dateBase.toLocaleDateString()} a las ${manualBooking.time}`;
        showInfo(message, 'Listo');
      } else {
        await createBooking(
            Number(manualBooking.courtId), 
            1, 
            dateBase, 
            undefined, 
            guestData, // Acá va el objeto con el DNI
            { asGuest: true, guestIdentifier: `admin_${Date.now()}` }
        );
        showInfo('✅ Reserva simple creada', 'Listo');
      }
      
      loadSchedule();
      setManualBooking({ 
          guestFirstName: '', guestLastName: '', guestPhone: '', guestDni: '', 
          courtId: '', time: '19:00', isFixed: false, dayOfWeek: '1', startDateBase: getTodayLocalDate() 
      });
    } catch (error: any) {
      showError('Error al reservar: ' + error.message);
    }
  };

  const handleCancelBooking = async (booking: any) => {
    if (booking.fixedBookingId) {
      showConfirm({
        title: '🛑 Atención: Turno Fijo',
        message: <div><p>Este turno pertenece a una serie repetitiva.</p><p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p></div>,
        confirmText: 'Sí, borrar TODA la serie', cancelText: 'No, ver otras opciones',
        onConfirm: async () => { try { await cancelFixedBooking(booking.fixedBookingId); showInfo('✅ Serie completa eliminada.', 'Éxito'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
        onCancel: () => { 
          setTimeout(() => showConfirm({
            title: '¿Borrar solo hoy?',
            message: `¿Eliminar únicamente el turno de hoy (${booking.slotTime}) y mantener los futuros?`,
            confirmText: 'Sí, borrar solo hoy',
            cancelText: 'Cancelar',
            onConfirm: async () => { 
                try { 
                    await cancelBooking(booking.id); 
                    showInfo('✅ Turno del día eliminado.', 'Listo'); 
                    loadSchedule(); 
                } catch (e: any) { 
                    showError('Error: ' + e.message); 
                } 
            },
            onCancel: () => {}
          }), 200);
        },
        closeOnBackdrop: false, closeOnEscape: false
      });
    } else {
      showConfirm({
        title: 'Cancelar turno', message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar', cancelText: 'Volver',
        onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('✅ Turno cancelado', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } }
      });
    }
  };


    const handleConfirmBooking = async (method: 'CASH' | 'TRANSFER' | 'DEBT') => {
    if (!selectedBookingId) return;

    try {
        const token = localStorage.getItem('token');
        
        // Llamada al backend
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/bookings/confirm`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                bookingId: selectedBookingId, 
                paymentMethod: method 
            })
        });

        // 1. Cerramos el modal
        setShowPaymentModal(false);
        
        // 2. Recargamos la grilla para ver el cambio de color
        loadSchedule(); 

        // 3. Feedback al usuario
        if (method === 'DEBT') {
             // Puedes usar showInfo o alert
             alert("✅ Reserva confirmada y dejada en cuenta.");
        } else {
             alert(`✅ Cobro registrado con ${method === 'CASH' ? 'Efectivo' : 'Transferencia'}`);
        }

    } catch (error) {
        console.error(error);
        alert("❌ Error al confirmar la reserva");
    }
};

  return (
    <>
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-6 transition-all relative z-20">
        <h2 className="text-lg font-bold text-text flex items-center gap-2">
          <span>{manualBooking.isFixed ? '🔄' : '📅'}</span>
          {manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-border text-muted bg-surface">{manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}</span>
        </h2>
        <form onSubmit={handleCreateBooking} className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          
          <div className="relative" ref={wrapperRef}>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Nombre (Buscar Cliente)</label>
              <input 
                  type="text" 
                  value={manualBooking.guestFirstName} 
                  onChange={handleNameChange}
                  className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                  placeholder="Escribe para buscar..." 
                  required 
                  autoComplete="chorme-off"
                  name="search_guest_name_unique"
              />
              {showDropdown && searchResults.length > 0 && (
                  <ul className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      {searchResults.map((client) => (
                          <li 
                              key={client.id} 
                              onClick={() => selectClient(client)}
                              className="px-4 py-3 hover:bg-emerald-600/30 cursor-pointer text-white border-b border-gray-600/50 last:border-0 transition-colors"
                          >
                              <div className="font-bold text-sm">{client.firstName} {client.lastName}</div>
                              <div className="text-xs text-gray-300 flex gap-3 mt-1">
                                  {client.phoneNumber && <span className="flex items-center gap-1">📞 {client.phoneNumber}</span>}
                                  {client.dni && <span className="flex items-center gap-1">🆔 {client.dni}</span>}
                              </div>
                          </li>
                      ))}
                  </ul>
              )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Apellido</label>
            <input autoComplete="chrome-off" name="guest_lastname_unique" type="text" value={manualBooking.guestLastName} onChange={(e) => setManualBooking({ ...manualBooking, guestLastName: e.target.value })} 
            className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" placeholder="Ingresa el apellido" required />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Teléfono</label>
            <input autoComplete="chrome-off" name="guest_phone_unique" type="tel" value={manualBooking.guestPhone} onChange={(e) => setManualBooking({ ...manualBooking, guestPhone: e.target.value })} className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" placeholder="Ej: 3511234567" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">DNI (Opcional)</label>
            <input autoComplete="chrome-off" name="guest_dni_unique" type="text" value={manualBooking.guestDni} onChange={(e) => setManualBooking({ ...manualBooking, guestDni: e.target.value })} className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all" placeholder="Número de documento" />
          </div>

          <div className="relative z-10">
          <label className="block text-sm font-semibold text-slate-300 mb-2">Fecha</label>

            {manualBooking.isFixed ? (
              <div className="h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base flex items-center">
                <span className="text-gray-400">Selecciona día de la semana abajo</span>
              </div>
            ) : (
              <DatePickerDark
                // 1. Convertimos el string a Date para el componente
                selected={
                  manualBooking.startDateBase
                    ? (() => {
                        const [y, m, d] = manualBooking.startDateBase.split('-').map(Number);
                        return new Date(y, m - 1, d);
                      })()
                    : null // Si es null, muestra el placeholder
                }
                
                // 2. Lógica de cambio y validación
                onChange={(date: Date | null) => {
                  if (!date) {
                      setManualBooking({ ...manualBooking, startDateBase: '' });
                      return;
                  }
                  
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  
                  const sel = new Date(date);
                  sel.setHours(0, 0, 0, 0);

                  if (sel < today) {
                    // Podés usar tu toast/alert acá
                    alert('No puedes seleccionar una fecha pasada.'); 
                    return;
                  }
                  
                  // Guardamos en tu formato string
                  setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(sel) });
                }}
                
                // 3. Props adicionales (Igual que en tu cliente)
                minDate={new Date()}
                // maxDate={...} // Si querés limitar a futuro también en admin
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Hora</label>
            <select value={manualBooking.time} onChange={(e) => setManualBooking({ ...manualBooking, time: e.target.value })} className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none" required>
              <option value="" className="bg-gray-800">Selecciona hora</option>
              {CLUB_TIME_SLOTS.map(slot => (
                <option key={slot} value={slot} className="bg-gray-800" disabled={!!(manualBooking.startDateBase && isPastTimeForDate(manualBooking.startDateBase, slot))}>{slot}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Cancha</label>
            <select value={manualBooking.courtId} onChange={(e) => setManualBooking({ ...manualBooking, courtId: e.target.value })} className="w-full h-12 bg-gray-950 border border-gray-800 rounded-lg px-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none" required>
              <option value="" className="bg-gray-800">Selecciona cancha</option>
              {courts.map(c => <option key={c.id} value={c.id} className="bg-gray-800">{c.name}</option>)}
            </select>
          </div>
          {manualBooking.isFixed && (
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-300 mb-2">Día de la semana</label>
              <select value={manualBooking.dayOfWeek} onChange={(e) => setManualBooking({ ...manualBooking, dayOfWeek: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                <option value="1" className="bg-gray-800">Lunes</option><option value="2" className="bg-gray-800">Martes</option><option value="3" className="bg-gray-800">Miércoles</option><option value="4" className="bg-gray-800">Jueves</option><option value="5" className="bg-gray-800">Viernes</option><option value="6" className="bg-gray-800">Sábado</option><option value="0" className="bg-gray-800">Domingo</option>
              </select>
            </div>
          )}
          <div className="md:col-span-2 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({ ...manualBooking, isFixed: e.target.checked })} className="w-4 h-4 rounded border-gray-600 text-emerald-500 focus:ring-emerald-500 focus:ring-2" />
              <span className="text-sm">¿Es un turno fijo? (se repite semanalmente)</span>
            </label>
            <button type="submit" className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900">
              {manualBooking.isFixed ? '🔄 Crear Turno Fijo' : '📅 Crear Reserva'}
            </button>
          </div>
        </form>
        <div className="mt-6 p-4 bg-surface-80 border border-border rounded-lg">
          <h3 className="text-sm font-semibold text-text mb-2">💡 Cómo crear reservas:</h3>
          <ul className="text-sm text-muted space-y-1">
            <li>• <strong>Reserva Simple:</strong> Completa nombre, apellido, fecha, hora y cancha para una reserva única.</li>
            <li>• <strong>Turno Fijo:</strong> Marca la casilla &quot;Es un turno fijo&quot; y selecciona el día de la semana. Se creará una serie semanal automática.</li>
            <li>• <strong>Buscador:</strong> Escribe en "Nombre" para buscar clientes existentes.</li>
          </ul>
        </div>
      </div>

      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-8 overflow-hidden relative z-10">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-text">HORARIOS DEL DÍA</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 relative z-20">
              <label className="text-sm text-muted">Fecha:</label>
              <DatePicker
                selected={scheduleDate ? (() => { const [y, m, d] = scheduleDate.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                onChange={(date: Date | null) => date && setScheduleDate(formatLocalDate(date))}
                dateFormat="yyyy-MM-dd" className="bg-surface border border-border rounded-lg px-4 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition h-10"
              />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="btn btn-primary px-4 py-1 text-sm bg-blue-500/15 hover:bg-blue-500/25 border-blue-500/40 hover:border-blue-400/70 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)] transition disabled:opacity-50">
              {loadingSchedule ? '⏳' : '🔄'} ACTUALIZAR
            </button>
            {lastUpdate && <span className="text-xs text-muted">Última: {lastUpdate.toLocaleTimeString()}</span>}
          </div>
        </div>
        {loadingSchedule ? (
          <div className="animate-pulse space-y-4"><div className="h-12 bg-surface-50 rounded w-full"></div><div className="h-12 bg-surface-50 rounded w-full"></div><div className="h-12 bg-surface-50 rounded w-full"></div></div>
        ) : scheduleBookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-muted text-xs uppercase tracking-wider">
                  <th className="p-4">Horario</th><th className="p-4">Cancha</th><th className="p-4">Estado</th><th className="p-4">Reservante</th><th className="p-4">Consumos / Extras</th><th className="p-5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {scheduleBookings.map((slot, index) => (
                  <tr key={index} className="border-b border-border/50 hover:bg-surface-70 transition-colors">
                    <td className="p-4 font-mono text-muted">{slot.slotTime}</td>
                    <td className="p-4 text-text font-bold">{slot.courtName}</td>
                    <td className="p-5">
                      {/* LÓGICA DE ESTADO CON ESTÉTICA PREMIUM */}
                      {(() => {
                        const [h, m] = slot.slotTime.split(':').map(Number);
  
                        let slotDate;
                        if (scheduleDate) {
                            const [year, month, day] = scheduleDate.split('-').map(Number);
                            slotDate = new Date(year, month - 1, day); // Mes es 0-indexado
                        } else {
                            slotDate = new Date(); // Si no hay fecha, usamos hoy
                        }

                        slotDate.setHours(h, m, 0, 0);

                        const now = new Date();
                        const isPast = slotDate < now;

                        let statusText = '';
                        // Usamos un contenedor base y clases dinámicas para el color y el brillo
                        let containerClasses = '';
                        let dotClasses = '';
                        let textClasses = '';

                        if (!slot.booking) {
                          // --- HUECO VACÍO ---
                          if (isPast) {
                            statusText = 'NO JUGADO';
                            // Gris apagado, sin brillo, se funde con el fondo
                            containerClasses = 'bg-gray-800/40 border-gray-700/50 text-gray-500';
                            dotClasses = 'bg-gray-600';
                          } else {
                            statusText = 'DISPONIBLE';
                            // Verde vibrante pero elegante. El punto tiene un "glow" intenso.
                            containerClasses = 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400';
                            dotClasses = 'bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.4)] animate-pulse-slow'; // animate-pulse-slow es opcional si lo tenés configurado
                          }
                        } else {
                          // --- HAY RESERVA ---
                          const status = slot.booking.status;

                          if (isPast && (status === 'CONFIRMED' || status === 'PENDING' || status === 'COMPLETED')) {
                            statusText = 'COMPLETADO';
                            // Azul tecnológico, calmado
                            containerClasses = 'bg-blue-950/30 border-blue-500/30 text-blue-400';
                            dotClasses = 'bg-blue-400 shadow-[0_0_10px_2px_rgba(96,165,250,0.4)]';
                          } 
                          else if (status === 'CONFIRMED') {
                            statusText = 'CONFIRMADO';
                            // Rojo intenso, señal de ocupado
                            containerClasses = 'bg-red-950/30 border-red-500/30 text-red-400';
                            dotClasses = 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.4)]';
                          } 
                          else {
                            statusText = 'PENDIENTE';
                            // Amarillo alerta, brillante
                            containerClasses = 'bg-yellow-950/30 border-yellow-500/30 text-yellow-300';
                            dotClasses = 'bg-yellow-400 shadow-[0_0_10px_2px_rgba(250,204,21,0.4)]';
                          }
                        }

                        return (
                          // El contenedor ahora es más sutil (border más fino, fondo más oscuro)
                          <span className={`inline-flex items-center gap-2.5 text-[11px] px-3 py-1.5 rounded-full font-bold uppercase tracking-widest border transition-all duration-300 ${containerClasses}`}>
                            {/* El puntito ahora es una "luz led" */}
                            <span className={`w-2 h-2 rounded-full ${dotClasses}`}></span>
                            {statusText}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-5 text-text">
                      {slot.booking ? (
                        <div>
                          <div className="font-bold">{slot.booking.userName || slot.booking.guestName}</div>
                          {(slot.booking.guestPhone || slot.booking.user?.phoneNumber) && <div className="text-xs text-emerald-400 mt-0.5 flex items-center gap-1">📞 {slot.booking.guestPhone || slot.booking.user?.phoneNumber}</div>}
                          {slot.booking.fixedBookingId && <div className="text-xs text-muted mt-1">🔄 Turno fijo #{slot.booking.fixedBookingId}</div>}
                        </div>
                      ) : <span className="text-muted">-</span>}
                    </td>
                    <td className="p-4">
                      {slot.booking && slot.booking.items && slot.booking.items.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {slot.booking.items.map((item: any, i: number) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded border border-gray-600 bg-gray-700 text-gray-300 whitespace-nowrap">
                              {item.quantity > 1 ? <span className="font-bold text-emerald-400">{item.quantity}x </span> : ''}
                              {item.product?.name || 'Producto'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted text-xs">-</span>
                      )}
                    </td>
                    <td className="p-5 text-right">
                      {slot.booking && (
                        <div className="flex justify-end gap-2">
                          
                          {/* BOTÓN CARRITO - EXTRAS */}
                          <button 
                            onClick={() => setSelectedBooking(slot.booking)}
                            className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 hover:border-blue-500/50 transition-all"
                            title="Ver detalles y consumos"
                          >
                            <ShoppingCart size={18} />
                          </button>

                          {slot.booking.status === 'PENDING' && (
                            <button
                              onClick={() => handleOpenPaymentModal(slot.booking.id)}
                              className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all"
                              title="Confirmar Reserva"
                            >
                              <Check size={18} />
                            </button>
                          )}
                                                    <button
                            onClick={() => handleCancelBooking(slot.booking)}
                            className={`p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/50 transition-all ${slot.booking.fixedBookingId ? 'shadow-[0_0_10px_rgba(239,68,68,0.2)]' : ''}`}
                            title={slot.booking.fixedBookingId ? 'Dar de baja Turno Fijo' : 'Cancelar Reserva'}
                          >
                            <Trash2 size={18} />
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
          <div className="text-center py-12 border border-dashed border-border rounded-xl bg-surface-70"><p className="text-muted">Sin datos cargados para esta fecha</p></div>
        )}
      </div>

      {/* 👇👇👇 EL MODAL: AHORA SÍ ENCUENTRA EL SLUG O USA FALLBACK 👇👇👇 */}
      {selectedBooking && (
        <ModalPortal onClose={() => setSelectedBooking(null)}>
          <BookingConsumption 
            bookingId={selectedBooking.id}
            slug={getClubSlug() || ''} // <--- Función arreglada para no devolver vacío
            courtPrice={selectedBooking.price}
            paymentStatus={selectedBooking.paymentStatus}
            onClose={() => setSelectedBooking(null)}
            onConfirm={() => {
                setSelectedBooking(null);
                loadSchedule();
            }}
          />
        </ModalPortal>
      )}
      {/* 👆👆👆 FIN DEL MODAL 👆👆👆 */}

      {/* --- MODAL DE SELECCIÓN DE PAGO --- */}
      {showPaymentModal && (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
        <div className="bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
            {/* Botón X para cerrar rápido */}
            <button 
                onClick={() => setShowPaymentModal(false)}
                className="absolute top-3 right-3 text-gray-500 hover:text-white"
            >✕</button>

            <h3 className="text-xl font-bold text-white mb-2 text-center">Confirmar Reserva</h3>
            <p className="text-gray-400 text-sm mb-6 text-center">
                Selecciona el método de cobro
            </p>
            
            {/* Grilla de opciones */}
            <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                    onClick={() => handleConfirmBooking('CASH')}
                    className="flex flex-col items-center justify-center p-4 bg-emerald-900/30 border border-emerald-800 hover:bg-emerald-900/50 rounded-lg text-emerald-400 transition-all hover:scale-[1.02]"
                >
                    <span className="text-2xl mb-1">💵</span>
                    <span className="font-bold text-sm">Efectivo</span>
                </button>

                <button
                    onClick={() => handleConfirmBooking('TRANSFER')}
                    className="flex flex-col items-center justify-center p-4 bg-blue-900/30 border border-blue-800 hover:bg-blue-900/50 rounded-lg text-blue-400 transition-all hover:scale-[1.02]"
                >
                    <span className="text-2xl mb-1">💳</span>
                    <span className="font-bold text-sm">Digital / MP</span>
                </button>
            </div>

            {/* Botón Dejar en Cuenta (Ancho completo abajo) */}
            <button
                onClick={() => handleConfirmBooking('DEBT')}
                className="w-full p-3 flex items-center justify-center gap-2 bg-yellow-900/20 border border-yellow-700/50 hover:bg-yellow-900/40 rounded-lg text-yellow-500 transition-all mb-4"
            >
                <span>📄</span>
                <span className="font-bold text-sm">Dejar en Cuenta (Sin cobrar)</span>
            </button>

            <button 
                onClick={() => setShowPaymentModal(false)}
                className="w-full text-gray-500 hover:text-gray-300 text-xs hover:underline"
            >
                Cancelar operación
            </button>
        </div>
    </div>
)}

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}