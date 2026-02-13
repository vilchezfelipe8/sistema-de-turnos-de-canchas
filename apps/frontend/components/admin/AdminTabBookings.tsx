import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import DatePickerDark from '../../components/ui/DatePickerDark';
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
import { Trash2, Check, ShoppingCart, Calendar as CalendarIcon, RefreshCw } from 'lucide-react'; 

const CLUB_TIME_SLOTS = [
  '08:00', '09:30', '11:00', '12:30',
  '14:00', '15:30', '17:30', '19:00',
  '20:30', '22:00'
];

// --- COMPONENTE PORTAL (VERSIÓN WIMBLEDON BEIGE) ---
const ModalPortal = ({ children, onClose }: { children: ReactNode, onClose: () => void }) => {
  if (typeof document === 'undefined') return null;
  
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#347048]/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-xl bg-[#EBE1D8] border-4 border-white rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 overflow-hidden text-[#347048]">
        <div className="overflow-y-auto p-8 custom-scrollbar">
            {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

// --- FUNCIONES AUXILIARES (SE MANTIENEN IGUAL) ---
const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string) => {
  const resultDate = new Date(startDate);
  const currentDay = resultDate.getDay();
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  resultDate.setDate(resultDate.getDate() + daysUntilTarget);
  const [hours, minutes] = timeStr.split(':').map(Number);
  resultDate.setHours(hours, minutes, 0, 0);
  const now = new Date();
  if (daysUntilTarget === 0 && resultDate.getTime() <= now.getTime()) {
    resultDate.setDate(resultDate.getDate() + 7);
  }
  return { date: resultDate };
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

  const getClubSlug = () => {
    if (urlSlug) return urlSlug;
    try {
      const userStored = localStorage.getItem('user');
      if (userStored) {
        const user = JSON.parse(userStored);
        const foundSlug = user.slug || user.clubSlug || (user.club && user.club.slug);
        if (foundSlug) return foundSlug;
        if (user.lastName && user.lastName.toLowerCase() !== 'admin') {
             return user.lastName.toLowerCase().trim().replace(/\s+/g, '-');
        }
      }
    } catch (e) { console.error(e); }
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
          if (!currentSlug) return; 
          const results = await searchClients(currentSlug, value);
          setSearchResults(results || []);
          setShowDropdown(true);
        } catch (error) { console.error(error); }
      }, 300);
    } else { setShowDropdown(false); }
  };

  const selectClient = (client: any) => {
    let fName = client.firstName || '';
    let lName = client.lastName || '';
    if (!lName && fName.includes(' ')) {
      const parts = fName.split(' ');
      fName = parts[0];
      lName = parts.slice(1).join(' ');
    }
    let rawPhone = client.phoneNumber || client.phone || client.celular || '';
    if (rawPhone) { rawPhone = rawPhone.toString().replace(/^(\+?549)/, ''); }
    setManualBooking({
      ...manualBooking,
      guestFirstName: fName,
      guestLastName: lName,
      guestPhone: rawPhone,
      guestDni: client.dni || client.dniNumber || client.document || '' 
    });
    setShowDropdown(false);
  };

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

  const loadCourts = useCallback(async () => { const data = await getCourts(); setCourts(data); }, []);

  const loadSchedule = useCallback(async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      let mergedSlots = data;
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
      setScheduleBookings(mergedSlots);
      setLastUpdate(new Date());
    } catch (error: any) { showError('Error: ' + error.message); } finally { setLoadingSchedule(false); }
  }, [scheduleDate, courts]);

  useEffect(() => { loadCourts(); }, [loadCourts]);
  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    const dni = manualBooking.guestDni?.trim();
    const phone = manualBooking.guestPhone?.trim();
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos de cancha u horario'); return; }
    if (!firstName || !lastName || !dni || !phone) { showError('Nombre, Apellido, DNI y Teléfono son obligatorios'); return; }
    let dateBase: Date;
    let guestName = `${firstName} ${lastName}`.trim();
    let phoneToSend = "";
    try {
        const rawPhone = phone.replace(/\D/g, '');
        phoneToSend = rawPhone ? `+549${rawPhone}` : '';
        if (manualBooking.isFixed) {
            const base = new Date(manualBooking.startDateBase);
            base.setHours(12, 0, 0, 0);
            const nextDateInfo = getNextDateForDay(base, parseInt(manualBooking.dayOfWeek), manualBooking.time);
            dateBase = nextDateInfo.date; 
        } else {
            dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
        }
        if (manualBooking.isFixed) {
            await createFixedBooking(undefined, Number(manualBooking.courtId), 1, dateBase, guestName, phoneToSend || undefined, dni);
            showInfo('✅ Turno fijo creado', 'Listo');
        } else {
            const guestData = { name: guestName, phone: phoneToSend, dni: dni, document: dni, dniNumber: dni };
            await createBooking(Number(manualBooking.courtId), 1, dateBase, undefined, guestData, { asGuest: true, guestIdentifier: `admin_${dni}_${Date.now()}` });
            showInfo('✅ Reserva simple creada', 'Listo');
        }
        loadSchedule();
        setManualBooking({ 
            guestFirstName: '', guestLastName: '', guestPhone: '', guestDni: '', 
            courtId: '', time: '19:00', isFixed: false, dayOfWeek: '1', startDateBase: getTodayLocalDate() 
        });
    } catch (error: any) { showError('Error al reservar: ' + error.message); }
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
            confirmText: 'Sí, borrar solo hoy', cancelText: 'Cancelar',
            onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('✅ Turno del día eliminado.', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
          }), 200);
        }
      });
    } else {
      showConfirm({
        title: 'Cancelar turno', message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar', onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('✅ Turno cancelado', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } }
      });
    }
  };

  const handleConfirmBooking = async (method: 'CASH' | 'TRANSFER' | 'DEBT') => {
    if (!selectedBookingId) return;
    try {
        const token = localStorage.getItem('token');
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/bookings/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ bookingId: selectedBookingId, paymentMethod: method })
        });
        setShowPaymentModal(false);
        loadSchedule(); 
        showInfo(`✅ Cobro registrado correctamente.`, "Listo");
    } catch (error) { alert("❌ Error al confirmar"); }
  };

  return (
    <>
      {/* --- TARJETA DE CREACIÓN DE RESERVA (BEIGE WIMBLEDON) --- */}
      <div className="bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
        <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
          <span className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl text-xl">
            {manualBooking.isFixed ? '🔄' : '📅'}
          </span>
          {manualBooking.isFixed ? 'Nuevo Turno Fijo' : 'Nueva Reserva Simple'}
          <span className="ml-2 text-[10px] px-3 py-1 rounded-full bg-[#347048] text-[#EBE1D8] font-black tracking-widest not-italic">
            {manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}
          </span>
        </h2>

        <form onSubmit={handleCreateBooking} className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          
          {/* BUSCADOR CLIENTE */}
          <div className="relative" ref={wrapperRef}>
              <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Nombre (Buscar Cliente)</label>
              <input 
                  type="text" 
                  value={manualBooking.guestFirstName} 
                  onChange={handleNameChange}
                  className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                  placeholder="Escribe para buscar..." 
                  required autoComplete="off"
              />
              {showDropdown && searchResults.length > 0 && (
                  <ul className="absolute z-50 w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
                      {searchResults.map((client) => (
                          <li key={client.id} onClick={() => selectClient(client)}
                              className="px-4 py-3 hover:bg-[#B9CF32]/20 cursor-pointer text-[#347048] border-b border-[#347048]/5 last:border-0 transition-colors">
                              <div className="font-black text-sm">{client.firstName} {client.lastName}</div>
                              <div className="text-[10px] font-bold text-[#347048]/60 flex gap-3 mt-1 uppercase">
                                  {client.phoneNumber && <span>📞 {client.phoneNumber}</span>}
                                  {client.dni && <span>🆔 {client.dni}</span>}
                              </div>
                          </li>
                      ))}
                  </ul>
              )}
          </div>

          <div>
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Apellido</label>
            <input type="text" value={manualBooking.guestLastName} onChange={(e) => setManualBooking({ ...manualBooking, guestLastName: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Ingresa el apellido" required />
          </div>

          <div>
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Teléfono</label>
            <input type="tel" value={manualBooking.guestPhone} onChange={(e) => setManualBooking({ ...manualBooking, guestPhone: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Ej: 3511234567" required/>
          </div>

          <div>
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">DNI</label>
            <input type="text" value={manualBooking.guestDni} onChange={(e) => setManualBooking({ ...manualBooking, guestDni: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Número de documento" required />
          </div>

          <div className="relative z-10 w-full">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Fecha</label>
            <div>
              <DatePickerDark
                selected={manualBooking.startDateBase ? (() => { const [y, m, d] = manualBooking.startDateBase.split('-').map(Number); return new Date(y, m - 1, d); })() : null}
                onChange={(date: Date | null) => {
                  if (!date) return;
                  setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(date) });
                }}
                minDate={new Date()}
                showIcon={false}
                variant="light"
                inputClassName="bg-white text-[#347048] font-bold border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 shadow-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Hora</label>
            <select value={manualBooking.time} onChange={(e) => setManualBooking({ ...manualBooking, time: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black focus:outline-none shadow-sm appearance-none transition-all cursor-pointer" required>
              {CLUB_TIME_SLOTS.map(slot => (
                <option key={slot} value={slot} disabled={!!(manualBooking.startDateBase && isPastTimeForDate(manualBooking.startDateBase, slot))}>{slot}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Cancha</label>
            <select value={manualBooking.courtId} onChange={(e) => setManualBooking({ ...manualBooking, courtId: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black focus:outline-none shadow-sm appearance-none transition-all cursor-pointer" required>
              <option value="">Selecciona cancha</option>
              {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {manualBooking.isFixed && (
            <div>
              <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Día de la semana</label>
              <select value={manualBooking.dayOfWeek} onChange={(e) => setManualBooking({ ...manualBooking, dayOfWeek: e.target.value })} 
              className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black focus:outline-none shadow-sm appearance-none transition-all cursor-pointer">
                <option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option>
              </select>
            </div>
          )}

          <div className="md:col-span-2 flex flex-col sm:flex-row gap-6 items-center justify-between mt-4 p-6 bg-[#347048]/5 rounded-[1.5rem] border border-[#347048]/10">
            <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
              <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${manualBooking.isFixed ? 'bg-[#B9CF32] border-[#B9CF32]' : 'border-[#347048]/20 bg-white'}`}>
                  {manualBooking.isFixed && <Check size={16} className="text-[#347048]" strokeWidth={4} />}
              </div>
              <input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({ ...manualBooking, isFixed: e.target.checked })} className="hidden" />
              <span className="text-sm uppercase tracking-wide">¿Es un turno fijo?</span>
            </label>

            <button type="submit" className="w-full sm:w-auto px-10 py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-sm flex items-center justify-center gap-3 group">
              {manualBooking.isFixed ? <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" /> : <CalendarIcon size={18} />}
              {manualBooking.isFixed ? 'Crear Serie' : 'Crear Reserva'}
            </button>
          </div>
        </form>
      </div>

      {/* --- TABLA DE HORARIOS (DISEÑO PREMIUM) --- */}
      <div className="bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/20 overflow-hidden relative">
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6 mb-8">
          <h2 className="text-2xl font-black text-[#347048] uppercase italic tracking-tight flex items-center gap-3">
             <div className="w-2 h-8 bg-[#B9CF32] rounded-full"></div>
             Agenda del Día
          </h2>
          <div className="flex flex-wrap items-center gap-4 bg-white/40 p-2 rounded-2xl border border-white/60">
            <div className="flex items-center gap-2 px-3">
              <span className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Fecha:</span>
              <DatePickerDark
                selected={scheduleDate ? (() => { const [y, m, d] = scheduleDate.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                onChange={(date: Date | null) => date && setScheduleDate(formatLocalDate(date))}
                showIcon={false}
                variant="light"
                inputClassName="bg-transparent border-none text-[#347048] font-black text-sm focus:outline-none w-28 cursor-pointer p-0 h-auto"
              />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="flex items-center gap-2 px-4 py-2 bg-[#347048] text-[#EBE1D8] rounded-xl text-xs font-black uppercase tracking-tighter hover:bg-[#B9CF32] hover:text-[#347048] transition-all">
              {loadingSchedule ? '...' : 'Actualizar'}
            </button>
            {lastUpdate && <span className="text-[10px] font-bold text-[#347048]/40 px-2 uppercase">{lastUpdate.toLocaleTimeString()}</span>}
          </div>
        </div>

        {loadingSchedule ? (
          <div className="space-y-4 py-10">
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : scheduleBookings.length > 0 ? (
          <div className="overflow-x-auto -mx-8">
            <table className="w-full text-left border-separate border-spacing-y-3 px-8">
              <thead>
                <tr className="text-[#347048]/40 text-[10px] font-black uppercase tracking-[0.2em]">
                  <th className="px-6 py-4">Horario</th><th className="px-6 py-4">Cancha</th><th className="px-6 py-4">Estado</th><th className="px-6 py-4">Reservante</th><th className="px-6 py-4">Extras</th><th className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {scheduleBookings.map((slot, index) => (
                  <tr key={index} className="bg-white/60 hover:bg-white transition-all shadow-sm rounded-2xl overflow-hidden group">
                    <td className="px-6 py-5 first:rounded-l-2xl font-black text-[#347048] text-lg">{slot.slotTime}</td>
                    <td className="px-6 py-5 font-bold text-[#347048]/80">{slot.courtName}</td>
                    <td className="px-6 py-5">
                      {(() => {
                        const [h, m] = slot.slotTime.split(':').map(Number);
                        const [year, month, day] = scheduleDate.split('-').map(Number);
                        const slotDate = new Date(year, month - 1, day, h, m);
                        const isPast = slotDate < new Date();
                        let statusText = ''; let cClasses = ''; let dClasses = '';

                        if (!slot.booking) {
                          if (isPast) { statusText = 'NO JUGADO'; cClasses = 'bg-gray-200 text-gray-500 border-transparent'; dClasses = 'bg-gray-400'; }
                          else { statusText = 'DISPONIBLE'; cClasses = 'bg-emerald-100 text-emerald-700 border-emerald-200'; dClasses = 'bg-emerald-500 animate-pulse'; }
                        } else {
                          const status = slot.booking.status;
                          if (isPast && (status === 'CONFIRMED' || status === 'PENDING' || status === 'COMPLETED')) { statusText = 'COMPLETADO'; cClasses = 'bg-blue-100 text-blue-700 border-blue-200'; dClasses = 'bg-blue-500'; } 
                          else if (status === 'CONFIRMED') { statusText = 'CONFIRMADO'; cClasses = 'bg-red-100 text-red-700 border-red-200'; dClasses = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'; } 
                          else { statusText = 'PENDIENTE'; cClasses = 'bg-yellow-100 text-yellow-700 border-yellow-200'; dClasses = 'bg-yellow-500'; }
                        }
                        return (
                          <span className={`inline-flex items-center gap-2 text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border ${cClasses}`}>
                            <span className={`w-2 h-2 rounded-full ${dClasses}`}></span>
                            {statusText}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-5">
                      {slot.booking ? (
                        <div className="flex flex-col">
                          <span className="font-black text-[#347048]">{slot.booking.userName || slot.booking.guestName}</span>
                          {(slot.booking.guestPhone || slot.booking.user?.phoneNumber) && <span className="text-[11px] font-bold text-[#347048]/50">📞 {slot.booking.guestPhone || slot.booking.user?.phoneNumber}</span>}
                        </div>
                      ) : <span className="text-[#347048]/20 font-black">-</span>}
                    </td>
                    <td className="px-6 py-5">
                      {slot.booking?.items?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {slot.booking.items.map((item: any, i: number) => (
                            <span key={i} className="text-[9px] font-black px-2 py-0.5 rounded-md bg-[#926699]/10 text-[#926699] border border-[#926699]/20 uppercase">
                              {item.quantity}x {item.product?.name}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-[#347048]/20 font-black">-</span>}
                    </td>
                    <td className="px-6 py-5 last:rounded-r-2xl text-right">
                      {slot.booking && (
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setSelectedBooking(slot.booking)} className="p-2 rounded-xl bg-white border border-[#347048]/10 text-[#347048] hover:bg-[#347048] hover:text-[#EBE1D8] transition-all shadow-sm">
                            <ShoppingCart size={16} strokeWidth={2.5} />
                          </button>
                          {slot.booking.status === 'PENDING' && (
                            <button onClick={() => handleOpenPaymentModal(slot.booking.id)} className="p-2 rounded-xl bg-[#B9CF32] text-[#347048] border border-white hover:scale-110 transition-all shadow-md">
                              <Check size={16} strokeWidth={3} />
                            </button>
                          )}
                          <button onClick={() => handleCancelBooking(slot.booking)} className="p-2 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                            <Trash2 size={16} strokeWidth={2.5} />
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
          <div className="text-center py-16 border-4 border-dashed border-[#347048]/10 rounded-[2rem]"><p className="text-[#347048]/40 font-black uppercase tracking-widest">Sin datos cargados para esta fecha</p></div>
        )}
      </div>

      {/* --- MODALES Y PORTALES --- */}
      {selectedBooking && (
        <ModalPortal onClose={() => setSelectedBooking(null)}>
          <BookingConsumption 
            bookingId={selectedBooking.id}
            slug={getClubSlug() || ''}
            courtPrice={selectedBooking.price}
            paymentStatus={selectedBooking.paymentStatus}
            onClose={() => setSelectedBooking(null)}
            onConfirm={() => { setSelectedBooking(null); loadSchedule(); }}
          />
        </ModalPortal>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-[#347048]/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
            <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full relative text-[#347048]">
                <button onClick={() => setShowPaymentModal(false)} className="absolute top-6 right-6 text-[#347048]/40 hover:text-[#347048] font-black">✕</button>
                <h3 className="text-2xl font-black mb-2 text-center uppercase tracking-tight italic">Cobrar Reserva</h3>
                <p className="text-[#347048]/60 text-xs font-bold mb-8 text-center uppercase tracking-widest">Selecciona el método de pago</p>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <button onClick={() => handleConfirmBooking('CASH')} className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-[1.5rem] text-[#347048] transition-all shadow-sm group">
                        <span className="text-3xl mb-2 group-hover:scale-125 transition-transform">💵</span>
                        <span className="font-black text-xs uppercase tracking-tighter">Efectivo</span>
                    </button>
                    <button onClick={() => handleConfirmBooking('TRANSFER')} className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-[1.5rem] text-[#347048] transition-all shadow-sm group">
                        <span className="text-3xl mb-2 group-hover:scale-125 transition-transform">💳</span>
                        <span className="font-black text-xs uppercase tracking-tighter">Digital</span>
                    </button>
                </div>
                <button onClick={() => handleConfirmBooking('DEBT')} className="w-full py-4 flex items-center justify-center gap-2 bg-[#926699]/10 border-2 border-[#926699]/20 hover:bg-[#926699]/20 rounded-xl text-[#926699] font-black uppercase text-[10px] tracking-[0.2em] transition-all mb-4">
                    <span>📄</span> Dejar en Cuenta (Deuda)
                </button>
            </div>
        </div>
      )}

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}