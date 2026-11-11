"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import AppModal from './AppModal';

import { getApiUrl } from '../utils/apiUrl';
import { ClubService, Club } from '../services/ClubService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { useAuth } from '../contexts/AuthContext';
import { createBookingCheckoutDraftId, rememberCheckoutReturn, saveBookingCheckoutDraft } from '../utils/bookingCheckoutDraft';
import { normalizePublicSport } from '../utils/publicClubFilters';
import { PlayerPricingService, type ActivityFormat, type ClubPricingMode } from '../services/PlayerPricingService';
import { BookingWindowService, type BookingWindowEvaluation } from '../services/BookingWindowService';
import { ChevronDown, ChevronLeft, ChevronRight, Calendar, Check, Clock, MapPin, Hourglass, Moon, Ban, AlertCircle, Activity, LayoutGrid, Rows3, Info, LogIn, ShieldCheck } from 'lucide-react';
import Skeleton from './ui/Skeleton';

const apiBase = () => `${getApiUrl()}/api`;

interface BookingGridProps {
  clubSlug?: string;
  // clubApp = app instalada del club: días como botones grandes, horarios más grandes y siempre en lista.
  variant?: 'default' | 'clubApp';
}

// Días, chips de opciones, resumen y barra fija de reserva (todas las variantes).
const GRID_CSS = `
  .bg-field-label { font-size:10px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); display:flex; align-items:center; gap:6px; margin-bottom:8px; }
  .bg-days { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(76px, 1fr); gap:4px; padding:4px; margin-bottom:20px; border-radius:12px; background:var(--surface-2); border:1px solid var(--border); overflow-x:auto; scrollbar-width:none; scroll-snap-type:x proximity; }
  .bg-days::-webkit-scrollbar { display:none; }
  .bg-day { min-height:46px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; border:1px solid transparent; border-radius:9px; background:transparent; color:var(--text-secondary); font-family:'Geist',system-ui,sans-serif; cursor:pointer; transition:background .16s,border-color .16s,color .16s; scroll-snap-align:start; }
  .bg-day:hover { background:var(--surface-1); border-color:var(--border); color:var(--text-primary); }
  .bg-day:focus-visible { outline:none; box-shadow:var(--shadow-focus); }
  .bg-day-label { font-size:13px; font-weight:800; white-space:nowrap; }
  .bg-day-sub { font-size:10px; font-weight:700; opacity:.8; white-space:nowrap; }
  .bg-day.is-closed { color:var(--text-disabled, var(--text-secondary)); opacity:.6; }
  .bg-day.is-closed .bg-day-sub { text-transform:none; }
  .bg-day[aria-pressed="true"] { background:var(--surface-1); border-color:var(--accent-border); color:var(--accent-fg); }
  .bg-fields { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px 16px; margin-bottom:22px; }
  .bg-field { position:relative; min-width:0; }
  .bg-chips { display:flex; flex-wrap:wrap; gap:6px; }
  .bg-chip { min-height:40px; padding:0 14px; border-radius:999px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-secondary); font-family:'Geist',system-ui,sans-serif; font-size:13px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s,color .15s; }
  .bg-chip:hover { border-color:var(--border-strong); color:var(--text-primary); }
  .bg-chip:focus-visible { outline:none; box-shadow:var(--shadow-focus); }
  .bg-chip[aria-pressed="true"] { background:var(--accent-bg-muted); border-color:var(--accent-border-strong); color:var(--accent-fg); }
  .bg-court-line { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-radius:14px; border:1px solid var(--accent-border-strong); background:var(--accent-bg-muted); }
  .bg-court-line-name { margin:0; font-size:14px; font-weight:800; color:var(--accent-fg); }
  .bg-court-line-meta { margin:2px 0 0; font-size:11px; font-weight:600; color:var(--text-muted); }
  .bg-link-btn { flex-shrink:0; min-height:36px; padding:0 4px; border:none; background:none; color:var(--accent-fg); font-family:inherit; font-size:12px; font-weight:800; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
  .bg-more-btn { display:inline-flex; align-items:center; gap:6px; min-height:40px; padding:0 14px; border:none; border-radius:999px; background:transparent; color:var(--text-secondary); font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; }
  .bg-more-btn:hover { color:var(--text-primary); background:var(--surface-2); }
  .bg-cta { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:50px; padding:0 20px; border-radius:16px; border:none; font-family:'Geist',system-ui,sans-serif; font-size:14px; font-weight:800; cursor:pointer; background:var(--brand); color:var(--brand-on); transition:background .2s; }
  .bg-cta:disabled { cursor:not-allowed; background:var(--surface-3); color:var(--text-muted); }
  .bg-cta-price { opacity:.85; font-weight:700; }
  .bg-summary { margin:0 0 10px; text-align:center; font-size:12px; font-weight:600; color:var(--text-muted); }
  .bg-summary b { color:var(--text-primary); font-weight:800; }
`;

const CLUB_APP_GRID_CSS = `
  .bg-days { grid-auto-columns:minmax(96px, 1fr); }
  .bg-day-label { font-size:14px; }
  .bg-clubapp .v-slot-grid { grid-template-columns:repeat(auto-fill, minmax(76px, 1fr)); gap:8px; }
  .bg-clubapp .v-slot { min-height:44px; font-size:14px; }
`;

const LAST_SPORT_STORAGE_KEY = 'pique:lastSport';
const CHIP_OPTIONS_LIMIT = 4;

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

// Pocas opciones (hasta 4) se muestran como chips: un toque en vez de abrir un desplegable.
const ChipGroup = ({ value, options, onChange, label }: {
  value: string | number;
  options: Array<{ value: string | number; label: string }>;
  onChange: (value: any) => void;
  label: string;
}) => (
  <div className="bg-chips" role="group" aria-label={label}>
    {options.map(option => (
      <button
        key={String(option.value)}
        type="button"
        className="bg-chip"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

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
  // Precio por jugador (clubes en modo PER_PLAYER): parte de quien mira y precio general.
  pricePerPlayer?: number | null;
  generalPricePerPlayer?: number | null;
  playerCount?: number | null;
  memberCategoryName?: string | null;
  // Minutos que entran en esta cancha (menos que el turno completo si es un turno corto en un hueco)
  fitMinutes?: number | null;
  activityType?: ActivityTypeSummary | null;
};

// Etiqueta de precio de una cancha: por jugador si el club cobra por jugador, si no por turno.
const formatCourtPriceLabel = (court: CourtSummary, durationMinutes: number, fallback: string) => {
  if (court.pricePerPlayer != null) {
    const memberSuffix = court.memberCategoryName ? ` (precio socio)` : '';
    return `$${Number(court.pricePerPlayer).toLocaleString('es-AR')} por jugador${memberSuffix} · ${durationMinutes} min`;
  }
  return court.price ? `$${court.price.toLocaleString('es-AR')} · ${durationMinutes} min` : fallback;
};

// 60 -> "1 h", 120 -> "2 h", 90 -> "90 min"
const formatDurationShort = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`);

const addMinutesToSlotTime = (slotTime: string, minutes: number) => {
  const [h, m] = slotTime.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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

export default function BookingGrid({ clubSlug, variant = 'default' }: BookingGridProps = {}) {
  const isClubAppVariant = variant === 'clubApp';
  const router = useRouter();
  const { isAuthenticated: hasAuthSession, status: authStatus } = useAuth();

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
  const [scheduleViewMode, setScheduleViewMode] = useState<ScheduleViewMode>('list');
  const [isMobileListOnly, setIsMobileListOnly] = useState(false);
  const [showAllMobileSlots, setShowAllMobileSlots] = useState(false);
  const [hoveredAtcSlot, setHoveredAtcSlot] = useState<{ courtId: number; slotTime: string } | null>(null);
  const [pendingSport, setPendingSport] = useState<string | null>(null);
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  // Al volver del login: la cancha elegida y seguir directo al checkout.
  const [pendingCourtId, setPendingCourtId] = useState<number | null>(null);
  const [pendingContinue, setPendingContinue] = useState(false);
  const [queryApplied, setQueryApplied] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // La cancha se asigna sola; la lista completa se abre solo si el jugador quiere cambiarla.
  const [courtPickerOpen, setCourtPickerOpen] = useState(false);
  const daysRef = useRef<HTMLDivElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode;
    cancelText?: string; confirmText?: string; isWarning?: boolean;
    onConfirm?: () => void; onCancel?: () => void; confirmDisabled?: boolean;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean; blockManualClose?: boolean;
  }>({ show: false });

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
    shadow: 'var(--shadow-card)',
    shadowModal: 'var(--shadow-lg)',
    backdrop: 'var(--overlay)',
    divider: 'var(--border)',
  }), []);

  const closeModal = useCallback(() => {
    setModalState(p => ({ ...p, show: false }));
  }, []);

  const showInfo = useCallback((message: ReactNode, title = 'Información') => {
    setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK', onConfirm: closeModal, closeOnBackdrop: true, closeOnEscape: true, blockManualClose: false });
  }, [closeModal]);

  const showError = useCallback((message: ReactNode) => {
    setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar', onConfirm: closeModal, closeOnBackdrop: true, closeOnEscape: true, blockManualClose: false });
  }, [closeModal]);

  // Sin sesión se usa el mismo login de toda la app. Antes se guarda la selección en la dirección
  // de esta página: al volver de ingresar, la grilla se abre con el mismo día, deporte y horario.
  const goToLogin = (options?: { keepSelection?: boolean }) => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (options?.keepSelection && selectedDate && selectedSlot) {
      params.set('date', formatLocalDate(selectedDate));
      params.set('time', selectedSlot);
      if (selectedActivityFilter) params.set('sport', selectedActivityFilter);
      // Con la cancha y "continue" el jugador vuelve del login directo al checkout.
      if (selectedCourt) params.set('court', String(selectedCourt.id));
      params.set('continue', '1');
    }
    const query = params.toString();
    const returnUrl = `${router.asPath.split('?')[0].split('#')[0]}${query ? `?${query}` : ''}`;
    void (async () => {
      if (options?.keepSelection) {
        try {
          await router.replace(returnUrl, undefined, { shallow: true, scroll: false });
        } catch {
          // Si no se pudo guardar la selección, se sigue igual al login.
        }
      }
      await router.push(`/login?from=${encodeURIComponent(returnUrl)}`);
    })();
  };

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
          ['Precio', `$${params.price.toLocaleString('es-AR')}`],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary }}>{val}</span>
          </div>
        ))}
        {Number(params.discountAmount || 0) > 0.009 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>Descuento</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-fg)' }}>-${Number(params.discountAmount || 0).toLocaleString('es-AR')}</span>
          </div>
        )}
        {params.nightSurcharge?.applied && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: '.03em' }}>Recargo nocturno</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary }}>+${Number(params.nightSurcharge.amount || 0).toLocaleString('es-AR')}{params.nightSurcharge.fromHour ? ` (desde ${params.nightSurcharge.fromHour})` : ''}</span>
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

  // Precio por jugador: modalidades del club (Single / Dobles...) y la elegida para la actividad.
  const [clubPricing, setClubPricing] = useState<{ pricingMode: ClubPricingMode; onlineCheckoutEnabled: boolean; priceHints?: { cashPercent: number; onlinePercent: number }; deposit?: { percent: number; onlineRequired: boolean; holdMinutes: number } | null; formats: ActivityFormat[] }>({
    pricingMode: 'PER_COURT',
    onlineCheckoutEnabled: true,
    formats: []
  });
  const [selectedFormatId, setSelectedFormatId] = useState('');
  // Modalidad con "también 1 h": el jugador eligió jugar la versión corta.
  const [formatUseShort, setFormatUseShort] = useState(false);
  useEffect(() => {
    if (!clubSlug) return;
    PlayerPricingService.getPublicFormats(clubSlug)
      .then(setClubPricing)
      .catch(err => reportUiError({ area: 'BookingGrid', action: 'loadActivityFormats' }, err));
  }, [clubSlug]);
  const isPerPlayerPricing = clubPricing.pricingMode === 'PER_PLAYER';

  // Ventanas de reserva: desde qué hora puede reservar quien mira (socios primero). Se vuelve a pedir
  // al iniciar o cerrar sesión, al volver a la pestaña y cada minuto, para habilitar la grilla a horario.
  const [bookingWindow, setBookingWindow] = useState<BookingWindowEvaluation | null>(null);
  const loadBookingWindow = useCallback(async () => {
    if (!clubSlug) { setBookingWindow(null); return; }
    try {
      setBookingWindow(await BookingWindowService.getPublicWindow(clubSlug));
    } catch (err) {
      reportUiError({ area: 'BookingGrid', action: 'loadBookingWindow' }, err);
      setBookingWindow(null);
    }
  }, [clubSlug]);
  useEffect(() => { void loadBookingWindow(); }, [loadBookingWindow, hasAuthSession]);
  const bookingWindowEnabled = Boolean(bookingWindow?.enabled);
  useEffect(() => {
    if (!bookingWindowEnabled || typeof window === 'undefined') return;
    const onFocus = () => { void loadBookingWindow(); };
    const interval = window.setInterval(onFocus, 60_000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [bookingWindowEnabled, loadBookingWindow]);
  const activeBookingWindow = bookingWindow && bookingWindow.enabled ? bookingWindow : null;
  const bookingWindowBlocked = Boolean(activeBookingWindow && !activeBookingWindow.canBookNow);
  useEffect(() => {
    if (!bookingWindowBlocked) return;
    setSelectedSlot(null);
    setSelectedCourt(null);
  }, [bookingWindowBlocked]);
  const activityFormats = useMemo(
    () => clubPricing.formats.filter(format => Number(format.activityTypeId) === Number(selectedActivityId)),
    [clubPricing.formats, selectedActivityId]
  );
  useEffect(() => {
    if (!isPerPlayerPricing) return;
    if (!activityFormats.some(format => format.id === selectedFormatId)) {
      setSelectedFormatId(activityFormats[0]?.id || '');
    }
  }, [activityFormats, isPerPlayerPricing, selectedFormatId]);
  const selectedFormat = activityFormats.find(format => format.id === selectedFormatId) || null;
  // Una modalidad con duración fija (ej. Single 60, Dobles 120) define la duración del turno.
  const formatFixedDuration = isPerPlayerPricing ? selectedFormat?.durationMinutes ?? null : null;
  // Si la modalidad lo permite, también se puede jugar 1 h (mismo precio por jugador).
  const formatShortMinutes = formatFixedDuration && formatFixedDuration > 60 && selectedFormat?.allowShortInGaps ? 60 : null;
  const formatDuration = formatFixedDuration && formatUseShort && formatShortMinutes ? formatShortMinutes : formatFixedDuration;
  useEffect(() => {
    if (formatDuration && selectedDuration !== formatDuration) {
      setSelectedDuration(formatDuration);
      setSelectedSlot(null);
      setSelectedCourt(null);
    }
  }, [formatDuration, selectedDuration]);

  const { slotsWithCourts, loading, error, refresh } = useAvailability(
    selectedDate,
    selectedActivityId,
    clubSlug,
    selectedDuration,
    isPerPlayerPricing ? selectedFormatId || null : null
  );
  // Se muestran de menor a mayor; la primera configurada sigue siendo la que viene elegida.
  const durationOptions = useMemo(() => [...selectedActivityDurations].sort((a, b) => a - b), [selectedActivityDurations]);
  const activeScheduleViewMode: ScheduleViewMode = isMobileListOnly || isClubAppVariant ? 'list' : scheduleViewMode;

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
    const { date, time, sport, court } = router.query;
    if (typeof date === 'string') {
      const [y, m, d] = date.split('-').map(Number);
      if (y && m && d) { const pd = new Date(y, m - 1, d); if (!Number.isNaN(pd.getTime())) setSelectedDate(pd); }
    }
    if (typeof time === 'string') setPendingTime(time);
    if (typeof sport === 'string') setPendingSport(sport);
    if (typeof court === 'string' && Number(court) > 0) setPendingCourtId(Number(court));
    if (router.query.continue === '1' && typeof time === 'string') setPendingContinue(true);
    setQueryApplied(true);
  }, [router.isReady, router.query, queryApplied]);

  useEffect(() => {
    if (!clubSlug) { setClubConfig(null); return; }
    ClubService.getClubBySlug(clubSlug).then(setClubConfig).catch(err => { reportUiError({ area: 'BookingGrid', action: 'loadClubConfig' }, err); setClubConfig(null); });
  }, [clubSlug]);

  const windowDaysAhead = activeBookingWindow ? activeBookingWindow.daysAhead : null;
  const bookingAdvanceLimitDays = useMemo(() => {
    const raw = Number(clubConfig?.bookingSimpleAdvanceDaysUser);
    const configured = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 30;
    return windowDaysAhead != null ? Math.min(configured, windowDaysAhead) : configured;
  }, [clubConfig?.bookingSimpleAdvanceDaysUser, windowDaysAhead]);

  const maxAllowedDate = useMemo(() => {
    const today = getTodayDate();
    const max = new Date(today);
    max.setDate(max.getDate() + bookingAdvanceLimitDays);
    return max;
  }, [bookingAdvanceLimitDays]);

  // Días que el club no abre (día de la semana fuera de openingDays o fecha de cierre puntual).
  // Sin configuración se asume abierto: no inventamos cierres.
  const closedReasonFor = useCallback((date: Date): 'WEEKDAY' | 'CLOSURE' | null => {
    if (!clubConfig) return null;
    if (Array.isArray(clubConfig.closureDates) && clubConfig.closureDates.includes(formatLocalDate(date))) return 'CLOSURE';
    const days = clubConfig.openingDays;
    if (Array.isArray(days) && days.length > 0 && !days.includes(date.getDay())) return 'WEEKDAY';
    return null;
  }, [clubConfig]);

  // Próximo día abierto después de `date`, dentro del rango reservable.
  const nextOpenDateAfter = useCallback((date: Date): Date | null => {
    for (let offset = 1; offset <= 14; offset += 1) {
      const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
      if (candidate.getTime() > maxAllowedDate.getTime()) return null;
      if (!closedReasonFor(candidate)) return candidate;
    }
    return null;
  }, [closedReasonFor, maxAllowedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    const clamped = clampToDateRange(selectedDate, getTodayDate(), maxAllowedDate);
    if (clamped.getTime() !== selectedDate.getTime()) { setSelectedDate(clamped); setSelectedSlot(null); setSelectedCourt(null); }
  }, [selectedDate, maxAllowedDate]);

  useEffect(() => {
    // Si la modalidad fija la duración (ej. Single 60) no se corrige a las duraciones de la actividad:
    // hacerlo rebotaba entre ambos valores en un bucle infinito.
    if (formatFixedDuration) return;
    if (durationOptions.includes(selectedDuration)) return;
    setSelectedDuration(selectedActivityDurations[0]);
    setSelectedSlot(null);
    setSelectedCourt(null);
  }, [durationOptions, formatFixedDuration, selectedActivityDurations, selectedDuration]);

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

  // Turno corto en huecos: minutos que entran en la cancha (si la modalidad lo permite, menos que el turno completo).
  const getCourtFitMinutes = useCallback(
    (court: CourtSummary) => (Number(court.fitMinutes) > 0 ? Math.min(Number(court.fitMinutes), selectedDuration) : selectedDuration),
    [selectedDuration]
  );

  const availableSlots = useMemo(() => {
    if (!selectedDate) return [] as Array<{ slotTime: string; courts: CourtSummary[]; shortOnly: boolean; shortMinutes: number }>;
    const dateStr = formatLocalDate(selectedDate);
    return filteredSlotsWithCourts
      .map(slot => {
        const courts = slot.availableCourts.filter(c => !isSlotDisabledForDate(dateStr, slot.slotTime, Number(c.id)));
        const fits = courts.map(getCourtFitMinutes);
        return {
          slotTime: slot.slotTime,
          courts,
          shortOnly: fits.length > 0 && fits.every(fit => fit < selectedDuration),
          shortMinutes: fits.length > 0 ? Math.max(...fits) : selectedDuration,
        };
      })
      .filter(slot => slot.courts.length > 0);
  }, [filteredSlotsWithCourts, getCourtFitMinutes, isSlotDisabledForDate, selectedDate, selectedDuration]);

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

  // Duración de la reserva: la de la cancha elegida (1 h si es un turno corto en un hueco).
  const bookingDuration = selectedCourt ? getCourtFitMinutes(selectedCourt) : selectedDuration;

  const bookingReview = useMemo(() => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return null;
    const [hours, minutes] = selectedSlot.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0, 0);
    const end = new Date(start.getTime() + bookingDuration * 60000);
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
      durationLabel: `${bookingDuration} min`,
      price,
      listPrice,
      discountAmount,
      hasLights: Boolean(priceInfo.hasLights),
      lightsAmount: Number(priceInfo.extra || 0),
      lightsFromHour: clubConfig?.lightsFromHour || null,
    };
  }, [
    bookingDuration,
    clubConfig?.lightsFromHour,
    priceInfo.extra,
    priceInfo.final,
    priceInfo.hasLights,
    priceInfo.list,
    selectedActivityFilter,
    selectedCourt,
    selectedDate,
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
      clubName: clubConfig?.name || null,
      bookingConfirmationMode: clubConfig?.bookingConfirmationMode ?? null,
      courtId: Number(selectedCourt.id),
      courtName: bookingReview.courtName,
      activityId: bookingActivityId,
      activityName: bookingReview.activityName,
      date: formatLocalDate(selectedDate),
      slotTime: selectedSlot,
      durationMinutes: bookingDuration,
      price: bookingReview.price,
      listPrice: bookingReview.listPrice,
      discountAmount: bookingReview.discountAmount,
      lightsExtraApplied: bookingReview.lightsAmount,
      lightsFromHour: bookingReview.lightsFromHour || null,
      ...(isPerPlayerPricing && selectedFormat
        ? {
            activityFormatId: selectedFormat.id,
            formatName: selectedFormat.name,
            playerCount: selectedFormat.playerCount,
            pricePerPlayer: selectedCourt.pricePerPlayer ?? null,
            generalPricePerPlayer: selectedCourt.generalPricePerPlayer ?? null,
            memberCategoryName: selectedCourt.memberCategoryName ?? null,
          }
        : {}),
      onlineCheckoutEnabled: clubPricing.onlineCheckoutEnabled,
      cashDiscountPercent: clubPricing.priceHints?.cashPercent ?? 0,
      onlineDiscountPercent: clubPricing.priceHints?.onlinePercent ?? 0,
      depositPercent: clubPricing.deposit?.percent ?? null,
      onlineDepositRequired: Boolean(clubPricing.deposit?.onlineRequired),
      depositHoldMinutes: clubPricing.deposit?.holdMinutes ?? null,
      createdAt: new Date().toISOString(),
    });
    if (!draftSaved) {
      showError('No pudimos preparar el checkout. Intentá nuevamente.');
      return;
    }
    // Guardar la selección en la dirección de esta página (sin recargar): al volver del checkout
    // la grilla se abre con el mismo día, deporte y horario.
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    params.set('date', formatLocalDate(selectedDate));
    params.set('time', selectedSlot);
    if (selectedActivityFilter) params.set('sport', selectedActivityFilter);
    params.set('court', String(selectedCourt.id));
    // Al volver del checkout no se tiene que reabrir solo.
    params.delete('continue');
    const returnUrl = `${router.asPath.split('?')[0].split('#')[0]}?${params.toString()}`;
    void (async () => {
      try {
        await router.replace(returnUrl, undefined, { shallow: true, scroll: false });
      } catch {
        // Si no se pudo guardar la selección, se sigue igual al checkout.
      }
      rememberCheckoutReturn(returnUrl);
      // El link también lleva club, día y hora: si el resumen se pierde (otra pestaña), se retoma desde ahí.
      const checkoutParams = new URLSearchParams({ draft: draftId, date: formatLocalDate(selectedDate), time: selectedSlot });
      if (clubSlug) checkoutParams.set("club", clubSlug);
      if (selectedActivityFilter) checkoutParams.set("sport", selectedActivityFilter);
      await router.push(`/checkout?${checkoutParams.toString()}`);
    })();
  };

  const handleBooking = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    if (!hasAuthSession || !isAuthenticated) {
      setIsAuthenticated(false);
      goToLogin({ keepSelection: true });
      return;
    }
    setIsAuthenticated(true);
    openCheckout();
  };

  // Volvió del login con la selección completa: se sigue directo al checkout, sin volver a tocar nada.
  useEffect(() => {
    if (!pendingContinue || !queryApplied) return;
    if (authStatus === 'unknown') return;
    if (!hasAuthSession) { setPendingContinue(false); return; }
    if (pendingTime || pendingCourtId || !selectedSlot || !selectedCourt || !bookingReview) return;
    setPendingContinue(false);
    openCheckout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContinue, queryApplied, authStatus, hasAuthSession, pendingTime, pendingCourtId, selectedSlot, selectedCourt, bookingReview]);

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

  // Cancha asignada sola al elegir horario: la que entra completa, después la más barata.
  // Si el jugador eligió una (o vuelve del login con una), se respeta mientras siga libre.
  useEffect(() => {
    if (activeScheduleViewMode !== 'list' || !selectedSlot) return;
    const courts = availableSlots.find(s => s.slotTime === selectedSlot)?.courts || [];
    if (courts.length === 0) return;
    if (selectedCourt && courts.some(c => c.id === selectedCourt.id)) return;
    const requested = pendingCourtId ? courts.find(c => Number(c.id) === pendingCourtId) : undefined;
    const ranked = [...courts].sort((a, b) => {
      const fitDiff = getCourtFitMinutes(b) - getCourtFitMinutes(a);
      if (fitDiff !== 0) return fitDiff;
      return Number(a.pricePerPlayer ?? a.price ?? 0) - Number(b.pricePerPlayer ?? b.price ?? 0);
    });
    setSelectedCourt(requested || ranked[0]);
    if (pendingCourtId) setPendingCourtId(null);
  }, [activeScheduleViewMode, availableSlots, getCourtFitMinutes, pendingCourtId, selectedCourt, selectedSlot]);

  useEffect(() => {
    setCourtPickerOpen(false);
  }, [selectedSlot, selectedDate]);

  // El último deporte elegido queda guardado para la próxima visita.
  useEffect(() => {
    if (!selectedActivityFilter) return;
    try { localStorage.setItem(LAST_SPORT_STORAGE_KEY, normalizePublicSport(selectedActivityFilter)); } catch { /* sin almacenamiento */ }
  }, [selectedActivityFilter]);

  // Centrar el día elegido en la tira de días (por ejemplo, al volver con ?date=).
  useEffect(() => {
    const container = daysRef.current;
    const active = container?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!container || !active) return;
    container.scrollLeft = Math.max(0, active.offsetLeft - (container.clientWidth - active.clientWidth) / 2);
  }, [selectedDate, bookingAdvanceLimitDays]);

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
    // Acepta el nombre del deporte ("Tenis") o la clave del filtro de Complejos ("tennis").
    const publicKey = normalizePublicSport(pendingSport);
    const matched = names.find(n => normalizeText(n) === norm || (publicKey && normalizePublicSport(n) === publicKey));
    if (matched) setSelectedActivityFilter(matched);
    setPendingSport(null);
  }, [pendingSport, activeCourts]);

  useEffect(() => {
    if (!queryApplied || pendingSport || selectedActivityFilter || activeCourts.length === 0) return;
    const unique = Array.from(new Set(activeCourts.map(c => getCourtActivityName(c)).filter(Boolean)));
    let lastSport = '';
    try { lastSport = localStorage.getItem(LAST_SPORT_STORAGE_KEY) || ''; } catch { /* sin almacenamiento */ }
    const preferred = lastSport ? unique.find(name => normalizePublicSport(name) === lastSport) : undefined;
    // Sin preferencia se elige el primero: así los horarios aparecen sin un paso extra.
    const initialActivity = preferred || unique[0] || '';
    if (initialActivity) setSelectedActivityFilter(initialActivity);
  }, [activeCourts, pendingSport, queryApplied, selectedActivityFilter]);

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

  // Días habilitados como botones ("Hoy", "Mañana", "Vie 24"…): un toque en vez de avanzar día por día.
  // Hasta 14 en la web y 7 en la app del club.
  const bookingDays = useMemo(() => {
    const today = getTodayDate();
    const total = Math.min(isClubAppVariant ? 7 : 14, Math.max(1, bookingAdvanceLimitDays + 1));
    const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return Array.from({ length: total }, (_, offset) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const label = offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : `${weekdays[date.getDay()]} ${date.getDate()}`;
      const sub = offset <= 1
        ? `${weekdays[date.getDay()].toLowerCase()} ${date.getDate()}/${date.getMonth() + 1}`
        : `${date.getDate()}/${date.getMonth() + 1}`;
      return { key: formatLocalDate(date), date, label, sub };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClubAppVariant, bookingAdvanceLimitDays]);

  const availableActivities = useMemo(() => {
    return Array.from(new Set(activeCourts.map(c => getCourtActivityName(c)).filter(Boolean)));
  }, [activeCourts]);

  // Desktop: fecha con flechas día por día.
  const showDayChips = isMobileListOnly || isClubAppVariant;
  const getFormattedDate = (date: Date) => {
    const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    return `${days[date.getDay()]} ${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };
  const isPrevDisabled = !selectedDate || selectedDate.getTime() <= getTodayDate().getTime();
  const isNextDisabled = !selectedDate || selectedDate.getTime() >= maxAllowedDate.getTime();
  const shiftSelectedDay = (delta: number) => {
    if (!selectedDate) return;
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + delta));
    setSelectedSlot(null);
    setSelectedCourt(null);
  };
  const handlePrevDay = () => { if (!isPrevDisabled) shiftSelectedDay(-1); };
  const handleNextDay = () => { if (!isNextDisabled) shiftSelectedDay(1); };

  // Campos con una sola opción no se muestran: se eligen solos y aparecen en el resumen.
  const showSportField = availableActivities.length > 1;
  const showFormatField = isPerPlayerPricing && activityFormats.length > 1;
  const showDurationField = formatFixedDuration ? Boolean(formatShortMinutes) : durationOptions.length > 1;

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
        .filter(c => getCourtFitMinutes(c) >= selectedDuration)
        .map(c => Number(c.id))
        .filter(id =>
          !disabledSlots[`${dateStr}-${slot.slotTime}-${id}`] &&
          !disabledSlots[`${dateStr}-${normalizedTime}-${id}`]
        );
      map.set(normalizedTime, new Set(availableIds));
    });
    return map;
  }, [filteredSlotsWithCourts, selectedDate, disabledSlots, getCourtFitMinutes, selectedDuration]);

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
  // En mobile (web) el resumen y el botón quedan fijos abajo apenas hay un turno elegido.
  // La app del club no la usa: ya tiene su barra de pestañas abajo.
  const useStickyCta = canConfirm && isMobileListOnly && !isClubAppVariant;
  useEffect(() => {
    if (!useStickyCta) return undefined;
    document.body.classList.add("p-has-action-bar");
    return () => document.body.classList.remove("p-has-action-bar");
  }, [useStickyCta]);
  const bookingSummary = useMemo(() => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return null;
    const dayKey = formatLocalDate(selectedDate);
    const day = bookingDays.find(d => d.key === dayKey);
    const dayLabel = day ? day.label : selectedDate.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
    const price = selectedCourt.pricePerPlayer != null
      ? `${formatMoney(Number(selectedCourt.pricePerPlayer))} c/u`
      : formatMoney(priceInfo.final);
    return {
      main: `${dayLabel} · ${selectedSlot} · ${formatDurationShort(bookingDuration)}`,
      sub: `${selectedCourt.name} · ${price}`,
      price,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDays, bookingDuration, priceInfo.final, selectedCourt, selectedDate, selectedSlot]);
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: T.textMuted, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontFamily: "'Geist',system-ui,sans-serif" };
  const sectionStyle: React.CSSProperties = { marginBottom: 28 };

  return (
    <div className={isClubAppVariant ? 'bg-clubapp' : undefined} style={{ width: '100%', minWidth: 0, background: T.bg, border: `1px solid ${T.borderSubtle}`, borderRadius: 24, padding: isMobileListOnly ? '24px 20px 20px' : '28px 28px 24px', fontFamily: "'Geist',system-ui,sans-serif", boxSizing: 'border-box', boxShadow: T.shadow, overflow: 'hidden' }}>
      <style>{GRID_CSS}</style>
      {isClubAppVariant && <style>{CLUB_APP_GRID_CSS}</style>}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: T.textPrimary, letterSpacing: '-.03em', margin: 0 }}>
          Reservar <span style={{ fontStyle: 'italic', color: 'var(--accent-fg)' }}>cancha</span>
        </h2>
        {activeBookingWindow?.memberPriorityActive && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: T.textMuted, margin: '10px 0 0', fontWeight: 600 }}>
            <ShieldCheck size={13} style={{ color: 'var(--accent-fg)' }} />
            <span style={{ color: 'var(--accent-fg)', fontWeight: 800 }}>Prioridad socio</span>
            · hasta las {activeBookingWindow.publicOpensAt} reservan solo socios
          </p>
        )}
      </div>

      {/* Días como botones: solo en mobile y en la app del club (en desktop, flechas en los campos) */}
      {showDayChips && bookingDays.length > 0 && (
        <div className="bg-days" role="group" aria-label="Día" ref={daysRef}>
          {bookingDays.map((day) => {
            const isSelected = Boolean(selectedDate) && formatLocalDate(selectedDate as Date) === day.key;
            const isClosed = Boolean(closedReasonFor(day.date));
            return (
              <button
                key={day.key}
                type="button"
                className={`bg-day${isClosed ? ' is-closed' : ''}`}
                aria-pressed={isSelected}
                aria-label={isClosed ? `${day.label} ${day.sub}, cerrado` : undefined}
                onClick={() => { setSelectedDate(day.date); setSelectedSlot(null); setSelectedCourt(null); }}
              >
                <span className="bg-day-label">{day.label}</span>
                <span className="bg-day-sub">{isClosed ? 'Cerrado' : day.sub}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Deporte, modalidad y duración: solo se muestran si hay algo para elegir */}
      {(showSportField || !showDayChips || showFormatField || showDurationField) && (
        <div className="bg-fields">
          {showSportField && (
            <div className="bg-field" style={{ zIndex: 20 }}>
              <div className="bg-field-label"><Activity size={12} style={{ color: 'var(--accent-fg)' }} /> Deporte</div>
              <CustomSelect
                value={selectedActivityFilter}
                onChange={(val: string) => { setSelectedActivityFilter(val); setSelectedSlot(null); setSelectedCourt(null); }}
                placeholder="Elegí un deporte"
                centerLabel={isMobileListOnly}
                options={availableActivities.map(n => ({ value: n, label: n }))}
              />
            </div>
          )}

          {/* Fecha en desktop: flechas día por día */}
          {!showDayChips && selectedDate && (
            <div className="bg-field">
              <div className="bg-field-label"><Calendar size={12} style={{ color: 'var(--accent-fg)' }} /> Fecha</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 46, padding: '0 6px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadow }}>
                <button
                  type="button"
                  onClick={handlePrevDay}
                  disabled={isPrevDisabled}
                  aria-label="Día anterior"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'none', border: 'none', cursor: isPrevDisabled ? 'not-allowed' : 'pointer', color: isPrevDisabled ? T.arrowDisabled : T.textMuted, borderRadius: 8, transition: 'color .15s' }}
                >
                  <ChevronLeft size={18} />
                </button>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, textAlign: 'center', letterSpacing: '.02em' }}>
                  {getFormattedDate(selectedDate)}
                </span>
                <button
                  type="button"
                  onClick={handleNextDay}
                  disabled={isNextDisabled}
                  aria-label="Día siguiente"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'none', border: 'none', cursor: isNextDisabled ? 'not-allowed' : 'pointer', color: isNextDisabled ? T.arrowDisabled : T.textMuted, borderRadius: 8, transition: 'color .15s' }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Modalidad (precio por jugador): va antes que la duración porque la define */}
          {showFormatField && (
            <div className="bg-field" style={{ zIndex: 10 }}>
              <div className="bg-field-label"><Activity size={12} style={{ color: 'var(--accent-fg)' }} /> Modalidad</div>
              {activityFormats.length <= CHIP_OPTIONS_LIMIT ? (
                <ChipGroup
                  label="Modalidad"
                  value={selectedFormatId}
                  options={activityFormats.map(format => ({ value: format.id, label: `${format.name} · ${format.playerCount}` }))}
                  onChange={(val: string) => { setSelectedFormatId(String(val)); setFormatUseShort(false); setSelectedSlot(null); setSelectedCourt(null); }}
                />
              ) : (
                <CustomSelect
                  value={selectedFormatId}
                  onChange={(val: string) => { setSelectedFormatId(String(val)); setFormatUseShort(false); setSelectedSlot(null); setSelectedCourt(null); }}
                  placeholder="Modalidad"
                  options={activityFormats.map(format => ({ value: format.id, label: `${format.name} · ${format.playerCount} jugadores` }))}
                />
              )}
            </div>
          )}

          {showDurationField && (
            <div className="bg-field" style={{ zIndex: 9 }}>
              <div className="bg-field-label"><Clock size={12} style={{ color: 'var(--accent-fg)' }} /> Duración</div>
              {formatFixedDuration && formatShortMinutes ? (
                <ChipGroup
                  label="Duración"
                  value={formatDuration || formatFixedDuration}
                  options={[formatFixedDuration, formatShortMinutes].map(d => ({ value: d, label: formatDurationShort(d) }))}
                  onChange={(val: number) => { setFormatUseShort(Number(val) === formatShortMinutes); setSelectedSlot(null); setSelectedCourt(null); }}
                />
              ) : durationOptions.length <= CHIP_OPTIONS_LIMIT ? (
                <ChipGroup
                  label="Duración"
                  value={selectedDuration}
                  options={durationOptions.map(d => ({ value: d, label: formatDurationShort(d) }))}
                  onChange={(val: number) => { setSelectedDuration(Number(val)); setSelectedSlot(null); setSelectedCourt(null); }}
                />
              ) : (
                <CustomSelect
                  value={selectedDuration}
                  onChange={(val: number) => { setSelectedDuration(Number(val)); setSelectedSlot(null); setSelectedCourt(null); }}
                  placeholder="Duración"
                  options={durationOptions.map(d => ({ value: d, label: formatDurationShort(d) }))}
                />
              )}
            </div>
          )}
        </div>
      )}

      {bookingWindowBlocked && activeBookingWindow ? (() => {
        const w = activeBookingWindow;
        const rangeLabel = w.daysAhead === 0 ? 'hoy' : w.daysAhead === 1 ? 'hoy y mañana' : `los próximos ${w.daysAhead} días`;
        const scheduleLine = w.hasMemberPriority
          ? `Socios desde las ${w.memberOpensAt} · No socios desde las ${w.publicOpensAt}`
          : `Todos desde las ${w.publicOpensAt}`;
        const isMembersOnly = w.state === 'MEMBERS_ONLY';
        const isGuest = !w.isAuthenticated;
        const title = w.state === 'CLOSED_FOR_TODAY'
          ? 'Las reservas ya cerraron por hoy'
          : w.state === 'NOT_OPEN_YET'
            ? `Las reservas abren a las ${w.hasMemberPriority ? w.memberOpensAt : w.publicOpensAt}`
            : isGuest
              ? 'Los socios reservan primero'
              : `Podés reservar desde las ${w.publicOpensAt}`;
        const body = w.state === 'CLOSED_FOR_TODAY'
          ? `Vuelven a abrir a las ${w.viewerOpensAt}. ${scheduleLine}.`
          : w.state === 'NOT_OPEN_YET'
            ? `${scheduleLine} · para ${rangeLabel}.`
            : isGuest
              ? `${scheduleLine}. Si sos socio, ingresá con tu DNI para ver los horarios.`
              : `Hasta esa hora reservan solo los socios del club. Volvé a las ${w.publicOpensAt} para ver los horarios libres de ${rangeLabel}.`;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '36px 24px', background: T.bgSubtle, border: `1px dashed ${T.borderSubtle}`, borderRadius: 16, textAlign: 'center' }}>
            {w.state === 'CLOSED_FOR_TODAY' || w.state === 'NOT_OPEN_YET'
              ? <Moon size={20} style={{ color: T.textMuted }} />
              : <Clock size={20} style={{ color: T.textMuted }} />}
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T.textPrimary }}>{title}</p>
            <p style={{ margin: 0, maxWidth: 440, fontSize: 13, lineHeight: 1.5, fontWeight: 600, color: T.textMuted }}>{body}</p>
            {isMembersOnly && isGuest && (
              <button
                type="button"
                onClick={() => goToLogin()}
                style={{ marginTop: 8, height: 42, padding: '0 18px', borderRadius: 13, border: 'none', background: 'var(--brand)', color: 'var(--brand-on)', fontSize: 13, fontWeight: 900, fontFamily: "'Geist',system-ui,sans-serif", cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <LogIn size={15} /> Ingresar con DNI
              </button>
            )}
            {isMembersOnly && !isGuest && (
              <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 600, color: T.textMuted }}>¿Sos socio? Consultá en el club para vincular tu cuenta.</p>
            )}
          </div>
        );
      })() : (
      <>
      {/* View mode */}
      {!isMobileListOnly && !isClubAppVariant && (
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
              onClick={() => setScheduleViewMode('list')}
              className="v-view-toggle"
              aria-pressed={scheduleViewMode === 'list'}
            >
              <Rows3 size={12} /> Lista
            </button>
            <button
              type="button"
              onClick={() => setScheduleViewMode('timeline')}
              className="v-view-toggle"
              aria-pressed={scheduleViewMode === 'timeline'}
            >
              <LayoutGrid size={12} /> Grilla
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ ...sectionStyle, marginTop: 0 }}>
          <div style={labelStyle}>
            <Clock size={12} style={{ color: 'var(--accent-fg)' }} />
            {activeScheduleViewMode === 'timeline' ? 'Agenda de canchas' : 'Horarios disponibles'}
          </div>
          {/* Esqueleto con la forma de la grilla de horarios */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }} role="status" aria-label="Cargando horarios">
            {Array.from({ length: isMobileListOnly ? 8 : 12 }, (_, index) => (
              <Skeleton key={index} height={38} radius={12} />
            ))}
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
            <Clock size={12} style={{ color: 'var(--accent-fg)' }} />
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
                                {formatCourtPriceLabel(court, selectedDuration, `Duración ${selectedDuration} min`)}
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
                --slot-selected-bg: var(--brand, #B6F36A);
                --slot-selected-border: var(--brand, #B6F36A);
                --slot-selected-text: var(--brand-on, #1F3A0E);
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
              .v-slot--short{ padding:5px 8px; border-style:dashed; border-color:var(--warn-fg, #B45309); background:var(--warn-bg, rgba(245,158,11,.1)); color:var(--slot-text); }
              .v-slot--short:hover{ background:var(--warn-bg, rgba(245,158,11,.1)); border-color:var(--warn-fg, #B45309); }
              .v-slot-tag{ display:block; margin-top:1px; font-size:9px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--warn-fg, #B45309); }
              .v-slot--selected .v-slot-tag{ color:var(--slot-selected-text); }
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
                      className={`v-slot${slot.shortOnly ? ' v-slot--short' : ''}${isSelected ? ' v-slot--selected' : ''}${isDisabled ? ' v-slot--disabled' : ''}`}
                      onClick={() => { if (!isDisabled) { setSelectedSlot(slot.slotTime); setSelectedCourt(null); } }}
                      aria-pressed={isSelected}
                      aria-disabled={isDisabled}
                      aria-label={slot.shortOnly ? `${slot.slotTime}, solo ${formatDurationShort(slot.shortMinutes)}` : undefined}
                    >
                      {slot.slotTime}
                      {slot.shortOnly && <span className="v-slot-tag">Solo {formatDurationShort(slot.shortMinutes)}</span>}
                    </button>
                  );
                })}
              </div>
              {isMobileListOnly && availableSlots.length > MOBILE_VISIBLE_SLOTS_LIMIT && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                  <button
                    type="button"
                    className="bg-more-btn"
                    onClick={() => setShowAllMobileSlots((prev) => !prev)}
                    aria-expanded={showAllMobileSlots}
                  >
                    {showAllMobileSlots ? 'Ver menos horarios' : `Ver todos los horarios (${availableSlots.length})`}
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

      {/* Cancha: se asigna sola; "Cambiar" abre la lista */}
      {activeScheduleViewMode === 'list' && selectedSlot && (
        <div style={useStickyCta ? undefined : sectionStyle}>
          <div style={labelStyle}><MapPin size={12} style={{ color: 'var(--accent-fg)' }} /> Cancha</div>
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
            .v-court-fit{flex-shrink:0;padding:3px 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2);color:${T.textMuted};font-size:10px;font-weight:800;white-space:nowrap;}
            .v-court-fit.is-short{border-color:var(--warn-fg, #B45309);background:var(--warn-bg, rgba(245,158,11,.1));color:var(--warn-fg, #B45309);}
            .v-gap-note{margin-bottom:10px;padding:12px 14px;border-radius:14px;border:1px solid var(--warn-fg, #B45309);background:var(--warn-bg, rgba(245,158,11,.1));font-family:'Geist',system-ui,sans-serif;}
            .v-gap-title{margin:0;font-size:13px;font-weight:800;color:${T.textPrimary};line-height:1.35;}
            .v-gap-copy{margin:3px 0 0;font-size:12px;font-weight:500;color:${T.textMuted};line-height:1.45;}
            .v-gap-alts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px;font-size:11px;font-weight:700;color:${T.textMuted};}
            .v-gap-alt{min-height:32px;padding:5px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface-1);color:${T.textPrimary};font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}
            .v-gap-alt:hover{border-color:var(--accent-border);background:var(--accent-bg-faint);}
            .v-gap-alt:focus-visible{outline:2px solid var(--accent-fg);outline-offset:2px;}
          `}</style>
          {(() => {
            const current = availableSlots.find(s => s.slotTime === selectedSlot);
            if (!current?.shortOnly) return null;
            const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
            const target = toMinutes(current.slotTime);
            // Horarios más cercanos donde sí entra el turno completo.
            const alternatives = availableSlots
              .filter(s => !s.shortOnly)
              .sort((a, b) => Math.abs(toMinutes(a.slotTime) - target) - Math.abs(toMinutes(b.slotTime) - target))
              .slice(0, 3)
              .sort((a, b) => toMinutes(a.slotTime) - toMinutes(b.slotTime));
            return (
              <div className="v-gap-note" role="note">
                <p className="v-gap-title">
                  A las {current.slotTime} hay lugar para {formatDurationShort(current.shortMinutes)} (hasta {addMinutesToSlotTime(current.slotTime, current.shortMinutes)})
                </p>
                <p className="v-gap-copy">
                  Después hay otra reserva. Podés jugar {formatDurationShort(current.shortMinutes)} pagando el mismo precio por jugador.
                </p>
                {alternatives.length > 0 && (
                  <div className="v-gap-alts">
                    <span>{formatDurationShort(selectedDuration)} completas:</span>
                    {alternatives.map(alt => (
                      <button
                        key={alt.slotTime}
                        type="button"
                        className="v-gap-alt"
                        onClick={() => { setSelectedSlot(alt.slotTime); setSelectedCourt(null); }}
                      >
                        {alt.slotTime}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const slotCourts = availableSlots.find(s => s.slotTime === selectedSlot)?.courts || [];
            if (selectedCourt && !courtPickerOpen) {
              const courtFit = getCourtFitMinutes(selectedCourt);
              return (
                <div className="bg-court-line">
                  <div style={{ minWidth: 0 }}>
                    <p className="bg-court-line-name">{selectedCourt.name}</p>
                    <p className="bg-court-line-meta">{formatCourtPriceLabel(selectedCourt, courtFit, 'Precio a confirmar')}</p>
                  </div>
                  {slotCourts.length > 1 && (
                    <button type="button" className="bg-link-btn" onClick={() => setCourtPickerOpen(true)}>
                      Cambiar
                    </button>
                  )}
                </div>
              );
            }
            const showFitBadges = slotCourts.some(c => getCourtFitMinutes(c) < selectedDuration);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {slotCourts.map(court => {
                  if (!selectedDate) return null;
                  const dateStr = formatLocalDate(selectedDate);
                  const slotKey = `${dateStr}-${selectedSlot}-${court.id}`;
                  const isSelected = selectedCourt?.id === court.id;

                  const handleSelectCourt = () => {
                    if (!selectedDate || !selectedSlot) return;
                    const currentSlot = availableSlots.find(s => s.slotTime === selectedSlot);
                    const availIds = new Set((currentSlot?.courts || []).map(c => c.id));
                    if (!availIds.has(court.id)) { setDisabledSlots(prev => ({ ...prev, [slotKey]: true })); showError('Cancha ya no disponible.'); return; }
                    setSelectedCourt(court);
                    setCourtPickerOpen(false);
                  };

                  const courtFit = getCourtFitMinutes(court);
                  const isShortCourt = courtFit < selectedDuration;

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
                          {formatCourtPriceLabel(court, courtFit, 'Precio a confirmar')}
                          {isShortCourt && selectedSlot ? ` · libre hasta ${addMinutesToSlotTime(selectedSlot, courtFit)}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {showFitBadges && (
                          <span className={`v-court-fit${isShortCourt ? ' is-short' : ''}`}>
                            {isShortCourt ? `Solo ${formatDurationShort(courtFit)}` : formatDurationShort(selectedDuration)}
                          </span>
                        )}
                        <div className="v-court-dot" />
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
      {/* No slots */}
      {!loading && selectedActivityFilter && availableSlots.length === 0 && selectedDate && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '28px 20px', background: T.bgSubtle, border: `1px dashed ${T.borderSubtle}`, borderRadius: 16, fontSize: 13, fontWeight: 600, color: T.textSecondary, marginBottom: 20, textAlign: 'center' }}>
          {(() => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const sel = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            if (sel < today) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Hourglass size={16} /> No se puede viajar al pasado…</span>;
            const weekdayPlural = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
            const weekdayName = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            const closedReason = closedReasonFor(sel);
            const isToday = sel.getTime() === today.getTime();
            // Cerrado ≠ lleno: decimos cuál es, y ofrecemos el próximo día que abre.
            const message = closedReason === 'WEEKDAY'
              ? <><Moon size={16} /> El club no abre los {weekdayPlural[sel.getDay()]}.</>
              : closedReason === 'CLOSURE'
                ? <><Ban size={16} /> El club está cerrado este día.</>
                : isToday
                  ? <><Moon size={16} /> Ya no quedan turnos libres por hoy.</>
                  : <><Ban size={16} /> No quedan turnos libres este día.</>;
            const next = nextOpenDateAfter(sel);
            const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
            const nextLabel = next
              ? next.getTime() === tomorrow.getTime()
                ? 'Ver mañana'
                : `Ver el ${weekdayName[next.getDay()]} ${next.getDate()}`
              : null;
            return (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{message}</span>
                {next && nextLabel && (
                  <button
                    type="button"
                    onClick={() => { setSelectedDate(next); setSelectedSlot(null); setSelectedCourt(null); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: `1px solid ${T.borderSubtle}`, background: T.bgCard, color: T.textPrimary, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {nextLabel} <ChevronRight size={14} />
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Resumen + botón. En mobile (web) va en una barra fija abajo. */}
      {useStickyCta ? (
        <>
          <div className="p-action-bar" role="region" aria-label="Tu reserva">
            <div className="p-action-bar-info">
              <p className="p-action-bar-main">{bookingSummary?.main}</p>
              <p className="p-action-bar-sub">{bookingSummary?.sub}</p>
            </div>
            <button type="button" className="p-action-bar-btn" onClick={handleBooking}>
              Continuar
            </button>
          </div>
        </>
      ) : (
        <>
          {canConfirm && bookingSummary && (
            <p className="bg-summary">
              <b>{bookingSummary.main}</b> · {bookingSummary.sub}
              {priceInfo.hasLights && clubConfig ? ` · incluye luces +${formatMoney(priceInfo.extra)}` : ''}
            </p>
          )}
          <button type="button" className="bg-cta" onClick={handleBooking} disabled={!canConfirm} style={{ marginTop: 8 }}>
            {canConfirm && bookingSummary ? (
              <>Continuar <span className="bg-cta-price">· {bookingSummary.price}</span></>
            ) : 'Elegí un horario'}
          </button>
        </>
      )}
      </>
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
