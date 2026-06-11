"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { login as loginUser, requestMagicLink } from '../services/AuthService';
import AppModal from './AppModal';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService, Club } from '../services/ClubService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { useAuth } from '../contexts/AuthContext';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import { createBookingCheckoutDraftId, saveBookingCheckoutDraft } from '../utils/bookingCheckoutDraft';
import { ChevronDown, Check, Calendar, Clock, MapPin, Zap, MousePointerClick, Hourglass, Moon, Ban, AlertCircle, Activity, ChevronLeft, ChevronRight, LayoutGrid, Rows3, Info, Mail, Lock, Eye, EyeOff, LogIn, Loader2 } from 'lucide-react';

const apiBase = () => `${getApiUrl()}/api`;

interface BookingGridProps {
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
const TIMELINE_PIXELS_PER_MINUTE = 1.45;
const TIMELINE_ROW_HEIGHT = 52;
const TIMELINE_COURT_COLUMN_WIDTH = 150;
const MOBILE_LIST_ONLY_QUERY = '(max-width: 900px)';
const MOBILE_VISIBLE_SLOTS_LIMIT = 9;
type ScheduleViewMode = 'timeline' | 'list';

const normalizeActivityDurations = (raw: unknown, fallback: number) => {
  const parsed = Array.isArray(raw)
    ? raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    : [];
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [fallback];
};

const parseSlotToMinutes = (slot: string) => {
  const [h, m] = String(slot || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const formatHourFromMinutes = (minutesFromMidnight: number) => {
  const safe = Number(minutesFromMidnight);
  if (!Number.isFinite(safe)) return '--:--';
  const normalized = ((safe % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const normalizeSlotLabel = (slot: string) => {
  const parsed = parseSlotToMinutes(slot);
  if (parsed === null) return String(slot || '').trim();
  return formatHourFromMinutes(parsed);
};

// -- CUSTOM SELECT (theme-aware) --
const CustomSelect = ({ value, options, onChange, placeholder, centerLabel = false }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o: any) => o.value === value);

  return (
    <div style={{ position: 'relative', width: '100%', zIndex: isOpen ? 100 : 10 }} ref={wrapperRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: centerLabel ? 'center' : 'space-between',
          height: 46, padding: '0 14px',
          background: 'var(--surface-1)',
          border: `1px solid ${isOpen ? 'var(--accent-fg)' : 'var(--border)'}`,
          borderRadius: 'var(--r-lg)', cursor: 'pointer',
          boxShadow: isOpen ? 'var(--shadow-focus)' : 'var(--shadow-card)',
          transition: 'border-color .2s, box-shadow .2s',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 650, color: selectedOption ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-sans)', textAlign: centerLabel ? 'center' : 'left', width: centerLabel ? '100%' : 'auto', paddingRight: centerLabel ? 22 : 0 }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} style={{ color: isOpen ? 'var(--accent-fg)' : 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .3s, color .2s', flexShrink: 0, position: centerLabel ? 'absolute' : 'static', right: centerLabel ? 14 : undefined }} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: '100%',
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 110, overflow: 'hidden',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {options.map((opt: any) => (
            <div
              key={opt.value}
              onClick={() => { if (!opt.disabled) { onChange(opt.value); setIsOpen(false); } }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', cursor: opt.disabled ? 'not-allowed' : 'pointer',
                background: value === opt.value ? 'var(--positive-bg)' : 'transparent',
                opacity: opt.disabled ? 0.4 : 1,
                transition: 'background .15s',
              }}
              onMouseEnter={e => { if (!opt.disabled && value !== opt.value) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = value === opt.value ? 'var(--positive-bg)' : 'transparent'; }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: value === opt.value ? 'var(--accent-fg)' : 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
                {opt.label}
              </span>
              {opt.disabled && (
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--error-fg)', border: '1px solid var(--error-fg)', borderRadius: 6, padding: '2px 6px', letterSpacing: '.03em' }}>Sin stock</span>
              )}
              {!opt.disabled && value === opt.value && <Check size={13} style={{ color: 'var(--accent-fg)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function BookingGrid({ clubSlug }: BookingGridProps = {}) {
  const router = useRouter();
  const { isAuthenticated: hasAuthSession } = useAuth();

  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

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
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION_MINUTES);
  const [scheduleViewMode, setScheduleViewMode] = useState<ScheduleViewMode>('timeline');
  const [isMobileListOnly, setIsMobileListOnly] = useState(false);
  const [showAllMobileSlots, setShowAllMobileSlots] = useState(false);
  const [hoveredAtcSlot, setHoveredAtcSlot] = useState<{ courtId: number; slotTime: string } | null>(null);
  const [pendingSport, setPendingSport] = useState<string | null>(null);
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  const [queryApplied, setQueryApplied] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const courtsSectionRef = useRef<HTMLDivElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode;
    cancelText?: string; confirmText?: string; isWarning?: boolean;
    onConfirm?: () => void; onCancel?: () => void; confirmDisabled?: boolean;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean; blockManualClose?: boolean;
  }>({ show: false });
  const pendingAfterLoginActionRef = useRef<null | (() => void)>(null);
  const [loginModalEmail, setLoginModalEmail] = useState('');
  const [loginModalPassword, setLoginModalPassword] = useState('');
  const [loginModalError, setLoginModalError] = useState('');
  const [loginModalSuccess, setLoginModalSuccess] = useState('');
  const [loginModalLoading, setLoginModalLoading] = useState(false);
  const [loginModalMagicLoading, setLoginModalMagicLoading] = useState(false);
  const [loginModalShowPassword, setLoginModalShowPassword] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);

  // Theme tokens — avoids repeating ternaries throughout the JSX
  const T = useMemo(() => ({
    bg: 'var(--surface-1)',
    bgCard: 'var(--surface-1)',
    bgInput: 'var(--surface-2)',
    bgSubtle: 'var(--surface-2)',
    bgSubtle2: 'var(--surface-3)',
    border: 'var(--border)',
    borderSubtle: 'var(--border-subtle)',
    borderFaint: 'var(--border-subtle)',
    textPrimary: 'var(--text-primary)',
    textPrimary2: 'var(--text-primary)',
    textSecondary: 'var(--text-secondary)',
    textMuted: 'var(--text-muted)',
    textDisabled: 'var(--text-muted)',
    arrowDisabled: 'var(--border-strong)',
    spinnerTrack: 'var(--surface-3)',
    shadow: 'var(--shadow-card)',
    shadowModal: 'var(--shadow-lg)',
    backdrop: 'var(--overlay)',
    divider: 'var(--border)',
  }), []);

  const closeModal = useCallback(() => {
    setModalState(p => ({ ...p, show: false }));
  }, []);

  const resetLoginModalState = useCallback(() => {
    setLoginModalError('');
    setLoginModalSuccess('');
    setLoginModalLoading(false);
    setLoginModalMagicLoading(false);
    setLoginModalShowPassword(false);
  }, []);

  const closeLoginPromptModal = useCallback(() => {
    setIsLoginPromptOpen(false);
    resetLoginModalState();
    pendingAfterLoginActionRef.current = null;
  }, [resetLoginModalState]);

  const showInfo = useCallback((message: ReactNode, title = 'Información') => {
    setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK', onConfirm: closeModal, closeOnBackdrop: true, closeOnEscape: true, blockManualClose: false });
  }, [closeModal]);

  const showError = useCallback((message: ReactNode) => {
    setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar', onConfirm: closeModal, closeOnBackdrop: true, closeOnEscape: true, blockManualClose: false });
  }, [closeModal]);

  const openLoginModal = (afterLoginAction?: () => void) => {
    pendingAfterLoginActionRef.current = afterLoginAction || null;
    resetLoginModalState();
    setIsLoginPromptOpen(true);
  };

  const handleRequestLoginMagicLink = async () => {
    const safeEmail = String(loginModalEmail || '').trim();
    if (!safeEmail) {
      setLoginModalError('Ingresa tu email para enviar enlace.');
      return;
    }
    setLoginModalError('');
    setLoginModalSuccess('');
    setLoginModalMagicLoading(true);
    try {
      const data = await requestMagicLink(safeEmail);
      setLoginModalSuccess(data?.message || 'Si el email es valido, enviamos enlace de acceso.');
    } catch (err) {
      setLoginModalError(extractErrorMessage(err, 'No se pudo enviar el enlace.'));
    } finally {
      setLoginModalMagicLoading(false);
    }
  };

  const handleLoginFromModal = async () => {
    if (loginModalLoading) return;
    const safeEmail = String(loginModalEmail || '').trim();
    const safePassword = String(loginModalPassword || '');
    if (!safeEmail || !safePassword) { setLoginModalError('Completa email y contrasena.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) { setLoginModalError('Ingresa un email valido.'); return; }
    setLoginModalLoading(true);
    setLoginModalError('');
    setLoginModalSuccess('');
    try {
      await loginUser(safeEmail, safePassword);
      setIsAuthenticated(true);
      setIsLoginPromptOpen(false);
      resetLoginModalState();
      const pendingAction = pendingAfterLoginActionRef.current;
      pendingAfterLoginActionRef.current = null;
      if (pendingAction) { try { pendingAction(); } catch (err) { reportUiError({ area: 'BookingGrid', action: 'postLoginPendingAction' }, err); } }
    } catch (err) {
      const message = extractErrorMessage(err, 'No se pudo iniciar sesión.');
      setLoginModalError(message);
      const norm = message.toLowerCase();
      const isExpected = norm.includes('credenciales') || norm.includes('usuario o contrasena') || norm.includes('401');
      if (!isExpected) reportUiError({ area: 'BookingGrid', action: 'loginModalSubmit' }, err);
    } finally { setLoginModalLoading(false); }
  };

  useEffect(() => {
    if (!isLoginPromptOpen) return;
    const release = lockBodyScroll();
    return () => release();
  }, [isLoginPromptOpen]);

  useEffect(() => {
    if (!isLoginPromptOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loginModalLoading && !loginModalMagicLoading) {
        closeLoginPromptModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeLoginPromptModal, isLoginPromptOpen, loginModalLoading, loginModalMagicLoading]);

  const buildBookingSummaryMessage = (params: {
    courtName: string; activityName: string; start: Date; end: Date;
    durationMinutes: number; price: number; listPrice?: number; discountAmount?: number;
    nightSurcharge?: { applied: boolean; amount: number; fromHour?: string | null };
  }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Tu reserva fue registrada con éxito.</p>
      <div style={{ background: 'var(--accent-bg-faint)', border: '1px solid var(--accent-bg-muted)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          ['Cancha', params.courtName],
          ['Actividad', params.activityName],
          ['Fecha', params.start.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })],
          ['Horario', `${params.start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${params.end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`],
          ['Duración', `${params.durationMinutes} min`],
          ['Precio', `$${params.price.toLocaleString()}`],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary }}>{val}</span>
          </div>
        ))}
        {Number(params.discountAmount || 0) > 0.009 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>Descuento</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--brand)' }}>-${Number(params.discountAmount || 0).toLocaleString()}</span>
          </div>
        )}
        {params.nightSurcharge?.applied && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>Recargo nocturno</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary }}>+${Number(params.nightSurcharge.amount || 0).toLocaleString()}{params.nightSurcharge.fromHour ? ` (desde ${params.nightSurcharge.fromHour})` : ''}</span>
          </div>
        )}
      </div>
    </div>
  );

  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const STORAGE_PREFIX = 'disabledSlots:';
  const [allCourts, setAllCourts] = useState<CourtSummary[]>([]);
  const activeCourts = useMemo(() => allCourts.filter((c: any) => !c?.isUnderMaintenance), [allCourts]);
  const [clubConfig, setClubConfig] = useState<Club | null>(null);

  const normalizeText = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const getCourtActivityName = (court: { activityType?: { name?: string } | null }) => String(court?.activityType?.name || '');

  const selectedActivityId = useMemo(() => {
    if (selectedCourt?.activityType?.id) return Number(selectedCourt.activityType.id);
    if (selectedActivityFilter) {
      const m = activeCourts.find(c => getCourtActivityName(c as any) === selectedActivityFilter && c?.activityType?.id);
      if (m?.activityType?.id) return Number(m.activityType.id);
    }
    const first = activeCourts.find(c => Number(c?.activityType?.id) > 0);
    return first?.activityType?.id ? Number(first.activityType.id) : null;
  }, [selectedCourt, selectedActivityFilter, activeCourts]);

  const selectedActivityDurations = useMemo(() => {
    if (!Number.isFinite(selectedActivityId) || Number(selectedActivityId) <= 0) return [DEFAULT_DURATION_MINUTES];
    const matched = activeCourts.find(c => Number(c?.activityType?.id) === Number(selectedActivityId));
    const fallback = Number(matched?.activityType?.defaultDurationMinutes);
    const safeFallback = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_DURATION_MINUTES;
    return normalizeActivityDurations(matched?.activityType?.scheduleDurations, safeFallback);
  }, [activeCourts, selectedActivityId]);

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate, selectedActivityId, clubSlug, selectedDuration);
  const durationOptions = useMemo(() => selectedActivityDurations, [selectedActivityDurations]);
  const activeScheduleViewMode: ScheduleViewMode = isMobileListOnly ? 'list' : scheduleViewMode;

  useEffect(() => { setIsAuthenticated(Boolean(hasAuthSession)); }, [hasAuthSession]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_LIST_ONLY_QUERY);
    const syncViewportMode = (matches: boolean) => setIsMobileListOnly(matches);
    syncViewportMode(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => syncViewportMode(event.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
    mediaQuery.addListener(listener);
    return () => mediaQuery.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!isMobileListOnly) return;
    if (scheduleViewMode !== 'list') {
      setScheduleViewMode('list');
    }
  }, [isMobileListOnly, scheduleViewMode]);

  useEffect(() => {
    if (!router.isReady || queryApplied) return;
    const { date, time, sport } = router.query;
    if (typeof date === 'string') {
      const [y, m, d] = date.split('-').map(Number);
      if (y && m && d) { const pd = new Date(y, m - 1, d); if (!Number.isNaN(pd.getTime())) setSelectedDate(pd); }
    }
    if (typeof time === 'string') setPendingTime(time);
    if (typeof sport === 'string') setPendingSport(sport);
    setQueryApplied(true);
  }, [router.isReady, router.query, queryApplied]);

  useEffect(() => {
    if (!clubSlug) { setClubConfig(null); return; }
    ClubService.getClubBySlug(clubSlug).then(setClubConfig).catch(err => { reportUiError({ area: 'BookingGrid', action: 'loadClubConfig' }, err); setClubConfig(null); });
  }, [clubSlug]);

  const bookingAdvanceLimitDays = useMemo(() => {
    const raw = Number(clubConfig?.bookingSimpleAdvanceDaysUser);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 30;
  }, [clubConfig?.bookingSimpleAdvanceDaysUser]);

  const maxAllowedDate = useMemo(() => {
    const today = getTodayDate();
    const max = new Date(today);
    max.setDate(max.getDate() + bookingAdvanceLimitDays);
    return max;
  }, [bookingAdvanceLimitDays]);

  useEffect(() => {
    if (!selectedDate) return;
    const clamped = clampToDateRange(selectedDate, getTodayDate(), maxAllowedDate);
    if (clamped.getTime() !== selectedDate.getTime()) { setSelectedDate(clamped); setSelectedSlot(null); setSelectedCourt(null); }
  }, [selectedDate, maxAllowedDate]);

  useEffect(() => {
    if (durationOptions.includes(selectedDuration)) return;
    setSelectedDuration(durationOptions[0]);
    setSelectedSlot(null);
    setSelectedCourt(null);
  }, [durationOptions, selectedDuration]);

  const filteredSlotsWithCourts = (() => {
    if (!selectedDate) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    if (selected < today) return [];
    if (selected.getTime() === today.getTime()) {
      return slotsWithCourts.filter(s => {
        const [h, min] = s.slotTime.split(':').map(Number);
        const slotDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, min, 0, 0);
        return slotDate.getTime() > now.getTime();
      });
    }
    return slotsWithCourts;
  })();

  const isSlotDisabledForDate = useCallback((dateStr: string, slotTime: string, courtId: number) => {
    const normalizedSlotTime = normalizeSlotLabel(slotTime);
    return Boolean(
      disabledSlots[`${dateStr}-${slotTime}-${courtId}`] ||
      disabledSlots[`${dateStr}-${normalizedSlotTime}-${courtId}`]
    );
  }, [disabledSlots]);

  const availableSlots = useMemo(() => {
    if (!selectedDate) return [] as Array<{ slotTime: string; courts: CourtSummary[] }>;
    const dateStr = formatLocalDate(selectedDate);
    return filteredSlotsWithCourts
      .map(slot => ({
        slotTime: slot.slotTime,
        courts: slot.availableCourts.filter(c => !isSlotDisabledForDate(dateStr, slot.slotTime, Number(c.id)))
      }))
      .filter(slot => slot.courts.length > 0);
  }, [filteredSlotsWithCourts, isSlotDisabledForDate, selectedDate]);

  const visibleListSlots = useMemo(() => {
    if (activeScheduleViewMode !== 'list') return availableSlots;
    if (!isMobileListOnly) return availableSlots;
    return showAllMobileSlots ? availableSlots : availableSlots.slice(0, MOBILE_VISIBLE_SLOTS_LIMIT);
  }, [activeScheduleViewMode, availableSlots, isMobileListOnly, showAllMobileSlots]);

  useEffect(() => {
    if (!selectedSlot) return;
    if (!availableSlots.some(s => s.slotTime === selectedSlot)) { setSelectedSlot(null); setSelectedCourt(null); }
  }, [availableSlots, selectedSlot]);

  useEffect(() => {
    setShowAllMobileSlots(false);
  }, [selectedDate, selectedActivityFilter, selectedDuration, selectedActivityId]);

  useEffect(() => {
    if (!isMobileListOnly || showAllMobileSlots || !selectedSlot) return;
    const selectedIsVisible = availableSlots
      .slice(0, MOBILE_VISIBLE_SLOTS_LIMIT)
      .some((slot) => slot.slotTime === selectedSlot);
    if (!selectedIsVisible) {
      setShowAllMobileSlots(true);
    }
  }, [availableSlots, isMobileListOnly, selectedSlot, showAllMobileSlots]);

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

  const bookingReview = useMemo(() => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return null;
    const [hours, minutes] = selectedSlot.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0, 0);
    const end = new Date(start.getTime() + selectedDuration * 60000);
    const activityName = String(selectedCourt.activityType?.name || selectedActivityFilter || 'Actividad');
    const courtName = String(selectedCourt.name || `Cancha ${selectedCourt.id}`);
    const price = Number(priceInfo.final || 0);
    const listPrice = Number(priceInfo.list || price || 0);
    const discountAmount = Math.max(0, Number((listPrice - price).toFixed(2)));
    return {
      courtName,
      activityName,
      start,
      end,
      dateLabel: start.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }),
      shortDateLabel: start.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      timeLabel: `${start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
      durationLabel: `${selectedDuration} min`,
      price,
      listPrice,
      discountAmount,
      hasLights: Boolean(priceInfo.hasLights),
      lightsAmount: Number(priceInfo.extra || 0),
      lightsFromHour: clubConfig?.lightsFromHour || null,
    };
  }, [
    clubConfig?.lightsFromHour,
    priceInfo.extra,
    priceInfo.final,
    priceInfo.hasLights,
    priceInfo.list,
    selectedActivityFilter,
    selectedCourt,
    selectedDate,
    selectedDuration,
    selectedSlot,
  ]);

  const openCheckout = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt || !bookingReview) return;
    const bookingActivityId = Number(selectedCourt.activityType?.id || selectedActivityId || 0);
    if (!Number.isFinite(bookingActivityId) || bookingActivityId <= 0) {
      showError('No se pudo identificar la actividad de la cancha seleccionada.');
      return;
    }

    const draftId = createBookingCheckoutDraftId();
    const draftSaved = saveBookingCheckoutDraft({
      id: draftId,
      clubSlug: clubSlug || null,
      courtId: Number(selectedCourt.id),
      courtName: bookingReview.courtName,
      activityId: bookingActivityId,
      activityName: bookingReview.activityName,
      date: formatLocalDate(selectedDate),
      slotTime: selectedSlot,
      durationMinutes: selectedDuration,
      price: bookingReview.price,
      listPrice: bookingReview.listPrice,
      discountAmount: bookingReview.discountAmount,
      lightsExtraApplied: bookingReview.lightsAmount,
      lightsFromHour: bookingReview.lightsFromHour || null,
      createdAt: new Date().toISOString(),
    });
    if (!draftSaved) {
      showError('No pudimos preparar el checkout. Intentá nuevamente.');
      return;
    }
    void router.push(`/checkout?draft=${encodeURIComponent(draftId)}`);
  };

  const handleBooking = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    if (!hasAuthSession || !isAuthenticated) {
      setIsAuthenticated(false);
      openLoginModal(() => { openCheckout(); });
      return;
    }
    setIsAuthenticated(true);
    openCheckout();
  };

  useEffect(() => {
    if (!selectedDate) return;
    const dateStr = formatLocalDate(selectedDate);
    const key = `${STORAGE_PREFIX}${dateStr}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) setDisabledSlots(prev => ({ ...prev, ...JSON.parse(stored) }));
    } catch (err) { reportUiError({ area: 'BookingGrid', action: 'loadDisabledSlotsFromStorage' }, err); }
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    const dateStr = formatLocalDate(selectedDate);
    const key = `${STORAGE_PREFIX}${dateStr}`;
    try {
      const obj = Object.fromEntries(Object.entries(disabledSlots).filter(([k]) => k.startsWith(`${dateStr}-`)));
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (err) { reportUiError({ area: 'BookingGrid', action: 'saveDisabledSlotsToStorage' }, err); }
  }, [disabledSlots, selectedDate]);

  useEffect(() => {
    if (!selectedSlot || !selectedCourt) return;
    confirmButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot, selectedCourt]);

  useEffect(() => {
    if (!selectedSlot) return;
    courtsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot]);

  useEffect(() => {
    const fetchCourts = async () => {
      try {
        const url = clubSlug ? `${apiBase()}/courts?clubSlug=${encodeURIComponent(clubSlug)}` : `${apiBase()}/courts`;
        const res = await fetch(url);
        if (!res.ok) { showError('No se pudieron cargar las canchas disponibles. Reintentá en unos segundos.'); return; }
        setAllCourts(await res.json());
      } catch (err) { reportUiError({ area: 'BookingGrid', action: 'loadCourts' }, err); showError('No se pudieron cargar las canchas disponibles.'); }
    };
    fetchCourts();
  }, [clubSlug, showError]);

  useEffect(() => {
    if (!pendingSport || activeCourts.length === 0) return;
    const names = Array.from(new Set(activeCourts.map(c => getCourtActivityName(c)).filter(Boolean)));
    const norm = normalizeText(pendingSport);
    const matched = names.find(n => normalizeText(n) === norm);
    if (matched) setSelectedActivityFilter(matched);
    setPendingSport(null);
  }, [pendingSport, activeCourts]);

  useEffect(() => {
    if (pendingSport || activeCourts.length === 0) return;
    const unique = Array.from(new Set(activeCourts.map(c => getCourtActivityName(c)).filter(Boolean)));
    if (unique.length === 1 && !selectedActivityFilter) setSelectedActivityFilter(unique[0]);
  }, [activeCourts, pendingSport, selectedActivityFilter]);

  useEffect(() => {
    if (!pendingTime || availableSlots.length === 0) return;
    if (availableSlots.find(s => s.slotTime === pendingTime)) { setSelectedSlot(pendingTime); setPendingTime(null); }
  }, [pendingTime, availableSlots]);

  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateStr = formatLocalDate(selectedDate);
    setDisabledSlots(prev => {
      const next = { ...prev };
      slotsWithCourts.forEach(slot => {
        const availIds = new Set(slot.availableCourts.map(c => c.id));
        const toInspect = activeCourts.length > 0 ? activeCourts : slot.availableCourts;
        toInspect.forEach(court => {
          const key = `${dateStr}-${slot.slotTime}-${court.id}`;
          if (!availIds.has(court.id)) next[key] = true;
          else delete next[key];
        });
      });
      return next;
    });
  }, [slotsWithCourts, activeCourts, selectedDate]);

  const isPrevDisabled = () => {
    const today = getTodayDate();
    const cur = new Date(selectedDate);
    cur.setHours(0, 0, 0, 0);
    return cur <= today;
  };

  const handlePrevDay = () => {
    if (isPrevDisabled()) return;
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const isNextDisabled = () => {
    if (!selectedDate) return true;
    const cur = new Date(selectedDate); cur.setHours(0, 0, 0, 0);
    const max = new Date(maxAllowedDate); max.setHours(0, 0, 0, 0);
    return cur >= max;
  };

  const handleNextDay = () => {
    if (isNextDisabled()) return;
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const getFormattedDate = (date: Date) => {
    const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    return `${days[date.getDay()]} ${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  const availableActivities = useMemo(() => {
    return Array.from(new Set(activeCourts.map(c => getCourtActivityName(c)).filter(Boolean)));
  }, [activeCourts]);

  useEffect(() => {
    if (availableActivities.length === 1 && !selectedActivityFilter) setSelectedActivityFilter(availableActivities[0]);
  }, [availableActivities, selectedActivityFilter]);

  const handleSelectAtcSlot = (court: CourtSummary, slotTime: string) => {
    if (!selectedDate) return;
    const dateStr = formatLocalDate(selectedDate);
    const slotKey = `${dateStr}-${slotTime}-${court.id}`;
    const slot = availableSlots.find(s => s.slotTime === slotTime);
    const isStillAvailable = Boolean(slot?.courts.some(c => c.id === court.id));
    if (!isStillAvailable) {
      setDisabledSlots(prev => ({ ...prev, [slotKey]: true }));
      showError('Cancha ya no disponible.');
      return;
    }
    setSelectedSlot(slotTime);
    setSelectedCourt(court);
  };

  const atcCourts = useMemo(() => {
    if (!selectedActivityFilter) return [] as CourtSummary[];
    return activeCourts.filter(c => getCourtActivityName(c as any) === selectedActivityFilter);
  }, [activeCourts, selectedActivityFilter]);

  const atcRawSlotStarts = useMemo(() => {
    return Array.from(
      new Set(
        filteredSlotsWithCourts
          .map(slot => parseSlotToMinutes(slot.slotTime))
          .filter((value): value is number => value !== null)
      )
    ).sort((a, b) => a - b);
  }, [filteredSlotsWithCourts]);

  const atcStepMinutes = useMemo(() => {
    if (atcRawSlotStarts.length < 2) return 30;
    let minDiff = Number.POSITIVE_INFINITY;
    for (let index = 1; index < atcRawSlotStarts.length; index += 1) {
      const diff = atcRawSlotStarts[index] - atcRawSlotStarts[index - 1];
      if (diff > 0 && diff < minDiff) minDiff = diff;
    }
    if (!Number.isFinite(minDiff)) return 30;
    return Math.max(5, Math.min(120, minDiff));
  }, [atcRawSlotStarts]);

  const atcSlotStarts = useMemo(() => {
    // Use raw slot starts directly so grid rows map 1:1 to real API slots.
    // The previous "aligned" expansion shifted rows by up to (step-1) minutes,
    // causing atcCourtSlots to look up times that don't exist in
    // atcAvailabilityByTime → all slots rendered grey.
    return atcRawSlotStarts;
  }, [atcRawSlotStarts]);

  const atcAvailabilityByTime = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!selectedDate) return map;
    const dateStr = formatLocalDate(selectedDate);
    filteredSlotsWithCourts.forEach(slot => {
      // Normalize so '9:00' and '09:00' map to the same entry.
      // atcCourtSlots looks up via formatHourFromMinutes (zero-padded);
      // fixed-slot clubs may return unpadded times from the API.
      const normalizedTime = normalizeSlotLabel(slot.slotTime);
      const availableIds = slot.availableCourts
        .map(c => Number(c.id))
        .filter(id =>
          !disabledSlots[`${dateStr}-${slot.slotTime}-${id}`] &&
          !disabledSlots[`${dateStr}-${normalizedTime}-${id}`]
        );
      map.set(normalizedTime, new Set(availableIds));
    });
    return map;
  }, [filteredSlotsWithCourts, selectedDate, disabledSlots]);

  const atcCourtSlots = useMemo(() => {
    const map = new Map<number, Array<{ slotTime: string; minute: number; available: boolean }>>();
    atcCourts.forEach(court => {
      const rows = atcSlotStarts.map(minute => {
        const slotTime = formatHourFromMinutes(minute);
        const isAvailable = Boolean(atcAvailabilityByTime.get(slotTime)?.has(Number(court.id)));
        return { slotTime, minute, available: isAvailable };
      });
      map.set(Number(court.id), rows);
    });
    return map;
  }, [atcCourts, atcSlotStarts, atcAvailabilityByTime]);

  const atcTimeline = useMemo(() => {
    if (atcSlotStarts.length === 0) return null;
    const first = atcSlotStarts[0];
    const last = atcSlotStarts[atcSlotStarts.length - 1] + selectedDuration;
    const startMinute = Math.floor(first / 60) * 60;
    const endMinute = Math.ceil(last / 60) * 60;
    const totalMinutes = Math.max(60, endMinute - startMinute);
    const hourTicks: number[] = [];
    for (let cursor = startMinute; cursor <= endMinute; cursor += 60) {
      hourTicks.push(cursor);
    }
    return { startMinute, endMinute, totalMinutes, hourTicks };
  }, [atcSlotStarts, selectedDuration]);

  const atcCourtBlockedDisplayRanges = useMemo(() => {
    const map = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
    if (!atcTimeline) return map;

    atcCourts.forEach(court => {
      const availableIntervals = (atcCourtSlots.get(Number(court.id)) || [])
        .filter(slot => slot.available)
        .map(slot => ({ startMinute: slot.minute, endMinute: slot.minute + selectedDuration }))
        .sort((a, b) => a.startMinute - b.startMinute);

      const merged: Array<{ startMinute: number; endMinute: number }> = [];
      for (const interval of availableIntervals) {
        const start = Math.max(atcTimeline.startMinute, interval.startMinute);
        const end = Math.min(atcTimeline.endMinute, interval.endMinute);
        if (end <= start) continue;
        if (merged.length === 0) {
          merged.push({ startMinute: start, endMinute: end });
          continue;
        }
        const last = merged[merged.length - 1];
        if (start <= last.endMinute) {
          last.endMinute = Math.max(last.endMinute, end);
        } else {
          merged.push({ startMinute: start, endMinute: end });
        }
      }

      const blocked: Array<{ startMinute: number; endMinute: number }> = [];
      let cursor = atcTimeline.startMinute;
      for (const interval of merged) {
        if (interval.startMinute > cursor) {
          blocked.push({ startMinute: cursor, endMinute: interval.startMinute });
        }
        cursor = Math.max(cursor, interval.endMinute);
      }
      if (cursor < atcTimeline.endMinute) {
        blocked.push({ startMinute: cursor, endMinute: atcTimeline.endMinute });
      }
      map.set(Number(court.id), blocked);
    });

    return map;
  }, [atcCourts, atcCourtSlots, atcTimeline, selectedDuration]);

  useEffect(() => {
    setHoveredAtcSlot(null);
  }, [selectedDate, selectedActivityFilter, selectedDuration, activeScheduleViewMode]);

  const canConfirm = Boolean(selectedSlot && selectedCourt);
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: T.textMuted, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontFamily: "'Geist',system-ui,sans-serif" };
  const sectionStyle: React.CSSProperties = { marginBottom: 28 };

  return (
    <div style={{ width: '100%', minWidth: 0, background: T.bg, border: `1px solid ${T.borderSubtle}`, borderRadius: 24, padding: isMobileListOnly ? '24px 20px 20px' : '28px 28px 24px', fontFamily: "'Geist',system-ui,sans-serif", boxSizing: 'border-box', boxShadow: T.shadow, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: `1px solid ${T.borderSubtle}` }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: T.textPrimary, letterSpacing: '-.03em', margin: '0 0 4px' }}>
          Reservar <span style={{ fontStyle: 'italic', color: 'var(--brand)' }}>cancha</span>
        </h2>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontWeight: 500 }}>Elegí deporte, día y horario</p>
      </div>

      {/* Filters row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobileListOnly ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 14, marginBottom: 24 }}>

        {/* Deporte */}
        <div style={{ position: 'relative', zIndex: 20, minWidth: 0 }}>
          <div style={labelStyle}><Activity size={12} style={{ color: 'var(--brand)' }} /> Deporte</div>
          <CustomSelect
            value={selectedActivityFilter}
            onChange={(val: string) => { setSelectedActivityFilter(val); setSelectedSlot(null); setSelectedCourt(null); }}
            placeholder="Seleccioná"
            centerLabel={isMobileListOnly}
            options={availableActivities.map(n => ({ value: n, label: n }))}
          />
        </div>

        {/* Fecha */}
        <div style={{ minWidth: 0 }}>
          <div style={labelStyle}><Calendar size={12} style={{ color: 'var(--brand)' }} /> Fecha</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 46, padding: '0 6px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadow }}>
            <button
              type="button"
              onClick={handlePrevDay}
              disabled={isPrevDisabled()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'none', border: 'none', cursor: isPrevDisabled() ? 'not-allowed' : 'pointer', color: isPrevDisabled() ? T.arrowDisabled : T.textMuted, borderRadius: 8, transition: 'color .15s, background .15s' }}
            >
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, textAlign: 'center', letterSpacing: '.02em' }}>
              {getFormattedDate(selectedDate)}
            </span>
            <button
              type="button"
              onClick={handleNextDay}
              disabled={isNextDisabled()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'none', border: 'none', cursor: isNextDisabled() ? 'not-allowed' : 'pointer', color: isNextDisabled() ? T.arrowDisabled : T.textMuted, borderRadius: 8, transition: 'color .15s' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Duración */}
        <div style={{ position: 'relative', zIndex: 10, minWidth: 0 }}>
          <div style={labelStyle}><Clock size={12} style={{ color: 'var(--brand)' }} /> Duración</div>
          <CustomSelect
            value={selectedDuration}
            onChange={(val: number) => { setSelectedDuration(Number(val)); setSelectedSlot(null); setSelectedCourt(null); }}
            placeholder="Duración"
            centerLabel={isMobileListOnly}
            options={durationOptions.map(d => ({ value: d, label: `${d} min` }))}
          />
        </div>

      </div>

      {/* View mode */}
      {!isMobileListOnly && (
        <div style={{ marginBottom: 16 }}>
          <style>{`
            .v-view-toggle-group{display:inline-flex;padding:4px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);gap:4px;}
            .v-view-toggle{border:1px solid transparent;border-radius:9px;padding:8px 12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;font-weight:800;letter-spacing:.01em;font-family:'Geist',system-ui,sans-serif;background:transparent;color:var(--text-secondary);outline:none;transition:background-color .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease;}
            .v-view-toggle:hover{background:var(--surface-1);border-color:var(--border);color:var(--text-primary);}
            .v-view-toggle:focus{outline:none;}
            .v-view-toggle:focus-visible{box-shadow:var(--shadow-focus);border-color:var(--accent-border);}
            .v-view-toggle[aria-pressed="true"]{background:var(--surface-1);border-color:var(--accent-border);color:var(--accent-fg);}
          `}</style>
          <div className="v-view-toggle-group">
            <button
              type="button"
              onClick={() => setScheduleViewMode('timeline')}
              className="v-view-toggle"
              aria-pressed={scheduleViewMode === 'timeline'}
            >
              <LayoutGrid size={12} /> Agenda visual
            </button>
            <button
              type="button"
              onClick={() => setScheduleViewMode('list')}
              className="v-view-toggle"
              aria-pressed={scheduleViewMode === 'list'}
            >
              <Rows3 size={12} /> Lista clásica
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ ...sectionStyle, marginTop: 0 }}>
          <div style={labelStyle}>
            <Clock size={12} style={{ color: 'var(--brand)' }} />
            {activeScheduleViewMode === 'timeline' ? 'Agenda de canchas' : 'Horarios disponibles'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '36px 0', border: `1px dashed ${T.borderSubtle}`, borderRadius: 16, background: T.bgSubtle }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${T.spinnerTrack}`, borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'bg-spin .8s linear infinite' }} />
            <style>{`@keyframes bg-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'var(--error-bg)', border: '1px solid var(--error-bg)', borderRadius: 14, fontSize: 13, fontWeight: 600, color: 'var(--error-fg)', marginBottom: 20 }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* Slots */}
      {!loading && availableSlots.length > 0 && (
        <div style={sectionStyle}>
          <div style={labelStyle}>
            <Clock size={12} style={{ color: 'var(--brand)' }} />
            {activeScheduleViewMode === 'timeline' ? 'Agenda de canchas' : 'Horarios disponibles'}
          </div>

          {!selectedActivityFilter ? (
            <div style={{ textAlign: 'center', padding: '32px 20px', background: T.bgSubtle, border: `1px dashed ${T.borderSubtle}`, borderRadius: 16, fontSize: 13, fontWeight: 600, color: T.textDisabled }}>
              Elegí un deporte para ver los horarios.
            </div>
          ) : activeScheduleViewMode === 'timeline' ? (
            atcTimeline && atcCourts.length > 0 ? (
              <>
                <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 16, overflow: 'hidden', background: T.bgSubtle }}>
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: 280 + atcTimeline.totalMinutes * TIMELINE_PIXELS_PER_MINUTE }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `${TIMELINE_COURT_COLUMN_WIDTH}px 1fr`, borderBottom: `1px solid ${T.borderSubtle}` }}>
                        <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 800, color: T.textPrimary }}>Canchas</div>
                        <div style={{ position: 'relative', height: 38 }}>
                          {atcTimeline.hourTicks.map((tick, index) => {
                            const isFirstTick = index === 0;
                            const isLastTick = index === atcTimeline.hourTicks.length - 1;
                            const left = (tick - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE;
                            return (
                              <div key={tick} style={{ position: 'absolute', left, top: 0, bottom: 0, borderLeft: `1px solid ${T.borderSubtle}` }}>
                                <span
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    fontSize: 12,
                                    color: T.textMuted,
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                    left: isFirstTick ? 6 : isLastTick ? -6 : 0,
                                    transform: isFirstTick ? 'none' : isLastTick ? 'translateX(-100%)' : 'translateX(-50%)',
                                  }}
                                >
                                  {formatHourFromMinutes(tick)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {atcCourts.map(court => {
                        const courtSlots = atcCourtSlots.get(Number(court.id)) || [];
                        const blockedRanges = atcCourtBlockedDisplayRanges.get(Number(court.id)) || [];
                        const selectedSlotData = courtSlots.find(slot =>
                          slot.available &&
                          selectedCourt?.id === Number(court.id) &&
                          selectedSlot === slot.slotTime
                        );
                        const hoveredSlotData = courtSlots.find(slot =>
                          slot.available &&
                          hoveredAtcSlot?.courtId === Number(court.id) &&
                          hoveredAtcSlot?.slotTime === slot.slotTime
                        );
                        return (
                          <div key={court.id} style={{ display: 'grid', gridTemplateColumns: `${TIMELINE_COURT_COLUMN_WIDTH}px 1fr`, borderBottom: `1px solid ${T.borderFaint}` }}>
                            <div style={{ padding: '10px 14px', minHeight: TIMELINE_ROW_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: `1px solid ${T.borderSubtle}` }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary2 }}>{court.name}</span>
                              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>
                                {court.price ? `$${court.price.toLocaleString()} · ${selectedDuration} min` : `Duración ${selectedDuration} min`}
                              </span>
                            </div>

                            <div
                              style={{ position: 'relative', minHeight: TIMELINE_ROW_HEIGHT }}
                              onMouseMove={event => {
                                const rowRect = event.currentTarget.getBoundingClientRect();
                                const relativeX = Math.max(0, Math.min(event.clientX - rowRect.left, rowRect.width));
                                const minuteAtCursor = atcTimeline.startMinute + relativeX / TIMELINE_PIXELS_PER_MINUTE;
                                const matchingSlots = courtSlots
                                  .filter(slot => slot.available && minuteAtCursor >= slot.minute && minuteAtCursor < slot.minute + selectedDuration)
                                  .sort((a, b) => a.minute - b.minute);
                                if (matchingSlots.length === 0) {
                                  setHoveredAtcSlot(current => (current?.courtId === Number(court.id) ? null : current));
                                  return;
                                }
                                const slot = matchingSlots[0];
                                setHoveredAtcSlot(current => {
                                  if (current?.courtId === Number(court.id) && current?.slotTime === slot.slotTime) return current;
                                  return { courtId: Number(court.id), slotTime: slot.slotTime };
                                });
                              }}
                              onClick={() => {
                                if (hoveredAtcSlot?.courtId !== Number(court.id)) return;
                                handleSelectAtcSlot(court, hoveredAtcSlot.slotTime);
                              }}
                              onMouseLeave={() => setHoveredAtcSlot(current => (current?.courtId === Number(court.id) ? null : current))}
                            >
                              {atcTimeline.hourTicks.map(tick => (
                                <div key={`${court.id}-${tick}`} style={{ position: 'absolute', left: (tick - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE, top: 0, bottom: 0, borderLeft: `1px solid ${T.borderFaint}` }} />
                              ))}
                              {blockedRanges.map((range, rangeIndex) => {
                                const left = (range.startMinute - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE + 2;
                                const width = Math.max(8, (range.endMinute - range.startMinute) * TIMELINE_PIXELS_PER_MINUTE - 4);
                                return (
                                  <div
                                    key={`${court.id}-${rangeIndex}-blocked`}
                                    title={`${court.name} · No disponible ${formatHourFromMinutes(range.startMinute)}-${formatHourFromMinutes(range.endMinute)}`}
                                    style={{
                                      position: 'absolute',
                                      left,
                                      top: 6,
                                      height: TIMELINE_ROW_HEIGHT - 12,
                                      width,
                                      borderRadius: 8,
                                      border: '1px solid var(--border-strong)',
                                      background: 'var(--surface-3)',
                                      zIndex: 1,
                                    }}
                                  />
                                );
                              })}
                              {selectedSlotData && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: (selectedSlotData.minute - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE + 2,
                                    top: 6,
                                    height: TIMELINE_ROW_HEIGHT - 12,
                                    width: Math.max(8, selectedDuration * TIMELINE_PIXELS_PER_MINUTE - 4),
                                    borderRadius: 8,
                                    border: '1px solid var(--brand)',
                                    background: 'var(--brand)',
                                    pointerEvents: 'none',
                                    zIndex: 2,
                                  }}
                                />
                              )}
                              {hoveredSlotData && (!selectedSlotData || hoveredSlotData.slotTime !== selectedSlotData.slotTime) && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: (hoveredSlotData.minute - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE + 2,
                                    top: 6,
                                    height: TIMELINE_ROW_HEIGHT - 12,
                                    width: Math.max(8, selectedDuration * TIMELINE_PIXELS_PER_MINUTE - 4),
                                    borderRadius: 8,
                                    border: '1px solid var(--accent-border-strong)',
                                    background: 'var(--accent-bg-strong)',
                                    pointerEvents: 'none',
                                    zIndex: 3,
                                  }}
                                />
                              )}
                              {courtSlots.map(({ slotTime, minute, available }) => {
                                const left = (minute - atcTimeline.startMinute) * TIMELINE_PIXELS_PER_MINUTE + 2;
                                const hotspotWidth = Math.max(8, atcStepMinutes * TIMELINE_PIXELS_PER_MINUTE - 4);

                                if (!available) return null;

                                return (
                                  <button
                                    key={`${court.id}-${slotTime}-available`}
                                    type="button"
                                    onClick={() => handleSelectAtcSlot(court, slotTime)}
                                    title={`${court.name} · ${slotTime}`}
                                    style={{
                                      position: 'absolute',
                                      left,
                                      top: 6,
                                      height: TIMELINE_ROW_HEIGHT - 12,
                                      width: hotspotWidth,
                                      borderRadius: 8,
                                      border: '1px solid transparent',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      padding: 0,
                                      zIndex: 4,
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 10 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: T.textMuted }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--surface-3)', border: '1px solid var(--border-strong)' }} />
                    Ocupado / no disponible
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--brand)', border: '1px solid var(--brand)', marginLeft: 8 }} />
                    Tu selección
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.textMuted, fontSize: 11, fontWeight: 700 }}>
                    <Info size={12} />
                    Pasá el mouse por espacio libre para previsualizar turno
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', borderRadius: 14, border: `1px dashed ${T.borderSubtle}`, color: T.textMuted, fontSize: 12, fontWeight: 600 }}>
                Sin datos suficientes para dibujar agenda.
              </div>
            )
          ) : (
            <>
              <style>{`
              /* Slot visual tokens */
              :root{
                --slot-bg: var(--surface-1, #ffffff);
                --slot-border: var(--border, #E6E6E6);
                --slot-text: var(--text-primary, #1F2937);
                --slot-subtext: var(--text-muted, #6B7280);
                --slot-hover-bg: var(--accent-bg-faint, rgba(182,243,106,.045));
                --slot-hover-border: var(--accent-border, rgba(182,243,106,.32));
                --slot-hover-shadow: var(--shadow-md);
                --slot-selected-bg: var(--accent-bg-muted, rgba(182,243,106,.16));
                --slot-selected-border: var(--accent-border-strong, rgba(182,243,106,.52));
                --slot-selected-text: var(--accent-fg, #5C8E1A);
                --slot-selected-ring: 0 0 0 3px var(--accent-border-subtle, rgba(182,243,106,.22));
                --slot-disabled-bg: var(--surface-3, #F3F4F6);
                --slot-disabled-border: var(--border-strong, #E5E7EB);
                --slot-disabled-text: var(--text-muted, #9CA3AF);
              }
              .v-slot-grid{ display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap:8px; }
              .v-slot{ background:var(--slot-bg); border:1px solid var(--slot-border); color:var(--slot-text); padding:8px 10px; border-radius:12px; font-weight:700; font-size:13px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; transition: box-shadow .18s ease, border-color .18s ease, background-color .12s ease; font-family: 'Geist',system-ui,sans-serif; }
              .v-slot:focus{ outline:none; }
              .v-slot:focus-visible{ box-shadow: var(--slot-hover-shadow); border-color: var(--slot-hover-border); }
              .v-slot:hover{ background:var(--slot-hover-bg); border-color:var(--slot-hover-border); box-shadow: var(--slot-hover-shadow); }
              .v-slot--selected{ background:var(--slot-selected-bg); border-color:var(--slot-selected-border); color:var(--slot-selected-text); box-shadow: none; }
              .v-slot--selected:hover,
              .v-slot--selected:focus-visible{ background:var(--slot-selected-bg); border-color:var(--slot-selected-border); color:var(--slot-selected-text); box-shadow:none; }
              .v-slot--disabled{ background:var(--slot-disabled-bg); border-color:var(--slot-disabled-border); color:var(--slot-disabled-text); pointer-events:none; opacity:0.85; }
              @media (max-width:720px){ .v-slot{ transform:none; } }
              `}</style>

              <div className="v-slot-grid">
                {visibleListSlots.map(slot => {
                  const isSelected = selectedSlot === slot.slotTime;
                  const isDisabled = slot.courts.length === 0;
                  return (
                    <button
                      key={slot.slotTime}
                      type="button"
                      className={`v-slot${isSelected ? ' v-slot--selected' : ''}${isDisabled ? ' v-slot--disabled' : ''}`}
                      onClick={() => { if (!isDisabled) { setSelectedSlot(slot.slotTime); setSelectedCourt(null); } }}
                      aria-pressed={isSelected}
                      aria-disabled={isDisabled}
                    >
                      {slot.slotTime}
                    </button>
                  );
                })}
              </div>
              {isMobileListOnly && availableSlots.length > MOBILE_VISIBLE_SLOTS_LIMIT && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowAllMobileSlots((prev) => !prev)}
                    aria-label={showAllMobileSlots ? 'Ver menos horarios' : 'Ver más horarios'}
                    title={showAllMobileSlots ? 'Ver menos horarios' : 'Ver más horarios'}
                    style={{
                      width: 40,
                      height: 24,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <ChevronDown
                      size={14}
                      style={{
                        transform: showAllMobileSlots ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform .2s ease',
                      }}
                    />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Courts */}
      {activeScheduleViewMode === 'list' && selectedSlot && (
        <div ref={courtsSectionRef} style={sectionStyle}>
          <div style={labelStyle}><MapPin size={12} style={{ color: 'var(--brand)' }} /> Elegí una cancha</div>
          <style>{`
            .v-court-option{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:14px;text-align:left;width:100%;border:1px solid var(--border);background:var(--surface-1);cursor:pointer;transition:background-color .16s ease,border-color .16s ease,box-shadow .16s ease;outline:none;font-family:'Geist',system-ui,sans-serif;}
            .v-court-option:hover{background:var(--accent-bg-faint);border-color:var(--accent-border-subtle);}
            .v-court-option:focus{outline:none;}
            .v-court-option:focus-visible{box-shadow:var(--shadow-focus);border-color:var(--accent-border);}
            .v-court-option[aria-pressed="true"]{background:var(--accent-bg-muted);border-color:var(--accent-border-strong);}
            .v-court-dot{width:10px;height:10px;border-radius:50%;background:var(--border-strong);border:1px solid var(--border);flex-shrink:0;transition:background-color .16s ease,border-color .16s ease;}
            .v-court-option[aria-pressed="true"] .v-court-dot{background:var(--accent-fg);border-color:var(--accent-fg);}
            .v-court-name{font-size:14px;font-weight:800;color:${T.textPrimary};margin-bottom:3px;}
            .v-court-meta{font-size:11px;color:${T.textMuted};font-weight:600;}
            .v-court-option[aria-pressed="true"] .v-court-name,
            .v-court-option[aria-pressed="true"] .v-court-meta{color:var(--accent-fg);}
          `}</style>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(availableSlots.find(s => s.slotTime === selectedSlot)?.courts || []).map(court => {
              if (!selectedDate) return null;
              const dateStr = formatLocalDate(selectedDate);
              const slotKey = `${dateStr}-${selectedSlot}-${court.id}`;
              const isSelected = selectedCourt?.id === court.id;

              const handleSelectCourt = async () => {
                if (!selectedDate || !selectedSlot) return;
                const currentSlot = availableSlots.find(s => s.slotTime === selectedSlot);
                const availIds = new Set((currentSlot?.courts || []).map(c => c.id));
                if (!availIds.has(court.id)) { setDisabledSlots(prev => ({ ...prev, [slotKey]: true })); showError('Cancha ya no disponible.'); return; }
                setSelectedCourt(court);
              };

              return (
                <button
                  key={court.id}
                  type="button"
                  onClick={handleSelectCourt}
                  className="v-court-option"
                  aria-pressed={isSelected}
                >
                  <div>
                    <div className="v-court-name">{court.name}</div>
                    <div className="v-court-meta">
                      {court.price ? `$${court.price.toLocaleString()} · ${selectedDuration} min` : 'Precio a confirmar'}
                    </div>
                  </div>
                  <div className="v-court-dot" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* No slots */}
      {!loading && selectedActivityFilter && availableSlots.length === 0 && selectedDate && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 20px', background: T.bgSubtle, border: `1px dashed ${T.borderSubtle}`, borderRadius: 16, fontSize: 13, fontWeight: 600, color: T.textDisabled, marginBottom: 20, textAlign: 'center' }}>
          {(() => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const sel = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            if (sel < today) return <><Hourglass size={16} /> No se puede viajar al pasado…</>;
            if (sel.getTime() === today.getTime() && slotsWithCourts.length > 0) return <><Moon size={16} /> Ya no quedan turnos por hoy.</>;
            return <><Ban size={16} /> No hay canchas disponibles para esta fecha.</>;
          })()}
        </div>
      )}

      {/* Confirm button */}
      <button
        ref={confirmButtonRef}
        onClick={handleBooking}
        disabled={!canConfirm}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '14px 20px', borderRadius: 16,
          fontSize: 13, fontWeight: 800, letterSpacing: '.01em',
          fontFamily: "'Geist',system-ui,sans-serif", cursor: !canConfirm ? 'not-allowed' : 'pointer',
          border: 'none', transition: 'all .2s',
                  background: !canConfirm ? 'var(--surface-3)' : 'var(--brand)',
          color: !canConfirm ? T.textMuted : 'var(--brand-on)',
          marginTop: 8,
        }}
      >
        {!canConfirm ? (
          <>
            <MousePointerClick size={15} /> Seleccioná turno y cancha
          </>
        ) : (
          <>
            <Zap size={15} /> Revisar reserva
          </>
        )}
      </button>

      {/* Price info */}
      {canConfirm && (
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 13, color: T.textMuted, fontWeight: 500 }}>
          Precio:{' '}
          <span style={{ fontWeight: 800, color: 'var(--brand)', fontSize: 15 }}>
            ${priceInfo.final.toLocaleString()}
          </span>
          {priceInfo.hasLights && clubConfig && (
            <span style={{ fontSize: 11, color: T.textDisabled, marginLeft: 6 }}>
              (incluye luces +${priceInfo.extra.toLocaleString()}{clubConfig.lightsFromHour ? ` desde ${clubConfig.lightsFromHour}` : ''})
            </span>
          )}
        </div>
      )}

      {isLoginPromptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: T.backdrop, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 2147483201 }}
          onMouseDown={event => {
            if (event.target !== event.currentTarget) return;
            if (loginModalLoading || loginModalMagicLoading) return;
            closeLoginPromptModal();
          }}
        >
          <div style={{ width: '100%', maxWidth: 420, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 24, boxShadow: T.shadowModal, overflow: 'hidden', fontFamily: "'Geist',system-ui,sans-serif" }}>
            <div style={{ padding: '30px 28px 22px', borderBottom: `1px solid ${T.divider}`, textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--accent-bg-soft)', border: '1px solid var(--accent-border-subtle)', margin: '0 auto 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand)' }}>
                <LogIn size={22} />
              </div>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.textPrimary, letterSpacing: '-.03em' }}>Bienvenido</h3>
              <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', color: T.textDisabled }}>Ingresa a tu cuenta</p>
            </div>

            <div style={{ padding: '22px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loginModalError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', border: '1px solid var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                  <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>{loginModalError}</span>
                </div>
              )}

              {loginModalSuccess && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'var(--accent-bg-soft)', border: '1px solid var(--accent-border-subtle)', color: 'var(--brand-hover)', fontSize: 13, fontWeight: 600 }}>
                  <Check size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>{loginModalSuccess}</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: T.textMuted }}>Correo electronico</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: 13, color: T.textDisabled, display: 'flex', pointerEvents: 'none' }}><Mail size={14} /></span>
                  <input
                    type="email"
                    value={loginModalEmail}
                    onChange={event => setLoginModalEmail(event.target.value)}
                    style={{ width: '100%', padding: '11px 14px 11px 38px', background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, outline: 'none' }}
                    placeholder="tu@email.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: T.textMuted }}>Contrasena</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: 13, color: T.textDisabled, display: 'flex', pointerEvents: 'none' }}><Lock size={14} /></span>
                  <input
                    type={loginModalShowPassword ? 'text' : 'password'}
                    value={loginModalPassword}
                    onChange={event => setLoginModalPassword(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !loginModalLoading) {
                        event.preventDefault();
                        void handleLoginFromModal();
                      }
                    }}
                    style={{ width: '100%', padding: '11px 44px 11px 38px', background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 12, color: T.textPrimary, fontSize: 14, fontWeight: 600, outline: 'none' }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onMouseDown={() => setLoginModalShowPassword(true)}
                    onMouseUp={() => setLoginModalShowPassword(false)}
                    onMouseLeave={() => setLoginModalShowPassword(false)}
                    onTouchStart={() => setLoginModalShowPassword(true)}
                    onTouchEnd={() => setLoginModalShowPassword(false)}
                    style={{ position: 'absolute', right: 12, background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}
                    aria-label="Ver contrasena"
                  >
                    {loginModalShowPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void handleLoginFromModal(); }}
                disabled={loginModalLoading || !String(loginModalEmail).trim() || !String(loginModalPassword).trim()}
                style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: 'var(--brand-on)', fontSize: 13, fontWeight: 800, letterSpacing: '.01em', cursor: (loginModalLoading || !String(loginModalEmail).trim() || !String(loginModalPassword).trim()) ? 'not-allowed' : 'pointer', opacity: (loginModalLoading || !String(loginModalEmail).trim() || !String(loginModalPassword).trim()) ? 0.5 : 1 }}
              >
                {loginModalLoading ? (
                  <>
                    <Loader2 size={15} style={{ animation: 'bg-spin .8s linear infinite' }} />
                    Procesando...
                  </>
                ) : (
                  <>
                    <LogIn size={15} />
                    Ingresar
                  </>
                )}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: T.divider }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: T.textDisabled }}>o</span>
                <div style={{ flex: 1, height: 1, background: T.divider }} />
              </div>

              <button
                type="button"
                onClick={() => { void handleRequestLoginMagicLink(); }}
                disabled={loginModalMagicLoading || loginModalLoading || !String(loginModalEmail).trim()}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 20px', borderRadius: 12, background: T.bgSubtle2, border: `1px solid ${T.border}`, color: T.textMuted, fontSize: 13, fontWeight: 800, letterSpacing: '.01em', cursor: loginModalMagicLoading || loginModalLoading ? 'not-allowed' : 'pointer', opacity: loginModalMagicLoading || loginModalLoading ? 0.6 : 1 }}
              >
                {loginModalMagicLoading ? (
                  <>
                    <Loader2 size={15} style={{ animation: 'bg-spin .8s linear infinite' }} />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Zap size={15} />
                    Enviar enlace de acceso
                  </>
                )}
              </button>

              <div style={{ textAlign: 'center', paddingTop: 14, borderTop: `1px solid ${T.divider}` }}>
                <button
                  type="button"
                  onClick={() => { const from = encodeURIComponent(router.asPath || '/'); void router.push(`/login?mode=register&from=${from}`); }}
                  style={{ background: 'none', border: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', color: T.textDisabled, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', textUnderlineOffset: '3px', transition: 'color .15s, text-decoration-color .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.textDecorationColor = 'var(--brand)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.textDisabled; e.currentTarget.style.textDecorationColor = 'transparent'; }}
                >
                  ¿No tenés cuenta? Registrate gratis
                </button>
              </div>
            </div>
          </div>
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
