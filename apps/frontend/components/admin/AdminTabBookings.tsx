import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  getAdminSchedule,
  cancelBooking,
  createBooking,
  createFixedBooking,
  cancelFixedBooking,
  getBookingById,
  searchClients,
  getBookingFinancialSummary
} from '../../services/BookingService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { ClubService } from '../../services/ClubService';
import AppModal from '../AppModal';
import BookingManagerModal from './BookingManagerModal';
import { useParams } from 'react-router-dom';
import { useRouter } from 'next/router';
import DatePickerDark from '../../components/ui/DatePickerDark';
import { Trash2, Check, Calendar as CalendarIcon, RefreshCw, ChevronDown, CalendarPlus, Repeat, X, Phone, IdCard, ChevronLeft, ChevronRight } from 'lucide-react'; 
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { formatTime24 } from '../../utils/dateTime';
import { reportUiError } from '../../utils/uiError';
import { lockBodyScroll } from '../../utils/bodyScrollLock';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { buildCanonicalPhone, DEFAULT_PHONE_COUNTRY_ISO2, normalizePhoneCountryIso2, PHONE_COUNTRY_OPTIONS, splitCanonicalPhone } from '../../utils/phone';
import type { RefundDraft } from '../../modules/refunds/refund.types';
import { buildDefaultRefundDraft } from '../../modules/refunds/refund.policy';
import { validateRefundAmountInput } from '../../modules/refunds/refund.validators';
import RefundRequestModal from './refunds/RefundRequestModal';

const CLUB_TIME_SLOTS = [
  '08:00', '09:30', '11:00', '12:30',
  '14:00', '15:30', '17:30', '19:00',
  '20:30', '22:00'
];

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

// Layout constants
const HEADER_HEIGHT = 52; // px reserved for court names header
const ROW_HEIGHT = 84; // px per hour row
const H_GAP_PX = 10; // horizontal gap between booking cards (px)
const V_GAP_PX = 8; // vertical gap between booking cards (px)

const toMinutes = (timeValue?: string | null) => {
  if (!timeValue) return null;
  const [hh, mm] = String(timeValue).split(':').map((value) => Number(value));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
};

const resolveNightSurcharge = (startDate: Date, courtLike: any) => {
  const settings = courtLike?.club?.settings;
  const lightsEnabled = Boolean(settings?.lightsEnabled);
  const lightsExtraAmount = Number(settings?.lightsExtraAmount || 0);
  const lightsFromHour = String(settings?.lightsFromHour || '').trim();
  if (!lightsEnabled || !Number.isFinite(lightsExtraAmount) || lightsExtraAmount <= 0 || !lightsFromHour) {
    return { applied: false, amount: 0, fromHour: null as string | null };
  }
  const threshold = toMinutes(lightsFromHour);
  if (threshold == null) return { applied: false, amount: 0, fromHour: null as string | null };
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  if (startMinutes < threshold) return { applied: false, amount: 0, fromHour: lightsFromHour };
  return { applied: true, amount: lightsExtraAmount, fromHour: lightsFromHour };
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
const ModalPortal = ({
  children,
  onClose,
  maxWidthClass = 'max-w-xl'
}: {
  children: ReactNode;
  onClose: () => void;
  maxWidthClass?: string;
}) => {
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const releaseBodyScrollLock = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      releaseBodyScrollLock();
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  
  return createPortal(
  <div
    className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-[#347048]/60 p-4 animate-in fade-in duration-200"
    onMouseDown={(event) => {
      backdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onTouchStart={(event) => {
      backdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onClick={(event) => {
      const startedOnBackdrop = backdropMouseDownRef.current;
      backdropMouseDownRef.current = false;
      if (startedOnBackdrop && event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
      <div
        className={`relative z-10 w-full ${maxWidthClass} bg-[#EBE1D8] border-4 border-white rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 overflow-hidden text-[#347048]`}
        onClick={(event) => event.stopPropagation()}
      >
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

const parseLocalDate = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
};

const getFormattedDateLabel = (date: Date) => {
  const weekDays = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
  const monthNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const weekDayName = weekDays[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${weekDayName} ${day} ${month} ${year}`;
};

type CancelRefundDecision = {
  refund?: {
    amount?: number;
    executeNow?: boolean;
    reasonType?: 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
    executionNotes?: string;
  };
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
      if (!status) return 'Pendiente';
      return status
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
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
      if (!status) return 'Pendiente';
      return status
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString()}`;
const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function AdminTabBookings() {
  const router = useRouter();
  const [bookingPanelView, setBookingPanelView] = useState<'create' | 'agenda'>(() => {
    if (typeof window === 'undefined') return 'agenda';
    const stored = window.localStorage.getItem('admin-bookings-panel-view');
    return stored === 'create' ? 'create' : 'agenda';
  });
  const [courts, setCourts] = useState<any[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => getTodayLocalDate());
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedBookingDetail, setSelectedBookingDetail] = useState<{ booking: any; slotTime: string; courtName?: string } | null>(null);
  const openedFromQueryRef = useRef<number | null>(null);
  const [showCancelRefundModal, setShowCancelRefundModal] = useState(false);
  const [cancelRefundPaidAmount, setCancelRefundPaidAmount] = useState(0);
  const [cancelRefundDraft, setCancelRefundDraft] = useState<RefundDraft>(() => buildDefaultRefundDraft('BOOKING_CANCELLATION', 0));
  const cancelRefundResolverRef = useRef<((value: CancelRefundDecision | null) => void) | null>(null);
  const params = useParams();
  const urlSlug = params.slug;
  const [clubBookingConfig, setClubBookingConfig] = useState<{
    bookingSimpleAdvanceDaysAdmin: number;
    allowAdminSkipSimpleAdvanceLimit: boolean;
    professorDurationOverrideEnabled: boolean;
    professorDurationOverrideMinutes: number;
  }>({
    bookingSimpleAdvanceDaysAdmin: 30,
    allowAdminSkipSimpleAdvanceLimit: false,
    professorDurationOverrideEnabled: true,
    professorDurationOverrideMinutes: DEFAULT_DURATION_MINUTES
  });

  const [manualBooking, setManualBooking] = useState({
    clientId: '',
    clientFirstName: '',
    clientLastName: '',
    clientPhoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    clientPhone: '',
    clientDni: '',
    courtId: '',
    time: '',
    durationMinutes: DEFAULT_DURATION_MINUTES,
    isFixed: false,
    dayOfWeek: '1',
    startDateBase: getTodayLocalDate()
  });
  const [selectedClientIsProfessor, setSelectedClientIsProfessor] = useState(false);
  const [clubPhoneCountryIso2, setClubPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('admin-bookings-panel-view', bookingPanelView);
  }, [bookingPanelView]);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);

  const selectedManualCourt = useMemo(
    () => courts.find((court) => String(court.id) === String(manualBooking.courtId)) ?? null,
    [courts, manualBooking.courtId]
  );

  const selectedActivityDurations = useMemo(() => {
    const defaultDuration = Number(selectedManualCourt?.activityType?.defaultDurationMinutes);
    const safeDefaultDuration = Number.isFinite(defaultDuration) && defaultDuration > 0
      ? defaultDuration
      : DEFAULT_DURATION_MINUTES;

    return normalizeActivityDurations(selectedManualCourt?.activityType?.scheduleDurations, safeDefaultDuration);
  }, [selectedManualCourt]);

  const manualDurationOptions = useMemo(() => {
    const options = selectedActivityDurations;
    const professorDurationOverride = Number(clubBookingConfig.professorDurationOverrideMinutes);
    const canUseProfessorOverride =
      selectedClientIsProfessor &&
      Boolean(clubBookingConfig.professorDurationOverrideEnabled) &&
      Number.isFinite(professorDurationOverride) &&
      professorDurationOverride > 0;

    if (canUseProfessorOverride && !options.includes(professorDurationOverride)) {
      return [professorDurationOverride, ...options];
    }
    return options;
  }, [selectedClientIsProfessor, selectedActivityDurations, clubBookingConfig.professorDurationOverrideEnabled, clubBookingConfig.professorDurationOverrideMinutes]);

  const adminSimpleMaxDate = useMemo(() => {
    if (clubBookingConfig.allowAdminSkipSimpleAdvanceLimit) return null;
    const today = parseLocalDate(getTodayLocalDate());
    today.setHours(0, 0, 0, 0);
    const max = new Date(today);
    max.setDate(max.getDate() + Math.max(0, Math.floor(Number(clubBookingConfig.bookingSimpleAdvanceDaysAdmin || 0))));
    return max;
  }, [clubBookingConfig]);

  const clampSimpleBookingDate = useCallback((date: Date) => {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    const today = parseLocalDate(getTodayLocalDate());
    today.setHours(0, 0, 0, 0);
    if (next < today) return today;
    if (adminSimpleMaxDate && next > adminSimpleMaxDate) return new Date(adminSimpleMaxDate);
    return next;
  }, [adminSimpleMaxDate]);

  const isManualPrevDisabled = () => {
    const today = parseLocalDate(getTodayLocalDate());
    today.setHours(0, 0, 0, 0);
    const current = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
    current.setHours(0, 0, 0, 0);
    return current <= today;
  };

  const isManualNextDisabled = () => {
    if (manualBooking.isFixed) return false;
    if (!adminSimpleMaxDate) return false;
    const current = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
    current.setHours(0, 0, 0, 0);
    const max = new Date(adminSimpleMaxDate);
    max.setHours(0, 0, 0, 0);
    return current >= max;
  };

  const handleManualPrevDay = () => {
    if (isManualPrevDisabled()) return;
    const prev = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
    prev.setDate(prev.getDate() - 1);
    setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(prev) });
  };

  const handleManualNextDay = () => {
    if (isManualNextDisabled()) return;
    const next = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
    next.setDate(next.getDate() + 1);
    const normalized = manualBooking.isFixed ? next : clampSimpleBookingDate(next);
    setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(normalized) });
  };

  const handleSchedulePrevDay = () => {
    const prev = parseLocalDate(scheduleDate || getTodayLocalDate());
    prev.setDate(prev.getDate() - 1);
    setScheduleDate(formatLocalDate(prev));
  };

  const handleScheduleNextDay = () => {
    const next = parseLocalDate(scheduleDate || getTodayLocalDate());
    next.setDate(next.getDate() + 1);
    setScheduleDate(formatLocalDate(next));
  };

  const scheduleSlots = useMemo(() => {
    const slotTimes = scheduleBookings
      .map((slot) => String(slot?.slotTime || ''))
      .filter((slotTime) => /^\d{2}:\d{2}$/.test(slotTime));

    // Mantener un rango amplio de jornada aunque haya pocos turnos cargados.
    const merged = Array.from(new Set([...CLUB_TIME_SLOTS, ...slotTimes]));
    return merged.sort((a, b) => (toMinutes(a) ?? 0) - (toMinutes(b) ?? 0));
  }, [scheduleBookings]);

  

  // Grilla visual fija: filas cada 1 hora en rango de horarios devueltos por backend
  const gridSlots = useMemo(() => {
    try {
      const minutesSet = scheduleSlots
        .map((slot) => toMinutes(slot))
        .filter((value): value is number => Number.isFinite(value));

      if (minutesSet.length === 0) return [];

      // Generar filas horarias entre el mínimo y el máximo minuto, ordenadas ascendente (00:00 arriba)
      const minM = Math.min(...minutesSet);
      const maxM = Math.max(...minutesSet);
      const startHour = Math.floor(minM / 60) * 60;
      const endHour = Math.ceil((maxM + 1) / 60) * 60;
      const rowsSet = new Set<number>();
      for (let t = startHour; t < endHour; t += 60) {
        rowsSet.add(t % (24 * 60));
      }
      const rows = Array.from(rowsSet).sort((a, b) => a - b);
      return rows.map((total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
    } catch (e) {
      return [];
    }
  }, [scheduleSlots]);

  // Al abrir la pantalla, scrollear a la fila correspondiente a la hora actual (si la fecha es hoy)
  useEffect(() => {
    // Ejecutar solo después de que se hayan cargado los bookings y la grilla tenga tamaño
    const run = () => {
      try {
        const container = gridScrollRef.current;
        if (!container || !gridSlots || gridSlots.length === 0) return;
        // Solo si la fecha seleccionada es hoy
        const [y, m, d] = scheduleDate.split('-').map(Number);
        const selectedDate = new Date(y, m - 1, d);
        const today = new Date();
        if (
          selectedDate.getFullYear() !== today.getFullYear() ||
          selectedDate.getMonth() !== today.getMonth() ||
          selectedDate.getDate() !== today.getDate()
        ) return;

        const nowMinutes = today.getHours() * 60 + today.getMinutes();
        const slotMinutes = gridSlots.map((s) => {
          const parts = String(s).split(':').map(Number);
          return (parts[0] || 0) * 60 + (parts[1] || 0);
        });
        let idx = slotMinutes.findIndex((m) => m >= nowMinutes);
        if (idx === -1) idx = slotMinutes.length - 1;
        if (idx < 0) idx = 0;

        const top = idx * ROW_HEIGHT + HEADER_HEIGHT + (V_GAP_PX / 2);
        const desired = Math.max(0, Math.min(Math.floor(top - container.clientHeight / 2 + ROW_HEIGHT / 2), container.scrollHeight - container.clientHeight));

        // esperar layout y luego animar
        requestAnimationFrame(() => {
          // una pasada extra por si el layout cambia
          requestAnimationFrame(() => {
            container.scrollTo({ top: desired, behavior: 'smooth' });
          });
        });
      } catch (e) {
        // noop
      }
    };

    // Ejecutar cuando carguen los bookings o cambie la fecha
    run();
  }, [gridSlots, scheduleDate, scheduleBookings.length, lastUpdate]);

  const getClubSlug = useCallback(() => {
    if (urlSlug) return urlSlug;
    try {
      const userStored = localStorage.getItem('user');
      if (userStored) {
        const user = normalizeSessionUser(JSON.parse(userStored));
        const foundSlug = getActiveClubSlug(user);
        if (foundSlug) return foundSlug;
      }
    } catch (error) {
      reportUiError({ area: 'AdminTabBookings', action: 'getClubSlug' }, error);
    }
    return ''; 
  }, [urlSlug]);

  useEffect(() => {
    const loadClubConfig = async () => {
      try {
        const slug = getClubSlug();
        if (!slug) return;
        const club = await ClubService.getClubBySlug(slug);
        const rawAdvance = Number(club?.bookingSimpleAdvanceDaysAdmin);
        const rawProfessorOverride = Number(club?.professorDurationOverrideMinutes);
        setClubBookingConfig({
          bookingSimpleAdvanceDaysAdmin:
            Number.isFinite(rawAdvance) && rawAdvance >= 0
              ? Math.floor(rawAdvance)
              : 30,
          allowAdminSkipSimpleAdvanceLimit: Boolean(club?.allowAdminSkipSimpleAdvanceLimit),
          professorDurationOverrideEnabled: club?.professorDurationOverrideEnabled ?? true,
          professorDurationOverrideMinutes:
            Number.isFinite(rawProfessorOverride) && rawProfessorOverride > 0
              ? Math.floor(rawProfessorOverride)
              : DEFAULT_DURATION_MINUTES
        });
        const countryIso = normalizePhoneCountryIso2(club?.country);
        setClubPhoneCountryIso2(countryIso);
        setManualBooking((prev) => ({
          ...prev,
          clientPhoneCountryIso2: prev.clientPhoneCountryIso2 || countryIso
        }));
      } catch {
        setClubBookingConfig({
          bookingSimpleAdvanceDaysAdmin: 30,
          allowAdminSkipSimpleAdvanceLimit: false,
          professorDurationOverrideEnabled: true,
          professorDurationOverrideMinutes: DEFAULT_DURATION_MINUTES
        });
        setClubPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    };

    loadClubConfig();
  }, [getClubSlug]);

  useEffect(() => {
    setManualBooking((prev) => {
      if (manualDurationOptions.includes(prev.durationMinutes)) return prev;
      return { ...prev, durationMinutes: manualDurationOptions[0] };
    });
  }, [manualDurationOptions]);

  useEffect(() => {
    if (manualBooking.isFixed) return;
    const current = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
    const clamped = clampSimpleBookingDate(current);
    if (formatLocalDate(current) !== formatLocalDate(clamped)) {
      setManualBooking((prev) => ({ ...prev, startDateBase: formatLocalDate(clamped) }));
    }
  }, [manualBooking.isFixed, manualBooking.startDateBase, clampSimpleBookingDate]);

  // --- HANDLER PARA CAMBIO DE NOMBRE DEL INVITADO Y BUSQUEDA DE CLIENTES ---
  const handleGuestFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setManualBooking({ ...manualBooking, clientId: '', clientFirstName: value });
    setSelectedClientIsProfessor(false);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.length >= 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const currentSlug = getClubSlug();
          if (!currentSlug) return; 
          const results = await searchClients(currentSlug, value);
          if (!Array.isArray(results)) {
            throw new Error('Respuesta inválida al buscar clientes');
          }
          setSearchResults(results);
          setShowDropdown(true);
        } catch (error) {
          reportUiError({ area: 'AdminTabBookings', action: 'searchClients' }, error);
          showError('No se pudo completar la busqueda de clientes.');
        }
      }, 300);
    } else { setShowDropdown(false); }
  };

  const selectClient = (client: any) => {
    const rawName = String(client?.name || '').trim();
    let fName = rawName;
    let lName = '';
    if (rawName.includes(' ')) {
      const parts = rawName.split(' ');
      fName = parts[0];
      lName = parts.slice(1).join(' ');
    }
    const splitPhone = splitCanonicalPhone(String(client?.phone || '').trim(), clubPhoneCountryIso2);
    setManualBooking({
      ...manualBooking,
      clientId: String(client?.id || ''),
      clientFirstName: fName,
      clientLastName: lName,
      clientPhoneCountryIso2: splitPhone.countryIso2 || clubPhoneCountryIso2,
      clientPhone: String(splitPhone.localNumber || ''),
      clientDni: String(client?.dni || '').trim()
    });
    setSelectedClientIsProfessor(Boolean(client.isProfessor));
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
  const formatShortDateTime = (raw: string | Date) => {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw || '');
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };
  const formatMinutesAsTime = (minutes: number) => {
    const safe = Number(minutes || 0);
    const hh = String(Math.floor(safe / 60)).padStart(2, '0');
    const mm = String(safe % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  const buildDetailedBookingErrorMessage = (error: any) => {
    const details = error?.details || {};
    const overlaps = Array.isArray(details?.overlaps) ? details.overlaps : [];
    if (!overlaps.length) return `Error al reservar: ${error?.message || 'Error desconocido'}`;

    return (
      <div className="space-y-3">
        <p className="text-sm text-[#347048]/80">{error?.message || 'Se detectaron superposiciones.'}</p>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-red-200 bg-red-50/40 p-3 space-y-2">
          {overlaps.map((overlap: any, index: number) => {
            const hasFixed = Number.isFinite(Number(overlap?.startTimeMinutes)) && Number.isFinite(Number(overlap?.endTimeMinutes));
            return (
              <div key={`${overlap?.bookingId || overlap?.fixedBookingId || 'ov'}-${index}`} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-[#347048]">
                <div className="font-black text-red-700 uppercase tracking-wide">
                  {hasFixed ? 'Turno fijo existente' : 'Reserva existente'}
                </div>
                <div>
                  {hasFixed
                    ? `${WEEKDAY_LABELS[Number(overlap?.dayOfWeek ?? 0)] || 'Día'} ${formatMinutesAsTime(Number(overlap?.startTimeMinutes || 0))} - ${formatMinutesAsTime(Number(overlap?.endTimeMinutes || 0))}`
                    : `${formatShortDateTime(overlap?.startDateTime || overlap?.requestedStartDateTime)} - ${formatShortDateTime(overlap?.endDateTime || overlap?.requestedEndDateTime)}`}
                </div>
                {!!overlap?.clientName && <div>Cliente: <span className="font-bold">{overlap.clientName}</span></div>}
                {!!overlap?.conflictingClientName && <div>Cliente: <span className="font-bold">{overlap.conflictingClientName}</span></div>}
                {!!overlap?.courtName && <div>Cancha: <span className="font-bold">{overlap.courtName}</span></div>}
                {!!overlap?.conflictingCourtName && <div>Cancha: <span className="font-bold">{overlap.conflictingCourtName}</span></div>}
                {!!overlap?.activityName && <div>Actividad: <span className="font-bold">{overlap.activityName}</span></div>}
                {!!overlap?.conflictingActivityName && <div>Actividad: <span className="font-bold">{overlap.conflictingActivityName}</span></div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const buildFixedOverlapConfirmMessage = (error: any) => {
    const details = error?.details || {};
    const overlaps = Array.isArray(details?.overlaps) ? details.overlaps : [];

    return (
      <div className="space-y-3">
        <p className="text-sm text-[#347048]/80">
          Se detectó superposición con un turno fijo existente. Si continuás, se creará la serie omitiendo las fechas que choquen.
        </p>
        {overlaps.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
            {overlaps.map((overlap: any, index: number) => (
              <div key={`${overlap?.fixedBookingId || 'fixed'}-${index}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-[#347048]">
                <div className="font-black text-amber-700 uppercase tracking-wide">Turno fijo existente</div>
                <div>
                  {`${WEEKDAY_LABELS[Number(overlap?.dayOfWeek ?? 0)] || 'Día'} ${formatMinutesAsTime(Number(overlap?.startTimeMinutes || 0))} - ${formatMinutesAsTime(Number(overlap?.endTimeMinutes || 0))}`}
                </div>
                {!!overlap?.requestedStartDateTime && (
                  <div>Fecha de superposición: <span className="font-bold">{formatShortDateTime(overlap.requestedStartDateTime)}</span></div>
                )}
                {!!overlap?.clientName && <div>Cliente: <span className="font-bold">{overlap.clientName}</span></div>}
                {!!overlap?.courtName && <div>Cancha: <span className="font-bold">{overlap.courtName}</span></div>}
                {!!overlap?.activityName && <div>Actividad: <span className="font-bold">{overlap.activityName}</span></div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  const buildSimpleBookingSummaryMessage = (params: {
    courtName: string;
    activityName: string;
    clientName: string;
    start: Date;
    durationMinutes: number;
    price: number;
    listPrice?: number;
    discountAmount?: number;
    nightSurcharge?: {
      applied: boolean;
      amount: number;
      fromHour?: string | null;
    };
  }) => {
    const end = new Date(params.start.getTime() + params.durationMinutes * 60000);
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#347048]/80">Reserva simple creada correctamente.</p>
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#926699]/20 bg-[#fdfaff] p-3 text-sm text-[#347048]">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Cliente:</span>
            <span className="text-[#347048] font-black">{params.clientName}</span>
          </div>
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
            <span className="text-[#347048] font-black">{params.start.toLocaleDateString('es-AR')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Horario:</span>
            <span className="text-[#347048] font-black">{`${formatTime(params.start)} - ${formatTime(end)}`}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Duración:</span>
            <span className="text-[#347048] font-black">{params.durationMinutes} min</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#926699] uppercase text-xs">Precio:</span>
            <span className="text-[#347048] font-black text-lg">{formatMoney(params.price)}</span>
          </div>
          {Number(params.discountAmount || 0) > 0.009 ? (
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Descuento:</span>
              <span className="text-[#347048] font-black">
                -{formatMoney(params.discountAmount || 0)}
                {Number(params.listPrice || 0) > 0.009 ? ` (lista ${formatMoney(params.listPrice || 0)})` : ''}
              </span>
            </div>
          ) : null}
          {params.nightSurcharge?.applied ? (
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Recargo nocturno:</span>
              <span className="text-[#347048] font-black">
                +{formatMoney(params.nightSurcharge.amount)}
                {params.nightSurcharge.fromHour ? ` (desde ${params.nightSurcharge.fromHour})` : ''}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  };
  const buildFixedBookingSummaryMessage = (params: {
    courtName: string;
    activityName: string;
    clientName: string;
    firstDate: Date;
    slotTime: string;
    generatedCount: number;
    dayOfWeek: number;
    createdOccurrences?: Array<{
      bookingId?: number;
      startDateTime?: string;
      endDateTime?: string;
    }>;
    skippedOccurrences?: Array<{
      requestedStartDateTime?: string;
      requestedEndDateTime?: string;
    }>;
  }) => (
    <div className="space-y-3">
      <p className="text-sm text-[#347048]/80">Turno fijo creado correctamente.</p>
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#926699]/20 bg-[#fdfaff] p-3 text-sm text-[#347048]">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Cliente:</span>
          <span className="text-[#347048] font-black">{params.clientName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Cancha:</span>
          <span className="text-[#347048] font-black">{params.courtName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Actividad:</span>
          <span className="text-[#347048] font-black">{params.activityName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Día fijo:</span>
          <span className="text-[#347048] font-black">{WEEKDAY_LABELS[params.dayOfWeek] || 'No definido'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Horario:</span>
          <span className="text-[#347048] font-black">{params.slotTime}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Primera fecha:</span>
          <span className="text-[#347048] font-black">{params.firstDate.toLocaleDateString('es-AR')}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-[#926699] uppercase text-xs">Turnos generados:</span>
          <span className="text-[#347048] font-black text-lg">{params.generatedCount}</span>
        </div>
      </div>
      <div className="rounded-xl border border-[#347048]/15 bg-white/70 p-3">
        <div className="font-bold text-[#926699] uppercase text-xs mb-2">Turnos creados</div>
        {Array.isArray(params.createdOccurrences) && params.createdOccurrences.length > 0 ? (
          <div className="max-h-52 overflow-y-auto space-y-2">
            {params.createdOccurrences.map((occurrence: any, index: number) => (
              <div key={`${occurrence?.bookingId || 'occ'}-${index}`} className="rounded-lg border border-[#347048]/10 bg-white px-3 py-2 text-xs text-[#347048]">
                <div className="font-bold">
                  {formatShortDateTime(occurrence?.startDateTime || '')}
                  {' - '}
                  {formatShortDateTime(occurrence?.endDateTime || '')}
                </div>
                {Number.isFinite(Number(occurrence?.bookingId)) && (
                  <div className="text-[#347048]/70">ID reserva: #{Number(occurrence.bookingId)}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[#347048]/70">No se recibió el detalle de turnos creados.</div>
        )}
      </div>
      {Array.isArray(params.skippedOccurrences) && params.skippedOccurrences.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          {params.skippedOccurrences.length} ocurrencia(s) no se crearon por superposición.
        </div>
      )}
    </div>
  );
  
  const showConfirm = (options: {
    title: string; message: ReactNode; confirmText?: string; cancelText?: string; isWarning?: boolean;
    onConfirm: () => Promise<void> | void; onCancel?: () => Promise<void> | void; closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }) => setModalState({
    show: true, title: options.title, message: options.message,
    confirmText: options.confirmText ?? 'Aceptar', cancelText: options.cancelText ?? 'Cancelar',
    isWarning: options.isWarning ?? true, closeOnBackdrop: options.closeOnBackdrop, closeOnEscape: options.closeOnEscape,
    onConfirm: wrapAction(options.onConfirm), onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
  });

  const loadCourts = useCallback(async () => {
    const slug = getClubSlug();
    if (!slug) {
      setCourts([]);
      return;
    }
    try {
      const data = await ClubAdminService.getCourts(slug);
      setCourts(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (isAuthSessionInvalidatedError(error)) {
        return;
      }
      showError('Error: ' + error.message);
    }
  }, [getClubSlug]);

  const loadSchedule = useCallback(async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      setScheduleBookings(data || []);
      setLastUpdate(new Date());
    } catch (error: any) { showError('Error: ' + error.message); } finally { setLoadingSchedule(false); }
  }, [scheduleDate]);

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

  useEffect(() => {
    const showReservationDetailFromBooking = (booking: any, fallbackSlotTime?: string, fallbackCourtName?: string) => {
      const entity = booking?.booking ?? booking;
      const rawStart = entity?.startDateTime ?? null;
      const start = rawStart ? new Date(rawStart) : null;
      if (!start || Number.isNaN(start.getTime())) return;

      const explicitDuration = Number(entity?.durationMinutes || 0);
      const endFromBooking = entity?.endDateTime ? new Date(entity.endDateTime) : null;
      const durationFromRange = endFromBooking && !Number.isNaN(endFromBooking.getTime())
        ? Math.round((endFromBooking.getTime() - start.getTime()) / 60000)
        : 0;
      const durationMinutes = Number.isFinite(explicitDuration) && explicitDuration > 0
        ? explicitDuration
        : (Number.isFinite(durationFromRange) && durationFromRange > 0
            ? durationFromRange
            : Number(entity?.activity?.defaultDurationMinutes || DEFAULT_DURATION_MINUTES));

      const price = Number(entity?.price || 0);
      const listPrice = Number(entity?.listPrice || entity?.price || 0);
      const discountAmount = Math.max(0, Number((listPrice - price).toFixed(2)));
      const clientName = String(entity?.client?.name || entity?.user?.firstName || 'Cliente');
      const courtName = String(fallbackCourtName || entity?.court?.name || entity?.courtName || `Cancha ${entity?.courtId || ''}` || 'Cancha');
      const activityName = String(entity?.activity?.name || entity?.activityType?.name || entity?.activityName || 'Actividad');

      const end = new Date(start.getTime() + durationMinutes * 60000);
      showInfo((
        <div className="space-y-3">
          <p className="text-sm text-[#347048]/80">Detalle de la reserva.</p>
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#926699]/20 bg-[#fdfaff] p-3 text-sm text-[#347048]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Cliente:</span>
              <span className="text-[#347048] font-black">{clientName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Cancha:</span>
              <span className="text-[#347048] font-black">{courtName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Actividad:</span>
              <span className="text-[#347048] font-black">{activityName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Fecha:</span>
              <span className="text-[#347048] font-black">{start.toLocaleDateString('es-AR')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Horario:</span>
              <span className="text-[#347048] font-black">{`${formatTime(start)} - ${formatTime(end)}`}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Duración:</span>
              <span className="text-[#347048] font-black">{durationMinutes} min</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#926699] uppercase text-xs">Precio:</span>
              <span className="text-[#347048] font-black text-lg">{formatMoney(price)}</span>
            </div>
            {discountAmount > 0.009 ? (
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#926699] uppercase text-xs">Descuento:</span>
                <span className="text-[#347048] font-black">
                  -{formatMoney(discountAmount)}
                  {listPrice > 0.009 ? ` (lista ${formatMoney(listPrice)})` : ''}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ), 'Detalle de reserva');
    };

    const bookingIdRaw = router.query?.bookingId;
    const bookingId = Number(Array.isArray(bookingIdRaw) ? bookingIdRaw[0] : bookingIdRaw);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      openedFromQueryRef.current = null;
      return;
    }
    if (openedFromQueryRef.current === bookingId) return;

    const slotWithBooking = scheduleBookings.find((slot) => Number(slot?.booking?.id) === bookingId);
    if (slotWithBooking?.booking) {
      openedFromQueryRef.current = bookingId;
      showReservationDetailFromBooking(slotWithBooking.booking, slotWithBooking.slotTime, slotWithBooking.courtName);
      const nextQuery: Record<string, any> = { ...router.query };
      delete nextQuery.bookingId;
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const payload = await getBookingById(bookingId);
        const booking = payload?.booking ?? payload;
        if (cancelled || !booking) return;
        const start = booking?.startDateTime ? new Date(booking.startDateTime) : null;
        const slotTime = start && !Number.isNaN(start.getTime())
          ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
          : undefined;
        openedFromQueryRef.current = bookingId;
        showReservationDetailFromBooking(booking, slotTime, booking?.court?.name);
        const nextQuery: Record<string, any> = { ...router.query };
        delete nextQuery.bookingId;
        router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
      } catch {
        // noop
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, router.query?.bookingId, scheduleBookings, scheduleDate]);

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
    const slotEndDate = new Date(slotStartDate.getTime() + DEFAULT_DURATION_MINUTES * 60000);
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

  const formatTime = (date: Date) => formatTime24(date);

  const getBookingTimeRange = (slotOrBooking: any) => {
    // slotOrBooking can be either a schedule slot object or a booking object
    const booking = slotOrBooking?.booking ? slotOrBooking.booking : slotOrBooking;
    const fallbackSlotTime = slotOrBooking?.slotTime;

    const startValue = booking?.startDateTime || slotOrBooking?.startDateTime;
    if (!startValue) return fallbackSlotTime || '';
    const startDate = new Date(startValue);

    let endDate: Date | null = null;

    if (booking?.endDateTime) {
      endDate = new Date(booking.endDateTime);
    } else if (booking?.durationMinutes) {
      endDate = new Date(startDate.getTime() + Number(booking.durationMinutes) * 60000);
    } else if (booking?.activity?.defaultDurationMinutes) {
      endDate = new Date(startDate.getTime() + Number(booking.activity.defaultDurationMinutes) * 60000);
    } else if (booking?.fixedBooking) {
      try {
        let sM: number | null = null;
        let eM: number | null = null;

        if (Number.isFinite(Number(booking.fixedBooking.startTimeMinutes)) && Number.isFinite(Number(booking.fixedBooking.endTimeMinutes))) {
          sM = Number(booking.fixedBooking.startTimeMinutes);
          eM = Number(booking.fixedBooking.endTimeMinutes);
        }

        if (sM !== null && eM !== null) {
          if (eM <= sM) eM += 24 * 60;
          const duration = eM - sM;
          endDate = new Date(startDate.getTime() + duration * 60000);
        }
      } catch {
        endDate = null;
      }
    }

    if (!endDate) {
      endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MINUTES * 60000);
    }

    return `${formatTime(startDate)} - ${formatTime(endDate)}`;
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const firstName = manualBooking.clientFirstName.trim();
    const lastName = manualBooking.clientLastName.trim();
    const dni = manualBooking.clientDni?.trim();
    const localPhone = String(manualBooking.clientPhone || '').trim();
    const selectedClientId = String(manualBooking.clientId || '').trim();
    const hasSelectedClient = selectedClientId.length > 0;
    const selectedActivityId = Number(selectedManualCourt?.activityTypeId || selectedManualCourt?.activityType?.id);
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos de cancha u horario'); return; }
    if (!Number.isInteger(selectedActivityId) || selectedActivityId <= 0) { showError('La cancha seleccionada no tiene actividad válida'); return; }
    if (!hasSelectedClient && (!firstName || !lastName || !localPhone)) {
      showError('Nombre, Apellido y Teléfono son obligatorios para alta rápida.');
      return;
    }
    if (!manualBooking.isFixed && adminSimpleMaxDate) {
      const selectedBase = parseLocalDate(manualBooking.startDateBase || getTodayLocalDate());
      selectedBase.setHours(0, 0, 0, 0);
      const maxDate = new Date(adminSimpleMaxDate);
      maxDate.setHours(0, 0, 0, 0);
      if (selectedBase > maxDate) {
        showError(`La reserva simple excede la anticipación máxima (${clubBookingConfig.bookingSimpleAdvanceDaysAdmin} días).`);
        return;
      }
    }
    let dateBase: Date;
    let clientDisplayName = `${firstName} ${lastName}`.trim();
    let phoneToSend = "";
    const resetManualForm = () => {
      setManualBooking({
        clientId: '',
        clientFirstName: '', clientLastName: '', clientPhoneCountryIso2: clubPhoneCountryIso2, clientPhone: '', clientDni: '',
        courtId: '', time: '', durationMinutes: manualDurationOptions[0] ?? DEFAULT_DURATION_MINUTES, isFixed: false, dayOfWeek: '1', startDateBase: getTodayLocalDate()
      });
      setSelectedClientIsProfessor(false);
    };
    const submitFixedBooking = async (allowOverlappingSeries = false) => {
      const fixedResult = await createFixedBooking(
        Number(manualBooking.courtId),
        selectedActivityId,
        dateBase,
        {
          ...(hasSelectedClient
            ? { clientId: selectedClientId }
            : {
                client: {
                  name: clientDisplayName,
                  phone: phoneToSend || undefined,
                  dni: dni || undefined
                }
              }),
          allowOverlappingSeries,
          durationMinutes: Number(manualBooking.durationMinutes || DEFAULT_DURATION_MINUTES)
        }
      );

      showInfo(
        buildFixedBookingSummaryMessage({
          courtName: String(selectedManualCourt?.name || `Cancha ${manualBooking.courtId}`),
          activityName: String(selectedManualCourt?.activityType?.name || 'Actividad'),
          clientName: clientDisplayName,
          firstDate: dateBase,
          slotTime: manualBooking.time,
          generatedCount: Number((fixedResult as any)?.generatedCount || 0),
          dayOfWeek: Number(manualBooking.dayOfWeek),
          createdOccurrences: Array.isArray((fixedResult as any)?.createdOccurrences)
            ? (fixedResult as any).createdOccurrences
            : [],
          skippedOccurrences: Array.isArray((fixedResult as any)?.skippedOccurrences)
            ? (fixedResult as any).skippedOccurrences
            : []
        }),
        'Turno fijo creado'
      );
      await loadSchedule();
      resetManualForm();
      setBookingPanelView('agenda');
    };
    try {
        const canonicalPhone = buildCanonicalPhone({
          countryIso2: manualBooking.clientPhoneCountryIso2 || clubPhoneCountryIso2,
          localNumber: localPhone
        });
        phoneToSend = canonicalPhone || '';
        if (!hasSelectedClient && !phoneToSend) {
          showError('Ingresá un teléfono válido para alta rápida.');
          return;
        }
        if (manualBooking.isFixed) {
            const base = new Date(manualBooking.startDateBase);
            base.setHours(12, 0, 0, 0);
            const nextDateInfo = getNextDateForDay(base, parseInt(manualBooking.dayOfWeek), manualBooking.time);
            dateBase = nextDateInfo.date; 
        } else {
          dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
        }
        if (manualBooking.isFixed) {
          await submitFixedBooking(false);
        } else {
            const createdBooking = await createBooking(
              Number(manualBooking.courtId),
              selectedActivityId,
              dateBase,
              manualBooking.time,
              {
                durationMinutes: manualBooking.durationMinutes,
                ...(hasSelectedClient
                  ? { clientId: selectedClientId }
                  : {
                      client: {
                        name: clientDisplayName,
                        phone: phoneToSend || undefined,
                        dni: dni || undefined
                      }
                    })
              }
            );
            showInfo(
              buildSimpleBookingSummaryMessage({
                courtName: String(selectedManualCourt?.name || `Cancha ${manualBooking.courtId}`),
                activityName: String(selectedManualCourt?.activityType?.name || 'Actividad'),
                clientName: clientDisplayName,
                start: dateBase,
                durationMinutes: Number(manualBooking.durationMinutes || DEFAULT_DURATION_MINUTES),
                price: Number((createdBooking as any)?.price || 0),
                listPrice: Number((createdBooking as any)?.listPrice || (createdBooking as any)?.price || 0),
                discountAmount: Math.max(0, Number((Number((createdBooking as any)?.listPrice || (createdBooking as any)?.price || 0) - Number((createdBooking as any)?.price || 0)).toFixed(2))),
                nightSurcharge: resolveNightSurcharge(dateBase, selectedManualCourt)
              }),
              'Reserva simple creada'
            );
            await loadSchedule();
            resetManualForm();
            setBookingPanelView('agenda');
        }
    } catch (error: any) {
      const canProceedFixedOverlap = Boolean(manualBooking.isFixed && error?.details?.canProceed);
      if (canProceedFixedOverlap) {
        showConfirm({
          title: 'Superposición detectada',
          message: buildFixedOverlapConfirmMessage(error),
          confirmText: 'Crear igualmente',
          cancelText: 'Cancelar',
          isWarning: true,
          closeOnBackdrop: false,
          onConfirm: async () => {
            try {
              await submitFixedBooking(true);
            } catch (retryError: any) {
              showError(buildDetailedBookingErrorMessage(retryError));
            }
          }
        });
        return;
      }
      showError(buildDetailedBookingErrorMessage(error));
    }
  };

  const getBookingPaidAmount = async (bookingId: number) => {
    try {
      const summary = await getBookingFinancialSummary(bookingId);
      const paid = Number(summary?.paid || 0);
      return Number.isFinite(paid) ? Math.max(0, paid) : 0;
    } catch {
      return 0;
    }
  };

  const performSingleBookingCancel = async (
    booking: any,
    successMsg: string,
    options?: {
      refund?: {
        amount?: number;
        executeNow?: boolean;
      };
    }
  ) => {
    await cancelBooking(booking.id, options);
    showInfo(successMsg, 'Listo');
    setSelectedBookingDetail(null);
    await loadSchedule();
  };

  const resolveRefundDecisionForCancellation = async (paidAmount: number) => {
    if (paidAmount <= 0.009) return undefined;

    setCancelRefundPaidAmount(paidAmount);
    setCancelRefundDraft(buildDefaultRefundDraft('BOOKING_CANCELLATION', paidAmount));
    setShowCancelRefundModal(true);

    return await new Promise<CancelRefundDecision | null>((resolve) => {
      cancelRefundResolverRef.current = resolve;
    });
  };

  const handleCloseCancelRefundModal = () => {
    setShowCancelRefundModal(false);
    const resolver = cancelRefundResolverRef.current;
    cancelRefundResolverRef.current = null;
    resolver?.(null);
  };

  const handleSubmitCancelRefundModal = () => {
    const validation = validateRefundAmountInput(cancelRefundDraft.amountInput, cancelRefundPaidAmount);
    if (validation.error) {
      showError(validation.error);
      return;
    }

    setShowCancelRefundModal(false);
    const resolver = cancelRefundResolverRef.current;
    cancelRefundResolverRef.current = null;
    resolver?.({
      refund: {
        amount: validation.amount,
        executeNow: cancelRefundDraft.executeNow,
        reasonType: cancelRefundDraft.reasonType,
        executionNotes: cancelRefundDraft.executionNotes.trim() || undefined
      }
    });
  };

  const handleCancelBooking = async (booking: any) => {
    const paidAmount = await getBookingPaidAmount(Number(booking.id));
    const paidMessage = paidAmount > 0.009
      ? `Esta reserva tiene pagos netos por ${formatMoney(paidAmount)}. Al cancelar, el backend genera devoluciones para esos pagos.`
      : 'Esta reserva no tiene pagos netos registrados.';

    if (booking.fixedBookingId) {
      showConfirm({
        title: 'Atencion: turno fijo',
        message: <div><p>Este turno pertenece a una serie repetitiva.</p><p className="font-bold mt-2">Deseas eliminar toda la serie futura?</p><p className="mt-3 text-xs font-bold text-[#347048]/70">{paidMessage}</p></div>,
        confirmText: 'Si, borrar toda la serie', cancelText: 'No, ver otras opciones',
        onConfirm: async () => { try { await cancelFixedBooking(booking.fixedBookingId); showInfo('Serie completa eliminada.', 'Exito'); setSelectedBookingDetail(null); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
        onCancel: () => {
          setTimeout(() => showConfirm({
            title: 'Borrar solo hoy?',
            message: <div><p>Eliminar unicamente el turno de hoy y mantener los futuros?</p><p className="mt-3 text-xs font-bold text-[#347048]/70">{paidMessage}</p></div>,
            confirmText: 'Si, borrar solo hoy', cancelText: 'Cancelar',
            onConfirm: async () => {
              try {
                const decision = await resolveRefundDecisionForCancellation(paidAmount);
                if (decision === null) return;
                await performSingleBookingCancel(booking, 'Turno del dia eliminado.', decision || undefined);
              } catch (e: any) {
                showError('Error: ' + e.message);
              }
            },
          }), 200);
        }
      });
    } else {
      showConfirm({
        title: 'Cancelar turno',
        message: <div><p>Seguro que deseas cancelar esta reserva simple?</p><p className="mt-3 text-xs font-bold text-[#347048]/70">{paidMessage}</p></div>,
        confirmText: 'Si, cancelar',
        onConfirm: async () => {
          try {
            const decision = await resolveRefundDecisionForCancellation(paidAmount);
            if (decision === null) return;
            await performSingleBookingCancel(booking, 'Turno cancelado.', decision || undefined);
          } catch (e: any) {
            showError('Error: ' + e.message);
          }
        }
      });
    }
  };

  return (
    <>
      {/* --- TARJETA DE CREACION DE RESERVA (BEIGE WIMBLEDON) --- */}
      {bookingPanelView === 'create' && (
      <div className="density-compact bg-[#EBE1D8] border-4 border-white/50 rounded-[1.5rem] p-5 mb-6 shadow-2xl shadow-[#347048]/30 relative overflow-visible transition-all">
        <div className="mb-4 pb-4 border-b border-[#347048]/10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="bg-[#347048] text-[#EBE1D8] p-2 rounded-xl shadow-md shadow-[#347048]/20">
              {manualBooking.isFixed ? <Repeat size={18} strokeWidth={3} /> : <CalendarPlus size={18} strokeWidth={3} />}
            </span>
            <div>
              <h2 className="text-lg font-black text-[#347048] uppercase tracking-tight">
                {manualBooking.isFixed ? 'Nueva serie fija' : 'Nueva reserva'}
              </h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/45 mt-1">
                {manualBooking.isFixed ? 'Programacion semanal automatica' : 'Carga rapida de turno'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-white border border-[#347048]/15 text-[#347048]/70 font-black uppercase tracking-widest">
              {manualBooking.isFixed ? 'Serie' : 'Simple'}
            </span>
            <button
              type="button"
              onClick={() => setBookingPanelView('agenda')}
              className="h-8 px-2.5 rounded-lg border border-[#347048]/20 bg-white text-[10px] font-black uppercase tracking-widest text-[#347048] hover:border-[#B9CF32] shadow-sm transition-all flex items-center gap-1"
            >
              <ChevronLeft size={12} strokeWidth={3} />
              Agenda
            </button>
          </div>
        </div>

        <form onSubmit={handleCreateBooking} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          
          {/* BUSCADOR CLIENTE (Usa focus-within para saltar al frente al escribir) */}
          <div className={`relative ${showDropdown ? 'z-[300]' : 'z-20'}`} ref={wrapperRef}>
              <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Nombre (Buscar Cliente)</label>
              <input 
                  type="text" 
                  value={manualBooking.clientFirstName} 
                  onChange={handleGuestFirstNameChange}
                  className="compact-field w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all relative z-10"
                  placeholder="Escribe para buscar..." 
                  required autoComplete="off"
              />
              {showDropdown && searchResults.length > 0 && (
                  <ul className="absolute z-[320] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto">
                      {searchResults.map((client) => (
                          <li key={client.id} onClick={() => selectClient(client)}
                              className="px-4 py-3 hover:bg-[#B9CF32]/20 cursor-pointer text-[#347048] border-b border-[#347048]/5 last:border-0 transition-colors">
                              <div className="font-black text-sm">{String(client?.name || 'Cliente')}</div>
                              <div className="text-[10px] font-bold text-[#347048]/60 flex gap-3 mt-1 uppercase">
                                  {client.phone && (
                                    <span className="flex items-center gap-1">
                                      <Phone size={12} strokeWidth={2.5} /> {client.phone}
                                    </span>
                                  )}
                                  {client.dni && (
                                    <span className="flex items-center gap-1">
                                      <IdCard size={12} strokeWidth={2.5} /> {client.dni}
                                    </span>
                                  )}
                              </div>
                          </li>
                      ))}
                  </ul>
              )}
          </div>

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Apellido</label>
            <input type="text" value={manualBooking.clientLastName} onChange={(e) => setManualBooking({ ...manualBooking, clientId: '', clientLastName: e.target.value })} 
            className="compact-field w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Ingresa el apellido" required />
          </div>

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Teléfono</label>
            <div className="flex items-center gap-2">
              <select
                value={manualBooking.clientPhoneCountryIso2}
                onChange={(e) => setManualBooking({ ...manualBooking, clientId: '', clientPhoneCountryIso2: normalizePhoneCountryIso2(e.target.value) })}
                className="compact-field h-11 w-28 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-xs font-black text-[#347048] focus:outline-none shadow-sm transition-all"
              >
                {PHONE_COUNTRY_OPTIONS.map((option) => (
                  <option key={option.iso2} value={option.iso2}>
                    {option.callingCode} {option.iso2}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={manualBooking.clientPhone}
                onChange={(e) => setManualBooking({ ...manualBooking, clientId: '', clientPhone: e.target.value.replace(/[^\d]/g, '') })}
                className="compact-field w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                placeholder="Número local"
                required
              />
            </div>
          </div>

          <div className="relative z-10">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">DNI</label>
            <input type="text" value={manualBooking.clientDni} onChange={(e) => setManualBooking({ ...manualBooking, clientId: '', clientDni: e.target.value })} 
            className="compact-field w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all" placeholder="Número de documento" />
          </div>

          {/* FECHA (Usa focus-within para tapar TODO al abrirse) */}
          <div className="relative focus-within:z-[100] z-20">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Fecha</label>
            {manualBooking.isFixed ? (
              <div className="compact-field h-11 bg-white/50 border-2 border-dashed border-[#347048]/20 rounded-xl px-4 flex items-center">
                <span className="text-[#347048]/40 font-bold text-sm">Selecciona día abajo</span>
              </div>
            ) : (
              <div className="compact-field relative flex items-center justify-between bg-white rounded-xl px-2 py-2 border border-transparent shadow-sm h-[42px]">
                <button
                  type="button"
                  onClick={handleManualPrevDay}
                  disabled={isManualPrevDisabled()}
                  className="p-1 rounded-lg text-[#347048] disabled:opacity-20 hover:bg-[#347048]/10 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-[15px] font-bold text-[#347048] min-w-[100px] text-center whitespace-nowrap">
                  {getFormattedDateLabel(parseLocalDate(manualBooking.startDateBase || getTodayLocalDate()))}
                </span>
                <button
                  type="button"
                  onClick={handleManualNextDay}
                  disabled={isManualNextDisabled()}
                  className="p-1 rounded-lg text-[#347048] disabled:opacity-20 hover:bg-[#347048]/10 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute inset-y-0 left-12 right-12 z-10">
                  <DatePickerDark
                    selected={parseLocalDate(manualBooking.startDateBase || getTodayLocalDate())}
                    onChange={(date: Date | null) => {
                      if (!date) return;
                      const normalizedDate = manualBooking.isFixed ? date : clampSimpleBookingDate(date);
                      setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(normalizedDate) });
                    }}
                    minDate={new Date()}
                    maxDate={manualBooking.isFixed || !adminSimpleMaxDate ? undefined : adminSimpleMaxDate}
                    showIcon={false}
                    variant="light"
                    inputClassName="w-full h-[42px] opacity-0 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* HORA */}
          <div className="relative z-[120]">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Hora</label>
              <CustomSelect 
              value={manualBooking.time}
              onChange={(val: string) => setManualBooking({ ...manualBooking, time: val })}
              placeholder="Selecciona hora"
              options={scheduleSlots.map(slot => ({
                value: slot,
                label: slot,
                // Para turnos fijos no deshabilitamos horarios (deben mostrarse todos)
                disabled: manualBooking.isFixed
                  ? false
                  : !!(manualBooking.startDateBase && isPastTimeForDate(manualBooking.startDateBase, slot))
              }))}
            />
          </div>

          {/* DURACION */}
          <div className="relative z-[110]">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Duración</label>
            <CustomSelect
              value={manualBooking.durationMinutes}
              onChange={(val: string) => setManualBooking({ ...manualBooking, durationMinutes: Number(val) })}
              placeholder="Duración"
              options={manualDurationOptions.map((duration) => ({ value: duration, label: `${duration} min` }))}
            />
          </div>

          {/* CANCHA */}
          <div className="relative z-[100]">
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

          {/* BOTON CHECKBOX Y SUBMIT */}
          <div className="relative z-0 md:col-span-2 flex flex-col sm:flex-row gap-4 items-center justify-between mt-2 p-4 bg-[#347048]/5 rounded-[1.5rem] border border-[#347048]/10">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${manualBooking.isFixed ? 'bg-[#B9CF32] border-[#B9CF32]' : 'border-[#347048]/20 bg-white'}`}>
                    {manualBooking.isFixed && <Check size={16} className="text-[#347048]" strokeWidth={4} />}
                </div>
                <input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({ ...manualBooking, isFixed: e.target.checked })} className="hidden" />
                <span className="text-sm uppercase tracking-wide">¿Es un turno fijo?</span>
              </label>
            </div>

            <button type="submit" className="compact-field w-full sm:w-auto px-8 py-3 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-sm flex items-center justify-center gap-3 group">
              {manualBooking.isFixed ? <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" /> : <CalendarIcon size={18} />}
              {manualBooking.isFixed ? 'Crear Serie' : 'Crear Reserva'}
            </button>
          </div>
        </form>
      </div>
      )}

      {/* --- TABLA DE HORARIOS --- */}
      {bookingPanelView === 'agenda' && (
      <div className="density-compact bg-[#EBE1D8] border-4 border-white/50 rounded-[1.5rem] p-5 mb-6 shadow-2xl shadow-[#347048]/20 overflow-hidden relative z-0">
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mb-5">
          <h2 className="text-2xl font-black text-[#347048] uppercase italic tracking-tight flex items-center gap-3">
             <div className="w-2 h-8 bg-[#B9CF32] rounded-full"></div>
              Agenda del Día
          </h2>
          <div className="flex flex-wrap items-center gap-3 bg-white/40 p-2 rounded-2xl border border-white/60">
            <button
              type="button"
              onClick={() => setBookingPanelView('create')}
              className="h-9 w-9 rounded-full border border-[#347048]/20 bg-white text-[#347048] flex items-center justify-center shadow-sm hover:border-[#B9CF32] hover:text-[#926699] transition-all"
              title="Nueva reserva"
              aria-label="Nueva reserva"
            >
              <CalendarPlus size={16} strokeWidth={3} />
            </button>
            <div className="flex items-center gap-2 px-3">
              <span className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Fecha:</span>
              <div className="compact-field relative flex items-center justify-between bg-white rounded-xl px-2 py-2 border border-transparent shadow-sm h-[42px] min-w-[260px]">
                <button
                  type="button"
                  onClick={handleSchedulePrevDay}
                  className="p-1 rounded-lg text-[#347048] hover:bg-[#347048]/10 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-[15px] font-bold text-[#347048] min-w-[100px] text-center whitespace-nowrap">
                  {getFormattedDateLabel(parseLocalDate(scheduleDate || getTodayLocalDate()))}
                </span>
                <button
                  type="button"
                  onClick={handleScheduleNextDay}
                  className="p-1 rounded-lg text-[#347048] hover:bg-[#347048]/10 transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute inset-y-0 left-12 right-12 z-10">
                  <DatePickerDark
                    selected={parseLocalDate(scheduleDate || getTodayLocalDate())}
                    onChange={(date: Date | null) => {
                      if (!date) return;
                      setScheduleDate(formatLocalDate(date));
                    }}
                    showIcon={false}
                    variant="light"
                    inputClassName="w-full h-[42px] opacity-0 cursor-pointer"
                  />
                </div>
              </div>
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="flex items-center gap-2 px-4 py-2 bg-[#347048] text-[#EBE1D8] rounded-xl text-xs font-black uppercase tracking-tighter hover:bg-[#B9CF32] hover:text-[#347048] transition-all">
              {loadingSchedule ? '...' : 'Actualizar'}
            </button>
            {lastUpdate && <span className="text-[10px] font-bold text-[#347048]/40 px-2 uppercase">{formatTime24(lastUpdate)}</span>}
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
          <div className="space-y-3 py-7">
              <div className="h-12 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
              <div className="h-12 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : gridSlots.length > 0 ? (
          <div className="overflow-x-auto -mx-8">
            <div ref={gridScrollRef} className="min-w-[900px] pl-14 pr-6 max-h-[78vh] overflow-y-auto">
              <div
                className="relative"
                // Reservar espacio para cabecera con nombres de canchas
                style={{ height: gridSlots.length * ROW_HEIGHT + HEADER_HEIGHT + V_GAP_PX, paddingTop: HEADER_HEIGHT }}
              >{/* Cabecera con nombres de canchas (Bordes exteriores redondeados) */}
                <div 
                  className="absolute left-0 right-0 top-0 flex items-center border-b border-[#347048]/10 bg-white/90 z-20 rounded-t-[1.5rem]"
                  style={{ height: HEADER_HEIGHT }} 
                >
                  {courts.map((court) => (
                    <div key={court.id} className="flex-1 text-center font-black text-[#347048] uppercase tracking-widest text-sm">
                      {court.name}
                    </div>
                  ))}
                </div>
                {/* GRID HORARIA FIJA: por defecto 08:00 - 22:00, filas de 1 hora. */}
                {/** Calculamos `gridSlots` localmente para render visual sin tocar `scheduleSlots` */}
                {/* Horario calculado inline removido (no se renderiza directamente aquí). */}
                {/* COLUMNAS */}
                <div className="absolute inset-0 flex">
                  {courts.map((court) => (
                    <div
                      key={court.id}
                      className="flex-1 border-r border-[#347048]/10"
                    />
                  ))}
                </div>

                {/* LÍNEAS HORARIAS */}
                {gridSlots.map((time, index) => (
                  <div
                    key={time}
                    className="absolute left-0 right-0 border-t border-[#347048]/10"
                    style={{ top: index * ROW_HEIGHT + HEADER_HEIGHT + (V_GAP_PX / 2) }}
                  >
                    <span className="absolute -left-12 -top-2 px-2 text-[10px] font-black text-[#347048]/70">
                      {time}
                    </span>
                  </div>
                ))}

                {/* RESERVAS */}
                {scheduleBookings.map((slot) => {
                  if (!slot?.booking) return null;

                  const courtIndex = courts.findIndex(
                    (c) => c.id === slot.courtId
                  );

                  // calcular posición vertical relativa a gridSlots/openMinutes (puede ser horario con minutos)
                  // Calcular posición vertical relativa a la primera fila de `gridSlots`
                  const firstGridMinutes = (gridSlots.length > 0 ? toMinutes(gridSlots[0]) : null) ?? 8 * 60;

                  let startMinutes = toMinutes(slot.slotTime) ?? null;
                  if (courtIndex === -1 || startMinutes === null) return null;
                  // Si la grilla incluye horas nocturnas que puedan requerir ajustar +24h, manejamos el caso
                  if (startMinutes < firstGridMinutes && gridSlots.length > 0 && firstGridMinutes > startMinutes) {
                    // si el primer grid es mayor (por ejemplo 08:00) y el slot es temprano (00:00),
                    // asumimos que el slot pertenece a la misma fecha y no sumar 24h.
                    // En la mayoría de casos, startMinutes >= firstGridMinutes.
                  }
                  const slotIndexFloat = (startMinutes - firstGridMinutes) / 60;
                  if (slotIndexFloat < 0) return null; // fuera de rango

                  const columnWidth = 100 / courts.length;

                  const top = slotIndexFloat * ROW_HEIGHT + HEADER_HEIGHT + (V_GAP_PX / 2);
                  const left = `calc(${courtIndex * columnWidth}% + ${H_GAP_PX / 2}px)`;
                  const width = `calc(${columnWidth}% - ${H_GAP_PX}px)`;

                  // Calcular duración real en minutos preferentemente desde start/end
                  let durationMinutes: number | null = null;
                  try {
                    const bStart = slot.booking?.startDateTime ? new Date(slot.booking.startDateTime) : slot.startDateTime ? new Date(slot.startDateTime) : null;
                    const bEnd = slot.booking?.endDateTime ? new Date(slot.booking.endDateTime) : null;
                    if (bStart && bEnd) {
                      durationMinutes = Math.round((bEnd.getTime() - bStart.getTime()) / 60000);
                    } else if (slot.booking?.durationMinutes) {
                      durationMinutes = Number(slot.booking.durationMinutes);
                    }
                  } catch (e) {
                    durationMinutes = slot.booking?.durationMinutes ?? null;
                  }

                  const rowHeight = ROW_HEIGHT; // px por 1 hora
                  const pixelsPerMinute = rowHeight / 60;
                  const rawHeight = (durationMinutes ?? DEFAULT_DURATION_MINUTES) * pixelsPerMinute;
                  const height = Math.max(rawHeight - V_GAP_PX, 34);

                  const bookingName = slot.booking?.client?.name ?? 'Sin cliente vinculado';
                  const pendingByInsufficientPayment = Boolean(
                    slot.booking?.confirmationContext?.isPendingByInsufficientPayment
                  );

                  return (
                    <div
                      key={slot.booking.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setSelectedBookingDetail({
                          booking: slot.booking,
                          slotTime: slot.slotTime,
                          courtName: slot.courtName,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedBookingDetail({
                            booking: slot.booking,
                            slotTime: slot.slotTime,
                            courtName: slot.courtName,
                          });
                        }
                      }}
                      className={`absolute rounded-2xl border-l-4 ${getBookingBarClass(
                        slot
                      )} bg-white/95 p-2.5 text-left shadow-lg ring-1 ring-white/70 transition hover:shadow-xl flex flex-col cursor-pointer`}
                      style={{
                        top,
                        left,
                        width,
                        height,
                        minHeight: 56,
                      }}
                    >
                      <div className="text-[11px] font-black text-[#347048] uppercase tracking-wide truncate">
                        {bookingName}
                      </div>

                      <div className="mt-0.5 text-[9px] font-bold text-[#347048]/60">
                        {getBookingTimeRange(slot)}
                      </div>

                      {pendingByInsufficientPayment ? (
                        <div className="mt-2 inline-flex w-fit rounded-md border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-yellow-700">
                          Pago insuficiente
                        </div>
                      ) : null}

                      {slot.booking?.fixedBookingId && (
                        <div className="absolute top-1.5 right-1.5 bg-[#347048] text-[#B9CF32] text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-widest">
                          Fijo
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCancelBooking(slot.booking);
                          }}
                          className="p-1.5 rounded-lg bg-red-50 border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          title="Cancelar"
                        >
                          <Trash2 size={12} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 border-4 border-dashed border-[#347048]/10 rounded-[2rem]"><p className="text-[#347048]/40 font-black uppercase tracking-widest">Sin datos cargados para esta fecha</p></div>
        )}
      </div>
      )}

      {selectedBookingDetail && (
        <ModalPortal onClose={() => setSelectedBookingDetail(null)} maxWidthClass="max-w-5xl">
          <BookingManagerModal
            booking={selectedBookingDetail.booking}
            clubSlug={getClubSlug() || ''}
            courtName={selectedBookingDetail.courtName}
            onClose={() => setSelectedBookingDetail(null)}
            onCancelBooking={handleCancelBooking}
            onUpdated={() => loadSchedule()}
          />
        </ModalPortal>
      )}

      <RefundRequestModal
        show={showCancelRefundModal}
        title="Gestion de devolucion"
        maxAmount={cancelRefundPaidAmount}
        draft={cancelRefundDraft}
        zIndexClass="z-[2147483400]"
        onClose={handleCloseCancelRefundModal}
        onSubmit={handleSubmitCancelRefundModal}
        onChangeDraft={setCancelRefundDraft}
        closeLabel="Cancelar"
        submitLabel="Continuar"
      />

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} zIndexClass="z-[2147483500]" />
    </>
  );
}
