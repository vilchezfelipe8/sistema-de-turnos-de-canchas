"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking, getBookingQuote, type BookingQuote } from '../services/BookingService';
import AppModal from './AppModal';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService, Club } from '../services/ClubService';
import { ChevronDown, Check, Calendar, Clock, MapPin, Zap, MousePointerClick, Hourglass, Moon, Ban, AlertCircle, Activity, ChevronLeft, ChevronRight } from 'lucide-react';

const apiBase = () => `${getApiUrl()}/api`;

interface BookingGridProps {
  /** Slug del club: cuando está en /club/[slug], solo se muestran canchas y turnos de ese club */
  clubSlug?: string;
}

type ActivityTypeSummary = {
  id: number;
  name: string;
  defaultDurationMinutes?: number | null;
  scheduleDurations?: number[] | null;
};

type CourtSummary = {
  id: number;
  name: string;
  price?: number | null;
  activityType?: ActivityTypeSummary | null;
};

const DEFAULT_DURATION_MINUTES = 90;

const normalizeActivityDurations = (raw: unknown, fallback: number) => {
  const parsed = Array.isArray(raw)
    ? raw.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];

  if (parsed.length > 0) {
    return Array.from(new Set(parsed));
  }

  return [fallback];
};

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
        <span className={`font-bold text-sm ${!selectedOption ? 'text-[#347048]/40' : 'text-[#347048]'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-[#B9CF32]' : 'text-[#347048]/40'}`} strokeWidth={3} />
      </div>

      {isOpen && (
        <div className="absolute z-[110] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-48 overflow-y-auto custom-scrollbar overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
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
                <span className="font-black text-xs">{option.label}</span>
                {option.disabled && <span className="text-[9px] font-black text-red-500 uppercase tracking-widest border border-red-500/20 bg-red-50 px-2 py-0.5 rounded-md">Sin Stock</span>}
                {!option.disabled && value === option.value && <Check size={14} className="text-[#347048]" strokeWidth={4} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default function BookingGrid({ clubSlug }: BookingGridProps = {}) {
  const router = useRouter();
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
  // Inicializar con la fecha de hoy sin problemas de zona horaria
  const getTodayDate = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const clampToDateRange = (value: Date, minDate: Date, maxDate?: Date | null) => {
    const next = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (next.getTime() < minDate.getTime()) return new Date(minDate);
    if (maxDate && next.getTime() > maxDate.getTime()) return new Date(maxDate);
    return next;
  };
  const [selectedDate, setSelectedDate] = useState<Date | null>(getTodayDate());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<CourtSummary | null>(null);

  const [selectedActivityFilter, setSelectedActivityFilter] = useState<string>('');
  // ...existing code...
    // ...existing code...
    // ...existing code...
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION_MINUTES);
  const [pendingSport, setPendingSport] = useState<string | null>(null);
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  const [queryApplied, setQueryApplied] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Estado para el botón visual
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestDni, setGuestDni] = useState('');
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestError, setGuestError] = useState('');
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const courtsSectionRef = useRef<HTMLDivElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: ReactNode;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false }));
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

  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const [priceQuote, setPriceQuote] = useState<BookingQuote | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const STORAGE_PREFIX = 'disabledSlots:';

  const [allCourts, setAllCourts] = useState<CourtSummary[]>([]);
  const activeCourts = useMemo(
    () => allCourts.filter((court: any) => !court?.isUnderMaintenance),
    [allCourts]
  );

  // ...existing code...
  const [clubConfig, setClubConfig] = useState<Club | null>(null);
  const normalizeText = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  const getCourtActivityName = (court: { activityType?: { name?: string } | null }) => String(court?.activityType?.name || '');
  const selectedActivityId = useMemo(() => {
    if (selectedCourt?.activityType?.id) {
      return Number(selectedCourt.activityType.id);
    }

    if (selectedActivityFilter) {
      const matchedCourt = activeCourts.find(
        (court) => getCourtActivityName(court as any) === selectedActivityFilter && court?.activityType?.id
      );
      if (matchedCourt?.activityType?.id) {
        return Number(matchedCourt.activityType.id);
      }
    }

    const firstCourtWithActivity = activeCourts.find((court) => Number(court?.activityType?.id) > 0);
    return firstCourtWithActivity?.activityType?.id ? Number(firstCourtWithActivity.activityType.id) : null;
  }, [selectedCourt, selectedActivityFilter, activeCourts]);

  const selectedActivityDurations = useMemo(() => {
    if (!Number.isFinite(selectedActivityId) || Number(selectedActivityId) <= 0) {
      return [DEFAULT_DURATION_MINUTES];
    }

    const matchedCourt = activeCourts.find(
      (court) => Number(court?.activityType?.id) === Number(selectedActivityId)
    );

    const fallbackDuration = Number(matchedCourt?.activityType?.defaultDurationMinutes);
    const safeFallback = Number.isFinite(fallbackDuration) && fallbackDuration > 0
      ? fallbackDuration
      : DEFAULT_DURATION_MINUTES;

    return normalizeActivityDurations(matchedCourt?.activityType?.scheduleDurations, safeFallback);
  }, [activeCourts, selectedActivityId]);

  const durationOptions = useMemo(() => selectedActivityDurations, [selectedActivityDurations]);

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate, selectedActivityId, clubSlug, selectedDuration);
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

  // --- Verificar autenticación al cargar ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  useEffect(() => {
    if (!router.isReady || queryApplied) return;
    const { date, time, sport } = router.query;
    if (typeof date === 'string') {
      const [y, m, d] = date.split('-').map(Number);
      if (y && m && d) {
        const parsedDate = new Date(y, m - 1, d);
        if (!Number.isNaN(parsedDate.getTime())) {
          setSelectedDate(parsedDate);
        }
      }
    }
    if (typeof time === 'string') {
      setPendingTime(time);
    }
    if (typeof sport === 'string') {
      setPendingSport(sport);
    }
    setQueryApplied(true);
  }, [router.isReady, router.query, queryApplied]);

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

  const bookingAdvanceLimitDays = useMemo(() => {
    const raw = Number(clubConfig?.bookingSimpleAdvanceDaysUser);
    if (!Number.isFinite(raw) || raw < 0) return 30;
    return Math.floor(raw);
  }, [clubConfig?.bookingSimpleAdvanceDaysUser]);

  const maxAllowedDate = useMemo(() => {
    const today = getTodayDate();
    const max = new Date(today);
    max.setDate(max.getDate() + bookingAdvanceLimitDays);
    return max;
  }, [bookingAdvanceLimitDays]);

  useEffect(() => {
    if (!selectedDate) return;
    const today = getTodayDate();
    const clamped = clampToDateRange(selectedDate, today, maxAllowedDate);
    if (clamped.getTime() !== selectedDate.getTime()) {
      setSelectedDate(clamped);
      setSelectedSlot(null);
      setSelectedCourt(null);
    }
  }, [selectedDate, maxAllowedDate]);

  useEffect(() => {
    if (durationOptions.includes(selectedDuration)) return;
    setSelectedDuration(durationOptions[0]);
    setSelectedSlot(null);
    setSelectedCourt(null);
  }, [durationOptions, selectedDuration]);

  // --- LÓGICA DE FILTRADO (Sin cambios) ---
  const filteredSlotsWithCourts = (() => {
    if (!selectedDate) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());

    if (selected < today) return [];
    if (selected.getTime() === today.getTime()) {
      // Backend ya retorna `slotsWithCourts` anclados a `selectedDate`.
      // Solo filtrar los que ya pasaron respecto a `now` sin reinterpretar horas.
      return slotsWithCourts.filter((slotWithCourt) => {
        const [hours, minutes] = slotWithCourt.slotTime.split(':').map(Number);
        const slotDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0, 0);
        return slotDate.getTime() > now.getTime();
      });
    }
    return slotsWithCourts;
  })();

  const availableSlots = useMemo(() => {
    if (!selectedDate) return [] as Array<{ slotTime: string; courts: CourtSummary[] }>;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    return filteredSlotsWithCourts
      .map((slot) => {
        const courtsToShow = (activeCourts.length > 0 ? activeCourts : slot.availableCourts).filter((court) => {
          if (selectedActivityFilter === 'ALL') return true;
          return getCourtActivityName(court as any) === selectedActivityFilter;
        });

        const availableCourts = courtsToShow.filter((court) => {
          const key = `${dateString}-${slot.slotTime}-${court.id}`;
          const isBackendAvailable = slot.availableCourts.some((ac) => ac.id === court.id);
          return !disabledSlots[key] && isBackendAvailable;
        });

        return { slotTime: slot.slotTime, courts: availableCourts };
      })
      .filter((slot) => slot.courts.length > 0);
  }, [filteredSlotsWithCourts, activeCourts, selectedActivityFilter, disabledSlots, selectedDate]);

  useEffect(() => {
    if (!selectedSlot) return;
    const stillAvailable = availableSlots.some((slot) => slot.slotTime === selectedSlot);
    if (!stillAvailable) {
      setSelectedSlot(null);
      setSelectedCourt(null);
    }
  }, [availableSlots, selectedSlot]);

  useEffect(() => {
    if (!selectedDate || !selectedSlot || !selectedCourt?.id) {
      setPriceQuote(null);
      return;
    }

    const bookingActivityId = Number(selectedCourt.activityType?.id || selectedActivityId || 0);
    if (!Number.isFinite(bookingActivityId) || bookingActivityId <= 0) {
      setPriceQuote(null);
      return;
    }

    const guestPayload = !isAuthenticated
      ? {
          guestEmail: guestEmail.trim() || undefined,
          guestPhone: guestPhone.trim() || undefined,
          guestDni: guestDni.trim() || undefined
        }
      : {};

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsQuoteLoading(true);
        const quote = await getBookingQuote({
          courtId: Number(selectedCourt.id),
          activityId: bookingActivityId,
          date: selectedDate,
          slotTime: selectedSlot,
          durationMinutes: selectedDuration,
          ...guestPayload
        });
        if (!cancelled) setPriceQuote(quote);
      } catch {
        if (!cancelled) setPriceQuote(null);
      } finally {
        if (!cancelled) setIsQuoteLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    selectedDate,
    selectedSlot,
    selectedCourt?.id,
    selectedCourt?.activityType?.id,
    selectedActivityId,
    selectedDuration,
    isAuthenticated,
    guestEmail,
    guestPhone,
    guestDni
  ]);

  const getPriceInfo = () => {
    const base = Number(selectedCourt?.price ?? 0);
    const quoteList = Number(priceQuote?.listPrice || 0);
    const quoteFinal = Number(priceQuote?.finalPrice || 0);
    const quoteDiscount = Number(priceQuote?.discountAmount || 0);
    const hasQuote = Boolean(priceQuote && Number.isFinite(quoteFinal) && quoteFinal >= 0);

    if (!selectedDate || !selectedSlot) {
      return {
        base,
        list: hasQuote ? quoteList : base,
        final: hasQuote ? quoteFinal : base,
        extra: 0,
        hasLights: false,
        hasDiscount: hasQuote && quoteDiscount > 0.009,
        discountAmount: hasQuote ? quoteDiscount : 0,
        source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
      };
    }
    if (!Number.isFinite(base) || base <= 0) {
      return {
        base: 0,
        list: hasQuote ? quoteList : 0,
        final: hasQuote ? quoteFinal : 0,
        extra: 0,
        hasLights: false,
        hasDiscount: hasQuote && quoteDiscount > 0.009,
        discountAmount: hasQuote ? quoteDiscount : 0,
        source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
      };
    }
    const cfg = clubConfig;
    if (!cfg || !cfg.lightsEnabled || !cfg.lightsExtraAmount || !cfg.lightsFromHour) {
      return {
        base,
        list: hasQuote ? quoteList : base,
        final: hasQuote ? quoteFinal : base,
        extra: 0,
        hasLights: false,
        hasDiscount: hasQuote && quoteDiscount > 0.009,
        discountAmount: hasQuote ? quoteDiscount : 0,
        source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
      };
    }

    try {
      const [lh, lm] = String(cfg.lightsFromHour).split(':').map((n) => parseInt(n, 10));
      if (Number.isNaN(lh) || Number.isNaN(lm)) {
        return {
          base,
          list: hasQuote ? quoteList : base,
          final: hasQuote ? quoteFinal : base,
          extra: 0,
          hasLights: false,
          hasDiscount: hasQuote && quoteDiscount > 0.009,
          discountAmount: hasQuote ? quoteDiscount : 0,
          source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
        };
      }

      const [sh, sm] = selectedSlot.split(':').map((n) => parseInt(n, 10));
      if (Number.isNaN(sh) || Number.isNaN(sm)) {
        return {
          base,
          list: hasQuote ? quoteList : base,
          final: hasQuote ? quoteFinal : base,
          extra: 0,
          hasLights: false,
          hasDiscount: hasQuote && quoteDiscount > 0.009,
          discountAmount: hasQuote ? quoteDiscount : 0,
          source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
        };
      }

      const slotMinutes = sh * 60 + sm;
      const lightsMinutes = lh * 60 + lm;
      if (slotMinutes >= lightsMinutes) {
        const extra = Number(cfg.lightsExtraAmount);
        const list = base + extra;
        return {
          base,
          list: hasQuote ? quoteList : list,
          final: hasQuote ? quoteFinal : list,
          extra,
          hasLights: true,
          hasDiscount: hasQuote && quoteDiscount > 0.009,
          discountAmount: hasQuote ? quoteDiscount : 0,
          source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
        };
      }
      return {
        base,
        list: hasQuote ? quoteList : base,
        final: hasQuote ? quoteFinal : base,
        extra: 0,
        hasLights: false,
        hasDiscount: hasQuote && quoteDiscount > 0.009,
        discountAmount: hasQuote ? quoteDiscount : 0,
        source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
      };
    } catch {
      return {
        base,
        list: hasQuote ? quoteList : base,
        final: hasQuote ? quoteFinal : base,
        extra: 0,
        hasLights: false,
        hasDiscount: hasQuote && quoteDiscount > 0.009,
        discountAmount: hasQuote ? quoteDiscount : 0,
        source: hasQuote ? ('QUOTE' as const) : ('ESTIMATE' as const)
      };
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

      const bookingActivityId = Number(selectedCourt.activityType?.id || selectedActivityId || 0);
      if (!Number.isFinite(bookingActivityId) || bookingActivityId <= 0) {
        showError('No se pudo identificar la actividad de la cancha seleccionada.');
        return;
      }

      const createResult = await createBooking(
        selectedCourt.id,
        bookingActivityId,
        selectedDate,
        selectedSlot,
        undefined,
        !isAuthenticated ? guestInfo : undefined,
        { durationMinutes: selectedDuration }
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
        
        // 4. LIMPIEZA DE FORMULARIO
        if (!isAuthenticated) {
          setGuestFirstName('');
          setGuestLastName('');
          setGuestEmail('');
          setGuestPhone('');
          setGuestDni(''); // No olvidar limpiar el DNI también
        }
      } catch (_) { /* noop */ }

      showInfo('¡Reserva confirmada! Te esperamos en la cancha.', 'Listo');
    } catch (error: any) {
      showError('Ups: ' + error.message);
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
      setGuestError('Ingresá tu nombre y apellido para reservar como invitado.');
      return;
    }
    if (!dni) {
      setGuestError('El DNI es obligatorio para identificar la reserva.');
      return;
    }
    // Opcional: validar largo mínimo (ej: al menos 7 números)
    if (dni.length < 7) {
      setGuestError('Ingresá un DNI válido (mínimo 7 números).');
       return;
    }
    if (info.email && !isEmailValid(info.email)) {
      setGuestError('Ingresá un email con formato válido.');
      return;
    }
    if (info.phone && !isPhoneValid(info.phone)) {
      setGuestError('Ingresá un teléfono con formato válido.');
      return;
    }
    if (!info.phone) {
      setGuestError('Ingresá un teléfono para poder contactarte.');
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
    const end = new Date(start.getTime() + selectedDuration * 60000);
    return {
      startLabel: formatDateTime(start),
      endLabel: formatDateTime(end)
    };
  })();

  useEffect(() => {
    if (!selectedSlot || !selectedCourt) return;
    confirmButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot, selectedCourt]);

  useEffect(() => {
    if (!selectedSlot) return;
    courtsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot]);

  // --- Cargar Canchas (solo del club cuando hay clubSlug) ---
  useEffect(() => {
    const fetchCourts = async () => {
      try {
        const url = clubSlug
          ? `${apiBase()}/courts?clubSlug=${encodeURIComponent(clubSlug)}`
          : `${apiBase()}/courts`;
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

  useEffect(() => {
    if (!pendingSport || activeCourts.length === 0) return;
    const activityNames = Array.from(
      new Set(activeCourts.map((court) => getCourtActivityName(court)).filter(Boolean))
    );
    const normalizedTarget = normalizeText(pendingSport);
    const matched = activityNames.find((name) => normalizeText(name) === normalizedTarget);
    if (matched) {
      setSelectedActivityFilter(matched);
    }
    setPendingSport(null);
  }, [pendingSport, activeCourts]);

  useEffect(() => {
    if (pendingSport) return;
    if (activeCourts.length === 0) return;

    const uniqueActivities = Array.from(
      new Set(activeCourts.map((court) => getCourtActivityName(court)).filter(Boolean))
    );

    if (uniqueActivities.length === 1 && !selectedActivityFilter) {
      setSelectedActivityFilter(uniqueActivities[0]);
    }
  }, [activeCourts, pendingSport, selectedActivityFilter]);

  useEffect(() => {
    if (!pendingTime || availableSlots.length === 0) return;
    const slot = availableSlots.find((item) => item.slotTime === pendingTime);
    if (slot) {
      setSelectedSlot(pendingTime);
      setPendingTime(null);
    }
  }, [pendingTime, availableSlots]);

  // --- CORRECCIÓN MEMORIA ZOMBIE (Sincronizar backend con frontend) ---
  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    setDisabledSlots((prev) => {
      const nextState = { ...prev }; // Copiamos el estado actual

      slotsWithCourts.forEach((slot) => {
        const availableIds = new Set(slot.availableCourts.map((c) => c.id));
        const courtsToInspect = activeCourts.length > 0 ? activeCourts : slot.availableCourts;

        courtsToInspect.forEach((court) => {
          const key = `${dateString}-${slot.slotTime}-${court.id}`;

          if (!availableIds.has(court.id)) {
            // El backend dice que NO está disponible -> lo bloqueamos
            nextState[key] = true;
          } else {
            // Si el backend dice que está libre, borramos el bloqueo local
            delete nextState[key]; 
          }
        });
      });

      return nextState;
    });
  }, [slotsWithCourts, activeCourts, selectedDate]);

  // 1. Evitar ir al pasado
  const isPrevDisabled = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = new Date(selectedDate);
    current.setHours(0, 0, 0, 0);
    return current <= today;
  };

  // 2. Retroceder un día
  const handlePrevDay = () => {
    if (isPrevDisabled()) return; // Por seguridad
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  // 3. Avanzar un día
  const isNextDisabled = () => {
    if (!selectedDate) return true;
    const current = new Date(selectedDate);
    current.setHours(0, 0, 0, 0);
    const max = new Date(maxAllowedDate);
    max.setHours(0, 0, 0, 0);
    return current >= max;
  };

  const handleNextDay = () => {
    if (isNextDisabled()) return;
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  // 4. Formatear la fecha para que se vea como "18 FEB 2026"
  // Reemplazá el formattedDate anterior por esto:
  const getFormattedDate = (date: Date) => {
  const weekDays = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  const weekDayName = weekDays[date.getDay()];
  
  const day = date.getDate().toString().padStart(2, '0');
  const monthNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  
  return `${weekDayName} ${day} ${month} ${year}`;
};

  const availableActivities = useMemo(() => {
    const allNames = activeCourts
      .map((court) => getCourtActivityName(court))
      .filter(Boolean);
    return Array.from(new Set(allNames));
  }, [activeCourts]);

  useEffect(() => {
    if (availableActivities.length === 1 && !selectedActivityFilter) {
      setSelectedActivityFilter(availableActivities[0]);
    }
  }, [availableActivities, selectedActivityFilter]);

  // --- RENDERIZADO VISUAL ---
  // --- RENDERIZADO VISUAL ---
  return (
    <div className="w-full max-w-4xl mx-auto bg-[#EBE1D8] p-6 sm:p-8 rounded-[2rem] shadow-2xl shadow-[#347048]/50 border-4 border-[#d4c5b0]/50 relative overflow-hidden">
    
      <div className="text-center mb-8">
        <h2 className="text-4xl font-black text-[#926699] mb-2 tracking-tighter uppercase italic">Reservar Cancha</h2>
        <p className="text-[#347048] font-bold text-sm tracking-wide opacity-80">Elige tu día y horario ideal</p>
      </div>

      <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* COLUMNA 1: Tipo de Cancha */}
        <div className="relative focus-within:z-[100] z-20">
          <label className="block text-[10px] font-black text-[#926699] mb-2 ml-1 flex items-center gap-2 uppercase tracking-widest">
            <span className="text-[#B9CF32]"><Activity size={16} strokeWidth={3} /></span>
            <span>Tipo de cancha</span>
          </label>
          <CustomSelect 
              value={selectedActivityFilter}
              onChange={(val: string) => {
                setSelectedActivityFilter(val);
                setSelectedSlot(null);
                setSelectedCourt(null);
              }}
              placeholder="Seleccioná un deporte"
              options={availableActivities.map((activityName) => ({
                value: activityName,
                label: activityName
              }))}
          />
        </div>

        {/* CONTENEDOR DE FECHA (Formato Input Blanco) */}
        <div className="flex flex-col gap-2 w-full">
          
          {/* ETIQUETA SUPERIOR (Igual a los otros campos) */}
          <label className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#8A5B96]">
            <Calendar className="w-4 h-4 text-[#B9CF32]" strokeWidth={2.5} />
            Fecha
          </label>

          {/* CAJA BLANCA (El "Input" interactivo) */}
          <div className="flex items-center justify-between bg-white rounded-xl px-2 py-2.5 border border-transparent shadow-sm h-[46px]">
            
            {/* Botón Atrás */}
            <button
              type="button"
              onClick={handlePrevDay}
              disabled={isPrevDisabled()}
              className="p-1 rounded-lg text-[#347048] disabled:opacity-20 hover:bg-[#347048]/10 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* Texto de Fecha Fijo */}
            <span className="text-[15px] font-bold text-[#347048] min-w-[100px] text-center whitespace-nowrap">
              {getFormattedDate(selectedDate)}
            </span>

            {/* Botón Adelante */}
            <button
              type="button"
              onClick={handleNextDay}
              disabled={isNextDisabled()}
              className="p-1 rounded-lg text-[#347048] disabled:opacity-20 hover:bg-[#347048]/10 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

          </div>
        </div>

        {/* COLUMNA 3: Duración */}
        <div className="relative focus-within:z-[80] z-10">
          <label className="block text-[10px] font-black text-[#926699] mb-2 ml-1 flex items-center gap-2 uppercase tracking-widest">
            <span className="text-[#B9CF32]"><Clock size={16} strokeWidth={3} /></span>
            <span>Duración</span>
          </label>
          <CustomSelect
            value={selectedDuration}
            onChange={(val: number) => {
              const nextDuration = Number(val);
              setSelectedDuration(nextDuration);
              setSelectedSlot(null);
              setSelectedCourt(null);
            }}
            placeholder="Duración"
            options={durationOptions.map((duration) => ({
              value: duration,
              label: `${duration} min`
            }))}
          />
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#347048]"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-center mb-6 flex items-center justify-center gap-2 font-bold text-sm shadow-sm">
           <AlertCircle size={18} strokeWidth={2.5} /> {error}
        </div>
      )}

      {!loading && availableSlots.length > 0 && (
        <div className="mb-10">
          <label className="block text-xs font-black text-[#926699] mb-4 ml-1 flex items-center gap-2 uppercase tracking-wider">
            <span className="text-[#B9CF32]"><Clock size={20} strokeWidth={3} /></span>
            <span>Horarios Disponibles</span>
          </label>

          {!selectedActivityFilter ? (
            <div className="text-center py-10 bg-[#347048]/5 rounded-2xl border border-dashed border-[#347048]/20 text-[#347048]/60 font-bold">
              Elegí un deporte para ver los horarios disponibles.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlot === slot.slotTime;
                  return (
                    <button
                      key={slot.slotTime}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot.slotTime);
                        setSelectedCourt(null);
                      }}
                      className={`py-3 rounded-xl text-sm font-black transition-all duration-200 border-2 ${
                        isSelected
                          ? 'bg-[#B9CF32] text-[#347048] border-[#B9CF32] shadow-lg'
                          : 'bg-white text-[#347048] border-[#347048]/10 hover:border-[#B9CF32] hover:text-[#B9CF32]'
                      }`}
                    >
                      {slot.slotTime}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">
                Solo estás viendo horarios con turnos disponibles.
              </div>
            </>
          )}
        </div>
      )}

      {selectedSlot && (
        <div ref={courtsSectionRef} className="mb-10">
          <label className="block text-xs font-black text-[#926699] mb-4 ml-1 flex items-center gap-2 uppercase tracking-wider">
            <span className="text-[#B9CF32]"><MapPin size={20} strokeWidth={3} /></span>
            <span>Reservar una cancha</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(availableSlots.find((slot) => slot.slotTime === selectedSlot)?.courts || []).map((court) => {
              if (!selectedDate) return null;
              const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
                selectedDate.getDate()
              ).padStart(2, '0')}`;
              const slotKey = `${dateString}-${selectedSlot}-${court.id}`;

              const handleSelectCourt = async () => {
                if (!selectedDate || !selectedSlot) return;
                const currentSlot = availableSlots.find((slot) => slot.slotTime === selectedSlot);
                // `availableSlots` ya contiene solo las canchas disponibles para ese horario
                const availableCourtIds = new Set((currentSlot?.courts || []).map((c) => c.id));
                if (!availableCourtIds.has(court.id)) {
                  setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                  showError('Cancha ya no disponible.');
                  return;
                }
                setSelectedCourt(court);
              };

              const isSelected = selectedCourt?.id === court.id;

              return (
                <button
                  key={court.id}
                  type="button"
                  onClick={handleSelectCourt}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all shadow-sm ${
                    isSelected
                      ? 'bg-[#B9CF32]/20 border-[#B9CF32] text-[#347048] shadow-lg'
                      : 'bg-white border-[#347048]/10 text-[#347048] hover:border-[#B9CF32]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-black uppercase tracking-wide">{court.name}</div>
                      <div className="text-[11px] text-[#347048]/60 font-bold">
                        {court.price ? `$${court.price} · ${selectedDuration} min` : 'Precio a confirmar'}
                      </div>
                    </div>
                    <div className={`h-3 w-3 rounded-full ${isSelected ? 'bg-[#B9CF32]' : 'bg-[#347048]/20'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && selectedActivityFilter && availableSlots.length === 0 && selectedDate && (
        <div className="text-center py-12 bg-[#347048]/5 rounded-2xl border border-dashed border-[#347048]/20 mb-8 flex items-center justify-center gap-3 text-[#347048]/60 font-bold">
            {(() => {
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
              if (selected < today) return <><Hourglass size={20} strokeWidth={2.5} /> <span>No se puede viajar al pasado...</span></>;
              else if (selected.getTime() === today.getTime() && slotsWithCourts.length > 0) return <><Moon size={20} strokeWidth={2.5} /> <span>Ya no quedan turnos por hoy.</span></>;
              else return <><Ban size={20} strokeWidth={2.5} /> <span>No hay canchas disponibles para esta fecha.</span></>;
            })()}
        </div>
      )}

      <button
        ref={confirmButtonRef}
        onClick={handleBooking}
        disabled={isBooking || !selectedSlot || !selectedCourt}
        className={`w-full py-4 rounded-2xl font-black text-lg uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2
            ${(isBooking || !selectedSlot || !selectedCourt) 
                ? 'bg-[#347048]/10 text-[#347048]/40 cursor-not-allowed border border-[#347048]/5' 
                : 'bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] hover:-translate-y-1 hover:shadow-[#B9CF32]/30'}`}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
            <span className="mt-[2px]">Procesando...</span>
          </>
        ) : (isBooking || !selectedSlot || !selectedCourt) ? (
            <>
              <MousePointerClick size={20} strokeWidth={2.5} className="opacity-50" />
              <span className="opacity-50 mt-[2px]">Selecciona Turno</span>
            </>
        ) : !isAuthenticated ? (
            <>
                <Zap size={20} strokeWidth={2.5} className="text-[#B9CF32] animate-pulse" />
                <span className="mt-[2px]">CONFIRMAR RESERVA</span>
            </>
        ) : selectedSlot && selectedCourt ? (
          <>
            <Zap size={20} strokeWidth={2.5} className="text-[#B9CF32] animate-pulse" />
            <span className="mt-[2px]">CONFIRMAR RESERVA</span>
          </>
        ) : (
          <>
            <MousePointerClick size={20} strokeWidth={2.5} className="opacity-50" />
            <span className="opacity-50 mt-[2px]">Selecciona Turno</span>
          </>
        )}
      </button>

      {selectedSlot && selectedCourt && (
        <div className="mt-2 text-xs text-[#347048]/80 text-center font-medium">
          {priceInfo.source === 'QUOTE' ? (
            <>
              Precio final: <span className="font-black text-[#347048] text-base">${priceInfo.final.toLocaleString()}</span>{' '}
              {priceInfo.hasDiscount ? (
                <span className="ml-1 text-[11px]">
                  (lista ${priceInfo.list.toLocaleString()} | descuento ${priceInfo.discountAmount.toLocaleString()})
                </span>
              ) : null}
            </>
          ) : priceInfo.hasLights && clubConfig ? (
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
          {isQuoteLoading && (
            <div className="text-[11px] text-[#347048]/50 mt-1">Actualizando precio final...</div>
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
                  <span className="font-bold text-[#926699] uppercase text-xs">{priceInfo.source === 'QUOTE' ? 'Precio final:' : 'Precio:'}</span>
                  <span className="text-[#347048] font-black text-lg">
                    ${priceInfo.final.toLocaleString()}
                  </span>
                </div>
                {priceInfo.source === 'QUOTE' && priceInfo.hasDiscount && (
                  <div className="flex items-center justify-between text-xs text-[#347048]/60">
                    <span>Lista / descuento:</span>
                    <span>
                      ${priceInfo.list.toLocaleString()} / ${priceInfo.discountAmount.toLocaleString()}
                    </span>
                  </div>
                )}
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
                    placeholder="Nombre"
                    value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)}
                    onKeyDown={handleGuestKeyDown}
                    className="w-full p-3 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-[#347048]/40 focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                  />
                </div>
                <div className="relative">
                  <input
                    id="guest-last-name"
                    type="text"
                    placeholder="Apellido"
                    value={guestLastName}
                    onChange={(e) => setGuestLastName(e.target.value)}
                    onKeyDown={handleGuestKeyDown}
                    className="w-full p-3 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-[#347048]/40 focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                  />
                </div>
                <div className="relative col-span-1 sm:col-span-2">
                <input
                  id="guest-dni"
                  type="text"
                  placeholder="DNI"
                  value={guestDni}
                  onChange={(e) => {
                    const soloNumeros = e.target.value.replace(/\D/g, '');
                    setGuestDni(soloNumeros);
                  }}
                  onKeyDown={handleGuestKeyDown}
                  className="w-full p-3 rounded-xl border border-[#347048]/20 bg-white text-[#347048] placeholder:text-[#347048]/40 focus:outline-none focus:border-[#B9CF32] focus:ring-0 transition-colors font-bold shadow-sm"
                />
              </div>
              </div>
              <div className="relative flex items-center rounded-xl border border-[#347048]/20 bg-white focus-within:border-[#B9CF32] transition-colors shadow-sm">
                <span className="px-3 text-[#347048]/60 font-bold whitespace-nowrap min-w-[3.25rem] text-center leading-none">
                  +54&nbsp;9
                </span>
                <input
                  id="guest-phone"
                  type="tel"
                  placeholder="351 123 4567"
                  value={formatPhoneDigits(guestPhone)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setGuestPhone(digits);
                  }}
                  onKeyDown={handleGuestKeyDown}
                  maxLength={12}
                  className="w-full p-3 rounded-xl bg-transparent text-[#347048] placeholder:text-[#347048]/40 focus:outline-none transition-colors font-bold border-0 focus:border-0 leading-tight"
                />
              </div>
            </div>
            
            {/* Feedback de error con ícono de alerta */}
            {guestError && (
              <p className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded-lg text-center flex items-center justify-center gap-1">
                 <AlertCircle size={14} strokeWidth={2.5}/> {guestError}
              </p>
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
