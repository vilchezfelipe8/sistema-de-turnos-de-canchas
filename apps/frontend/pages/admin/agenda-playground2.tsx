import Head from 'next/head';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, MoreVertical, Pencil, Plus, Repeat, Search, User, Users, CreditCard, Settings, X, Receipt, BarChart3, Trophy, MessageSquare, ShoppingBag, FileText, GraduationCap, Lock, Trash2, LogOut } from 'lucide-react';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect, logout } from '../../services/AuthService';
import { ClubAdminService, type BookingBillingConfig } from '../../services/ClubAdminService';
import { cancelBooking, confirmBooking, createBooking, createFixedBooking, getAdminSchedule, getBookingBillingConfig, getBookingById, getBookingFinancialSummary, getBookingQuote, getBookingTimelineEvents, registerBookingPartialPayment, updateBookingBillingConfig, type BookingDomainEvent } from '../../services/BookingService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { reportUiError } from '../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser, setActiveClubId } from '../../utils/session';
import { normalizeApiError } from '../../utils/apiError';
import { resolveBookingErrorBehavior } from '../../utils/bookingErrorMap';
import BookingDrawerShell from '../../modules/admin/bookingDrawer/components/BookingDrawerShell';
import { bookingDrawerReducer, initialBookingDrawerState } from '../../modules/admin/bookingDrawer/reducer';
import type { BookingDrawerDraft as NewBookingDrawerDraft, BookingPayment as NewBookingPayment } from '../../modules/admin/bookingDrawer/types';

type SportFilter = string;

type Court = {
  id: string;
  name: string;
  sport: string;
  activityTypeId?: number;
  defaultDurationMinutes?: number;
};

type Booking = {
  id: string;
  courtId: string;
  startSlot: number;
  endSlot: number;
  title: string;
  state: 'pending' | 'confirmed' | 'completed' | 'blocked';
  paymentState: 'paid' | 'unpaid';
  isRecurring?: boolean;
  clientId?: string;
  userId?: number;
};

type DraftSelection = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

type BookingDropPreview = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

type PaymentMode = 'Ãšnico' | 'Dividido';

type RecurringOverlapItem = {
  courtName: string;
  requestedDateLabel: string;
  requestedTimeLabel: string;
  conflictingDateLabel?: string;
  conflictingTimeLabel?: string;
  activityName?: string;
  clientName?: string;
};

type DraggingBookingMeta = {
  bookingId: string;
  durationSlots: number;
  title: string;
  state: Booking['state'];
  paymentState: Booking['paymentState'];
  isRecurring?: boolean;
  courtId: string;
  startSlot: number;
};

type PendingBookingPointer = {
  booking: Booking;
  startX: number;
  startY: number;
};

type EditingBaseline = {
  id: string;
  courtId: string;
  startSlot: number;
  endSlot: number;
  title: string;
};

type Participant = {
  id: string;
  name: string;
  contact: string;
  paid: boolean;
  isOwner: boolean;
  sourceType: 'clubClient' | 'systemUser' | 'guest';
  entityRef?: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  customPrice: number | null;
};

type ParticipantSuggestion = {
  id: string;
  label: string;
  secondary?: string;
  sourceType: Participant['sourceType'];
  entityRef?: string;
  name: string;
  contact?: string;
};

type BookingKind = 'regular' | 'recurring' | 'privateClass' | 'courseClass' | 'block';
type RecurringFrequencyPreset = 'weekly' | 'biweekly' | 'custom';
type ComboOption = { value: string; label: string };
type SimplifiedSidebarSection = 'DETAILS' | 'BILLING' | 'HISTORY';


const sidebarItems = [
  { label: 'Calendario', icon: CalendarDays, active: true },
  { label: 'Clientes', icon: Users },
  { label: 'Pagos', icon: CreditCard },
  { label: 'Reservas', icon: Receipt },
  { label: 'Partidos', icon: Trophy },
  { label: 'Tienda', icon: ShoppingBag },
  { label: 'Mensajes', icon: MessageSquare },
  { label: 'FacturaciÃ³n', icon: FileText },
  { label: 'Informes', icon: BarChart3 },
  { label: 'Ajustes', icon: Settings },
];

const rowHeight = 120; // visual height per hour (zoom vertical para diferenciar mejor 15m vs 30m)
const startHour = 8;
const endHour = 23;
const slotMinutes = 15;
const slotsPerHour = 60 / slotMinutes;
const totalSlots = (endHour - startHour) * slotsPerHour;
const slotHeight = rowHeight / slotsPerHour; // selectable 15-min blocks
const gridHeight = totalSlots * slotHeight;


const initialParticipants: Participant[] = [
  { id: 'owner', name: '', contact: '', paid: false, isOwner: true, sourceType: 'guest', paymentMethod: 'CASH', customPrice: null },
];

const MAX_MANUAL_PARTICIPANT_PRICE = 100000;
const DRAWER_CLOSE_RESET_DELAY_MS = 320;

const bookingKindOptions: Array<{
  value: BookingKind;
  label: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    value: 'regular',
    label: 'Reserva normal',
    description: 'Para reservas individuales de un solo dÃ­a y pista',
    icon: CalendarDays,
  },
  {
    value: 'recurring',
    label: 'Serie recurrente',
    description: 'Para reservas que se repiten con una frecuencia. Reservas en mÃºltiples pistas permitidas.',
    icon: Repeat,
  },
  {
    value: 'privateClass',
    label: 'Clase privada',
    description: 'Para reservas de clases puntuales con un entrenador',
    icon: User,
  },
  {
    value: 'courseClass',
    label: 'Clase de curso',
    description: 'Para crear las clases de un curso',
    icon: GraduationCap,
  },
  {
    value: 'block',
    label: 'Bloqueo',
    description: 'Para bloquear una pista y evitar nuevas reservas en ese rango.',
    icon: Lock,
  },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'MiÃ©rcoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'SÃ¡bado' },
];
const CUSTOM_DAY_OPTIONS = [
  { value: 1, short: 'Lu' },
  { value: 2, short: 'Ma' },
  { value: 3, short: 'Mi' },
  { value: 4, short: 'Ju' },
  { value: 5, short: 'Vi' },
  { value: 6, short: 'Sa' },
  { value: 0, short: 'Do' },
];

function isParticipantPaymentMethod(value: string): value is Participant['paymentMethod'] {
  return value === 'CASH' || value === 'TRANSFER' || value === 'CARD' || value === 'OTHER';
}

function formatPaymentMethodLabel(method: string): string {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'TRANSFER') return 'Transferencia';
  if (method === 'CARD') return 'Tarjeta';
  if (method === 'OTHER') return 'Otro';
  return 'Pago';
}

const LEGACY_UI_EXACT_LABELS: Record<string, string> = {
  owner: 'Titular',
  date: 'Fecha',
  court: 'Cancha',
  time: 'Hora',
  locked: 'Bloqueada',
  add: 'Agregar',
  price: 'Precio',
  payment: 'Pago',
  payments: 'Pagos',
};

const LEGACY_UI_INLINE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bOwner\b/gi, replacement: 'Titular' },
  { pattern: /\bDate\b/gi, replacement: 'Fecha' },
  { pattern: /\bCourt\b/gi, replacement: 'Cancha' },
  { pattern: /\bTime\b/gi, replacement: 'Hora' },
  { pattern: /\bLocked\b/gi, replacement: 'Bloqueada' },
  { pattern: /\bAdd\b/gi, replacement: 'Agregar' },
  { pattern: /\bPrice\b/gi, replacement: 'Precio' },
  { pattern: /\bPayments?\b/gi, replacement: 'Pago' },
];

function localizeLegacyUiText(rawValue: unknown): string {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const exact = LEGACY_UI_EXACT_LABELS[raw.toLowerCase()];
  if (exact) return exact;

  const courtNumber = raw.match(/^court\s+(\d+)$/i);
  if (courtNumber) return `Cancha ${courtNumber[1]}`;

  return LEGACY_UI_INLINE_REPLACEMENTS.reduce(
    (accumulator, item) => accumulator.replace(item.pattern, item.replacement),
    raw
  );
}

function toUserSafeMessage(rawValue: unknown, fallback: string): string {
  const fallbackMessage = String(fallback || '').trim() || 'Ocurrio un error inesperado.';
  const localizedFallback = localizeLegacyUiText(fallbackMessage) || fallbackMessage;
  const raw = String(rawValue || '').trim();
  if (!raw) return localizedFallback;

  const normalized = raw.toLowerCase();
  const hasInternalKeywords = [
    'backend',
    'frontend',
    'payload',
    'table',
    'column',
    'sql',
    'prisma',
    'stack',
    'booking-client:',
    'booking-user:',
    'guest:',
    'accountid',
    'assignmentid',
    'chargeresponsibleref',
    'entityref',
  ].some((keyword) => normalized.includes(keyword));

  if (hasInternalKeywords) return localizedFallback;

  const cleaned = raw
    .replace(/\b(TypeError|ReferenceError|SyntaxError)\b:?/gi, '')
    .replace(/\bBOOKING_[A-Z_]+\b/g, 'reserva')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const localized = localizeLegacyUiText(cleaned);
  return localized || localizedFallback;
}
function PlaygroundCombo({
  value,
  options,
  onChange,
  compact = false,
  align = 'left',
  className = '',
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  compact?: boolean;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className={`playground-combo ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className={`playground-combo-trigger ${compact ? 'playground-combo-trigger-compact' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.label || ''}</span>
        <ChevronDown size={14} className={`playground-combo-chevron ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`playground-combo-menu ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`playground-combo-option ${active ? 'playground-combo-option-active' : ''}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function slotToTime(slot: number) {
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function slotToTimeAmPm(slot: number) {
  const [hoursRaw, minutesRaw] = slotToTime(slot).split(':').map(Number);
  const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;
  const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
  const period = hours >= 12 ? 'p. m.' : 'a. m.';
  const hours12 = ((hours + 11) % 12) + 1;
  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
}

function normalizeBookingDisplayTitle(rawTitle: unknown, fallback = 'Reserva') {
  const title = String(rawTitle || '').trim();
  if (!title) return fallback;

  const normalized = title.toLowerCase();
  if (normalized === 'locked' || normalized === 'block' || normalized === 'blocked') {
    return 'Bloqueo';
  }

  return title;
}

function timeToSlot(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  const start = startHour * 60;
  return Math.max(0, Math.min(totalSlots, Math.round((total - start) / slotMinutes)));
}

function buildSelectionDateTime(baseDate: Date, slot: number) {
  const next = new Date(baseDate);
  next.setHours(0, 0, 0, 0);
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function minutesToHourLabel(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safeMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (safeMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function toSelectionRange(selection: DraftSelection) {
  return {
    start: Math.min(selection.startSlot, selection.endSlot),
    end: Math.max(selection.startSlot, selection.endSlot) + 1,
  };
}

function bookingColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-[#1d2248] text-[#f7f7fb]';
  if (state === 'confirmed') return 'bg-[#dce7ff] text-[#1d3b8f] border border-[#c7d8ff]';
  if (state === 'blocked') return 'bg-[#ff5d7a] text-white bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.18)_50%,rgba(255,255,255,0.18)_75%,transparent_75%,transparent)] bg-[length:14px_14px]';
  return 'bg-[#d7f2d7] text-[#123525] border border-[#c3e9c3]';
}

function bookingStatusLabel(state: Booking['state']) {
  if (state === 'completed') return 'COMPLETADA';
  if (state === 'confirmed') return 'CONFIRMADA';
  if (state === 'blocked') return 'BLOQUEADO';
  return 'PENDIENTE';
}

function bookingBadgeColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-[#1d2248] text-white';
  if (state === 'confirmed') return 'bg-[#2d4fc9] text-white';
  if (state === 'blocked') return 'bg-[#9f1635] text-white';
  return 'bg-[#2f6b45] text-white';
}

function bookingPaymentLabel(state: Booking['paymentState']) {
  return state === 'paid' ? 'PAGADA' : 'SIN PAGO';
}

function bookingPaymentBadgeColor(state: Booking['paymentState']) {
  return state === 'paid' ? 'bg-[#166534] text-white' : 'bg-[#6b7280] text-white';
}

function distributePaidByParticipants(
  participants: Participant[],
  paymentMode: PaymentMode,
  totalAmount: number,
  paidAmount: number
) {
  const safeTotal = Number(Math.max(0, totalAmount || 0).toFixed(2));
  let remainingPaid = Number(Math.max(0, paidAmount || 0).toFixed(2));

  if (paymentMode === 'Ãšnico') {
    return participants.map((participant) => {
      if (!participant.isOwner) return { ...participant, paid: false };
      const covered = remainingPaid + 0.009 >= safeTotal;
      if (covered) remainingPaid = Number(Math.max(0, remainingPaid - safeTotal).toFixed(2));
      return { ...participant, paid: covered };
    });
  }

  const active = participants.filter((participant) => participant.name.trim().length > 0);
  const target = active.length > 0 ? active : participants.filter((participant) => participant.isOwner);
  const paidTargetIds = new Set<string>();
  const share = target.length > 0 ? Number((safeTotal / target.length).toFixed(2)) : safeTotal;

  for (const participant of target) {
    if (remainingPaid + 0.009 >= share) {
      paidTargetIds.add(participant.id);
      remainingPaid = Number(Math.max(0, remainingPaid - share).toFixed(2));
    }
  }

  return participants.map((participant) => ({ ...participant, paid: paidTargetIds.has(participant.id) }));
}

function blockContentVisibility(height: number) {
  return {
    showDurationOnly: height < 30,
    showBadge: height >= 52,
    showTitle: height >= 34,
    showTimeRange: height >= 42,
  };
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextDateForDay(baseDate: Date, targetDayIndex: number, timeStr: string) {
  const resultDate = new Date(baseDate);
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
  return resultDate;
}

function humanizeClubSlug(slug: string) {
  const safe = String(slug || '').trim();
  if (!safe) return '';
  return safe
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveHoverParticipantsForBooking(booking: Booking) {
  const ownerName = String(booking.title || '').trim();
  return [
    {
      id: `owner-${booking.id}`,
      name: ownerName || 'Titular',
      paid: booking.paymentState === 'paid',
      isOwner: true,
      paymentMethod: '',
      payable: true,
    },
  ];
}

function estimateBookingHoverTarjetaHeight(participantsCount: number) {
  const rows = Math.max(1, participantsCount);
  // Header + paddings + rows (estimaciÃ³n mÃ¡s cercana al tamaÃ±o real del hover).
  return 40 + 12 + rows * 30 + 8;
}

function normalizeParticipantText(value: string) {
  return String(value || '').trim().toLowerCase();
}

function participantIdentityTokens(input: Pick<Participant, 'sourceType' | 'name' | 'contact'>) {
  const name = normalizeParticipantText(input.name);
  const contact = normalizeParticipantText(input.contact);
  const email = contact.includes('@') ? contact : '';
  const phone = contact.replace(/\D/g, '');
  const tokens: string[] = [];
  if (email) tokens.push(`${input.sourceType}:email:${email}`);
  if (phone.length >= 6) tokens.push(`${input.sourceType}:phone:${phone}`);
  if (contact) tokens.push(`${input.sourceType}:contact:${contact}`);
  if (name) tokens.push(`${input.sourceType}:name:${name}`);
  return Array.from(new Set(tokens));
}

function buildStartDateTimeFromSlot(baseDate: Date, slot: number) {
  const [hh, mm] = slotToTime(slot).split(':').map(Number);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  );
}

function parseScheduleSlotToBooking(slot: any): Booking | null {
  const booking = slot?.booking;
  if (!booking) return null;

  const start = booking?.startDateTime ? new Date(booking.startDateTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  let end: Date | null = booking?.endDateTime ? new Date(booking.endDateTime) : null;
  if (!end || Number.isNaN(end.getTime())) {
    const duration = Number(booking?.durationMinutes || booking?.activity?.defaultDurationMinutes || 60);
    end = new Date(start.getTime() + Math.max(30, duration) * 60000);
  }

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const baseMinutes = startHour * 60;
  const startSlotRaw = Math.floor((startMinutes - baseMinutes) / slotMinutes);
  const endSlotRaw = Math.ceil((endMinutes - baseMinutes) / slotMinutes);
  const startSlot = Math.max(0, Math.min(totalSlots - 1, startSlotRaw));
  const endSlot = Math.max(startSlot + 1, Math.min(totalSlots, endSlotRaw));

  const status = String(booking?.status || '').toUpperCase();
  const state: Booking['state'] =
    status === 'CANCELLED'
      ? 'blocked'
      : status === 'COMPLETED'
        ? 'completed'
        : status === 'CONFIRMED'
          ? 'confirmed'
          : 'pending';

  const paidAmount = Number(
    booking?.confirmationContext?.paidAmount ??
      booking?.paidAmount ??
      booking?.financialSummary?.paid ??
      0
  );
  const bookingPrice = Number(booking?.price ?? 0);
  const paymentState: Booking['paymentState'] =
    bookingPrice <= 0 || paidAmount + 0.009 >= bookingPrice ? 'paid' : 'unpaid';

  return {
    id: String(booking?.id || slot?.id || `${slot?.courtId}-${slot?.slotTime || start.toISOString()}`),
    courtId: String(slot?.courtId || booking?.courtId || booking?.court?.id || ''),
    startSlot,
    endSlot,
    title: normalizeBookingDisplayTitle(
      booking?.client?.name || booking?.clientName || booking?.activity?.name,
      'Reserva'
    ),
    state,
    paymentState,
    isRecurring: Number(booking?.fixedBookingId || 0) > 0,
    clientId: booking?.client?.id ? String(booking.client.id) : undefined,
    userId: Number(booking?.userId || booking?.user?.id || 0) || undefined,
  };
}



function roundMoney(value: number) {
  return Number((Math.max(0, value) || 0).toFixed(2));
}

function clampParticipantPrice(value: number) {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(Math.min(Math.max(0, value), MAX_MANUAL_PARTICIPANT_PRICE));
}

function parseMoneyInput(raw: string) {
  const normalized = String(raw || '').replace(',', '.').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return clampParticipantPrice(parsed);
}

function resolveChargedParticipantIds(
  participants: Participant[],
  paymentMode: PaymentMode,
  singleChargeParticipantId?: string
) {
  if (paymentMode === 'Ãšnico') {
    if (singleChargeParticipantId && participants.some((participant) => participant.id === singleChargeParticipantId)) {
      return [singleChargeParticipantId];
    }
    const owner = participants.find((participant) => participant.isOwner);
    return owner ? [owner.id] : [];
  }

  const named = participants.filter((participant) => participant.name.trim().length > 0);
  if (named.length > 0) return named.map((participant) => participant.id);

  const owner = participants.find((participant) => participant.isOwner);
  return owner ? [owner.id] : [];
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolvePlaygroundClientPhone(owner?: Participant | null) {
  const fromContact = String(owner?.contact || '').replace(/\D/g, '');
  if (fromContact.length >= 8) {
    return fromContact.startsWith('54') ? `+${fromContact}` : `+54${fromContact}`;
  }

  const seed = String(owner?.name || 'cliente').trim().toLowerCase();
  const suffix = String((hashText(seed) % 90_000_000) + 10_000_000);
  return `+54911${suffix}`;
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toSlugToken(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'guest';
}

function buildStableParticipantRef(
  participant: Participant,
  options?: {
    bookingClientId?: string;
    bookingUserId?: number;
  }
) {
  if (participant.entityRef && String(participant.entityRef).trim().length > 0) {
    return String(participant.entityRef).trim();
  }
  if (participant.isOwner && options?.bookingClientId) {
    return `booking-client:${String(options.bookingClientId)}`;
  }
  if (participant.isOwner && options?.bookingUserId) {
    return `booking-user:${Number(options.bookingUserId)}`;
  }
  if (participant.sourceType === 'systemUser') {
    const fromContact = String(participant.contact || '').trim();
    if (fromContact) return `user:${toSlugToken(fromContact)}`;
  }
  if (participant.sourceType === 'clubClient') {
    const fromContact = String(participant.contact || '').trim();
    if (fromContact) return `client:${toSlugToken(fromContact)}`;
  }
  return `guest:${String(participant.id)}`;
}

function normalizeParticipantSourceType(value: unknown): Participant['sourceType'] {
  if (value === 'clubClient' || value === 'systemUser') return value;
  return 'guest';
}

function normalizeParticipantPaymentMethod(value: unknown): Participant['paymentMethod'] {
  if (value === 'TRANSFER' || value === 'CARD' || value === 'OTHER') return value;
  return 'CASH';
}

function buildDefaultParticipantsForBooking(booking: Booking): Participant[] {
  const ownerEntityRef =
    booking.clientId
      ? `booking-client:${booking.clientId}`
      : booking.userId
        ? `booking-user:${Number(booking.userId)}`
        : undefined;
  const ownerSourceType: Participant['sourceType'] =
    booking.clientId ? 'clubClient' : booking.userId ? 'systemUser' : 'guest';
  return initialParticipants.map((participant) =>
    participant.isOwner
      ? {
          ...participant,
          id: `owner-${String(booking.id)}`,
          name: String(booking.title || ''),
          paid: booking.paymentState === 'paid',
          sourceType: ownerSourceType,
          entityRef: ownerEntityRef,
        }
      : { ...participant, paid: booking.paymentState === 'paid' }
  );
}

function inferParticipantSourceTypeFromEntityRef(entityRef: string | undefined): Participant['sourceType'] {
  const ref = String(entityRef || '').trim().toLowerCase();
  if (!ref) return 'guest';
  if (ref.startsWith('booking-client:') || ref.startsWith('client:')) return 'clubClient';
  if (ref.startsWith('booking-user:') || ref.startsWith('user:')) return 'systemUser';
  return 'guest';
}

function parseSidebarParticipantsFromMetadata(
  metadata: BookingBillingConfig['metadata'] | undefined,
  booking: Booking
): Participant[] | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const metadataRecord = metadata as Record<string, unknown>;
  const sidebarBlock =
    metadataRecord.sidebar && typeof metadataRecord.sidebar === 'object'
      ? (metadataRecord.sidebar as Record<string, unknown>)
      : null;
  const rawParticipants =
    (Array.isArray(metadataRecord.sidebarParticipants)
      ? metadataRecord.sidebarParticipants
      : (Array.isArray(sidebarBlock?.participants) ? sidebarBlock?.participants : null)) as
      | Array<Record<string, unknown>>
      | null;

  if (!Array.isArray(rawParticipants)) return null;

  const mapped = rawParticipants
    .map((rawParticipant, index) => {
      if (!rawParticipant || typeof rawParticipant !== 'object') return null;
      const rawRef = String(rawParticipant.ref || rawParticipant.entityRef || '').trim();
      const rawName = String(rawParticipant.name || '').trim();
      const rawContact = String(rawParticipant.contact || '').trim();
      const rawId = String(rawParticipant.id || '').trim();
      const baseToken = rawRef || rawId || rawName || `participant-${index + 1}`;
      return {
        id: rawId || `meta-${index}-${toSlugToken(baseToken)}`,
        name: rawName,
        contact: rawContact,
        paid: Boolean(rawParticipant.paid),
        isOwner: Boolean(rawParticipant.isOwner),
        sourceType: normalizeParticipantSourceType(rawParticipant.sourceType),
        entityRef: rawRef || undefined,
        paymentMethod: normalizeParticipantPaymentMethod(rawParticipant.paymentMethod),
        customPrice: null,
      } satisfies Participant;
    })
    .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant));

  if (mapped.length === 0) return buildDefaultParticipantsForBooking(booking);
  if (!mapped.some((participant) => participant.isOwner)) {
    mapped[0] = { ...mapped[0], isOwner: true };
  }
  return mapped;
}

function parseSidebarNotesFromMetadata(metadata: BookingBillingConfig['metadata'] | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const metadataRecord = metadata as Record<string, unknown>;
  const sidebarBlock =
    metadataRecord.sidebar && typeof metadataRecord.sidebar === 'object'
      ? (metadataRecord.sidebar as Record<string, unknown>)
      : null;
  if (typeof metadataRecord.sidebarNotes === 'string') return metadataRecord.sidebarNotes;
  if (typeof sidebarBlock?.notes === 'string') return sidebarBlock.notes;
  return null;
}

function buildSidebarParticipantsMetadata(participants: Participant[]) {
  return participants.map((participant) => ({
    id: String(participant.id || ''),
    ref: String(participant.entityRef || ''),
    name: String(participant.name || ''),
    contact: String(participant.contact || ''),
    isOwner: Boolean(participant.isOwner),
    sourceType: normalizeParticipantSourceType(participant.sourceType),
    paymentMethod: normalizeParticipantPaymentMethod(participant.paymentMethod),
  }));
}

function buildSidebarComparableParticipants(participants: Participant[]) {
  return participants
    .map((participant) => ({
      name: String(participant.name || '').trim(),
      contact: String(participant.contact || '').trim(),
      isOwner: Boolean(participant.isOwner),
      sourceType: normalizeParticipantSourceType(participant.sourceType),
      entityRef: String(participant.entityRef || '').trim(),
      paymentMethod: normalizeParticipantPaymentMethod(participant.paymentMethod),
    }))
    .sort((left, right) => {
      const ownerDiff = Number(right.isOwner) - Number(left.isOwner);
      if (ownerDiff !== 0) return ownerDiff;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      const byContact = left.contact.localeCompare(right.contact);
      if (byContact !== 0) return byContact;
      const byRef = left.entityRef.localeCompare(right.entityRef);
      if (byRef !== 0) return byRef;
      const bySource = left.sourceType.localeCompare(right.sourceType);
      if (bySource !== 0) return bySource;
      return left.paymentMethod.localeCompare(right.paymentMethod);
    });
}

function resolveDefaultAssignmentIdForDraft(draft?: NewBookingDrawerDraft | null) {
  if (!draft) return undefined;
  const assignments = Array.isArray(draft.billing.assignments) ? draft.billing.assignments : [];
  if (assignments.length === 0) return undefined;

  if (draft.billing.chargeMode === 'INDIVIDUAL') {
    const responsibleId = String(draft.billing.chargeResponsibleParticipantId || '');
    if (responsibleId) {
      const responsibleAssignment = assignments.find(
        (assignment) =>
          assignment.participantId === responsibleId &&
          assignment.isChargeable &&
          assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
      );
      if (responsibleAssignment) return responsibleAssignment.id;
    }
  }

  const firstActiveChargeable = assignments.find(
    (assignment) =>
      assignment.isChargeable && assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
  );
  if (firstActiveChargeable) return firstActiveChargeable.id;

  const firstChargeable = assignments.find((assignment) => assignment.isChargeable);
  if (firstChargeable) return firstChargeable.id;

  return undefined;
}

function resolveOwnerAssignmentIdForDraft(draft?: NewBookingDrawerDraft | null) {
  if (!draft) return undefined;
  const bookingResponsibleId =
    String(draft.operational.bookingResponsibleParticipantId || '').trim() ||
    String(
      draft.participants.find(
        (participant) => participant.bookingRole === 'BOOKING_RESPONSIBLE' && !participant.archived
      )?.id || ''
    ).trim();
  if (!bookingResponsibleId) return undefined;

  const ownerAssignment = draft.billing.assignments.find(
    (assignment) =>
      assignment.participantId === bookingResponsibleId &&
      assignment.isChargeable &&
      assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
  );

  return ownerAssignment?.id;
}

function isBlockingQuoteError(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const blockers = [
    'no se pueden reservar turnos en el pasado',
    'duracion no permitida por el club',
    'horario no permitido por el club',
    'el club esta cerrado ese dia',
    'la actividad esta cerrada para la fecha seleccionada',
    'la reserva excede el horario de apertura del club',
    'limite de anticipacion excedido',
    'precio de cancha no configurado',
    'cancha en mantenimiento',
    'actividad no existe',
    'la actividad no pertenece al club de la cancha',
  ];
  return blockers.some((token) => normalized.includes(token));
}

function inferCourtSport(courtLike: any): string {
  const candidates = [
    courtLike?.sport,
    courtLike?.surface,
    courtLike?.surfaceType,
    courtLike?.activityType?.name,
    courtLike?.activity?.name,
    courtLike?.name,
  ]
    .map(normalizeText)
    .filter((value) => value.length > 0);

  const full = candidates.join(' ');

  if (full.includes('tenis') || full.includes('tennis')) return 'Tenis';
  if (full.includes('pickle')) return 'Pickleball';
  if (full.includes('squash')) return 'Squash';
  if (full.includes('voley') || full.includes('beach volley') || full.includes('volley playa')) return 'Voley playa';
  if (full.includes('futbol') || full.includes('futbol 5')) return 'FÃºtbol';
  if (full.includes('padel') || full.includes('paddle')) return 'PÃ¡del';

  return String(courtLike?.activityType?.name || courtLike?.sport || courtLike?.surface || 'PÃ¡del');
}

export default function AdminAgendaPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [sportFilter, setSportFilter] = useState<SportFilter>('Todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [courtsData, setCourtsData] = useState<Court[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const [dragSelection, setDragSelection] = useState<DraftSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingBookingId, setDraggingBookingId] = useState<string | null>(null);
  const [draggingBookingMeta, setDraggingBookingMeta] = useState<DraggingBookingMeta | null>(null);
  const [bookingDropPreview, setBookingDropPreview] = useState<BookingDropPreview | null>(null);
  const draggingBookingMetaRef = useRef<DraggingBookingMeta | null>(null);
  const pendingBookingPointerRef = useRef<PendingBookingPointer | null>(null);
  const lastValidDropPreviewRef = useRef<BookingDropPreview | null>(null);
  const dragGrabOffsetSlotsRef = useRef<number>(0);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedStartSlot, setSelectedStartSlot] = useState(2);
  const [selectedEndSlot, setSelectedEndSlot] = useState(4);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Ãšnico');
  const [participantPriceDraftById, setParticipantPriceDraftById] = useState<Record<string, string>>({});
  const [defaultPricePerParticipant, setDefaultPricePerParticipant] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [coachSearchTerm, setProfesorSearchTerm] = useState('');
  const [simplifiedOwnerAdded, setSimplifiedOwnerAdded] = useState(false);
  const [simplifiedOwnerPaymentMethodDraft, setSimplifiedOwnerPaymentMethodDraft] = useState('');
  const [simplifiedEditingParticipantId, setSimplifiedEditingParticipantId] = useState<string | null>(null);
  const [simplifiedEditPaymentMethodDraft, setSimplifiedEditPaymentMethodDraft] = useState('');
  const [simplifiedNewParticipantOpen, setSimplifiedNewParticipantOpen] = useState(false);
  const [simplifiedNewParticipantName, setSimplifiedNewParticipantName] = useState('');
  const [simplifiedNewParticipantContact, setSimplifiedNewParticipantContact] = useState('');
  const [simplifiedPaymentModalOpen, setSimplifiedPaymentModalOpen] = useState(false);
  const [simplifiedPaymentPayerParticipantIdDraft, setSimplifiedPaymentPayerParticipantIdDraft] = useState('');
  const [simplifiedPaymentAmountDraft, setSimplifiedPaymentAmountDraft] = useState('');
  const [simplifiedPaymentMethodDraft, setSimplifiedPaymentMethodDraft] = useState('');
  const [simplifiedPaymentNoteDraft, setSimplifiedPaymentNoteDraft] = useState('');
  const [simplifiedSidebarSection, setSimplifiedSidebarSection] = useState<SimplifiedSidebarSection>('DETAILS');
  const [notes, setNotes] = useState('');
  const [notesTouchedByUser, setNotesTouchedByUser] = useState(false);
  const [blockingTitle, setBlockingTitle] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
  const [isWaitingQueuedPaymentConfirmation, setIsWaitingQueuedPaymentConfirmation] = useState(false);
  const [isDeletingBooking, setIsDeletingBooking] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [editingBaseline, setEditingBaseline] = useState<EditingBaseline | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quotedListPrice, setQuotedListPrice] = useState<number | null>(null);
  const [quotedFinalPrice, setQuotedFinalPrice] = useState<number | null>(null);
  const [quotedDiscountAmount, setQuotedDiscountAmount] = useState<number>(0);
  const [isBookingFinancialLoading, setIsBookingFinancialLoading] = useState(false);
  const [bookingTimelineEvents, setBookingTimelineEvents] = useState<BookingDomainEvent[]>([]);
  const [bookingTimelineLoading, setBookingTimelineLoading] = useState(false);
  const [bookingTimelineError, setBookingTimelineError] = useState('');
  const [bookingFinancial, setBookingFinancial] = useState<{
    total: number;
    paid: number;
    remaining: number;
    confirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
  } | null>(null);
  const [remoteBillingConfig, setRemoteBillingConfig] = useState<BookingBillingConfig | null>(null);
  const [isRemoteBillingConfigLoading, setIsRemoteBillingConfigLoading] = useState(false);
  const [billingConfigTouchedByUser, setBillingConfigTouchedByUser] = useState(false);
  const [confirmingBooking, setConfirmingBooking] = useState(false);
  const [bookingKind, setBookingKind] = useState<BookingKind>('regular');
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<number>(new Date().getDay());
  const [recurringEveryDays, setRecurringEveryDays] = useState<number>(7);
  const [recurringFrequencyPreset, setRecurringFrequencyPreset] = useState<RecurringFrequencyPreset>('weekly');
  const [recurringRepetitions, setRecurringRepetitions] = useState<number>(8);
  const [customRecurrenceModalOpen, setCustomRecurrenceModalOpen] = useState(false);
  const [customRecurrenceDays, setCustomRecurrenceDays] = useState<number[]>([new Date().getDay()]);
  const [customRepeatEveryWeeks, setCustomRepeatEveryWeeks] = useState<number>(1);
  const [customEndAfterEnabled, setCustomEndAfterEnabled] = useState<boolean>(true);
  const [customEndAfterExpanded, setCustomEndAfterExpanded] = useState<boolean>(false);
  const [customEndAfterReservations, setCustomEndAfterReservations] = useState<number>(8);
  const [recurringCourtIds, setRecurringCourtIds] = useState<string[]>([]);
  const [recurringResult, setRecurringResult] = useState<{ generatedCount: number; skippedCount: number; courtsCount: number } | null>(null);
  const [recurringOverlapItems, setRecurringOverlapItems] = useState<RecurringOverlapItem[]>([]);
  const [recurringOverlapModalOpen, setRecurringOverlapModalOpen] = useState(false);
  const [recurringCreateConfirmOpen, setRecurringCreateConfirmOpen] = useState(false);
  const [recurringCreateConfirmed, setRecurringCreateConfirmed] = useState(false);
  const [deleteBookingConfirmOpen, setDeleteBookingConfirmOpen] = useState(false);
  const [deleteParticipantConfirm, setDeleteParticipantConfirm] = useState<{
    open: boolean;
    participantId: string | null;
    participantName: string;
  }>({ open: false, participantId: null, participantName: '' });
  const [blockingErrorModalOpen, setBlockingErrorModalOpen] = useState(false);
  const [bookingCreatedModalOpen, setBookingCreatedModalOpen] = useState(false);
  const [bookingKindMenuOpen, setBookingKindMenuOpen] = useState(false);
  const [scheduleInputsDirty, setScheduleInputsDirty] = useState(false);
  const [paymentInFlightId, setPaymentInFlightId] = useState<string | null>(null);
  const [participantMenuId, setParticipantMenuId] = useState<string | null>(null);
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [participantSearchOpenId, setParticipantSearchOpenId] = useState<string | null>(null);
  const [participantSearchLoadingId, setParticipantSearchLoadingId] = useState<string | null>(null);
  const [participantSuggestionsById, setParticipantSuggestionsById] = useState<Record<string, ParticipantSuggestion[]>>({});
  const [billingHubTab, setBillingHubTab] = useState<'SUMMARY' | 'ASSIGNMENTS' | 'PAYMENTS'>('SUMMARY');
  const [bookingDrawerState, bookingDrawerDispatch] = useReducer(
    bookingDrawerReducer,
    initialBookingDrawerState
  );
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [recurringCourtsMenuOpen, setRecurringCourtsMenuOpen] = useState(false);
  const [selectedClubIdState, setSelectedClubIdState] = useState<number>(0);
  const [bookingHoverPreview, setBookingHoverPreview] = useState<{
    booking: Booking;
    x: number;
    y: number;
  } | null>(null);
  const [calendarNotice, setCalendarNotice] = useState('');
  const [isQuickDatePickerOpen, setIsQuickDatePickerOpen] = useState(false);
  const participantSearchSeqRef = useRef(0);
  const clubMenuRef = useRef<HTMLDivElement | null>(null);
  const recurringCourtsMenuRef = useRef<HTMLDivElement | null>(null);
  const quickDateInputRef = useRef<HTMLInputElement | null>(null);
  const participantContactInputRef = useRef<HTMLInputElement | null>(null);
  const agendaSurfaceRef = useRef<HTMLElement | null>(null);
  const drawerScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const calendarNoticeTimerRef = useRef<number | null>(null);
  const drawerCloseCleanupTimerRef = useRef<number | null>(null);
  const bookingFinancialRequestSeqRef = useRef(0);
  const bookingTimelineRequestSeqRef = useRef(0);
  const bookingDrawerLoadKeyRef = useRef<string>('');
  const bookingDrawerFormSyncSignatureRef = useRef<string>('');
  const normalizedUser = useMemo(() => normalizeSessionUser((user as any) || null), [user]);
  const clubOptions = useMemo(
    () =>
      Array.isArray(normalizedUser?.memberships)
        ? normalizedUser.memberships.map((membership) => ({
            id: Number(membership.clubId),
            label: String(
              (membership as any)?.club?.name ||
                humanizeClubSlug(String(membership?.club?.slug || '')) ||
                `Club #${membership.clubId}`
            ),
          }))
        : [],
    [normalizedUser]
  );

  const showCalendarNotice = useCallback((message: string) => {
    const next = toUserSafeMessage(message, '');
    if (!next) return;
    setCalendarNotice(next);
    if (calendarNoticeTimerRef.current) {
      window.clearTimeout(calendarNoticeTimerRef.current);
    }
    calendarNoticeTimerRef.current = window.setTimeout(() => {
      setCalendarNotice('');
      calendarNoticeTimerRef.current = null;
    }, 3600);
  }, []);

  const applyBookingError = useCallback(
    (
      error: unknown,
      fallbackMessage: string,
      options?: { forceNotice?: boolean }
    ) => {
      const normalized = normalizeApiError(error, fallbackMessage);
      const behavior = resolveBookingErrorBehavior(normalized);
      const message = String(normalized.message || behavior.fallbackMessage || fallbackMessage).trim();
      const safeMessage = toUserSafeMessage(
        message.length > 0 ? message : fallbackMessage,
        fallbackMessage
      );
      const safeField = String(behavior.field || normalized.field || 'general').trim() || 'general';
      setFieldErrors((previous) => ({
        ...previous,
        [safeField]: safeMessage,
      }));
      setFormError(safeMessage);
      if (options?.forceNotice || behavior.channel === 'banner') {
        showCalendarNotice(safeMessage);
      }
      return { normalized, behavior, message: safeMessage };
    },
    [showCalendarNotice]
  );

  const setBlockingFieldError = useCallback(
    (
      field: string,
      message: string,
      options?: { forceNotice?: boolean }
    ) => {
      const safeField = String(field || 'general').trim() || 'general';
      const safeMessage = String(message || '').trim();
      if (!safeMessage) return;
      setFieldErrors((previous) => ({
        ...previous,
        [safeField]: safeMessage,
      }));
      setFormError(safeMessage);
      if (options?.forceNotice) {
        showCalendarNotice(safeMessage);
      }
    },
    [showCalendarNotice]
  );

  const clearFieldErrorsFor = useCallback((fields: string[]) => {
    const keys = fields
      .map((field) => String(field || '').trim())
      .filter((field) => field.length > 0);
    if (keys.length === 0) return;
    setFieldErrors((previous) => {
      const next = { ...previous };
      keys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }, []);

  const handleNotesChange = useCallback((value: string) => {
    setNotesTouchedByUser(true);
    setNotes(value);
  }, []);

  useEffect(() => {
    if (formError.trim().length > 0) return;
    if (Object.keys(fieldErrors).length === 0) return;
    setFieldErrors({});
  }, [fieldErrors, formError]);

  useEffect(() => {
    setIsSidebarAnimating(true);
    const timerId = window.setTimeout(() => setIsSidebarAnimating(false), 220);
    return () => window.clearTimeout(timerId);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!expandedParticipantId) return;
    const timerId = window.setTimeout(() => {
      const input = participantContactInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [expandedParticipantId]);

  useEffect(() => {
    return () => {
      if (calendarNoticeTimerRef.current) {
        window.clearTimeout(calendarNoticeTimerRef.current);
      }
      if (drawerCloseCleanupTimerRef.current) {
        window.clearTimeout(drawerCloseCleanupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (bookingKind !== 'recurring') return;
    setRecurringDayOfWeek(selectedDate.getDay());
  }, [bookingKind, selectedDate]);

  useEffect(() => {
    if (bookingKind === 'recurring') return;
    setRecurringResult(null);
    setRecurringOverlapItems([]);
    setRecurringOverlapModalOpen(false);
    setRecurringCreateConfirmOpen(false);
    setRecurringCreateConfirmed(false);
  }, [bookingKind]);

  useEffect(() => {
    if (bookingKind !== 'recurring') return;
    if (recurringFrequencyPreset !== 'custom') return;
    if (customRecurrenceDays.length === 0) {
      setCustomRecurrenceDays([recurringDayOfWeek]);
    }
  }, [bookingKind, recurringDayOfWeek, recurringFrequencyPreset, customRecurrenceDays]);

  useEffect(() => {
    if (bookingKind !== 'recurring') return;
    if (!selectedCourtId) return;
    setRecurringCourtIds((previous) => {
      if (previous.length > 0) return previous;
      return [selectedCourtId];
    });
  }, [bookingKind, selectedCourtId]);

  useEffect(() => {
    const activeClubId = Number(normalizedUser?.activeClubId || 0);
    if (Number.isInteger(activeClubId) && activeClubId > 0) {
      setSelectedClubIdState(activeClubId);
      return;
    }
    if (clubOptions.length > 0) {
      setSelectedClubIdState(clubOptions[0].id);
    }
  }, [clubOptions, normalizedUser?.activeClubId]);

  const persistedEditingBookingId = useMemo(() => {
    const numeric = Number(editingBookingId);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
  }, [editingBookingId]);
  const editingBooking = useMemo(
    () => bookings.find((booking) => String(booking.id) === String(editingBookingId)) || null,
    [bookings, editingBookingId]
  );
  const resolveParticipantsForBooking = useCallback((booking: Booking): Participant[] => {
    return buildDefaultParticipantsForBooking(booking);
  }, []);
  const openBookingInDrawer = useCallback((booking: Booking) => {
    bookingFinancialRequestSeqRef.current += 1;
    bookingTimelineRequestSeqRef.current += 1;
    setIsBookingFinancialLoading(booking.state !== 'blocked');
    setIsRemoteBillingConfigLoading(booking.state !== 'blocked');
    setBookingTimelineLoading(booking.state !== 'blocked');
    setBookingTimelineError('');
    setBookingTimelineEvents([]);
    setBookingFinancial(null);
    setRemoteBillingConfig(null);
    setBillingConfigTouchedByUser(false);
    setQuotedListPrice(null);
    setQuotedFinalPrice(null);
    setQuotedDiscountAmount(0);
    setQuoteError('');
    setEditingBookingId(booking.id);
    setEditingBaseline({
      id: String(booking.id),
      courtId: booking.courtId,
      startSlot: booking.startSlot,
      endSlot: booking.endSlot,
      title: booking.title,
    });
    setSelectedCourtId(booking.courtId);
    setSelectedStartSlot(booking.startSlot);
    setSelectedEndSlot(booking.endSlot);
    const resolvedParticipants = resolveParticipantsForBooking(booking).map((participant) =>
      participant.isOwner ? participant : { ...participant, customPrice: null }
    );
    setParticipants(resolvedParticipants);
    setNotes('');
    setNotesTouchedByUser(false);
    setParticipantPriceDraftById({});
    setPaymentMode('Ãšnico');
    if (booking.state === 'blocked') {
      setBookingKind('block');
      const normalizedTitle = normalizeBookingDisplayTitle(booking.title, '');
      setBlockingTitle(normalizedTitle === 'Bloqueo' ? '' : booking.title);
    } else {
      setBookingKind('regular');
    }
    setDrawerOpen(true);
    setScheduleInputsDirty(false);
    setFormError('');
  }, [resolveParticipantsForBooking]);

  const effectiveCourts = courtsData;
  const availableSports = useMemo(() => {
    const uniques = Array.from(
      new Set(
        effectiveCourts
          .map((court) => String(court.sport || '').trim())
          .filter((sport) => sport.length > 0)
      )
    );
    return ['Todos', ...uniques] as SportFilter[];
  }, [effectiveCourts]);

  const reloadSchedule = useCallback(async () => {
    try {
      const raw = await getAdminSchedule(formatLocalDate(selectedDate));
      const mapped = (Array.isArray(raw) ? raw : [])
        .map(parseScheduleSlotToBooking)
        .filter((booking): booking is Booking => Boolean(booking));
      setBookings(mapped);
      return mapped;
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'loadSchedule' }, error);
      return [];
    }
  }, [selectedDate]);

  const getClubSlug = useCallback(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return '';
      const normalized = normalizeSessionUser(JSON.parse(raw));
      return getActiveClubSlug(normalized) || '';
    } catch {
      return '';
    }
  }, []);

  const loadCourtsForActiveClub = useCallback(async () => {
    try {
      const userStored = localStorage.getItem('user');
      if (!userStored) return;
      const normalized = normalizeSessionUser(JSON.parse(userStored));
      const slug = getActiveClubSlug(normalized);
      if (!slug) return;
      const data = await ClubAdminService.getCourts(slug);
      const mapped = (Array.isArray(data) ? data : []).map((court: any) => {
        return {
          id: String(court.id),
          name: String(court.name || `Cancha ${court.id}`),
          sport: inferCourtSport(court),
          activityTypeId: Number(court?.activityTypeId || court?.activityType?.id || 0) || undefined,
          defaultDurationMinutes:
            Number(court?.activityType?.defaultDurationMinutes || 0) || undefined,
        } as Court;
      });
      if (mapped.length > 0) {
        setCourtsData(mapped);
        setSelectedCourtId((previous) =>
          mapped.some((court) => court.id === previous) ? previous : mapped[0].id
        );
      } else {
        setCourtsData([]);
        setSelectedCourtId('');
      }
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'loadCourts' }, error);
    }
  }, []);

  const persistBookingMove = useCallback(
    async (bookingId: string, courtId: string, startSlot: number, endSlot: number) => {
      const numericBookingId = Number(bookingId);
      const numericCourtId = Number(courtId);
      if (!Number.isFinite(numericBookingId) || numericBookingId <= 0) return;
      if (!Number.isFinite(numericCourtId) || numericCourtId <= 0) return;
      const slug = getClubSlug();
      if (!slug) return;

      const durationMinutes = Math.max(15, (endSlot - startSlot) * slotMinutes);
      const startDateTime = buildStartDateTimeFromSlot(selectedDate, startSlot);
      await ClubAdminService.rescheduleBooking(slug, numericBookingId, {
        courtId: numericCourtId,
        startDateTime: startDateTime.toISOString(),
        durationMinutes,
      });
    },
    [getClubSlug, selectedDate]
  );

  const refreshBookingFinancial = useCallback(async (bookingId: number) => {
    const requestSeq = bookingFinancialRequestSeqRef.current + 1;
    bookingFinancialRequestSeqRef.current = requestSeq;
    setIsBookingFinancialLoading(true);
    try {
      const summary = await getBookingFinancialSummary(bookingId);
      if (bookingFinancialRequestSeqRef.current !== requestSeq) return summary;
      setBookingFinancial({
        total: Number(summary?.total || 0),
        paid: Number(summary?.paid || 0),
        remaining: Number(summary?.remaining || 0),
        confirmationMode:
          summary?.confirmationMode === 'AUTOMATIC' ||
          summary?.confirmationMode === 'DEPOSIT_REQUIRED'
            ? summary.confirmationMode
            : 'MANUAL',
      });
      return summary;
    } finally {
      if (bookingFinancialRequestSeqRef.current === requestSeq) {
        setIsBookingFinancialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/agenda-playground')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!authChecked || !user) return;
    void loadCourtsForActiveClub();
  }, [authChecked, loadCourtsForActiveClub, user]);

  useEffect(() => {
    if (!authChecked || !user) return;
    void reloadSchedule();
  }, [authChecked, user, reloadSchedule]);

  useEffect(() => {
    if (!drawerOpen) return;
    setBookingHoverPreview(null);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    setSimplifiedSidebarSection('DETAILS');
  }, [drawerOpen, editingBookingId]);

  useEffect(() => {
    if (paymentMode === 'Ãšnico') return;
    setSimplifiedSidebarSection('DETAILS');
  }, [paymentMode]);

  useEffect(() => {
    if (!drawerOpen) return;
    const resetDrawerScrollTop = () => {
      const container = drawerScrollContainerRef.current;
      if (!container) return;
      container.scrollTop = 0;
    };

    resetDrawerScrollTop();
    const rafId = window.requestAnimationFrame(resetDrawerScrollTop);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [drawerOpen]);

  useEffect(() => {
    const clearCloseCleanupTimer = () => {
      if (!drawerCloseCleanupTimerRef.current) return;
      window.clearTimeout(drawerCloseCleanupTimerRef.current);
      drawerCloseCleanupTimerRef.current = null;
    };

    if (drawerOpen) {
      clearCloseCleanupTimer();
      return;
    }

    clearCloseCleanupTimer();
    drawerCloseCleanupTimerRef.current = window.setTimeout(() => {
      bookingFinancialRequestSeqRef.current += 1;
      bookingTimelineRequestSeqRef.current += 1;
      setBillingHubTab('SUMMARY');
      setParticipantMenuId(null);
      setExpandedParticipantId(null);
      setParticipantSearchOpenId(null);
      setParticipantSearchLoadingId(null);
      setParticipantSuggestionsById({});
      setIsBookingFinancialLoading(false);
      setIsRemoteBillingConfigLoading(false);
      setBookingTimelineLoading(false);
      setBookingTimelineError('');
      setBookingTimelineEvents([]);
      setBookingFinancial(null);
      setRemoteBillingConfig(null);
      setBillingConfigTouchedByUser(false);
      setRecurringResult(null);
      setDeleteBookingConfirmOpen(false);
      setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' });
      setBlockingErrorModalOpen(false);
      setBookingCreatedModalOpen(false);
      bookingDrawerDispatch({ type: 'CLEAR' });
      bookingDrawerFormSyncSignatureRef.current = '';
      drawerCloseCleanupTimerRef.current = null;
    }, DRAWER_CLOSE_RESET_DELAY_MS);

    return () => {
      clearCloseCleanupTimer();
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (drawerOpen) return;
    bookingDrawerLoadKeyRef.current = '';
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;

    let cancelled = false;
    const run = async () => {
      try {
        const summary = await refreshBookingFinancial(persistedEditingBookingId);
        if (cancelled) return;
        setParticipants((previous) =>
          distributePaidByParticipants(
            previous,
            paymentMode,
            Number(summary?.total || 0),
            Number(summary?.paid || 0)
          )
        );
      } catch {
        // Si falla la lectura financiera, mantenemos el estado actual local.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bookingKind, drawerOpen, paymentMode, persistedEditingBookingId, refreshBookingFinancial]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;

    let cancelled = false;
    const run = async () => {
      setIsRemoteBillingConfigLoading(true);
      try {
        const config = await getBookingBillingConfig(persistedEditingBookingId);
        if (cancelled) return;
        setRemoteBillingConfig(config);
      } catch {
        if (!cancelled) {
          setRemoteBillingConfig(null);
          setIsRemoteBillingConfigLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bookingKind, drawerOpen, persistedEditingBookingId]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId || !editingBooking) return;
    if (!remoteBillingConfig) return;

    const metadata = remoteBillingConfig?.metadata;
    const resolvedParticipants = parseSidebarParticipantsFromMetadata(metadata, editingBooking);
    let shouldRebaseDrawerSource = false;
    if (resolvedParticipants && resolvedParticipants.length > 0) {
      setParticipants(
        resolvedParticipants.map((participant) =>
          participant.isOwner ? participant : { ...participant, customPrice: null }
        )
      );
      shouldRebaseDrawerSource = true;
    } else {
      const persistedResponsibleRef = String(remoteBillingConfig?.chargeResponsibleRef || '').trim();
      if (remoteBillingConfig.chargeMode === 'INDIVIDUAL' && persistedResponsibleRef) {
        const nextSourceType = inferParticipantSourceTypeFromEntityRef(persistedResponsibleRef);
        setParticipants((previous) =>
          previous.map((participant, index) => {
            const isOwnerCandidate = participant.isOwner || index === 0;
            if (!isOwnerCandidate) return participant;
            return {
              ...participant,
              sourceType: nextSourceType,
              entityRef: persistedResponsibleRef,
            };
          })
        );
        shouldRebaseDrawerSource = true;
      }
    }

    const resolvedNotes = parseSidebarNotesFromMetadata(metadata);
    if (resolvedNotes != null && !notesTouchedByUser) {
      setNotes(resolvedNotes);
      setNotesTouchedByUser(false);
      shouldRebaseDrawerSource = true;
    }

    if (shouldRebaseDrawerSource) {
      bookingDrawerLoadKeyRef.current = '';
      bookingDrawerFormSyncSignatureRef.current = '';
      setBillingConfigTouchedByUser(false);
    }
    setIsRemoteBillingConfigLoading(false);
  }, [
    bookingKind,
    drawerOpen,
    editingBooking,
    notesTouchedByUser,
    persistedEditingBookingId,
    remoteBillingConfig,
    remoteBillingConfig?.metadata,
    remoteBillingConfig?.updatedAt,
  ]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;

    const requestSeq = bookingTimelineRequestSeqRef.current + 1;
    bookingTimelineRequestSeqRef.current = requestSeq;
    setBookingTimelineLoading(true);
    setBookingTimelineError('');

    let cancelled = false;
    const run = async () => {
      try {
        const events = await getBookingTimelineEvents(persistedEditingBookingId, { take: 200 });
        if (cancelled) return;
        if (bookingTimelineRequestSeqRef.current !== requestSeq) return;
        setBookingTimelineEvents(Array.isArray(events) ? events : []);
      } catch (error: any) {
        if (cancelled) return;
        if (bookingTimelineRequestSeqRef.current !== requestSeq) return;
        setBookingTimelineEvents([]);
        setBookingTimelineError(toUserSafeMessage(error?.message, 'No se pudo cargar el historial de la reserva.'));
      } finally {
        if (cancelled) return;
        if (bookingTimelineRequestSeqRef.current === requestSeq) {
          setBookingTimelineLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    bookingDrawerState.ui.saveStatus,
    bookingKind,
    drawerOpen,
    persistedEditingBookingId,
  ]);

  const beginBookingDrag = useCallback((booking: Booking) => {
    const durationSlots = booking.endSlot - booking.startSlot;
    const meta = {
      bookingId: booking.id,
      durationSlots,
      title: booking.title,
      state: booking.state,
      paymentState: booking.paymentState,
      isRecurring: booking.isRecurring,
      courtId: booking.courtId,
      startSlot: booking.startSlot,
    };
    setBookingHoverPreview(null);
    setDraggingBookingId(booking.id);
    draggingBookingMetaRef.current = meta;
    setDraggingBookingMeta(meta);
    const initialPreview = {
      courtId: booking.courtId,
      startSlot: booking.startSlot,
      endSlot: booking.endSlot,
    };
    setBookingDropPreview(initialPreview);
    lastValidDropPreviewRef.current = initialPreview;
  }, []);

  useEffect(() => {
    if (!draggingBookingId) return;
    setBookingHoverPreview(null);
  }, [draggingBookingId]);

  useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const pending = pendingBookingPointerRef.current;
      if (!pending) return;
      if (draggingBookingMetaRef.current) return;

      const dx = Math.abs(event.clientX - pending.startX);
      const dy = Math.abs(event.clientY - pending.startY);
      if (dx + dy < 4) return;

      beginBookingDrag(pending.booking);
    };

    const onWindowMouseUp = () => {
      if (draggingBookingMetaRef.current && bookingDropPreview) {
        const meta = draggingBookingMetaRef.current;
        const safeStart = bookingDropPreview.startSlot;
        const safeEnd = bookingDropPreview.endSlot;
        const targetCourtId = bookingDropPreview.courtId;
        const dropHasConflict = bookings.some((booking) => {
          if (String(booking.id) === String(meta.bookingId)) return false;
          if (booking.courtId !== targetCourtId) return false;
          return safeStart < booking.endSlot && safeEnd > booking.startSlot;
        });
        if (dropHasConflict) {
          const message = 'Ya existe una reserva en ese rango horario para la cancha seleccionada.';
          setFormError(message);
          showCalendarNotice(message);
          setDraggingBookingId(null);
          setDraggingBookingMeta(null);
          draggingBookingMetaRef.current = null;
          dragGrabOffsetSlotsRef.current = 0;
          lastValidDropPreviewRef.current = null;
          setBookingDropPreview(null);
          pendingBookingPointerRef.current = null;
          return;
        }
        const candidateStartDateTime = buildStartDateTimeFromSlot(selectedDate, safeStart);
        if (candidateStartDateTime.getTime() < Date.now()) {
          const message = 'No se pueden reservar turnos en el pasado.';
          setFormError(message);
          showCalendarNotice(message);
          setDraggingBookingId(null);
          setDraggingBookingMeta(null);
          draggingBookingMetaRef.current = null;
          dragGrabOffsetSlotsRef.current = 0;
          lastValidDropPreviewRef.current = null;
          setBookingDropPreview(null);
          pendingBookingPointerRef.current = null;
          return;
        }
      setBookings((previous) =>
        previous.map((booking) =>
          booking.id === meta.bookingId
            ? { ...booking, courtId: targetCourtId, startSlot: safeStart, endSlot: safeEnd }
            : booking
          )
        );
        void persistBookingMove(meta.bookingId, targetCourtId, safeStart, safeEnd)
          .then(() => reloadSchedule())
          .catch(async (error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'persistBookingMove' }, error);
            applyBookingError(error, 'No se pudo guardar el movimiento del turno.', { forceNotice: true });
            try {
              await reloadSchedule();
            } catch (reloadError) {
              reportUiError({ area: 'AgendaPlayground', action: 'reloadScheduleAfterMoveError' }, reloadError);
            }
          });
        setDraggingBookingId(null);
        setDraggingBookingMeta(null);
        draggingBookingMetaRef.current = null;
        dragGrabOffsetSlotsRef.current = 0;
        lastValidDropPreviewRef.current = null;
        setBookingDropPreview(null);
        pendingBookingPointerRef.current = null;
        return;
      }

      if (pendingBookingPointerRef.current && !draggingBookingMetaRef.current) {
        const clickedBooking = pendingBookingPointerRef.current.booking;
        openBookingInDrawer(clickedBooking);
        pendingBookingPointerRef.current = null;
        return;
      }

      if (!isDragging || !dragSelection) return;
      const range = toSelectionRange(dragSelection);
      setEditingBookingId(null);
      setEditingBaseline(null);
      setSelectedCourtId(dragSelection.courtId);
      setSelectedStartSlot(range.start);
      setSelectedEndSlot(range.end);
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setNotes('');
      setNotesTouchedByUser(false);
      setPaymentMode('Ãšnico');
      setParticipantPriceDraftById({});
      bookingFinancialRequestSeqRef.current += 1;
      bookingTimelineRequestSeqRef.current += 1;
      setIsBookingFinancialLoading(false);
      setIsRemoteBillingConfigLoading(false);
      setBookingTimelineLoading(false);
      setBookingTimelineError('');
      setBookingTimelineEvents([]);
      setBookingFinancial(null);
      setRemoteBillingConfig(null);
      setBillingConfigTouchedByUser(false);
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('');
      setDrawerOpen(true);
      setScheduleInputsDirty(false);
      setIsDragging(false);
      setDragSelection(null);
      setFormError('');
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [applyBookingError, beginBookingDrag, bookingDropPreview, bookings, dragSelection, isDragging, openBookingInDrawer, persistBookingMove, reloadSchedule, selectedDate, showCalendarNotice]);

  const visibleCourts = useMemo(() => {
    return effectiveCourts.filter((court) => {
      const bySport = sportFilter === 'Todos' || court.sport === sportFilter;
      const bySearch = searchTerm.trim().length === 0 || court.name.toLowerCase().includes(searchTerm.toLowerCase());
      return bySport && bySearch;
    });
  }, [effectiveCourts, sportFilter, searchTerm]);

  const visibleCourtIds = useMemo(() => new Set(visibleCourts.map((court) => court.id)), [visibleCourts]);

  const visibleBookings = useMemo(() => bookings.filter((booking) => visibleCourtIds.has(booking.courtId)), [bookings, visibleCourtIds]);

  const selectedCourt = effectiveCourts.find((court) => court.id === selectedCourtId) ?? null;
  const selectedRecurringCourts = useMemo(
    () => effectiveCourts.filter((court) => recurringCourtIds.includes(court.id)),
    [effectiveCourts, recurringCourtIds]
  );
  const recurringAllCourtsSelected = useMemo(
    () => effectiveCourts.length > 0 && recurringCourtIds.length === effectiveCourts.length,
    [effectiveCourts, recurringCourtIds]
  );
  const selectedBookingKind = bookingKindOptions.find((option) => option.value === bookingKind) ?? bookingKindOptions[0];
  const recurringFirstOccurrence = useMemo(() => {
    const baseDate = new Date(selectedDate);
    baseDate.setHours(12, 0, 0, 0);
    const firstDay =
      recurringFrequencyPreset === 'custom' && customRecurrenceDays.length > 0
        ? [...customRecurrenceDays].sort((a, b) => a - b)[0]
        : recurringDayOfWeek;
    return getNextDateForDay(baseDate, firstDay, slotToTime(selectedStartSlot));
  }, [customRecurrenceDays, recurringDayOfWeek, recurringFrequencyPreset, selectedDate, selectedStartSlot]);
  const customRecurrenceDaysSummary = useMemo(() => {
    const days = Array.from(new Set(customRecurrenceDays));
    if (days.length === 0) return '-';
    return days
      .sort((a, b) => a - b)
      .map((day) => CUSTOM_DAY_OPTIONS.find((item) => item.value === day)?.short || String(day))
      .join(', ');
  }, [customRecurrenceDays]);

  const selectionMinutes = Math.max((selectedEndSlot - selectedStartSlot) * slotMinutes, slotMinutes);
  const selectionStartDateTime = useMemo(
    () => buildSelectionDateTime(selectedDate, selectedStartSlot),
    [selectedDate, selectedStartSlot]
  );
  const shouldValidatePastSelection = bookingKind !== 'recurring' && bookingKind !== 'block';
  const isSelectionInPast = useMemo(
    () => shouldValidatePastSelection && selectionStartDateTime.getTime() < Date.now(),
    [selectionStartDateTime, shouldValidatePastSelection]
  );
  const hasBlockingQuoteError = useMemo(
    () => isBlockingQuoteError(quoteError),
    [quoteError]
  );
  const singleChargeParticipantId = useMemo(() => {
    if (paymentMode !== 'Ãšnico') return undefined;
    const draftResponsible = String(bookingDrawerState.draft?.billing.chargeResponsibleParticipantId || '').trim();
    if (draftResponsible && participants.some((participant) => participant.id === draftResponsible)) {
      return draftResponsible;
    }
    const owner = participants.find((participant) => participant.isOwner);
    return owner?.id;
  }, [bookingDrawerState.draft?.billing.chargeResponsibleParticipantId, participants, paymentMode]);
  const chargedParticipantIds = useMemo(
    () => resolveChargedParticipantIds(participants, paymentMode, singleChargeParticipantId),
    [participants, paymentMode, singleChargeParticipantId]
  );
  const chargedParticipantIdSet = useMemo(
    () => new Set(chargedParticipantIds),
    [chargedParticipantIds]
  );
  const chargedParticipantsCount = Math.max(chargedParticipantIds.length, 1);
  const usesPersistedFinancialSummary = Boolean(persistedEditingBookingId && bookingKind !== 'block');
  const hasQuotedPrice = quotedFinalPrice != null || quotedListPrice != null;
  const isPersistedFinancialPending = usesPersistedFinancialSummary && (isBookingFinancialLoading || !bookingFinancial);
  const isQuoteFinancialPending =
    !usesPersistedFinancialSummary &&
    bookingKind !== 'block' &&
    (quoteLoading || !hasQuotedPrice);
  const isFinancialDisplayPending = isPersistedFinancialPending || isQuoteFinancialPending;
  const fallbackTotalPrice = defaultPricePerParticipant * chargedParticipantsCount;
  const quotedBaseTotalPrice = quotedFinalPrice ?? quotedListPrice ?? fallbackTotalPrice;
  const sourceTotalPrice = usesPersistedFinancialSummary
    ? roundMoney(Number(bookingFinancial?.total || 0))
    : roundMoney(quotedBaseTotalPrice);
  const totalPrice = sourceTotalPrice;
  const participantPriceById = useMemo(() => {
    const map = new Map<string, number>();
    if (participants.length === 0) return map;

    if (paymentMode === 'Ãšnico') {
      const ownerId = chargedParticipantIds[0];
      participants.forEach((participant) => {
        map.set(participant.id, participant.id === ownerId ? totalPrice : 0);
      });
      return map;
    }

    const charged = participants.filter((participant) => chargedParticipantIdSet.has(participant.id));
    const manual = charged.filter((participant) => participant.customPrice != null);
    const auto = charged.filter((participant) => participant.customPrice == null);
    const manualSum = roundMoney(
      manual.reduce((sum, participant) => sum + clampParticipantPrice(Number(participant.customPrice || 0)), 0)
    );
    const remaining = roundMoney(Math.max(0, totalPrice - manualSum));
    const baseShare = auto.length > 0 ? roundMoney(remaining / auto.length) : 0;
    let remainder = auto.length > 0 ? roundMoney(remaining - baseShare * auto.length) : 0;

    participants.forEach((participant) => map.set(participant.id, 0));
    manual.forEach((participant) => {
      map.set(participant.id, clampParticipantPrice(Number(participant.customPrice || 0)));
    });
    auto.forEach((participant) => {
      let allocated = baseShare;
      if (remainder > 0.009) {
        const increment = Math.min(0.01, remainder);
        allocated = roundMoney(baseShare + increment);
        remainder = roundMoney(remainder - increment);
      }
      map.set(participant.id, allocated);
    });

    return map;
  }, [chargedParticipantIdSet, chargedParticipantIds, participants, paymentMode, totalPrice]);
  const resolveParticipantPrice = useCallback((participant: Participant) => {
    return Number(participantPriceById.get(participant.id) || 0);
  }, [participantPriceById]);
  const isClassBooking = bookingKind === 'privateClass' || bookingKind === 'courseClass';
  const priceFieldLabel = 'Precio total';
  const priceFieldHint = isClassBooking
    ? 'En clases, este total se distribuye entre los alumnos cargados.'
    : paymentMode === 'Ãšnico'
      ? 'En reserva normal, paga una sola persona.'
      : 'En reserva normal, se reparte automÃ¡ticamente entre participantes.';
  const exceedsRemainingWarning = useMemo(() => {
    if (!bookingFinancial || bookingFinancial.remaining <= 0.009) return false;
    return participants.some((participant) => {
      if (paymentMode === 'Ãšnico' && !participant.isOwner) return false;
      return resolveParticipantPrice(participant) > bookingFinancial.remaining + 0.009;
    });
  }, [bookingFinancial, participants, paymentMode, resolveParticipantPrice]);

  const duplicateParticipantIds = useMemo(() => {
    const firstByToken = new Map<string, string>();
    const duplicates = new Set<string>();

    for (const participant of participants) {
      if (!participant.name.trim()) continue;
      const tokens = participantIdentityTokens(participant);
      if (tokens.length === 0) continue;

      for (const token of tokens) {
        const firstId = firstByToken.get(token);
        if (!firstId) {
          firstByToken.set(token, participant.id);
          continue;
        }
        if (firstId !== participant.id) {
          duplicates.add(firstId);
          duplicates.add(participant.id);
        }
      }
    }

    return duplicates;
  }, [participants]);

  const hasDuplicateParticipants = duplicateParticipantIds.size > 0;

  useEffect(() => {
    if (hasDuplicateParticipants) return;
    if (
      formError === 'No podÃ©s guardar con participantes duplicados.' ||
      formError === 'Ese participante ya estÃ¡ agregado en esta reserva.'
    ) {
      setFormError('');
    }
  }, [formError, hasDuplicateParticipants]);

  const applySplitParticipantManualPrice = useCallback((participantId: string, nextPrice: number) => {
    const nextBounded = clampParticipantPrice(Math.min(nextPrice, totalPrice));
    setParticipants((previous) => {
      const chargedIds = new Set(resolveChargedParticipantIds(previous, 'Dividido'));
      return previous.map((participant) => {
        if (!chargedIds.has(participant.id)) return participant;
        if (participant.id === participantId) {
          return { ...participant, customPrice: nextBounded };
        }
        return { ...participant, customPrice: null };
      });
    });
  }, [totalPrice]);

  const resolveBookingHoverPosition = useCallback((clientX: number, clientY: number, participantsCount: number) => {
    const cardWidth = 252;
    const cardHeight = estimateBookingHoverTarjetaHeight(participantsCount);
    const gap = 10;
    const bottomGap = 24;
    const bounds = agendaSurfaceRef.current
      ? agendaSurfaceRef.current.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const viewportBottom = typeof window !== 'undefined' ? window.innerHeight - bottomGap : bounds.bottom - bottomGap;
    const safeBottom = Math.min(bounds.bottom - gap, viewportBottom);

    const minX = bounds.left + gap;
    const maxX = bounds.right - cardWidth - gap;
    const minY = bounds.top + gap;
    const maxY = safeBottom - cardHeight;

    let nextX = clientX - cardWidth - gap;
    const belowBottom = clientY + gap + cardHeight;
    const shouldPlaceBelow = belowBottom <= safeBottom;
    let nextY = shouldPlaceBelow ? clientY + gap : clientY - cardHeight - gap;

    if (maxX >= minX) {
      nextX = Math.max(minX, Math.min(nextX, maxX));
    } else {
      nextX = minX;
    }

    if (maxY >= minY) {
      nextY = Math.max(minY, Math.min(nextY, maxY));
    } else {
      nextY = minY;
    }

    return { x: nextX, y: nextY };
  }, []);

  const handleSlotMouseDown = (event: React.MouseEvent<HTMLDivElement>, courtId: string, slot: number) => {
    event.preventDefault();
    if (draggingBookingMetaRef.current) return;
    setBookingHoverPreview(null);
    const startsOnConflict = hasOverlapForRange({
      courtId,
      startSlot: slot,
      endSlot: slot + 1,
      ignoreBookingId: null,
    });
    if (startsOnConflict) return;
    setIsDragging(true);
    setDragSelection({ courtId, startSlot: slot, endSlot: slot });
  };

  const handleSlotMouseEnter = (courtId: string, slot: number) => {
    if (draggingBookingMetaRef.current) {
      const durationSlots = Math.max(1, Number(draggingBookingMetaRef.current.durationSlots || 1));
      const offsetSlots = Math.max(0, Math.min(durationSlots - 1, Number(dragGrabOffsetSlotsRef.current || 0)));
      const desiredStart = slot - offsetSlots;
      const safeStart = Math.max(0, Math.min(totalSlots - durationSlots, desiredStart));
      const candidate = {
        courtId,
        startSlot: safeStart,
        endSlot: safeStart + durationSlots,
      };
      const isConflicted = hasOverlapForRange({
        courtId: candidate.courtId,
        startSlot: candidate.startSlot,
        endSlot: candidate.endSlot,
        ignoreBookingId: draggingBookingMetaRef.current.bookingId,
      });
      if (isConflicted) {
        if (lastValidDropPreviewRef.current) {
          setBookingDropPreview(lastValidDropPreviewRef.current);
        }
        return;
      }
      lastValidDropPreviewRef.current = candidate;
      setBookingDropPreview(candidate);
      return;
    }
    if (!isDragging) return;
    setDragSelection((previous) => {
      if (!previous || previous.courtId !== courtId) return previous;
      const candidate = { ...previous, endSlot: slot };
      const normalized = toSelectionRange(candidate);
      const conflicts = hasOverlapForRange({
        courtId,
        startSlot: normalized.start,
        endSlot: normalized.end,
        ignoreBookingId: null,
      });
      if (conflicts) return previous;
      return candidate;
    });
  };

  const handleBookingMouseDown = (event: React.MouseEvent<HTMLDivElement>, booking: Booking) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = Math.max(0, event.clientY - rect.top);
    const offsetSlots = Math.floor(localY / slotHeight);
    const durationSlots = Math.max(1, booking.endSlot - booking.startSlot);
    dragGrabOffsetSlotsRef.current = Math.max(0, Math.min(durationSlots - 1, offsetSlots));
    pendingBookingPointerRef.current = {
      booking,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const timeOptions = useMemo(
    () =>
      Array.from({ length: totalSlots + 1 }).map((_, slot) => ({
        value: slotToTime(slot),
        slot,
      })),
    []
  );

  const updateParticipant = useCallback((
    id: string,
    patch: Partial<Pick<Participant, 'name' | 'contact' | 'sourceType' | 'entityRef' | 'paymentMethod' | 'customPrice'>>
  ) => {
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant
      )
    );
  }, []);

  const runParticipantSearch = useCallback(async (participantId: string, rawValue: string) => {
    updateParticipant(participantId, { name: rawValue, sourceType: 'guest', entityRef: undefined });
    const query = String(rawValue || '').trim();
    if (!query) {
      setParticipantSearchOpenId(null);
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
      return;
    }

    setParticipantSearchOpenId(participantId);
    const seq = ++participantSearchSeqRef.current;
    setParticipantSearchLoadingId(participantId);
    const guestSuggestion: ParticipantSuggestion = {
      id: `guest-${participantId}-${query}`,
      label: query,
      secondary: 'Invitado',
      sourceType: 'guest',
      entityRef: `guest:${toSlugToken(query)}`,
      name: query,
    };

    try {
      const slug = getClubSlug();
      if (!slug || query.length < 2) {
        if (seq !== participantSearchSeqRef.current) return;
        setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [guestSuggestion] }));
        return;
      }

      const clients = await ClubAdminService.getClients(slug, query);
      if (seq !== participantSearchSeqRef.current) return;

      const clientSuggestions: ParticipantSuggestion[] = (Array.isArray(clients) ? clients : [])
        .slice(0, 6)
        .map((client: any, index: number) => {
          const phone = String(client?.phone || '').trim();
          const email = String(client?.email || '').trim();
          const sourceType: Participant['sourceType'] =
            client?.sourceType === 'systemUser' ? 'systemUser' : 'clubClient';
          const stableRef =
            sourceType === 'systemUser'
              ? (Number(client?.userId || 0) > 0 ? `user:${Number(client.userId)}` : undefined)
              : (client?.id ? `client:${String(client.id)}` : undefined);
          return {
            id: `club-${participantId}-${client?.id || index}`,
            label: String(client?.name || query),
            secondary:
              phone ||
              email ||
              (sourceType === 'systemUser' ? 'Usuario del sistema' : 'Cliente del club'),
            sourceType,
            entityRef: stableRef,
            name: String(client?.name || query),
            contact: phone || email || '',
          } satisfies ParticipantSuggestion;
        });

      setParticipantSuggestionsById((previous) => ({
        ...previous,
        [participantId]: [...clientSuggestions, guestSuggestion],
      }));
    } catch {
      if (seq !== participantSearchSeqRef.current) return;
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [guestSuggestion] }));
    } finally {
      if (seq === participantSearchSeqRef.current) {
        setParticipantSearchLoadingId((previous) => (previous === participantId ? null : previous));
      }
    }
  }, [getClubSlug, updateParticipant]);

  const applyParticipantSuggestion = useCallback((participantId: string, suggestion: ParticipantSuggestion) => {
    const incomingTokens = participantIdentityTokens({
      sourceType: suggestion.sourceType,
      name: suggestion.name,
      contact: suggestion.contact || '',
    });
    const duplicateExists = participants.some((participant) => {
      if (participant.id === participantId) return false;
      if (!participant.name.trim()) return false;
      const currentTokens = participantIdentityTokens(participant);
      return incomingTokens.some((token) => currentTokens.includes(token));
    });
    if (duplicateExists) {
      setFormError('Ese participante ya estÃ¡ agregado en esta reserva.');
      setParticipantSearchOpenId(null);
      return;
    }

    updateParticipant(participantId, {
      name: suggestion.name,
      contact: suggestion.contact || '',
      sourceType: suggestion.sourceType,
      entityRef: suggestion.entityRef,
    });
    setFormError('');
    setParticipantSearchOpenId(null);
    setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
  }, [participants, updateParticipant]);

  const resolveParticipantCharge = useCallback((participant: Participant) => {
    return resolveParticipantPrice(participant);
  }, [resolveParticipantPrice]);

  const registerPaymentNow = useCallback(async (input: {
    amount: number;
    method: Participant['paymentMethod'];
    successMessage?: string;
    participantId?: string;
  }) => {
    const lockPaymentsNow = Boolean(
      persistedEditingBookingId &&
      bookingKind !== 'block' &&
      bookingFinancial?.confirmationMode === 'MANUAL' &&
      editingBooking?.state === 'pending'
    );
    if (lockPaymentsNow) {
      showCalendarNotice('Primero confirmÃ¡ la reserva para poder registrar pagos.');
      return false;
    }
    if (!persistedEditingBookingId || bookingKind === 'block') {
      showCalendarNotice('Primero creÃ¡/abrÃ­ una reserva vÃ¡lida.');
      return false;
    }

    const amount = Number(Number(input.amount || 0).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0.009) {
      showCalendarNotice('IngresÃ¡ un monto mayor a 0.');
      return false;
    }

    try {
      if (input.participantId) {
        setPaymentInFlightId(input.participantId);
      }
      setIsWaitingQueuedPaymentConfirmation(true);
      setFormError('');

      const paymentChannel = input.method === 'TRANSFER' ? 'BANK_ACCOUNT' : undefined;
      await registerBookingPartialPayment(
        persistedEditingBookingId,
        amount,
        input.method,
        paymentChannel
      );

      await reloadSchedule();
      const latestFinancialSummary = await refreshBookingFinancial(persistedEditingBookingId);
      setParticipants((previous) =>
        distributePaidByParticipants(
          previous,
          paymentMode,
          Number(latestFinancialSummary?.total || 0),
          Number(latestFinancialSummary?.paid || 0)
        )
      );

      const timelineRequestSeq = bookingTimelineRequestSeqRef.current + 1;
      bookingTimelineRequestSeqRef.current = timelineRequestSeq;
      setBookingTimelineLoading(true);
      setBookingTimelineError('');
      try {
        const events = await getBookingTimelineEvents(persistedEditingBookingId, { take: 200 });
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineEvents(Array.isArray(events) ? events : []);
        }
      } catch (timelineError: any) {
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineEvents([]);
          setBookingTimelineError(
            toUserSafeMessage(
              timelineError?.message,
              'No se pudo cargar el historial de la reserva.'
            )
          );
        }
      } finally {
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineLoading(false);
        }
      }

      showCalendarNotice(input.successMessage || `Pago registrado: ${amount.toFixed(2)} $.`);
      return true;
    } catch (error: any) {
      const message = toUserSafeMessage(error?.message, 'No se pudo registrar el pago.');
      setFormError(message);
      showCalendarNotice(message);
      return false;
    } finally {
      if (input.participantId) {
        setPaymentInFlightId((previous) => (previous === input.participantId ? null : previous));
      }
      setIsWaitingQueuedPaymentConfirmation(false);
    }
  }, [
    bookingFinancial?.confirmationMode,
    bookingKind,
    editingBooking?.state,
    paymentMode,
    persistedEditingBookingId,
    refreshBookingFinancial,
    reloadSchedule,
    showCalendarNotice,
  ]);

  const toggleParticipantPaid = useCallback((id: string) => {
    const participant = participants.find((entry) => entry.id === id);
    if (!participant) return;
    const draft = bookingDrawerState.draft;
    if (!draft) return;

    const assignment = draft.billing.assignments.find((entry) => entry.participantId === id && entry.isChargeable);
    const assignmentId = assignment?.id || resolveDefaultAssignmentIdForDraft(draft);
    const attributedConfirmed = draft.billing.payments
      .filter((payment) => payment.status === 'CONFIRMED' && payment.assignmentId === assignmentId)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const assignmentRemaining = assignment
      ? Math.max(0, Number(assignment.assignedAmount || 0) - attributedConfirmed)
      : 0;
    const globalRemaining = Number(draft.billing.financialSummary.remainingAmount || 0);
    const amount = Number(Math.min(globalRemaining, assignmentRemaining > 0 ? assignmentRemaining : globalRemaining).toFixed(2));
    if (amount <= 0.009) return;

    void registerPaymentNow({
      amount,
      method: participant.paymentMethod,
      participantId: id,
      successMessage: `Pago registrado: ${amount.toFixed(2)} $.`,
    });
  }, [bookingDrawerState.draft, participants, registerPaymentNow]);

  const addParticipantRow = () => {
    if (!persistedEditingBookingId && bookingKind !== 'block') {
      showCalendarNotice('Primero creÃ¡ la reserva. DespuÃ©s podÃ©s agregar mÃ¡s participantes.');
      return;
    }
    setParticipants((previous) => [
      ...previous,
      {
        id: `player-${Date.now()}`,
        name: '',
        contact: '',
        paid: false,
        isOwner: false,
        sourceType: 'guest',
        paymentMethod: 'CASH',
        entityRef: undefined,
        customPrice: null,
      },
    ]);
  };

  const removeParticipant = (id: string) => {
    setParticipants((previous) => previous.filter((participant) => participant.id !== id));
  };

  const markParticipantAsPending = useCallback((id: string) => {
    if (persistedEditingBookingId) {
      setFormError('Para volver a pendiente una reserva cobrada hay que gestionar una devoluciÃ³n.');
      return;
    }
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.id === id ? { ...participant, paid: false } : participant
      )
    );
  }, [persistedEditingBookingId]);

  const handleConfirmPendingBooking = useCallback(async () => {
    if (!persistedEditingBookingId) return;
    try {
      setConfirmingBooking(true);
      setFormError('');
      await confirmBooking(persistedEditingBookingId);
      await reloadSchedule();
      await refreshBookingFinancial(persistedEditingBookingId);
      const timelineRequestSeq = bookingTimelineRequestSeqRef.current + 1;
      bookingTimelineRequestSeqRef.current = timelineRequestSeq;
      setBookingTimelineLoading(true);
      setBookingTimelineError('');
      try {
        const events = await getBookingTimelineEvents(persistedEditingBookingId, { take: 200 });
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineEvents(Array.isArray(events) ? events : []);
        }
      } catch (timelineError: any) {
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineError(toUserSafeMessage(timelineError?.message, 'No se pudo cargar el historial de la reserva.'));
        }
      } finally {
        if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
          setBookingTimelineLoading(false);
        }
      }
      showCalendarNotice('Reserva confirmada. Ya podÃ©s registrar pagos.');
    } catch (error: any) {
      applyBookingError(error, 'No se pudo confirmar la reserva.');
    } finally {
      setConfirmingBooking(false);
    }
  }, [applyBookingError, persistedEditingBookingId, refreshBookingFinancial, reloadSchedule, showCalendarNotice]);

  const handleDeleteBooking = useCallback(async () => {
    if (!editingBookingId) return;

    const numericBookingId = Number(editingBookingId);
    if (!Number.isFinite(numericBookingId) || numericBookingId <= 0) {
      setBookings((previous) => previous.filter((booking) => String(booking.id) !== String(editingBookingId)));
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
      setFormError('');
      return;
    }

    try {
      setIsDeletingBooking(true);
      setFormError('');
      await cancelBooking(numericBookingId);
      await reloadSchedule();
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
    } catch (error: any) {
      applyBookingError(error, 'No se pudo eliminar/cancelar la reserva.');
    } finally {
      setIsDeletingBooking(false);
    }
  }, [applyBookingError, editingBookingId, reloadSchedule]);

  const hasOverlapForRange = useCallback((params: {
    courtId: string;
    startSlot: number;
    endSlot: number;
    ignoreBookingId?: string | number | null;
  }) => {
    const { courtId, startSlot, endSlot, ignoreBookingId } = params;
    if (endSlot <= startSlot) return false;

    return bookings.some((booking) => {
      if (ignoreBookingId != null && String(booking.id) === String(ignoreBookingId)) return false;
      if (booking.courtId !== courtId) return false;
      return startSlot < booking.endSlot && endSlot > booking.startSlot;
    });
  }, [bookings]);

  const hasConflict = useMemo(() => {
    if (
      editingBaseline &&
      selectedCourtId === editingBaseline.courtId &&
      selectedStartSlot === editingBaseline.startSlot &&
      selectedEndSlot === editingBaseline.endSlot
    ) {
      return false;
    }
    return hasOverlapForRange({
      courtId: selectedCourtId,
      startSlot: selectedStartSlot,
      endSlot: selectedEndSlot,
      ignoreBookingId: editingBookingId,
    });
  }, [editingBaseline, editingBookingId, hasOverlapForRange, selectedCourtId, selectedStartSlot, selectedEndSlot]);

  const bookingDropHasConflict = useMemo(() => {
    if (!bookingDropPreview || !draggingBookingMeta) return false;
    return hasOverlapForRange({
      courtId: bookingDropPreview.courtId,
      startSlot: bookingDropPreview.startSlot,
      endSlot: bookingDropPreview.endSlot,
      ignoreBookingId: draggingBookingMeta.bookingId,
    });
  }, [bookingDropPreview, draggingBookingMeta, hasOverlapForRange]);

  const hasScheduleChanges = useMemo(() => {
    if (!editingBaseline) return true;
    return !(
      selectedCourtId === editingBaseline.courtId &&
      selectedStartSlot === editingBaseline.startSlot &&
      selectedEndSlot === editingBaseline.endSlot
    );
  }, [editingBaseline, selectedCourtId, selectedStartSlot, selectedEndSlot]);

  const shouldShowScheduleConflict = hasConflict && (
    editingBookingId ? hasScheduleChanges : scheduleInputsDirty
  );
  const isPaymentLockedByManualPending = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    bookingFinancial?.confirmationMode === 'MANUAL' &&
    editingBooking?.state === 'pending'
  );
  const shouldHideBillingUntilCreated = Boolean(
    !persistedEditingBookingId &&
    bookingKind !== 'block'
  );
  const isBookingFullyPaid = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    bookingFinancial &&
    bookingFinancial.remaining <= 0.009
  );
  const reservationStatusLabel = useMemo(() => {
    if (bookingKind === 'block') return 'Bloqueo';
    if (!editingBooking) return 'Nueva';
    if (editingBooking.state === 'completed') return 'Completada';
    if (editingBooking.state === 'confirmed') return 'Confirmada';
    if (editingBooking.state === 'blocked') return 'Bloqueada';
    return 'Pendiente';
  }, [bookingKind, editingBooking]);
  const reservationStatusTone = useMemo(() => {
    if (bookingKind === 'block' || editingBooking?.state === 'blocked') return 'bg-[#fff1f3] text-[#9f1635]';
    if (editingBooking?.state === 'completed') return 'bg-[#eceffd] text-[#2f3d89]';
    if (editingBooking?.state === 'confirmed') return 'bg-[#e9f8ec] text-[#16733f]';
    if (!editingBooking) return 'bg-[#eef2ff] text-[#3155df]';
    return 'bg-[#fff4e5] text-[#9a5a00]';
  }, [bookingKind, editingBooking]);
  const paymentStatusLabel = useMemo(() => {
    if (!persistedEditingBookingId || bookingKind === 'block') return 'Sin pago';
    if (!bookingFinancial) return editingBooking?.paymentState === 'paid' ? 'Pagada' : 'Sin pago';
    if (bookingFinancial.remaining <= 0.009) return 'Pagada';
    if (bookingFinancial.paid > 0.009) return 'Parcial';
    return 'Sin pago';
  }, [bookingFinancial, bookingKind, editingBooking?.paymentState, persistedEditingBookingId]);
  const paymentStatusTone = paymentStatusLabel === 'Pagada'
    ? 'bg-[#e8f8ec] text-[#16733f]'
    : paymentStatusLabel === 'Parcial'
      ? 'bg-[#fff4e5] text-[#9a5a00]'
      : 'bg-[#eef1f7] text-[#5c667f]';
  const canShowMainAction = Boolean(persistedEditingBookingId && bookingKind !== 'block');
  const showConfirmMainAction = canShowMainAction && isPaymentLockedByManualPending;
  const showCollectMainAction = canShowMainAction && !isPaymentLockedByManualPending && !isBookingFullyPaid;
  const shouldHideBillingUntilConfirmed = isPaymentLockedByManualPending || shouldHideBillingUntilCreated;
  const isPaymentsTabActive = billingHubTab === 'PAYMENTS';
  const billingDraft = bookingDrawerState.draft?.billing || null;
  const billingSummary = billingDraft?.financialSummary
    ? billingDraft.financialSummary
    : {
        totalAmount: Number(totalPrice || 0),
        paidAmount: Number(bookingFinancial?.paid || 0),
        remainingAmount: Number(bookingFinancial ? bookingFinancial.remaining : Math.max(0, Number(totalPrice || 0))),
        paymentStatus:
          (bookingFinancial?.remaining || 0) <= 0.009
            ? 'PAID'
            : (bookingFinancial?.paid || 0) > 0.009
      ? 'PARTIAL'
              : 'UNPAID',
      };
  const simplifiedFinancialTotal = Number(
    usesPersistedFinancialSummary
      ? Number(bookingFinancial?.total || 0)
      : billingSummary.totalAmount || 0
  );
  const simplifiedPaidAmount = Number(
    usesPersistedFinancialSummary
      ? Number(bookingFinancial?.paid || 0)
      : billingSummary.paidAmount || 0
  );
  const simplifiedRemainingAmount = Number(
    Math.max(
      0,
      usesPersistedFinancialSummary
        ? Number(bookingFinancial?.remaining || 0)
        : billingSummary.remainingAmount || 0
    ).toFixed(2)
  );
  const simplifiedRemainingAfterQueue = simplifiedRemainingAmount;
  const simplifiedPaymentStatusLabel = isFinancialDisplayPending
    ? 'Cargando'
    : simplifiedRemainingAmount <= 0.009
    ? 'Pagado'
    : simplifiedPaidAmount > 0.009
      ? 'Parcial'
      : 'Pendiente';
  const isModernBillingEnabled = Boolean(
    bookingKind !== 'block' &&
    bookingDrawerState.draft
  );
  const bookingDrawerDraftSnapshot = useMemo<NewBookingDrawerDraft | null>(() => {
    if (!drawerOpen || bookingKind === 'block') return null;

    const bookingId = Number(editingBookingId || 0) || undefined;
    const bookingClientId = editingBooking?.clientId;
    const bookingUserId = editingBooking?.userId;
    const participantsDraftBase = participants.map((participant, index) => ({
      id: String(participant.id || `participant-${index}`),
      personId: undefined,
      displayName: String(participant.name || ''),
      contact: String(participant.contact || ''),
      sourceType: participant.sourceType,
      linked: participant.sourceType !== 'guest',
      bookingRole: participant.isOwner ? 'BOOKING_RESPONSIBLE' as const : 'PARTICIPANT' as const,
      archived: false,
      archivedAt: undefined,
    }));
    const participantsDraft: NewBookingDrawerDraft['participants'] = [...participantsDraftBase];

    const participantRefById = new Map<string, string>();
    const participantIdByRef = new Map<string, string>();
    participants.forEach((participant) => {
      const ref = buildStableParticipantRef(participant, {
        bookingClientId,
        bookingUserId,
      });
      participantRefById.set(String(participant.id), ref);
      participantIdByRef.set(ref, String(participant.id));
    });

    const totalAmount = Number(totalPrice || 0);
    const paidAmount = Number(bookingFinancial?.paid || 0);
    const paymentsDraft: NewBookingPayment[] = paidAmount > 0.009 && bookingId
      ? [
          {
            id: `legacy-paid-${bookingId}`,
            bookingId,
            amount: paidAmount,
            method: 'CASH',
            status: 'CONFIRMED',
            createdAt: new Date().toISOString(),
            createdByUserId: 0,
            assignmentId: undefined,
            note: 'Pago ya registrado (legacy)',
          },
        ]
      : [];

    const owner = participants.find((participant) => participant.isOwner);
    const ownerId = owner ? String(owner.id) : (participantsDraft[0]?.id || undefined);
    let chargeMode: 'INDIVIDUAL' | 'SHARED' = paymentMode === 'Ãšnico' ? 'INDIVIDUAL' : 'SHARED';
    let chargeResponsibleParticipantId = ownerId;
    let assignments: NewBookingDrawerDraft['billing']['assignments'] =
      paymentMode === 'Ãšnico'
        ? participantsDraft.map((participant) => ({
            id: `asg-${participant.id}`,
            participantId: participant.id,
            isChargeable: participant.id === ownerId,
            assignedAmount: participant.id === ownerId ? totalAmount : 0,
            participantLinkState: 'ACTIVE' as const,
          }))
        : participantsDraft.map((participant) => ({
            id: `asg-${participant.id}`,
            participantId: participant.id,
            isChargeable: participant.displayName.trim().length > 0,
            assignedAmount:
              participant.displayName.trim().length > 0
                ? Number(resolveParticipantPrice(participants.find((entry) => entry.id === participant.id) || participants[0] || initialParticipants[0]) || 0)
                : 0,
            participantLinkState: 'ACTIVE' as const,
          }));

    if (remoteBillingConfig && Number(remoteBillingConfig.bookingId || 0) === Number(bookingId || 0)) {
      chargeMode = remoteBillingConfig.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL';
      const mappedResponsible = remoteBillingConfig.chargeResponsibleRef
        ? participantIdByRef.get(String(remoteBillingConfig.chargeResponsibleRef))
        : undefined;
      chargeResponsibleParticipantId = mappedResponsible || ownerId;

      assignments = (Array.isArray(remoteBillingConfig.assignments) ? remoteBillingConfig.assignments : []).map((assignment, index) => {
        const participantRef = String(assignment?.participantRef || '').trim();
        let participantId = participantIdByRef.get(participantRef);
        let participantLinkState: 'ACTIVE' | 'ARCHIVED_REFERENCE' =
          assignment?.participantLinkState === 'ARCHIVED_REFERENCE' ? 'ARCHIVED_REFERENCE' : 'ACTIVE';
        if (!participantId) {
          participantId = `archived-ref-${index}`;
          participantsDraft.push({
            id: participantId,
            personId: undefined,
            displayName: participantRef || 'Participante archivado',
            contact: '',
            sourceType: 'guest',
            linked: false,
            bookingRole: 'PARTICIPANT',
            archived: true,
            archivedAt: undefined,
          });
          participantLinkState = 'ARCHIVED_REFERENCE';
        }
        return {
          id: String(assignment?.id || `asg-${participantId}`),
          participantId,
          isChargeable: Boolean(assignment?.isChargeable),
          assignedAmount: Number(assignment?.assignedAmount || 0),
          participantLinkState,
        };
      });
    }

    return {
      operational: {
        bookingId,
        clubId: Number(selectedClubIdState || 0),
        courtId: Number(selectedCourtId || 0),
        activityId: Number(selectedCourt?.activityTypeId || 0),
        startDateTime: buildStartDateTimeFromSlot(selectedDate, selectedStartSlot).toISOString(),
        endDateTime: buildStartDateTimeFromSlot(selectedDate, selectedEndSlot).toISOString(),
        status:
          editingBooking?.state === 'completed'
            ? 'COMPLETED'
            : editingBooking?.state === 'confirmed'
              ? 'CONFIRMED'
              : editingBooking?.state === 'blocked'
                ? 'CANCELLED'
                : 'PENDING',
        notes: notes || '',
        bookingResponsibleParticipantId: ownerId,
      },
      participants: participantsDraft,
      billing: {
        chargeMode,
        chargeResponsibleParticipantId,
        assignments,
        payments: paymentsDraft,
        pendingPaymentsQueue: [],
        financialSummary: {
          totalAmount,
          paidAmount,
          remainingAmount: Math.max(0, totalAmount - paidAmount),
          paymentStatus:
            paidAmount <= 0.009 ? 'UNPAID' : Math.max(0, totalAmount - paidAmount) <= 0.009 ? 'PAID' : 'PARTIAL',
          depositRequiredAmount: undefined,
          depositPaidAmount: undefined,
        },
      },
    };
  }, [
    bookingFinancial?.paid,
    bookingKind,
    drawerOpen,
    editingBooking?.clientId,
    editingBooking?.state,
    editingBooking?.userId,
    editingBookingId,
    notes,
    participants,
    paymentMode,
    remoteBillingConfig,
    resolveParticipantPrice,
    selectedClubIdState,
    selectedCourt?.activityTypeId,
    selectedCourtId,
    selectedDate,
    selectedEndSlot,
    selectedStartSlot,
    totalPrice,
  ]);
  useEffect(() => {
    if (!drawerOpen || !bookingDrawerDraftSnapshot) return;
    const loadKey = `${editingBookingId || 'new'}-${bookingKind}-${remoteBillingConfig?.updatedAt || 'billing-none'}`;
    if (bookingDrawerLoadKeyRef.current === loadKey) return;
    bookingDrawerLoadKeyRef.current = loadKey;
    bookingDrawerFormSyncSignatureRef.current = '';
    bookingDrawerDispatch({ type: 'LOAD_SUCCESS', payload: bookingDrawerDraftSnapshot });
  }, [bookingDrawerDraftSnapshot, bookingKind, drawerOpen, editingBookingId, remoteBillingConfig?.updatedAt]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!bookingDrawerState.draft) return;

    const activeParticipantsForSync = participants.map((participant, index) => ({
      id: String(participant.id || `participant-${index}`),
      personId: undefined,
      displayName: String(participant.name || ''),
      contact: String(participant.contact || ''),
      sourceType: participant.sourceType,
      linked: participant.sourceType !== 'guest',
      bookingRole: participant.isOwner ? 'BOOKING_RESPONSIBLE' as const : 'PARTICIPANT' as const,
      archived: false,
      archivedAt: undefined,
    }));
    const bookingResponsibleParticipantId = activeParticipantsForSync.find(
      (participant) => participant.bookingRole === 'BOOKING_RESPONSIBLE'
    )?.id;
    const chargeMode = paymentMode === 'Ãšnico' ? 'INDIVIDUAL' as const : 'SHARED' as const;
    const isPersistedEdit = Boolean(editingBookingId);
    const syncTotalAmount = isPersistedEdit
      ? Number(bookingDrawerState.draft.billing.financialSummary.totalAmount || 0)
      : Number(totalPrice || 0);
    const signature = JSON.stringify({
      key: `${editingBookingId || 'new'}-${bookingKind}`,
      chargeMode,
      total: isPersistedEdit ? 'persisted' : syncTotalAmount.toFixed(2),
      participants: activeParticipantsForSync.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
        contact: participant.contact,
        sourceType: participant.sourceType,
        bookingRole: participant.bookingRole,
      })),
    });

    if (!bookingDrawerFormSyncSignatureRef.current) {
      bookingDrawerFormSyncSignatureRef.current = signature;
      return;
    }
    if (bookingDrawerFormSyncSignatureRef.current === signature) return;

    bookingDrawerFormSyncSignatureRef.current = signature;
    bookingDrawerDispatch({
      type: 'SYNC_FROM_FORM',
      payload: {
        participants: activeParticipantsForSync,
        bookingResponsibleParticipantId,
        chargeMode,
        totalAmount: syncTotalAmount,
      },
    });
  }, [bookingDrawerState.draft, bookingKind, drawerOpen, editingBookingId, participants, paymentMode, totalPrice]);

  const shouldBlockSaveByQuote = useMemo(() => {
    if (!shouldValidatePastSelection) return false;
    if (!hasBlockingQuoteError) return false;
    if (quoteLoading) return false;
    if (editingBookingId && !hasScheduleChanges) return false;
    return true;
  }, [editingBookingId, hasBlockingQuoteError, hasScheduleChanges, quoteLoading, shouldValidatePastSelection]);
  const blockingActionMessage = useMemo(() => {
    if (formError) return formError;
    if (isSelectionInPast) return 'No se pueden reservar turnos en el pasado.';
    if (shouldShowScheduleConflict) return 'Hay un turno superpuesto en ese rango de fecha y horario.';
    if (hasDuplicateParticipants) return 'Hay participantes duplicados. Corregilo para poder guardar.';
    if (shouldBlockSaveByQuote && !isSelectionInPast) return quoteError || 'RevisÃ¡ los datos del turno.';
    return '';
  }, [formError, hasDuplicateParticipants, isSelectionInPast, quoteError, shouldBlockSaveByQuote, shouldShowScheduleConflict]);
  const hasBlockingActionError = blockingActionMessage.length > 0;
  const hasValidOwner = useMemo(
    () => participants.some((participant) => participant.isOwner && participant.name.trim().length > 0),
    [participants]
  );
  const dateFieldError = String(fieldErrors.date || '').trim();
  const timeFieldError = useMemo(() => {
    const fromField = String(fieldErrors.time || '').trim();
    if (fromField.length > 0) return fromField;
    if (isSelectionInPast) return 'No se pueden reservar turnos en el pasado.';
    if (shouldShowScheduleConflict) return 'Hay un turno superpuesto en ese rango de fecha y horario.';
    if (shouldBlockSaveByQuote && quoteError) return quoteError;
    return '';
  }, [fieldErrors.time, isSelectionInPast, quoteError, shouldBlockSaveByQuote, shouldShowScheduleConflict]);
  const courtFieldError = useMemo(() => {
    const fromField = String(fieldErrors.court || '').trim();
    if (fromField.length > 0) return fromField;
    if (shouldBlockSaveByQuote && quoteError && normalizeText(quoteError).includes('cancha')) {
      return quoteError;
    }
    return '';
  }, [fieldErrors.court, quoteError, shouldBlockSaveByQuote]);
  const ownerFieldError = useMemo(() => {
    const fromField = String(fieldErrors.owner || '').trim();
    if (fromField.length > 0) return fromField;
    if (!hasValidOwner) return 'Falta el responsable de la reserva.';
    if (paymentMode === 'Ãšnico' && !simplifiedOwnerAdded) return 'Primero agregÃ¡ el titular.';
    return '';
  }, [fieldErrors.owner, hasValidOwner, paymentMode, simplifiedOwnerAdded]);
  const participantsFieldError = useMemo(() => {
    const fromField = String(fieldErrors.participants || '').trim();
    if (fromField.length > 0) return fromField;
    if (hasDuplicateParticipants) return 'Hay participantes duplicados. Corregilo para poder guardar.';
    return '';
  }, [fieldErrors.participants, hasDuplicateParticipants]);
  const paymentFieldError = String(fieldErrors.payment || '').trim();
  const notesFieldError = String(fieldErrors.notes || '').trim();
  const persistedSidebarNotes = useMemo(
    () => parseSidebarNotesFromMetadata(remoteBillingConfig?.metadata) || '',
    [remoteBillingConfig?.metadata]
  );
  const persistedSidebarParticipantsComparable = useMemo(() => {
    if (!editingBookingId || bookingKind === 'block') return [];
    if (!editingBooking) return [];
    const persistedParticipants =
      parseSidebarParticipantsFromMetadata(remoteBillingConfig?.metadata, editingBooking) ||
      buildDefaultParticipantsForBooking(editingBooking);
    return buildSidebarComparableParticipants(persistedParticipants);
  }, [bookingKind, editingBooking, editingBookingId, remoteBillingConfig?.metadata]);
  const currentSidebarParticipantsComparable = useMemo(
    () => buildSidebarComparableParticipants(participants),
    [participants]
  );
  const hasSidebarParticipantsChanges = useMemo(() => {
    if (!editingBookingId || bookingKind === 'block') return false;
    return (
      JSON.stringify(currentSidebarParticipantsComparable) !==
      JSON.stringify(persistedSidebarParticipantsComparable)
    );
  }, [
    bookingKind,
    currentSidebarParticipantsComparable,
    editingBookingId,
    persistedSidebarParticipantsComparable,
  ]);
  const hasSidebarNotesChanges = useMemo(() => {
    if (!editingBookingId || bookingKind === 'block') return false;
    return String(notes || '') !== String(persistedSidebarNotes);
  }, [bookingKind, editingBookingId, notes, persistedSidebarNotes]);
  const hasBillingConfigChanges = bookingDrawerState.ui.dirtyFlags.billingConfig;
  const hasUserBillingConfigChanges = hasBillingConfigChanges && billingConfigTouchedByUser;
  const hasEditChanges = useMemo(() => {
    if (!editingBookingId) return true;
    if (bookingKind === 'block') return hasScheduleChanges;
    return (
      hasScheduleChanges ||
      hasSidebarNotesChanges ||
      hasSidebarParticipantsChanges ||
      hasUserBillingConfigChanges
    );
  }, [
    bookingKind,
    editingBookingId,
    hasScheduleChanges,
    hasSidebarParticipantsChanges,
    hasSidebarNotesChanges,
    hasUserBillingConfigChanges,
  ]);
  const primaryActionDisabled =
    isSubmittingBooking ||
    isDeletingBooking ||
    !hasValidOwner ||
    hasDuplicateParticipants ||
    isSelectionInPast ||
    shouldBlockSaveByQuote ||
    shouldShowScheduleConflict ||
    (paymentMode === 'Ãšnico' && !simplifiedOwnerAdded) ||
    Boolean(simplifiedEditingParticipantId) ||
    simplifiedNewParticipantOpen ||
    (Boolean(editingBookingId) && isRemoteBillingConfigLoading) ||
    (Boolean(editingBookingId) && !hasEditChanges) ||
    Boolean(formError);
  const lockBookingDetails =
    bookingKind !== 'block' &&
    (
      Boolean(formError) ||
      isSelectionInPast ||
      shouldShowScheduleConflict ||
      hasDuplicateParticipants ||
      (shouldBlockSaveByQuote && !isSelectionInPast)
    );

  const blockingBillingWarnings = useMemo(
    () =>
      new Set(
        (bookingDrawerState.ui.warnings || []).filter(
          (warning) =>
            warning === 'ASSIGNMENT_SUM_MISMATCH' ||
            warning === 'INDIVIDUAL_WITHOUT_CHARGE_RESPONSIBLE'
        )
      ),
    [bookingDrawerState.ui.warnings]
  );

  const operationalChecklist = useMemo(() => {
    const rows: Array<{ key: string; label: string; ok: boolean; detail?: string }> = [];

    rows.push({
      key: 'schedule',
      label: 'Horario vÃ¡lido',
      ok: !isSelectionInPast && !shouldShowScheduleConflict && !shouldBlockSaveByQuote,
      detail: isSelectionInPast
        ? 'No se puede reservar en el pasado.'
        : shouldShowScheduleConflict
          ? 'Se superpone con otra reserva.'
          : shouldBlockSaveByQuote
            ? quoteError || 'Horario no permitido por configuraciÃ³n.'
            : undefined,
    });

    if (bookingKind !== 'block') {
      rows.push({
        key: 'owner',
        label: 'Responsable de la reserva',
        ok: hasValidOwner,
        detail: hasValidOwner ? undefined : 'Falta nombre del responsable.',
      });
      rows.push({
        key: 'participants',
        label: 'Participantes sin duplicados',
        ok: !hasDuplicateParticipants,
        detail: hasDuplicateParticipants ? 'Hay participantes repetidos.' : undefined,
      });
      rows.push({
        key: 'billing',
        label: 'Cobro consistente',
        ok: blockingBillingWarnings.size === 0,
        detail:
          blockingBillingWarnings.size > 0
            ? 'RevisÃ¡ asignaciÃ³n de cobro (sumas/responsable).'
            : undefined,
      });
    }

    if (bookingKind === 'recurring') {
      rows.push({
        key: 'recurring-courts',
        label: 'Canchas seleccionadas para la serie',
        ok: recurringCourtIds.length > 0,
        detail: recurringCourtIds.length > 0 ? undefined : 'SeleccionÃ¡ al menos una cancha.',
      });
    }

    return rows;
  }, [
    blockingBillingWarnings.size,
    bookingKind,
    hasDuplicateParticipants,
    hasValidOwner,
    isSelectionInPast,
    quoteError,
    recurringCourtIds.length,
    shouldBlockSaveByQuote,
    shouldShowScheduleConflict,
  ]);

  const selectedBookingKindLabel = useMemo(
    () => bookingKindOptions.find((option) => option.value === bookingKind)?.label || 'Reserva',
    [bookingKind]
  );

  const quickSummaryCourtsLabel = useMemo(() => {
    if (bookingKind === 'recurring') {
      const selectedNames = effectiveCourts
        .filter((court) => recurringCourtIds.includes(court.id))
        .map((court) => court.name);
      if (selectedNames.length === 0) return 'Sin canchas seleccionadas';
      return selectedNames.join(', ');
    }
    return selectedCourt?.name || 'Cancha no definida';
  }, [bookingKind, effectiveCourts, recurringCourtIds, selectedCourt?.name]);

  const quickSummaryDateLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    [selectedDate]
  );

  const primaryActionLabel = useMemo(() => {
    if (isSubmittingBooking) {
      if (editingBookingId) return 'Guardando cambios...';
      if (bookingKind === 'recurring') return 'Creando serie...';
      if (bookingKind === 'block') return 'Creando bloqueo...';
      return 'Creando reserva...';
    }
    if (editingBookingId) return 'Guardar cambios';
    if (bookingKind === 'recurring') return 'Crear serie';
    if (bookingKind === 'block') return 'Crear bloqueo';
    return 'Crear reserva';
  }, [bookingKind, editingBookingId, isSubmittingBooking]);

  const primaryActionMeta = useMemo(() => {
    if (bookingKind === 'recurring') {
      if (recurringCourtIds.length <= 0) return 'sin canchas';
      return `${recurringCourtIds.length} cancha${recurringCourtIds.length === 1 ? '' : 's'}`;
    }
    return `${selectionMinutes} min`;
  }, [bookingKind, recurringCourtIds.length, selectionMinutes]);

  const nowLineTop = useMemo(() => {
    const now = new Date(nowTick);
    const sameDay =
      now.getFullYear() === selectedDate.getFullYear() &&
      now.getMonth() === selectedDate.getMonth() &&
      now.getDate() === selectedDate.getDate();
    if (!sameDay) return null;

    const minutesFromGridStart =
      now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 - startHour * 60;
    const totalMinutes = (endHour - startHour) * 60;
    if (minutesFromGridStart < 0 || minutesFromGridStart > totalMinutes) return null;

    return Math.max(0, Math.min(gridHeight, (minutesFromGridStart / slotMinutes) * slotHeight));
  }, [nowTick, selectedDate]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (persistedEditingBookingId && bookingKind !== 'block') {
      setQuoteLoading(false);
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('');
      clearFieldErrorsFor(['date', 'time', 'court', 'duration']);
      return;
    }

    if (bookingKind === 'block') {
      setQuoteLoading(false);
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('');
      clearFieldErrorsFor(['date', 'time', 'court', 'duration']);
      return;
    }

    const activityId = Number(selectedCourt?.activityTypeId || 0);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('No se pudo resolver la actividad para cotizar.');
      setFieldErrors((previous) => ({
        ...previous,
        court: 'No se pudo resolver la actividad para cotizar.',
      }));
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        setQuoteLoading(true);
        setQuotedListPrice(null);
        setQuotedFinalPrice(null);
        setQuotedDiscountAmount(0);
        setQuoteError('');
        clearFieldErrorsFor(['date', 'time', 'court', 'duration']);
        const bookingDate = new Date(selectedDate);
        const quote = await getBookingQuote({
          courtId: Number(selectedCourtId),
          activityId,
          date: bookingDate,
          slotTime: slotToTime(selectedStartSlot),
          durationMinutes: selectionMinutes,
          clientPhone: resolvePlaygroundClientPhone(null),
        });
        if (cancelled) return;
        setQuotedListPrice(Number(quote?.listPrice || 0));
        setQuotedFinalPrice(Number(quote?.finalPrice || 0));
        setQuotedDiscountAmount(Number(quote?.discountAmount || 0));
        clearFieldErrorsFor(['date', 'time', 'court', 'duration']);
      } catch (error: any) {
        if (cancelled) return;
        setQuotedListPrice(null);
        setQuotedFinalPrice(null);
        setQuotedDiscountAmount(0);
        const normalized = normalizeApiError(error, 'No se pudo cotizar.');
        const behavior = resolveBookingErrorBehavior(normalized);
        const quoteMessage = toUserSafeMessage(
          String(normalized.message || behavior.fallbackMessage || 'No se pudo cotizar.').trim(),
          'No se pudo cotizar.'
        );
        const field = String(behavior.field || normalized.field || 'time').trim() || 'time';
        setQuoteError(quoteMessage);
        setFieldErrors((previous) => ({
          ...previous,
          [field]: quoteMessage,
        }));
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };

    timeoutId = setTimeout(() => {
      void run();
    }, 250);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    bookingKind,
    selectedCourt,
    selectedCourtId,
    selectedDate,
    clearFieldErrorsFor,
    selectedStartSlot,
    selectionMinutes,
    persistedEditingBookingId,
  ]);

  const moveDate = (days: number) => {
    setSelectedDate((previous) => {
      const next = new Date(previous);
      next.setDate(previous.getDate() + days);
      return next;
    });
  };

  const queueRemainingPayment = useCallback(() => {
    const draft = bookingDrawerState.draft;
    if (!draft) return;
    const remainingAmount = Number(draft.billing.financialSummary.remainingAmount || 0);
    const amountToRegister = Number(remainingAmount.toFixed(2));
    if (amountToRegister <= 0.009) {
      setBillingHubTab('PAYMENTS');
      showCalendarNotice('El saldo ya estÃ¡ cubierto por pagos registrados.');
      return;
    }
    void registerPaymentNow({
      amount: amountToRegister,
      method: 'CASH',
      successMessage: `Pago registrado: ${amountToRegister.toFixed(2)} $.`,
    });
  }, [bookingDrawerState.draft, registerPaymentNow, showCalendarNotice]);

  const handleBillingModeChange = useCallback((_mode: 'INDIVIDUAL' | 'SHARED') => {
    setBillingConfigTouchedByUser(true);
    setPaymentMode('Único');
    bookingDrawerDispatch({ type: 'SET_CHARGE_MODE', payload: { mode: 'INDIVIDUAL' } });
  }, []);

  const handleBillingResponsibleChange = useCallback((participantId: string) => {
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'SET_CHARGE_RESPONSIBLE', payload: { participantId } });
  }, []);

  const handleBillingAssignmentAmountChange = useCallback((assignmentId: string, amount: number) => {
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'SET_ASSIGNMENT_AMOUNT', payload: { assignmentId, amount } });
  }, []);

  const handleBillingToggleChargeable = useCallback((assignmentId: string, isChargeable: boolean) => {
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'TOGGLE_ASSIGNMENT_CHARGEABLE', payload: { assignmentId, isChargeable } });
  }, []);

  const closeSimplifiedPaymentModal = useCallback(() => {
    setSimplifiedPaymentModalOpen(false);
    setSimplifiedPaymentPayerParticipantIdDraft('');
    setSimplifiedPaymentAmountDraft('');
    setSimplifiedPaymentMethodDraft('');
    setSimplifiedPaymentNoteDraft('');
  }, []);

  const openSimplifiedPaymentModal = useCallback(() => {
    if (!persistedEditingBookingId) {
      showCalendarNotice('Primero creÃ¡ la reserva. DespuÃ©s podÃ©s registrar cobros.');
      return;
    }
    if (isPaymentLockedByManualPending) {
      showCalendarNotice('Primero confirmÃ¡ la reserva para poder registrar pagos.');
      return;
    }

    const draft = bookingDrawerState.draft;
    if (!draft) {
      showCalendarNotice('No se pudo preparar el cobro. ReabrÃ­ la reserva e intentÃ¡ de nuevo.');
      return;
    }

    const namedParticipants = participants.filter((participant) => participant.name.trim().length > 0);
    if (namedParticipants.length === 0) {
      showCalendarNotice('Primero agregÃ¡ al menos un participante con nombre.');
      return;
    }

    const preferredPayerId = (() => {
      const draftResponsible = String(draft.billing.chargeResponsibleParticipantId || '').trim();
      if (draftResponsible && namedParticipants.some((participant) => participant.id === draftResponsible)) {
        return draftResponsible;
      }
      const ownerNamed = namedParticipants.find((participant) => participant.isOwner);
      return ownerNamed?.id || namedParticipants[0]?.id || '';
    })();
    const payer = participants.find((participant) => participant.id === preferredPayerId);

    setSimplifiedPaymentPayerParticipantIdDraft(preferredPayerId);
    setSimplifiedPaymentMethodDraft(payer?.paymentMethod || 'CASH');
    setSimplifiedPaymentAmountDraft(
      simplifiedRemainingAfterQueue > 0.009 ? simplifiedRemainingAfterQueue.toFixed(2) : ''
    );
    setSimplifiedPaymentNoteDraft('');
    setSimplifiedPaymentModalOpen(true);
    setFormError('');
  }, [
    bookingDrawerState.draft,
    isPaymentLockedByManualPending,
    participants,
    persistedEditingBookingId,
    showCalendarNotice,
    simplifiedRemainingAfterQueue,
  ]);

  const queueSimplifiedPaymentFromModal = useCallback(() => {
    if (isPaymentLockedByManualPending) {
      showCalendarNotice('Primero confirmÃ¡ la reserva para poder registrar pagos.');
      return;
    }

    const payerId = String(simplifiedPaymentPayerParticipantIdDraft || '').trim();
    if (!payerId) {
      showCalendarNotice('SeleccionÃ¡ quiÃ©n paga esta reserva.');
      return;
    }
    if (!isParticipantPaymentMethod(simplifiedPaymentMethodDraft)) {
      showCalendarNotice('SeleccionÃ¡ un mÃ©todo de pago.');
      return;
    }
    const selectedMethod = simplifiedPaymentMethodDraft as Participant['paymentMethod'];

    const amount = Number(String(simplifiedPaymentAmountDraft || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0.009) {
      showCalendarNotice('IngresÃ¡ un monto mayor a 0.');
      return;
    }
    if (amount > simplifiedRemainingAfterQueue + 0.009) {
      showCalendarNotice(`El monto supera la deuda pendiente (${simplifiedRemainingAfterQueue.toFixed(2)} $).`);
      return;
    }

    updateParticipant(payerId, { paymentMethod: selectedMethod });
    void registerPaymentNow({
      amount: Number(amount.toFixed(2)),
      method: selectedMethod,
      participantId: payerId,
      successMessage: `Pago registrado: ${amount.toFixed(2)} $.`,
    }).then((ok) => {
      if (!ok) return;
      closeSimplifiedPaymentModal();
      setFormError('');
    });
  }, [
    closeSimplifiedPaymentModal,
    isPaymentLockedByManualPending,
    registerPaymentNow,
    showCalendarNotice,
    simplifiedPaymentAmountDraft,
    simplifiedPaymentMethodDraft,
    simplifiedPaymentPayerParticipantIdDraft,
    simplifiedRemainingAfterQueue,
    updateParticipant,
  ]);

  const persistBillingConfig = useCallback(async (
    bookingId: number,
    options?: {
      bookingClientId?: string;
      bookingUserId?: number | null;
    }
  ) => {
    const draft = bookingDrawerState.draft;
    if (!draft) return false;

    try {
      const bookingClientIdRaw = String(options?.bookingClientId || editingBooking?.clientId || '').trim();
      const bookingClientId = bookingClientIdRaw.length > 0 ? bookingClientIdRaw : undefined;
      const bookingUserIdRaw = Number(options?.bookingUserId ?? editingBooking?.userId ?? 0);
      const bookingUserId =
        Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
          ? bookingUserIdRaw
          : undefined;
      const participantRefById = new Map<string, string>();
      participants.forEach((participant) => {
        participantRefById.set(
          String(participant.id),
          buildStableParticipantRef(participant, { bookingClientId, bookingUserId })
        );
      });

      const nextMode: PaymentMode = 'Único';
      const confirmedByAssignment = new Map<string, number>();
      draft.billing.payments
        .filter((payment) => payment.status === 'CONFIRMED' && payment.assignmentId)
        .forEach((payment) => {
          const key = String(payment.assignmentId || '');
          if (!key) return;
          confirmedByAssignment.set(key, Number((confirmedByAssignment.get(key) || 0) + Number(payment.amount || 0)));
        });

      const nextParticipants: Participant[] = draft.participants
        .filter((participant) => !participant.archived)
        .map((participant, index) => {
          const assignment = draft.billing.assignments.find((entry) => entry.participantId === participant.id);
          const existing = participants.find((entry) => String(entry.id) === String(participant.id));
          const assignedAmount = Number(assignment?.assignedAmount || 0);
          const confirmed = Number(confirmedByAssignment.get(String(assignment?.id || '')) || 0);
          const paid = assignment?.isChargeable ? confirmed + 0.009 >= assignedAmount && assignedAmount > 0 : false;
          const participantRef = participantRefById.get(String(participant.id)) || `guest:${participant.id}`;
          return {
            id: participant.id,
            name: participant.displayName,
            contact: participant.contact || '',
            paid,
            isOwner:
              participant.id === draft.operational.bookingResponsibleParticipantId ||
              (!draft.operational.bookingResponsibleParticipantId && index === 0),
            sourceType: participant.sourceType,
            entityRef: participantRef,
            paymentMethod: existing?.paymentMethod || 'CASH',
            customPrice: null,
          } satisfies Participant;
        });
      if (nextParticipants.length > 0 && !nextParticipants.some((participant) => participant.isOwner)) {
        nextParticipants[0] = { ...nextParticipants[0], isOwner: true };
      }

      const resolvedResponsibleParticipantId = (() => {
        const draftResponsible = String(draft.billing.chargeResponsibleParticipantId || '').trim();
        if (draftResponsible && participantRefById.has(draftResponsible)) return draftResponsible;

        const operationalResponsible = String(draft.operational.bookingResponsibleParticipantId || '').trim();
        if (operationalResponsible && participantRefById.has(operationalResponsible)) return operationalResponsible;

        const ownerNamed = nextParticipants.find((participant) => participant.isOwner);
        if (ownerNamed?.id && participantRefById.has(String(ownerNamed.id))) return String(ownerNamed.id);

        const firstNamed = nextParticipants.find((participant) => participant.name.trim().length > 0);
        if (firstNamed?.id && participantRefById.has(String(firstNamed.id))) return String(firstNamed.id);

        return nextParticipants[0]?.id ? String(nextParticipants[0].id) : undefined;
      })();

      const totalChargeableAmount = Number(
        Number(draft.billing.financialSummary.totalAmount || totalPrice || 0).toFixed(2)
      );
      const assignmentRows = draft.billing.assignments.map((assignment) => ({
        id: String(assignment.id || `asg-${String(assignment.participantId)}`),
        participantId: String(assignment.participantId || ''),
        participantRef:
          participantRefById.get(String(assignment.participantId)) ||
          `guest:${String(assignment.participantId)}`,
        participantLinkState: (
          assignment.participantLinkState === 'ARCHIVED_REFERENCE'
            ? 'ARCHIVED_REFERENCE'
            : 'ACTIVE'
        ) as 'ACTIVE' | 'ARCHIVED_REFERENCE',
      }));
      const chargeableAssignmentId =
        assignmentRows.find(
          (assignment) =>
            assignment.participantId === String(resolvedResponsibleParticipantId || '') &&
            assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
        )?.id ||
        assignmentRows.find(
          (assignment) => assignment.participantId === String(resolvedResponsibleParticipantId || '')
        )?.id ||
        assignmentRows.find((assignment) => assignment.participantLinkState !== 'ARCHIVED_REFERENCE')?.id ||
        assignmentRows[0]?.id;

      const payloadAssignments = assignmentRows.map((assignment) => {
        const isChargeable = Boolean(chargeableAssignmentId) && assignment.id === chargeableAssignmentId;
        return {
          id: assignment.id,
          participantRef: assignment.participantRef,
          isChargeable,
          assignedAmount: isChargeable ? totalChargeableAmount : 0,
          participantLinkState: assignment.participantLinkState,
        };
      });

      let chargeResponsibleRef =
        (resolvedResponsibleParticipantId
          ? participantRefById.get(String(resolvedResponsibleParticipantId))
          : undefined) ||
        payloadAssignments.find((assignment) => assignment.isChargeable)?.participantRef ||
        payloadAssignments[0]?.participantRef;

      if (!chargeResponsibleRef && resolvedResponsibleParticipantId) {
        chargeResponsibleRef = `guest:${String(resolvedResponsibleParticipantId)}`;
      }
      const sidebarParticipantsMetadata = buildSidebarParticipantsMetadata(nextParticipants);
      const sidebarNotesValue = String(notes || '');

      let backendPersisted = false;
      try {
        const savedConfig = await updateBookingBillingConfig(bookingId, {
          chargeMode: 'INDIVIDUAL',
          chargeResponsibleRef,
          assignments: payloadAssignments,
          metadata: {
            schemaVersion: 1,
            client: 'agenda-playground-v2',
            sidebarParticipants: sidebarParticipantsMetadata,
            sidebarNotes: sidebarNotesValue,
            sidebar: {
              participants: sidebarParticipantsMetadata,
              notes: sidebarNotesValue,
            },
          },
        });
        setRemoteBillingConfig(savedConfig);
        backendPersisted = true;
      } catch (error) {
        reportUiError({ area: 'AgendaPlayground', action: 'updateBillingConfig' }, error);
      }

      setPaymentMode(nextMode);
      setParticipants(nextParticipants.length > 0 ? nextParticipants : initialParticipants.map((participant) => ({ ...participant })));
      setParticipantPriceDraftById({});
      return backendPersisted;
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'persistBillingConfig' }, error);
      return false;
    }
  }, [bookingDrawerState.draft, editingBooking?.clientId, editingBooking?.userId, notes, participants, totalPrice]);

  const persistNewBookingDraftState = useCallback(
    async (
      bookingId: number,
      options?: {
        bookingClientId?: string;
        bookingUserId?: number | null;
      }
    ) => {
      if (!Number.isFinite(bookingId) || bookingId <= 0) return;

      if (bookingKind === 'block') return;
      if (!bookingDrawerState.draft) return;

      try {
        await persistBillingConfig(bookingId, options);
      } catch (error) {
        reportUiError({ area: 'AgendaPlayground', action: 'persistNewBookingDraftState' }, error);
      }
    },
    [bookingDrawerState.draft, bookingKind, persistBillingConfig]
  );

  const handleCreateBooking = async () => {
    let recurringSummaryError = '';
    let createdBookingId: string | null = null;
    if (bookingKind === 'recurring' && !recurringCreateConfirmed) {
      setFormError('');
      setRecurringCreateConfirmOpen(true);
      return;
    }
    if (bookingKind === 'recurring' && recurringCreateConfirmed) {
      setRecurringCreateConfirmed(false);
    }

    const owner = participants.find((participant) => participant.isOwner);

    if (!owner || owner.name.trim().length === 0) {
      setBlockingFieldError('owner', 'Falta el responsable de la reserva.');
      return;
    }

    if (paymentMode === 'Ãšnico' && !simplifiedOwnerAdded) {
      setBlockingFieldError('owner', 'Primero agregÃ¡ el titular.');
      return;
    }

    if (simplifiedEditingParticipantId) {
      setBlockingFieldError('participants', 'TerminÃ¡ de editar el participante antes de guardar.');
      return;
    }

    if (simplifiedNewParticipantOpen) {
      setBlockingFieldError('participants', 'TerminÃ¡ de agregar el nuevo participante antes de guardar.');
      return;
    }

    if (hasDuplicateParticipants) {
      setBlockingFieldError('participants', 'No podÃ©s guardar con participantes duplicados.');
      return;
    }

    if (selectedEndSlot <= selectedStartSlot) {
      setBlockingFieldError('time', 'La hora de fin debe ser mayor a la de inicio.');
      return;
    }

    if (isSelectionInPast) {
      setBlockingFieldError('time', 'No se pueden reservar turnos en el pasado.');
      return;
    }

    if (bookingKind !== 'recurring' && hasConflict && (!editingBookingId || hasScheduleChanges)) {
      setBlockingFieldError('time', 'Ya existe una reserva en ese rango horario para la cancha seleccionada.');
      return;
    }

    if (bookingKind === 'block') {
      if (editingBookingId) {
        if (!hasScheduleChanges) {
          setDrawerOpen(false);
          setFormError('');
          setEditingBookingId(null);
          setEditingBaseline(null);
          return;
        }
        try {
          setIsSubmittingBooking(true);
          await persistBookingMove(editingBookingId, selectedCourtId, selectedStartSlot, selectedEndSlot);
          await reloadSchedule();
          setDrawerOpen(false);
          setFormError('');
          setEditingBookingId(null);
          setEditingBaseline(null);
          return;
        } catch (error: any) {
          applyBookingError(error, 'No se pudo actualizar el bloqueo.');
          return;
        } finally {
          setIsSubmittingBooking(false);
        }
      }
      const newBooking: Booking = {
        id: `manual-${Date.now()}`,
        courtId: selectedCourtId,
        startSlot: selectedStartSlot,
        endSlot: selectedEndSlot,
        title: blockingTitle.trim() || 'Bloqueo',
        state: 'blocked',
        paymentState: 'unpaid',
      };
      setBookings((previous) => [...previous, newBooking]);
      setDrawerOpen(false);
      setFormError('');
      setBlockingTitle('');
      return;
    }

    if (editingBookingId) {
      if (!hasScheduleChanges && !hasUserBillingConfigChanges && !hasSidebarNotesChanges && !hasSidebarParticipantsChanges) {
        setDrawerOpen(false);
        setFormError('');
        setEditingBookingId(null);
        setEditingBaseline(null);
        return;
      }
      try {
        setIsSubmittingBooking(true);
        setIsWaitingQueuedPaymentConfirmation(false);
        bookingDrawerDispatch({ type: 'SAVE_START' });
        const numericBookingId = Number(editingBookingId);
        let operationalSaved = true;
        let billingSaved = true;
        if (hasScheduleChanges) {
          await persistBookingMove(editingBookingId, selectedCourtId, selectedStartSlot, selectedEndSlot);
        }
        if (Number.isFinite(numericBookingId) && numericBookingId > 0) {
          billingSaved = await persistBillingConfig(numericBookingId);
        }
        const failedPaymentTempIds: string[] = [];

        await reloadSchedule();
        let latestFinancialSummary:
          | {
              total?: number;
              paid?: number;
              remaining?: number;
            }
          | null = null;
        if (Number.isFinite(numericBookingId) && numericBookingId > 0) {
          latestFinancialSummary = await refreshBookingFinancial(numericBookingId);
        }

        if (!billingSaved) {
          const partialIssues = [
            !billingSaved ? 'configuraciÃ³n de cobro' : '',
            failedPaymentTempIds.length > 0 ? `${failedPaymentTempIds.length} pagos` : '',
          ].filter(Boolean);
          bookingDrawerDispatch({
            type: 'SAVE_PARTIAL',
            payload: {
              message: `Guardado parcial: faltÃ³ guardar ${partialIssues.join(' y ')}.`,
              operationalSaved,
              billingSaved,
              failedPaymentTempIds,
            },
          });
          setFormError(
            !billingSaved
              ? 'Guardado parcial: no se pudo persistir toda la configuraciÃ³n de cobro.'
              : 'Guardado parcial.'
          );
          showCalendarNotice(
            !billingSaved
              ? 'Guardado parcial: configuraciÃ³n de cobro pendiente'
              : 'Guardado parcial'
          );
          return;
        }

        if (latestFinancialSummary) {
          setParticipants((previous) =>
            distributePaidByParticipants(
              previous,
              paymentMode,
              Number(latestFinancialSummary?.total || 0),
              Number(latestFinancialSummary?.paid || 0)
            )
          );
        }
        setBillingConfigTouchedByUser(false);
        bookingDrawerDispatch({ type: 'SAVE_SUCCESS' });
        const shouldClose = hasScheduleChanges;
        if (shouldClose) {
          setDrawerOpen(false);
          setEditingBookingId(null);
          setEditingBaseline(null);
        }
        setFormError('');
        showCalendarNotice(shouldClose ? 'Reserva actualizada correctamente.' : 'Cambios guardados.');
        return;
      } catch (error: any) {
        const handled = applyBookingError(error, 'No se pudo actualizar la reserva.');
        bookingDrawerDispatch({
          type: 'SAVE_FAILED',
          payload: { message: handled.message || 'No se pudo guardar.' },
        });
        return;
      } finally {
        setIsSubmittingBooking(false);
        setIsWaitingQueuedPaymentConfirmation(false);
      }
    }

    try {
      setIsSubmittingBooking(true);
      const slotTime = slotToTime(selectedStartSlot);
      const ownerPhone = resolvePlaygroundClientPhone(owner);

      if (bookingKind === 'recurring') {
        setRecurringOverlapItems([]);
        setRecurringOverlapModalOpen(false);

        if (!Number.isFinite(recurringEveryDays) || recurringEveryDays <= 0) {
          setFormError('IndicÃ¡ cada cuÃ¡ntos dÃ­as querÃ©s repetir la serie.');
          return;
        }
        if (
          !(recurringFrequencyPreset === 'custom' && !customEndAfterEnabled) &&
          (!Number.isFinite(recurringRepetitions) || recurringRepetitions <= 0)
        ) {
          setFormError('IndicÃ¡ cuÃ¡ntas repeticiones querÃ©s generar.');
          return;
        }
        if (selectedRecurringCourts.length === 0) {
          setFormError('SeleccionÃ¡ al menos una cancha para crear la serie.');
          return;
        }
        const recurrenceDays =
          recurringFrequencyPreset === 'custom'
            ? Array.from(new Set(customRecurrenceDays)).sort((a, b) => a - b)
            : [recurringDayOfWeek];
        if (recurrenceDays.length === 0) {
          setFormError('SeleccionÃ¡ al menos un dÃ­a para la recurrencia.');
          return;
        }
        const baseDate = new Date(selectedDate);
        baseDate.setHours(12, 0, 0, 0);
        const frequencyDays = recurringFrequencyPreset === 'custom'
          ? Math.max(1, Math.floor(customRepeatEveryWeeks)) * 7
          : Math.max(1, Math.floor(recurringEveryDays));
        const repetitionsPerDay = recurringFrequencyPreset === 'custom'
          ? (
            customEndAfterEnabled
              ? Math.max(1, Math.ceil(Math.max(1, Math.floor(customEndAfterReservations)) / recurrenceDays.length))
              : undefined
          )
          : Math.max(1, Math.floor(recurringRepetitions));

        const submitRecurring = async (
          courtId: string,
          activityId: number,
          dayOfWeek: number
        ) => {
          const firstOccurrence = getNextDateForDay(baseDate, dayOfWeek, slotTime);
          const result = await createFixedBooking(Number(courtId), activityId, firstOccurrence, {
            durationMinutes: selectionMinutes,
            everyDays: frequencyDays,
            ...(Number.isFinite(repetitionsPerDay) ? { repetitions: repetitionsPerDay } : {}),
            client: {
              name: owner.name.trim(),
              phone: ownerPhone,
            },
          });
          return result;
        };

        const overlapDetails: RecurringOverlapItem[] = [];
        const hardErrors: string[] = [];
        let recurringOverlapOnlyMessage = '';
        let generatedCount = 0;
        let skippedCount = 0;
        const pushOverlapDetail = (item: any, fallbackCourtName: string) => {
          const requestedStartRaw = item?.requestedStartDateTime || item?.startDateTime || item?.date || null;
          const requestedEndRaw = item?.requestedEndDateTime || item?.endDateTime || null;
          const conflictingStartRaw = item?.conflictingStartDateTime || null;
          const conflictingEndRaw = item?.conflictingEndDateTime || null;
          const requestedStart = requestedStartRaw ? new Date(requestedStartRaw) : null;
          const requestedEnd = requestedEndRaw ? new Date(requestedEndRaw) : null;
          const conflictingStart = conflictingStartRaw ? new Date(conflictingStartRaw) : null;
          const conflictingEnd = conflictingEndRaw ? new Date(conflictingEndRaw) : null;

          const hasRequestedStart = requestedStart && !Number.isNaN(requestedStart.getTime());
          const hasRequestedEnd = requestedEnd && !Number.isNaN(requestedEnd.getTime());
          const hasConflictingStart = conflictingStart && !Number.isNaN(conflictingStart.getTime());
          const hasConflictingEnd = conflictingEnd && !Number.isNaN(conflictingEnd.getTime());

          const requestedDateLabel = hasRequestedStart
            ? (requestedStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : 'Fecha no disponible';
          const requestedStartLabel = hasRequestedStart
            ? (requestedStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : Number.isFinite(Number(item?.startTimeMinutes))
              ? minutesToHourLabel(Number(item.startTimeMinutes))
              : slotToTime(selectedStartSlot);
          const inferredRequestedEnd =
            hasRequestedStart && !hasRequestedEnd
              ? new Date((requestedStart as Date).getTime() + Math.max(15, selectionMinutes) * 60000)
              : null;
          const requestedEndLabel = hasRequestedEnd
            ? (requestedEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : inferredRequestedEnd
              ? inferredRequestedEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : Number.isFinite(Number(item?.endTimeMinutes))
              ? minutesToHourLabel(Number(item.endTimeMinutes))
              : slotToTime(selectedEndSlot);

          const conflictingDateLabel = hasConflictingStart
            ? (conflictingStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : undefined;
          const conflictingStartLabel = hasConflictingStart
            ? (conflictingStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : Number.isFinite(Number(item?.startTimeMinutes))
              ? minutesToHourLabel(Number(item.startTimeMinutes))
              : undefined;
          const conflictingEndLabel = hasConflictingEnd
            ? (conflictingEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : Number.isFinite(Number(item?.endTimeMinutes))
              ? minutesToHourLabel(Number(item.endTimeMinutes))
              : undefined;

          overlapDetails.push({
            courtName: String(item?.courtName || item?.conflictingCourtName || fallbackCourtName || 'Cancha'),
            requestedDateLabel,
            requestedTimeLabel: `${requestedStartLabel} - ${requestedEndLabel}`,
            conflictingDateLabel: conflictingDateLabel || (conflictingStartLabel && conflictingEndLabel ? requestedDateLabel : undefined),
            conflictingTimeLabel:
              conflictingStartLabel && conflictingEndLabel ? `${conflictingStartLabel} - ${conflictingEndLabel}` : undefined,
            activityName: String(item?.conflictingActivityName || item?.activityName || '').trim() || undefined,
            clientName: String(item?.conflictingClientName || item?.clientName || '').trim() || undefined,
          });
        };

        for (const court of selectedRecurringCourts) {
          const activityId = Number(court.activityTypeId || 0);
          if (!Number.isFinite(activityId) || activityId <= 0) {
            hardErrors.push(`${court.name}: sin actividad configurada`);
            continue;
          }
          for (const dayOfWeek of recurrenceDays) {
            try {
              const result = await submitRecurring(court.id, activityId, dayOfWeek);
              generatedCount += Number(result?.generatedCount || 0);
              const skippedOccurrences = Array.isArray(result?.skippedOccurrences) ? result.skippedOccurrences : [];
              skippedCount += skippedOccurrences.length;
              if (skippedOccurrences.length > 0) {
                skippedOccurrences.forEach((item: any) => {
                  pushOverlapDetail(item, court.name);
                });
              }
            } catch (error: any) {
              const overlaps = Array.isArray(error?.details?.overlaps)
                ? error.details.overlaps
                : Array.isArray(error?.meta?.overlaps)
                  ? error.meta.overlaps
                : Array.isArray(error?.overlaps)
                  ? error.overlaps
                  : [];

              if (error?.details?.canProceed || error?.meta?.canProceed) {
                skippedCount += overlaps.length > 0 ? overlaps.length : 1;
                if (overlaps.length > 0) {
                  overlaps.forEach((item: any) => {
                    pushOverlapDetail(item, court.name);
                  });
                } else {
                  const firstOccurrence = getNextDateForDay(baseDate, dayOfWeek, slotTime);
                  overlapDetails.push({
                    courtName: court.name,
                    requestedDateLabel: firstOccurrence.toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    }),
                    requestedTimeLabel: `${slotToTime(selectedStartSlot)} - ${slotToTime(selectedEndSlot)}`,
                  });
                }
                continue;
              }

              if (overlaps.length > 0) {
                skippedCount += overlaps.length;
                overlaps.forEach((item: any) => {
                  pushOverlapDetail(item, court.name);
                });
                const recurringMessage = toUserSafeMessage(error?.message, '');
                if (recurringMessage.length > 0) {
                  recurringOverlapOnlyMessage = recurringMessage;
                }
                continue;
              }
              hardErrors.push(`${court.name}: ${toUserSafeMessage(error?.message, 'Error al crear serie')}`);
            }
          }
        }

        setRecurringResult({
          generatedCount,
          skippedCount,
          courtsCount: selectedRecurringCourts.length,
        });
        if (hardErrors.length > 0) {
          recurringSummaryError = `Algunas canchas fallaron: ${hardErrors.join(' Â· ')}`;
          setFormError(recurringSummaryError);
        } else if (generatedCount === 0 && skippedCount > 0 && recurringOverlapOnlyMessage) {
          recurringSummaryError = recurringOverlapOnlyMessage;
          setFormError(recurringSummaryError);
        } else {
          setFormError('');
        }
        if (overlapDetails.length > 0) {
          setRecurringOverlapItems(overlapDetails);
          setRecurringOverlapModalOpen(true);
        }
      } else {
        const selectedActivityId = Number(selectedCourt?.activityTypeId || 0);
        if (!Number.isFinite(selectedActivityId) || selectedActivityId <= 0) {
          setFormError('No se pudo resolver la actividad de la cancha. RevisÃ¡ la configuraciÃ³n del club.');
          return;
        }
        const bookingDate = new Date(selectedDate);
        const createdPayload: any = await createBooking(Number(selectedCourtId), selectedActivityId, bookingDate, slotTime, {
          durationMinutes: selectionMinutes,
          client: {
            name: owner.name.trim(),
            phone: ownerPhone,
          },
        });
        const maybeId = Number(createdPayload?.booking?.id ?? createdPayload?.id ?? createdPayload?.bookingId);
        if (Number.isFinite(maybeId) && maybeId > 0) {
          createdBookingId = String(maybeId);
          const bookingPayload =
            createdPayload?.booking && typeof createdPayload.booking === 'object'
              ? createdPayload.booking
              : createdPayload;

          let createdBookingClientIdRaw = String(
            bookingPayload?.clientId || bookingPayload?.client?.id || ''
          ).trim();
          let createdBookingUserIdRaw = Number(
            bookingPayload?.userId || bookingPayload?.user?.id || 0
          );

          if (!createdBookingClientIdRaw && !(Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0)) {
            try {
              const hydratedBooking = await getBookingById(maybeId);
              createdBookingClientIdRaw = String(
                hydratedBooking?.clientId || hydratedBooking?.client?.id || ''
              ).trim();
              createdBookingUserIdRaw = Number(
                hydratedBooking?.userId || hydratedBooking?.user?.id || 0
              );
            } catch {
            }
          }

          const createdBookingClientId = createdBookingClientIdRaw.length > 0 ? createdBookingClientIdRaw : undefined;
          const createdBookingUserId =
            Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0
              ? createdBookingUserIdRaw
              : undefined;
          await persistNewBookingDraftState(maybeId, {
            bookingClientId: createdBookingClientId,
            bookingUserId: createdBookingUserId,
          });
        }
      }

      const refreshedBookings = await reloadSchedule();
      if (bookingKind === 'recurring') {
        if (recurringSummaryError) {
          setFormError(recurringSummaryError);
        }
        setEditingBookingId(null);
        setEditingBaseline(null);
        return;
      }
      if (createdBookingId) {
        const createdBooking = (Array.isArray(refreshedBookings) ? refreshedBookings : []).find(
          (booking) => String(booking.id) === String(createdBookingId)
        );
        if (createdBooking) {
          openBookingInDrawer(createdBooking);
          setBookingCreatedModalOpen(true);
          return;
        }
      }
      setDrawerOpen(false);
      setFormError('');
      setNotes('');
      setNotesTouchedByUser(false);
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setParticipantPriceDraftById({});
      setEditingBookingId(null);
      setEditingBaseline(null);
    } catch (error: any) {
      applyBookingError(error, 'No se pudo crear la reserva.');
      reportUiError({ area: 'AgendaPlayground', action: 'createBooking' }, error);
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const handleChangeActiveClub = async (clubId: number) => {
    if (!Number.isInteger(clubId) || clubId <= 0) return;
    if (clubId === selectedClubIdState) {
      setClubMenuOpen(false);
      return;
    }
    setSelectedClubIdState(clubId);
    setClubMenuOpen(false);
    setActiveClubId(clubId);
    setDrawerOpen(false);
    setEditingBookingId(null);
    setEditingBaseline(null);
    setFormError('');
    await loadCourtsForActiveClub();
    await reloadSchedule();
  };

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (clubMenuRef.current && !clubMenuRef.current.contains(target)) {
        setClubMenuOpen(false);
      }
      if (recurringCourtsMenuRef.current && !recurringCourtsMenuRef.current.contains(target)) {
        setRecurringCourtsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, []);

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setClubMenuOpen(false);
        setRecurringCourtsMenuOpen(false);
        setCustomRecurrenceModalOpen(false);
        setRecurringOverlapModalOpen(false);
        setRecurringCreateConfirmOpen(false);
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen || paymentMode !== 'Ãšnico') return;
    if (!editingBookingId) {
      setSimplifiedOwnerAdded(false);
      setSimplifiedOwnerPaymentMethodDraft('');
      setSimplifiedEditingParticipantId(null);
      setSimplifiedEditPaymentMethodDraft('');
      setSimplifiedNewParticipantOpen(false);
      setSimplifiedNewParticipantName('');
      setSimplifiedNewParticipantContact('');
      closeSimplifiedPaymentModal();
    }
  }, [closeSimplifiedPaymentModal, drawerOpen, editingBookingId, paymentMode]);

  useEffect(() => {
    if (!drawerOpen || paymentMode !== 'Ãšnico' || !editingBookingId) return;
    const namedOwner = participants.find(
      (participant) => participant.isOwner && participant.name.trim().length > 0
    );
    if (!namedOwner) return;
    setSimplifiedOwnerAdded(true);
    setSimplifiedOwnerPaymentMethodDraft(String(namedOwner.paymentMethod || ''));
    setSimplifiedEditingParticipantId(null);
    setSimplifiedEditPaymentMethodDraft('');
    setSimplifiedNewParticipantOpen(false);
    setSimplifiedNewParticipantName('');
    setSimplifiedNewParticipantContact('');
    closeSimplifiedPaymentModal();
  }, [closeSimplifiedPaymentModal, drawerOpen, editingBookingId, participants, paymentMode]);

  useEffect(() => {
    if (!simplifiedEditingParticipantId) return;
    const stillExistsAndCharged = participants.some(
      (participant) => participant.id === simplifiedEditingParticipantId && chargedParticipantIdSet.has(participant.id)
    );
    if (stillExistsAndCharged && simplifiedOwnerAdded) return;
    setSimplifiedEditingParticipantId(null);
    setSimplifiedEditPaymentMethodDraft('');
  }, [chargedParticipantIdSet, participants, simplifiedEditingParticipantId, simplifiedOwnerAdded]);

  useEffect(() => {
    if (!simplifiedNewParticipantOpen) return;
    if (simplifiedOwnerAdded) return;
    setSimplifiedNewParticipantOpen(false);
    setSimplifiedNewParticipantName('');
    setSimplifiedNewParticipantContact('');
  }, [simplifiedNewParticipantOpen, simplifiedOwnerAdded]);

  useEffect(() => {
    if (drawerOpen && paymentMode === 'Ãšnico' && simplifiedOwnerAdded) return;
    closeSimplifiedPaymentModal();
  }, [closeSimplifiedPaymentModal, drawerOpen, paymentMode, simplifiedOwnerAdded]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenÃ©s permiso para acceder al panel de administraciÃ³n." />;
  const userInitial = String((user as any)?.firstName || (user as any)?.name || 'U')
    .trim()
    .charAt(0)
    .toUpperCase() || 'U';
  const sidebarWidthClass = isSidebarCollapsed ? 'w-[66px]' : 'w-[192px]';

  const selectedClubLabel =
    clubOptions.find((club) => club.id === selectedClubIdState)?.label ||
    clubOptions[0]?.label ||
    'Seleccionar club';
  const recurringCourtSelectionLabel =
    selectedRecurringCourts.length === 0
      ? 'Seleccionar canchas'
      : selectedRecurringCourts.map((court) => court.name).join(', ');
  const useSimplifiedBookingSidebar = paymentMode === 'Ãšnico';
  const simplifiedIsEditingReservation = useSimplifiedBookingSidebar && Boolean(editingBookingId);
  const simplifiedHeaderDateLabel = selectedDate
    .toLocaleDateString('es-AR', {
      weekday: 'short',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
    .replace(',', '');
  const simplifiedSummaryDateLabel = selectionStartDateTime.toLocaleDateString('es-AR', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const simplifiedSummaryTimeLabel = `${slotToTimeAmPm(selectedStartSlot)} - ${slotToTimeAmPm(selectedEndSlot)}`;
  const ownerParticipant = participants.find((participant) => participant.isOwner) || participants[0] || null;
  const ownerHasName = Boolean(ownerParticipant && ownerParticipant.name.trim().length > 0);
  const simplifiedSummaryOwnerLabel = ownerParticipant?.name.trim() || 'Titular sin asignar';
  const simplifiedSummaryCourtLabel = selectedCourt?.name || 'Cancha no definida';
  const simplifiedNamedParticipants = participants.filter((participant) => participant.name.trim().length > 0);
  const simplifiedEditingParticipant = simplifiedEditingParticipantId
    ? participants.find((participant) => participant.id === simplifiedEditingParticipantId) || null
    : null;
  const simplifiedEditingParticipantCanBeCharged = Boolean(
    simplifiedEditingParticipant && chargedParticipantIdSet.has(simplifiedEditingParticipant.id)
  );
  const hasValidSimplifiedOwnerPaymentMethod = isParticipantPaymentMethod(simplifiedOwnerPaymentMethodDraft);
  const hasValidSimplifiedEditPaymentMethod = isParticipantPaymentMethod(simplifiedEditPaymentMethodDraft);
  const hasValidSimplifiedNewParticipantName = simplifiedNewParticipantName.trim().length > 0;
  const ownerPaymentMethodOptions: Array<{ value: Participant['paymentMethod']; label: string }> = [
    { value: 'CASH', label: 'Efectivo' },
    { value: 'TRANSFER', label: 'Transferencia' },
    { value: 'CARD', label: 'Tarjeta' },
    { value: 'OTHER', label: 'Otro' },
  ];
  const simplifiedPayerCandidates = simplifiedNamedParticipants;
  const simplifiedResolvedPayerParticipantId = (() => {
    const draftSelection = String(simplifiedPaymentPayerParticipantIdDraft || '').trim();
    if (draftSelection && simplifiedPayerCandidates.some((participant) => participant.id === draftSelection)) {
      return draftSelection;
    }
    const draftResponsible = String(bookingDrawerState.draft?.billing.chargeResponsibleParticipantId || '').trim();
    if (draftResponsible && simplifiedPayerCandidates.some((participant) => participant.id === draftResponsible)) {
      return draftResponsible;
    }
    const ownerNamed = simplifiedPayerCandidates.find((participant) => participant.isOwner);
    return ownerNamed?.id || simplifiedPayerCandidates[0]?.id || '';
  })();
  const simplifiedResolvedPayerParticipant = participants.find(
    (participant) => participant.id === simplifiedResolvedPayerParticipantId
  ) || null;
  const simplifiedPaymentAmountParsed = Number(String(simplifiedPaymentAmountDraft || '').replace(',', '.'));
  const hasValidSimplifiedPaymentAmount =
    Number.isFinite(simplifiedPaymentAmountParsed) &&
    simplifiedPaymentAmountParsed > 0.009 &&
    simplifiedPaymentAmountParsed <= simplifiedRemainingAfterQueue + 0.009;
  const hasValidSimplifiedPaymentMethod = isParticipantPaymentMethod(simplifiedPaymentMethodDraft);
  const simplifiedCanRegisterPayment =
    Boolean(persistedEditingBookingId) &&
    !isPaymentLockedByManualPending &&
    simplifiedRemainingAfterQueue > 0.009;
  const simplifiedSectionTabs: Array<{ id: SimplifiedSidebarSection; label: string }> = [
    { id: 'DETAILS', label: 'Detalle' },
    { id: 'BILLING', label: 'Cobros y participantes' },
    { id: 'HISTORY', label: 'Historial' },
  ];
  const simplifiedReservationHistoryTimeline = (() => {
    const events: Array<{
      id: string;
      title: string;
      detail: string;
      dateKey: string;
      dateLabel: string;
      timeLabel: string;
      sortKey: number;
    }> = [];

    const sourceStart = String(bookingDrawerState.draft?.operational.startDateTime || '');
    const startDate = sourceStart ? new Date(sourceStart) : null;
    const hasValidStartDate = Boolean(startDate && Number.isFinite(startDate.getTime()));
    const reservationSortKey = hasValidStartDate ? (startDate as Date).getTime() : selectionStartDateTime.getTime();
    const reservationDate = hasValidStartDate ? (startDate as Date) : selectionStartDateTime;
    const toTimelineDateParts = (value: Date) => ({
      dateKey: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
      dateLabel: value.toLocaleDateString('es-AR', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      timeLabel: value.toLocaleTimeString('es-AR', {
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
    const formatTimelineDateTime = (value: unknown): string => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const parsed = new Date(raw);
      if (!Number.isFinite(parsed.getTime())) return raw;
      return `${parsed.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} ${parsed.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    };
    const formatBillingModeLabel = (mode: unknown): string => {
      const normalized = String(mode || '').trim().toUpperCase();
      if (normalized === 'INDIVIDUAL') return 'Pago Ãºnico';
      if (normalized === 'SHARED') return 'Pago dividido';
      return 'Sin definir';
    };
    const formatTimelineSourceLabel = (source: unknown): string => {
      const normalized = String(source || '').trim().toUpperCase();
      if (!normalized) return '';
      if (normalized === 'MANUAL') return 'Manual';
      if (normalized === 'SYSTEM') return 'Sistema';
      if (normalized === 'AUTOMATIC') return 'AutomÃ¡tico';
      if (normalized === 'API') return 'IntegraciÃ³n externa';
      if (normalized === 'POS') return 'Caja';
      if (normalized === 'MANAGER') return 'Administrador';
      return 'Sistema';
    };
    const formatTimelineChannelLabel = (channel: unknown): string => {
      const normalized = String(channel || '').trim().toUpperCase();
      if (!normalized) return '';
      if (normalized === 'CASH_DRAWER') return 'Caja';
      if (normalized === 'BANK_TRANSFER') return 'Transferencia';
      if (normalized === 'CARD_TERMINAL') return 'Terminal';
      if (normalized === 'ONLINE_GATEWAY') return 'Pasarela en lÃ­nea';
      return 'Canal interno';
    };
    const formatResponsibleRefLabel = (rawRef: unknown): string => {
      const ref = String(rawRef || '').trim();
      if (!ref) return 'Sin asignar';
      if (ref.startsWith('guest:owner') || ref.startsWith('guest:booking-responsible')) return 'Titular';
      if (ref.startsWith('booking-client:')) return 'Cliente de la reserva';
      if (ref.startsWith('booking-user:')) return 'Usuario vinculado';
      if (ref.startsWith('guest:')) return 'Invitado';
      return 'Referencia interna';
    };
    const domainEvents = Array.isArray(bookingTimelineEvents) ? bookingTimelineEvents : [];

    domainEvents.forEach((event, index) => {
      const payload =
        event.payload && typeof event.payload === 'object'
          ? event.payload
          : {};
      const normalizedType = String(event.type || '').trim().toUpperCase();
      const rawCreatedAt = String(event.createdAt || '');
      const createdAt = rawCreatedAt ? new Date(rawCreatedAt) : null;
      const hasValidDate = Boolean(createdAt && Number.isFinite(createdAt.getTime()));
      const eventDate = hasValidDate ? (createdAt as Date) : reservationDate;
      const dateParts = toTimelineDateParts(eventDate);

      let title = 'Evento de reserva';
      let detail = 'Evento registrado.';

      if (normalizedType === 'PAYMENT_RECEIVED') {
        const amount = Number((payload as any)?.amount || 0);
        const methodRaw = String((payload as any)?.method || '').trim();
        const sourceRaw = String((payload as any)?.source || '').trim();
        const channelRaw = String((payload as any)?.channel || '').trim();
        title = Number.isFinite(amount) && amount > 0.009
          ? `Pago recibido (${amount.toFixed(2)} $)`
          : 'Pago recibido';
        const detailParts = [
          methodRaw ? `MÃ©todo: ${formatPaymentMethodLabel(methodRaw)}` : '',
          sourceRaw ? `Origen: ${formatTimelineSourceLabel(sourceRaw)}` : '',
          channelRaw ? `Canal: ${formatTimelineChannelLabel(channelRaw)}` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Pago registrado.';
      } else if (normalizedType === 'BOOKING_CREATED') {
        const amount = Number((payload as any)?.amount || 0);
        const detailParts = [
          Number.isFinite(amount) && amount > 0.009 ? `Precio: ${amount.toFixed(2)} $` : '',
          'Origen: Administrador',
        ].filter(Boolean);
        title = 'Reserva creada';
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Reserva creada.';
      } else if (normalizedType === 'BOOKING_CANCELLED' || normalizedType === 'CANCELLED') {
        const source = formatTimelineSourceLabel((payload as any)?.source);
        title = 'Reserva cancelada';
        detail = source ? `Origen: ${source}` : 'Reserva cancelada.';
      } else if (normalizedType === 'BOOKING_RESCHEDULED') {
        const previousStart = formatTimelineDateTime((payload as any)?.previousStartDateTime);
        const nextStart = formatTimelineDateTime((payload as any)?.startDateTime);
        const previousCourtId = Number((payload as any)?.previousCourtId || 0);
        const courtId = Number((payload as any)?.courtId || 0);
        title = 'Reserva reprogramada';
        const detailParts = [
          previousStart ? `Desde: ${previousStart}` : '',
          nextStart ? `Hasta: ${nextStart}` : '',
          previousCourtId > 0 && courtId > 0 && previousCourtId !== courtId ? `Cancha ${previousCourtId} -> ${courtId}` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Reserva reprogramada.';
      } else if (normalizedType === 'BOOKING_CONFIRMED' || normalizedType === 'CONFIRMED') {
        const source = formatTimelineSourceLabel((payload as any)?.source);
        title = 'Reserva confirmada';
        detail = source ? `Origen: ${source}` : 'Reserva confirmada.';
      } else if (normalizedType === 'BOOKING_COMPLETED' || normalizedType === 'COMPLETED') {
        const source = formatTimelineSourceLabel((payload as any)?.source);
        title = 'Reserva finalizada';
        detail = source ? `Origen: ${source}` : 'Reserva finalizada.';
      } else if (normalizedType === 'BOOKING_PARTICIPANT_ADDED') {
        const count = Number((payload as any)?.addedParticipantsCount || 0);
        const participantRole = String((payload as any)?.participantRole || '').trim().toUpperCase();
        const source = String((payload as any)?.source || '').trim().toUpperCase();
        const isOwnerAssignment = participantRole === 'BOOKING_RESPONSIBLE' && source === 'BOOKING_CREATED';
        if (isOwnerAssignment) {
          title = 'Titular asignado';
          detail = 'Se asignÃ³ el titular durante la creaciÃ³n.';
        } else {
          title = count > 1 ? 'Participantes agregados' : 'Participante agregado';
          detail = count > 0 ? `${count} participante${count > 1 ? 's' : ''} agregado${count > 1 ? 's' : ''}.` : 'Participante agregado.';
        }
      } else if (normalizedType === 'BOOKING_PARTICIPANT_REMOVED') {
        const count = Number((payload as any)?.removedParticipantsCount || 0);
        title = count > 1 ? 'Participantes eliminados' : 'Participante eliminado';
        detail = count > 0 ? `${count} participante${count > 1 ? 's' : ''} eliminado${count > 1 ? 's' : ''}.` : 'Participante eliminado.';
      } else if (normalizedType === 'BOOKING_BILLING_CONFIG_UPDATED') {
        const previousChargeMode = formatBillingModeLabel((payload as any)?.previousChargeMode);
        const chargeMode = formatBillingModeLabel((payload as any)?.chargeMode);
        title = 'ConfiguraciÃ³n de cobro actualizada';
        const detailParts = [
          previousChargeMode !== chargeMode ? `Modo: ${previousChargeMode} -> ${chargeMode}` : `Modo: ${chargeMode}`,
        ];
        const previousResponsible = String((payload as any)?.previousChargeResponsibleRef || '').trim();
        const responsible = String((payload as any)?.chargeResponsibleRef || '').trim();
        if (previousResponsible || responsible) {
          const previousResponsibleLabel = formatResponsibleRefLabel(previousResponsible);
          const responsibleLabel = formatResponsibleRefLabel(responsible);
          detailParts.push(
            previousResponsibleLabel !== responsibleLabel
              ? `Responsable: ${previousResponsibleLabel} -> ${responsibleLabel}`
              : `Responsable: ${responsibleLabel}`
          );
        }
        detail = detailParts.join(' - ');
      } else if (normalizedType === 'BOOKING_NOTES_UPDATED') {
        const notes = String((payload as any)?.notes || '').trim();
        title = 'Notas actualizadas';
        detail = notes ? 'Se actualizaron las notas privadas.' : 'Se limpiaron las notas privadas.';
      } else {
        detail = 'Se registrÃ³ una actualizaciÃ³n.';
      }

      events.push({
        id: `domain-${event.id || `${normalizedType}-${index}`}`,
        title,
        detail,
        dateKey: dateParts.dateKey,
        dateLabel: dateParts.dateLabel,
        timeLabel: hasValidDate ? dateParts.timeLabel : '--',
        sortKey: hasValidDate ? eventDate.getTime() : reservationSortKey - (index + 1),
      });
    });

    events.sort((a, b) => b.sortKey - a.sortKey);

    const groups: Array<{
      dateKey: string;
      dateLabel: string;
      events: typeof events;
    }> = [];

    events.forEach((event) => {
      const previous = groups[groups.length - 1];
      if (!previous || previous.dateKey !== event.dateKey) {
        groups.push({
          dateKey: event.dateKey,
          dateLabel: event.dateLabel,
          events: [event],
        });
        return;
      }
      previous.events.push(event);
    });

    return groups;
  })();
  const showSimplifiedDetailsSection =
    !simplifiedIsEditingReservation || simplifiedSidebarSection === 'DETAILS';
  const showSimplifiedBillingSection =
    !simplifiedIsEditingReservation || simplifiedSidebarSection === 'BILLING';
  const showSimplifiedHistorySection =
    simplifiedIsEditingReservation && simplifiedSidebarSection === 'HISTORY';

  return (
    <>
      <Head>
        <title>Agenda de reservas | TuCancha Admin</title>
      </Head>
      <style jsx global>{`
        input[type='number']::-webkit-outer-spin-button,
        input[type='number']::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type='number'] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>

      <div className="h-screen w-full bg-[#f5f6f8] text-[#1a1a1a] overflow-hidden">
        <div className="h-full w-full flex flex-col">
          <header className="h-16 bg-white px-4 lg:px-6 flex items-center">
            <div className={`hidden lg:flex w-[192px] items-center gap-2 transition-[width] duration-200 ease-out overflow-hidden`}>
              <div className="h-8 w-8 rounded-lg border border-[#d9dfeb] bg-[#f5f7ff] grid place-items-center text-[11px] font-black text-[#2a2f5b]">
                TC
              </div>
              <span
                className={`text-[12px] font-black tracking-[0.22em] text-[#2a2f5b] whitespace-nowrap transition-[opacity,transform,max-width,filter] duration-200 ease-out ${
                  isSidebarCollapsed ? 'opacity-0 -translate-x-1 max-w-0 blur-[1px]' : 'opacity-100 translate-x-0 max-w-[140px] blur-0'
                }`}
              >
                TUCANCHA
              </span>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <div className="h-8 w-8 rounded-lg border border-[#d9dfeb] bg-[#f5f7ff] grid place-items-center text-[11px] font-black text-[#2a2f5b]">
                TC
              </div>
              <span className="text-[12px] font-black tracking-[0.22em] text-[#2a2f5b]">TUCANCHA</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="h-9 rounded-lg px-3 text-sm font-semibold text-[#4a5eaa] hover:bg-[#f3f6ff]"
              >
                Ayuda
              </button>
              <div ref={clubMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setClubMenuOpen((previous) => !previous)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setClubMenuOpen(true);
                    }
                  }}
                  aria-haspopup="menu"
                  aria-expanded={clubMenuOpen}
                  className={`h-9 min-w-[180px] rounded-lg border px-3 text-sm font-semibold inline-flex items-center justify-between gap-2 bg-white shadow-sm transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#dce6ff] focus-visible:ring-offset-0 ${
                    clubMenuOpen
                      ? 'border-[#bfc8da] ring-2 ring-[#ebf0ff] text-[#1f2a44]'
                      : 'border-[#dfe4ee] text-[#2a3348] hover:border-[#cfd7e6]'
                  }`}
                >
                  <span className="truncate">{selectedClubLabel}</span>
                  <ChevronDown size={14} className={`text-[#7a8398] transition-transform ${clubMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {clubMenuOpen && (
                  <div className="absolute right-0 mt-2 w-[240px] rounded-xl border border-[#dbe2ef] bg-white shadow-xl z-40 p-1">
                    {clubOptions.map((club) => {
                      const active = club.id === selectedClubIdState;
                      return (
                        <button
                          key={club.id}
                          type="button"
                          onClick={() => {
                            setClubMenuOpen(false);
                            void handleChangeActiveClub(club.id);
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-[13px] flex items-center justify-between transition ${
                            active
                              ? 'bg-[#edf1ff] text-[#2748cc] font-semibold'
                              : 'text-[#3a435b] hover:bg-[#f5f7fb]'
                          }`}
                        >
                          <span className="truncate">{club.label}</span>
                          {active && <span className="text-[11px] font-bold">Activo</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="h-9 w-9 rounded-full border border-[#e5e7eb] bg-white text-sm font-bold text-[#2a3348] grid place-items-center"
                title="Usuario actual"
              >
                {userInitial}
              </button>
              <button
                type="button"
                onClick={() => logout({ redirectTo: '/login' })}
                className="h-9 w-9 rounded-lg border border-[#e5e7eb] bg-white text-[#58627a] grid place-items-center hover:bg-[#f8f9fc]"
                title="Cerrar sesiÃ³n"
                aria-label="Cerrar sesiÃ³n"
              >
                <LogOut size={16} />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 bg-white">
          <aside
            className={`relative z-20 hidden lg:flex h-full ${sidebarWidthClass} bg-white flex-col items-center py-4 overflow-visible transition-[width,opacity] duration-200 ease-out will-change-[width] ${
              drawerOpen ? 'opacity-40 pointer-events-none select-none' : 'opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((previous) => !previous)}
              className={`absolute z-30 -right-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full border border-[#dfe4ec] bg-white text-[#6f7890] grid place-items-center shadow-sm hover:bg-[#f7f9fc] transition-transform duration-200 ${
                isSidebarAnimating ? 'scale-95' : 'scale-100'
              }`}
              title={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
              aria-label={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
            >
              <span className={`transition-transform duration-200 ${isSidebarCollapsed ? 'rotate-0' : 'rotate-0'}`}>
                {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </span>
            </button>
            <nav className="w-full px-2 space-y-1">
              {sidebarItems.map(({ label, icon: Icon, active }) => (
                <button
                  key={label}
                  type="button"
                  className={`w-full rounded-md py-2 text-[11px] transition-colors ${
                    active ? 'bg-[#eef1ff] text-[#2b3fa8]' : 'text-[#8b92a0] hover:bg-[#f4f5f7]'
                  } px-0 text-left`}
                  title={label}
                >
                  <span className="grid grid-cols-[48px_1fr] items-center">
                    <span className="inline-flex w-full shrink-0 justify-center">
                      <Icon size={14} />
                    </span>
                    <span
                      className={`truncate whitespace-nowrap transition-[opacity,transform,max-width,filter] duration-200 ease-out ${
                        isSidebarCollapsed ? 'opacity-0 -translate-x-1 max-w-0 blur-[1px]' : 'opacity-100 translate-x-0 max-w-[124px] blur-0'
                      }`}
                    >
                      {label}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <section ref={agendaSurfaceRef} className="relative flex-1 h-full min-w-0 rounded-tl-[12px] overflow-hidden bg-[#f5f6f8]">
            {calendarNotice && (
              <div className="pointer-events-none absolute right-5 top-5 z-40 max-w-[420px] rounded-xl border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2 text-[12px] font-semibold text-[#b42346] shadow-sm">
                {calendarNotice}
              </div>
            )}
            <div className="h-full min-w-0">
              <div className="h-full flex flex-col p-4 lg:p-6 gap-4">
                <div className="rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {availableSports.map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        onClick={() => setSportFilter(sport)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          sportFilter === sport
                            ? 'bg-[#1d2248] text-white shadow-sm'
                            : 'bg-[#f5f6f8] text-[#6b7280] hover:bg-[#edf0f4]'
                        }`}
                      >
                        {sport}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full max-w-[320px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b2]" />
                      <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Buscar en calendario"
                        className="h-9 w-full rounded-lg border border-[#e5e7eb] bg-[#fafbfc] pl-9 pr-3 text-sm outline-none focus:border-[#2f4fd8]"
                      />
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveDate(-1)}
                        className="h-9 w-9 rounded-lg border border-[#e5e7eb] grid place-items-center text-[#727b8d] hover:bg-[#f7f8fb]"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <div className="relative h-9 w-[170px]">
                        <button
                          type="button"
                          onClick={() => {
                            const input = quickDateInputRef.current;
                            if (!input) return;
                            if (isQuickDatePickerOpen) {
                              input.blur();
                              setIsQuickDatePickerOpen(false);
                              return;
                            }
                            const anyInput = input as HTMLInputElement & { showPicker?: () => void };
                            if (typeof anyInput.showPicker === 'function') {
                              setIsQuickDatePickerOpen(true);
                              anyInput.showPicker();
                            } else {
                              setIsQuickDatePickerOpen(true);
                              input.focus();
                              input.click();
                            }
                          }}
                          className="h-9 w-full px-3 rounded-lg border border-[#e5e7eb] text-sm font-medium text-[#232a3a] inline-flex items-center gap-2 bg-white hover:bg-[#f8f9fc]"
                        >
                        <CalendarDays size={14} className="text-[#7a8398]" />
                        <span className="truncate tabular-nums">
                          {selectedDate.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                        </span>
                        </button>
                        <input
                          ref={quickDateInputRef}
                          type="date"
                          value={formatLocalDate(selectedDate)}
                          onFocus={() => setIsQuickDatePickerOpen(true)}
                          onBlur={() => setIsQuickDatePickerOpen(false)}
                          onChange={(event) => {
                            const next = new Date(`${event.target.value}T12:00:00`);
                            if (!Number.isNaN(next.getTime())) {
                              setSelectedDate(next);
                              setFormError('');
                            }
                            setIsQuickDatePickerOpen(false);
                          }}
                          className="absolute inset-0 opacity-0 pointer-events-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => moveDate(1)}
                        className="h-9 w-9 rounded-lg border border-[#e5e7eb] grid place-items-center text-[#727b8d] hover:bg-[#f7f8fb]"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 rounded-2xl border border-[#e5e7eb] bg-white overflow-hidden">
                  <div className="h-full overflow-auto">
                    <div className="min-w-max p-4">
                      <div className="flex min-w-full">
                        <div className="w-[78px] shrink-0">
                          <div className="h-10 border-b border-[#eef1f3]" />
                          <div className="relative" style={{ height: gridHeight }}>
                            {Array.from({ length: totalSlots }).map((_, slot) => {
                              const showHourLabel = slot % slotsPerHour === 0;
                              return (
                                <div
                                  key={`time-${slot}`}
                                  className={`absolute left-0 right-0 ${
                                    (slot + 1) % slotsPerHour === 0 ? 'border-b border-[#edf0f2]' : ''
                                  }`}
                                  style={{ top: slot * slotHeight, height: slotHeight }}
                                >
                                  {showHourLabel && (
                                    <span className="absolute top-[4px] left-0 text-[11px] font-medium text-[#8b93a2]">
                                      {slotToTime(slot)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {nowLineTop != null && (
                              <div
                                className="pointer-events-none absolute right-[2px] -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-[#3a66e0] shadow-[0_0_0_2px_#ffffff]"
                                style={{ top: nowLineTop, zIndex: 25 }}
                              />
                            )}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-1">
                          {visibleCourts.map((court) => {
                            const courtBookings = visibleBookings.filter((booking) => booking.courtId === court.id);
                            return (
                              <div key={court.id} className="min-w-[132px] flex-1 border-l border-[#eef1f3] last:border-r">
                                <div className="h-10 border-b border-[#eef1f3] grid place-items-center text-xs font-semibold text-[#4b5563]">
                                  {court.name}
                                </div>
                                <div className="relative select-none" style={{ height: gridHeight }}>
                                  {Array.from({ length: totalSlots }).map((_, slot) => (
                                    <div
                                      key={`${court.id}-slot-${slot}`}
                                      role="button"
                                      tabIndex={-1}
                                      onMouseDown={(event) => handleSlotMouseDown(event, court.id, slot)}
                                      onMouseEnter={() => handleSlotMouseEnter(court.id, slot)}
                                      className={`transition ${
                                        draggingBookingId
                                          ? 'bg-white'
                                          : isDragging
                                            ? 'bg-white'
                                            : 'bg-white hover:bg-[#f8faff]'
                                      }`}
                                      style={{
                                        height: slotHeight,
                                        borderBottom: (slot + 1) % slotsPerHour === 0 ? '1px solid #eef1f3' : 'none',
                                      }}
                                    />
                                  ))}
                                  {nowLineTop != null && (
                                    <div
                                      className="pointer-events-none absolute left-0 right-0 border-t border-[#3a66e0]"
                                      style={{ top: nowLineTop, zIndex: 24 }}
                                    />
                                  )}

                                  {(() => {
                                    const hasDragSelection = dragSelection && dragSelection.courtId === court.id;
                                    const hasDrawerSelection =
                                      drawerOpen &&
                                      !editingBookingId &&
                                      selectedCourtId === court.id &&
                                      selectedEndSlot > selectedStartSlot;
                                    if (!hasDragSelection && !hasDrawerSelection) return null;

                                    const range = hasDragSelection
                                      ? toSelectionRange(dragSelection as DraftSelection)
                                      : { start: selectedStartSlot, end: selectedEndSlot };
                                    const top = range.start * slotHeight + 2;
                                    const height = (range.end - range.start) * slotHeight - 4;
                                    const durationMinutes = (range.end - range.start) * slotMinutes;
                                    const visibility = blockContentVisibility(height);
                                    return (
                                      <div
                                        className={`pointer-events-none absolute left-1 right-1 rounded-lg border border-[#2f4fd8] bg-[#2f4fd81a] overflow-hidden ${
                                          visibility.showDurationOnly
                                            ? 'px-1 py-0.5 flex items-center'
                                            : 'p-2'
                                        }`}
                                        style={{ top, height }}
                                      >
                                        <p className="text-[10px] font-bold leading-none text-[#1d2a66]">{durationMinutes} min</p>
                                        {!visibility.showDurationOnly && visibility.showTimeRange && (
                                          <p className="text-[10px] text-[#1d2a66]/80">
                                            {slotToTime(range.start)} - {slotToTime(range.end)}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {bookingDropPreview && draggingBookingMeta && bookingDropPreview.courtId === court.id && (
                                    (() => {
                                      const top = bookingDropPreview.startSlot * slotHeight + 2;
                                      const height = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotHeight - 4;
                                      const durationMinutes = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotMinutes;
                                      const visibility = blockContentVisibility(height);
                                      const isDropConflicted = bookingDropHasConflict;
                                      return (
                                        <div
                                        className={`pointer-events-none absolute z-20 left-1 right-1 rounded-lg text-[10px] shadow-sm overflow-hidden ${
                                          visibility.showDurationOnly
                                              ? 'px-2 flex items-center'
                                              : 'px-2 py-1.5 leading-tight'
                                          } ${isDropConflicted ? 'border border-[#d13d57] bg-[#ffe8ee] text-[#8b1f3a]' : bookingColor(draggingBookingMeta.state)}`}
                                          style={{ top, height, opacity: isDropConflicted ? 0.9 : 1 }}
                                        >
                                          {visibility.showDurationOnly ? (
                                            <p className="w-full truncate text-[11px] font-semibold leading-tight">
                                              {isDropConflicted ? 'SuperposiciÃ³n' : draggingBookingMeta.title}
                                            </p>
                                          ) : (
                                            <>
                                              {visibility.showBadge && (
                                                <div className="mb-0.5 flex flex-wrap gap-1">
                                                  {draggingBookingMeta.isRecurring && (
                                                    <Repeat size={12} className="text-black" />
                                                  )}
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingBadgeColor(draggingBookingMeta.state)}`}>
                                                    {bookingStatusLabel(draggingBookingMeta.state)}
                                                  </div>
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingPaymentBadgeColor(draggingBookingMeta.paymentState)}`}>
                                                    {bookingPaymentLabel(draggingBookingMeta.paymentState)}
                                                  </div>
                                                </div>
                                              )}
                                              {visibility.showTitle && (
                                                <p className="font-semibold truncate">{draggingBookingMeta.title}</p>
                                              )}
                                              {isDropConflicted && visibility.showTimeRange && (
                                                <p className="font-semibold text-[#b42346]">SuperposiciÃ³n</p>
                                              )}
                                              {visibility.showTimeRange && (
                                                <p className="opacity-70">
                                                  {slotToTime(bookingDropPreview.startSlot)} - {slotToTime(bookingDropPreview.endSlot)}
                                                </p>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      );
                                    })()
                                  )}

                                  {courtBookings.map((booking) => {
                                    if (draggingBookingId === booking.id) return null;
                                    const top = booking.startSlot * slotHeight + 2;
                                    const height = (booking.endSlot - booking.startSlot) * slotHeight - 4;
                                    const durationMinutes = (booking.endSlot - booking.startSlot) * slotMinutes;
                                    const visibility = blockContentVisibility(height);
                                    const isHovered = bookingHoverPreview?.booking?.id === booking.id;
                                    return (
                                      <div
                                        key={booking.id}
                                        onMouseDown={(event) => handleBookingMouseDown(event, booking)}
                                        onMouseEnter={(event) => {
                                          if (draggingBookingMetaRef.current || isDragging) return;
                                          const next = resolveBookingHoverPosition(
                                            event.clientX,
                                            event.clientY,
                                            resolveHoverParticipantsForBooking(booking).length
                                          );
                                          setBookingHoverPreview({ booking, ...next });
                                        }}
                                        onMouseMove={(event) => {
                                          if (draggingBookingMetaRef.current || isDragging) return;
                                          const next = resolveBookingHoverPosition(
                                            event.clientX,
                                            event.clientY,
                                            resolveHoverParticipantsForBooking(booking).length
                                          );
                                          setBookingHoverPreview((current) => {
                                            if (!current || current.booking.id !== booking.id) {
                                              return { booking, ...next };
                                            }
                                            return { ...current, ...next };
                                          });
                                        }}
                                        onMouseLeave={() =>
                                          setBookingHoverPreview((current) =>
                                            current?.booking?.id === booking.id ? null : current
                                          )
                                        }
                                        className={`absolute left-1 right-1 rounded-lg text-[10px] shadow-sm overflow-visible ${
                                          visibility.showDurationOnly
                                            ? 'px-2 flex items-center'
                                            : 'px-2 py-1.5 leading-tight'
                                        } ${bookingColor(booking.state)}`}
                                        style={{ top, height, cursor: draggingBookingId ? 'grabbing' : 'grab', zIndex: isHovered ? 26 : 12 }}
                                      >
                                        <div className={`h-full rounded-lg overflow-hidden ${visibility.showDurationOnly ? 'flex items-center' : ''}`}>
                                          {visibility.showDurationOnly ? (
                                            <p className="w-full truncate text-[11px] font-semibold leading-none">{booking.title}</p>
                                          ) : (
                                            <>
                                              {visibility.showBadge && (
                                                <div className="mb-0.5 flex flex-wrap gap-1">
                                                  {booking.isRecurring && (
                                                    <Repeat size={12} className="text-black" />
                                                  )}
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingBadgeColor(booking.state)}`}>
                                                    {bookingStatusLabel(booking.state)}
                                                  </div>
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingPaymentBadgeColor(booking.paymentState)}`}>
                                                    {bookingPaymentLabel(booking.paymentState)}
                                                  </div>
                                                </div>
                                              )}
                                              {visibility.showTitle && <p className="font-semibold truncate">{booking.title}</p>}
                                              {visibility.showTimeRange && (
                                                <p className="opacity-70">{slotToTime(booking.startSlot)} - {slotToTime(booking.endSlot)}</p>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {bookingHoverPreview && !draggingBookingId && !draggingBookingMeta && !isDragging && (
              <div
                className="pointer-events-none fixed z-40 hidden w-[240px] rounded-xl border border-[#e3e8f2] bg-white shadow-xl text-[#1f2738] lg:block"
                style={{ left: bookingHoverPreview.x, top: bookingHoverPreview.y }}
              >
                <div className="px-3 py-2 border-b border-[#eef1f5] text-[12px] font-bold">
                  Reserva
                </div>
                <div className="px-2 py-1.5">
                  {resolveHoverParticipantsForBooking(bookingHoverPreview.booking).map((participant) => (
                    <div key={participant.id} className="grid grid-cols-[16px_1fr_auto] items-center gap-2 px-1 py-1">
                      <div className="h-4 w-4 rounded-full bg-[#e8edf7] text-[9px] font-bold text-[#41507a] grid place-items-center">
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold">{participant.name}</p>
                        <p className="text-[10px] text-[#7b8396]">{participant.isOwner ? 'Responsable' : 'Jugador'}</p>
                      </div>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                          participant.payable === false
                            ? 'bg-[#f2f4f8] text-[#6b7285]'
                            : participant.paid
                              ? 'bg-[#e8f8ed] text-[#1c7a44]'
                              : 'bg-[#eef1f7] text-[#5c667f]'
                        }`}
                      >
                        {participant.payable === false ? 'Sin cargo' : participant.paid ? 'Pagado' : 'Pendiente'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {customRecurrenceModalOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setCustomRecurrenceModalOpen(false)}
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
                    <h3 className="text-[25px] font-bold tracking-[-0.01em] text-[#222a3d]">Custom recurrence</h3>
                    <button
                      type="button"
                      onClick={() => setCustomRecurrenceModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <p className="text-[13px] text-[#727b90] mb-2">Days</p>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const weekdays = [1, 2, 3, 4, 5];
                          const weekends = [6, 0];
                          const weekdaysActive = weekdays.every((day) => customRecurrenceDays.includes(day));
                          const weekendsActive = weekends.every((day) => customRecurrenceDays.includes(day));
                          return (
                            <>
                        <button
                          type="button"
                          onClick={() =>
                            setCustomRecurrenceDays((previous) => {
                              const set = new Set(previous);
                              const weekdays = [1, 2, 3, 4, 5];
                              const hasAllWeekdays = weekdays.every((day) => set.has(day));
                              if (hasAllWeekdays) {
                                weekdays.forEach((day) => set.delete(day));
                              } else {
                                weekdays.forEach((day) => set.add(day));
                              }
                              return Array.from(set);
                            })
                          }
                          className={`h-9 rounded-xl border px-3 text-[13px] font-semibold ${
                            weekdaysActive
                              ? 'border-[#3a63e0] bg-[#3a63e0] text-white'
                              : 'border-[#cdd6ea] bg-white text-[#3f4c6a] hover:bg-[#f5f7ff]'
                          }`}
                        >
                          DÃ­as hÃ¡biles
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCustomRecurrenceDays((previous) => {
                              const set = new Set(previous);
                              const weekends = [6, 0];
                              const hasAllWeekends = weekends.every((day) => set.has(day));
                              if (hasAllWeekends) {
                                weekends.forEach((day) => set.delete(day));
                              } else {
                                weekends.forEach((day) => set.add(day));
                              }
                              return Array.from(set);
                            })
                          }
                          className={`h-9 rounded-xl border px-3 text-[13px] font-semibold ${
                            weekendsActive
                              ? 'border-[#3a63e0] bg-[#3a63e0] text-white'
                              : 'border-[#cdd6ea] bg-white text-[#3f4c6a] hover:bg-[#f5f7ff]'
                          }`}
                        >
                          Fines de semana
                        </button>
                            </>
                          );
                        })()}
                        {CUSTOM_DAY_OPTIONS.map((day) => {
                          const active = customRecurrenceDays.includes(day.value);
                          return (
                            <button
                              key={`custom-day-${day.value}`}
                              type="button"
                              onClick={() => {
                                setCustomRecurrenceDays((previous) => {
                                  if (previous.includes(day.value)) {
                                    if (previous.length === 1) return previous;
                                    return previous.filter((value) => value !== day.value);
                                  }
                                  return [...previous, day.value];
                                });
                              }}
                              className={`h-9 min-w-[44px] rounded-xl border px-3 text-[13px] font-semibold ${
                                active
                                  ? 'border-[#3a63e0] bg-[#3a63e0] text-white'
                                  : 'border-[#cdd6ea] bg-white text-[#3f4c6a] hover:bg-[#f5f7ff]'
                              }`}
                            >
                              {day.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[13px] text-[#727b90]">Repetir cada N semanas</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={customRepeatEveryWeeks}
                        onChange={(event) => setCustomRepeatEveryWeeks(Math.max(1, Number(event.target.value || 1)))}
                        className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                      />
                    </label>
                    <div className="block">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!customEndAfterEnabled) {
                              setCustomEndAfterEnabled(true);
                              setCustomEndAfterExpanded(true);
                              return;
                            }
                            setCustomEndAfterExpanded((previous) => !previous);
                          }}
                          className={`text-left ${customEndAfterEnabled ? '' : 'text-[#2f4fd8] font-semibold hover:underline'}`}
                        >
                          <span className={`text-[13px] ${customEndAfterEnabled ? 'text-[#727b90]' : 'text-[#2f4fd8]'}`}>
                            {customEndAfterEnabled
                              ? `Finalizar luego de ${customEndAfterReservations} reservas`
                              : 'Finalizar luego de N reservas'}
                          </span>
                        </button>
                        {customEndAfterEnabled && (
                          <button
                            type="button"
                            onClick={() => {
                              setCustomEndAfterEnabled(false);
                              setCustomEndAfterExpanded(false);
                            }}
                            className="text-[12px] font-semibold text-[#de5a76] hover:underline shrink-0"
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                      {customEndAfterEnabled && customEndAfterExpanded && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={customEndAfterReservations}
                            onChange={(event) => setCustomEndAfterReservations(Math.max(1, Number(event.target.value || 1)))}
                            className="h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                          />
                        </div>
                      )}
                    </div>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const days = Array.from(new Set(customRecurrenceDays));
                          if (days.length === 0) {
                            setFormError('SeleccionÃ¡ al menos un dÃ­a para la recurrencia personalizada.');
                            return;
                          }
                          setCustomRecurrenceDays(days);
                          setRecurringFrequencyPreset('custom');
                          setRecurringEveryDays(Math.max(1, customRepeatEveryWeeks) * 7);
                          if (customEndAfterEnabled) {
                            setRecurringRepetitions(Math.max(1, customEndAfterReservations));
                          }
                          setRecurringDayOfWeek(days[0]);
                          setRecurringResult(null);
                          setFormError('');
                          setCustomRecurrenceModalOpen(false);
                        }}
                        className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {recurringCreateConfirmOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => {
                  setRecurringCreateConfirmOpen(false);
                  setRecurringCreateConfirmed(false);
                }}
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#222a3d]">Confirmar creaciÃ³n de serie</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setRecurringCreateConfirmOpen(false);
                        setRecurringCreateConfirmed(false);
                      }}
                      className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div className="rounded-xl border border-[#dce7ff] bg-[#f4f7ff] px-3 py-2 text-[13px] text-[#2f4fd8]">
                      Se crearÃ¡n todas las ocurrencias vÃ¡lidas de la serie.
                    </div>
                    <div className="rounded-xl border border-[#f0e3d1] bg-[#fff8ef] px-3 py-2 text-[13px] text-[#8a622f]">
                      Si alguna fecha se superpone, se omitirÃ¡ automÃ¡ticamente. Nunca se reemplaza una reserva existente.
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRecurringCreateConfirmOpen(false);
                          setRecurringCreateConfirmed(false);
                        }}
                        className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
                      >
                        Cancelarar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRecurringCreateConfirmOpen(false);
                          setRecurringCreateConfirmed(true);
                          void handleCreateBooking();
                        }}
                        className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                      >
                        Crear serie
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {recurringOverlapModalOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setRecurringOverlapModalOpen(false)}
              >
                <div
                  className="w-full max-w-[680px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#222a3d]">Serie con superposiciones</h3>
                    <button
                      type="button"
                      onClick={() => setRecurringOverlapModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div className="rounded-xl border border-[#dce7ff] bg-[#f4f7ff] px-3 py-2 text-[13px] text-[#2f4fd8]">
                      Se creÃ³ la serie solo en ocurrencias vÃ¡lidas. Las que se superponen fueron omitidas automÃ¡ticamente.
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                        <span>Creadas</span>
                        <strong>{recurringResult?.generatedCount ?? 0}</strong>
                      </div>
                      <div className="rounded-lg bg-[#fff4f6] px-3 py-2 text-xs text-[#8f2f46] flex justify-between">
                        <span>Omitidas por superposiciÃ³n</span>
                        <strong>{recurringResult?.skippedCount ?? recurringOverlapItems.length}</strong>
                      </div>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-[#4e5870] mb-2">
                        Detalle ({recurringOverlapItems.length})
                      </p>
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-[#e3e8f2] bg-white divide-y divide-[#eef1f6]">
                        {recurringOverlapItems.map((item, index) => (
                          <div key={`overlap-item-${index}`} className="px-3 py-2">
                            <p className="text-[13px] font-semibold text-[#27314b]">{item.courtName}</p>
                            <p className="text-[12px] text-[#68738e]">
                              Solicitada: {item.requestedDateLabel} Â· {item.requestedTimeLabel}
                            </p>
                            {(item.conflictingDateLabel || item.conflictingTimeLabel) && (
                              <p className="text-[11px] text-[#8a93a7]">
                                Ocupada: {item.conflictingDateLabel || item.requestedDateLabel}
                                {item.conflictingTimeLabel ? ` Â· ${item.conflictingTimeLabel}` : ''}
                              </p>
                            )}
                            {(item.clientName || item.activityName) && (
                              <p className="text-[11px] text-[#8a93a7]">
                                En conflicto con: {[item.clientName, item.activityName].filter(Boolean).join(' Â· ')}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setRecurringOverlapModalOpen(false)}
                        className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                      >
                        Entendido
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {deleteBookingConfirmOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setDeleteBookingConfirmOpen(false)}
              >
                <div
                  className="w-full max-w-[520px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#222a3d]">Cancelarar reserva</h3>
                    <button
                      type="button"
                      onClick={() => setDeleteBookingConfirmOpen(false)}
                      className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-[#4b556d]">
                      Esta acciÃ³n cancelarÃ¡ la reserva seleccionada. PodrÃ¡s verla como cancelada en el historial.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteBookingConfirmOpen(false)}
                        className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteBookingConfirmOpen(false);
                          void handleDeleteBooking();
                        }}
                        className="h-10 rounded-xl bg-[#cf3f57] px-5 text-white text-sm font-bold hover:bg-[#b8354b]"
                      >
                        SÃ­, cancelar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {deleteParticipantConfirm.open && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })}
              >
                <div
                  className="w-full max-w-[500px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#222a3d]">Eliminar participante</h3>
                    <button
                      type="button"
                      onClick={() => setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })}
                      className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-[#4b556d]">
                      Â¿QuerÃ©s eliminar a <strong>{deleteParticipantConfirm.participantName}</strong> de esta reserva?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })}
                        className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const participantId = deleteParticipantConfirm.participantId;
                          if (participantId) {
                            removeParticipant(participantId);
                          }
                          setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' });
                        }}
                        className="h-10 rounded-xl bg-[#cf3f57] px-5 text-white text-sm font-bold hover:bg-[#b8354b]"
                      >
                        SÃ­, eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {blockingErrorModalOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setBlockingErrorModalOpen(false)}
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-[#efc8d2] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#f4dce3]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#b42346]">No se puede continuar</h3>
                    <button
                      type="button"
                      onClick={() => setBlockingErrorModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-[#eac7d0] grid place-items-center text-[#b65a70] hover:bg-[#fff6f8]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-[#5b4550]">
                      CorregÃ­ primero la fecha/cancha/horario para poder seguir con pagos y participantes.
                    </p>
                    <div className="rounded-lg border border-[#f1c5d0] bg-[#fff4f7] px-3 py-2">
                      <p className="text-[13px] font-semibold text-[#b42346]">{blockingActionMessage}</p>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setBlockingErrorModalOpen(false)}
                        className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                      >
                        Entendido
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {bookingCreatedModalOpen && (
              <div
                className="fixed inset-0 z-50 bg-[#11162a]/35 flex items-center justify-center p-4"
                onClick={() => setBookingCreatedModalOpen(false)}
              >
                <div
                  className="w-full max-w-[520px] rounded-2xl border border-[#d8e5ff] bg-white shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8efff]">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-[#22408f]">Reserva creada</h3>
                    <button
                      type="button"
                      onClick={() => setBookingCreatedModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-[#dbe2ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-[#4a5674]">
                      La reserva se creÃ³ correctamente y quedÃ³ abierta para ediciÃ³n.
                    </p>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setBookingCreatedModalOpen(false)}
                        className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                      >
                        Entendido
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {drawerOpen && (
              <button
                type="button"
                aria-label="Cerrar panel"
                className="absolute inset-0 z-20 bg-[#101326]/20"
                onClick={() => setDrawerOpen(false)}
              />
            )}

            <aside
              className={`absolute inset-y-0 right-0 z-30 w-full max-w-[620px] border-l border-[#e6e8ee] bg-white transition-transform duration-300 ${
                drawerOpen ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              <div className="relative h-full w-full flex flex-col">
                {isWaitingQueuedPaymentConfirmation && (
                  <div className="absolute inset-0 z-50 bg-white/65 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="rounded-2xl border border-[#dbe2ef] bg-white px-5 py-4 shadow-xl text-center">
                      <div className="mx-auto h-8 w-8 rounded-full border-2 border-[#b9c6f4] border-t-[#3053e2] animate-spin" />
                      <p className="mt-3 text-[14px] font-semibold text-[#2a3245]">
                        Confirmando pago...
                      </p>
                      <p className="mt-1 text-[12px] text-[#6f7890]">
                        Esperando confirmaciÃ³n del sistema.
                      </p>
                    </div>
                  </div>
                )}
                <header className="border-b border-[#eef0f5] px-6 py-5 flex items-start justify-between">
                  <div>
                    <h2 className="text-[24px] leading-none font-semibold text-[#1f2638] tracking-[-0.015em]">
                      {useSimplifiedBookingSidebar
                        ? editingBookingId
                          ? 'Editar reserva'
                          : `Crear reserva para ${simplifiedHeaderDateLabel}`
                        : editingBookingId
                          ? bookingKind === 'block'
                            ? 'Editar bloqueo'
                            : 'Editar reserva'
                          : bookingKind === 'block'
                            ? 'Crear bloqueo'
                            : 'Crear reserva'}
                    </h2>
                    {!useSimplifiedBookingSidebar && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 relative">
                      <button
                        type="button"
                        onClick={() => setBookingKindMenuOpen((previous) => !previous)}
                        className="h-8 rounded-full border border-[#dbe2ff] bg-[#eef2ff] px-3 text-[13px] font-medium text-[#3155df] inline-flex items-center gap-1.5"
                      >
                        <selectedBookingKind.icon size={13} />
                        {selectedBookingKind.label}
                        <ChevronDown size={14} />
                      </button>
                      {bookingKindMenuOpen && (
                        <div className="absolute top-10 left-0 z-40 w-[420px] rounded-2xl border border-[#dfe4f1] bg-white p-2 shadow-xl">
                          {bookingKindOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setBookingKind(option.value);
                                setBookingKindMenuOpen(false);
                              }}
                              className={`w-full text-left rounded-xl px-3 py-3 transition ${
                                option.value === bookingKind ? 'bg-[#eef0ff]' : 'hover:bg-[#f6f7fb]'
                              }`}
                            >
                              <span className="flex items-start gap-2">
                                <option.icon size={17} className="mt-[1px] text-[#44527b]" />
                                <span>
                                  <span className="block text-[19px] font-bold leading-none text-[#2a3245]">{option.label}</span>
                                  <span className="block mt-1 text-[12px] leading-snug text-[#7d879d]">{option.description}</span>
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <label className="h-8 min-w-[124px] rounded-full border border-[#e2e6ef] bg-[#f8f9fc] px-3 text-[13px] font-medium text-[#3e4555] inline-flex items-center gap-1.5">
                        <input
                          type="date"
                          value={formatLocalDate(selectedDate)}
                          onChange={(event) => {
                            const next = new Date(`${event.target.value}T12:00:00`);
                            if (!Number.isNaN(next.getTime())) {
                              setSelectedDate(next);
                              setFormError('');
                            }
                          }}
                          className="bg-transparent outline-none"
                        />
                        <ChevronDown size={14} />
                      </label>
                      {bookingKind !== 'block' && (
                        <>
                          {bookingKind !== 'recurring' && (
                            <PlaygroundCombo
                              value={selectedCourtId}
                              onChange={(next) => {
                                setSelectedCourtId(next);
                                setScheduleInputsDirty(true);
                                setFormError('');
                              }}
                              options={effectiveCourts.map((court) => ({ value: court.id, label: court.name }))}
                              compact
                              className="min-w-[124px]"
                            />
                          )}
                          <PlaygroundCombo
                            value={slotToTime(selectedStartSlot)}
                            onChange={(nextValue) => {
                              const nextStart = timeToSlot(nextValue);
                              setSelectedStartSlot(nextStart);
                              if (nextStart >= selectedEndSlot) {
                                setSelectedEndSlot(nextStart + 1);
                              }
                              setScheduleInputsDirty(true);
                              setFormError('');
                            }}
                            options={timeOptions.slice(0, -1).map((option) => ({ value: option.value, label: option.value }))}
                            compact
                            className="min-w-[92px]"
                          />
                          <PlaygroundCombo
                            value={slotToTime(selectedEndSlot)}
                            onChange={(nextValue) => {
                              const nextEnd = Math.max(timeToSlot(nextValue), selectedStartSlot + 1);
                              setSelectedEndSlot(nextEnd);
                              setScheduleInputsDirty(true);
                              setFormError('');
                            }}
                            options={timeOptions.slice(1).map((option) => ({ value: option.value, label: option.value }))}
                            compact
                            className="min-w-[92px]"
                          />
                        </>
                      )}
                    </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setEditingBookingId(null);
                      setEditingBaseline(null);
                    }}
                    className="h-9 w-9 rounded-full border border-[#e4e7ee] text-[#798194] grid place-items-center hover:bg-[#f7f8fb] shrink-0"
                  >
                    <X size={16} />
                  </button>
                </header>

                {useSimplifiedBookingSidebar && simplifiedIsEditingReservation && (
                  <div className="border-b border-[#eef0f5] px-6">
                    <nav className="flex items-center gap-6 overflow-x-auto">
                      {simplifiedSectionTabs.map((tab) => {
                        const isActive = simplifiedSidebarSection === tab.id;
                        return (
                          <button
                            key={`simplified-tab-${tab.id}`}
                            type="button"
                            onClick={() => setSimplifiedSidebarSection(tab.id)}
                            className={`h-12 border-b-2 text-[13px] font-semibold uppercase tracking-[0.02em] whitespace-nowrap transition ${
                              isActive
                                ? 'border-[#3155df] text-[#3155df]'
                                : 'border-transparent text-[#6f7890] hover:text-[#3f4760]'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                )}

                <div ref={drawerScrollContainerRef} className="flex-1 overflow-y-auto px-6 py-6">
                  {useSimplifiedBookingSidebar ? (
                    <section className="rounded-2xl border border-[#dce2ee] bg-white px-4 py-4">
                      {showSimplifiedDetailsSection && (simplifiedIsEditingReservation ? (
                        <>
                          <div className="rounded-xl border border-[#e3e7f2] bg-[#f7f9fd] p-4">
                            <div className="flex items-center justify-between">
                              <p className="text-[16px] font-semibold text-[#1f2638]">Reserva del usuario</p>
                              <span className="text-[14px] font-medium text-[#8b93a6]">Bloqueada</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
                              <div>
                                <p className="text-[12px] text-[#7d869b]">Titular</p>
                                <p className="mt-0.5 text-[15px] font-medium text-[#273149]">{simplifiedSummaryOwnerLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-[#7d869b]">Fecha</p>
                                <p className="mt-0.5 text-[15px] font-medium text-[#273149]">{simplifiedSummaryDateLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-[#7d869b]">Origen</p>
                                <p className="mt-0.5 text-[15px] font-medium text-[#273149]">Administrador</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-[#7d869b]">Horario</p>
                                <p className="mt-0.5 text-[15px] font-medium text-[#273149]">{simplifiedSummaryTimeLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-[#7d869b]">Cancha</p>
                                <p className="mt-0.5 text-[15px] font-medium text-[#273149]">{simplifiedSummaryCourtLabel}</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 max-w-[260px]">
                            <p className="text-[12px] font-medium text-[#7a8398]">Precio</p>
                            <div className="mt-1 h-12 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between">
                              <input
                                type="number"
                                readOnly
                                value={isFinancialDisplayPending ? '' : Number(totalPrice.toFixed(2))}
                                className="w-full bg-transparent text-[18px] font-semibold text-[#2a3245] outline-none"
                              />
                              <span className="ml-2 text-[18px] font-semibold text-[#8a92a5]">$</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-xl border border-[#dce2ee] bg-[#f3f5ff] px-3 py-2.5 flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-[16px] font-medium text-[#4b5fa8]">
                              <Clock3 size={16} />
                              <span>Reserva regular</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                showCalendarNotice('Por ahora este panel funciona en reserva regular.');
                              }}
                              className="text-[16px] text-[#4b5fa8] underline underline-offset-2 hover:text-[#3d4f91]"
                            >
                              Cambiar tipo
                            </button>
                          </div>
                          {dateFieldError && (
                            <p className="mt-2 text-[12px] font-medium text-[#b42346]">{dateFieldError}</p>
                          )}

                          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="block">
                              <span className="text-[12px] font-medium text-[#7a8398]">Hora de inicio</span>
                              <PlaygroundCombo
                                value={slotToTime(selectedStartSlot)}
                                onChange={(nextValue) => {
                                  const nextStart = timeToSlot(nextValue);
                                  setSelectedStartSlot(nextStart);
                                  if (nextStart >= selectedEndSlot) {
                                    setSelectedEndSlot(nextStart + 1);
                                  }
                                  setScheduleInputsDirty(true);
                                  setFormError('');
                                }}
                                options={timeOptions.slice(0, -1).map((option) => ({
                                  value: option.value,
                                  label: slotToTimeAmPm(option.slot),
                                }))}
                                className="mt-1"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[12px] font-medium text-[#7a8398]">Hora de fin</span>
                              <PlaygroundCombo
                                value={slotToTime(selectedEndSlot)}
                                onChange={(nextValue) => {
                                  const nextEnd = Math.max(timeToSlot(nextValue), selectedStartSlot + 1);
                                  setSelectedEndSlot(nextEnd);
                                  setScheduleInputsDirty(true);
                                  setFormError('');
                                }}
                                options={timeOptions.slice(1).map((option) => ({
                                  value: option.value,
                                  label: slotToTimeAmPm(option.slot),
                                }))}
                                className="mt-1"
                              />
                            </label>
                            {timeFieldError && (
                              <div className="md:col-span-2">
                                <p className="text-[12px] font-medium text-[#b42346]">{timeFieldError}</p>
                              </div>
                            )}
                            <label className="block">
                              <span className="text-[12px] font-medium text-[#7a8398]">Cancha</span>
                              <PlaygroundCombo
                                value={selectedCourtId}
                                onChange={(next) => {
                                  setSelectedCourtId(next);
                                  setScheduleInputsDirty(true);
                                  setFormError('');
                                }}
                                options={effectiveCourts.map((court) => ({ value: court.id, label: court.name }))}
                                className="mt-1"
                              />
                              {courtFieldError && (
                                <p className="mt-1 text-[12px] font-medium text-[#b42346]">{courtFieldError}</p>
                              )}
                            </label>
                            <label className="block">
                              <span className="text-[12px] font-medium text-[#7a8398]">Profesor</span>
                              <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center gap-2">
                                <input
                                  value={coachSearchTerm}
                                  onChange={(event) => setProfesorSearchTerm(event.target.value)}
                                  placeholder="Buscar profesor"
                                  className="w-full bg-transparent text-[16px] text-[#2a3245] outline-none"
                                />
                                <Search size={18} className="text-[#8f96a8]" />
                              </div>
                            </label>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
                            <div>
                              <p className="text-[12px] font-medium text-[#7a8398]">Tipo de pago</p>
                              <div className="mt-1 grid grid-cols-2 rounded-xl border border-[#dce2ee] bg-[#f7f8fc] p-1">
                                <button
                                  type="button"
                                  onClick={() => setPaymentMode('Único')}
                                  className="h-11 rounded-lg bg-[#3053e2] text-[15px] font-semibold text-white"
                                >
                                  Pago único
                                </button>
                                <button
                                  type="button"
                                  title="Próximamente"
                                  disabled
                                  className="h-11 rounded-lg text-[15px] font-semibold text-[#8e95a7] cursor-not-allowed"
                                >
                                  Pago dividido
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-[12px] font-medium text-[#7a8398]">
                                {paymentMode === 'Único' ? 'Precio' : 'Precio por persona'}
                              </p>
                              <div className="mt-1 h-12 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between">
                                <input
                                  type="number"
                                  readOnly
                                  value={isFinancialDisplayPending
                                    ? ''
                                    : paymentMode === 'Ãšnico'
                                      ? Number(totalPrice.toFixed(2))
                                      : Number((totalPrice / Math.max(chargedParticipantsCount, 1)).toFixed(2))}
                                  className="w-full bg-transparent text-[18px] font-semibold text-[#2a3245] outline-none"
                                />
                                <span className="ml-2 text-[18px] font-semibold text-[#8a92a5]">$</span>
                              </div>
                              {paymentFieldError && (
                                <p className="mt-1 text-[12px] font-medium text-[#b42346]">{paymentFieldError}</p>
                              )}
                            </div>
                          </div>
                        </>
                      ))}

                      {showSimplifiedHistorySection && (
                        <section className="mt-5 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-4">
                          <div className="px-1">
                            <p className="text-[16px] font-semibold text-[#27314a]">Historial de la reserva</p>
                          </div>

                          {bookingTimelineLoading && simplifiedReservationHistoryTimeline.length > 0 && (
                            <p className="mt-4 px-1 text-[12px] text-[#6f7890]">Actualizando historial...</p>
                          )}
                          {bookingTimelineError && (
                            <p className="mt-4 px-1 text-[13px] text-[#a04747]">{bookingTimelineError}</p>
                          )}

                          {bookingTimelineLoading && simplifiedReservationHistoryTimeline.length === 0 ? (
                            <div className="mt-5 flex items-center justify-center gap-3 rounded-xl border border-[#dde4f3] bg-white px-4 py-5">
                              <div className="h-5 w-5 rounded-full border-2 border-[#b9c6f4] border-t-[#3053e2] animate-spin" />
                              <p className="text-[13px] text-[#5f6880]">Cargando historial de la reserva...</p>
                            </div>
                          ) : simplifiedReservationHistoryTimeline.length === 0 ? (
                            <p className="mt-4 px-1 text-[13px] text-[#6f7890]">TodavÃ­a no hay eventos en el historial.</p>
                          ) : (
                            <div className="mt-4 space-y-5">
                              {simplifiedReservationHistoryTimeline.map((group) => (
                                <div key={`history-group-${group.dateKey}`}>
                                  <div className="inline-flex rounded-full border border-[#dde4f3] bg-white px-3 py-1 text-[12px] font-semibold text-[#3c4660]">
                                    {group.dateLabel}
                                  </div>
                                  <div className="mt-3 space-y-0">
                                    {group.events.map((event, index) => (
                                      <div
                                        key={`history-event-${event.id}`}
                                        className="grid grid-cols-[18px_1fr_auto] gap-3"
                                      >
                                        <div className="relative pt-1">
                                          <span className="absolute left-[4px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#4c68e6]" />
                                          {index < group.events.length - 1 && (
                                            <span className="absolute left-[8px] top-4 bottom-[-12px] w-px bg-[#d5dff8]" />
                                          )}
                                        </div>
                                        <div className="pb-3">
                                          <p className="text-[15px] font-semibold leading-[1.3] text-[#1f2638]">
                                            {event.title}
                                          </p>
                                          <p className="mt-0.5 text-[13px] text-[#6d7690]">{event.detail}</p>
                                        </div>
                                        <p className="pt-0.5 text-[13px] font-semibold text-[#5c6580]">
                                          {event.timeLabel}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      )}

                      {showSimplifiedBillingSection && (
                      <>
                      <section className="mt-5 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[14px] font-semibold text-[#27314a]">Pagos</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              simplifiedPaymentStatusLabel === 'Pagado'
                                ? 'bg-[#e8f8ec] text-[#16733f]'
                                : simplifiedPaymentStatusLabel === 'Parcial'
                                  ? 'bg-[#fff4e5] text-[#9a5a00]'
                                  : 'bg-[#eef1f7] text-[#5c667f]'
                            }`}
                          >
                            {simplifiedPaymentStatusLabel}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[#6f7890]">
                          <div className="rounded-lg bg-white px-2 py-1.5">
                            <p>Total</p>
                            <p className="text-[13px] font-semibold text-[#2a3245]">
                              {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5">
                            <p>Pagado</p>
                            <p className="text-[13px] font-semibold text-[#16733f]">
                              {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5">
                            <p>Deuda</p>
                            <p className="text-[13px] font-semibold text-[#9a5a00]">
                              {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={openSimplifiedPaymentModal}
                            disabled={!simplifiedCanRegisterPayment}
                            className="h-10 rounded-xl bg-[#3053e2] px-4 text-[14px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-50"
                          >
                            Registrar pago
                          </button>
                          {!persistedEditingBookingId ? (
                            <p className="text-[12px] text-[#7c8598]">Primero creÃ¡ la reserva.</p>
                          ) : isPaymentLockedByManualPending ? (
                            <p className="text-[12px] text-[#7c8598]">ConfirmÃ¡ la reserva para habilitar pagos.</p>
                          ) : simplifiedRemainingAmount <= 0.009 ? (
                            <p className="text-[12px] text-[#1c7a44]">No hay deuda pendiente.</p>
                          ) : null}
                        </div>
                      </section>

                      <section className="mt-6">
                        <p className="text-[17px] font-semibold text-[#1f2638]">Participantes</p>
                        <div className="mt-3 rounded-xl border border-[#e9edf5] bg-white p-4">
                          {participantsFieldError && (
                            <p className="mb-3 text-[12px] font-medium text-[#b42346]">{participantsFieldError}</p>
                          )}
                          {simplifiedOwnerAdded && simplifiedNamedParticipants.length > 0 ? (
                            <div className="space-y-2">
                              {simplifiedNamedParticipants.map((participant, index) => {
                                const contactValue = String(participant.contact || '').trim();
                                const emailValue = contactValue.includes('@') ? contactValue : 'Sin correo';
                                const phoneValue = contactValue && !contactValue.includes('@')
                                  ? contactValue
                                  : 'Sin telÃ©fono';
                                const participantHasCharge = chargedParticipantIdSet.has(participant.id);
                                return (
                                  <div key={`simplified-participant-${participant.id}`} className="border-b border-[#edf1f7] py-3 last:border-b-0">
                                    <div className={`grid ${participantHasCharge ? 'grid-cols-[42px_1fr_auto_auto_auto]' : 'grid-cols-[42px_1fr_auto]'} gap-2 items-start`}>
                                      <div className="h-10 w-10 rounded-full bg-[#e9edf8] text-[#4a5674] text-[14px] font-semibold grid place-items-center">
                                        {participant.name.trim().charAt(0).toUpperCase() || 'P'}
                                      </div>
                                      <div>
                                        <p className="text-[16px] font-semibold text-[#1f2638]">{participant.name}</p>
                                        <p className="text-[13px] text-[#5f6880]">{phoneValue}</p>
                                        <p className="text-[13px] text-[#5f6880]">{emailValue}</p>
                                      </div>
                                      {participantHasCharge && (
                                        <div className="pt-0.5 text-right">
                                          <p className="text-[16px] font-semibold text-[#1f2638]">
                                            {Number(resolveParticipantPrice(participant).toFixed(2))} $
                                          </p>
                                          <p className="mt-1 text-[14px] text-[#2f364b]">{simplifiedPaymentStatusLabel}</p>
                                        </div>
                                      )}
                                      {participantHasCharge && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSimplifiedEditingParticipantId(participant.id);
                                            setSimplifiedEditPaymentMethodDraft(
                                              isParticipantPaymentMethod(participant.paymentMethod)
                                                ? participant.paymentMethod
                                                : ''
                                            );
                                          }}
                                          className="h-8 w-8 rounded-full text-[#737c90] grid place-items-center hover:bg-[#f3f5fa]"
                                          title="Editar participante"
                                        >
                                          <Pencil size={14} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          showCalendarNotice('Acciones de participante prÃ³ximamente.');
                                        }}
                                        className="h-8 w-8 rounded-full text-[#737c90] grid place-items-center hover:bg-[#f3f5fa]"
                                        title="Acciones del participante"
                                      >
                                        <MoreVertical size={15} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <>
                              <p className="text-[16px] font-semibold text-[#2a3245]">Agregar titular</p>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-medium text-[#79829a]">
                                <span>Nombre del cliente</span>
                                <span>Pago</span>
                              </div>
                              <div className="mt-2 grid grid-cols-[1fr_1fr] gap-3">
                                <div className="h-12 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center gap-2">
                                  <input
                                    value={ownerParticipant?.name || ''}
                                    onChange={(event) => {
                                      if (!ownerParticipant) return;
                                      updateParticipant(ownerParticipant.id, {
                                        name: event.target.value,
                                        sourceType: 'guest',
                                        entityRef: undefined,
                                      });
                                    }}
                                    placeholder="IngresÃ¡ un nombre"
                                    className="w-full bg-transparent text-[15px] text-[#2a3245] outline-none"
                                  />
                                  {ownerHasName ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!ownerParticipant) return;
                                        updateParticipant(ownerParticipant.id, {
                                          name: '',
                                          contact: '',
                                          sourceType: 'guest',
                                          entityRef: undefined,
                                        });
                                        setSimplifiedOwnerAdded(false);
                                        setSimplifiedOwnerPaymentMethodDraft('');
                                        setSimplifiedEditingParticipantId(null);
                                        setSimplifiedEditPaymentMethodDraft('');
                                        setSimplifiedNewParticipantOpen(false);
                                        setSimplifiedNewParticipantName('');
                                        setSimplifiedNewParticipantContact('');
                                      }}
                                      className="h-7 w-7 rounded-full text-[#737c90] grid place-items-center hover:bg-[#f3f5fa]"
                                      title="Limpiar titular"
                                    >
                                      <X size={14} />
                                    </button>
                                  ) : (
                                    <Search size={18} className="text-[#8f96a8]" />
                                  )}
                                </div>
                                <div className="h-12 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center">
                                  <select
                                    value={simplifiedOwnerPaymentMethodDraft}
                                    onChange={(event) => {
                                      const nextValue = String(event.target.value || '');
                                      setSimplifiedOwnerPaymentMethodDraft(nextValue);
                                      if (!ownerParticipant) return;
                                      if (isParticipantPaymentMethod(nextValue)) {
                                        updateParticipant(ownerParticipant.id, {
                                          paymentMethod: nextValue,
                                        });
                                      }
                                      setFormError('');
                                    }}
                                    className="w-full bg-transparent text-[15px] text-[#2a3245] outline-none"
                                  >
                                    <option value="">Seleccionar mÃ©todo de pago</option>
                                    {ownerPaymentMethodOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {ownerFieldError && (
                                <p className="mt-2 text-[12px] font-medium text-[#b42346]">{ownerFieldError}</p>
                              )}
                              {paymentFieldError && (
                                <p className="mt-1 text-[12px] font-medium text-[#b42346]">{paymentFieldError}</p>
                              )}

                              <div className="mt-4 rounded-xl bg-[#f3f4f7] px-4 py-3 flex items-center justify-between">
                                <p className="text-[15px] text-[#2a3245]">
                                  Precio total:{' '}
                                  <strong>{isFinancialDisplayPending ? '--' : `${Number(totalPrice.toFixed(2))} $`}</strong>
                                </p>
                                <CircleAlert size={16} className="text-[#747d93]" />
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  if (!ownerHasName || !hasValidSimplifiedOwnerPaymentMethod) return;
                                  if (ownerParticipant && isParticipantPaymentMethod(simplifiedOwnerPaymentMethodDraft)) {
                                    updateParticipant(ownerParticipant.id, {
                                      paymentMethod: simplifiedOwnerPaymentMethodDraft,
                                    });
                                  }
                                  setSimplifiedOwnerAdded(true);
                                  setSimplifiedEditingParticipantId(null);
                                  setSimplifiedEditPaymentMethodDraft('');
                                  setSimplifiedNewParticipantOpen(false);
                                  setSimplifiedNewParticipantName('');
                                  setSimplifiedNewParticipantContact('');
                                  setFormError('');
                                }}
                                disabled={!ownerHasName || !hasValidSimplifiedOwnerPaymentMethod}
                                className={`mt-5 h-11 w-full rounded-xl text-[15px] leading-none font-semibold transition ${
                                  ownerHasName && hasValidSimplifiedOwnerPaymentMethod
                                    ? 'bg-[#3053e2] text-white hover:bg-[#2748cc]'
                                    : 'border border-[#e2e6ef] bg-[#eef0f5] text-[#a0a7b9]'
                                }`}
                              >
                                Agregar titular
                              </button>
                            </>
                          )}

                          {simplifiedOwnerAdded && simplifiedEditingParticipantCanBeCharged && simplifiedEditingParticipant && (
                            <div className="mt-4 border-t border-[#e9edf5] pt-4">
                              <p className="text-[14px] font-semibold text-[#1f2638]">
                                {simplifiedEditingParticipant.name} {'>'} Editar
                              </p>
                              <label className="mt-3 block">
                                <span className="text-[13px] text-[#79829a]">Pago</span>
                                <div className="mt-1 h-12 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center">
                                  <select
                                    value={simplifiedEditPaymentMethodDraft}
                                    onChange={(event) => setSimplifiedEditPaymentMethodDraft(String(event.target.value || ''))}
                                    className="w-full bg-transparent text-[16px] text-[#2a3245] outline-none"
                                  >
                                    <option value="">Seleccionar mÃ©todo de pago</option>
                                    {ownerPaymentMethodOptions.map((option) => (
                                      <option key={`edit-payment-${option.value}`} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </label>
                              <div className="mt-4 flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!hasValidSimplifiedEditPaymentMethod) {
                                      return;
                                    }
                                    updateParticipant(simplifiedEditingParticipant.id, {
                                      paymentMethod: simplifiedEditPaymentMethodDraft,
                                    });
                                    setSimplifiedEditingParticipantId(null);
                                    setSimplifiedEditPaymentMethodDraft('');
                                    setFormError('');
                                  }}
                                  disabled={!hasValidSimplifiedEditPaymentMethod}
                                  className={`h-11 min-w-[110px] rounded-xl px-5 text-[15px] font-semibold ${
                                    hasValidSimplifiedEditPaymentMethod
                                      ? 'bg-[#3053e2] text-white hover:bg-[#2748cc]'
                                      : 'bg-[#eef0f5] text-[#a0a7b9]'
                                  }`}
                                >
                                  Actualizar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSimplifiedEditingParticipantId(null);
                                    setSimplifiedEditPaymentMethodDraft('');
                                  }}
                                  className="text-[15px] font-medium text-[#3f57b0] hover:text-[#2f4fd8]"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}

                          {simplifiedOwnerAdded && !simplifiedEditingParticipantCanBeCharged && (
                            <>
                              {!simplifiedNewParticipantOpen && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSimplifiedNewParticipantOpen(true);
                                    setSimplifiedNewParticipantName('');
                                    setSimplifiedNewParticipantContact('');
                                    setFormError('');
                                  }}
                                  className="mt-3 text-[15px] font-medium text-[#3f57b0] hover:text-[#2f4fd8]"
                                >
                                  + Nuevo participante
                                </button>
                              )}

                              {simplifiedNewParticipantOpen && (
                                <div className="mt-4 rounded-xl border border-[#e2e6ef] bg-white p-3">
                                  <p className="text-[14px] font-semibold text-[#1f2638]">Nuevo participante</p>
                                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <input
                                      value={simplifiedNewParticipantName}
                                      onChange={(event) => setSimplifiedNewParticipantName(event.target.value)}
                                      placeholder="Nombre del participante"
                                      className="h-11 rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                                    />
                                    <input
                                      value={simplifiedNewParticipantContact}
                                      onChange={(event) => setSimplifiedNewParticipantContact(event.target.value)}
                                      placeholder="Contacto (correo o telÃ©fono)"
                                      className="h-11 rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                                    />
                                  </div>
                                  <div className="mt-3 flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!hasValidSimplifiedNewParticipantName) return;
                                        setParticipants((previous) => [
                                          ...previous,
                                          {
                                            id: `player-${Date.now()}`,
                                            name: simplifiedNewParticipantName.trim(),
                                            contact: simplifiedNewParticipantContact.trim(),
                                            paid: false,
                                            isOwner: false,
                                            sourceType: 'guest',
                                            paymentMethod: 'CASH',
                                            entityRef: `guest:${toSlugToken(simplifiedNewParticipantName)}`,
                                            customPrice: null,
                                          },
                                        ]);
                                        setSimplifiedNewParticipantOpen(false);
                                        setSimplifiedNewParticipantName('');
                                        setSimplifiedNewParticipantContact('');
                                        setFormError('');
                                      }}
                                      disabled={!hasValidSimplifiedNewParticipantName}
                                      className={`h-10 min-w-[100px] rounded-xl px-4 text-[14px] font-semibold ${
                                        hasValidSimplifiedNewParticipantName
                                          ? 'bg-[#3053e2] text-white hover:bg-[#2748cc]'
                                          : 'bg-[#eef0f5] text-[#a0a7b9]'
                                      }`}
                                    >
                                      Agregar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSimplifiedNewParticipantOpen(false);
                                        setSimplifiedNewParticipantName('');
                                        setSimplifiedNewParticipantContact('');
                                      }}
                                      className="text-[14px] font-medium text-[#3f57b0] hover:text-[#2f4fd8]"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </section>

                      <section className="mt-6">
                        <p className="text-[17px] font-semibold text-[#1f2638]">Notas</p>
                        <div className="mt-3 rounded-xl border border-[#e9edf5] bg-white p-4">
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Notas privadas</span>
                            <textarea
                              value={notes}
                              onChange={(event) => handleNotesChange(event.target.value)}
                              placeholder="Las notas privadas son visibles solo para administradores del club"
                              rows={3}
                              className="mt-2 w-full rounded-xl border border-[#dce2ee] bg-white px-3 py-2 text-[15px] resize-none"
                            />
                          </label>
                          {notesFieldError && (
                            <p className="mt-1 text-[12px] font-medium text-[#b42346]">{notesFieldError}</p>
                          )}
                        </div>
                      </section>
                      </>
                      )}
                    </section>
                  ) : (
                    <>
                  <section className="mb-6 rounded-xl border border-[#dce2ee] bg-[#f8fafd] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-semibold text-[#1f2a44]">Checklist operativo</p>
                      <span className="text-[11px] text-[#6d7690]">
                        {operationalChecklist.filter((row) => row.ok).length}/{operationalChecklist.length}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {operationalChecklist.map((row) => (
                        <div key={row.key} className="rounded-lg border border-[#e4e9f4] bg-white px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] text-[#2a3245]">{row.label}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                row.ok ? 'bg-[#e9f8ec] text-[#16733f]' : 'bg-[#fff2f5] text-[#b42346]'
                              }`}
                            >
                              {row.ok ? 'OK' : 'Revisar'}
                            </span>
                          </div>
                          {!row.ok && row.detail && (
                            <p className="mt-1 text-[11px] text-[#8b4b58]">{row.detail}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="mb-6 rounded-xl border border-[#dce2ee] bg-white px-4 py-3">
                    <p className="text-[14px] font-semibold text-[#1f2a44]">Resumen rÃ¡pido</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[#f7f9fd] px-2.5 py-2">
                        <p className="text-[11px] text-[#79829a]">Tipo</p>
                        <p className="text-[12px] font-semibold text-[#2a3245]">{selectedBookingKindLabel}</p>
                      </div>
                      <div className="rounded-lg bg-[#f7f9fd] px-2.5 py-2">
                        <p className="text-[11px] text-[#79829a]">Fecha</p>
                        <p className="text-[12px] font-semibold text-[#2a3245]">{quickSummaryDateLabel}</p>
                      </div>
                      <div className="rounded-lg bg-[#f7f9fd] px-2.5 py-2">
                        <p className="text-[11px] text-[#79829a]">Horario</p>
                        <p className="text-[12px] font-semibold text-[#2a3245]">
                          {slotToTime(selectedStartSlot)} - {slotToTime(selectedEndSlot)} ({selectionMinutes} min)
                        </p>
                      </div>
                      <div className="rounded-lg bg-[#f7f9fd] px-2.5 py-2">
                        <p className="text-[11px] text-[#79829a]">
                          {bookingKind === 'recurring' ? 'Canchas' : 'Cancha'}
                        </p>
                        <p className="text-[12px] font-semibold text-[#2a3245] truncate">{quickSummaryCourtsLabel}</p>
                      </div>
                    </div>
                  </section>
                  {bookingKind === 'block' ? (
                    <>
                      <section className="pb-6 border-b border-[#edf0f5]">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">TÃ­tulo (opcional)</span>
                            <input
                              value={blockingTitle}
                              onChange={(event) => setBlockingTitle(event.target.value)}
                              placeholder="Mantenimiento"
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Cancha</span>
                            <PlaygroundCombo
                              value={selectedCourtId}
                              onChange={(next) => {
                                setSelectedCourtId(next);
                                setScheduleInputsDirty(true);
                              }}
                              options={effectiveCourts.map((court) => ({ value: court.id, label: court.name }))}
                              className="mt-2"
                            />
                          </label>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Fecha</span>
                            <input
                              type="date"
                              value={formatLocalDate(selectedDate)}
                              onChange={(event) => {
                                const next = new Date(`${event.target.value}T12:00:00`);
                                if (!Number.isNaN(next.getTime())) {
                                  setSelectedDate(next);
                                }
                              }}
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px]"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Hora de inicio</span>
                            <PlaygroundCombo
                              value={slotToTime(selectedStartSlot)}
                              onChange={(nextValue) => {
                                const nextStart = timeToSlot(nextValue);
                                setSelectedStartSlot(nextStart);
                                if (nextStart >= selectedEndSlot) {
                                  setSelectedEndSlot(nextStart + 1);
                                }
                                setScheduleInputsDirty(true);
                              }}
                              options={timeOptions.slice(0, -1).map((option) => ({ value: option.value, label: option.value }))}
                              className="mt-2"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Hora de fin</span>
                            <PlaygroundCombo
                              value={slotToTime(selectedEndSlot)}
                              onChange={(nextValue) => {
                                const nextEnd = Math.max(timeToSlot(nextValue), selectedStartSlot + 1);
                                setSelectedEndSlot(nextEnd);
                                setScheduleInputsDirty(true);
                              }}
                              options={timeOptions.slice(1).map((option) => ({ value: option.value, label: option.value }))}
                              className="mt-2"
                            />
                          </label>
                        </div>
                      </section>

                      <section className="pt-6">
                        <p className="text-[19px] font-semibold tracking-[-0.01em] text-[#1f2638]">Notas</p>
                        <label className="block mt-2">
                          <span className="text-[13px] text-[#7c8598]">Notas privadas (opcional)</span>
                          <textarea
                            value={notes}
                            onChange={(event) => handleNotesChange(event.target.value)}
                            placeholder="Solo visible para administradores del club"
                            rows={4}
                            className="mt-2 w-full rounded-xl border border-[#dbe2ef] bg-white px-3 py-2 text-sm resize-none"
                          />
                        </label>
                      </section>
                    </>
                  ) : (
                    <>
                  {bookingKind === 'recurring' && (
                    <section className="pb-6 border-b border-[#edf0f5]">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-[#1f2638]">Serie recurrente</p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] text-[#727b90]">Canchas para la serie</p>
                        </div>
                        <div ref={recurringCourtsMenuRef} className="relative mt-2">
                          <button
                            type="button"
                            onClick={() => setRecurringCourtsMenuOpen((previous) => !previous)}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setRecurringCourtsMenuOpen(true);
                              }
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={recurringCourtsMenuOpen}
                            className={`h-12 w-full rounded-xl border px-3 text-left text-[15px] inline-flex items-center justify-between gap-2 bg-white transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#dce6ff] focus-visible:ring-offset-0 ${
                              recurringCourtsMenuOpen
                                ? 'border-[#c8ceda] ring-2 ring-[#eef2ff] text-[#1f2a44]'
                                : 'border-[#d9dee8] text-[#2a3348] hover:border-[#c9d1de]'
                            }`}
                          >
                            <span className="truncate">{recurringCourtSelectionLabel || 'Seleccionar canchas'}</span>
                            <ChevronDown
                              size={15}
                              className={`text-[#7a8398] transition-transform ${recurringCourtsMenuOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {recurringCourtsMenuOpen && (
                            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-[#dbe2ef] bg-white shadow-xl z-40 overflow-hidden">
                              <label className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[15px] text-[#2e3650] transition ${recurringAllCourtsSelected ? 'bg-[#edf1ff]' : 'hover:bg-[#f5f7fb]'}`}>
                                <input
                                  type="checkbox"
                                  className="peer sr-only"
                                  checked={recurringAllCourtsSelected}
                                  onChange={(event) => {
                                    setRecurringCourtIds(event.target.checked ? effectiveCourts.map((court) => court.id) : []);
                                    setRecurringResult(null);
                                    setFormError('');
                                  }}
                                />
                                <span className="grid h-7 w-7 place-items-center rounded-[10px] border border-[#c9d0de] bg-white text-[16px] leading-none text-[#2f53df] peer-checked:border-[#8ca2ff] peer-checked:bg-[#eef2ff]">
                                  {recurringAllCourtsSelected ? 'âœ“' : ''}
                                </span>
                                <span className="font-medium">Todas las canchas</span>
                              </label>
                              <div className="h-px bg-[#edf1f7]" />
                              <div className="max-h-56 overflow-y-auto">
                                {effectiveCourts.map((court) => {
                                  const checked = recurringCourtIds.includes(court.id);
                                  return (
                                    <label
                                      key={`recurring-court-${court.id}`}
                                      className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[15px] text-[#2e3650] transition ${checked ? 'bg-[#edf1ff]' : 'hover:bg-[#f5f7fb]'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="peer sr-only"
                                        checked={checked}
                                        onChange={(event) => {
                                          setRecurringCourtIds((previous) => {
                                            if (event.target.checked) {
                                              if (previous.includes(court.id)) return previous;
                                              return [...previous, court.id];
                                            }
                                            return previous.filter((id) => id !== court.id);
                                          });
                                          setRecurringResult(null);
                                          setFormError('');
                                        }}
                                      />
                                      <span className="grid h-7 w-7 place-items-center rounded-[10px] border border-[#c9d0de] bg-white text-[16px] leading-none text-[#2f53df] peer-checked:border-[#8ca2ff] peer-checked:bg-[#eef2ff]">
                                        {checked ? 'âœ“' : ''}
                                      </span>
                                      <span className="truncate font-medium">{court.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-[13px] text-[#727b90]">DÃ­a de repeticiÃ³n</span>
                          <PlaygroundCombo
                            value={String(recurringDayOfWeek)}
                            onChange={(nextValue) => {
                              setRecurringDayOfWeek(Number(nextValue));
                              setRecurringResult(null);
                              setFormError('');
                            }}
                            options={WEEKDAY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                            className="mt-2"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[13px] text-[#727b90]">Frecuencia</span>
                          <PlaygroundCombo
                            value={recurringFrequencyPreset}
                            onChange={(nextValue) => {
                              const nextPreset = nextValue as RecurringFrequencyPreset;
                              setRecurringFrequencyPreset(nextPreset);
                              if (nextPreset === 'weekly') {
                                setRecurringEveryDays(7);
                              } else if (nextPreset === 'biweekly') {
                                setRecurringEveryDays(14);
                              } else if (nextPreset === 'custom') {
                                setCustomRepeatEveryWeeks(Math.max(1, Math.floor(recurringEveryDays / 7) || 1));
                                setCustomEndAfterReservations(Math.max(1, recurringRepetitions));
                                setCustomEndAfterEnabled(true);
                                setCustomRecurrenceDays((previous) => (previous.length > 0 ? previous : [recurringDayOfWeek]));
                                setCustomRecurrenceModalOpen(true);
                              }
                              setRecurringResult(null);
                              setFormError('');
                            }}
                            options={[
                              { value: 'weekly', label: 'Semanal' },
                              { value: 'biweekly', label: '2 semanas' },
                              { value: 'custom', label: 'Personalizado' },
                            ]}
                            className="mt-2"
                          />
                        </label>
                      </div>
                      {recurringFrequencyPreset === 'custom' && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="col-span-2 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-3">
                            <p className="text-[12px] text-[#677188]">
                              DÃ­as: {customRecurrenceDays.length > 0 ? customRecurrenceDays.map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label || day).join(', ') : 'Sin selecciÃ³n'}
                            </p>
                            <p className="mt-1 text-[12px] text-[#677188]">
                              Cada {customRepeatEveryWeeks} semana(s)
                              {customEndAfterEnabled ? ` Â· Finaliza tras ${customEndAfterReservations} reservas` : ' Â· Sin lÃ­mite manual de reservas'}
                            </p>
                            <button
                              type="button"
                              onClick={() => setCustomRecurrenceModalOpen(true)}
                              className="mt-2 h-9 rounded-lg border border-[#d3daf0] bg-white px-3 text-[12px] font-semibold text-[#2f4fd8] hover:bg-[#f4f7ff]"
                            >
                              Configurar recurrencia personalizada
                            </button>
                          </div>
                        </div>
                      )}
                      {recurringFrequencyPreset === 'custom' && (
                        <div className="mt-3 rounded-xl border border-[#d9e1ff] bg-[#eef2ff] px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Repeat size={14} className="text-[#3053e2]" />
                              <p className="text-[13px] font-semibold text-[#2f4fd8]">
                                {customEndAfterEnabled
                                  ? `Finaliza luego de ${customEndAfterReservations} reservas`
                                  : 'Sin lÃ­mite manual de reservas'}
                              </p>
                          </div>
                          <p className="mt-1 text-[12px] text-[#5c6da8]">
                            {customRecurrenceDaysSummary}, Repite cada {customRepeatEveryWeeks} semana{customRepeatEveryWeeks > 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                      <div className="mt-3">
                        <div className="rounded-xl border border-[#dce2ee] bg-[#f7f8fc] px-3 py-2">
                          <p className="text-[13px] text-[#727b90]">Primera ocurrencia</p>
                          <p className="mt-1 text-[15px] font-semibold text-[#2c3448]">
                            {recurringFirstOccurrence.toLocaleDateString('es-AR', {
                              weekday: 'long',
                              day: '2-digit',
                              month: 'short',
                            })}
                          </p>
                          <p className="text-[12px] text-[#6f7890]">
                            {slotToTime(selectedStartSlot)} - {slotToTime(selectedEndSlot)}
                          </p>
                        </div>
                      </div>
                      {recurringResult && (
                        <div className="mt-3 rounded-xl border border-[#dce7ff] bg-[#f4f7ff] px-3 py-2 text-[12px] text-[#2f4fd8]">
                          Serie creada en <strong>{recurringResult.courtsCount}</strong> canchas: <strong>{recurringResult.generatedCount}</strong> turnos generados
                          {recurringResult.skippedCount > 0 ? (
                            <> Â· <strong>{recurringResult.skippedCount}</strong> omitidos por superposiciÃ³n</>
                          ) : null}
                        </div>
                      )}
                    </section>
                  )}

                  <fieldset
                    disabled={lockBookingDetails}
                    className={lockBookingDetails ? 'pointer-events-none opacity-60 select-none' : ''}
                  >
                  <section className="pb-6 border-b border-[#edf0f5]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-[#1f2638]">Cobro</p>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${reservationStatusTone}`}>
                          {reservationStatusLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${paymentStatusTone}`}>
                          {paymentStatusLabel}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] text-[#6f7890]">
                      ConfigurÃ¡ la asignaciÃ³n de cobro y registrÃ¡ pagos desde este bloque.
                    </p>
                    {shouldHideBillingUntilConfirmed ? (
                      <div className="mt-3 rounded-xl border border-[#f2d6a8] bg-[#fff9ee] px-3 py-3">
                        <p className="text-[12px] font-semibold text-[#8b5c1a]">
                          {shouldHideBillingUntilCreated
                            ? 'Cobro disponible despuÃ©s de crear la reserva.'
                            : 'Cobro oculto hasta confirmar la reserva.'}
                        </p>
                        <p className="mt-1 text-[12px] text-[#926a2a]">
                          {shouldHideBillingUntilCreated
                            ? 'Primero creÃ¡ la reserva. DespuÃ©s podÃ©s definir asignaciÃ³n de cobro y registrar pagos.'
                            : 'ConfirmÃ¡ esta reserva para habilitar asignaciÃ³n de cobro, registro de pagos y saldo.'}
                        </p>
                        {!shouldHideBillingUntilCreated && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleConfirmPendingBooking()}
                              disabled={confirmingBooking}
                              className="h-8 rounded-lg bg-[#3053e2] px-3 text-[12px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-60"
                            >
                              {confirmingBooking ? 'Confirmando...' : 'Confirmar reserva'}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <BookingDrawerShell
                          draft={bookingDrawerState.draft}
                          activeTab={billingHubTab}
                          paymentsLocked={isPaymentLockedByManualPending}
                          paymentsLockedReason="Primero confirmÃ¡ la reserva para poder registrar pagos."
                          warnings={[
                            ...(hasBlockingActionError ? ['CURRENT_VALIDATION_WARNING'] : []),
                            ...(bookingDrawerState.ui.warnings || []),
                          ]}
                          onTabChange={(tab) => setBillingHubTab(tab)}
                          onModeChange={handleBillingModeChange}
                          onResponsibleChange={handleBillingResponsibleChange}
                          onAssignmentAmountChange={handleBillingAssignmentAmountChange}
                          onToggleChargeable={handleBillingToggleChargeable}
                          onQueuePayment={(input) =>
                            (() => {
                              if (isPaymentLockedByManualPending) {
                                showCalendarNotice('Primero confirmÃ¡ la reserva para poder registrar pagos.');
                                return;
                              }
                              const draft = bookingDrawerState.draft;
                              const remainingAmount = Number(
                                Math.max(0, Number(draft?.billing.financialSummary.remainingAmount || 0)).toFixed(2)
                              );
                              const amount =
                                draft?.billing.chargeMode === 'INDIVIDUAL'
                                  ? remainingAmount
                                  : Number(input.amount || 0);
                              if (amount <= 0.009) {
                                showCalendarNotice(
                                  draft?.billing.chargeMode === 'INDIVIDUAL'
                                    ? 'El saldo ya estÃ¡ cubierto. No hay cobro pendiente.'
                                    : 'IngresÃ¡ un monto mayor a 0 para registrar pago.'
                                );
                                return;
                              }
                              void registerPaymentNow({
                                amount: Number(amount.toFixed(2)),
                                method: input.method,
                                successMessage: `Pago registrado: ${Number(amount).toFixed(2)} $.`,
                              });
                            })()
                          }
                          onRemoveQueuedPayment={() => {
                            showCalendarNotice('Cada pago se registra al instante. No hay cola local para remover.');
                          }}
                          onRegisterPayment={isBookingFullyPaid ? undefined : () => {
                            setBillingHubTab('PAYMENTS');
                            showCalendarNotice('CompletÃ¡ monto y mÃ©todo para registrar el pago.');
                          }}
                          onCollectRemaining={
                            isBookingFullyPaid
                              ? undefined
                              : () => {
                                  if (isPaymentLockedByManualPending) return;
                                  queueRemainingPayment();
                                }
                          }
                        />
                        {bookingDrawerState.ui.warnings.length > 0 && (
                          <div className="mt-2 rounded-lg border border-[#f2c7a8] bg-[#fff4ea] px-3 py-2 text-[12px] text-[#8a4f14]">
                            {bookingDrawerState.ui.warnings.map((warning) => {
                              const message =
                                warning === 'UNATTRIBUTED_PAYMENTS'
                                  ? 'Hay pagos sin imputar.'
                                  : warning === 'ASSIGNMENT_SUM_MISMATCH'
                                    ? 'La suma asignada no coincide con el total.'
                                    : warning === 'CANCELLED_WITH_PAYMENTS'
                                      ? 'La reserva estÃ¡ cancelada y tiene pagos.'
                                      : warning === 'ARCHIVED_PARTICIPANT_WITH_HISTORY'
                                        ? 'Hay participantes archivados con historial.'
                                        : warning === 'INDIVIDUAL_WITHOUT_CHARGE_RESPONSIBLE'
                                          ? 'En modo Individual falta responsable del cobro.'
                                          : warning;
                              return (
                                <p key={`drawer-warning-${warning}`} className="leading-5">
                                  â€¢ {message}
                                </p>
                              );
                            })}
                          </div>
                        )}
                        {bookingDrawerState.ui.saveStatus === 'PARTIAL' && (
                          <div className="mt-2 rounded-lg border border-[#f2c7a8] bg-[#fff4ea] px-3 py-2 text-[12px] text-[#8a4f14]">
                            {bookingDrawerState.ui.saveMessage || 'Guardado parcial.'}
                          </div>
                        )}
                        {bookingDrawerState.ui.saveStatus === 'FAILED' && (
                          <div className="mt-2 rounded-lg border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2 text-[12px] text-[#b42346]">
                            {bookingDrawerState.ui.saveMessage || 'No se pudo guardar.'}
                          </div>
                        )}
                        {canShowMainAction && (
                          <div className="mt-3 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2.5">
                            {showCollectMainAction && (
                              <>
                                <p className="text-[12px] font-semibold text-[#44506b]">
                                  Saldo pendiente: {`${Number(billingSummary.remainingAmount || 0).toFixed(2)} $`}
                                </p>
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={queueRemainingPayment}
                                    disabled={isPaymentLockedByManualPending}
                                    className="h-8 rounded-lg bg-[#3053e2] px-3 text-[12px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-60"
                                  >
                                    Agregar saldo a pagos
                                  </button>
                                </div>
                              </>
                            )}
                            {isBookingFullyPaid && (
                              <p className="text-[12px] font-semibold text-[#1c7a44]">
                                Reserva saldada. No hay acciones de cobro disponibles.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {!isModernBillingEnabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {!isBookingFullyPaid && (
                        <div>
                        <p className="text-[13px] text-[#727b90] inline-flex items-center gap-1">AsignaciÃ³n de cobro <CircleAlert size={13} /></p>
                        <div className="mt-2 rounded-xl border border-[#dce2ee] bg-[#f7f8fc] p-1">
                          <div className="h-9 rounded-lg bg-[#dfe4f4] text-[#2e58e5] text-[15px] font-semibold grid place-items-center">
                            Pago Ãºnico
                          </div>
                        </div>
                        </div>
                      )}
                      <div className={isBookingFullyPaid ? 'col-span-2' : ''}>
                        <p className="text-[13px] text-[#727b90]">{priceFieldLabel}</p>
                        <div className="mt-2 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between text-[16px] text-[#2c3448]">
                          <input
                            type="number"
                            min={0}
                            max={MAX_MANUAL_PARTICIPANT_PRICE}
                            step="0.01"
                            value={isFinancialDisplayPending ? '' : Number(totalPrice.toFixed(2))}
                            readOnly
                            className="w-full bg-transparent outline-none text-[#2c3448]"
                          />
                          <span className="text-[#8b93a5]">$</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#6f7890]">
                          Precio turno ({selectionMinutes} min):{' '}
                          <strong>{isFinancialDisplayPending ? '--' : `${totalPrice.toFixed(2)} $`}</strong>
                        </p>
                        <p className="mt-1 text-[11px] text-[#6f7890]">{priceFieldHint}</p>
                        {isFinancialDisplayPending && (
                          <p className="mt-1 text-[11px] text-[#7b8396]">Cargando precio...</p>
                        )}
                        {quoteLoading && <p className="mt-1 text-[11px] text-[#7b8396]">Cotizando...</p>}
                        {quoteError && !isBlockingQuoteError(quoteError) && (
                          <p className="mt-1 text-[11px] text-[#d13d57]">{quoteError}</p>
                        )}
                        {bookingFinancial && (
                          <p className="mt-1 text-[11px] text-[#6f7890]">
                            Pagado: <strong>{bookingFinancial.paid.toFixed(2)} $</strong> Â· Restante:{' '}
                            <strong>{bookingFinancial.remaining.toFixed(2)} $</strong>
                          </p>
                        )}
                        {exceedsRemainingWarning && (
                          <p className="mt-1 text-[11px] text-[#d13d57]">
                            El precio configurado supera el saldo pendiente. Al cobrar se ajustarÃ¡ al restante.
                          </p>
                        )}
                      </div>
                    </div>
                    )}
                  </section>

                  <section className="py-6 border-b border-[#edf0f5]">
                    <div className="flex items-end justify-between">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-[#1f2638]">Participantes</p>
                      {!isModernBillingEnabled && (
                        <div className="grid grid-cols-[1fr_86px_132px_20px] gap-2 text-[12px] text-[#7b8396]">
                          <span />
                          <span>Precio</span>
                          <span>Pago</span>
                          <span />
                        </div>
                      )}
                    </div>
                    {isModernBillingEnabled && (
                      <p className="mt-2 text-[12px] text-[#6f7890]">
                        AcÃ¡ gestionÃ¡s personas de la reserva. La lÃ³gica de cobro estÃ¡ en la secciÃ³n <strong>Cobro</strong>.
                      </p>
                    )}

                    <div className="mt-3 space-y-3">
                      {participants.map((participant) => {
                        const participantIsCharged = chargedParticipantIdSet.has(participant.id);
                        const displayPrice = participantIsCharged ? resolveParticipantPrice(participant) : 0;
                        const isDuplicateParticipant = duplicateParticipantIds.has(participant.id);
                        return (
                          <div
                            key={participant.id}
                            className={`rounded-xl border bg-white p-2 ${
                              isDuplicateParticipant ? 'border-[#f2b7c3] bg-[#fff8fa]' : 'border-[#e3e8f2]'
                            }`}
                          >
                            <p className="text-[13px] text-[#7c8598] mb-2">
                              {participant.isOwner ? 'Responsable de la reserva' : 'Participante'}
                            </p>
                            <div className={`grid ${isModernBillingEnabled ? 'grid-cols-[1fr_20px]' : 'grid-cols-[1fr_86px_132px_20px]'} gap-2 items-center`}>
                              <div className="relative">
                                <div className="h-11 rounded-xl border border-[#dbe2ef] px-3 flex items-center gap-2 text-[#8b93a5]">
                                  <Search size={14} />
                                  <input
                                    value={participant.name}
                                    onChange={(event) => void runParticipantSearch(participant.id, event.target.value)}
                                    onFocus={() => {
                                      const suggestions = participantSuggestionsById[participant.id];
                                      if (Array.isArray(suggestions) && suggestions.length > 0) {
                                        setParticipantSearchOpenId(participant.id);
                                      }
                                    }}
                                    placeholder="Buscar nombre, correo o telÃ©fono"
                                    className="w-full bg-transparent outline-none text-[13px] text-[#273048]"
                                  />
                                </div>
                                {participantSearchOpenId === participant.id && (
                                  <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-[#dde3ef] bg-white shadow-lg p-1">
                                    {participantSearchLoadingId === participant.id && (
                                      <p className="px-2 py-1 text-[11px] text-[#7b8396]">Buscando...</p>
                                    )}
                                    {(participantSuggestionsById[participant.id] || []).slice(0, 8).map((suggestion) => (
                                      <button
                                        key={suggestion.id}
                                        type="button"
                                        onClick={() => applyParticipantSuggestion(participant.id, suggestion)}
                                        className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                      >
                                        <span className="block text-[12px] font-semibold text-[#273048]">{suggestion.label}</span>
                                        {suggestion.secondary && (
                                          <span className="block text-[11px] text-[#7b8396]">{suggestion.secondary}</span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {!isModernBillingEnabled && (
                              <div className="h-11 rounded-xl border border-[#dbe2ef] px-3 flex items-center justify-between text-[15px]">
                                {!participantIsCharged ? (
                                  <span>-</span>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={MAX_MANUAL_PARTICIPANT_PRICE}
                                    step="0.01"
                                    value={
                                      participantPriceDraftById[participant.id] != null
                                        ? participantPriceDraftById[participant.id]
                                        : Number(displayPrice.toFixed(2))
                                    }
                                    onFocus={() => {
                                      setParticipantPriceDraftById((previous) => ({
                                        ...previous,
                                        [participant.id]: displayPrice.toFixed(2),
                                      }));
                                    }}
                                    onChange={(event) => {
                                      const raw = event.target.value;
                                      setParticipantPriceDraftById((previous) => ({
                                        ...previous,
                                        [participant.id]: raw,
                                      }));
                                      const next = parseMoneyInput(raw);
                                      if (next == null) return;
                                      if (paymentMode === 'Dividido') {
                                        applySplitParticipantManualPrice(participant.id, next);
                                        return;
                                      }
                                      updateParticipant(participant.id, { customPrice: next });
                                    }}
                                    onBlur={() => {
                                      const raw = participantPriceDraftById[participant.id];
                                      if (raw != null) {
                                        const parsed = parseMoneyInput(raw);
                                        if (parsed == null) {
                                          if (paymentMode === 'Dividido') {
                                            setParticipants((previous) =>
                                              previous.map((entry) =>
                                                entry.id === participant.id
                                                  ? { ...entry, customPrice: null }
                                                  : entry
                                              )
                                            );
                                          } else {
                                            updateParticipant(participant.id, { customPrice: null });
                                          }
                                        } else if (paymentMode === 'Dividido') {
                                          applySplitParticipantManualPrice(participant.id, parsed);
                                        } else {
                                          updateParticipant(participant.id, { customPrice: parsed });
                                        }
                                      }
                                      setParticipantPriceDraftById((previous) => {
                                        const next = { ...previous };
                                        delete next[participant.id];
                                        return next;
                                      });
                                    }}
                                    className="w-full bg-transparent outline-none"
                                  />
                                )}
                                <span className="text-[#8b93a5]">$</span>
                              </div>
                              )}
                              {!isModernBillingEnabled && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isPaymentsTabActive || isBookingFullyPaid || !participantIsCharged) return;
                                  void toggleParticipantPaid(participant.id);
                                }}
                                disabled={!isPaymentsTabActive || isBookingFullyPaid || !participantIsCharged || isPaymentLockedByManualPending || paymentInFlightId === participant.id}
                                className={`h-11 rounded-xl border text-[15px] font-semibold ${
                                  isBookingFullyPaid || participant.paid || !participantIsCharged
                                    ? 'border-[#cbe6d0] bg-[#e9f8ec] text-[#16733f]'
                                    : 'border-[#dfe5f8] bg-[#edf1ff] text-[#3155df]'
                                } disabled:opacity-60`}
                              >
                                {!participantIsCharged
                                  ? 'Sin cargo'
                                  : !isPaymentsTabActive
                                  ? 'Ir a Pagos'
                                  : isBookingFullyPaid
                                  ? 'Pagado'
                                  : paymentInFlightId === participant.id
                                  ? 'Procesando...'
                                  : participant.paid
                                    ? 'Pagado'
                                    : 'Marcar pago'}
                              </button>
                              )}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setParticipantMenuId((previous) =>
                                    previous === participant.id ? null : participant.id
                                  );
                                }}
                                className="h-11 w-5 text-[#727b90] grid place-items-center"
                              >
                                <MoreVertical size={16} />
                              </button>
                            </div>
                            {expandedParticipantId === participant.id ? (
                              <div className="mt-2">
                                <div className="h-10 rounded-xl border border-[#dbe2ef] px-3 flex items-center gap-2 text-[#8b93a5]">
                                  <input
                                    ref={participantContactInputRef}
                                    value={participant.contact}
                                    onChange={(event) => updateParticipant(participant.id, { contact: event.target.value })}
                                    onBlur={() =>
                                      setExpandedParticipantId((previous) =>
                                        previous === participant.id ? null : previous
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === 'Escape') {
                                        event.preventDefault();
                                        setExpandedParticipantId((previous) =>
                                          previous === participant.id ? null : previous
                                        );
                                      }
                                    }}
                                    placeholder="Contacto (correo o telÃ©fono)"
                                    className="w-full bg-transparent outline-none text-[13px] text-[#273048]"
                                  />
                                </div>
                              </div>
                            ) : participant.contact.trim().length > 0 ? (
                              <p className="mt-2 text-[12px] text-[#6f7890]">
                                Contacto: {participant.contact}
                              </p>
                            ) : null}
                            {isDuplicateParticipant && (
                              <p className="mt-2 text-[11px] font-semibold text-[#c0354f]">
                                Participante duplicado en esta reserva.
                              </p>
                            )}
                            {participantMenuId === participant.id && (
                              <div className="mt-2 rounded-xl border border-[#dce2ef] bg-white shadow-sm p-2 text-[12px] text-[#30384d]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedParticipantId(participant.id);
                                    setParticipantMenuId(null);
                                  }}
                                  className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                >
                                  Editar participante (nombre/contacto)
                                </button>
                                {!isModernBillingEnabled && !isBookingFullyPaid && participantIsCharged && isPaymentsTabActive && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (participant.paid) {
                                          markParticipantAsPending(participant.id);
                                        } else {
                                          if (isPaymentLockedByManualPending) return;
                                          void toggleParticipantPaid(participant.id);
                                        }
                                        setParticipantMenuId(null);
                                      }}
                                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                    >
                                      {participant.paid ? 'Marcar como pendiente' : 'Marcar como pagado'}
                                    </button>
                                    <div className="mt-1 border-t border-[#edf0f6] pt-1">
                                      <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-[#7a8398]">
                                        MÃ©todo de pago
                                      </p>
                                      {([
                                        { value: 'CASH', label: 'Efectivo' },
                                        { value: 'TRANSFER', label: 'Transferencia' },
                                        { value: 'CARD', label: 'Tarjeta' },
                                      ] as const).map((option) => (
                                        <button
                                          key={option.value}
                                          type="button"
                                          onClick={() => {
                                            updateParticipant(participant.id, { paymentMethod: option.value });
                                            setParticipantMenuId(null);
                                          }}
                                          className={`w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb] ${
                                            participant.paymentMethod === option.value ? 'text-[#2f53df] font-semibold' : ''
                                          }`}
                                        >
                                          {option.label}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                                <div className="mt-1 border-t border-[#edf0f6] pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (participant.isOwner) return;
                                      setDeleteParticipantConfirm({
                                        open: true,
                                        participantId: participant.id,
                                        participantName: participant.name.trim() || 'este participante',
                                      });
                                      setParticipantMenuId(null);
                                    }}
                                    disabled={participant.isOwner}
                                    className="w-full text-left rounded-lg px-2 py-1.5 text-[#c0354f] hover:bg-[#fff2f4] disabled:opacity-40"
                                  >
                                    Eliminar participante
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {!isModernBillingEnabled && (
                        <button
                          type="button"
                          onClick={() => {
                            setParticipantPriceDraftById({});
                            setDefaultPricePerParticipant(0);
                            setParticipants((previous) =>
                              previous.map((participant) => ({ ...participant, customPrice: null }))
                            );
                          }}
                          className="h-7 rounded-full px-3 border border-[#dbe2ef] text-[#4e5870] text-[12px] font-semibold"
                        >
                          Recalcular precios
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={addParticipantRow}
                        className="h-7 rounded-full px-3 border border-[#dbe2ef] text-[#4e5870] text-[12px] font-semibold inline-flex items-center gap-1"
                      >
                        <Plus size={12} />
                        Agregar participante
                      </button>
                    </div>
                  </section>

                  <section className="pt-6">
                    <p className="text-[19px] font-semibold tracking-[-0.01em] text-[#1f2638]">Notas</p>
                    <label className="block mt-2">
                      <span className="text-[13px] text-[#7c8598]">Notas internas (opcional)</span>
                      <textarea
                        value={notes}
                        onChange={(event) => handleNotesChange(event.target.value)}
                        placeholder="Agregar observaciones internas"
                        rows={4}
                        className="mt-2 w-full rounded-xl border border-[#dbe2ef] bg-white px-3 py-2 text-sm resize-none"
                      />
                    </label>
                  </section>
                  </fieldset>
                    </>
                  )}
                    </>
                  )}
                </div>

                <footer className="border-t border-[#eef0f5] bg-white p-4">
                  {useSimplifiedBookingSidebar ? (
                    <div className="space-y-3">
                      {hasBlockingActionError && (
                        <div className="rounded-xl border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2.5">
                          <p className="text-[12px] font-semibold text-[#b42346]">
                            No podes continuar hasta corregir este error.
                          </p>
                          <p className="mt-0.5 text-[12px] text-[#b42346]">{blockingActionMessage}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        {editingBookingId && (
                          <button
                            type="button"
                            onClick={() => setDeleteBookingConfirmOpen(true)}
                            aria-label="Eliminar reserva"
                            title="Eliminar reserva"
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 w-10 rounded-xl border border-[#f1c7d2] bg-white text-[#b42346] grid place-items-center hover:bg-[#fff4f7] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className="flex items-center gap-2">
                          {showConfirmMainAction && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmPendingBooking()}
                              disabled={confirmingBooking || isSubmittingBooking || isDeletingBooking}
                              className="h-10 rounded-xl border border-[#d8e0ff] bg-white px-3 text-[#3155df] text-sm font-semibold hover:bg-[#f5f7ff] disabled:opacity-50"
                            >
                              {confirmingBooking ? 'Confirmando...' : 'Confirmar reserva'}
                            </button>
                          )}
                          {hasBlockingActionError && (
                            <button
                              type="button"
                              onClick={() => setBlockingErrorModalOpen(true)}
                              className="h-10 rounded-xl border border-[#efc5cf] bg-white px-3 text-[12px] font-semibold text-[#b42346] hover:bg-[#fff8fa]"
                            >
                              Ver detalle
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleCreateBooking}
                            disabled={primaryActionDisabled}
                            className="h-11 min-w-[170px] rounded-xl bg-[#3053e2] px-4 text-white text-[16px] font-semibold hover:bg-[#2748cc] disabled:opacity-50"
                          >
                            {editingBookingId ? 'Guardar cambios' : 'Crear reserva'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="space-y-3">
                    {bookingKind !== 'block' && !shouldHideBillingUntilConfirmed && (
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8fafd] px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-[#2a3245]">Resumen de cobro</p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-[#6f7890]">
                            <p>Total</p>
                            <p className="text-[13px] font-semibold text-[#2a3245]">
                              {Number(billingSummary.totalAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-[#6f7890]">
                            <p>Pagado</p>
                            <p className="text-[13px] font-semibold text-[#16733f]">
                              {Number(billingSummary.paidAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5 text-[11px] text-[#6f7890]">
                            <p>Restante</p>
                            <p className="text-[13px] font-semibold text-[#9a5a00]">
                              {Number(billingSummary.remainingAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-[#6f7890]">
                          <span>
                            Lista: {quotedListPrice != null ? `${quotedListPrice.toFixed(2)} $` : '-'}
                          </span>
                          <span>
                            Descuento: {quotedDiscountAmount > 0 ? `-${quotedDiscountAmount.toFixed(2)} $` : '0.00 $'}
                          </span>
                        </div>
                      </div>
                    )}
                    {bookingKind !== 'block' && shouldHideBillingUntilConfirmed && (
                      <div className="rounded-xl border border-[#f2d6a8] bg-[#fff9ee] px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-[#8b5c1a]">Cobro pendiente de confirmaciÃ³n</p>
                        <p className="mt-1 text-[12px] text-[#926a2a]">
                          ConfirmÃ¡ la reserva para habilitar asignaciÃ³n de cobro, pagos y saldo.
                        </p>
                      </div>
                    )}

                    {hasBlockingActionError && (
                      <div className="rounded-xl border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-[#b42346]">
                          No podÃ©s continuar hasta corregir este error.
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#b42346]">{blockingActionMessage}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        {editingBookingId && (
                          <button
                            type="button"
                            onClick={() => setDeleteBookingConfirmOpen(true)}
                            aria-label="Eliminar reserva"
                            title="Eliminar reserva"
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 w-10 rounded-xl border border-[#f1c7d2] bg-white text-[#b42346] grid place-items-center hover:bg-[#fff4f7] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {hasBlockingActionError && (
                          <button
                            type="button"
                            onClick={() => setBlockingErrorModalOpen(true)}
                            className="h-10 rounded-xl border border-[#efc5cf] bg-white px-3 text-[12px] font-semibold text-[#b42346] hover:bg-[#fff8fa]"
                          >
                            Ver detalle
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleCreateBooking}
                          disabled={primaryActionDisabled}
                          className="h-10 min-w-[232px] rounded-xl bg-[#3053e2] px-4 text-white text-sm font-bold hover:bg-[#2748cc] disabled:opacity-50"
                        >
                          {isSubmittingBooking ? primaryActionLabel : `${primaryActionLabel} â€¢ ${primaryActionMeta}`}
                        </button>
                      </div>
                    </div>
                  </div>
                  )}
                </footer>
              </div>
            </aside>
          </section>
      </div>
      </div>
      </div>

      {simplifiedPaymentModalOpen && (
        <div className="fixed inset-0 z-[2147483200]">
          <button
            type="button"
            className="absolute inset-0 bg-[#0d1326]/45"
            onClick={closeSimplifiedPaymentModal}
            aria-label="Cerrar modal de cobro"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-[560px] rounded-2xl border border-[#dce2ee] bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3">
                <div>
                  <p className="text-[18px] font-semibold text-[#1f2638]">Registrar pago</p>
                  <p className="text-[12px] text-[#707a92]">
                    Pago Ãºnico: una persona paga el total en uno o varios pagos parciales.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-8 w-8 rounded-full text-[#7e879c] grid place-items-center hover:bg-[#f3f5fa]"
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="grid grid-cols-3 gap-2 text-[11px] text-[#6f7890]">
                  <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                    <p>Total</p>
                    <p className="text-[13px] font-semibold text-[#273149]">
                      {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                    <p>Pagado</p>
                    <p className="text-[13px] font-semibold text-[#16733f]">
                      {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                    <p>Deuda</p>
                    <p className="text-[13px] font-semibold text-[#9a5a00]">
                      {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-[12px] font-medium text-[#79829a]">QuiÃ©n paga</span>
                    <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center">
                      <select
                        value={simplifiedResolvedPayerParticipantId}
                        onChange={(event) => {
                          const nextParticipantId = String(event.target.value || '');
                          setSimplifiedPaymentPayerParticipantIdDraft(nextParticipantId);
                          const nextPayer = participants.find((participant) => participant.id === nextParticipantId);
                          if (nextPayer) {
                            setSimplifiedPaymentMethodDraft(nextPayer.paymentMethod || 'CASH');
                          }
                        }}
                        className="w-full bg-transparent text-[15px] text-[#2a3245] outline-none"
                      >
                        <option value="">Seleccionar participante</option>
                        {simplifiedPayerCandidates.map((participant) => (
                          <option key={`simplified-payer-${participant.id}`} value={participant.id}>
                            {participant.name}
                            {participant.isOwner ? ' (titular)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-medium text-[#79829a]">MÃ©todo</span>
                    <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center">
                      <select
                        value={simplifiedPaymentMethodDraft}
                        onChange={(event) => setSimplifiedPaymentMethodDraft(String(event.target.value || ''))}
                        className="w-full bg-transparent text-[15px] text-[#2a3245] outline-none"
                      >
                        <option value="">Seleccionar mÃ©todo de pago</option>
                        {ownerPaymentMethodOptions.map((option) => (
                          <option key={`modal-payment-method-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>

                <label className="block">
                  <span className="text-[12px] font-medium text-[#79829a]">Monto</span>
                  <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={simplifiedPaymentAmountDraft}
                      onChange={(event) => setSimplifiedPaymentAmountDraft(event.target.value)}
                      className="w-full bg-transparent text-[16px] text-[#2a3245] outline-none"
                    />
                    <span className="text-[15px] font-semibold text-[#8a92a5]">$</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#6f7890]">
                    Deuda pendiente disponible: {simplifiedRemainingAfterQueue.toFixed(2)} $
                  </p>
                </label>

                <label className="block">
                  <span className="text-[12px] font-medium text-[#79829a]">Nota (opcional)</span>
                  <textarea
                    value={simplifiedPaymentNoteDraft}
                    onChange={(event) => setSimplifiedPaymentNoteDraft(event.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-[#dce2ee] bg-white px-3 py-2 text-[14px] text-[#2a3245] resize-none outline-none"
                    placeholder="Ejemplo: primera cuota"
                  />
                </label>

              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#eef1f6] px-4 py-3">
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-10 rounded-xl border border-[#dce2ee] px-4 text-[14px] font-semibold text-[#5d667f] hover:bg-[#f7f9fc]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={queueSimplifiedPaymentFromModal}
                  disabled={
                    !simplifiedResolvedPayerParticipantId ||
                    !hasValidSimplifiedPaymentMethod ||
                    !hasValidSimplifiedPaymentAmount ||
                    simplifiedRemainingAfterQueue <= 0.009
                  }
                  className="h-10 rounded-xl bg-[#3053e2] px-4 text-[14px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-50"
                >
                  Registrar pago
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        body {
          background: #f5f6f8;
        }

        .playground-combo {
          position: relative;
        }

        .playground-combo-trigger {
          width: 100%;
          height: 44px;
          border: 1px solid #dce2ee;
          border-radius: 12px;
          background: #ffffff;
          color: #2a3348;
          font-size: 15px;
          font-weight: 500;
          padding: 0 34px 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          transition: border-color 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
        }

        .playground-combo-trigger:hover {
          border-color: #c9d1de;
        }

        .playground-combo-trigger:focus-visible {
          outline: none;
          border-color: #bfc8da;
          box-shadow: 0 0 0 2px #eef2ff;
        }

        .playground-combo-trigger-compact {
          height: 32px;
          border-radius: 9999px;
          border-color: #e2e6ef;
          background: #f8f9fc;
          color: #3e4555;
          font-size: 13px;
          font-weight: 500;
        }

        .playground-combo-menu {
          position: absolute;
          top: calc(100% + 6px);
          min-width: 100%;
          border-radius: 12px;
          border: 1px solid #dbe2ef;
          background: #fff;
          box-shadow: 0 12px 30px rgba(28, 34, 52, 0.12);
          z-index: 60;
          overflow: hidden;
        }

        .playground-combo-option {
          width: 100%;
          border: 0;
          background: transparent;
          text-align: left;
          color: #2e3650;
          font-size: 15px;
          font-weight: 500;
          padding: 8px 12px;
          transition: background-color 0.14s ease, color 0.14s ease;
        }

        .playground-combo-option:hover {
          background: #f5f7fb;
        }

        .playground-combo-option-active {
          background: #2f63d0;
          color: #fff;
        }
      `}</style>
    </>
  );
}





