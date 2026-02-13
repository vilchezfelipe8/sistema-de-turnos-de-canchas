"use client";

import { useState, useEffect, useRef } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';
import AppModal from './AppModal';
import DatePickerDark from './ui/DatePickerDark';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService, Club } from '../services/ClubService';

const API_URL = getApiUrl();
const BASE_COURT_PRICE = 28000;

interface BookingGridProps {
  /** Slug del club: cuando está en /club/[slug], solo se muestran canchas y turnos de ese club */
  clubSlug?: string;
}

export default function BookingGrid({ clubSlug }: BookingGridProps = {}) {
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const formatDateTime = (date: Date) =>
    date.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  
  // Calcular fecha máxima (un mes desde hoy) sin problemas de zona horaria
  const getMaxDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const maxDate = new Date(year, month + 1, day); // Un mes en adelante
    return maxDate;
  };
  
  const maxDate = getMaxDate();
  // Inicializar con la fecha de hoy sin problemas de zona horaria
  const getTodayDate = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const [selectedDate, setSelectedDate] = useState<Date | null>(getTodayDate());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<{ id: number; name: string } | null>(null);
  const [selectedActivityFilter, setSelectedActivityFilter] = useState<string | 'ALL'>('ALL');
  const [isBooking, setIsBooking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Estado para el botón visual
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestDni, setGuestDni] = useState('');
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestPhoneFocused, setGuestPhoneFocused] = useState(false);
  const [guestError, setGuestError] = useState('');
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: string;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false }));
  };

  const showInfo = (message: string, title = 'Información') => {
    setModalState({
      show: true,
      title,
      message,
      cancelText: '',
      confirmText: 'OK'
    });
  };

  const showError = (message: string) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar'
    });
  };

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate, clubSlug);
  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const STORAGE_PREFIX = 'disabledSlots:';
  const [allCourts, setAllCourts] = useState<Array<{ id: number; name: string; activities?: Array<{ id: number; name: string }> }>>([]);
  const [clubConfig, setClubConfig] = useState<Club | null>(null);
  const getTrimmedGuestInfo = () => {
    const trimmedPhone = guestPhone.replace(/\D/g, '');
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const trimmedDni = guestDni.trim().replace(/\./g, '');
    return {
      name: fullName,
      email: guestEmail.trim(),
      phone: trimmedPhone ? `+549${trimmedPhone}` : '',
      guestDni: trimmedDni
    };
  };

  const isEmailValid = (email: string) => {
    if (!email) return true;
    return /^\S+@\S+\.\S+$/.test(email);
  };

  const isPhoneValid = (phone: string) => {
    if (!phone) return true;
    if (!phone.startsWith('+549')) return false;
    const digits = phone.replace(/\D/g, '');
    if (!digits.startsWith('549')) return false;
    const nationalDigits = digits.slice(3);
    if (nationalDigits.length !== 10) return false;
    return /^\+549\d+$/.test(phone);
  };

  const formatPhoneDigits = (digits: string) => {
    const clean = digits.slice(0, 10);
    const part1 = clean.slice(0, 3);
    const part2 = clean.slice(3, 6);
    const part3 = clean.slice(6, 10);
    return [part1, part2, part3].filter(Boolean).join(' ');
  };

  const isGuestInfoValid = () => {
    const { email, phone } = getTrimmedGuestInfo();
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    if (!firstName || !lastName) return false;
    if (!phone) return false;
    return isEmailValid(email) && isPhoneValid(phone);
  };

  // --- Verificar Autenticación al cargar ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  // --- Cargar configuración del club (para saber si aplica extra por luces) ---
  useEffect(() => {
    if (!clubSlug) {
      setClubConfig(null);
      return;
    }
    const fetchClub = async () => {
      try {
        const data = await ClubService.getClubBySlug(clubSlug);
        setClubConfig(data);
      } catch (err) {
        console.error('Error loading club config', err);
        setClubConfig(null);
      }
    };
    fetchClub();
  }, [clubSlug]);

  // --- LÓGICA DE FILTRADO (Sin cambios) ---
  const filteredSlotsWithCourts = (() => {
    if (!selectedDate) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());

    if (selected < today) return [];
    if (selected.getTime() === today.getTime()) {
      return slotsWithCourts.filter((slotWithCourt) => {
        const [hours, minutes] = slotWithCourt.slotTime.split(':').map(Number);
        const slotTime = new Date();
        slotTime.setHours(hours, minutes, 0, 0);
        return slotTime > now;
      });
    }
    return slotsWithCourts;
  })();


  const getPriceInfo = () => {
    const base = BASE_COURT_PRICE;
    if (!selectedDate || !selectedSlot) {
      return { base, final: base, extra: 0, hasLights: false };
    }
    const cfg = clubConfig;
    if (!cfg || !cfg.lightsEnabled || !cfg.lightsExtraAmount || !cfg.lightsFromHour) {
      return { base, final: base, extra: 0, hasLights: false };
    }

    try {
      const [lh, lm] = String(cfg.lightsFromHour).split(':').map((n) => parseInt(n, 10));
      if (Number.isNaN(lh) || Number.isNaN(lm)) {
        return { base, final: base, extra: 0, hasLights: false };
      }

      const [sh, sm] = selectedSlot.split(':').map((n) => parseInt(n, 10));
      if (Number.isNaN(sh) || Number.isNaN(sm)) {
        return { base, final: base, extra: 0, hasLights: false };
      }

      const slotMinutes = sh * 60 + sm;
      const lightsMinutes = lh * 60 + lm;
      if (slotMinutes >= lightsMinutes) {
        const extra = Number(cfg.lightsExtraAmount);
        return { base, final: base + extra, extra, hasLights: true };
      }
      return { base, final: base, extra: 0, hasLights: false };
    } catch {
      return { base, final: base, extra: 0, hasLights: false };
    }
  };

  const priceInfo = getPriceInfo();

const performBooking = async (guestInfo?: { name: string; email?: string; phone?: string; guestDni?: string }) => {
    
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    
    try {
      setIsBooking(true);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      const bookingDateTime = new Date(year, month, day, hours, minutes, 0, 0);

      const guestDataForBackend = (!isAuthenticated && guestInfo) ? {
          guestName: guestInfo.name,     
          guestPhone: guestInfo.phone,    
          guestDni: guestInfo.guestDni    
      } : undefined;

      const createResult = await createBooking(
        selectedCourt.id,
        1,
        bookingDateTime,
        undefined,
        !isAuthenticated ? guestInfo : undefined// 
      );

      // Guardar bloqueo temporal localmente (Optimistic UI)
      const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
        selectedDate.getDate()
      ).padStart(2, '0')}`;
      const slotKey = `${dateString}-${selectedSlot}-${selectedCourt.id}`;
      setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));

      try {
        if (createResult && createResult.refresh && createResult.refreshDate) {
          const [ry, rm, rd] = String(createResult.refreshDate).split('-').map(Number);
          setSelectedDate(new Date(ry, rm - 1, rd));
        }
        await (refresh as () => Promise<void>)?.();
        setSelectedSlot(null);
        setSelectedCourt(null);
        
        // 👇 4. LIMPIEZA DE FORMULARIO
        if (!isAuthenticated) {
          setGuestFirstName('');
          setGuestLastName('');
          setGuestEmail('');
          setGuestPhone('');
          setGuestDni(''); // 👈 ¡NO TE OLVIDES DE LIMPIAR EL DNI TAMBIÉN!
        }
      } catch (_) { /* noop */ }

      showInfo('✅ ¡Reserva Confirmada! Te esperamos en la cancha ' + selectedCourt.name + '.', 'Listo');
    } catch (error: any) {
      showError('❌ Ups: ' + error.message);
    } finally {
      setIsBooking(false);
    }
  };

  const handleGuestConfirm = () => {
    const info = getTrimmedGuestInfo();
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    const dni = guestDni.trim();
    if (!firstName || !lastName) {
      setGuestError('❗ Ingresá tu nombre y apellido para reservar como invitado.');
      return;
    }
    if (!dni) {
      setGuestError('❗ El DNI es obligatorio para identificar la reserva.');
      return;
    }
    // Opcional: Validar largo mínimo (ej: que tenga al menos 7 números)
    if (dni.length < 7) {
       setGuestError('❗ Ingresá un DNI válido (mínimo 7 números).');
       return;
    }
    if (info.email && !isEmailValid(info.email)) {
      setGuestError('❗ Ingresá un email con formato válido.');
      return;
    }
    if (info.phone && !isPhoneValid(info.phone)) {
      setGuestError('❗ Ingresá un teléfono con formato válido.');
      return;
    }
    if (!info.phone) {
      setGuestError('❗ Ingresá un teléfono para poder contactarte.');
      return;
    }
    setGuestError('');
    setGuestModalOpen(false);
    performBooking(info);
  };

  const handleGuestKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (isBooking || !isGuestInfoValid()) return;
    handleGuestConfirm();
  };

  const handleBooking = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    if (!isAuthenticated) {
      setGuestError('');
      setGuestModalOpen(true);
      return;
    }
    performBooking();
  };

  // --- Cargar disabledSlots de localStorage ---
  useEffect(() => {
    if (!selectedDate) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;
    const key = `${STORAGE_PREFIX}${dateString}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        setDisabledSlots((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.error('Error loading disabled slots from localStorage', err);
    }
  }, [selectedDate]);

  // --- Guardar disabledSlots en localStorage ---
  useEffect(() => {
    if (!selectedDate) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;
    const key = `${STORAGE_PREFIX}${dateString}`;
    try {
      const objForDate = Object.fromEntries(Object.entries(disabledSlots).filter(([k]) => k.startsWith(`${dateString}-`)));
      localStorage.setItem(key, JSON.stringify(objForDate));
    } catch (err) {
      console.error('Error saving disabled slots to localStorage', err);
    }
  }, [disabledSlots, selectedDate]);

  const selectedTimes = (() => {
    if (!selectedDate || !selectedSlot) return null;
    const [hours, minutes] = selectedSlot.split(':').map(Number);
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0, 0);
    const end = new Date(start.getTime() + 90 * 60000);
    return {
      startLabel: formatDateTime(start),
      endLabel: formatDateTime(end)
    };
  })();

  useEffect(() => {
    if (!selectedSlot || !selectedCourt) return;
    confirmButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot, selectedCourt]);

  // --- Cargar Canchas (solo del club cuando hay clubSlug) ---
  useEffect(() => {
    const fetchCourts = async () => {
      try {
        const url = clubSlug
          ? `${API_URL}/api/courts?clubSlug=${encodeURIComponent(clubSlug)}`
          : `${API_URL}/api/courts`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setAllCourts(data);
      } catch (err) {
        console.error('Error fetching courts:', err);
      }
    };
    fetchCourts();
  }, [clubSlug]);

  // --- CORRECCIÓN MEMORIA ZOMBIE (Sincronizar Backend con Frontend) ---
  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    setDisabledSlots((prev) => {
      const nextState = { ...prev }; // Copiamos el estado actual

      slotsWithCourts.forEach((slot) => {
        const availableIds = new Set(slot.availableCourts.map((c) => c.id));
        const courtsToInspect = allCourts.length > 0 ? allCourts : slot.availableCourts;

        courtsToInspect.forEach((court) => {
          const key = `${dateString}-${slot.slotTime}-${court.id}`;

          if (!availableIds.has(court.id)) {
            // El backend dice que NO está disponible -> Lo bloqueamos
            nextState[key] = true;
          } else {
            // 🔥 SI EL BACKEND DICE QUE ESTÁ LIBRE, BORRAMOS EL BLOQUEO LOCAL
            delete nextState[key]; 
          }
        });
      });

      return nextState;
    });
  }, [slotsWithCourts, allCourts, selectedDate]);

  // --- RENDERIZADO VISUAL ---
  return (
    <div className="w-full max-w-4xl mx-auto bg-[#EBE1D8] p-6 sm:p-8 rounded-[2rem] shadow-2xl shadow-[#347048]/50 border-4 border-[#d4c5b0]/50 relative overflow-hidden">
    
      <div className="text-center mb-8">
        <h2 className="text-4xl font-black text-[#926699] mb-2 tracking-tighter uppercase italic">Reservar Cancha</h2>
        <p className="text-[#347048] font-bold text-sm tracking-wide opacity-80">Elige tu día y horario ideal</p>
      </div>

      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-black text-[#926699] mb-2 ml-1 flex items-center gap-2 uppercase tracking-wider">
            <span className="text-[#B9CF32] text-base">🎾</span>
            <span>Tipo de cancha</span>
          </label>
          <div className="relative group">
            <select
              value={selectedActivityFilter}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedActivityFilter(value);
                setSelectedSlot(null);
                setSelectedCourt(null);
              }}
              className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 text-[#347048] font-bold focus:outline-none shadow-sm appearance-none cursor-pointer hover:bg-white/90"
            >
              <option value="ALL">Todas las canchas</option>
              {Array.from(
                new Set(
                  allCourts.flatMap((court) => court.activities?.map((activity) => activity.name) || [])
                )
              ).map((activityName) => (
                <option key={activityName} value={activityName}>
                  {activityName}
                </option>
              ))}
            </select>
             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-[#B9CF32]">
              <svg className="fill-current h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-xs font-black text-[#926699] mb-2 ml-1 flex items-center gap-2 uppercase tracking-wider">
            <span className="text-[#B9CF32] text-base">📅</span>
            <span>Fecha</span>
          </label>
          <div className="w-full relative">
            <DatePickerDark
              selected={selectedDate}
              onChange={(date: Date | null) => {
                if (!date) return;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const selectedDateObj = new Date(date);
                selectedDateObj.setHours(0, 0, 0, 0);
                
                // Validar que la fecha no sea pasada
                if (selectedDateObj < today) {
                  showError('No puedes seleccionar una fecha pasada. Por favor, elige una fecha de hoy en adelante.');
                  return;
                }
                
                // Validar que la fecha no sea más de un mes en adelante
                const maxAllowedDate = getMaxDate();
                maxAllowedDate.setHours(0, 0, 0, 0);
                
                if (selectedDateObj > maxAllowedDate) {
                  showError('Solo puedes reservar hasta un mes en adelante. Por favor, elige una fecha dentro del próximo mes.');
                  return;
                }
                
                setSelectedDate(date);
                setSelectedSlot(null);
                setSelectedCourt(null);
              }}
              minDate={new Date()}
              maxDate={maxDate}
              showIcon={false}
              variant="light"
              inputClassName="bg-white text-[#347048] font-bold border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 shadow-sm"
            />
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#347048]"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-800 p-4 rounded-xl border border-red-100 text-center mb-6 flex items-center justify-center gap-2 font-bold text-sm">
           <span>⚠️</span> {error}
        </div>
      )}

      {!loading && filteredSlotsWithCourts.length > 0 && (
        <div className="mb-10">
          <label className="block text-xs font-black text-[#926699] mb-4 ml-1 flex items-center gap-2 uppercase tracking-wider">
            <span className="text-[#B9CF32] text-base">⏰</span>
            <span>Horarios Disponibles</span>
          </label>

          <div className="space-y-4">
          {filteredSlotsWithCourts.map((slotWithCourt) => {
              const dateString = selectedDate
                ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
                : '';
              const courtsToShow = (allCourts.length > 0 ? allCourts : slotWithCourt.availableCourts).filter((court) => {
                if (selectedActivityFilter === 'ALL') return true;
                const activities = (court as any).activities as Array<{ name: string }> | undefined;
                return (activities || []).some((activity) => activity.name === selectedActivityFilter);
              });

              const availableCount = courtsToShow.reduce((acc, court) => {
                const key = `${dateString}-${slotWithCourt.slotTime}-${court.id}`;
                const isBackendAvailable = slotWithCourt.availableCourts.some((ac) => ac.id === court.id);
                if (disabledSlots[key] || !isBackendAvailable) return acc;
                return acc + 1;
              }, 0);

              return (
                <div key={slotWithCourt.slotTime} className="bg-white/60 p-5 rounded-2xl border border-[#926699]/10 shadow-sm hover:border-[#926699]/30 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-black text-3xl text-[#347048] tracking-tight">{slotWithCourt.slotTime}</span>
                    <span className="text-[10px] font-black bg-[#926699] text-[#EBE1D8] px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2">
                      {availableCount} {availableCount !== 1 ? 'DISPONIBLES' : 'DISPONIBLE'}
                      {availableCount > 0 && <div className="w-2 h-2 bg-[#B9CF32] rounded-full animate-pulse shadow-[0_0_8px_#B9CF32]"></div>}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {courtsToShow.map((court) => {
                      const slotKey = `${dateString}-${slotWithCourt.slotTime}-${court.id}`;
                      const isLocallyDisabled = !!disabledSlots[slotKey];
                      const isBackendAvailable = slotWithCourt.availableCourts.some((ac) => ac.id === court.id);
                      const isDisabled = isLocallyDisabled || !isBackendAvailable;

                      const handleSelectCourt = async () => {
                        if (!selectedDate) return;
                        if (!isBackendAvailable) return;
                        try {
                          // Doble check de disponibilidad
                          const res = await fetch(`${API_URL}/api/bookings/availability?courtId=${court.id}&date=${dateString}&activityId=1`);
                          if (!res.ok) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            showError('No se pudo verificar disponibilidad.');
                            return;
                          }
                          const data = await res.json();
                          const availableSlots: string[] = data.availableSlots || [];
                          if (!availableSlots.includes(slotWithCourt.slotTime)) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            showError('⚠️ Cancha ya no disponible.');
                            return;
                          }
                          setSelectedSlot(slotWithCourt.slotTime);
                          setSelectedCourt(court);
                        } catch (err: any) {
                          setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                          showError('Error verificando disponibilidad.');
                        }
                      };

                      // Estilos
                      const isSelected = selectedSlot === slotWithCourt.slotTime && selectedCourt?.id === court.id;
                      let btnClass = 'py-3 px-4 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center gap-2 border-2 ';
                      
                      if (isDisabled) {
                        btnClass += 'bg-gray-100 text-gray-400 border-transparent cursor-not-allowed opacity-60';
                      } else if (isSelected) {
                        btnClass += 'bg-[#B9CF32] text-[#347048] border-[#B9CF32] transform scale-[1.02] shadow-lg font-black';
                      } else {
                        btnClass += 'bg-white text-[#347048] border-transparent hover:border-[#B9CF32] hover:text-[#B9CF32] hover:bg-[#B9CF32]/10';
                      }

                      return (
                        <button key={court.id} onClick={handleSelectCourt} disabled={isDisabled} className={btnClass}>
                          <span>🏓</span> {court.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && filteredSlotsWithCourts.length === 0 && selectedDate && (
        <div className="text-center py-12 bg-[#347048]/5 rounded-2xl border border-dashed border-[#347048]/20 mb-8">
          <p className="text-[#347048]/60 font-bold">
            {(() => {
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
              if (selected < today) return '⏳ No se puede viajar al pasado...';
              else if (selected.getTime() === today.getTime() && slotsWithCourts.length > 0) return '🌙 Ya no quedan turnos por hoy.';
              else return '🚫 No hay canchas disponibles para esta fecha.';
            })()}
          </p>
        </div>
      )}

      {/* BOTÓN PRINCIPAL CON LÓGICA DE LOGIN VISUAL */}
      <button
        ref={confirmButtonRef}
        onClick={handleBooking}
        disabled={isBooking || !selectedSlot || !selectedCourt}
        className={`w-full py-4 rounded-2xl font-black text-lg uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2
            ${(isBooking || !selectedSlot || !selectedCourt) 
                ? 'bg-[#347048]/10 text-[#347048]/30 cursor-not-allowed border border-[#347048]/5' 
                : 'bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] hover:-translate-y-1 hover:shadow-[#B9CF32]/30'}`}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
            <span>Procesando...</span>
          </>
        ) : (isBooking || !selectedSlot || !selectedCourt) ? (
            <>
              <span className="opacity-50">👆</span>
              <span className="opacity-50">Selecciona Turno</span>
            </>
        ) : !isAuthenticated ? (
            <>
                <span>⚡</span>
                <span>CONFIRMAR RESERVA</span>
            </>
        ) : selectedSlot && selectedCourt ? (
          <>
            <span>⚡</span>
            <span>CONFIRMAR RESERVA</span>
          </>
        ) : (
          <>
            <span className="opacity-50">👆</span>
            <span className="opacity-50">Selecciona Turno</span>
          </>
        )}
      </button>
      {selectedSlot && selectedCourt && (
        <div className="mt-2 text-xs text-[#347048]/80 text-center font-medium">
          {priceInfo.hasLights && clubConfig ? (
            <>
              Precio estimado: <span className="font-black text-[#347048] text-base">${priceInfo.final.toLocaleString()}</span>{' '}
              <span className="ml-1 text-[11px]">
                (incluye extra por luces de ${priceInfo.extra.toLocaleString()} desde las {clubConfig.lightsFromHour})
              </span>
            </>
          ) : (
            <>
              Precio estimado:{' '}
              <span className="font-black text-[#347048] text-base">
                ${priceInfo.final.toLocaleString()}
              </span>
            </>
          )}
        </div>
      )}
      <AppModal
        show={modalState.show}
        onClose={closeModal}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        closeOnBackdrop
        closeOnEscape
      />
      <AppModal
        show={guestModalOpen}
        onClose={() => setGuestModalOpen(false)}
        title=""
        message={(
          <div className="space-y-3">
            <h4 className="text-sm font-black text-[#926699] uppercase tracking-wider">Datos de reserva</h4>
            {selectedTimes && (
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#926699]/20 bg-[#fdfaff] p-3 text-sm text-[#347048]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#926699] uppercase text-xs">Inicia:</span>
                  <span className="text-[#347048] font-black">{selectedTimes.startLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#926699] uppercase text-xs">Termina:</span>
                  <span className="text-[#347048] font-black">{selectedTimes.endLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#926699] uppercase text-xs">Precio:</span>
                  <span className="text-[#347048] font-black text-lg">
                    ${priceInfo.final.toLocaleString()}
                  </span>
                </div>
                {priceInfo.hasLights && clubConfig && (
                  <div className="flex items-center justify-between text-xs text-[#347048]/60">
                    <span>Detalle:</span>
                    <span>
                      ${priceInfo.base.toLocaleString()} cancha + ${priceInfo.extra.toLocaleString()} luces
                    </span>
                  </div>
                )}
              </div>
            )}
            <h4 className="text-sm font-black text-[#926699] uppercase tracking-wider pt-2">Datos de contacto</h4>
            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    id="guest-first-name"
                    type="text"
                    placeholder=" "
                    value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)}
                    onKeyDown={handleGuestKeyDown}
                    className="peer w-full p-3 pt-5 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-transparent focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                  />
                  <label
                    htmlFor="guest-first-name"
                    className="absolute left-3 top-0 -translate-y-1/2 bg-white px-1 text-[#347048]/60 text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-white peer-focus:px-1 peer-focus:text-xs peer-focus:text-[#B9CF32] peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs font-bold"
                  >
                    Nombre
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="guest-last-name"
                    type="text"
                    placeholder=" "
                    value={guestLastName}
                    onChange={(e) => setGuestLastName(e.target.value)}
                    onKeyDown={handleGuestKeyDown}
                    className="peer w-full p-3 pt-5 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-transparent focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                  />
                  <label
                    htmlFor="guest-last-name"
                    className="absolute left-3 top-0 -translate-y-1/2 bg-white px-1 text-[#347048]/60 text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-white peer-focus:px-1 peer-focus:text-xs peer-focus:text-[#B9CF32] peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs font-bold"
                  >
                    Apellido
                  </label>
                </div>
                <div className="relative col-span-1 sm:col-span-2">
                <input
                  id="guest-dni"
                  type="text"
                  placeholder=" " 
                  value={guestDni}
                  onChange={(e) => {
                    const soloNumeros = e.target.value.replace(/\D/g, '');
                    setGuestDni(soloNumeros);
                  }}
                  onKeyDown={handleGuestKeyDown}
                  className="peer w-full p-3 pt-5 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-transparent focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                />
                <label
                  htmlFor="guest-dni"
                  className="absolute left-3 top-0 -translate-y-1/2 bg-white px-1 text-[#347048]/60 text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-white peer-focus:px-1 peer-focus:text-xs peer-focus:text-[#B9CF32] peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs font-bold"
                >
                  DNI 
                </label>
              </div>
              </div>
              <div className="relative flex items-center rounded-xl border border-[#347048]/20 bg-white focus-within:border-[#B9CF32] transition-colors shadow-sm">
                <span
                  className={`px-3 text-[#347048]/60 font-bold whitespace-nowrap min-w-[3.25rem] text-center transition-all duration-150 leading-none ${guestPhone.length || guestPhoneFocused ? 'mt-2' : ''}`}
                >
                  +54&nbsp;9
                </span>
                <input
                  id="guest-phone"
                  type="tel"
                  placeholder=" "
                  value={formatPhoneDigits(guestPhone)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setGuestPhone(digits);
                  }}
                  onFocus={() => setGuestPhoneFocused(true)}
                  onBlur={() => setGuestPhoneFocused(false)}
                  onKeyDown={handleGuestKeyDown}
                  maxLength={12}
                  className="peer w-full p-3 pt-5 rounded-xl bg-transparent text-[#347048] placeholder:text-transparent focus:outline-none transition-colors font-bold border-0 focus:border-0 leading-tight"
                />
                  <label
                  htmlFor="guest-phone"
                  className="absolute left-16 top-0 -translate-y-1/2 bg-white px-1 text-[#347048]/60 text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-white peer-focus:px-1 peer-focus:text-xs peer-focus:text-[#B9CF32] peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs font-bold"
                >
                  Teléfono
                </label>
              </div>
            </div>
            {guestError && (
              <p className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded-lg text-center">{guestError}</p>
            )}
          </div>
        )}
        cancelText="Cancelar"
        confirmText="Confirmar reserva"
        onConfirm={handleGuestConfirm}
        confirmDisabled={!isGuestInfoValid() || isBooking}
        closeOnBackdrop
        closeOnEscape
      />
    </div>
  );
}