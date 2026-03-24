"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';
import { AUTH_LOGIN_EVENT, AUTH_LOGOUT_EVENT, getToken, login as loginUser } from '../services/AuthService';
import AppModal from './AppModal';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService, Club } from '../services/ClubService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
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
  basePrice?: number | null;
  lightsExtraApplied?: number | null;
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
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const courtsSectionRef = useRef<HTMLDivElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: ReactNode;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmDisabled?: boolean;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    blockManualClose?: boolean;
  }>({ show: false });
  const pendingAfterLoginActionRef = useRef<null | (() => void)>(null);
  const [loginModalEmail, setLoginModalEmail] = useState('');
  const [loginModalPassword, setLoginModalPassword] = useState('');
  const [loginModalError, setLoginModalError] = useState('');
  const [loginModalLoading, setLoginModalLoading] = useState(false);

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false }));
    setLoginModalError('');
    setLoginModalLoading(false);
    pendingAfterLoginActionRef.current = null;
  };

  const showInfo = (message: ReactNode, title = 'Información') => {
    setModalState({
      show: true,
      title,
      message,
      cancelText: '',
      confirmText: 'OK',
      onConfirm: closeModal,
      closeOnBackdrop: true,
      closeOnEscape: true,
      blockManualClose: false
    });
  };

  const showError = (message: ReactNode) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar',
      onConfirm: closeModal,
      closeOnBackdrop: true,
      closeOnEscape: true,
      blockManualClose: false
    });
  };

  const openLoginModal = (afterLoginAction?: () => void) => {
    pendingAfterLoginActionRef.current = afterLoginAction || null;
    setLoginModalError('');
    setLoginModalLoading(false);

    const loginMessage = (
      <div className="space-y-3">
        <p className="text-sm text-[#347048]/80">Iniciá sesión para confirmar tu reserva sin salir de esta pantalla.</p>
        {loginModalError ? (
          <div className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {loginModalError}
          </div>
        ) : null}
        <div className="space-y-2">
          <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Email</label>
          <input
            type="email"
            value={loginModalEmail}
            onChange={(e) => setLoginModalEmail(e.target.value)}
            className="w-full rounded-xl border-2 border-[#347048]/15 bg-white px-3 py-2 text-sm font-bold text-[#347048] outline-none focus:border-[#B9CF32]"
            placeholder="tu@email.com"
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Contraseña</label>
          <input
            type="password"
            value={loginModalPassword}
            onChange={(e) => setLoginModalPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loginModalLoading) {
                e.preventDefault();
                void handleLoginFromModal();
              }
            }}
            className="w-full rounded-xl border-2 border-[#347048]/15 bg-white px-3 py-2 text-sm font-bold text-[#347048] outline-none focus:border-[#B9CF32]"
            placeholder="********"
            autoComplete="current-password"
          />
        </div>
      </div>
    );

    setModalState({
      show: true,
      title: 'Iniciar sesión',
      message: loginMessage,
      cancelText: '',
      confirmText: loginModalLoading ? 'Ingresando...' : 'Ingresar',
      onConfirm: () => {
        void handleLoginFromModal();
      },
      onCancel: undefined,
      confirmDisabled: loginModalLoading || !String(loginModalEmail).trim() || !String(loginModalPassword).trim(),
      closeOnBackdrop: false,
      closeOnEscape: false,
      blockManualClose: true
    });
  };

  const handleLoginFromModal = async () => {
    if (loginModalLoading) return;
    setLoginModalLoading(true);
    setLoginModalError('');
    try {
      await loginUser(String(loginModalEmail).trim(), String(loginModalPassword));
      setIsAuthenticated(true);
      setModalState((prev) => ({ ...prev, show: false }));
      const pendingAction = pendingAfterLoginActionRef.current;
      pendingAfterLoginActionRef.current = null;
      if (pendingAction) pendingAction();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo iniciar sesión.');
      setLoginModalError(message);
      reportUiError({ area: 'BookingGrid', action: 'loginModalSubmit' }, error);
    } finally {
      setLoginModalLoading(false);
    }
  };

  useEffect(() => {
    if (!modalState.show || modalState.title !== 'Iniciar sesión') return;
    openLoginModal(pendingAfterLoginActionRef.current || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginModalEmail, loginModalPassword, loginModalError, loginModalLoading]);

  const buildBookingSummaryMessage = (params: {
    courtName: string;
    activityName: string;
    start: Date;
    end: Date;
    durationMinutes: number;
    price: number;
    listPrice?: number;
    discountAmount?: number;
    nightSurcharge?: {
      applied: boolean;
      amount: number;
      fromHour?: string | null;
    };
  }) => (
    <div className="space-y-3">
      <p className="text-sm text-[#347048]/80">Tu reserva fue registrada con éxito.</p>
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#926699]/20 bg-[#fdfaff] p-3 text-sm text-[#347048]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Cancha:</span>
          <span className="text-[#347048] font-black">{params.courtName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Actividad:</span>
          <span className="text-[#347048] font-black">{params.activityName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Fecha:</span>
          <span className="text-[#347048] font-black">
            {params.start.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Horario:</span>
          <span className="text-[#347048] font-black">
            {params.start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
            {' - '}
            {params.end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Duración:</span>
          <span className="text-[#347048] font-black">{params.durationMinutes} min</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Precio:</span>
          <span className="text-[#347048] font-black text-lg">${params.price.toLocaleString()}</span>
        </div>
        {Number(params.discountAmount || 0) > 0.009 ? (
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Descuento:</span>
            <span className="text-[#347048] font-black">
              -${Number(params.discountAmount || 0).toLocaleString()}
              {Number(params.listPrice || 0) > 0.009 ? ` (lista $${Number(params.listPrice || 0).toLocaleString()})` : ''}
            </span>
          </div>
        ) : null}
        {params.nightSurcharge?.applied ? (
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Recargo nocturno:</span>
            <span className="text-[#347048] font-black">
              +${Number(params.nightSurcharge.amount || 0).toLocaleString()}
              {params.nightSurcharge.fromHour ? ` (desde ${params.nightSurcharge.fromHour})` : ''}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
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

  const { slotsWithCourts, loading, error, refresh } = useAvailability(
    selectedDate,
    selectedActivityId,
    clubSlug,
    selectedDuration
  );

  const durationOptions = useMemo(() => {
    return selectedActivityDurations;
  }, [selectedActivityDurations]);
  // --- Sincronizar autenticación en vivo ---
  useEffect(() => {
    const syncAuth = () => {
      setIsAuthenticated(Boolean(getToken()));
    };
    syncAuth();
    window.addEventListener(AUTH_LOGIN_EVENT, syncAuth);
    window.addEventListener(AUTH_LOGOUT_EVENT, syncAuth);
    window.addEventListener('storage', syncAuth);
    return () => {
      window.removeEventListener(AUTH_LOGIN_EVENT, syncAuth);
      window.removeEventListener(AUTH_LOGOUT_EVENT, syncAuth);
      window.removeEventListener('storage', syncAuth);
    };
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
        reportUiError({ area: 'BookingGrid', action: 'loadClubConfig' }, err);
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
        const courtsToShow = slot.availableCourts;

        const availableCourts = courtsToShow.filter((court) => {
          const key = `${dateString}-${slot.slotTime}-${court.id}`;
          return !disabledSlots[key];
        });

        return { slotTime: slot.slotTime, courts: availableCourts };
      })
      .filter((slot) => slot.courts.length > 0);
  }, [filteredSlotsWithCourts, disabledSlots, selectedDate]);

  useEffect(() => {
    if (!selectedSlot) return;
    const stillAvailable = availableSlots.some((slot) => slot.slotTime === selectedSlot);
    if (!stillAvailable) {
      setSelectedSlot(null);
      setSelectedCourt(null);
    }
  }, [availableSlots, selectedSlot]);

  const priceInfo = useMemo(() => {
    const final = Number(selectedCourt?.price ?? 0);
    const base = Number(selectedCourt?.basePrice ?? final);
    const extra = Number(selectedCourt?.lightsExtraApplied ?? 0);
    return {
      base: Number.isFinite(base) ? base : 0,
      list: Number.isFinite(final) ? final : 0,
      final: Number.isFinite(final) ? final : 0,
      extra: Number.isFinite(extra) ? extra : 0,
      hasLights: Number(extra) > 0.009,
      hasDiscount: false,
      discountAmount: 0,
      source: 'SERVER' as const
    };
  }, [selectedCourt?.price, selectedCourt?.basePrice, selectedCourt?.lightsExtraApplied]);

const performBooking = async () => {
    
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    
    try {
      setIsBooking(true);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      const bookingDateTime = new Date(year, month, day, hours, minutes, 0, 0);

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
        { durationMinutes: selectedDuration, applyDiscount: false }
      );
      const startDateTime = bookingDateTime;
      const endDateTime = new Date(startDateTime.getTime() + selectedDuration * 60000);
      const fallbackPrice = Number(priceInfo.final || 0);
      const fallbackListPrice = Number(priceInfo.list || fallbackPrice || 0);
      const parsedCreatedPrice = Number((createResult as any)?.price);
      const parsedCreatedListPrice = Number((createResult as any)?.listPrice);
      const finalPrice = Number.isFinite(parsedCreatedPrice) && parsedCreatedPrice >= 0 ? parsedCreatedPrice : fallbackPrice;
      const listPrice = Number.isFinite(parsedCreatedListPrice) && parsedCreatedListPrice > 0
        ? parsedCreatedListPrice
        : fallbackListPrice;
      const discountAmount = Math.max(0, Number((listPrice - finalPrice).toFixed(2)));
      const bookingSummaryMessage = buildBookingSummaryMessage({
        courtName: String(selectedCourt.name || `Cancha ${selectedCourt.id}`),
        activityName: String(selectedCourt.activityType?.name || selectedActivityFilter || 'Actividad'),
        start: startDateTime,
        end: endDateTime,
        durationMinutes: selectedDuration,
        price: finalPrice,
        listPrice,
        discountAmount,
        nightSurcharge: {
          applied: Boolean(priceInfo.hasLights),
          amount: Number(priceInfo.extra || 0),
          fromHour: clubConfig?.lightsFromHour || null
        }
      });

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
      } catch (_) { /* noop */ }

      showInfo(bookingSummaryMessage, 'Reserva confirmada');
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo completar la reserva.');
      reportUiError({ area: 'BookingGrid', action: 'handleBooking' }, error);
      if (String(message).toLowerCase().includes('sesión expirada') || String(message).toLowerCase().includes('sesion expirada')) {
        setIsAuthenticated(false);
        openLoginModal(() => {
          performBooking();
        });
        return;
      }
      showError(message);
    } finally {
      setIsBooking(false);
    }
  };

  const handleBooking = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    const hasSession = Boolean(getToken());
    if (!hasSession || !isAuthenticated) {
      setIsAuthenticated(false);
      openLoginModal(() => {
        performBooking();
      });
      return;
    }
    setIsAuthenticated(true);
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
      reportUiError({ area: 'BookingGrid', action: 'loadDisabledSlotsFromStorage' }, err);
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
      reportUiError({ area: 'BookingGrid', action: 'saveDisabledSlotsToStorage' }, err);
    }
  }, [disabledSlots, selectedDate]);

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
        if (!res.ok) {
          showError('No se pudieron cargar las canchas disponibles. Reintentá en unos segundos.');
          return;
        }
        const data = await res.json();
        setAllCourts(data);
      } catch (err) {
        reportUiError({ area: 'BookingGrid', action: 'loadCourts' }, err);
        showError('No se pudieron cargar las canchas disponibles. Reintentá en unos segundos.');
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
          Precio:{' '}
          <span className="font-black text-[#347048] text-base">
            ${priceInfo.final.toLocaleString()}
          </span>
          {priceInfo.hasDiscount ? (
            <span className="ml-1 text-[11px]">
              (lista ${priceInfo.list.toLocaleString()} | descuento ${priceInfo.discountAmount.toLocaleString()})
            </span>
          ) : priceInfo.hasLights && clubConfig ? (
            <span className="ml-1 text-[11px]">
              (incluye extra por luces de ${priceInfo.extra.toLocaleString()}
              {clubConfig.lightsFromHour ? ` desde las ${clubConfig.lightsFromHour}` : ''})
            </span>
          ) : null}
        </div>
      )}

      <AppModal
        show={modalState.show}
        onClose={modalState.blockManualClose ? () => {} : closeModal}
        onCancel={modalState.onCancel}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        onConfirm={modalState.onConfirm}
        confirmDisabled={modalState.confirmDisabled}
        isWarning={modalState.isWarning}
        closeOnBackdrop={modalState.closeOnBackdrop ?? true}
        closeOnEscape={modalState.closeOnEscape ?? true}
        hideCloseButton={Boolean(modalState.blockManualClose)}
      />

    </div>
  );
}
