import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  getAdminSchedule,
  cancelBooking,
  createBooking,
  createFixedBooking,
  cancelFixedBooking,
  searchClients,
  getBookingFinancialSummary
} from '../../services/BookingService';
import { getAccountSummary, getOrCreateBookingAccount, registerPayment } from '../../services/AccountService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { ClubService } from '../../services/ClubService';
import AppModal from '../AppModal';
import BookingManagerModal from './BookingManagerModal';
import { useParams } from 'react-router-dom';
import DatePickerDark from '../../components/ui/DatePickerDark';
import { Trash2, Check, Calendar as CalendarIcon, RefreshCw, ChevronDown, CalendarPlus, Repeat, Banknote, CreditCard, X, Phone, IdCard, ChevronLeft, ChevronRight } from 'lucide-react'; 
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { formatTime24 } from '../../utils/dateTime';
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
const HEADER_HEIGHT = 64; // px reserved for court names header
const ROW_HEIGHT = 120; // px per hour row
const H_GAP_PX = 12; // horizontal gap between booking cards (px)
const V_GAP_PX = 10; // vertical gap between booking cards (px)

const toMinutes = (timeValue?: string | null) => {
  if (!timeValue) return null;
  const [hh, mm] = String(timeValue).split(':').map((value) => Number(value));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
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
  if (typeof document === 'undefined') return null;
  
  return createPortal(
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#347048]/85 p-4 animate-in fade-in duration-200"
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

type SplitPaymentDraft = {
  method: 'CASH' | 'TRANSFER' | 'MERCADO_PAGO' | 'CARD' | 'OTHER';
  amount: string;
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

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString()}`;

export default function AdminTabBookings() {
  const [courts, setCourts] = useState<any[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => getTodayLocalDate());
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'single' | 'split'>('single');
  const [splitPayments, setSplitPayments] = useState<SplitPaymentDraft[]>([{ method: 'CASH', amount: '' }]);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [selectedPaymentAccountId, setSelectedPaymentAccountId] = useState<string | null>(null);
  const [paymentRemainingTarget, setPaymentRemainingTarget] = useState(0);
  const [selectedBookingDetail, setSelectedBookingDetail] = useState<{ booking: any; slotTime: string; courtName?: string } | null>(null);
  const [showCancelRefundModal, setShowCancelRefundModal] = useState(false);
  const [cancelRefundPaidAmount, setCancelRefundPaidAmount] = useState(0);
  const [cancelRefundDraft, setCancelRefundDraft] = useState<RefundDraft>(() => buildDefaultRefundDraft('BOOKING_CANCELLATION', 0));
  const cancelRefundResolverRef = useRef<((value: CancelRefundDecision | null) => void) | null>(null);
  const params = useParams();
  const urlSlug = params.slug;
  const [clubBookingConfig, setClubBookingConfig] = useState<{
    bookingSimpleAdvanceDaysAdmin: number;
    allowAdminSkipSimpleAdvanceLimit: boolean;
  }>({
    bookingSimpleAdvanceDaysAdmin: 30,
    allowAdminSkipSimpleAdvanceLimit: false
  });

  const handleOpenPaymentModal = async (bookingId: number) => {
    setSelectedBookingId(bookingId);
    setPaymentMode('single');
    setSplitPayments([{ method: 'CASH', amount: '' }]);
    try {
      const account = await getOrCreateBookingAccount(bookingId);
      const summary = await getAccountSummary(account.id);
      setSelectedPaymentAccountId(account.id);
      setPaymentRemainingTarget(Number(summary?.remaining || 0));
    } catch {
      setSelectedPaymentAccountId(null);
      setPaymentRemainingTarget(0);
    }
    setShowPaymentModal(true);
  };

  const [manualBooking, setManualBooking] = useState({
    guestFirstName: '',
    guestLastName: '',
    guestPhone: '',
    guestDni: '',
    courtId: '',
    time: '',
    durationMinutes: DEFAULT_DURATION_MINUTES,
    isFixed: false,
    isProfessor: false,
    professorOverrideReason: '',
    dayOfWeek: '1',
    startDateBase: getTodayLocalDate()
  });

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
    if (manualBooking.isProfessor && !options.includes(60)) {
      return [60, ...options];
    }
    return options;
  }, [manualBooking.isProfessor, selectedActivityDurations]);

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
    const slotTimes = Array.from(
      new Set(
        scheduleBookings
          .map((slot) => String(slot?.slotTime || ''))
          .filter((slotTime) => /^\d{2}:\d{2}$/.test(slotTime))
      )
    );

    if (slotTimes.length === 0) {
      return CLUB_TIME_SLOTS;
    }

    return slotTimes.sort((a, b) => (toMinutes(a) ?? 0) - (toMinutes(b) ?? 0));
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
    } catch (e) { console.error(e); }
    return ''; 
  }, [urlSlug]);

  useEffect(() => {
    const loadClubConfig = async () => {
      try {
        const slug = getClubSlug();
        if (!slug) return;
        const club = await ClubService.getClubBySlug(slug);
        const rawAdvance = Number(club?.bookingSimpleAdvanceDaysAdmin);
        setClubBookingConfig({
          bookingSimpleAdvanceDaysAdmin:
            Number.isFinite(rawAdvance) && rawAdvance >= 0
              ? Math.floor(rawAdvance)
              : 30,
          allowAdminSkipSimpleAdvanceLimit: Boolean(club?.allowAdminSkipSimpleAdvanceLimit)
        });
      } catch {
        setClubBookingConfig({
          bookingSimpleAdvanceDaysAdmin: 30,
          allowAdminSkipSimpleAdvanceLimit: false
        });
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

  const loadCourts = useCallback(async () => {
    const slug = getClubSlug();
    if (!slug) {
      setCourts([]);
      return;
    }
    const data = await ClubAdminService.getCourts(slug);
    setCourts(Array.isArray(data) ? data : []);
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
      // Soporta tanto payload legacy HH:MM como el esquema actual en minutos.
      try {
        let sM: number | null = null;
        let eM: number | null = null;

        if (Number.isFinite(Number(booking.fixedBooking.startTimeMinutes)) && Number.isFinite(Number(booking.fixedBooking.endTimeMinutes))) {
          sM = Number(booking.fixedBooking.startTimeMinutes);
          eM = Number(booking.fixedBooking.endTimeMinutes);
        } else if (booking.fixedBooking.startTime && booking.fixedBooking.endTime) {
          const s = String(booking.fixedBooking.startTime).split(':').map(Number);
          const e = String(booking.fixedBooking.endTime).split(':').map(Number);
          if (s.length === 2 && e.length === 2) {
            sM = s[0] * 60 + s[1];
            eM = e[0] * 60 + e[1];
          }
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
    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    const dni = manualBooking.guestDni?.trim();
    const phone = manualBooking.guestPhone?.trim();
    const professorOverrideReason = String(manualBooking.professorOverrideReason || '').trim();
    const selectedActivityId = Number(selectedManualCourt?.activityTypeId || selectedManualCourt?.activityType?.id);
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos de cancha u horario'); return; }
    if (!Number.isInteger(selectedActivityId) || selectedActivityId <= 0) { showError('La cancha seleccionada no tiene actividad válida'); return; }
    if (!firstName || !lastName || !dni || !phone) { showError('Nombre, Apellido, DNI y Teléfono son obligatorios'); return; }
    if (manualBooking.isProfessor && professorOverrideReason.length < 10) { showError('Para ajuste de profesor, el motivo debe tener al menos 10 caracteres'); return; }
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
            selectedActivityId,
            dateBase,
            guestName,
            phoneToSend || undefined,
            dni,
            manualBooking.isProfessor,
            professorOverrideReason || undefined
          );
            showInfo('Turno fijo creado', 'Listo');
        } else {
            const guestData = { name: guestName, phone: phoneToSend, dni: dni, document: dni, dniNumber: dni };
            await createBooking(
              Number(manualBooking.courtId),
              selectedActivityId,
              dateBase,
              manualBooking.time,
              undefined,
              guestData,
              {
                asGuest: true,
                guestIdentifier: `admin_${dni}_${Date.now()}`,
                isProfessor: manualBooking.isProfessor,
                professorOverrideReason: professorOverrideReason || undefined,
                durationMinutes: manualBooking.durationMinutes,
                openAccount: true
              }
            );
            showInfo('Reserva simple creada', 'Listo');
        }
        loadSchedule();
        setManualBooking({ 
            guestFirstName: '', guestLastName: '', guestPhone: '', guestDni: '', 
      courtId: '', time: '', durationMinutes: manualDurationOptions[0] ?? DEFAULT_DURATION_MINUTES, isFixed: false, isProfessor: false, professorOverrideReason: '', dayOfWeek: '1', startDateBase: getTodayLocalDate() 
        });
    } catch (error: any) { showError('Error al reservar: ' + error.message); }
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

  const handleConfirmBooking = async (method: 'CASH' | 'TRANSFER' | 'MERCADO_PAGO' | 'CARD' | 'OTHER') => {
    if (!selectedBookingId || !selectedPaymentAccountId) return;
    try {
        const summary = await getAccountSummary(selectedPaymentAccountId);
        const remaining = Math.max(0, Number(summary?.remaining || 0));
        if (remaining <= 0.009) {
          showInfo('La cuenta ya está saldada.', 'Listo');
          setShowPaymentModal(false);
          return;
        }

        await registerPayment({
          accountId: selectedPaymentAccountId,
          amount: remaining,
          method
        });
        setShowPaymentModal(false);
        loadSchedule(); 
        showInfo('Cobro registrado correctamente.', "Listo");
    } catch (error) { alert('Error al confirmar'); }
  };

  const updateSplitPayment = (index: number, patch: Partial<SplitPaymentDraft>) => {
    setSplitPayments((prev) => prev.map((payment, idx) => (idx === index ? { ...payment, ...patch } : payment)));
  };

  const addSplitPaymentRow = () => {
    setSplitPayments((prev) => [...prev, { method: 'TRANSFER', amount: '' }]);
  };

  const removeSplitPaymentRow = (index: number) => {
    setSplitPayments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const splitEnteredTotal = splitPayments.reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);

  const splitTargetTotal = Number(paymentRemainingTarget || 0);
  const splitRemaining = splitTargetTotal - splitEnteredTotal;

  const handleConfirmSplitPayment = async () => {
    if (!selectedBookingId || !selectedPaymentAccountId) return;

    const parsedPayments = splitPayments
      .map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount)
      }))
      .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

    if (parsedPayments.length === 0) {
      showError('Ingresá al menos un monto válido para registrar el pago dividido.');
      return;
    }

    const summary = await getAccountSummary(selectedPaymentAccountId);
    const totalPending = Math.max(0, Number(summary?.remaining || 0));
    const enteredTotal = parsedPayments.reduce((sum, payment) => sum + payment.amount, 0);

    if (Math.abs(enteredTotal - totalPending) > 0.01) {
      showError('La suma de pagos debe ser exactamente igual al saldo pendiente.');
      return;
    }

    try {
      for (const payment of parsedPayments) {
        await registerPayment({
          accountId: selectedPaymentAccountId,
          amount: payment.amount,
          method: payment.method
        });
      }
      setShowPaymentModal(false);
      setPaymentMode('single');
      setSplitPayments([{ method: 'CASH', amount: '' }]);
      loadSchedule();
      showInfo('Pago dividido registrado correctamente.', 'Listo');
    } catch (error: any) {
      showError(error?.message || 'No se pudo registrar el pago dividido');
    }
  };

  return (
    <>
      {/* --- TARJETA DE CREACION DE RESERVA (BEIGE WIMBLEDON) --- */}
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
                  onChange={handleGuestFirstNameChange}
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
                                  {client.phoneNumber && (
                                    <span className="flex items-center gap-1">
                                      <Phone size={12} strokeWidth={2.5} /> {client.phoneNumber}
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

          {/* FECHA (Usa focus-within para tapar TODO al abrirse) */}
          <div className="relative focus-within:z-[100] z-20">
            <label className="block text-xs font-black text-[#347048]/60 uppercase tracking-wider mb-2 ml-1">Fecha</label>
            {manualBooking.isFixed ? (
              <div className="h-12 bg-white/50 border-2 border-dashed border-[#347048]/20 rounded-xl px-4 flex items-center">
                <span className="text-[#347048]/40 font-bold text-sm">Selecciona día abajo</span>
              </div>
            ) : (
              <div className="relative flex items-center justify-between bg-white rounded-xl px-2 py-2.5 border border-transparent shadow-sm h-[46px]">
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
                    inputClassName="w-full h-[46px] opacity-0 cursor-pointer"
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
                <span className="text-sm uppercase tracking-wide">Profesor (ajuste operativo de duración)</span>
              </label>
            </div>

            {manualBooking.isProfessor ? (
              <div className="w-full sm:max-w-md">
                <label className="block text-[10px] font-black text-[#347048]/50 mb-1 uppercase tracking-widest">Motivo del ajuste</label>
                <input
                  type="text"
                  minLength={10}
                  value={manualBooking.professorOverrideReason}
                  onChange={(e) => setManualBooking({ ...manualBooking, professorOverrideReason: e.target.value })}
                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                  placeholder="Ej: Profesor del club, excepción comercial"
                />
              </div>
            ) : null}

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
            <div className="flex items-center gap-2 px-3">
              <span className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Fecha:</span>
              <div className="relative flex items-center justify-between bg-white rounded-xl px-2 py-2.5 border border-transparent shadow-sm h-[46px] min-w-[280px]">
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
                    inputClassName="w-full h-[46px] opacity-0 cursor-pointer"
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
          <div className="space-y-4 py-10">
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
              <div className="h-16 bg-[#347048]/5 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : gridSlots.length > 0 ? (
          <div className="overflow-x-auto -mx-8">
            <div ref={gridScrollRef} className="min-w-[900px] pl-16 pr-8 max-h-[65vh] overflow-y-auto">
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
                    <span className="absolute -left-14 -top-3 px-2 text-[11px] font-black text-[#347048]/70">
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
                  const height = Math.max(rawHeight - V_GAP_PX, 40);

                  const bookingName = slot.booking?.client?.name ?? 'Sin cliente vinculado';
                  const pendingByInsufficientPayment = Boolean(
                    slot.booking?.confirmationContext?.isPendingByInsufficientPayment
                  );

                  return (
                    <button
                      key={slot.booking.id}
                      type="button"
                      onClick={() =>
                        setSelectedBookingDetail({
                          booking: slot.booking,
                          slotTime: slot.slotTime,
                          courtName: slot.courtName,
                        })
                      }
                      className={`absolute rounded-3xl border-l-[6px] ${getBookingBarClass(
                        slot
                      )} bg-white/95 p-3 text-left shadow-xl ring-1 ring-white/70 transition hover:shadow-2xl flex flex-col`}
                      style={{
                        top,
                        left,
                        width,
                        height,
                        minHeight: 80,
                      }}
                    >
                      <div className="text-xs font-black text-[#347048] uppercase tracking-wide truncate">
                        {bookingName}
                      </div>

                      <div className="mt-1 text-[10px] font-bold text-[#347048]/60">
                        {getBookingTimeRange(slot)}
                      </div>

                      {pendingByInsufficientPayment ? (
                        <div className="mt-2 inline-flex w-fit rounded-md border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-yellow-700">
                          Pago insuficiente
                        </div>
                      ) : null}

                      {slot.booking?.fixedBookingId && (
                        <div className="absolute top-2 right-2 bg-[#347048] text-[#B9CF32] text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-widest">
                          Fijo
                        </div>
                      )}
                      <div className="absolute bottom-3 right-3 flex items-center gap-2">
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
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 border-4 border-dashed border-[#347048]/10 rounded-[2rem]"><p className="text-[#347048]/40 font-black uppercase tracking-widest">Sin datos cargados para esta fecha</p></div>
        )}
      </div>

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

      {showPaymentModal && (
        <ModalPortal onClose={() => setShowPaymentModal(false)}>
          <div className="relative text-[#347048]">
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setPaymentMode('single');
              }}
              className="absolute right-0 top-0 -mt-2 -mr-2 bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
              title="Cerrar ventana"
            >
              <X size={20} strokeWidth={3} />
            </button>
            <div className="text-center mb-6">
              <h3 className="text-2xl font-black mb-2 uppercase tracking-tight italic">Cobrar Reserva</h3>
              <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest">
                {paymentMode === 'single' ? 'Selecciona el método de pago' : 'Ingresá múltiples pagos (debe sumar el total pendiente)'}
              </p>
              <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest mt-1">
                Saldo pendiente: ${paymentRemainingTarget.toLocaleString()}
              </p>
            </div>
            {paymentMode === 'single' ? (
              <>
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
                <button
                  onClick={() => setPaymentMode('split')}
                  className="w-full mt-3 py-3 bg-white border-2 border-[#347048]/20 hover:border-[#B9CF32] rounded-xl text-[#347048] font-black uppercase text-[10px] tracking-[0.2em]"
                >
                  Cargar pago dividido
                </button>
              </>
            ) : (
              <div className="space-y-3">
                {splitPayments.map((payment, index) => (
                  <div key={`split-payment-${index}`} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={payment.method}
                      onChange={(e) => updateSplitPayment(index, { method: e.target.value as 'CASH' | 'TRANSFER' | 'MERCADO_PAGO' | 'CARD' | 'OTHER' })}
                      className="col-span-5 h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-xs font-black uppercase tracking-wider"
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="TRANSFER">Digital</option>
                      <option value="MERCADO_PAGO">MercadoPago</option>
                      <option value="CARD">Tarjeta</option>
                      <option value="OTHER">Otro</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={payment.amount}
                      onChange={(e) => updateSplitPayment(index, { amount: e.target.value })}
                      className="col-span-5 h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-sm font-black"
                      placeholder="Monto"
                    />
                    <button
                      type="button"
                      onClick={() => removeSplitPaymentRow(index)}
                      className="col-span-2 h-11 rounded-xl border border-red-200 text-red-500 font-black text-xs"
                      disabled={splitPayments.length === 1}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addSplitPaymentRow}
                  className="w-full py-2.5 bg-white border border-[#347048]/20 rounded-xl text-[#347048] font-black uppercase text-[10px] tracking-[0.2em]"
                >
                  + Agregar pago
                </button>
                <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#347048]/70 flex items-center justify-between">
                  <span>Cargado: ${splitEnteredTotal.toLocaleString()}</span>
                  <span className={Math.abs(splitRemaining) <= 0.01 ? 'text-emerald-600' : 'text-[#926699]'}>
                    Restante: ${Math.abs(splitRemaining).toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('single')}
                    className="py-3 bg-white border-2 border-[#347048]/20 rounded-xl text-[#347048] font-black uppercase text-[10px] tracking-[0.2em]"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSplitPayment}
                    className="py-3 bg-[#347048] text-[#EBE1D8] rounded-xl font-black uppercase text-[10px] tracking-[0.2em]"
                  >
                    Confirmar split
                  </button>
                </div>
              </div>
            )}
          </div>
        </ModalPortal>
      )}

      <RefundRequestModal
        show={showCancelRefundModal}
        title="Gestion de devolucion"
        maxAmount={cancelRefundPaidAmount}
        draft={cancelRefundDraft}
        onClose={handleCloseCancelRefundModal}
        onSubmit={handleSubmitCancelRefundModal}
        onChangeDraft={setCancelRefundDraft}
        closeLabel="Cancelar"
        submitLabel="Continuar"
      />

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}

