import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
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
import { Trash2, Check, ShoppingCart, Calendar as CalendarIcon, RefreshCw, ChevronDown, CalendarPlus, Repeat, Banknote, CreditCard, FileText, X } from 'lucide-react'; 

const CLUB_TIME_SLOTS = [
  '08:00', '09:30', '11:00', '12:30',
  '14:00', '15:30', '17:30', '19:00',
  '20:30', '22:00'
];

// --- COMPONENTE DROPDOWN CUSTOM (ESTILO WIMBLEDON LANDING) ---
const CustomSelect = ({ value, options, onChange, placeholder }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((o: any) => o.value === value);

  return (
    <div className={`relative w-full ${isOpen ? 'z-[100]' : 'z-10'}`} ref={wrapperRef}>
      <div 
        className={`w-full h-12 bg-white border-2 transition-all rounded-xl px-4 flex items-center justify-between shadow-sm cursor-pointer ${
          isOpen ? 'border-[#B9CF32] ring-2 ring-[#B9CF32]/20' : 'border-transparent hover:border-[#B9CF32]/50'
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`font-bold ${!selectedOption ? 'text-[#347048]/30' : 'text-[#347048]'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-[#B9CF32]' : 'text-[#347048]/40'}`} strokeWidth={3} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-200">
          <ul className="flex flex-col py-2">
            {options.map((option: any) => (
              <li 
                key={option.value}
                onClick={() => {
                  if (!option.disabled) {
                    onChange(option.value);
                    setIsOpen(false);
                  }
                }}
                className={`px-4 py-3 flex items-center justify-between transition-colors ${
                  option.disabled 
                    ? 'opacity-40 cursor-not-allowed bg-gray-50' 
                    : 'cursor-pointer hover:bg-[#B9CF32]/20'
                } ${value === option.value ? 'bg-[#347048]/5 text-[#347048]' : 'text-[#347048]'}`}
              >
                <span className="font-black text-sm">{option.label}</span>
                {option.disabled && <span className="text-[9px] font-black text-red-500 uppercase tracking-widest border border-red-500/20 bg-red-50 px-2 py-0.5 rounded-md">Pasado</span>}
                {!option.disabled && value === option.value && <Check size={14} className="text-[#347048]" strokeWidth={4} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};


// --- COMPONENTE PORTAL ---
const ModalPortal = ({ children, onClose }: { children: ReactNode, onClose: () => void }) => {
  if (typeof document === 'undefined') return null;
  
  return createPortal(
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#347048]/80 backdrop-blur-[2px] p-4 animate-in fade-in duration-200">
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

const formatBookingStatus = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return 'Pendiente';
    case 'CONFIRMED':
      return 'Confirmada';
    case 'CANCELLED':
      return 'Cancelada';
    case 'COMPLETED':
      return 'Finalizada';
    default:
      return status || 'Pendiente';
  }
};

const formatPaymentStatus = (status?: string) => {
  switch (status) {
    case 'PENDING':
      return 'Pendiente';
    case 'PAID':
      return 'Pagado';
    case 'PARTIAL':
      return 'Parcial';
    case 'DEBT':
      return 'En cuenta';
    default:
      return status || 'Pendiente';
  }
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
  const [selectedBookingDetail, setSelectedBookingDetail] = useState<{ booking: any; slotTime: string; courtName?: string } | null>(null);
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
    isProfessor: false,
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
      guestDni: client.dni || client.dniNumber || client.document || '',
      isProfessor: !!client.isProfessor
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
  useEffect(() => {
    if (!selectedBookingDetail?.booking?.id) return;
    const updatedSlot = scheduleBookings.find(
      (slot) => slot?.booking?.id === selectedBookingDetail.booking.id
    );
    if (!updatedSlot?.booking) return;
    setSelectedBookingDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        booking: updatedSlot.booking,
        slotTime: updatedSlot.slotTime ?? prev.slotTime,
        courtName: updatedSlot.courtName ?? prev.courtName
      };
    });
  }, [scheduleBookings, selectedBookingDetail?.booking?.id]);

  const scheduleByTime = useMemo(() => {
    const map = new Map<string, Map<number, any>>();
    scheduleBookings.forEach((slot) => {
      if (!map.has(slot.slotTime)) map.set(slot.slotTime, new Map());
      map.get(slot.slotTime)?.set(slot.courtId, slot);
    });
    return map;
  }, [scheduleBookings]);

  const getSlotState = (slot: any) => {
    const [h, m] = String(slot.slotTime).split(':').map(Number);
    const [year, month, day] = scheduleDate.split('-').map(Number);
    const slotStartDate = new Date(year, month - 1, day, h, m, 0, 0);
    const slotEndDate = new Date(slotStartDate.getTime() + 90 * 60000);
    const now = new Date();
    const isPastStart = slotStartDate < now;
    const isPastEnd = slotEndDate < now;
    const isPlaying = isPastStart && !isPastEnd;

    if (!slot.booking) {
      if (isPastStart) {
        return { label: 'Cerrado', classes: 'bg-[#347048]/5 text-[#347048]/40 border-[#347048]/10' };
      }
      return { label: 'Disponible', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }

    if (isPastEnd) {
      return { label: 'Completado', classes: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    if (isPlaying) {
      return { label: 'En juego', classes: 'bg-[#926699]/10 text-[#926699] border-[#926699]/20' };
    }
    if (slot.booking.status === 'CONFIRMED') {
      return { label: 'Confirmado', classes: 'bg-red-50 text-red-700 border-red-200' };
    }
    return { label: 'Pendiente', classes: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
  };

  const getBookingBarClass = (slot: any) => {
    switch (slot?.booking?.status) {
      case 'PENDING':
        return 'border-[#B9CF32]';
      case 'CONFIRMED':
        return 'border-[#347048]';
      case 'CANCELLED':
        return 'border-[#EF4444]';
      case 'COMPLETED':
        return 'border-[#3B82F6]';
      default:
        return 'border-[#347048]';
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

  const getBookingTimeRange = (slot: any) => {
    const startValue = slot.booking?.startDateTime || slot.startDateTime;
    if (!startValue) return slot.slotTime;
    const startDate = new Date(startValue);
    const endValue = slot.booking?.endDateTime;
    const endDate = endValue ? new Date(endValue) : new Date(startDate.getTime() + 90 * 60000);
    return `${formatTime(startDate)} - ${formatTime(endDate)}`;
  };

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
            await createFixedBooking(
              undefined,
              Number(manualBooking.courtId),
              1,
              dateBase,
              guestName,
              phoneToSend || undefined,
              dni,
              manualBooking.isProfessor
            );
            showInfo('Turno fijo creado', 'Listo');
        } else {
            const guestData = { name: guestName, phone: phoneToSend, dni: dni, document: dni, dniNumber: dni };
            await createBooking(
              Number(manualBooking.courtId),
              1,
              dateBase,
              undefined,
              guestData,
              { asGuest: true, guestIdentifier: `admin_${dni}_${Date.now()}`, isProfessor: manualBooking.isProfessor }
            );
            showInfo('Reserva simple creada', 'Listo');
        }
        loadSchedule();
        setManualBooking({ 
            guestFirstName: '', guestLastName: '', guestPhone: '', guestDni: '', 
      courtId: '', time: '19:00', isFixed: false, isProfessor: false, dayOfWeek: '1', startDateBase: getTodayLocalDate() 
        });
    } catch (error: any) { showError('Error al reservar: ' + error.message); }
  };

  const handleCancelBooking = async (booking: any) => {
    if (booking.fixedBookingId) {
      showConfirm({
        title: 'Atención: Turno Fijo',
        message: <div><p>Este turno pertenece a una serie repetitiva.</p><p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p></div>,
        confirmText: 'Sí, borrar TODA la serie', cancelText: 'No, ver otras opciones',
        onConfirm: async () => { try { await cancelFixedBooking(booking.fixedBookingId); showInfo('Serie completa eliminada.', 'Éxito'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
        onCancel: () => { 
          setTimeout(() => showConfirm({
            title: '¿Borrar solo hoy?',
            message: `¿Eliminar únicamente el turno de hoy y mantener los futuros?`,
            confirmText: 'Sí, borrar solo hoy', cancelText: 'Cancelar',
            onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('Turno del día eliminado.', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
          }), 200);
        }
      });
    } else {
      showConfirm({
        title: 'Cancelar turno', message: '¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar', onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('Turno cancelado', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } }
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
        showInfo('Cobro registrado correctamente.', "Listo");
    } catch (error) { alert("❌ Error al confirmar"); }
  };

  return (
    <>
      {/* --- TARJETA DE CREACIÓN DE RESERVA (BEIGE WIMBLEDON) --- */}
      <div className="bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-visible transition-all">
        <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
          <span className="bg-[#926699] text-[#EBE1D8] p-2.5 rounded-xl shadow-lg shadow-[#926699]/20">
            {manualBooking.isFixed ? <Repeat size={24} strokeWidth={3} /> : <CalendarPlus size={24} strokeWidth={3} />}
          </span>
          {manualBooking.isFixed ? 'Nuevo Turno Fijo' : 'Nueva Reserva Simple'}
          <span className="ml-2 text-[10px] px-3 py-1 rounded-full bg-[#347048] text-[#EBE1D8] font-black tracking-widest not-italic shadow-sm">
            {manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}
          </span>
        </h2>

        <form onSubmit={handleCreateBooking} className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          
          {/* BUSCADOR CLIENTE (Usa focus-within para saltar al frente al escribir) */}
          <div className="relative focus-within:z-[100] z-20" ref={wrapperRef}>
              <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Nombre (Buscar Cliente)</label>
              <input 
                  type="text" 
                  value={manualBooking.guestFirstName} 
                  onChange={handleNameChange}
                  className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all relative z-10"
                  placeholder="Escribe para buscar..." 
                  required autoComplete="off"
              />
              {showDropdown && searchResults.length > 0 && (
                  <ul className="absolute z-[110] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto">
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

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Apellido</label>
            <input type="text" value={manualBooking.guestLastName} onChange={(e) => setManualBooking({ ...manualBooking, guestLastName: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Ingresa el apellido" required />
          </div>

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Teléfono</label>
            <input type="tel" value={manualBooking.guestPhone} onChange={(e) => setManualBooking({ ...manualBooking, guestPhone: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Ej: 3511234567" required/>
          </div>

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">DNI</label>
            <input type="text" value={manualBooking.guestDni} onChange={(e) => setManualBooking({ ...manualBooking, guestDni: e.target.value })} 
            className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Número de documento" required />
          </div>

          {/* 👇 FECHA (Usa focus-within para tapar TODO al abrirse) 👇 */}
          <div className="relative focus-within:z-[100] z-20">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Fecha</label>
            {manualBooking.isFixed ? (
              <div className="h-12 bg-white/50 border-2 border-dashed border-[#347048]/20 rounded-xl px-4 flex items-center">
                <span className="text-[#347048]/40 font-bold text-sm">Selecciona día abajo</span>
              </div>
            ) : (
              <div className="wimbledon-datepicker relative z-10">
                <DatePickerDark
                  selected={manualBooking.startDateBase ? (() => { const [y, m, d] = manualBooking.startDateBase.split('-').map(Number); return new Date(y, m - 1, d); })() : null}
                  onChange={(date: Date | null) => {
                    if (!date) return;
                    setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(date) });
                  }}
                  minDate={new Date()}
                  showIcon={false}
                  variant="light"
                  inputClassName="w-full h-12 bg-white text-[#347048] font-bold border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 shadow-sm outline-none transition-all cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* HORA */}
          <div className="relative z-20">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Hora</label>
            <CustomSelect 
              value={manualBooking.time}
              onChange={(val: string) => setManualBooking({ ...manualBooking, time: val })}
              placeholder="Selecciona hora"
              options={CLUB_TIME_SLOTS.map(slot => ({
                value: slot,
                label: slot,
                disabled: !!(manualBooking.startDateBase && isPastTimeForDate(manualBooking.startDateBase, slot))
              }))}
            />
          </div>

          {/* CANCHA */}
          <div className="relative z-20">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Cancha</label>
            <CustomSelect 
              value={manualBooking.courtId}
              onChange={(val: string) => setManualBooking({ ...manualBooking, courtId: val })}
              placeholder="Selecciona cancha"
              options={courts.map(c => ({
                value: c.id.toString(),
                label: c.name
              }))}
            />
          </div>

          {/* DIA DE SEMANA */}
          {manualBooking.isFixed && (
            <div className="relative z-20">
              <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Día de la semana</label>
              <CustomSelect 
                value={manualBooking.dayOfWeek}
                onChange={(val: string) => setManualBooking({ ...manualBooking, dayOfWeek: val })}
                placeholder="Selecciona día"
                options={[
                  { value: '1', label: 'Lunes' },
                  { value: '2', label: 'Martes' },
                  { value: '3', label: 'Miércoles' },
                  { value: '4', label: 'Jueves' },
                  { value: '5', label: 'Viernes' },
                  { value: '6', label: 'Sábado' },
                  { value: '0', label: 'Domingo' }
                ]}
              />
            </div>
          )}

          {/* BOTÓN CHECKBOX Y SUBMIT */}
          <div className="relative z-0 md:col-span-2 flex flex-col sm:flex-row gap-6 items-center justify-between mt-4 p-6 bg-[#347048]/5 rounded-[1.5rem] border border-[#347048]/10">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${manualBooking.isFixed ? 'bg-[#B9CF32] border-[#B9CF32]' : 'border-[#347048]/20 bg-white'}`}>
                    {manualBooking.isFixed && <Check size={16} className="text-[#347048]" strokeWidth={4} />}
                </div>
                <input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({ ...manualBooking, isFixed: e.target.checked })} className="hidden" />
                <span className="text-sm uppercase tracking-wide">¿Es un turno fijo?</span>
              </label>
              <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${manualBooking.isProfessor ? 'bg-[#926699] border-[#926699]' : 'border-[#347048]/20 bg-white'}`}>
                  {manualBooking.isProfessor && <Check size={16} className="text-[#347048]" strokeWidth={4} />}
                </div>
                <input type="checkbox" checked={manualBooking.isProfessor} onChange={(e) => setManualBooking({ ...manualBooking, isProfessor: e.target.checked })} className="hidden" />
                <span className="text-sm uppercase tracking-wide">Profesor (aplica descuento)</span>
              </label>
            </div>

            <button type="submit" className="w-full sm:w-auto px-10 py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-sm flex items-center justify-center gap-3 group">
              {manualBooking.isFixed ? <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" /> : <CalendarIcon size={18} />}
              {manualBooking.isFixed ? 'Crear Serie' : 'Crear Reserva'}
            </button>
          </div>
        </form>
      </div>

      {/* --- TABLA DE HORARIOS --- */}
      <div className="bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/20 overflow-hidden relative z-0">
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6 mb-8">
          <h2 className="text-2xl font-black text-[#347048] uppercase italic tracking-tight flex items-center gap-3">
             <div className="w-2 h-8 bg-[#B9CF32] rounded-full"></div>
             Agenda del Día
          </h2>
          <div className="flex flex-wrap items-center gap-4 bg-white/40 p-2 rounded-2xl border border-white/60">
            <div className="flex items-center gap-2 px-3 wimbledon-datepicker">
              <span className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Fecha:</span>
              <DatePickerDark
                selected={scheduleDate ? (() => { const [y, m, d] = scheduleDate.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                onChange={(date: Date | null) => date && setScheduleDate(formatLocalDate(date))}
                showIcon={false}
                variant="light"
                inputClassName="w-full h-12 bg-white text-[#347048] font-bold border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 shadow-sm outline-none transition-all cursor-pointer"
              />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="flex items-center gap-2 px-4 py-2 bg-[#347048] text-[#EBE1D8] rounded-xl text-xs font-black uppercase tracking-tighter hover:bg-[#B9CF32] hover:text-[#347048] transition-all">
              {loadingSchedule ? '...' : 'Actualizar'}
            </button>
            {lastUpdate && <span className="text-[10px] font-bold text-[#347048]/40 px-2 uppercase">{lastUpdate.toLocaleTimeString()}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6 text-[10px] font-black uppercase tracking-widest text-[#347048]/60">
          <span className="flex items-center gap-2">
            <span className="w-5 h-0.5 rounded-full bg-[#B9CF32]"></span>
            Pendiente
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-0.5 rounded-full bg-[#347048]"></span>
            Confirmada
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-0.5 rounded-full bg-[#3B82F6]"></span>
            Finalizada
          </span>
        </div>

        {loadingSchedule ? (
          <div className="space-y-4 py-10">
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : scheduleBookings.length > 0 ? (
          <div className="overflow-x-auto -mx-8">
            <div className="min-w-[900px] pl-16 pr-8">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                    {courts.map((court) => (
                      <th
                        key={court.id}
                        className="px-4 py-3 border border-[#347048]/10 bg-white/80 text-left"
                      >
                        {court.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CLUB_TIME_SLOTS.map((time) => (
                    <tr key={`row-${time}`} className="h-[120px]">
                      {courts.map((court, index) => {
                        const slot = scheduleByTime.get(time)?.get(court.id);
                        const hasBooking = !!slot?.booking;
                        const bookingName = slot?.booking?.userName || slot?.booking?.guestName || 'Reserva';

                        return (
                          <td
                            key={`cell-${time}-${court.id}`}
                            className="border border-[#347048]/5 bg-white/50 align-top p-2 h-[120px] relative"
                          >
                            {index === 0 && (
                              <span className="absolute -left-14 -top-3 px-2 text-[11px] font-black text-[#347048]/70">
                                {time}
                              </span>
                            )}
                            {hasBooking ? (
                              <button
                                type="button"
                                onClick={() => setSelectedBookingDetail({ booking: slot.booking, slotTime: time, courtName: slot.courtName })}
                                className={`relative h-full w-full rounded-3xl border-l-[6px] ${getBookingBarClass(slot)} bg-white/90 p-3 text-left shadow-[0_10px_24px_rgba(52,112,72,0.12)] ring-1 ring-white/70 transition hover:shadow-[0_14px_28px_rgba(52,112,72,0.18)] flex flex-col`}
                              >
                                <div className="text-xs font-black text-[#347048] uppercase tracking-wide truncate">
                                  {bookingName}
                                </div>
                                <div className="mt-1 text-[10px] font-bold text-[#347048]/60">
                                  {getBookingTimeRange(slot)}
                                </div>
                                {slot.booking?.fixedBookingId && (
                                  <div className="absolute top-2 right-2 inline-flex items-center gap-1 bg-[#347048] text-[#B9CF32] text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-widest">
                                    Fijo
                                  </div>
                                )}
                                <div className="mt-auto flex flex-wrap gap-1 pt-2">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedBooking(slot.booking);
                                    }}
                                    className="p-2 rounded-xl bg-white border border-[#347048]/10 text-[#347048] hover:bg-[#347048] hover:text-[#EBE1D8] transition-all shadow-sm"
                                    title="Consumos"
                                  >
                                    <ShoppingCart size={14} strokeWidth={2.5} />
                                  </button>
                                  {slot.booking.status === 'PENDING' && (
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleOpenPaymentModal(slot.booking.id);
                                      }}
                                      className="p-2 rounded-xl bg-[#B9CF32] text-[#347048] border border-white hover:scale-110 transition-all shadow-md"
                                      title="Confirmar pago"
                                    >
                                      <Check size={14} strokeWidth={3} />
                                    </button>
                                  )}
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleCancelBooking(slot.booking);
                                    }}
                                    className="p-2 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                    title="Cancelar"
                                  >
                                    <Trash2 size={14} strokeWidth={2.5} />
                                  </button>
                                </div>
                              </button>
                            ) : (
                              <div className="h-full min-h-[88px]" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 border-4 border-dashed border-[#347048]/10 rounded-[2rem]"><p className="text-[#347048]/40 font-black uppercase tracking-widest">Sin datos cargados para esta fecha</p></div>
        )}
      </div>

      {selectedBooking && (
        <ModalPortal onClose={() => setSelectedBooking(null)}>
          <BookingConsumption 
            bookingId={selectedBooking.id}
            slug={getClubSlug() || ''}
            courtPrice={selectedBooking.price}
            baseCourtPrice={selectedBooking.court?.price}
            paymentStatus={selectedBooking.paymentStatus}
            onClose={() => setSelectedBooking(null)}
            onConfirm={() => { setSelectedBooking(null); loadSchedule(); }}
          />
        </ModalPortal>
      )}

      {selectedBookingDetail && (
        <ModalPortal onClose={() => setSelectedBookingDetail(null)}>
          <div className="relative space-y-6 text-[#347048]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-black uppercase italic tracking-tight">Detalle de Reserva</h3>
                <p className="text-xs font-bold uppercase tracking-widest text-[#347048]/50 mt-1">
                  {selectedBookingDetail.courtName || selectedBookingDetail.booking.court?.name || 'Cancha'}
                </p>
              </div>
              <div className="flex items-start gap-3">
                {selectedBookingDetail.booking.fixedBookingId && (
                  <span className="bg-[#347048] text-[#B9CF32] text-[10px] font-black px-3 py-1 rounded-md uppercase tracking-widest">
                    Fijo
                  </span>
                )}
                <button
                  onClick={() => setSelectedBookingDetail(null)}
                  className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                  title="Cerrar ventana"
                >
                  <X size={20} strokeWidth={3} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Reservante</p>
                <p className="text-lg font-black mt-1">
                  {selectedBookingDetail.booking.userName || selectedBookingDetail.booking.guestName || 'Sin nombre'}
                </p>
                {(selectedBookingDetail.booking.guestPhone || selectedBookingDetail.booking.user?.phoneNumber) && (
                  <p className="text-xs font-bold text-[#347048]/60 mt-1">
                    {selectedBookingDetail.booking.guestPhone || selectedBookingDetail.booking.user?.phoneNumber}
                  </p>
                )}
                {selectedBookingDetail.booking.guestDni && (
                  <p className="text-xs font-bold text-[#347048]/60 mt-1">DNI: {selectedBookingDetail.booking.guestDni}</p>
                )}
              </div>
              <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Horario</p>
                <p className="text-lg font-black mt-1">{getBookingTimeRange(selectedBookingDetail.booking)}</p>
                <p className="text-xs font-bold text-[#347048]/60 mt-1">Estado: {formatBookingStatus(selectedBookingDetail.booking.status)}</p>
                {selectedBookingDetail.booking.paymentStatus && (
                  <p className="text-xs font-bold text-[#347048]/60 mt-1">Pago: {formatPaymentStatus(selectedBookingDetail.booking.paymentStatus)}</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Precio</p>
                <p className="text-xl font-black">${Number(selectedBookingDetail.booking.price || 0).toLocaleString()}</p>
              </div>
              {Array.isArray(selectedBookingDetail.booking.items) && selectedBookingDetail.booking.items.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedBookingDetail.booking.items.map((item: any, i: number) => (
                    <span key={i} className="text-[10px] font-black px-2 py-1 rounded-md bg-[#926699]/10 text-[#926699] border border-[#926699]/20 uppercase">
                      {item.quantity}x {item.product?.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              {selectedBookingDetail.booking.status === 'PENDING' && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBookingId(selectedBookingDetail.booking.id);
                    setShowPaymentModal(true);
                  }}
                  className="px-5 py-3 rounded-xl bg-[#B9CF32] text-[#347048] font-black uppercase tracking-widest text-xs"
                >
                  Cobrar
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedBooking(selectedBookingDetail.booking);
                }}
                className="px-5 py-3 rounded-xl bg-[#347048] text-[#EBE1D8] font-black uppercase tracking-widest text-xs"
              >
                Ver consumos
              </button>
              <button
                type="button"
                onClick={() => handleCancelBooking(selectedBookingDetail.booking)}
                className="px-5 py-3 rounded-xl bg-red-50 text-red-600 border border-red-100 font-black uppercase tracking-widest text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {showPaymentModal && (
        <ModalPortal onClose={() => setShowPaymentModal(false)}>
          <div className="relative text-[#347048]">
            <button
              onClick={() => setShowPaymentModal(false)}
              className="absolute right-0 top-0 -mt-2 -mr-2 bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
              title="Cerrar ventana"
            >
              <X size={20} strokeWidth={3} />
            </button>
            <div className="text-center mb-6">
              <h3 className="text-2xl font-black mb-2 uppercase tracking-tight italic">Cobrar Reserva</h3>
              <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest">Selecciona el método de pago</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <button onClick={() => handleConfirmBooking('CASH')} className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-[1.5rem] text-[#347048] transition-all shadow-sm group">
                <Banknote size={36} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
                <span className="font-black text-xs uppercase tracking-tighter">Efectivo</span>
              </button>
              <button onClick={() => handleConfirmBooking('TRANSFER')} className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-[1.5rem] text-[#347048] transition-all shadow-sm group">
                <CreditCard size={36} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
                <span className="font-black text-xs uppercase tracking-tighter">Digital</span>
              </button>
            </div>
            <button onClick={() => handleConfirmBooking('DEBT')} className="w-full py-4 flex items-center justify-center gap-2 bg-[#926699]/10 border-2 border-[#926699]/20 hover:bg-[#926699]/20 rounded-xl text-[#926699] font-black uppercase text-[10px] tracking-[0.2em] transition-all">
              <FileText size={16} strokeWidth={3} />
              <span>Dejar en Cuenta (Deuda)</span>
            </button>
          </div>
        </ModalPortal>
      )}

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}