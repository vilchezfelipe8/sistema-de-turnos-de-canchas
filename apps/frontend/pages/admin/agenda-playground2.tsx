import Head from 'next/head';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, MoreVertical, Pencil, Plus, Repeat, Search, User, Users, CreditCard, Settings, X, Receipt, BarChart3, Trophy, MessageSquare, ShoppingBag, FileText, GraduationCap, Lock, Trash2 } from 'lucide-react';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import AdminPlaygroundShell from '../../components/admin/AdminPlaygroundShell';
import AdminDrawer, { AdminDrawerSection } from '../../components/admin/ui/AdminDrawer';
import AgendaBookingBlock from '../../components/admin/agenda/AgendaBookingBlock';
import AgendaSelectionPreview from '../../components/admin/agenda/AgendaSelectionPreview';
import AgendaSlotLayer from '../../components/admin/agenda/AgendaSlotLayer';
import AgendaTimeGutter from '../../components/admin/agenda/AgendaTimeGutter';
import AgendaToolbar from '../../components/admin/agenda/AgendaToolbar';
import BookingHoverCard from '../../components/admin/agenda/BookingHoverCard';
import PlaytomicPaymentModal from '../../components/admin/payments/PlaytomicPaymentModal';
import PaymentRegistrationDrawer from '../../components/admin/payments/PaymentRegistrationDrawer';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClubAdminService, type BookingBillingConfig } from '../../services/ClubAdminService';
import { cancelBooking, cancelFixedBooking, changeBookingClient, confirmBooking, createBooking, createFixedBooking, getAdminSchedule, getBookingBillingConfig, getBookingById, getBookingFinancialSummary, getBookingQuote, getBookingTimelineEvents, registerBookingPartialPayment, rescheduleFixedBooking, updateBookingBillingConfig, type BookingDomainEvent } from '../../services/BookingService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { reportUiError } from '../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
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
  paymentState: 'paid' | 'partial' | 'unpaid';
  isRecurring?: boolean;
  participantsCount?: number;
  hasPendingNotification?: boolean;
  fixedBookingId?: number;
  clientId?: string;
  userId?: number;
  hoverPayment?: {
    status: 'UNPAID' | 'PARTIAL' | 'PAID';
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    chargeMode?: string;
    chargeResponsibleRef?: string | null;
    chargeResponsibleName?: string | null;
    latestPayerRef?: string | null;
    latestPayerName?: string | null;
    latestCoveredRef?: string | null;
    latestCoveredName?: string | null;
    participants?: Array<{
      ref: string;
      name: string;
      isOwner?: boolean;
    }>;
    payerParticipants?: Array<{
      ref?: string | null;
      name?: string | null;
      amount?: number;
    }>;
    coveredParticipants?: Array<{
      ref?: string | null;
      name?: string | null;
      amount?: number;
    }>;
  };
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

type PaymentMode = 'Único' | 'Dividido';
type EditSeriesScope = 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';

type RecurringOverlapItem = {
  courtName: string;
  requestedDateLabel: string;
  requestedTimeLabel: string;
  conflictingDateLabel?: string;
  conflictingTimeLabel?: string;
  activityName?: string;
  clientName?: string;
};

type RecurringCreatedItem = {
  bookingId?: number;
  courtName: string;
  requestedDateLabel: string;
  requestedTimeLabel: string;
  activityName?: string;
  sortStartMs?: number;
};

type SeriesPaidOccurrence = Omit<RecurringCreatedItem, 'bookingId'> & {
  bookingId: number;
  paidAmount: number;
};

type SeriesScopePreviewSummary = {
  scope: EditSeriesScope;
  totalCandidates: number;
  applicableCount: number;
  applicableItems: RecurringCreatedItem[];
  skippedCount: number;
  overlapItems: RecurringOverlapItem[];
  failureMessages: string[];
  paidItems?: SeriesPaidOccurrence[];
  paidAmountTotal?: number;
};

type SeriesOperationResult = {
  mode: 'edit' | 'delete';
  title: string;
  detail: string;
  appliedCount: number;
  appliedItems: RecurringCreatedItem[];
  skippedCount: number;
  overlapItems: RecurringOverlapItem[];
};

type RecurringExecutionPlan = {
  recurrenceDays: number[];
  frequencyDays: number;
  repetitionsPerDay?: number;
  error?: string;
};

type DraggingBookingMeta = {
  bookingId: string;
  durationSlots: number;
  title: string;
  state: Booking['state'];
  paymentState: Booking['paymentState'];
  isRecurring?: boolean;
  participantsCount?: number;
  hasPendingNotification?: boolean;
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

type BookingKind = 'regular' | 'recurringV2' | 'privateClass' | 'courseClass' | 'block';
type RecurringFrequencyPreset = 'weekly' | 'biweekly' | 'custom';
type CancelRefundReasonType = 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';
type ComboOption = { value: string; label: string; secondary?: string };
type SimplifiedSidebarSection = 'DETAILS' | 'CONSUMPTIONS' | 'BILLING' | 'HISTORY';
type ClubProductOption = {
  id: number;
  name: string;
  price: number;
  stock: number | null;
  isActive: boolean;
};
type BookingConsumptionItem = {
  id: string;
  productId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  paidAmount: number;
  remainingAmount: number;
  type: string;
};
type PaymentImputationMode = 'BY_PARTICIPANT' | 'BY_CONCEPT';
type PaymentConceptMode = 'AUTO' | 'COURT' | 'CONSUMPTIONS' | 'CUSTOM';
type PaymentQuickPreset = 'MY_SHARE' | 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';
type ParticipantUiState =
  | { mode: 'idle'; participantId: null }
  | { mode: 'menu'; participantId: string }
  | { mode: 'editing'; participantId: string };
type SuggestionPlacement = {
  openUp: boolean;
  maxHeight: number;
};
type PlaytomicPaymentResultModal = {
  variant: 'success' | 'partial' | 'error';
  title: string;
  detail: string;
  requestedAmount: number;
  appliedAmount: number;
  remainingAfter: number;
  methodLabel: string;
  appliedItems: Array<{ label: string; amount: number }>;
};
type PaymentModalState =
  | { flow: 'playtomicPayment'; step: 'form' | 'preconfirm' | 'result' }
  | null;

type DuplicateClientCandidate = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
};


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
    description: 'Para reservas individuales de un solo día y pista',
    icon: CalendarDays,
  },
  {
    value: 'recurringV2',
    label: 'Serie recurrente',
    description: 'Reservas que se repiten con una frecuencia.',
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

const lockedBookingKindChangeValues = new Set<BookingKind>(['privateClass', 'courseClass', 'block']);

const cancelRefundReasonOptions: Array<{ value: CancelRefundReasonType; label: string }> = [
  { value: 'FULL', label: 'Devolución total' },
  { value: 'PARTIAL_COMMERCIAL', label: 'Parcial comercial' },
  { value: 'PARTIAL_SERVICE_FAILURE', label: 'Falla del servicio' },
  { value: 'PARTIAL_PRICING_ERROR', label: 'Error de precio' },
  { value: 'OTHER', label: 'Otro motivo' },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
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
  variant = 'default',
  className = '',
  disabled = false,
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  compact?: boolean;
  align?: 'left' | 'right';
  variant?: 'default' | 'participant';
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionsListRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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

  useEffect(() => {
    if (!open) return;
    const frameId = window.requestAnimationFrame(() => {
      const selectedOptionNode = optionRefs.current[value] || null;
      if (!selectedOptionNode) return;
      selectedOptionNode.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [open, value]);

  return (
    <div ref={containerRef} className={`p-admin-combo ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((previous) => !previous);
        }}
        disabled={disabled}
        className={`p-admin-combo-trigger ${compact ? 'p-admin-combo-trigger-compact' : ''} ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label || ''}</span>
        <ChevronDown size={14} className={`p-admin-combo-chevron ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !disabled && (
        <div
          className={`p-admin-combo-menu ${align === 'right' ? 'right-0' : 'left-0'} ${
            variant === 'participant' ? 'p-admin-combo-menu-participant' : ''
          }`}
        >
          <div ref={optionsListRef} className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[option.value] = node;
                  }}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`p-admin-combo-option ${
                    active ? 'p-admin-combo-option-active' : ''
                  } ${variant === 'participant' ? 'p-admin-combo-option-participant' : ''}`}
                >
                  <span className="p-admin-combo-option-primary">{option.label}</span>
                  {option.secondary && (
                    <span className="p-admin-combo-option-secondary">{option.secondary}</span>
                  )}
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
  // Pasteles sólidos 100% — texto siempre ink-900 para máxima legibilidad.
  if (state === 'completed') return 'bg-blue-100 text-ink-900';
  if (state === 'confirmed') return 'bg-lima-100 text-ink-900';
  if (state === 'blocked')   return 'bg-red-100 text-ink-900';
  return 'bg-amber-200 text-ink-900';  // pending
}

function bookingStatusLabel(state: Booking['state']) {
  if (state === 'completed') return 'COMPLETADA';
  if (state === 'confirmed') return 'CONFIRMADA';
  if (state === 'blocked') return 'BLOQUEADO';
  return 'PENDIENTE';
}

function bookingBadgeColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-blue-200 text-ink-900';
  if (state === 'confirmed') return 'bg-lima-200 text-ink-900';
  if (state === 'blocked')   return 'bg-red-200 text-ink-900';
  return 'bg-amber-300 text-ink-900';
}

function bookingPaymentLabel(state: Booking['paymentState']) {
  if (state === 'paid') return 'PAGADA';
  if (state === 'partial') return 'PARCIAL';
  return 'SIN PAGO';
}

function bookingPaymentBadgeColor(state: Booking['paymentState']) {
  if (state === 'paid')    return 'bg-lima-200 text-ink-900';
  if (state === 'partial') return 'bg-amber-300 text-ink-900';
  return 'bg-ink-300 text-ink-900';
}

function distributePaidByParticipants(
  participants: Participant[],
  paymentMode: PaymentMode,
  totalAmount: number,
  paidAmount: number,
  payerParticipantId?: string
) {
  const safeTotal = Number(Math.max(0, totalAmount || 0).toFixed(2));
  let remainingPaid = Number(Math.max(0, paidAmount || 0).toFixed(2));

  if (paymentMode === 'Único') {
    const payerId = String(payerParticipantId || '').trim();
    if (payerId && participants.some((participant) => participant.id === payerId)) {
      const hasAnyPaid = remainingPaid > 0.009;
      return participants.map((participant) => ({ ...participant, paid: hasAnyPaid && participant.id === payerId }));
    }

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
    inlineTimeWithBadges: height >= 52 && height < 70,
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

function isOwnerLikeParticipantRef(participantRef: string | null | undefined) {
  const normalized = String(participantRef || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'owner' ||
    normalized.startsWith('owner-') ||
    normalized.startsWith('owner_') ||
    normalized.startsWith('guest:owner') ||
    normalized.startsWith('guest:booking-responsible') ||
    normalized.startsWith('booking-client:') ||
    normalized.startsWith('booking-user:')
  );
}

function isOwnerLikeParticipantId(participantId: string | null | undefined) {
  const normalized = String(participantId || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'owner' || normalized.startsWith('owner-') || normalized.startsWith('owner_');
}

function resolveLatestPaymentPayerRef(events: BookingDomainEvent[] | null | undefined) {
  const timelineEvents = Array.isArray(events) ? [...events] : [];
  timelineEvents.sort((left, right) => {
    const leftTime = new Date(String(left?.createdAt || '')).getTime();
    const rightTime = new Date(String(right?.createdAt || '')).getTime();
    return rightTime - leftTime;
  });

  for (const event of timelineEvents) {
    const normalizedType = String(event?.type || '').trim().toUpperCase();
    if (normalizedType !== 'PAYMENT_RECEIVED') continue;
    const payload =
      event?.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const payerRef = String((payload as any)?.payerParticipantRef || '').trim();
    if (payerRef) return payerRef;
  }

  return '';
}

function resolveLatestPaymentCoveredRef(events: BookingDomainEvent[] | null | undefined) {
  const timelineEvents = Array.isArray(events) ? [...events] : [];
  timelineEvents.sort((left, right) => {
    const leftTime = new Date(String(left?.createdAt || '')).getTime();
    const rightTime = new Date(String(right?.createdAt || '')).getTime();
    return rightTime - leftTime;
  });

  for (const event of timelineEvents) {
    const normalizedType = String(event?.type || '').trim().toUpperCase();
    if (normalizedType !== 'PAYMENT_RECEIVED') continue;
    const payload =
      event?.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const coveredRef = String((payload as any)?.coveredParticipantRef || '').trim();
    if (coveredRef) return coveredRef;
    const payerRef = String((payload as any)?.payerParticipantRef || '').trim();
    if (payerRef) return payerRef;
  }

  return '';
}

function resolveHoverParticipantsForBooking(booking: Booking) {
  const ownerName = String(booking.title || '').trim();
  const hoverPayment = booking.hoverPayment;
  const status = hoverPayment?.status || (booking.paymentState === 'paid' ? 'PAID' : 'UNPAID');
  const chargeMode = String(hoverPayment?.chargeMode || 'INDIVIDUAL').trim().toUpperCase();
  const modeLabel = chargeMode === 'SHARED' ? 'Pago dividido' : 'Pago único';
  const chargeResponsibleName = String(hoverPayment?.chargeResponsibleName || '').trim();
  const latestPayerName = String(hoverPayment?.latestPayerName || '').trim();
  const latestPayerRef = String(hoverPayment?.latestPayerRef || '').trim();
  const latestCoveredName = String(hoverPayment?.latestCoveredName || '').trim();
  const latestCoveredRef = String(hoverPayment?.latestCoveredRef || '').trim();
  const chargeResponsibleRef = String(hoverPayment?.chargeResponsibleRef || '').trim();
  const ownerFallbackName = ownerName || 'Titular';
  const totalAmount = Number(hoverPayment?.totalAmount || 0);
  const paidAmount = Number(hoverPayment?.paidAmount || 0);

  const rawParticipants = Array.isArray(hoverPayment?.participants)
    ? hoverPayment?.participants
    : [];
  const normalizedParticipants = rawParticipants
    .map((rawParticipant, index) => {
      const ref = String(rawParticipant?.ref || '').trim();
      const name = String(rawParticipant?.name || '').trim();
      const isOwner = Boolean(rawParticipant?.isOwner) || isOwnerLikeParticipantRef(ref);
      const resolvedName =
        name ||
        (isOwner ? ownerFallbackName : '') ||
        `Participante ${index + 1}`;
      return {
        id: `${booking.id}-hover-${index}`,
        ref,
        name: resolvedName,
        isOwner,
      };
    })
    .filter((participant) => participant.name.trim().length > 0);

  const participants =
    normalizedParticipants.length > 0
      ? normalizedParticipants
      : [{
          id: `owner-${booking.id}`,
          ref: chargeResponsibleRef || '',
          name: ownerFallbackName,
          isOwner: true,
        }];

  const findByRef = (ref: string) =>
    participants.find((participant) => participant.ref && participant.ref === ref);
  const normalizeName = (value: string) =>
    String(value || '').trim().toLowerCase();
  const findByName = (name: string) => {
    const target = normalizeName(name);
    if (!target) return undefined;
    return participants.find((participant) => normalizeName(participant.name) === target);
  };

  const rawPayerParticipants = Array.isArray(hoverPayment?.payerParticipants)
    ? hoverPayment?.payerParticipants
    : [];
  const normalizedPayerParticipants = rawPayerParticipants.map((payer) => ({
    ref: String(payer?.ref || '').trim(),
    name: String(payer?.name || '').trim(),
    amount: Number(payer?.amount || 0),
  }));
  const rawCoveredParticipants = Array.isArray(hoverPayment?.coveredParticipants)
    ? hoverPayment?.coveredParticipants
    : rawPayerParticipants;
  const normalizedCoveredParticipants = rawCoveredParticipants.map((covered) => ({
    ref: String(covered?.ref || '').trim(),
    name: String(covered?.name || '').trim(),
    amount: Number(covered?.amount || 0),
  }));

  const latestPayerParticipant =
    findByRef(latestPayerRef) ||
    findByName(latestPayerName) ||
    (latestPayerRef && isOwnerLikeParticipantRef(latestPayerRef)
      ? participants.find((participant) => participant.isOwner)
      : undefined);
  const latestCoveredParticipant =
    findByRef(latestCoveredRef) ||
    findByName(latestCoveredName) ||
    (latestCoveredRef && isOwnerLikeParticipantRef(latestCoveredRef)
      ? participants.find((participant) => participant.isOwner)
      : undefined);

  const responsibleParticipant =
    findByRef(chargeResponsibleRef) ||
    findByName(chargeResponsibleName) ||
    (chargeResponsibleRef && isOwnerLikeParticipantRef(chargeResponsibleRef)
      ? participants.find((participant) => participant.isOwner)
      : undefined);
  const payerParticipantIdSet = new Set<string>();
  const payerAmountByParticipantId = new Map<string, number>();
  const addPayerAmount = (participantId: string, amount: number) => {
    if (!participantId) return;
    if (!Number.isFinite(amount) || amount <= 0.009) return;
    payerAmountByParticipantId.set(
      participantId,
      Number((Number(payerAmountByParticipantId.get(participantId) || 0) + amount).toFixed(2))
    );
  };
  normalizedPayerParticipants.forEach((payer) => {
    const hasAmount = Number.isFinite(payer.amount) && payer.amount > 0.009;
    if (!hasAmount) return;
    const matched =
      (payer.ref ? findByRef(payer.ref) : undefined) ||
      (payer.name ? findByName(payer.name) : undefined) ||
      (payer.ref && isOwnerLikeParticipantRef(payer.ref)
        ? participants.find((participant) => participant.isOwner)
        : undefined);
    if (!matched) return;
    payerParticipantIdSet.add(matched.id);
    addPayerAmount(matched.id, payer.amount);
  });
  if (payerParticipantIdSet.size === 0 && latestPayerParticipant) {
    payerParticipantIdSet.add(latestPayerParticipant.id);
  }
  if (payerAmountByParticipantId.size === 0 && latestPayerParticipant && paidAmount > 0.009) {
    addPayerAmount(latestPayerParticipant.id, paidAmount);
  }

  const coveredAmountByParticipantId = new Map<string, number>();
  const addCoveredAmount = (participantId: string, amount: number) => {
    if (!participantId) return;
    if (!Number.isFinite(amount) || amount <= 0.009) return;
    coveredAmountByParticipantId.set(
      participantId,
      Number((Number(coveredAmountByParticipantId.get(participantId) || 0) + amount).toFixed(2))
    );
  };
  normalizedCoveredParticipants.forEach((covered) => {
    const matched =
      (covered.ref ? findByRef(covered.ref) : undefined) ||
      (covered.name ? findByName(covered.name) : undefined) ||
      (covered.ref && isOwnerLikeParticipantRef(covered.ref)
        ? participants.find((participant) => participant.isOwner)
        : undefined);
    if (!matched) return;
    addCoveredAmount(matched.id, covered.amount);
  });
  if (coveredAmountByParticipantId.size === 0 && latestCoveredParticipant) {
    addCoveredAmount(latestCoveredParticipant.id, paidAmount);
  }

  const assignedAmountByParticipantId = new Map<string, number>();
  if (chargeMode === 'SHARED') {
    const chargeableParticipants = participants.filter((participant) => participant.name.trim().length > 0);
    const target = chargeableParticipants.length > 0
      ? chargeableParticipants
      : (participants.filter((participant) => participant.isOwner).length > 0
          ? participants.filter((participant) => participant.isOwner)
          : participants);
    const distributedByParticipantId = distributeAmountByParticipants(
      Math.max(0, totalAmount),
      target.map((participant) => participant.id)
    );
    distributedByParticipantId.forEach((amount, participantId) => {
      assignedAmountByParticipantId.set(participantId, amount);
    });
  } else {
    const payableParticipantId =
      responsibleParticipant?.id ||
      latestCoveredParticipant?.id ||
      participants.find((participant) => participant.isOwner)?.id ||
      participants[0]?.id ||
      '';
    if (payableParticipantId) {
      assignedAmountByParticipantId.set(payableParticipantId, Number(Math.max(0, totalAmount).toFixed(2)));
    }
  }

  return participants.map((participant) => {
    const isPayer = payerParticipantIdSet.has(participant.id);
    const payerAmount = Number(payerAmountByParticipantId.get(participant.id) || 0);
    const assignedAmount = Number(assignedAmountByParticipantId.get(participant.id) || 0);
    const coveredAmount = Number(coveredAmountByParticipantId.get(participant.id) || 0);
    const remainingAmount = Number(Math.max(0, assignedAmount - coveredAmount).toFixed(2));
    const isPayable = assignedAmount > 0.009;
    const effectiveCoveredAmount =
      status === 'PAID' && isPayable
        ? assignedAmount
        : coveredAmount;
    const effectiveRemainingAmount =
      status === 'PAID' && isPayable
        ? 0
        : remainingAmount;
    const participantStatus: Booking['hoverPayment']['status'] = !isPayable
      ? 'UNPAID'
      : status === 'PAID'
        ? 'PAID'
        : effectiveRemainingAmount <= 0.009
        ? 'PAID'
        : effectiveCoveredAmount > 0.009
          ? 'PARTIAL'
          : status;

    return {
      id: participant.id,
      name: participant.name,
      modeLabel,
      status: participantStatus,
      isOwner: participant.isOwner,
      paymentMethod: '',
      payable: isPayable,
      payer: isPayer || payerAmount > 0.009,
      payerAmount,
      shouldPayAmount: assignedAmount,
      paidAmount: effectiveCoveredAmount,
      debtAmount: effectiveRemainingAmount,
    };
  });
}

function estimateBookingHoverTarjetaHeight(participantsCount: number) {
  const rows = Math.max(1, participantsCount);
  // Header + paddings + rows (estimación más cercana al tamaño real del hover).
  return 40 + 12 + rows * 48 + 8;
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

function resolveBookingParticipantsCount(
  bookingRaw: any,
  hoverPaymentRaw: Record<string, unknown> | null,
  fallbackDisplayTitle: string
) {
  const hoverParticipants = Array.isArray(hoverPaymentRaw?.participants)
    ? hoverPaymentRaw.participants
    : [];
  const validHoverParticipants = hoverParticipants.filter((participant: any) =>
    Boolean(String(participant?.ref || '').trim() || String(participant?.name || '').trim())
  );
  if (validHoverParticipants.length > 0) return validHoverParticipants.length;

  const directParticipants = Array.isArray(bookingRaw?.participants) ? bookingRaw.participants : [];
  const validDirectParticipants = directParticipants.filter((participant: any) =>
    Boolean(String(participant?.id || participant?.ref || '').trim() || String(participant?.name || '').trim())
  );
  if (validDirectParticipants.length > 0) return validDirectParticipants.length;

  const hasOwnerLikeName = [
    bookingRaw?.client?.name,
    bookingRaw?.clientName,
    bookingRaw?.user?.name,
    fallbackDisplayTitle,
  ].some((value) => String(value || '').trim().length > 0);

  return hasOwnerLikeName ? 1 : 0;
}

function resolveHasPendingNotification(
  bookingRaw: any,
  fallbackPending: boolean
) {
  const explicitBooleanCandidates = [
    bookingRaw?.hasPendingNotification,
    bookingRaw?.pendingNotification,
    bookingRaw?.notificationPending,
    bookingRaw?.hasPendingReminder,
    bookingRaw?.notification?.pending,
  ];
  for (const candidate of explicitBooleanCandidates) {
    if (typeof candidate === 'boolean') return candidate;
  }

  const statusCandidates = [
    bookingRaw?.notificationStatus,
    bookingRaw?.reminderStatus,
    bookingRaw?.lastNotificationStatus,
    bookingRaw?.whatsappNotificationStatus,
  ];
  const normalizedStatuses = statusCandidates
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  if (normalizedStatuses.some((value) => value === 'PENDING' || value === 'QUEUED' || value === 'SCHEDULED')) {
    return true;
  }

  return fallbackPending;
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
  const remainingAmount = Number(Math.max(0, bookingPrice - paidAmount).toFixed(2));
  const fallbackHoverStatus: Booking['hoverPayment']['status'] =
    bookingPrice <= 0 || remainingAmount <= 0.009
      ? 'PAID'
      : paidAmount > 0.009
        ? 'PARTIAL'
        : 'UNPAID';
  const resolvedTitle = normalizeBookingDisplayTitle(
    booking?.client?.name || booking?.clientName || booking?.activity?.name,
    'Reserva'
  );
  const hoverPaymentRaw =
    booking?.hoverPayment && typeof booking.hoverPayment === 'object'
      ? (booking.hoverPayment as Record<string, unknown>)
      : null;
  const participantsCount = resolveBookingParticipantsCount(booking, hoverPaymentRaw, resolvedTitle);
  const hasPendingNotification = resolveHasPendingNotification(booking, state === 'pending');
  const hoverPaymentStatusRaw = String(hoverPaymentRaw?.status || '').trim().toUpperCase();
  const hoverPaymentStatus: Booking['hoverPayment']['status'] =
    hoverPaymentStatusRaw === 'PAID' || hoverPaymentStatusRaw === 'PARTIAL' || hoverPaymentStatusRaw === 'UNPAID'
      ? (hoverPaymentStatusRaw as Booking['hoverPayment']['status'])
      : fallbackHoverStatus;
  const paymentState: Booking['paymentState'] =
    bookingPrice <= 0 || paidAmount + 0.009 >= bookingPrice
      ? 'paid'
      : paidAmount > 0.009
        ? 'partial'
        : 'unpaid';

  return {
    id: String(booking?.id || slot?.id || `${slot?.courtId}-${slot?.slotTime || start.toISOString()}`),
    courtId: String(slot?.courtId || booking?.courtId || booking?.court?.id || ''),
    startSlot,
    endSlot,
    title: resolvedTitle,
    state,
    paymentState,
    isRecurring: Number(booking?.fixedBookingId || 0) > 0,
    participantsCount,
    hasPendingNotification,
    fixedBookingId: Number.isFinite(Number(booking?.fixedBookingId)) ? Number(booking.fixedBookingId) : undefined,
    clientId: booking?.client?.id ? String(booking.client.id) : undefined,
    userId: Number(booking?.userId || booking?.user?.id || 0) || undefined,
    hoverPayment: {
      status: hoverPaymentStatus,
      totalAmount: Number(Number(hoverPaymentRaw?.totalAmount ?? bookingPrice).toFixed(2)),
      paidAmount: Number(Number(hoverPaymentRaw?.paidAmount ?? paidAmount).toFixed(2)),
      remainingAmount: Number(Number(hoverPaymentRaw?.remainingAmount ?? remainingAmount).toFixed(2)),
      chargeMode: String(hoverPaymentRaw?.chargeMode || 'INDIVIDUAL'),
      chargeResponsibleRef: hoverPaymentRaw?.chargeResponsibleRef
        ? String(hoverPaymentRaw.chargeResponsibleRef)
        : null,
      chargeResponsibleName: hoverPaymentRaw?.chargeResponsibleName
        ? String(hoverPaymentRaw.chargeResponsibleName)
        : null,
      latestPayerRef: hoverPaymentRaw?.latestPayerRef ? String(hoverPaymentRaw.latestPayerRef) : null,
      latestPayerName: hoverPaymentRaw?.latestPayerName ? String(hoverPaymentRaw.latestPayerName) : null,
      latestCoveredRef: hoverPaymentRaw?.latestCoveredRef ? String(hoverPaymentRaw.latestCoveredRef) : null,
      latestCoveredName: hoverPaymentRaw?.latestCoveredName ? String(hoverPaymentRaw.latestCoveredName) : null,
      participants: Array.isArray(hoverPaymentRaw?.participants)
        ? hoverPaymentRaw.participants
            .map((rawParticipant: any) => ({
              ref: String(rawParticipant?.ref || '').trim(),
              name: String(rawParticipant?.name || '').trim(),
              isOwner: Boolean(rawParticipant?.isOwner),
            }))
            .filter((participant: { ref: string; name: string }) => participant.ref || participant.name)
        : undefined,
      payerParticipants: Array.isArray(hoverPaymentRaw?.payerParticipants)
        ? hoverPaymentRaw.payerParticipants
            .map((rawPayer: any) => ({
              ref: rawPayer?.ref ? String(rawPayer.ref).trim() : null,
              name: rawPayer?.name ? String(rawPayer.name).trim() : null,
              amount: Number(rawPayer?.amount || 0),
            }))
            .filter((payer: { ref: string | null; name: string | null; amount: number }) =>
              Boolean(payer.ref || payer.name || (Number.isFinite(payer.amount) && payer.amount > 0.009))
            )
        : undefined,
      coveredParticipants: Array.isArray(hoverPaymentRaw?.coveredParticipants)
        ? hoverPaymentRaw.coveredParticipants
            .map((rawCovered: any) => ({
              ref: rawCovered?.ref ? String(rawCovered.ref).trim() : null,
              name: rawCovered?.name ? String(rawCovered.name).trim() : null,
              amount: Number(rawCovered?.amount || 0),
            }))
            .filter((covered: { ref: string | null; name: string | null; amount: number }) =>
              Boolean(covered.ref || covered.name || (Number.isFinite(covered.amount) && covered.amount > 0.009))
            )
        : undefined,
    },
  };
}

function roundMoney(value: number) {
  return Number((Math.max(0, value) || 0).toFixed(2));
}

function normalizeClubProductOption(raw: any): ClubProductOption | null {
  const id = Number(raw?.id || 0);
  const name = String(raw?.name || '').trim();
  const price = Number(raw?.price || 0);
  const stockRaw = raw?.stock;
  const stock =
    stockRaw === null || stockRaw === undefined
      ? null
      : Number.isFinite(Number(stockRaw))
        ? Number(stockRaw)
        : null;
  const isActive = raw?.isActive === undefined ? true : Boolean(raw?.isActive);
  if (!Number.isFinite(id) || id <= 0 || name.length === 0) return null;
  return {
    id,
    name,
    price: Number.isFinite(price) ? roundMoney(price) : 0,
    stock,
    isActive,
  };
}

function normalizeBookingConsumptionItem(raw: any): BookingConsumptionItem | null {
  const type = String(raw?.type || raw?.itemType || raw?.kind || 'PRODUCT')
    .trim()
    .toUpperCase();
  const fallbackId = `${type}-${String(raw?.productId || raw?.product?.id || 'x')}-${String(
    raw?.description || raw?.name || raw?.title || 'item'
  )
    .trim()
    .toLowerCase()}`;
  const id = String(
    raw?.id ??
      raw?.accountItemId ??
      raw?.itemId ??
      raw?.bookingItemId ??
      raw?.conceptId ??
      fallbackId
  ).trim();
  if (!id) return null;

  const quantity = Math.max(1, Math.round(Number(raw?.quantity ?? raw?.qty ?? 1)));
  const unitPrice = roundMoney(Number(raw?.price ?? raw?.unitPrice ?? raw?.unitAmount ?? 0));
  const paidAmount = roundMoney(
    Number(raw?.paidAmount ?? raw?.paid ?? raw?.coveredAmount ?? 0)
  );
  const remainingAmountRaw = Number(
    raw?.remainingAmount ?? raw?.remaining ?? raw?.pendingAmount ?? raw?.debt ?? NaN
  );
  const totalRaw = Number(raw?.totalPrice ?? raw?.total ?? raw?.amount ?? NaN);
  const totalPrice = roundMoney(
    Number.isFinite(totalRaw)
      ? totalRaw
      : Number.isFinite(remainingAmountRaw)
        ? Math.max(0, remainingAmountRaw + paidAmount)
        : Math.max(0, unitPrice * quantity)
  );
  const remainingAmount = roundMoney(
    Number.isFinite(remainingAmountRaw)
      ? remainingAmountRaw
      : Math.max(0, totalPrice - paidAmount)
  );
  return {
    id,
    productId: Number.isFinite(Number(raw?.productId ?? raw?.product?.id))
      ? Number(raw?.productId ?? raw?.product?.id)
      : null,
    description:
      String(raw?.description || raw?.name || raw?.title || (type === 'BOOKING' ? 'Cancha' : 'Consumo')).trim() ||
      (type === 'BOOKING' ? 'Cancha' : 'Consumo'),
    quantity,
    unitPrice,
    totalPrice,
    paidAmount,
    remainingAmount,
    type,
  };
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

function distributeAmountByParticipants(totalAmount: number, participantIds: string[]) {
  const distribution = new Map<string, number>();
  const ids = Array.isArray(participantIds)
    ? participantIds
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0)
    : [];
  if (ids.length === 0) return distribution;

  const safeTotalCents = Math.max(0, Math.round(Number(totalAmount || 0) * 100));
  const baseCents = Math.floor(safeTotalCents / ids.length);
  let remainderCents = safeTotalCents - baseCents * ids.length;

  ids.forEach((id) => {
    let cents = baseCents;
    if (remainderCents > 0) {
      cents += 1;
      remainderCents -= 1;
    }
    distribution.set(id, Number((cents / 100).toFixed(2)));
  });

  return distribution;
}

function allocatePaymentProportionallyByDebt(input: {
  amount: number;
  participantDebts: Array<{ participantId: string; debt: number }>;
}) {
  const amountCents = Math.round(Number(input.amount || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return [] as Array<{
    coveredParticipantId: string;
    amount: number;
  }>;

  const normalizedRows = (Array.isArray(input.participantDebts) ? input.participantDebts : [])
    .map((row, index) => ({
      participantId: String(row.participantId || '').trim(),
      debtCents: Math.round(Number(row.debt || 0) * 100),
      index,
    }))
    .filter((row) => row.participantId.length > 0 && Number.isFinite(row.debtCents) && row.debtCents > 0);
  if (normalizedRows.length === 0) {
    return [] as Array<{ coveredParticipantId: string; amount: number }>;
  }

  const totalDebtCents = normalizedRows.reduce((sum, row) => sum + row.debtCents, 0);
  if (!Number.isFinite(totalDebtCents) || totalDebtCents <= 0 || amountCents > totalDebtCents) {
    return [] as Array<{ coveredParticipantId: string; amount: number }>;
  }

  const rows = normalizedRows.map((row) => {
    const rawShare = amountCents * row.debtCents;
    const allocatedCents = Math.floor(rawShare / totalDebtCents);
    const fractionalNumerator = rawShare % totalDebtCents;
    return {
      ...row,
      allocatedCents,
      fractionalNumerator,
    };
  });

  let remainderCents = amountCents - rows.reduce((sum, row) => sum + row.allocatedCents, 0);
  if (remainderCents > 0) {
    const priorityRows = [...rows].sort((left, right) => {
      const byFraction = right.fractionalNumerator - left.fractionalNumerator;
      if (byFraction !== 0) return byFraction;
      const byDebt = right.debtCents - left.debtCents;
      if (byDebt !== 0) return byDebt;
      return left.index - right.index;
    });

    while (remainderCents > 0) {
      let distributedInRound = false;
      for (const row of priorityRows) {
        if (remainderCents <= 0) break;
        if (row.allocatedCents >= row.debtCents) continue;
        row.allocatedCents += 1;
        remainderCents -= 1;
        distributedInRound = true;
      }
      if (!distributedInRound) {
        return [] as Array<{ coveredParticipantId: string; amount: number }>;
      }
    }
  }

  return rows
    .filter((row) => row.allocatedCents > 0)
    .map((row) => ({
      coveredParticipantId: row.participantId,
      amount: Number((row.allocatedCents / 100).toFixed(2)),
    }));
}

function resolveChargedParticipantIds(
  participants: Participant[],
  paymentMode: PaymentMode,
  singleChargeParticipantId?: string
) {
  if (paymentMode === 'Único') {
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

function resolvePlaygroundClientPhone(owner?: Participant | null) {
  const fromContact = extractPhoneFromParticipantContact(owner?.contact);
  if (fromContact.length >= 8) {
    return fromContact.startsWith('54') ? `+${fromContact}` : `+54${fromContact}`;
  }

  return '';
}

function resolvePlaygroundClientEmail(owner?: Participant | null) {
  return extractEmailFromParticipantContact(owner?.contact);
}

function extractEmailFromParticipantContact(contact: unknown) {
  const raw = String(contact || '').trim();
  const match = raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  return match ? match[0].toLowerCase() : '';
}

function extractPhoneFromParticipantContact(contact: unknown) {
  const raw = String(contact || '').trim();
  const email = extractEmailFromParticipantContact(raw);
  const withoutEmail = email ? raw.replace(email, ' ') : raw;
  return withoutEmail.replace(/\D/g, '');
}

function buildParticipantContactFromFields(phone: unknown, email: unknown) {
  const safePhone = String(phone || '').trim();
  const safeEmail = String(email || '').trim().toLowerCase();
  if (safePhone && safeEmail) return `${safePhone} · ${safeEmail}`;
  return safePhone || safeEmail || '';
}

function resolveParticipantClientId(participant?: Participant | null) {
  const ref = String(participant?.entityRef || '').trim();
  if (ref.startsWith('client:')) {
    const raw = ref.slice('client:'.length).trim();
    return raw.startsWith('client-') ? raw.slice('client-'.length).trim() : raw;
  }
  if (ref.startsWith('booking-client:')) return ref.slice('booking-client:'.length).trim();
  return '';
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
          id: 'owner',
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
      const isOwner = Boolean(rawParticipant.isOwner) || isOwnerLikeParticipantRef(rawRef) || isOwnerLikeParticipantId(rawId);
      const baseToken = rawRef || rawId || rawName || `participant-${index + 1}`;
      return {
        id: isOwner ? 'owner' : (rawId || `meta-${index}-${toSlugToken(baseToken)}`),
        name: rawName,
        contact: rawContact,
        paid: Boolean(rawParticipant.paid),
        isOwner,
        sourceType: normalizeParticipantSourceType(rawParticipant.sourceType),
        entityRef: rawRef || undefined,
        paymentMethod: normalizeParticipantPaymentMethod(rawParticipant.paymentMethod),
        customPrice: null,
      } satisfies Participant;
    })
    .filter((participant): participant is NonNullable<typeof participant> => Boolean(participant));

  if (mapped.length === 0) return buildDefaultParticipantsForBooking(booking);
  if (!mapped.some((participant) => participant.isOwner)) {
    mapped[0] = { ...mapped[0], id: 'owner', isOwner: true };
  } else {
    let ownerFixed = false;
    for (let i = 0; i < mapped.length; i += 1) {
      if (!mapped[i].isOwner || ownerFixed) continue;
      mapped[i] = { ...mapped[i], id: 'owner' };
      ownerFixed = true;
    }
  }
  return mapped;
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
      paymentMethod: normalizeParticipantPaymentMethod(participant.paymentMethod),
    }))
    .sort((left, right) => {
      const ownerDiff = Number(right.isOwner) - Number(left.isOwner);
      if (ownerDiff !== 0) return ownerDiff;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      const byContact = left.contact.localeCompare(right.contact);
      if (byContact !== 0) return byContact;
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

function buildComparableBillingFromDrawerDraft(draft?: NewBookingDrawerDraft | null) {
  if (!draft) return null;
  const participants = (Array.isArray(draft.participants) ? draft.participants : [])
    .map((participant) => ({
      id: String(participant.id || ''),
      identity: [
        participant.bookingRole === 'BOOKING_RESPONSIBLE' ? 'OWNER' : 'PARTICIPANT',
        normalizeParticipantText(String(participant.displayName || '')),
        normalizeParticipantText(String(participant.contact || '')),
        Boolean(participant.archived) ? 'ARCHIVED' : 'ACTIVE',
      ].join('|'),
      archived: Boolean(participant.archived),
    }))
    .sort((left, right) => {
      const byIdentity = left.identity.localeCompare(right.identity);
      if (byIdentity !== 0) return byIdentity;
      return left.id.localeCompare(right.id);
    });

  const assignmentByParticipantId = new Map<
    string,
    {
      isChargeable: boolean;
      assignedAmount: number;
      participantLinkState: 'ACTIVE' | 'ARCHIVED_REFERENCE';
    }
  >();
  (Array.isArray(draft.billing.assignments) ? draft.billing.assignments : []).forEach((assignment) => {
    const participantId = String(assignment.participantId || '');
    if (!participantId || assignmentByParticipantId.has(participantId)) return;
    assignmentByParticipantId.set(participantId, {
      isChargeable: Boolean(assignment.isChargeable),
      assignedAmount: Number(Number(assignment.assignedAmount || 0).toFixed(2)),
      participantLinkState:
        assignment.participantLinkState === 'ARCHIVED_REFERENCE'
          ? 'ARCHIVED_REFERENCE'
          : 'ACTIVE',
    });
  });

  const participantBillingRows = participants.map((participant) => {
    const assignment = assignmentByParticipantId.get(participant.id);
    const isArchived = participant.archived;
    const isChargeable = !isArchived && Boolean(assignment?.isChargeable);
    return {
      participantIdentity: participant.identity,
      isChargeable,
      assignedAmount: isChargeable ? Number(Number(assignment?.assignedAmount || 0).toFixed(2)) : 0,
      archived: isArchived,
    };
  });

  const groupedByIdentity = new Map<
    string,
    {
      count: number;
      archivedCount: number;
      chargeableCount: number;
      assignedAmountTotal: number;
    }
  >();
  participantBillingRows.forEach((row) => {
    const key = row.participantIdentity;
    const current = groupedByIdentity.get(key) || {
      count: 0,
      archivedCount: 0,
      chargeableCount: 0,
      assignedAmountTotal: 0,
    };
    current.count += 1;
    if (row.archived) current.archivedCount += 1;
    if (row.isChargeable) current.chargeableCount += 1;
    current.assignedAmountTotal = Number(
      Number(current.assignedAmountTotal + Number(row.assignedAmount || 0)).toFixed(2)
    );
    groupedByIdentity.set(key, current);
  });

  const participantGroups = Array.from(groupedByIdentity.entries())
    .map(([participantIdentity, metrics]) => ({
      participantIdentity,
      count: metrics.count,
      archivedCount: metrics.archivedCount,
      chargeableCount: metrics.chargeableCount,
      assignedAmountTotal: Number(Number(metrics.assignedAmountTotal || 0).toFixed(2)),
    }))
    .sort((left, right) => left.participantIdentity.localeCompare(right.participantIdentity));

  return {
    chargeMode: draft.billing.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
    totalAmount: Number(Number(draft.billing.financialSummary.totalAmount || 0).toFixed(2)),
    participantGroups,
  };
}

function isBlockingQuoteError(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const blockers = [
    'no se pueden reservar turnos en el pasado',
    'duracion no permitida por el club',
    'horario no permitido por el club',
    'el club esta cerrado ese dia',
    'el club esta cerrado para la fecha seleccionada',
    'la actividad esta cerrada para la fecha seleccionada',
    'la actividad esta cerrada para la fecha solicitada',
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
  if (full.includes('futbol') || full.includes('futbol 5')) return 'Fútbol';
  if (full.includes('padel') || full.includes('paddle')) return 'Pádel';

  return String(courtLike?.activityType?.name || courtLike?.sport || courtLike?.surface || 'Pádel');
}

export default function AdminAgendaPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [sportFilter, setSportFilter] = useState<SportFilter>('Todos');
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
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedStartSlot, setSelectedStartSlot] = useState(2);
  const [selectedEndSlot, setSelectedEndSlot] = useState(4);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Único');
  const [participantPriceDraftById, setParticipantPriceDraftById] = useState<Record<string, string>>({});
  const [defaultPricePerParticipant, setDefaultPricePerParticipant] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [simplifiedOwnerAdded, setSimplifiedOwnerAdded] = useState(false);
  const [simplifiedOwnerPaymentMethodDraft, setSimplifiedOwnerPaymentMethodDraft] = useState('');
  const [simplifiedEditingParticipantId, setSimplifiedEditingParticipantId] = useState<string | null>(null);
  const [simplifiedEditPaymentMethodDraft, setSimplifiedEditPaymentMethodDraft] = useState('');
  const [simplifiedNewParticipantOpen, setSimplifiedNewParticipantOpen] = useState(false);
  const [simplifiedNewParticipantName, setSimplifiedNewParticipantName] = useState('');
  const [simplifiedNewParticipantContact, setSimplifiedNewParticipantContact] = useState('');
  const [simplifiedNewParticipantSourceTypeDraft, setSimplifiedNewParticipantSourceTypeDraft] =
    useState<Participant['sourceType']>('guest');
  const [simplifiedNewParticipantEntityRefDraft, setSimplifiedNewParticipantEntityRefDraft] = useState('');
  const [simplifiedOwnerSuggestionsOpen, setSimplifiedOwnerSuggestionsOpen] = useState(false);
  const [simplifiedOwnerSearchLoading, setSimplifiedOwnerSearchLoading] = useState(false);
  const [simplifiedOwnerSuggestions, setSimplifiedOwnerSuggestions] = useState<ParticipantSuggestion[]>([]);
  const [simplifiedNewParticipantSuggestionsOpen, setSimplifiedNewParticipantSuggestionsOpen] =
    useState(false);
  const [simplifiedNewParticipantSearchLoading, setSimplifiedNewParticipantSearchLoading] =
    useState(false);
  const [simplifiedNewParticipantSuggestions, setSimplifiedNewParticipantSuggestions] = useState<
    ParticipantSuggestion[]
  >([]);
  const [simplifiedOwnerSuggestionsPlacement, setSimplifiedOwnerSuggestionsPlacement] =
    useState<SuggestionPlacement | null>(null);
  const [simplifiedNewParticipantSuggestionsPlacement, setSimplifiedNewParticipantSuggestionsPlacement] =
    useState<SuggestionPlacement | null>(null);
  const [simplifiedSuggestionsPositionTick, setSimplifiedSuggestionsPositionTick] = useState(0);
  const [activePaymentModal, setActivePaymentModal] = useState<PaymentModalState>(null);
  const [simplifiedPaymentPayerParticipantIdDraft, setSimplifiedPaymentPayerParticipantIdDraft] = useState('');
  const [simplifiedPaymentCoveredParticipantIdDraft, setSimplifiedPaymentCoveredParticipantIdDraft] = useState('');
  const [simplifiedPaymentCoveredParticipantIdsDraft, setSimplifiedPaymentCoveredParticipantIdsDraft] = useState<string[]>([]);
  const [simplifiedPaymentAmountDraft, setSimplifiedPaymentAmountDraft] = useState('');
  const [simplifiedPaymentMethodDraft, setSimplifiedPaymentMethodDraft] = useState('');
  const [simplifiedPaymentModalVariant, setSimplifiedPaymentModalVariant] =
    useState<'LEGACY' | 'PLAYTOMIC'>('PLAYTOMIC');
  const [simplifiedPaymentQuickPreset, setSimplifiedPaymentQuickPreset] =
    useState<PaymentQuickPreset>('MY_SHARE');
  const [simplifiedPaymentImputationMode, setSimplifiedPaymentImputationMode] =
    useState<PaymentImputationMode>('BY_PARTICIPANT');
  const [simplifiedPaymentConceptMode, setSimplifiedPaymentConceptMode] =
    useState<PaymentConceptMode>('AUTO');
  const [simplifiedPaymentSelectedItemIdsDraft, setSimplifiedPaymentSelectedItemIdsDraft] = useState<string[]>([]);
  const [simplifiedPaymentCustomItemAmountDraftById, setSimplifiedPaymentCustomItemAmountDraftById] =
    useState<Record<string, string>>({});
  const [simplifiedSinglePaymentAdvancedOpen, setSimplifiedSinglePaymentAdvancedOpen] = useState(false);
  const [playtomicResultModal, setPlaytomicResultModal] = useState<PlaytomicPaymentResultModal | null>(null);
  const [simplifiedSidebarSection, setSimplifiedSidebarSection] = useState<SimplifiedSidebarSection>('DETAILS');
  const [consumptionProducts, setConsumptionProducts] = useState<ClubProductOption[]>([]);
  const [consumptionProductsLoading, setConsumptionProductsLoading] = useState(false);
  const [consumptionProductsError, setConsumptionProductsError] = useState('');
  const [bookingConsumptionItems, setBookingConsumptionItems] = useState<BookingConsumptionItem[]>([]);
  const [bookingAccountItems, setBookingAccountItems] = useState<BookingConsumptionItem[]>([]);
  const [bookingConsumptionLoading, setBookingConsumptionLoading] = useState(false);
  const [bookingConsumptionError, setBookingConsumptionError] = useState('');
  const [consumptionProductDraft, setConsumptionProductDraft] = useState('');
  const [consumptionQuantityDraft, setConsumptionQuantityDraft] = useState('1');
  const [consumptionApplyDiscountDraft, setConsumptionApplyDiscountDraft] = useState(true);
  const [consumptionQuoteLoading, setConsumptionQuoteLoading] = useState(false);
  const [consumptionQuoteError, setConsumptionQuoteError] = useState('');
  const [consumptionQuote, setConsumptionQuote] = useState<{
    listTotal: number;
    finalTotal: number;
    discountAmount: number;
    hasDiscount: boolean;
  } | null>(null);
  const [consumptionAddInFlight, setConsumptionAddInFlight] = useState(false);
  const [consumptionRemovingId, setConsumptionRemovingId] = useState<string | null>(null);
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
    courtTotal: number;
    itemsTotal: number;
    total: number;
    paid: number;
    remaining: number;
    confirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
  } | null>(null);
  const [remoteBillingConfig, setRemoteBillingConfig] = useState<BookingBillingConfig | null>(null);
  const [isRemoteBillingConfigLoading, setIsRemoteBillingConfigLoading] = useState(false);
  const [isBillingConfigHydrated, setIsBillingConfigHydrated] = useState(false);
  const [billingConfigLoadError, setBillingConfigLoadError] = useState('');
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
  const [recurringResult, setRecurringResult] = useState<{
    generatedCount: number;
    skippedCount: number;
    courtsCount: number;
    hasExplicitLimit: boolean;
  } | null>(null);
  const [recurringCreatedItems, setRecurringCreatedItems] = useState<RecurringCreatedItem[]>([]);
  const [recurringOverlapItems, setRecurringOverlapItems] = useState<RecurringOverlapItem[]>([]);
  const [recurringOverlapModalOpen, setRecurringOverlapModalOpen] = useState(false);
  const [recurringCreateConfirmOpen, setRecurringCreateConfirmOpen] = useState(false);
  const [recurringPreviewSummary, setRecurringPreviewSummary] = useState<{
    generatedCount: number;
    skippedCount: number;
    courtsCount: number;
  } | null>(null);
  const isRecurringKind = bookingKind === 'recurringV2';
  const [deleteBookingConfirmOpen, setDeleteBookingConfirmOpen] = useState(false);
  const [deleteBookingFinalConfirmOpen, setDeleteBookingFinalConfirmOpen] = useState(false);
  const [cancelRefundAmountInput, setCancelRefundAmountInput] = useState('');
  const [cancelRefundReasonType, setCancelRefundReasonType] = useState<CancelRefundReasonType>('FULL');
  const [cancelRefundExecutionNotes, setCancelRefundExecutionNotes] = useState('');
  const [cancelRefundExecuteNow, setCancelRefundExecuteNow] = useState(true);
  const [cancelBookingFlowError, setCancelBookingFlowError] = useState('');
  const [deleteParticipantConfirm, setDeleteParticipantConfirm] = useState<{
    open: boolean;
    participantId: string | null;
    participantName: string;
  }>({ open: false, participantId: null, participantName: '' });
  const [blockingErrorModalOpen, setBlockingErrorModalOpen] = useState(false);
  const [bookingCreatedModalOpen, setBookingCreatedModalOpen] = useState(false);
  const [duplicateDecisionOpen, setDuplicateDecisionOpen] = useState(false);
  const [duplicateDecisionLoading, setDuplicateDecisionLoading] = useState(false);
  const [duplicateDecisionError, setDuplicateDecisionError] = useState('');
  const [duplicateDecisionCandidates, setDuplicateDecisionCandidates] = useState<DuplicateClientCandidate[]>([]);
  const [duplicateDecisionSelectedClientId, setDuplicateDecisionSelectedClientId] = useState('');
  const [duplicateDecisionPendingPayload, setDuplicateDecisionPendingPayload] = useState<{
    courtId: number;
    activityId: number;
    bookingDate: Date;
    slotTime: string;
    durationMinutes: number;
    ownerName: string;
    ownerPhone: string;
    ownerEmail: string;
  } | null>(null);
  const [changeTitularModalOpen, setChangeTitularModalOpen] = useState(false);
  const [changeTitularSearch, setChangeTitularSearch] = useState('');
  const [changeTitularReason, setChangeTitularReason] = useState('');
  const [changeTitularLoading, setChangeTitularLoading] = useState(false);
  const [changeTitularSubmitting, setChangeTitularSubmitting] = useState(false);
  const [changeTitularError, setChangeTitularError] = useState('');
  const [changeTitularCandidates, setChangeTitularCandidates] = useState<Array<{ id: string; name: string; phone?: string; email?: string }>>([]);
  const [changeTitularSelectedClientId, setChangeTitularSelectedClientId] = useState('');
  const [bookingKindMenuOpen, setBookingKindMenuOpen] = useState(false);
  const [editSeriesScopeModalOpen, setEditSeriesScopeModalOpen] = useState(false);
  const [pendingSeriesScopeSave, setPendingSeriesScopeSave] = useState<EditSeriesScope | null>(null);
  const [seriesEditPreviewLoading, setSeriesEditPreviewLoading] = useState(false);
  const [seriesEditPreviewScope, setSeriesEditPreviewScope] = useState<EditSeriesScope | null>(null);
  const [seriesEditPreviewSummary, setSeriesEditPreviewSummary] = useState<SeriesScopePreviewSummary | null>(null);
  const [deleteSeriesScopeModalOpen, setDeleteSeriesScopeModalOpen] = useState(false);
  const [seriesDeletePreviewLoading, setSeriesDeletePreviewLoading] = useState(false);
  const [seriesDeletePreviewScope, setSeriesDeletePreviewScope] = useState<EditSeriesScope | null>(null);
  const [seriesDeletePreviewSummary, setSeriesDeletePreviewSummary] = useState<SeriesScopePreviewSummary | null>(null);
  const [seriesOperationResult, setSeriesOperationResult] = useState<SeriesOperationResult | null>(null);
  const [seriesOperationResultOpen, setSeriesOperationResultOpen] = useState(false);
  const [scheduleInputsDirty, setScheduleInputsDirty] = useState(false);
  const [paymentInFlightId, setPaymentInFlightId] = useState<string | null>(null);
  const [participantUiState, setParticipantUiState] = useState<ParticipantUiState>({
    mode: 'idle',
    participantId: null,
  });
  const [participantSearchOpenId, setParticipantSearchOpenId] = useState<string | null>(null);
  const [participantSearchLoadingId, setParticipantSearchLoadingId] = useState<string | null>(null);
  const [participantSuggestionsById, setParticipantSuggestionsById] = useState<Record<string, ParticipantSuggestion[]>>({});
  const [billingHubTab, setBillingHubTab] = useState<'SUMMARY' | 'ASSIGNMENTS' | 'PAYMENTS'>('SUMMARY');
  const [bookingDrawerState, bookingDrawerDispatch] = useReducer(
    bookingDrawerReducer,
    initialBookingDrawerState
  );
  const [recurringCourtsMenuOpen, setRecurringCourtsMenuOpen] = useState(false);
  const [selectedClubIdState, setSelectedClubIdState] = useState<number>(0);
  const [bookingHoverPreview, setBookingHoverPreview] = useState<{
    booking: Booking;
    x: number;
    y: number;
  } | null>(null);
  const [calendarNotice, setCalendarNotice] = useState<{
    message: string;
    tone: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);
  const [participantLabelByRefCache, setParticipantLabelByRefCache] = useState<Record<string, string>>({});
  const [isQuickDatePickerOpen, setIsQuickDatePickerOpen] = useState(false);
  const participantSearchSeqRef = useRef(0);
  const recurringCourtsMenuRef = useRef<HTMLDivElement | null>(null);
  const quickDateInputRef = useRef<HTMLInputElement | null>(null);
  const participantContactInputRef = useRef<HTMLInputElement | null>(null);
  const simplifiedOwnerInputContainerRef = useRef<HTMLDivElement | null>(null);
  const simplifiedNewParticipantInputContainerRef = useRef<HTMLDivElement | null>(null);
  const simplifiedSidebarFooterRef = useRef<HTMLElement | null>(null);
  const agendaSurfaceRef = useRef<HTMLElement | null>(null);
  const agendaScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrollDateKeyRef = useRef<string | null>(null);
  const drawerScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const calendarNoticeTimerRef = useRef<number | null>(null);
  const drawerCloseCleanupTimerRef = useRef<number | null>(null);
  const bookingFinancialRequestSeqRef = useRef(0);
  const bookingTimelineRequestSeqRef = useRef(0);
  const remoteBillingConfigRequestSeqRef = useRef(0);
  const bookingConsumptionRequestSeqRef = useRef(0);
  const consumptionQuoteRequestSeqRef = useRef(0);
  const bookingDrawerLoadKeyRef = useRef<string>('');
  const bookingDrawerFormSyncSignatureRef = useRef<string>('');
  const pendingParticipantSaveNoticeRef = useRef<string>('');
  const participantMenuId =
    participantUiState.mode === 'menu' ? participantUiState.participantId : null;
  const expandedParticipantId =
    participantUiState.mode === 'editing' ? participantUiState.participantId : null;
  const setParticipantMenuId = useCallback((value: SetStateAction<string | null>) => {
    setParticipantUiState((previous) => {
      const previousMenuId = previous.mode === 'menu' ? previous.participantId : null;
      const nextMenuId =
        typeof value === 'function'
          ? (value as (previous: string | null) => string | null)(previousMenuId)
          : value;
      if (nextMenuId === previousMenuId) return previous;
      if (!nextMenuId) {
        if (previous.mode === 'menu') return { mode: 'idle', participantId: null };
        return previous;
      }
      return { mode: 'menu', participantId: nextMenuId };
    });
  }, []);
  const setExpandedParticipantId = useCallback((value: SetStateAction<string | null>) => {
    setParticipantUiState((previous) => {
      const previousEditingId = previous.mode === 'editing' ? previous.participantId : null;
      const nextEditingId =
        typeof value === 'function'
          ? (value as (previous: string | null) => string | null)(previousEditingId)
          : value;
      if (nextEditingId === previousEditingId) return previous;
      if (!nextEditingId) {
        if (previous.mode === 'editing') return { mode: 'idle', participantId: null };
        return previous;
      }
      return { mode: 'editing', participantId: nextEditingId };
    });
  }, []);
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
  const activeTenantRole = useMemo(() => {
    const memberships = Array.isArray((normalizedUser as any)?.memberships)
      ? (normalizedUser as any).memberships
      : [];
    const activeClubId = Number((normalizedUser as any)?.activeClubId || selectedClubIdState || 0);
    const activeMembership = memberships.find((membership: any) => Number(membership?.clubId || 0) === activeClubId);
    return String(activeMembership?.role || '').trim().toUpperCase();
  }, [normalizedUser, selectedClubIdState]);
  const canChangeTitularFromUi = activeTenantRole === 'OWNER' || activeTenantRole === 'ADMIN';

  const showCalendarNotice = useCallback((
    message: string,
    tone: 'info' | 'success' | 'warning' | 'error' = 'error'
  ) => {
    const next = toUserSafeMessage(message, '');
    if (!next) return;
    setCalendarNotice({ message: next, tone });
    if (calendarNoticeTimerRef.current) {
      window.clearTimeout(calendarNoticeTimerRef.current);
    }
    calendarNoticeTimerRef.current = window.setTimeout(() => {
      setCalendarNotice(null);
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

  const closeDuplicateDecisionModal = useCallback(() => {
    setDuplicateDecisionOpen(false);
    setDuplicateDecisionLoading(false);
    setDuplicateDecisionError('');
    setDuplicateDecisionCandidates([]);
    setDuplicateDecisionSelectedClientId('');
    setDuplicateDecisionPendingPayload(null);
  }, []);

  const extractDuplicateCandidatesFromMeta = useCallback((meta?: Record<string, unknown>) => {
    const directCandidates = Array.isArray(meta?.candidates) ? meta.candidates : [];
    const fallbackCandidates = Array.isArray(meta?.candidateClients) ? meta.candidateClients : [];
    const candidateIds = Array.isArray(meta?.candidateClientIds) ? meta?.candidateClientIds : [];
    const source = directCandidates.length > 0 ? directCandidates : fallbackCandidates;

    const parsedFromObjects: DuplicateClientCandidate[] = source
      .map((item: any) => ({
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim() || 'Cliente sin nombre',
        phone: String(item?.phone || '').trim() || undefined,
        email: String(item?.email || '').trim() || undefined,
      }))
      .filter((item) => item.id.length > 0);

    if (parsedFromObjects.length > 0) return parsedFromObjects;

    return (Array.isArray(candidateIds) ? candidateIds : [])
      .map((rawId: unknown) => String(rawId || '').trim())
      .filter((id: string) => id.length > 0)
      .map((id: string) => ({
        id,
        name: `Cliente ${id.slice(0, 8)}`,
      }));
  }, []);

  async function runDuplicateDecisionRetry(mode: 'USE_EXISTING' | 'CREATE_NEW') {
    const payload = duplicateDecisionPendingPayload;
    if (!payload) return;
    const selectedClientId = String(duplicateDecisionSelectedClientId || '').trim();
    if (mode === 'USE_EXISTING' && !selectedClientId) {
      setDuplicateDecisionError('Seleccioná un cliente existente para continuar.');
      return;
    }

    setDuplicateDecisionLoading(true);
    setDuplicateDecisionError('');
    try {
      const createdPayload: any = await createBooking(payload.courtId, payload.activityId, payload.bookingDate, payload.slotTime, {
        durationMinutes: payload.durationMinutes,
        ...(mode === 'USE_EXISTING'
          ? { clientId: selectedClientId }
          : {
              client: {
                name: payload.ownerName,
                phone: payload.ownerPhone,
                email: payload.ownerEmail,
                duplicateResolution: 'CREATE_NEW',
              },
            }),
      });

      const maybeId = Number(createdPayload?.booking?.id ?? createdPayload?.id ?? createdPayload?.bookingId);
      if (Number.isFinite(maybeId) && maybeId > 0) {
        const bookingPayload =
          createdPayload?.booking && typeof createdPayload.booking === 'object'
            ? createdPayload.booking
            : createdPayload;
        let createdBookingClientIdRaw = String(
          bookingPayload?.clientId || bookingPayload?.client?.id || ''
        ).trim();
        let createdBookingClientName = String(
          bookingPayload?.client?.name || bookingPayload?.clientName || ''
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
            createdBookingClientName = String(
              hydratedBooking?.client?.name || hydratedBooking?.clientName || createdBookingClientName
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
          bookingClientName: createdBookingClientName || undefined,
        });
      }

      await reloadSchedule();
      closeDuplicateDecisionModal();
      setFormError('');
      setDrawerOpen(false);
      showCalendarNotice(
        mode === 'USE_EXISTING'
          ? 'Reserva creada con el cliente existente seleccionado.'
          : 'Reserva creada como cliente nuevo (duplicado permitido).',
        'success'
      );
    } catch (error: any) {
      const normalized = normalizeApiError(error, 'No se pudo crear la reserva.');
      if (normalized.code === 'CLIENT_POSSIBLE_DUPLICATE') {
        const nextCandidates = extractDuplicateCandidatesFromMeta(normalized.meta);
        if (nextCandidates.length > 0) {
          setDuplicateDecisionCandidates(nextCandidates);
          setDuplicateDecisionSelectedClientId(String(nextCandidates[0]?.id || ''));
        }
      }
      setDuplicateDecisionError(toUserSafeMessage(normalized.message, 'No se pudo crear la reserva.'));
    } finally {
      setDuplicateDecisionLoading(false);
    }
  }

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

  useEffect(() => {
    if (formError.trim().length > 0) return;
    if (Object.keys(fieldErrors).length === 0) return;
    setFieldErrors({});
  }, [fieldErrors, formError]);

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
    if (!drawerOpen) return;
    if (participantUiState.mode === 'idle' || !participantUiState.participantId) return;
    const activeParticipantId = participantUiState.participantId;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const activeShell = target?.closest('[data-participant-shell-id]');
      if (
        activeShell &&
        String((activeShell as HTMLElement).getAttribute('data-participant-shell-id') || '') ===
          activeParticipantId
      ) {
        return;
      }
      setParticipantUiState((previous) =>
        previous.mode === 'idle' ? previous : { mode: 'idle', participantId: null }
      );
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [drawerOpen, participantUiState]);

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
    if (!isRecurringKind) return;
    setRecurringDayOfWeek(selectedDate.getDay());
  }, [isRecurringKind, selectedDate]);

  useEffect(() => {
    if (isRecurringKind) return;
    setRecurringResult(null);
    setRecurringCreatedItems([]);
    setRecurringOverlapItems([]);
    setRecurringOverlapModalOpen(false);
    setRecurringCreateConfirmOpen(false);
  }, [isRecurringKind]);

  useEffect(() => {
    if (!isRecurringKind) return;
    if (recurringFrequencyPreset !== 'custom') return;
    if (customRecurrenceDays.length === 0) {
      setCustomRecurrenceDays([recurringDayOfWeek]);
    }
  }, [customRecurrenceDays, isRecurringKind, recurringDayOfWeek, recurringFrequencyPreset]);

  useEffect(() => {
    if (!isRecurringKind) return;
    if (!selectedCourtId) return;
    setRecurringCourtIds((previous) => {
      if (previous.length > 0) return previous;
      return [selectedCourtId];
    });
  }, [isRecurringKind, selectedCourtId]);

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

  const resetConsumptionsDraft = useCallback(() => {
    setBookingConsumptionItems([]);
    setBookingAccountItems([]);
    setBookingConsumptionError('');
    setBookingConsumptionLoading(false);
    setConsumptionProductDraft('');
    setConsumptionQuantityDraft('1');
    setConsumptionApplyDiscountDraft(true);
    setConsumptionQuote(null);
    setConsumptionQuoteError('');
    setConsumptionQuoteLoading(false);
    setConsumptionAddInFlight(false);
    setConsumptionRemovingId(null);
    setSimplifiedPaymentQuickPreset('MY_SHARE');
    setSimplifiedPaymentImputationMode('BY_PARTICIPANT');
    setSimplifiedPaymentConceptMode('AUTO');
    setSimplifiedPaymentSelectedItemIdsDraft([]);
    bookingConsumptionRequestSeqRef.current += 1;
    consumptionQuoteRequestSeqRef.current += 1;
  }, []);

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
    remoteBillingConfigRequestSeqRef.current += 1;
    setIsBookingFinancialLoading(booking.state !== 'blocked');
    setIsRemoteBillingConfigLoading(booking.state !== 'blocked');
    setBookingTimelineLoading(booking.state !== 'blocked');
    setBookingTimelineError('');
    setBookingTimelineEvents([]);
    setBookingFinancial(null);
    setRemoteBillingConfig(null);
    setIsBillingConfigHydrated(false);
    setBillingConfigLoadError('');
    setBillingConfigTouchedByUser(false);
    setParticipantLabelByRefCache({});
    pendingParticipantSaveNoticeRef.current = '';
    resetConsumptionsDraft();
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
    setParticipantPriceDraftById({});
    setPaymentMode('Único');
    setSimplifiedSidebarSection('DETAILS');
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
  }, [resetConsumptionsDraft, resolveParticipantsForBooking]);
  const resetRecurringDraft = useCallback((baseDate: Date, fallbackCourtId?: string) => {
    const baseDay = baseDate.getDay();
    const firstCourtId =
      (fallbackCourtId && courtsData.some((court) => court.id === fallbackCourtId) ? fallbackCourtId : '') ||
      (selectedCourtId && courtsData.some((court) => court.id === selectedCourtId) ? selectedCourtId : '') ||
      courtsData[0]?.id ||
      '';

    setRecurringDayOfWeek(baseDay);
    setRecurringEveryDays(7);
    setRecurringFrequencyPreset('weekly');
    setRecurringRepetitions(8);
    setCustomRecurrenceDays([baseDay]);
    setCustomRepeatEveryWeeks(1);
    setCustomEndAfterEnabled(true);
    setCustomEndAfterExpanded(false);
    setCustomEndAfterReservations(8);
    setCustomRecurrenceModalOpen(false);
    setRecurringCourtsMenuOpen(false);
    setRecurringCreateConfirmOpen(false);
    setRecurringPreviewSummary(null);
    setRecurringCreatedItems([]);
    setRecurringOverlapItems([]);
    setRecurringOverlapModalOpen(false);
    setRecurringResult(null);
    setRecurringCourtIds(firstCourtId ? [firstCourtId] : []);
  }, [courtsData, selectedCourtId]);

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

  useEffect(() => {
    if (!changeTitularModalOpen) return;
    const query = String(changeTitularSearch || '').trim();
    const slug = getClubSlug();
    if (!slug || query.length < 2) {
      setChangeTitularCandidates([]);
      setChangeTitularLoading(false);
      return;
    }

    let cancelled = false;
    setChangeTitularLoading(true);
    setChangeTitularError('');
    const timer = window.setTimeout(async () => {
      try {
        const rows = await ClubAdminService.getClients(slug, query);
        if (cancelled) return;
        const normalizedRows = (Array.isArray(rows) ? rows : [])
          .map((client: any) => ({
            id: String(client?.id || '').trim().replace(/^client-/, ''),
            name: String(client?.name || '').trim() || 'Cliente sin nombre',
            phone: String(client?.phone || '').trim() || undefined,
            email: String(client?.email || '').trim() || undefined,
          }))
          .filter((client: any) => client.id.length > 0);
        setChangeTitularCandidates(normalizedRows);
      } catch (error: any) {
        if (cancelled) return;
        setChangeTitularCandidates([]);
        setChangeTitularError(toUserSafeMessage(error?.message, 'No se pudo buscar clientes.'));
      } finally {
        if (!cancelled) setChangeTitularLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [changeTitularModalOpen, changeTitularSearch, getClubSlug]);

  const openChangeTitularModal = useCallback(() => {
    setChangeTitularModalOpen(true);
    setChangeTitularSearch('');
    setChangeTitularReason('');
    setChangeTitularError('');
    setChangeTitularCandidates([]);
    setChangeTitularSelectedClientId('');
  }, []);

  const closeChangeTitularModal = useCallback(() => {
    if (changeTitularSubmitting) return;
    setChangeTitularModalOpen(false);
    setChangeTitularSearch('');
    setChangeTitularReason('');
    setChangeTitularError('');
    setChangeTitularCandidates([]);
    setChangeTitularSelectedClientId('');
  }, [changeTitularSubmitting]);

  const submitChangeTitular = useCallback(async () => {
    const bookingId = Number(editingBookingId || 0);
    const newClientId = String(changeTitularSelectedClientId || '').trim();
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      setChangeTitularError('Reserva inválida.');
      return;
    }
    if (!newClientId) {
      setChangeTitularError('Seleccioná un cliente para continuar.');
      return;
    }
    const currentClientId = String(editingBooking?.clientId || '').trim();
    if (currentClientId && currentClientId === newClientId) {
      setChangeTitularError('Ese cliente ya es el titular actual.');
      return;
    }

    setChangeTitularSubmitting(true);
    setChangeTitularError('');
    try {
      await changeBookingClient(bookingId, {
        newClientId,
        reason: String(changeTitularReason || '').trim() || undefined,
      });
      await reloadSchedule();
      closeChangeTitularModal();
      setEditingBookingId(String(bookingId));
      showCalendarNotice('Titular actualizado correctamente.', 'success');
    } catch (error: any) {
      const normalized = normalizeApiError(error, 'No se pudo cambiar el titular.');
      setChangeTitularError(toUserSafeMessage(normalized.message, 'No se pudo cambiar el titular.'));
    } finally {
      setChangeTitularSubmitting(false);
    }
  }, [
    changeTitularReason,
    changeTitularSelectedClientId,
    closeChangeTitularModal,
    editingBooking?.clientId,
    editingBookingId,
    reloadSchedule,
    showCalendarNotice,
  ]);

  const loadConsumptionProducts = useCallback(async () => {
    const slug = getClubSlug();
    if (!slug) {
      setConsumptionProducts([]);
      setConsumptionProductsError('No se pudo resolver el club activo para cargar productos.');
      return [];
    }
    setConsumptionProductsLoading(true);
    setConsumptionProductsError('');
    try {
      const data = await ClubAdminService.getProducts(slug);
      const mapped = (Array.isArray(data) ? data : [])
        .map(normalizeClubProductOption)
        .filter((entry): entry is ClubProductOption => Boolean(entry))
        .filter((entry) => entry.isActive);
      setConsumptionProducts(mapped);
      return mapped;
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'loadConsumptionProducts' }, error);
      setConsumptionProducts([]);
      setConsumptionProductsError(error?.message || 'No se pudieron cargar los productos del club.');
      return [];
    } finally {
      setConsumptionProductsLoading(false);
    }
  }, [getClubSlug]);

  const loadBookingConsumptions = useCallback(async (bookingId: number) => {
    const requestSeq = bookingConsumptionRequestSeqRef.current + 1;
    bookingConsumptionRequestSeqRef.current = requestSeq;
    setBookingConsumptionLoading(true);
    setBookingConsumptionError('');
    try {
      const rows = await ClubAdminService.getBookingItems(bookingId);
      if (bookingConsumptionRequestSeqRef.current !== requestSeq) return [];
      const normalized = (Array.isArray(rows) ? rows : [])
        .map(normalizeBookingConsumptionItem)
        .filter((entry): entry is BookingConsumptionItem => Boolean(entry));
      setBookingAccountItems(normalized);
      const onlyConsumptions = normalized.filter((entry) => entry.type !== 'BOOKING');
      setBookingConsumptionItems(onlyConsumptions);
      return onlyConsumptions;
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'loadBookingConsumptions' }, error);
      if (bookingConsumptionRequestSeqRef.current === requestSeq) {
        setBookingAccountItems([]);
        setBookingConsumptionItems([]);
        setBookingConsumptionError(error?.message || 'No se pudieron cargar los consumos.');
      }
      return [];
    } finally {
      if (bookingConsumptionRequestSeqRef.current === requestSeq) {
        setBookingConsumptionLoading(false);
      }
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
        courtTotal: Number(summary?.courtTotal || 0),
        itemsTotal: Number(summary?.itemsTotal || 0),
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
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/agenda-playground2')}`);
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
  }, [drawerOpen, resetConsumptionsDraft, setExpandedParticipantId, setParticipantMenuId]);

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
  }, [drawerOpen, resetConsumptionsDraft, setExpandedParticipantId, setParticipantMenuId]);

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
      remoteBillingConfigRequestSeqRef.current += 1;
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
      setIsBillingConfigHydrated(false);
      setBillingConfigLoadError('');
      setBillingConfigTouchedByUser(false);
      resetConsumptionsDraft();
      setParticipantLabelByRefCache({});
      pendingParticipantSaveNoticeRef.current = '';
      setRecurringResult(null);
      setDeleteBookingConfirmOpen(false);
      setDeleteSeriesScopeModalOpen(false);
      setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' });
      setBlockingErrorModalOpen(false);
      setBookingCreatedModalOpen(false);
      setSeriesEditPreviewLoading(false);
      setSeriesEditPreviewScope(null);
      setSeriesEditPreviewSummary(null);
      setSeriesDeletePreviewLoading(false);
      setSeriesDeletePreviewScope(null);
      setSeriesDeletePreviewSummary(null);
      setSeriesOperationResult(null);
      setSeriesOperationResultOpen(false);
      bookingDrawerDispatch({ type: 'CLEAR' });
      bookingDrawerFormSyncSignatureRef.current = '';
      drawerCloseCleanupTimerRef.current = null;
    }, DRAWER_CLOSE_RESET_DELAY_MS);

    return () => {
      clearCloseCleanupTimer();
    };
  }, [drawerOpen, resetConsumptionsDraft, setExpandedParticipantId, setParticipantMenuId]);

  useEffect(() => {
    if (drawerOpen) return;
    bookingDrawerLoadKeyRef.current = '';
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    void loadConsumptionProducts();
  }, [bookingKind, drawerOpen, loadConsumptionProducts]);

  useEffect(() => {
    if (consumptionProducts.length === 0) return;
    if (consumptionProductDraft && consumptionProducts.some((product) => String(product.id) === consumptionProductDraft)) return;
    setConsumptionProductDraft(String(consumptionProducts[0].id));
  }, [consumptionProductDraft, consumptionProducts]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;
    void loadBookingConsumptions(persistedEditingBookingId);
  }, [bookingKind, drawerOpen, persistedEditingBookingId, loadBookingConsumptions]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block' || !persistedEditingBookingId) {
      setConsumptionQuote(null);
      setConsumptionQuoteError('');
      setConsumptionQuoteLoading(false);
      return;
    }
    const productId = Number(consumptionProductDraft || 0);
    const quantity = Math.max(1, Math.floor(Number(consumptionQuantityDraft || 1)));
    if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      setConsumptionQuote(null);
      setConsumptionQuoteError('');
      setConsumptionQuoteLoading(false);
      return;
    }

    let cancelled = false;
    const requestSeq = consumptionQuoteRequestSeqRef.current + 1;
    consumptionQuoteRequestSeqRef.current = requestSeq;
    setConsumptionQuoteLoading(true);
    setConsumptionQuoteError('');

    const run = async () => {
      try {
        const result = await ClubAdminService.quoteBookingItem(
          persistedEditingBookingId,
          productId,
          quantity,
          { applyDiscount: consumptionApplyDiscountDraft }
        );
        if (cancelled || consumptionQuoteRequestSeqRef.current !== requestSeq) return;
        setConsumptionQuote({
          listTotal: roundMoney(Number(result?.listTotal || 0)),
          finalTotal: roundMoney(Number(result?.finalTotal || 0)),
          discountAmount: roundMoney(Number(result?.discountAmount || 0)),
          hasDiscount: Boolean(result?.hasDiscount),
        });
      } catch (error: any) {
        if (cancelled || consumptionQuoteRequestSeqRef.current !== requestSeq) return;
        setConsumptionQuote(null);
        setConsumptionQuoteError(error?.message || 'No se pudo cotizar el consumo.');
      } finally {
        if (!cancelled && consumptionQuoteRequestSeqRef.current === requestSeq) {
          setConsumptionQuoteLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    bookingKind,
    consumptionApplyDiscountDraft,
    consumptionProductDraft,
    consumptionQuantityDraft,
    drawerOpen,
    persistedEditingBookingId,
  ]);

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
    const requestSeq = remoteBillingConfigRequestSeqRef.current + 1;
    remoteBillingConfigRequestSeqRef.current = requestSeq;
    const run = async () => {
      setIsRemoteBillingConfigLoading(true);
      setIsBillingConfigHydrated(false);
      setBillingConfigLoadError('');
      try {
        const config = await getBookingBillingConfig(persistedEditingBookingId);
        if (cancelled) return;
        if (remoteBillingConfigRequestSeqRef.current !== requestSeq) return;
        setRemoteBillingConfig(config);
      } catch {
        if (!cancelled && remoteBillingConfigRequestSeqRef.current === requestSeq) {
          setRemoteBillingConfig(null);
          setIsRemoteBillingConfigLoading(false);
          setIsBillingConfigHydrated(false);
          setBillingConfigLoadError('No se pudo cargar la configuración de cobro.');
        }
      } finally {
        if (!cancelled && remoteBillingConfigRequestSeqRef.current === requestSeq) {
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

    setPaymentMode(remoteBillingConfig.chargeMode === 'SHARED' ? 'Dividido' : 'Único');

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
              entityRef: participant.entityRef,
            };
          })
        );
        shouldRebaseDrawerSource = true;
      }
    }

    if (shouldRebaseDrawerSource) {
      bookingDrawerLoadKeyRef.current = '';
      bookingDrawerFormSyncSignatureRef.current = '';
      setBillingConfigTouchedByUser(false);
    }
    setIsRemoteBillingConfigLoading(false);
    setIsBillingConfigHydrated(true);
    setBillingConfigLoadError('');
  }, [
    bookingKind,
    drawerOpen,
    editingBooking,
    persistedEditingBookingId,
    remoteBillingConfig,
    remoteBillingConfig?.metadata,
    remoteBillingConfig?.updatedAt,
  ]);

  useEffect(() => {
    if (drawerOpen) return;
    setEditSeriesScopeModalOpen(false);
    setPendingSeriesScopeSave(null);
  }, [drawerOpen]);

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
      participantsCount: booking.participantsCount,
      hasPendingNotification: booking.hasPendingNotification,
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
      if (pending.booking.state === 'completed') return;

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
      setIsDragging(false);
      setDragSelection(null);
      const draftSelectionSnapshot = dragSelection;
      const range = toSelectionRange(draftSelectionSnapshot);
      const openDrawerWithSelection = () => {
        setEditingBookingId(null);
        setEditingBaseline(null);
        setBookingKind('regular');
        setBlockingTitle('');
        setSelectedCourtId(draftSelectionSnapshot.courtId);
        setSelectedStartSlot(range.start);
        setSelectedEndSlot(range.end);
        resetRecurringDraft(selectedDate, draftSelectionSnapshot.courtId);
        setParticipants(initialParticipants.map((participant) => ({ ...participant })));
        setPaymentMode('Único');
        setSimplifiedSidebarSection('DETAILS');
        setParticipantPriceDraftById({});
        bookingFinancialRequestSeqRef.current += 1;
        bookingTimelineRequestSeqRef.current += 1;
        remoteBillingConfigRequestSeqRef.current += 1;
        setIsBookingFinancialLoading(false);
        setIsRemoteBillingConfigLoading(false);
        setBookingTimelineLoading(false);
        setBookingTimelineError('');
        setBookingTimelineEvents([]);
        setBookingFinancial(null);
        setRemoteBillingConfig(null);
        setIsBillingConfigHydrated(false);
        setBillingConfigLoadError('');
        setBillingConfigTouchedByUser(false);
        resetConsumptionsDraft();
        setQuotedListPrice(null);
        setQuotedFinalPrice(null);
        setQuotedDiscountAmount(0);
        setQuoteError('');
        setDrawerOpen(true);
        setScheduleInputsDirty(false);
        setFormError('');
      };

      openDrawerWithSelection();
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [
    applyBookingError,
    beginBookingDrag,
    bookingDropPreview,
    bookings,
    dragSelection,
    isDragging,
    openBookingInDrawer,
    resetRecurringDraft,
    resetConsumptionsDraft,
    persistBookingMove,
    reloadSchedule,
    selectedDate,
    showCalendarNotice,
  ]);

  const visibleCourts = useMemo(() => {
    return effectiveCourts.filter((court) => {
      const bySport = sportFilter === 'Todos' || court.sport === sportFilter;
      return bySport;
    });
  }, [effectiveCourts, sportFilter]);

  const visibleCourtIds = useMemo(() => new Set(visibleCourts.map((court) => court.id)), [visibleCourts]);

  const visibleBookings = useMemo(() => bookings.filter((booking) => visibleCourtIds.has(booking.courtId)), [bookings, visibleCourtIds]);

  const openQuickCreateBooking = useCallback(
    (preferredCourtId?: string) => {
      const fallbackCourtId =
        (preferredCourtId && effectiveCourts.some((court) => court.id === preferredCourtId) ? preferredCourtId : '') ||
        (selectedCourtId && effectiveCourts.some((court) => court.id === selectedCourtId) ? selectedCourtId : '') ||
        effectiveCourts[0]?.id ||
        '';

      if (!fallbackCourtId) {
        showCalendarNotice('Primero cargá al menos una cancha para crear una reserva.');
        return;
      }

      const now = new Date();
      const isSelectedDateToday =
        now.getFullYear() === selectedDate.getFullYear() &&
        now.getMonth() === selectedDate.getMonth() &&
        now.getDate() === selectedDate.getDate();

      const slotSpan = Math.max(1, selectedEndSlot - selectedStartSlot);
      const suggestedStartSlot = isSelectedDateToday
        ? Math.max(
            0,
            Math.min(totalSlots - 1, Math.ceil((now.getHours() * 60 + now.getMinutes() - startHour * 60) / slotMinutes))
          )
        : Math.max(0, Math.min(totalSlots - 1, selectedStartSlot));
      const suggestedEndSlot = Math.max(
        suggestedStartSlot + 1,
        Math.min(totalSlots, suggestedStartSlot + slotSpan)
      );

      setEditingBookingId(null);
      setEditingBaseline(null);
      setBookingKind('regular');
      setBlockingTitle('');
      setSelectedCourtId(fallbackCourtId);
      setSelectedStartSlot(suggestedStartSlot);
      setSelectedEndSlot(suggestedEndSlot);
      resetRecurringDraft(selectedDate, fallbackCourtId);
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setPaymentMode('Único');
      setSimplifiedSidebarSection('DETAILS');
      setParticipantPriceDraftById({});
      bookingFinancialRequestSeqRef.current += 1;
      bookingTimelineRequestSeqRef.current += 1;
      remoteBillingConfigRequestSeqRef.current += 1;
      setIsBookingFinancialLoading(false);
      setIsRemoteBillingConfigLoading(false);
      setBookingTimelineLoading(false);
      setBookingTimelineError('');
      setBookingTimelineEvents([]);
      setBookingFinancial(null);
      setRemoteBillingConfig(null);
      setIsBillingConfigHydrated(false);
      setBillingConfigLoadError('');
      setBillingConfigTouchedByUser(false);
      resetConsumptionsDraft();
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('');
      setDrawerOpen(true);
      setScheduleInputsDirty(false);
      setFormError('');
    },
    [
      effectiveCourts,
      selectedCourtId,
      selectedDate,
      selectedEndSlot,
      selectedStartSlot,
      showCalendarNotice,
      resetRecurringDraft,
      resetConsumptionsDraft,
    ]
  );

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
  const recurringExecutionPlan = useMemo<RecurringExecutionPlan>(() => {
    const recurrenceDays =
      recurringFrequencyPreset === 'custom'
        ? Array.from(new Set(customRecurrenceDays)).sort((a, b) => a - b)
        : [recurringDayOfWeek];

    if (recurrenceDays.length === 0) {
      return {
        recurrenceDays: [],
        frequencyDays: 0,
        error: 'Seleccioná al menos un día para la recurrencia.',
      };
    }

    const frequencyDays =
      recurringFrequencyPreset === 'custom'
        ? Math.max(1, Math.floor(customRepeatEveryWeeks || 0)) * 7
        : Math.max(1, Math.floor(recurringEveryDays || 0));

    if (!Number.isFinite(frequencyDays) || frequencyDays <= 0) {
      return {
        recurrenceDays: [],
        frequencyDays: 0,
        error: 'Indicá cada cuántos días querés repetir la serie.',
      };
    }

    if (recurringFrequencyPreset === 'custom') {
      if (!customEndAfterEnabled) {
        return { recurrenceDays, frequencyDays };
      }

      const customTotalReservations = Math.max(1, Math.floor(customEndAfterReservations || 0));
      if (!Number.isFinite(customTotalReservations) || customTotalReservations <= 0) {
        return {
          recurrenceDays: [],
          frequencyDays: 0,
          error: 'Indicá cuántas repeticiones querés generar.',
        };
      }

      return {
        recurrenceDays,
        frequencyDays,
        repetitionsPerDay: Math.max(1, Math.ceil(customTotalReservations / recurrenceDays.length)),
      };
    }

    const repetitionsPerDay = Math.max(1, Math.floor(recurringRepetitions || 0));
    if (!Number.isFinite(repetitionsPerDay) || repetitionsPerDay <= 0) {
      return {
        recurrenceDays: [],
        frequencyDays: 0,
        error: 'Indicá cuántas repeticiones querés generar.',
      };
    }

    return {
      recurrenceDays,
      frequencyDays,
      repetitionsPerDay,
    };
  }, [
    customEndAfterEnabled,
    customEndAfterReservations,
    customRecurrenceDays,
    customRepeatEveryWeeks,
    recurringDayOfWeek,
    recurringEveryDays,
    recurringFrequencyPreset,
    recurringRepetitions,
  ]);
  const recurringEstimatedOccurrencesPerCourt = useMemo(() => {
    if (!Number.isFinite(recurringExecutionPlan?.repetitionsPerDay)) return null;
    return recurringExecutionPlan.recurrenceDays.length * Number(recurringExecutionPlan.repetitionsPerDay);
  }, [recurringExecutionPlan]);
  const recurringEstimatedOccurrencesTotal = useMemo(() => {
    if (!Number.isFinite(recurringEstimatedOccurrencesPerCourt)) return null;
    return Number(recurringEstimatedOccurrencesPerCourt) * selectedRecurringCourts.length;
  }, [recurringEstimatedOccurrencesPerCourt, selectedRecurringCourts.length]);
  const recurringCadenceSummary = useMemo(() => {
    if (recurringExecutionPlan.error) return recurringExecutionPlan.error;
    const daysLabel =
      recurringExecutionPlan.recurrenceDays.length > 0
        ? recurringExecutionPlan.recurrenceDays
            .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label || String(day))
            .join(', ')
        : 'Sin días';
    const repetitionsLabel = Number.isFinite(recurringExecutionPlan.repetitionsPerDay)
      ? `${Number(recurringExecutionPlan.repetitionsPerDay)} repeticiones por día`
      : 'sin límite manual (usa horizonte del club)';
    return `${daysLabel} · cada ${recurringExecutionPlan.frequencyDays} días · ${repetitionsLabel}`;
  }, [recurringExecutionPlan]);
  const recurringCadenceShortSummary = useMemo(() => {
    if (recurringExecutionPlan.error) return recurringExecutionPlan.error;
    const daysLabel =
      recurringExecutionPlan.recurrenceDays.length > 0
        ? recurringExecutionPlan.recurrenceDays
            .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label || String(day))
            .join(', ')
        : 'Sin días';
    return `${daysLabel} · cada ${recurringExecutionPlan.frequencyDays} días`;
  }, [recurringExecutionPlan]);
  const recurringCreationCountSummary = useMemo(() => {
    if (!Number.isFinite(recurringEstimatedOccurrencesPerCourt)) {
      return 'Se crearán turnos según el horizonte configurado del club.';
    }
    const perCourtCount = Number(recurringEstimatedOccurrencesPerCourt);
    const courtsCount = selectedRecurringCourts.length;
    if (courtsCount > 1 && Number.isFinite(recurringEstimatedOccurrencesTotal)) {
      return `Se crearán ${Number(recurringEstimatedOccurrencesTotal)} turnos en ${courtsCount} canchas.`;
    }
    return `Se crearán ${perCourtCount} turnos.`;
  }, [recurringEstimatedOccurrencesPerCourt, recurringEstimatedOccurrencesTotal, selectedRecurringCourts.length]);

  const selectionMinutes = Math.max((selectedEndSlot - selectedStartSlot) * slotMinutes, slotMinutes);
  const selectionStartDateTime = useMemo(
    () => buildSelectionDateTime(selectedDate, selectedStartSlot),
    [selectedDate, selectedStartSlot]
  );
  const shouldValidatePastSelection = !isRecurringKind && bookingKind !== 'block';
  const isSelectionInPast = useMemo(
    () => shouldValidatePastSelection && selectionStartDateTime.getTime() < Date.now(),
    [selectionStartDateTime, shouldValidatePastSelection]
  );
  const hasBlockingQuoteError = useMemo(
    () => isBlockingQuoteError(quoteError),
    [quoteError]
  );
  const latestPaymentPayerRef = useMemo(
    () => resolveLatestPaymentPayerRef(bookingTimelineEvents),
    [bookingTimelineEvents]
  );
  const latestPaymentCoveredRef = useMemo(
    () => resolveLatestPaymentCoveredRef(bookingTimelineEvents),
    [bookingTimelineEvents]
  );
  const singleChargeParticipantIdFromRemoteConfig = useMemo(() => {
    if (paymentMode !== 'Único') return undefined;
    const responsibleRef = String(remoteBillingConfig?.chargeResponsibleRef || '').trim();
    if (!responsibleRef) return undefined;

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;

    const matched = participants.find(
      (participant) =>
        buildStableParticipantRef(participant, { bookingClientId, bookingUserId }) === responsibleRef
    );
    return matched?.id;
  }, [
    editingBooking?.clientId,
    editingBooking?.userId,
    participants,
    paymentMode,
    remoteBillingConfig?.chargeResponsibleRef,
  ]);
  const singleChargeParticipantId = useMemo(() => {
    if (paymentMode !== 'Único') return undefined;
    if (
      singleChargeParticipantIdFromRemoteConfig &&
      participants.some((participant) => participant.id === singleChargeParticipantIdFromRemoteConfig)
    ) {
      return singleChargeParticipantIdFromRemoteConfig;
    }
    const draftResponsible = String(bookingDrawerState.draft?.billing.chargeResponsibleParticipantId || '').trim();
    if (draftResponsible && participants.some((participant) => participant.id === draftResponsible)) {
      return draftResponsible;
    }
    const owner = participants.find((participant) => participant.isOwner);
    return owner?.id;
  }, [
    bookingDrawerState.draft?.billing.chargeResponsibleParticipantId,
    participants,
    paymentMode,
    singleChargeParticipantIdFromRemoteConfig,
  ]);
  const effectiveSingleChargeResponsibleParticipantId = useMemo(() => {
    if (paymentMode !== 'Único') return '';
    const draftResponsible = String(bookingDrawerState.draft?.billing.chargeResponsibleParticipantId || '').trim();
    if (draftResponsible && participants.some((participant) => participant.id === draftResponsible)) {
      return draftResponsible;
    }
    const fromConfig = String(singleChargeParticipantId || '').trim();
    if (fromConfig && participants.some((participant) => participant.id === fromConfig)) {
      return fromConfig;
    }
    const ownerParticipant = participants.find((participant) => participant.isOwner);
    return ownerParticipant?.id || participants[0]?.id || '';
  }, [
    bookingDrawerState.draft?.billing.chargeResponsibleParticipantId,
    participants,
    paymentMode,
    singleChargeParticipantId,
  ]);
  const deleteParticipantContext = useMemo(() => {
    const participantId = String(deleteParticipantConfirm.participantId || '').trim();
    if (!participantId) {
      return {
        participantId: '',
        isChargeResponsible: false,
        nextResponsibleParticipantId: '',
        nextResponsibleLabel: '',
      };
    }
    const isChargeResponsible =
      paymentMode === 'Único' &&
      participantId === effectiveSingleChargeResponsibleParticipantId;
    const remainingParticipants = participants.filter((participant) => participant.id !== participantId);
    const nextResponsibleParticipant =
      remainingParticipants.find((participant) => participant.isOwner) ||
      remainingParticipants.find((participant) => participant.name.trim().length > 0) ||
      remainingParticipants[0];
    const nextResponsibleLabel = nextResponsibleParticipant
      ? (String(nextResponsibleParticipant.name || '').trim() ||
          (nextResponsibleParticipant.isOwner ? 'Titular' : 'Participante'))
      : '';
    return {
      participantId,
      isChargeResponsible,
      nextResponsibleParticipantId: String(nextResponsibleParticipant?.id || ''),
      nextResponsibleLabel,
    };
  }, [
    deleteParticipantConfirm.participantId,
    effectiveSingleChargeResponsibleParticipantId,
    participants,
    paymentMode,
  ]);
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

    if (paymentMode === 'Único') {
      const ownerId = chargedParticipantIds[0];
      participants.forEach((participant) => {
        map.set(participant.id, participant.id === ownerId ? totalPrice : 0);
      });
      return map;
    }

    const charged = participants.filter((participant) => chargedParticipantIdSet.has(participant.id));
    const manual = charged.filter((participant) => participant.customPrice != null);
    const auto = charged.filter((participant) => participant.customPrice == null);
    const totalCents = Math.max(0, Math.round(Number(totalPrice || 0) * 100));
    let manualCents = 0;

    participants.forEach((participant) => map.set(participant.id, 0));
    manual.forEach((participant) => {
      const cents = Math.max(0, Math.round(clampParticipantPrice(Number(participant.customPrice || 0)) * 100));
      manualCents += cents;
      map.set(participant.id, Number((cents / 100).toFixed(2)));
    });
    const remainingCents = Math.max(0, totalCents - manualCents);
    const baseShareCents = auto.length > 0 ? Math.floor(remainingCents / auto.length) : 0;
    let remainderCents = auto.length > 0 ? remainingCents - (baseShareCents * auto.length) : 0;
    auto.forEach((participant) => {
      let allocatedCents = baseShareCents;
      if (remainderCents > 0) {
        allocatedCents += 1;
        remainderCents -= 1;
      }
      map.set(participant.id, Number((allocatedCents / 100).toFixed(2)));
    });

    return map;
  }, [chargedParticipantIdSet, chargedParticipantIds, participants, paymentMode, totalPrice]);
  const resolveParticipantPrice = useCallback((participant: Participant) => {
    return Number(participantPriceById.get(participant.id) || 0);
  }, [participantPriceById]);
  const participantCoverageAmountById = useMemo(() => {
    const totals = new Map<string, number>();
    if (!persistedEditingBookingId || bookingKind === 'block' || participants.length === 0) return totals;

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;

    const participantIdByRef = new Map<string, string>();
    const participantIdByName = new Map<string, string>();
    const ownerParticipant = participants.find((participant) => participant.isOwner) || participants[0] || null;
    const ownerId = String(ownerParticipant?.id || '').trim();

    const registerRefAlias = (participantId: string, rawRef: string) => {
      const normalizedRef = String(rawRef || '').trim().toLowerCase();
      if (!participantId || !normalizedRef) return;
      participantIdByRef.set(normalizedRef, participantId);
    };

    participants.forEach((participant) => {
      const participantId = String(participant.id || '').trim();
      if (!participantId) return;
      const stableRef = buildStableParticipantRef(participant, { bookingClientId, bookingUserId });
      registerRefAlias(participantId, stableRef);
      registerRefAlias(participantId, participant.entityRef || '');
      if (participant.isOwner) {
        registerRefAlias(participantId, 'guest:owner');
        registerRefAlias(participantId, 'guest:booking-responsible');
        if (bookingClientId) {
          registerRefAlias(participantId, `booking-client:${bookingClientId}`);
        }
        if (bookingUserId) {
          registerRefAlias(participantId, `booking-user:${bookingUserId}`);
        }
      }

      const normalizedName = String(participant.name || '').trim().toLowerCase();
      if (normalizedName && !participantIdByName.has(normalizedName)) {
        participantIdByName.set(normalizedName, participantId);
      }
    });

    const addCoveredAmount = (participantRefRaw: unknown, participantNameRaw: unknown, amountRaw: unknown) => {
      const amount = Number(amountRaw || 0);
      if (!Number.isFinite(amount) || amount <= 0.009) return;

      const normalizedRef = String(participantRefRaw || '').trim().toLowerCase();
      const normalizedName = String(participantNameRaw || '').trim().toLowerCase();
      let participantId = normalizedRef ? participantIdByRef.get(normalizedRef) : undefined;
      if (!participantId && normalizedName) {
        participantId = participantIdByName.get(normalizedName);
      }
      if (!participantId && normalizedRef && isOwnerLikeParticipantRef(normalizedRef) && ownerId) {
        participantId = ownerId;
      }
      if (!participantId) return;

      totals.set(
        participantId,
        Number((Number(totals.get(participantId) || 0) + amount).toFixed(2))
      );
    };

    let usedTimelineEvents = 0;
    (Array.isArray(bookingTimelineEvents) ? bookingTimelineEvents : []).forEach((event) => {
      const normalizedType = String(event?.type || '').trim().toUpperCase();
      if (normalizedType !== 'PAYMENT_RECEIVED') return;
      const payload =
        event?.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : {};
      const amount = Number((payload as any)?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0.009) return;
      usedTimelineEvents += 1;
      const coveredRef = String((payload as any)?.coveredParticipantRef || '').trim();
      const coveredName = String((payload as any)?.coveredParticipantName || '').trim();
      const payerRef = String((payload as any)?.payerParticipantRef || '').trim();
      const payerName = String((payload as any)?.payerParticipantName || '').trim();
      addCoveredAmount(coveredRef || payerRef, coveredName || payerName, amount);
    });

    if (usedTimelineEvents === 0) {
      const coveredFallback = Array.isArray(editingBooking?.hoverPayment?.coveredParticipants)
        ? editingBooking?.hoverPayment?.coveredParticipants
        : [];
      coveredFallback.forEach((row) => {
        addCoveredAmount(row?.ref, row?.name, row?.amount);
      });
      if (coveredFallback.length === 0) {
        const payerFallback = Array.isArray(editingBooking?.hoverPayment?.payerParticipants)
          ? editingBooking?.hoverPayment?.payerParticipants
          : [];
        payerFallback.forEach((row) => {
          addCoveredAmount(row?.ref, row?.name, row?.amount);
        });
      }
    }

    return totals;
  }, [
    bookingKind,
    bookingTimelineEvents,
    editingBooking?.clientId,
    editingBooking?.hoverPayment?.coveredParticipants,
    editingBooking?.hoverPayment?.payerParticipants,
    editingBooking?.userId,
    participants,
    persistedEditingBookingId,
  ]);
  const participantPayerAmountById = useMemo(() => {
    const totals = new Map<string, number>();
    if (!persistedEditingBookingId || bookingKind === 'block' || participants.length === 0) return totals;

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;

    const participantIdByRef = new Map<string, string>();
    const participantIdByName = new Map<string, string>();
    const ownerParticipant = participants.find((participant) => participant.isOwner) || participants[0] || null;
    const ownerId = String(ownerParticipant?.id || '').trim();

    const registerRefAlias = (participantId: string, rawRef: string) => {
      const normalizedRef = String(rawRef || '').trim().toLowerCase();
      if (!participantId || !normalizedRef) return;
      participantIdByRef.set(normalizedRef, participantId);
    };

    participants.forEach((participant) => {
      const participantId = String(participant.id || '').trim();
      if (!participantId) return;
      const stableRef = buildStableParticipantRef(participant, { bookingClientId, bookingUserId });
      registerRefAlias(participantId, stableRef);
      registerRefAlias(participantId, participant.entityRef || '');
      if (participant.isOwner) {
        registerRefAlias(participantId, 'guest:owner');
        registerRefAlias(participantId, 'guest:booking-responsible');
        if (bookingClientId) registerRefAlias(participantId, `booking-client:${bookingClientId}`);
        if (bookingUserId) registerRefAlias(participantId, `booking-user:${bookingUserId}`);
      }
      const normalizedName = String(participant.name || '').trim().toLowerCase();
      if (normalizedName && !participantIdByName.has(normalizedName)) {
        participantIdByName.set(normalizedName, participantId);
      }
    });

    const addPayerAmount = (participantRefRaw: unknown, participantNameRaw: unknown, amountRaw: unknown) => {
      const amount = Number(amountRaw || 0);
      if (!Number.isFinite(amount) || amount <= 0.009) return;
      const normalizedRef = String(participantRefRaw || '').trim().toLowerCase();
      const normalizedName = String(participantNameRaw || '').trim().toLowerCase();
      let participantId = normalizedRef ? participantIdByRef.get(normalizedRef) : undefined;
      if (!participantId && normalizedName) participantId = participantIdByName.get(normalizedName);
      if (!participantId && normalizedRef && isOwnerLikeParticipantRef(normalizedRef) && ownerId) {
        participantId = ownerId;
      }
      if (!participantId) return;
      totals.set(participantId, Number((Number(totals.get(participantId) || 0) + amount).toFixed(2)));
    };

    let usedTimelineEvents = 0;
    (Array.isArray(bookingTimelineEvents) ? bookingTimelineEvents : []).forEach((event) => {
      const normalizedType = String(event?.type || '').trim().toUpperCase();
      if (normalizedType !== 'PAYMENT_RECEIVED') return;
      const payload =
        event?.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : {};
      const amount = Number((payload as any)?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0.009) return;
      usedTimelineEvents += 1;
      const payerRef = String((payload as any)?.payerParticipantRef || '').trim();
      const payerName = String((payload as any)?.payerParticipantName || '').trim();
      addPayerAmount(payerRef, payerName, amount);
    });

    if (usedTimelineEvents === 0) {
      const payerFallback = Array.isArray(editingBooking?.hoverPayment?.payerParticipants)
        ? editingBooking?.hoverPayment?.payerParticipants
        : [];
      payerFallback.forEach((row) => {
        addPayerAmount(row?.ref, row?.name, row?.amount);
      });
    }

    return totals;
  }, [
    bookingKind,
    bookingTimelineEvents,
    editingBooking?.clientId,
    editingBooking?.hoverPayment?.payerParticipants,
    editingBooking?.userId,
    participants,
    persistedEditingBookingId,
  ]);
  const participantAssignedAmountById = useMemo(() => {
    const assigned = new Map<string, number>();
    participants.forEach((participant) => {
      assigned.set(participant.id, 0);
    });

    if (paymentMode === 'Único') {
      const responsibleId = String(singleChargeParticipantId || '').trim() ||
        participants.find((participant) => participant.isOwner)?.id ||
        participants[0]?.id ||
        '';
      if (responsibleId) {
        assigned.set(responsibleId, Number(totalPrice.toFixed(2)));
      }
      return assigned;
    }

    participants.forEach((participant) => {
      if (!chargedParticipantIdSet.has(participant.id)) return;
      assigned.set(participant.id, Number(resolveParticipantPrice(participant).toFixed(2)));
    });
    return assigned;
  }, [
    chargedParticipantIdSet,
    participants,
    paymentMode,
    resolveParticipantPrice,
    singleChargeParticipantId,
    totalPrice,
  ]);
  const participantDebtAmountById = useMemo(() => {
    const debt = new Map<string, number>();
    participants.forEach((participant) => {
      const assigned = Number(participantAssignedAmountById.get(participant.id) || 0);
      const covered = Number(participantCoverageAmountById.get(participant.id) || 0);
      debt.set(participant.id, Number(Math.max(0, assigned - covered).toFixed(2)));
    });
    return debt;
  }, [participantAssignedAmountById, participantCoverageAmountById, participants]);
  const participantPaidComputedIdSet = useMemo(() => {
    const paidIds = new Set<string>();
    participants.forEach((participant) => {
      const assigned = Number(participantAssignedAmountById.get(participant.id) || 0);
      if (assigned <= 0.009) return;
      const debt = Number(participantDebtAmountById.get(participant.id) || 0);
      if (debt <= 0.009) {
        paidIds.add(participant.id);
      }
    });
    return paidIds;
  }, [participantAssignedAmountById, participantDebtAmountById, participants]);
  const isClassBooking = bookingKind === 'privateClass' || bookingKind === 'courseClass';
  const priceFieldLabel = 'Precio total';
  const priceFieldHint = isClassBooking
    ? 'En clases, este total se distribuye entre los alumnos cargados.'
    : paymentMode === 'Único'
      ? 'En reserva normal, paga una sola persona.'
      : 'En reserva normal, se reparte automáticamente entre participantes.';
  const exceedsRemainingWarning = useMemo(() => {
    if (!bookingFinancial || bookingFinancial.remaining <= 0.009) return false;
    return participants.some((participant) => {
      if (paymentMode === 'Único' && !participant.isOwner) return false;
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
      formError === 'No podés guardar con participantes duplicados.' ||
      formError === 'Ese participante ya está agregado en esta reserva.'
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
    const cardWidth = 292;
    const cardHeight = estimateBookingHoverTarjetaHeight(participantsCount);
    const gap = 10;
    const bottomGap = 24;
    const stickyHeaderHeight = 40;
    const bounds = agendaSurfaceRef.current
      ? agendaSurfaceRef.current.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const viewportBottom = typeof window !== 'undefined' ? window.innerHeight - bottomGap : bounds.bottom - bottomGap;
    const safeBottom = Math.min(bounds.bottom - gap, viewportBottom);

    const minX = bounds.left + gap;
    const maxX = bounds.right - cardWidth - gap;
    const minY = bounds.top + stickyHeaderHeight + gap;
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
              : (() => {
                  const rawId = String(client?.id || '').trim();
                  if (!rawId) return undefined;
                  const normalizedClientId = rawId.startsWith('client-') ? rawId.slice('client-'.length).trim() : rawId;
                  return normalizedClientId ? `client:${normalizedClientId}` : undefined;
                })();
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

  const fetchParticipantSuggestionsForDraft = useCallback(async (query: string) => {
    const safeQuery = String(query || '').trim();
    if (!safeQuery) return [] as ParticipantSuggestion[];
    const guestSuggestion: ParticipantSuggestion = {
      id: `guest-draft-${safeQuery}`,
      label: safeQuery,
      secondary: 'Invitado',
      sourceType: 'guest',
      entityRef: `guest:${toSlugToken(safeQuery)}`,
      name: safeQuery,
    };

    const slug = getClubSlug();
    if (!slug || safeQuery.length < 2) return [guestSuggestion];

    try {
      const clients = await ClubAdminService.getClients(slug, safeQuery);
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
              : (() => {
                  const rawId = String(client?.id || '').trim();
                  if (!rawId) return undefined;
                  const normalizedClientId = rawId.startsWith('client-') ? rawId.slice('client-'.length).trim() : rawId;
                  return normalizedClientId ? `client:${normalizedClientId}` : undefined;
                })();
          return {
            id: `draft-${client?.id || index}`,
            label: String(client?.name || safeQuery),
            secondary:
              phone || email || (sourceType === 'systemUser' ? 'Usuario del sistema' : 'Cliente del club'),
            sourceType,
            entityRef: stableRef,
            name: String(client?.name || safeQuery),
            contact: phone || email || '',
          } satisfies ParticipantSuggestion;
        });
      return [...clientSuggestions, guestSuggestion];
    } catch {
      return [guestSuggestion];
    }
  }, [getClubSlug]);

  const runSimplifiedOwnerSearch = useCallback(async (ownerId: string, rawValue: string) => {
    updateParticipant(ownerId, {
      name: rawValue,
      contact: '',
      sourceType: 'guest',
      entityRef: undefined,
    });
    const query = String(rawValue || '').trim();
    if (!query) {
      setSimplifiedOwnerSuggestionsOpen(false);
      setSimplifiedOwnerSearchLoading(false);
      setSimplifiedOwnerSuggestions([]);
      return;
    }
    setSimplifiedOwnerSuggestionsOpen(true);
    setSimplifiedOwnerSearchLoading(true);
    const allSuggestions = await fetchParticipantSuggestionsForDraft(query);
    // Fase 1.4: el titular siempre debe ser un Client del club.
    // No mostrar "Invitado" en el dropdown del titular — solo clientes existentes.
    // Un titular nuevo (sin clientId) se crea como Client operativo vía clientDraft.
    const ownerSuggestions = allSuggestions.filter((s) => s.sourceType !== 'guest');
    setSimplifiedOwnerSuggestions(ownerSuggestions);
    setSimplifiedOwnerSearchLoading(false);
  }, [fetchParticipantSuggestionsForDraft, updateParticipant]);

  const applySimplifiedOwnerSuggestion = useCallback((ownerId: string, suggestion: ParticipantSuggestion) => {
    updateParticipant(ownerId, {
      name: suggestion.name,
      contact: suggestion.contact || '',
      sourceType: suggestion.sourceType,
      entityRef: suggestion.entityRef,
    });
    setSimplifiedOwnerSuggestionsOpen(false);
    setSimplifiedOwnerSearchLoading(false);
    setSimplifiedOwnerSuggestions([]);
    setFormError('');
  }, [updateParticipant]);

  const runSimplifiedNewParticipantSearch = useCallback(async (rawValue: string) => {
    setSimplifiedNewParticipantName(rawValue);
    setSimplifiedNewParticipantContact('');
    setSimplifiedNewParticipantSourceTypeDraft('guest');
    setSimplifiedNewParticipantEntityRefDraft('');
    const query = String(rawValue || '').trim();
    if (!query) {
      setSimplifiedNewParticipantSuggestionsOpen(false);
      setSimplifiedNewParticipantSearchLoading(false);
      setSimplifiedNewParticipantSuggestions([]);
      return;
    }
    setSimplifiedNewParticipantSuggestionsOpen(true);
    setSimplifiedNewParticipantSearchLoading(true);
    const suggestions = await fetchParticipantSuggestionsForDraft(query);
    const existingRefs = new Set(
      participants
        .map((participant) => String(participant.entityRef || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const existingIdentityTokens = new Set(
      participants
        .filter((participant) => participant.name.trim().length > 0)
        .flatMap((participant) => participantIdentityTokens(participant))
    );
    const filteredSuggestions = suggestions.filter((suggestion) => {
      const suggestionRef = String(suggestion.entityRef || '').trim().toLowerCase();
      if (suggestionRef && existingRefs.has(suggestionRef)) return false;
      const suggestionTokens = participantIdentityTokens({
        sourceType: suggestion.sourceType,
        name: suggestion.name,
        contact: suggestion.contact || '',
      });
      if (suggestionTokens.some((token) => existingIdentityTokens.has(token))) return false;
      return true;
    });
    setSimplifiedNewParticipantSuggestions(filteredSuggestions);
    setSimplifiedNewParticipantSearchLoading(false);
  }, [fetchParticipantSuggestionsForDraft, participants]);

  const applySimplifiedNewParticipantSuggestion = useCallback((suggestion: ParticipantSuggestion) => {
    setSimplifiedNewParticipantName(suggestion.name);
    setSimplifiedNewParticipantContact(String(suggestion.contact || '').trim());
    setSimplifiedNewParticipantSourceTypeDraft(suggestion.sourceType);
    setSimplifiedNewParticipantEntityRefDraft(String(suggestion.entityRef || '').trim());
    setSimplifiedNewParticipantSuggestionsOpen(false);
    setSimplifiedNewParticipantSearchLoading(false);
    setSimplifiedNewParticipantSuggestions([]);
    setFormError('');
  }, []);

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
      setFormError('Ese participante ya está agregado en esta reserva.');
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

  const applyOptimisticBookingPaymentUpdate = useCallback((bookingId: number, paidDelta: number) => {
    const safeDelta = Number(Number(paidDelta || 0).toFixed(2));
    if (!Number.isFinite(safeDelta) || safeDelta <= 0.009) return;

    setBookings((previous) =>
      previous.map((booking) => {
        if (String(booking.id) !== String(bookingId)) return booking;

        const currentHover = booking.hoverPayment;
        const currentPaid = Number(currentHover?.paidAmount || 0);
        const currentRemaining = Number(currentHover?.remainingAmount || 0);
        const currentTotal = Number(currentHover?.totalAmount || 0);
        const fallbackTotal = Number(Math.max(currentTotal, currentPaid + currentRemaining).toFixed(2));
        const nextPaid = Number((currentPaid + safeDelta).toFixed(2));
        const nextRemaining = Number(Math.max(0, currentRemaining - safeDelta).toFixed(2));
        const nextTotal = Number(Math.max(fallbackTotal, nextPaid + nextRemaining).toFixed(2));
        const nextHoverStatus: Booking['hoverPayment']['status'] =
          nextRemaining <= 0.009 ? 'PAID' : nextPaid > 0.009 ? 'PARTIAL' : 'UNPAID';
        const nextPaymentState: Booking['paymentState'] =
          nextHoverStatus === 'PAID' ? 'paid' : nextHoverStatus === 'PARTIAL' ? 'partial' : 'unpaid';

        return {
          ...booking,
          paymentState: nextPaymentState,
          hoverPayment: {
            status: nextHoverStatus,
            totalAmount: nextTotal,
            paidAmount: nextPaid,
            remainingAmount: nextRemaining,
            chargeMode: String(currentHover?.chargeMode || 'INDIVIDUAL'),
            chargeResponsibleRef: currentHover?.chargeResponsibleRef ?? null,
            chargeResponsibleName: currentHover?.chargeResponsibleName ?? null,
            latestPayerRef: currentHover?.latestPayerRef ?? null,
            latestPayerName: currentHover?.latestPayerName ?? null,
            latestCoveredRef: currentHover?.latestCoveredRef ?? null,
            latestCoveredName: currentHover?.latestCoveredName ?? null,
            participants: currentHover?.participants,
            payerParticipants: currentHover?.payerParticipants,
            coveredParticipants: currentHover?.coveredParticipants,
          },
        };
      })
    );
  }, []);

  const registerPaymentNow = useCallback(async (input: {
    amount: number;
    method: Participant['paymentMethod'];
    successMessage?: string;
    silentSuccessNotice?: boolean;
    participantId?: string;
    coveredParticipantId?: string;
    itemAllocations?: Array<{ accountItemId: string; amount: number }>;
  }) => {
    const lockPaymentsNow = Boolean(
      persistedEditingBookingId &&
      bookingKind !== 'block' &&
      bookingFinancial?.confirmationMode === 'MANUAL' &&
      editingBooking?.state === 'pending'
    );
    if (lockPaymentsNow) {
      showCalendarNotice('Primero confirmá la reserva para poder registrar pagos.');
      return false;
    }
    if (!persistedEditingBookingId || bookingKind === 'block') {
      showCalendarNotice('Primero creá/abrí una reserva válida.');
      return false;
    }

    const amount = Number(Number(input.amount || 0).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0.009) {
      showCalendarNotice('Ingresá un monto mayor a 0.');
      return false;
    }

    const effectiveParticipantId = (() => {
      if (paymentMode !== 'Único') return input.participantId;
      const confirmedFromDraft = Boolean(
        bookingDrawerState.draft?.billing.payments.some(
          (payment) => payment.status === 'CONFIRMED' && Number(payment.amount || 0) > 0.009
        )
      );
      const confirmedFromFinancial = Number(bookingFinancial?.paid || 0) > 0.009;
      const hasConfirmedPayments = confirmedFromDraft || confirmedFromFinancial;
      const explicitResponsibleId = String(singleChargeParticipantId || '').trim();
      const requestedParticipantId = String(input.participantId || '').trim();

      if (
        !hasConfirmedPayments &&
        requestedParticipantId &&
        requestedParticipantId !== explicitResponsibleId &&
        participants.some((participant) => participant.id === requestedParticipantId)
      ) {
        setBillingConfigTouchedByUser(true);
        bookingDrawerDispatch({ type: 'SET_CHARGE_RESPONSIBLE', payload: { participantId: requestedParticipantId } });
        return requestedParticipantId;
      }

      if (hasConfirmedPayments && explicitResponsibleId) return explicitResponsibleId;
      if (input.participantId) return input.participantId;
      if (explicitResponsibleId) return explicitResponsibleId;
      const ownerParticipant = participants.find((participant) => participant.isOwner);
      return ownerParticipant?.id;
    })();
    const effectiveCoveredParticipantId = (() => {
      const requestedCoveredParticipantId = String(input.coveredParticipantId || '').trim();
      if (requestedCoveredParticipantId && participants.some((participant) => participant.id === requestedCoveredParticipantId)) {
        return requestedCoveredParticipantId;
      }
      if (paymentMode === 'Único') {
        const explicitResponsibleId = String(singleChargeParticipantId || '').trim();
        if (explicitResponsibleId && participants.some((participant) => participant.id === explicitResponsibleId)) {
          return explicitResponsibleId;
        }
      }
      return String(effectiveParticipantId || '').trim();
    })();

    try {
      if (effectiveParticipantId) {
        setPaymentInFlightId(effectiveParticipantId);
      }
      setIsWaitingQueuedPaymentConfirmation(true);
      setFormError('');

      const bookingUserIdRaw = Number(editingBooking?.userId || 0);
      const payerParticipant =
        (effectiveParticipantId
          ? participants.find((participant) => participant.id === effectiveParticipantId)
          : null) ||
        participants.find((participant) => participant.isOwner) ||
        participants[0];
      const payerParticipantRef = payerParticipant
        ? buildStableParticipantRef(payerParticipant, {
            bookingClientId: String(editingBooking?.clientId || '').trim() || undefined,
            bookingUserId:
              Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
                ? bookingUserIdRaw
                : undefined,
          })
        : undefined;
      const payerParticipantName = payerParticipant
        ? (String(payerParticipant.name || '').trim() || (payerParticipant.isOwner ? 'Titular' : 'Participante'))
        : undefined;
      const coveredParticipant =
        (effectiveCoveredParticipantId
          ? participants.find((participant) => participant.id === effectiveCoveredParticipantId)
          : null) ||
        payerParticipant;
      const coveredParticipantRef = coveredParticipant
        ? buildStableParticipantRef(coveredParticipant, {
            bookingClientId: String(editingBooking?.clientId || '').trim() || undefined,
            bookingUserId:
              Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
                ? bookingUserIdRaw
                : undefined,
          })
        : undefined;
      const coveredParticipantName = coveredParticipant
        ? (String(coveredParticipant.name || '').trim() || (coveredParticipant.isOwner ? 'Titular' : 'Participante'))
        : undefined;

      const paymentChannel = input.method === 'TRANSFER' ? 'BANK_ACCOUNT' : undefined;
      await registerBookingPartialPayment(
        persistedEditingBookingId,
        amount,
        input.method,
        paymentChannel,
        input.itemAllocations,
        {
          participantRef: payerParticipantRef,
          participantName: payerParticipantName,
        },
        {
          participantRef: coveredParticipantRef,
          participantName: coveredParticipantName,
        }
      );
      applyOptimisticBookingPaymentUpdate(persistedEditingBookingId, amount);

      if (Array.isArray(input.itemAllocations) && input.itemAllocations.length > 0) {
        const allocationByItemId = new Map<string, number>();
        input.itemAllocations.forEach((allocation) => {
          const itemId = String(allocation.accountItemId || '').trim();
          if (!itemId) return;
          const current = Number(allocationByItemId.get(itemId) || 0);
          allocationByItemId.set(itemId, Number((current + Number(allocation.amount || 0)).toFixed(2)));
        });
        if (allocationByItemId.size > 0) {
          setBookingAccountItems((previous) => {
            const next = previous.map((item) => {
              const allocated = Number(allocationByItemId.get(String(item.id)) || 0);
              if (allocated <= 0.009) return item;
              const nextPaid = Number((Number(item.paidAmount || 0) + allocated).toFixed(2));
              const nextRemaining = Number(Math.max(0, Number(item.totalPrice || 0) - nextPaid).toFixed(2));
              return {
                ...item,
                paidAmount: nextPaid,
                remainingAmount: nextRemaining,
              };
            });
            setBookingConsumptionItems(next.filter((entry) => entry.type !== 'BOOKING'));
            return next;
          });
        }
      }
      await reloadSchedule();
      const latestFinancialSummary = await refreshBookingFinancial(persistedEditingBookingId);
      await loadBookingConsumptions(persistedEditingBookingId);
      setParticipants((previous) =>
        distributePaidByParticipants(
          previous,
          paymentMode,
          Number(latestFinancialSummary?.total || 0),
          Number(latestFinancialSummary?.paid || 0),
          effectiveCoveredParticipantId
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

      if (!input.silentSuccessNotice) {
        showCalendarNotice(input.successMessage || `Pago registrado: ${amount.toFixed(2)} $.`, 'success');
      }
      if (paymentMode === 'Único' && effectiveParticipantId) {
        const currentResponsibleId = String(
          bookingDrawerState.draft?.billing.chargeResponsibleParticipantId || ''
        ).trim();
        if (
          currentResponsibleId !== effectiveParticipantId &&
          participants.some((participant) => participant.id === effectiveParticipantId)
        ) {
          setBillingConfigTouchedByUser(true);
          bookingDrawerDispatch({ type: 'SET_CHARGE_RESPONSIBLE', payload: { participantId: effectiveParticipantId } });
          try {
            const bookingClientIdRaw = String(editingBooking?.clientId || '').trim();
            const bookingClientId = bookingClientIdRaw.length > 0 ? bookingClientIdRaw : undefined;
            const bookingUserIdRaw = Number(editingBooking?.userId || 0);
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

            const totalChargeableAmount = Number(
              Number(
                bookingDrawerState.draft?.billing.financialSummary.totalAmount ??
                  latestFinancialSummary?.total ??
                  0
              ).toFixed(2)
            );
            const assignmentByParticipantId = new Map<string, string>();
            (bookingDrawerState.draft?.billing.assignments || []).forEach((assignment) => {
              const participantId = String(assignment?.participantId || '').trim();
              if (!participantId) return;
              assignmentByParticipantId.set(
                participantId,
                String(assignment?.id || `asg-${participantId}`)
              );
            });

            const payloadAssignments = participants.map((participant) => {
              const participantId = String(participant.id || '').trim();
              const participantRef =
                participantRefById.get(participantId) || `guest:${participantId}`;
              const isChargeable = participantId === effectiveParticipantId;
              return {
                id: assignmentByParticipantId.get(participantId) || `asg-${participantId}`,
                participantRef,
                isChargeable,
                assignedAmount: isChargeable ? totalChargeableAmount : 0,
                participantLinkState: 'ACTIVE' as const,
              };
            });

            const chargeResponsibleRef =
              participantRefById.get(String(effectiveParticipantId)) ||
              `guest:${String(effectiveParticipantId)}`;
            const sidebarParticipantsMetadata = buildSidebarParticipantsMetadata(participants);

            const savedConfig = await updateBookingBillingConfig(persistedEditingBookingId, {
              chargeMode: 'INDIVIDUAL',
              chargeResponsibleRef,
              assignments: payloadAssignments,
              metadata: {
                schemaVersion: 1,
                client: 'agenda-admin-v2',
                sidebarParticipants: sidebarParticipantsMetadata,
                sidebar: {
                  participants: sidebarParticipantsMetadata,
                },
              },
            });
            remoteBillingConfigRequestSeqRef.current += 1;
            setRemoteBillingConfig(savedConfig);
          } catch (persistError) {
            reportUiError({ area: 'AgendaPlayground', action: 'persistChargeResponsibleAfterPayment' }, persistError);
          }
        }
      }
      return true;
    } catch (error: any) {
      const message = toUserSafeMessage(error?.message, 'No se pudo registrar el pago.');
      setFormError(message);
      showCalendarNotice(message);
      return false;
    } finally {
      if (effectiveParticipantId) {
        setPaymentInFlightId((previous) => (previous === effectiveParticipantId ? null : previous));
      }
      setIsWaitingQueuedPaymentConfirmation(false);
    }
  }, [
    bookingFinancial?.confirmationMode,
    bookingFinancial?.paid,
    bookingDrawerState.draft,
    bookingKind,
    editingBooking?.clientId,
    editingBooking?.state,
    editingBooking?.userId,
    paymentMode,
    participants,
    persistedEditingBookingId,
    loadBookingConsumptions,
    refreshBookingFinancial,
    reloadSchedule,
    singleChargeParticipantId,
    showCalendarNotice,
    applyOptimisticBookingPaymentUpdate,
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
      showCalendarNotice('Primero creá la reserva. Después podés agregar más participantes.');
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

  const removeParticipant = useCallback((id: string) => {
    const participantId = String(id || '').trim();
    if (!participantId) return;
    const participantToRemove = participants.find((participant) => participant.id === participantId);
    if (!participantToRemove || participantToRemove.isOwner) return;

    const remainingParticipants = participants.filter((participant) => participant.id !== participantId);
    const fallbackResponsibleParticipant =
      remainingParticipants.find((participant) => participant.isOwner) ||
      remainingParticipants.find((participant) => participant.name.trim().length > 0) ||
      remainingParticipants[0];
    const nextResponsibleParticipantId = String(fallbackResponsibleParticipant?.id || '').trim();

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;
    const removedParticipantLabel =
      String(participantToRemove.name || '').trim() ||
      (participantToRemove.isOwner ? 'Titular' : 'Participante sin nombre');
    const refsForHistory = new Set<string>();
    refsForHistory.add(buildStableParticipantRef(participantToRemove, { bookingClientId, bookingUserId }));
    refsForHistory.add(String(participantToRemove.entityRef || '').trim());
    refsForHistory.add(`guest:${participantToRemove.id}`);
    if (participantToRemove.isOwner) {
      refsForHistory.add('guest:owner');
      refsForHistory.add('guest:booking-responsible');
      if (bookingClientId) refsForHistory.add(`booking-client:${bookingClientId}`);
      if (bookingUserId) refsForHistory.add(`booking-user:${bookingUserId}`);
    }
    setParticipantLabelByRefCache((previous) => {
      const next = { ...previous };
      refsForHistory.forEach((ref) => {
        const safeRef = String(ref || '').trim();
        if (!safeRef) return;
        next[safeRef] = removedParticipantLabel;
      });
      return next;
    });

    setParticipants(remainingParticipants);
    setParticipantMenuId((previous) => (previous === participantId ? null : previous));
    setExpandedParticipantId((previous) => (previous === participantId ? null : previous));
    setParticipantSearchOpenId((previous) => (previous === participantId ? null : previous));
    setParticipantSearchLoadingId((previous) => (previous === participantId ? null : previous));
    setParticipantSuggestionsById((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, participantId)) return previous;
      const next = { ...previous };
      delete next[participantId];
      return next;
    });
    setSimplifiedEditingParticipantId((previous) => (previous === participantId ? null : previous));
    setSimplifiedEditPaymentMethodDraft((previous) =>
      simplifiedEditingParticipantId === participantId ? '' : previous
    );

    const payerDraftId = String(simplifiedPaymentPayerParticipantIdDraft || '').trim();
    if (payerDraftId === participantId) {
      const fallbackPayer =
        fallbackResponsibleParticipant ||
        remainingParticipants.find((participant) => participant.isOwner) ||
        remainingParticipants[0];
      const fallbackPaymentMethod = String(fallbackPayer?.paymentMethod || '');
      setSimplifiedPaymentPayerParticipantIdDraft(String(fallbackPayer?.id || ''));
      setSimplifiedPaymentMethodDraft(
        isParticipantPaymentMethod(fallbackPaymentMethod)
          ? fallbackPaymentMethod
          : 'CASH'
      );
    }

    const isRemovingChargeResponsible =
      paymentMode === 'Único' &&
      participantId === effectiveSingleChargeResponsibleParticipantId;
    if (isRemovingChargeResponsible && nextResponsibleParticipantId) {
      setBillingConfigTouchedByUser(true);
      bookingDrawerDispatch({
        type: 'SET_CHARGE_RESPONSIBLE',
        payload: { participantId: nextResponsibleParticipantId },
      });
      const nextResponsibleLabel =
        String(fallbackResponsibleParticipant?.name || '').trim() ||
        (fallbackResponsibleParticipant?.isOwner ? 'Titular' : 'Participante');
      pendingParticipantSaveNoticeRef.current =
        `Participante eliminado. Responsable de pago reasignado a ${nextResponsibleLabel}.`
      return;
    }

    if (!pendingParticipantSaveNoticeRef.current) {
      pendingParticipantSaveNoticeRef.current = 'Participante eliminado.';
    }
  }, [
    bookingDrawerDispatch,
    editingBooking?.clientId,
    editingBooking?.userId,
    effectiveSingleChargeResponsibleParticipantId,
    participants,
    paymentMode,
    setExpandedParticipantId,
    setParticipantMenuId,
    simplifiedEditingParticipantId,
    simplifiedPaymentPayerParticipantIdDraft,
  ]);

  const markParticipantAsPending = useCallback((id: string) => {
    if (persistedEditingBookingId) {
      setFormError('Para volver a pendiente una reserva cobrada hay que gestionar una devolución.');
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
      await Promise.all([
        refreshBookingFinancial(persistedEditingBookingId),
        loadBookingConsumptions(persistedEditingBookingId),
      ]);
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
      showCalendarNotice('Reserva confirmada. Ya podés registrar pagos.', 'success');
    } catch (error: any) {
      applyBookingError(error, 'No se pudo confirmar la reserva.');
    } finally {
      setConfirmingBooking(false);
    }
  }, [
    applyBookingError,
    loadBookingConsumptions,
    persistedEditingBookingId,
    refreshBookingFinancial,
    reloadSchedule,
    showCalendarNotice,
  ]);

  const mapSeriesImpactItem = useCallback((item: any, fallbackCourtName: string): RecurringOverlapItem => {
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
    const inferredRequestedEnd =
      hasRequestedStart && !hasRequestedEnd
        ? new Date((requestedStart as Date).getTime() + Math.max(15, selectionMinutes) * 60000)
        : null;

    return {
      courtName: String(item?.courtName || item?.conflictingCourtName || fallbackCourtName || 'Cancha'),
      requestedDateLabel: hasRequestedStart
        ? (requestedStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : selectedDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      requestedTimeLabel: `${
        hasRequestedStart
          ? (requestedStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
          : slotToTime(selectedStartSlot)
      } - ${
        hasRequestedEnd
          ? (requestedEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
          : inferredRequestedEnd
            ? inferredRequestedEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : slotToTime(selectedEndSlot)
      }`,
      conflictingDateLabel: hasConflictingStart
        ? (conflictingStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : undefined,
      conflictingTimeLabel:
        hasConflictingStart && hasConflictingEnd
          ? `${(conflictingStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${(conflictingEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
          : undefined,
      activityName: String(item?.reason || item?.conflictingActivityName || item?.activityName || '').trim() || undefined,
      clientName: String(item?.conflictingClientName || item?.clientName || '').trim() || undefined,
    };
  }, [selectedDate, selectedEndSlot, selectedStartSlot, selectionMinutes]);

  const mapSeriesAppliedItem = useCallback((item: any, fallbackCourtName: string): RecurringCreatedItem => {
    const startRaw = item?.startDateTime || item?.requestedStartDateTime || item?.date || null;
    const endRaw = item?.endDateTime || item?.requestedEndDateTime || null;
    const startDate = startRaw ? new Date(startRaw) : null;
    const endDate = endRaw ? new Date(endRaw) : null;
    const hasStart = startDate && !Number.isNaN(startDate.getTime());
    const hasEnd = endDate && !Number.isNaN(endDate.getTime());
    const inferredEnd =
      hasStart && !hasEnd
        ? new Date((startDate as Date).getTime() + Math.max(15, selectionMinutes) * 60000)
        : null;

    return {
      bookingId: Number.isFinite(Number(item?.bookingId)) ? Number(item.bookingId) : undefined,
      courtName: String(item?.courtName || fallbackCourtName || 'Cancha'),
      requestedDateLabel: hasStart
        ? (startDate as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : selectedDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      requestedTimeLabel: `${
        hasStart
          ? (startDate as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
          : slotToTime(selectedStartSlot)
      } - ${
        hasEnd
          ? (endDate as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
          : inferredEnd
            ? inferredEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
            : slotToTime(selectedEndSlot)
      }`,
      activityName: String(item?.activityName || '').trim() || undefined,
      sortStartMs: hasStart ? (startDate as Date).getTime() : undefined,
    };
  }, [selectedDate, selectedEndSlot, selectedStartSlot, selectionMinutes]);

  const resolveSeriesPaidOccurrences = useCallback(async (items: RecurringCreatedItem[]) => {
    const rows = await Promise.all(
      items.map(async (item) => {
        const bookingId = Number(item.bookingId || 0);
        if (!Number.isFinite(bookingId) || bookingId <= 0) return null;
        const summary = await getBookingFinancialSummary(bookingId);
        const paidAmount = roundMoney(Number(summary?.paid || 0));
        if (paidAmount <= 0.009) return null;
        return { ...item, bookingId, paidAmount };
      })
    );
    return rows.filter((item): item is SeriesPaidOccurrence => Boolean(item));
  }, []);

  const previewSeriesEditScope = useCallback(async (scope: EditSeriesScope) => {
    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    const numericBookingId = Number(editingBookingId || 0);
    const numericCourtId = Number(selectedCourtId || 0);
    if (!Number.isFinite(fixedBookingId) || fixedBookingId <= 0) return;
    if (!Number.isFinite(numericCourtId) || numericCourtId <= 0) {
      setBlockingFieldError('court', 'Seleccioná una cancha válida para editar la serie.');
      return;
    }
    try {
      setSeriesEditPreviewScope(scope);
      setSeriesEditPreviewSummary(null);
      setSeriesEditPreviewLoading(true);
      setFormError('');
      const result: any = await rescheduleFixedBooking(fixedBookingId, {
        scope,
        occurrenceBookingId: Number.isFinite(numericBookingId) && numericBookingId > 0 ? numericBookingId : undefined,
        courtId: numericCourtId,
        startDateTime: buildStartDateTimeFromSlot(selectedDate, selectedStartSlot),
        durationMinutes: Math.max(15, (selectedEndSlot - selectedStartSlot) * slotMinutes),
        previewOnly: true,
      });
      const overlapItemsRaw = Array.isArray(result?.overlaps) ? result.overlaps : [];
      const applicableItemsRaw = Array.isArray(result?.applicableItems) ? result.applicableItems : [];
      const failureMessages = Array.isArray(result?.failures)
        ? result.failures
            .map((item: any) => String(item?.reason || '').trim())
            .filter((value: string) => value.length > 0)
        : [];
      setSeriesEditPreviewSummary({
        scope,
        totalCandidates: Number(result?.totalCandidates || 0),
        applicableCount: Number(result?.willUpdateCount || result?.updatedCount || 0),
        applicableItems: applicableItemsRaw
          .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha'))
          .sort((a, b) => (Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0))),
        skippedCount: overlapItemsRaw.length + failureMessages.length,
        overlapItems: overlapItemsRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha')),
        failureMessages,
      });
    } catch (error: any) {
      setSeriesEditPreviewScope(null);
      applyBookingError(error, 'No se pudo previsualizar la edición de la serie.');
    } finally {
      setSeriesEditPreviewLoading(false);
    }
  }, [applyBookingError, editingBooking?.fixedBookingId, editingBookingId, mapSeriesAppliedItem, mapSeriesImpactItem, selectedCourt?.name, selectedCourtId, selectedDate, selectedEndSlot, selectedStartSlot, setBlockingFieldError]);

  const previewSeriesDeleteScope = useCallback(async (scope: EditSeriesScope) => {
    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    const numericBookingId = Number(editingBookingId || 0);
    if (!Number.isFinite(fixedBookingId) || fixedBookingId <= 0) return;
    try {
      setSeriesDeletePreviewScope(scope);
      setSeriesDeletePreviewSummary(null);
      setSeriesDeletePreviewLoading(true);
      setFormError('');
      const result: any = await cancelFixedBooking(fixedBookingId, {
        scope,
        occurrenceBookingId: Number.isFinite(numericBookingId) && numericBookingId > 0 ? numericBookingId : undefined,
        previewOnly: true,
      });
      const skippedRaw = Array.isArray(result?.skipped) ? result.skipped : [];
      const applicableItemsRaw = Array.isArray(result?.applicableItems) ? result.applicableItems : [];
      const applicableItems = applicableItemsRaw
        .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha'))
        .sort((a, b) => (Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0)));
      const paidItems = await resolveSeriesPaidOccurrences(applicableItems);
      setSeriesDeletePreviewSummary({
        scope,
        totalCandidates: Number(result?.totalCandidates || 0),
        applicableCount: Number(result?.cancelledCount || 0),
        applicableItems,
        skippedCount: skippedRaw.length,
        overlapItems: skippedRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha')),
        failureMessages: [],
        paidItems,
        paidAmountTotal: roundMoney(paidItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0)),
      });
    } catch (error: any) {
      setSeriesDeletePreviewScope(null);
      applyBookingError(error, 'No se pudo previsualizar la cancelación de la serie.');
    } finally {
      setSeriesDeletePreviewLoading(false);
    }
  }, [applyBookingError, editingBooking?.fixedBookingId, editingBookingId, mapSeriesAppliedItem, mapSeriesImpactItem, resolveSeriesPaidOccurrences, selectedCourt?.name]);

  const cancelBookingPaidAmount = roundMoney(Math.max(
    Number(bookingFinancial?.paid || 0),
    Number(editingBooking?.hoverPayment?.paidAmount || 0),
    Number(bookingDrawerState.draft?.billing.financialSummary.paidAmount || 0)
  ));
  const cancelBookingHasPayments = cancelBookingPaidAmount > 0.009;
  const parsedCancelRefundAmount = Number(String(cancelRefundAmountInput || '').replace(',', '.'));
  const normalizedCancelRefundAmount = Number.isFinite(parsedCancelRefundAmount)
    ? roundMoney(parsedCancelRefundAmount)
    : 0;

  const closeDeleteBookingFlow = useCallback(() => {
    if (isDeletingBooking) return;
    setDeleteBookingConfirmOpen(false);
    setDeleteBookingFinalConfirmOpen(false);
    setCancelBookingFlowError('');
  }, [isDeletingBooking]);

  const closeSeriesOperationResult = useCallback(() => {
    setSeriesOperationResultOpen(false);
    if (seriesOperationResult?.mode === 'delete') {
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
    }
  }, [seriesOperationResult?.mode]);

  const closeRecurringResultModal = useCallback(() => {
    const generatedCount = Number(recurringResult?.generatedCount || 0);
    setRecurringOverlapModalOpen(false);
    if (generatedCount > 0) {
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
      setFormError('');
    }
  }, [recurringResult?.generatedCount]);

  const buildCancelBookingOptions = useCallback((): {
    options?: {
      refund?: {
        amount?: number;
        executeNow?: boolean;
        reasonType?: CancelRefundReasonType;
        executionNotes?: string;
      };
    };
    error?: string;
  } => {
    if (isBookingFinancialLoading) {
      return { error: 'Esperá a que termine de cargar el impacto financiero de la reserva.' };
    }

    if (!cancelBookingHasPayments) return {};

    const amount = Number(String(cancelRefundAmountInput || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0.009) {
      return { error: 'Para cancelar una reserva con pagos, indicá un monto a devolver mayor a 0.' };
    }

    const refundAmount = roundMoney(amount);
    if (refundAmount > cancelBookingPaidAmount + 0.009) {
      return { error: `El monto a devolver no puede superar ${cancelBookingPaidAmount.toFixed(2)} $.` };
    }

    if (!cancelRefundExecuteNow && refundAmount + 0.009 < cancelBookingPaidAmount) {
      return { error: 'Si la devolución queda pendiente, debe ser por el total pagado.' };
    }

    return {
      options: {
        refund: {
          amount: refundAmount,
          executeNow: cancelRefundExecuteNow,
          reasonType: cancelRefundReasonType,
          executionNotes: cancelRefundExecutionNotes.trim() || undefined,
        },
      },
    };
  }, [
    cancelBookingHasPayments,
    cancelBookingPaidAmount,
    cancelRefundAmountInput,
    cancelRefundExecuteNow,
    cancelRefundExecutionNotes,
    cancelRefundReasonType,
    isBookingFinancialLoading,
  ]);

  const openDeleteBookingFlow = useCallback(() => {
    const isEditingRecurringSeries = Number(editingBooking?.fixedBookingId || 0) > 0;
    if (isEditingRecurringSeries) {
      setDeleteSeriesScopeModalOpen(true);
      setDeleteBookingConfirmOpen(false);
      setDeleteBookingFinalConfirmOpen(false);
      setSeriesDeletePreviewLoading(false);
      setSeriesDeletePreviewScope(null);
      setSeriesDeletePreviewSummary(null);
      return;
    }
    setCancelRefundAmountInput(cancelBookingPaidAmount > 0.009 ? cancelBookingPaidAmount.toFixed(2) : '');
    setCancelRefundReasonType(cancelBookingPaidAmount > 0.009 ? 'FULL' : 'OTHER');
    setCancelRefundExecutionNotes('');
    setCancelRefundExecuteNow(true);
    setCancelBookingFlowError('');
    setDeleteBookingFinalConfirmOpen(false);
    setDeleteBookingConfirmOpen(true);
  }, [cancelBookingPaidAmount, editingBooking?.fixedBookingId]);

  const handleDeleteBooking = useCallback(async (
    seriesScope?: EditSeriesScope,
    options?: {
      refund?: {
        amount?: number;
        executeNow?: boolean;
        reasonType?: CancelRefundReasonType;
        executionNotes?: string;
      };
    }
  ) => {
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

    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    const isEditingRecurringSeries = Number.isFinite(fixedBookingId) && fixedBookingId > 0;
    const shouldDeferDrawerCloseForSeriesResult = isEditingRecurringSeries && Boolean(seriesScope);

    try {
      setIsDeletingBooking(true);
      setFormError('');
      if (isEditingRecurringSeries && seriesScope) {
        const result: any = await cancelFixedBooking(fixedBookingId, {
          scope: seriesScope,
          occurrenceBookingId: Number.isFinite(numericBookingId) && numericBookingId > 0 ? numericBookingId : undefined,
        });
        const skippedRaw = Array.isArray(result?.skipped) ? result.skipped : [];
        const cancelledItemsRaw = Array.isArray(result?.cancelledItems)
          ? result.cancelledItems
          : Array.isArray(result?.applicableItems)
            ? result.applicableItems
            : [];
        const overlapItems = skippedRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha'));
        const appliedItems = cancelledItemsRaw
          .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha'))
          .sort((a, b) => (Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0)));
        const cancelledCount = Number(result?.cancelledCount || 0);
        setSeriesOperationResult({
          mode: 'delete',
          title: cancelledCount > 0 ? 'Serie cancelada' : 'No se cancelaron ocurrencias',
          detail:
            cancelledCount > 0
              ? `Se cancelaron ${cancelledCount} turno(s) de la serie.`
              : 'No se pudo cancelar ninguna ocurrencia con el alcance elegido.',
          appliedCount: cancelledCount,
          appliedItems,
          skippedCount: skippedRaw.length,
          overlapItems,
        });
        setSeriesOperationResultOpen(true);
      } else {
        await cancelBooking(numericBookingId, options);
      }
      await reloadSchedule();
      setDeleteBookingConfirmOpen(false);
      setDeleteBookingFinalConfirmOpen(false);
      if (!shouldDeferDrawerCloseForSeriesResult) {
        setDrawerOpen(false);
        setEditingBookingId(null);
        setEditingBaseline(null);
      }
    } catch (error: any) {
      applyBookingError(error, 'No se pudo eliminar/cancelar la reserva.');
    } finally {
      setIsDeletingBooking(false);
    }
  }, [applyBookingError, editingBooking?.fixedBookingId, editingBookingId, mapSeriesAppliedItem, mapSeriesImpactItem, reloadSchedule, selectedCourt?.name]);

  const confirmCancelBookingFromDrawer = useCallback(async () => {
    const result = buildCancelBookingOptions();
    if (result.error) {
      setCancelBookingFlowError(result.error);
      setDeleteBookingFinalConfirmOpen(false);
      return;
    }
    setCancelBookingFlowError('');
    setDeleteBookingFinalConfirmOpen(false);
    await handleDeleteBooking(undefined, result.options);
  }, [buildCancelBookingOptions, handleDeleteBooking]);

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
  const isSelectionInPastBlocking = isSelectionInPast && (!editingBookingId || hasScheduleChanges);
  const isPaymentLockedByManualPending = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    bookingFinancial?.confirmationMode === 'MANUAL' &&
    editingBooking?.state === 'pending'
  );
  const hasRegisteredPaymentsForCurrentBooking = useMemo(() => {
    const fromTimeline = (Array.isArray(bookingTimelineEvents) ? bookingTimelineEvents : []).some((event) => {
      const normalizedType = String(event?.type || '').trim().toUpperCase();
      return normalizedType === 'PAYMENT_RECEIVED';
    });
    const fromDraft = Boolean(
      bookingDrawerState.draft?.billing?.payments?.some(
        (payment) => payment.status === 'CONFIRMED' && Number(payment.amount || 0) > 0.009
      )
    );
    const fromFinancial = Number(bookingFinancial?.paid || 0) > 0.009;
    return fromTimeline || fromDraft || fromFinancial;
  }, [bookingDrawerState.draft?.billing?.payments, bookingFinancial?.paid, bookingTimelineEvents]);
  const isBillingConfigLockedByPayments = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    hasRegisteredPaymentsForCurrentBooking
  );
  const shouldHideBillingUntilCreated = Boolean(
    !persistedEditingBookingId &&
    bookingKind !== 'block'
  );
  const isCompletedReservation = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    editingBooking?.state === 'completed'
  );
  const isCompletedReservationScheduleLocked = isCompletedReservation;
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
    if (bookingKind === 'block' || editingBooking?.state === 'blocked') return 'bg-p-error-bg text-p-error';
    if (editingBooking?.state === 'completed') return 'bg-p-positive-bg text-p-accent';
    if (editingBooking?.state === 'confirmed') return 'bg-p-positive-bg text-p-positive';
    if (!editingBooking) return 'bg-p-positive-bg text-p-accent';
    return 'bg-p-warning-bg text-p-warning';
  }, [bookingKind, editingBooking]);
  const paymentStatusLabel = useMemo(() => {
    if (!persistedEditingBookingId || bookingKind === 'block') return 'Sin pago';
    if (!bookingFinancial) return editingBooking?.paymentState === 'paid' ? 'Pagada' : 'Sin pago';
    if (bookingFinancial.remaining <= 0.009) return 'Pagada';
    if (bookingFinancial.paid > 0.009) return 'Parcial';
    return 'Sin pago';
  }, [bookingFinancial, bookingKind, editingBooking?.paymentState, persistedEditingBookingId]);
  const paymentStatusTone = paymentStatusLabel === 'Pagada'
    ? 'bg-p-positive-bg text-p-positive'
    : paymentStatusLabel === 'Parcial'
      ? 'bg-p-warning-bg text-p-warning'
      : 'bg-p-surface-3 text-p-text-secondary';
  const isEditingRecurringSeries = Boolean(
    editingBookingId && Number(editingBooking?.fixedBookingId || 0) > 0
  );
  const shouldShowSeriesScopeHint = isEditingRecurringSeries && hasScheduleChanges;
  const canShowMainAction = Boolean(persistedEditingBookingId && bookingKind !== 'block');
  const showConfirmMainAction = canShowMainAction && isPaymentLockedByManualPending;
  const showCollectMainAction = canShowMainAction && !isPaymentLockedByManualPending && !isBookingFullyPaid;
  const shouldHideBillingUntilConfirmed = isPaymentLockedByManualPending || shouldHideBillingUntilCreated;
  const isPaymentsTabActive = billingHubTab === 'PAYMENTS';
  const bookingConsumptionsTotal = Number(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0).toFixed(2)
  );
  const bookingConsumptionsPaid = Number(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0).toFixed(2)
  );
  const bookingConsumptionsRemaining = Number(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0).toFixed(2)
  );
  const pendingAccountItems = useMemo(
    () =>
      bookingAccountItems.filter((item) => Number(item.remainingAmount || 0) > 0.009),
    [bookingAccountItems]
  );
  const pendingCourtAccountItems = useMemo(
    () => pendingAccountItems.filter((item) => item.type === 'BOOKING'),
    [pendingAccountItems]
  );
  const pendingConsumptionAccountItems = useMemo(
    () => pendingAccountItems.filter((item) => item.type !== 'BOOKING'),
    [pendingAccountItems]
  );
  const pendingAccountItemById = useMemo(() => {
    const map = new Map<string, BookingConsumptionItem>();
    pendingAccountItems.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [pendingAccountItems]);
  const bookingCourtAmount = Number(
    (usesPersistedFinancialSummary
      ? Number(bookingFinancial?.courtTotal || 0)
      : Math.max(0, Number(totalPrice || 0) - bookingConsumptionsTotal)
    ).toFixed(2)
  );
  const bookingItemsAmount = Number(
    (usesPersistedFinancialSummary
      ? Number(bookingFinancial?.itemsTotal || 0)
      : bookingConsumptionsTotal
    ).toFixed(2)
  );
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
  const computeConceptBasedMaxAmount = useCallback((
    conceptMode: PaymentConceptMode,
    selectedItemIds?: string[],
    customAmountDraftById?: Record<string, string>
  ) => {
    const selectedIds = new Set(
      (Array.isArray(selectedItemIds) ? selectedItemIds : simplifiedPaymentSelectedItemIdsDraft)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    if (conceptMode === 'CUSTOM') {
      const customDrafts = customAmountDraftById ?? simplifiedPaymentCustomItemAmountDraftById;
      const customSelectedAmount = Array.from(selectedIds).reduce((sum, itemId) => {
        const item = pendingAccountItemById.get(itemId);
        if (!item) return sum;
        const fallback = Number(item.remainingAmount || 0);
        const rawDraft = String(customDrafts[itemId] ?? '').trim();
        const parsed = Number(rawDraft.replace(',', '.'));
        const resolved = rawDraft === '' ? 0 : Number.isFinite(parsed) ? parsed : fallback;
        const bounded = Math.max(0, Math.min(fallback, resolved));
        return sum + bounded;
      }, 0);
      return Number(
        Math.max(0, Math.min(simplifiedRemainingAfterQueue, Number(customSelectedAmount.toFixed(2)))).toFixed(2)
      );
    }
    const selectedItems = (() => {
      if (conceptMode === 'AUTO') return pendingAccountItems;
      if (conceptMode === 'COURT') return pendingCourtAccountItems;
      if (conceptMode === 'CONSUMPTIONS') return pendingConsumptionAccountItems;
      return pendingAccountItems.filter((item) => selectedIds.has(String(item.id)));
    })();
    const debt = Number(
      selectedItems.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0).toFixed(2)
    );
    const conceptTarget = conceptMode === 'AUTO' ? simplifiedRemainingAfterQueue : debt;
    return Number(
      Math.max(0, Math.min(simplifiedRemainingAfterQueue, conceptTarget)).toFixed(2)
    );
  }, [
    pendingAccountItemById,
    pendingAccountItems,
    pendingConsumptionAccountItems,
    pendingCourtAccountItems,
    simplifiedPaymentCustomItemAmountDraftById,
    simplifiedPaymentSelectedItemIdsDraft,
    simplifiedRemainingAfterQueue,
  ]);
  const formatPaymentAmountDraft = useCallback((amount: number) => {
    return amount > 0.009 ? Number(amount.toFixed(2)).toFixed(2) : '';
  }, []);
  const computeCustomSelectedAmount = useCallback((
    selectedItemIds: string[],
    customAmountDraftById: Record<string, string>
  ) => {
    const total = selectedItemIds.reduce((sum, rawId) => {
      const itemId = String(rawId || '').trim();
      if (!itemId) return sum;
      const item = pendingAccountItemById.get(itemId);
      if (!item) return sum;
      const fallback = Number(item.remainingAmount || 0);
      const rawDraft = String(customAmountDraftById[itemId] ?? '').trim();
      const parsed = Number(rawDraft.replace(',', '.'));
      const resolved = rawDraft === '' ? 0 : Number.isFinite(parsed) ? parsed : fallback;
      const bounded = Math.max(0, Math.min(fallback, resolved));
      return sum + bounded;
    }, 0);
    return Number(total.toFixed(2));
  }, [pendingAccountItemById]);
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
  const isBillingModeSwitchLocked =
    Boolean(editingBookingId) && (isRemoteBillingConfigLoading || !isBillingConfigHydrated);
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
    let chargeMode: 'INDIVIDUAL' | 'SHARED' = paymentMode === 'Único' ? 'INDIVIDUAL' : 'SHARED';
    let chargeResponsibleParticipantId = ownerId;
    let assignments: NewBookingDrawerDraft['billing']['assignments'] =
      paymentMode === 'Único'
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
    const requiresBillingHydration =
      Boolean(editingBookingId) && bookingKind !== 'block';
    const waitingBillingHydration =
      requiresBillingHydration &&
      !isBillingConfigHydrated &&
      !billingConfigLoadError;
    if (waitingBillingHydration) return;
    const loadKey = `${editingBookingId || 'new'}-${bookingKind}-${remoteBillingConfig?.updatedAt || 'billing-none'}`;
    if (bookingDrawerLoadKeyRef.current === loadKey) return;
    bookingDrawerLoadKeyRef.current = loadKey;
    bookingDrawerFormSyncSignatureRef.current = '';
    bookingDrawerDispatch({ type: 'LOAD_SUCCESS', payload: bookingDrawerDraftSnapshot });
  }, [
    billingConfigLoadError,
    bookingDrawerDraftSnapshot,
    bookingKind,
    drawerOpen,
    editingBookingId,
    isBillingConfigHydrated,
    remoteBillingConfig?.updatedAt,
  ]);

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
    const isPersistedEdit = Boolean(editingBookingId);
    const uiChargeMode = paymentMode === 'Único' ? 'INDIVIDUAL' as const : 'SHARED' as const;
    const chargeModeForSync = isPersistedEdit
      ? (bookingDrawerState.draft.billing.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL')
      : uiChargeMode;
    const syncTotalAmount = isPersistedEdit
      ? Number(bookingDrawerState.draft.billing.financialSummary.totalAmount || 0)
      : Number(totalPrice || 0);
    const signature = JSON.stringify({
      key: `${editingBookingId || 'new'}-${bookingKind}`,
      chargeMode: isPersistedEdit ? 'persisted' : chargeModeForSync,
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
        chargeMode: chargeModeForSync,
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
    if (isCompletedReservation && hasScheduleChanges) return 'No podés reprogramar una reserva completada.';
    if (isSelectionInPastBlocking) return 'No se pueden reservar turnos en el pasado.';
    if (shouldShowScheduleConflict) return 'Hay un turno superpuesto en ese rango de fecha y horario.';
    if (hasDuplicateParticipants) return 'Hay participantes duplicados. Corregilo para poder guardar.';
    if (shouldBlockSaveByQuote && !isSelectionInPastBlocking) return quoteError || 'Revisá los datos del turno.';
    return '';
  }, [
    formError,
    hasDuplicateParticipants,
    hasScheduleChanges,
    isCompletedReservation,
    isSelectionInPastBlocking,
    quoteError,
    shouldBlockSaveByQuote,
    shouldShowScheduleConflict,
  ]);
  const hasBlockingActionError = blockingActionMessage.length > 0;
  const hasValidOwner = useMemo(
    () => participants.some((participant) => participant.isOwner && participant.name.trim().length > 0),
    [participants]
  );
  const dateFieldError = String(fieldErrors.date || '').trim();
  const timeFieldError = useMemo(() => {
    const fromField = String(fieldErrors.time || '').trim();
    if (fromField.length > 0) return fromField;
    if (isSelectionInPastBlocking) return 'No se pueden reservar turnos en el pasado.';
    if (shouldShowScheduleConflict) return 'Hay un turno superpuesto en ese rango de fecha y horario.';
    if (shouldBlockSaveByQuote && quoteError) return quoteError;
    return '';
  }, [fieldErrors.time, isSelectionInPastBlocking, quoteError, shouldBlockSaveByQuote, shouldShowScheduleConflict]);
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
    if (paymentMode === 'Único' && !simplifiedOwnerAdded) return 'Primero agregá el titular.';
    return '';
  }, [fieldErrors.owner, hasValidOwner, paymentMode, simplifiedOwnerAdded]);
  const participantsFieldError = useMemo(() => {
    const fromField = String(fieldErrors.participants || '').trim();
    if (fromField.length > 0) return fromField;
    if (hasDuplicateParticipants) return 'Hay participantes duplicados. Corregilo para poder guardar.';
    return '';
  }, [fieldErrors.participants, hasDuplicateParticipants]);
  const paymentFieldError = String(fieldErrors.payment || '').trim();
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
  const sourceBillingComparable = useMemo(
    () => buildComparableBillingFromDrawerDraft(bookingDrawerState.source as NewBookingDrawerDraft | null),
    [bookingDrawerState.source]
  );
  const draftBillingComparable = useMemo(
    () => buildComparableBillingFromDrawerDraft(bookingDrawerState.draft as NewBookingDrawerDraft | null),
    [bookingDrawerState.draft]
  );
  const hasBillingConfigChanges = useMemo(() => {
    if (!editingBookingId || bookingKind === 'block') return false;
    if (!sourceBillingComparable || !draftBillingComparable) return false;
    return JSON.stringify(sourceBillingComparable) !== JSON.stringify(draftBillingComparable);
  }, [bookingKind, draftBillingComparable, editingBookingId, sourceBillingComparable]);
  const hasUserBillingConfigChanges = hasBillingConfigChanges && billingConfigTouchedByUser;
  const hasEditChanges = useMemo(() => {
    if (!editingBookingId) return true;
    if (bookingKind === 'block') return hasScheduleChanges;
    return (
      hasScheduleChanges ||
      hasSidebarParticipantsChanges ||
      hasUserBillingConfigChanges
    );
  }, [
    bookingKind,
    editingBookingId,
    hasScheduleChanges,
    hasSidebarParticipantsChanges,
    hasUserBillingConfigChanges,
  ]);
  const primaryActionDisabled =
    isSubmittingBooking ||
    isDeletingBooking ||
    !hasValidOwner ||
    hasDuplicateParticipants ||
    (isCompletedReservation && hasScheduleChanges) ||
    isSelectionInPastBlocking ||
    shouldBlockSaveByQuote ||
    shouldShowScheduleConflict ||
    (paymentMode === 'Único' && !simplifiedOwnerAdded) ||
    simplifiedNewParticipantOpen ||
    (Boolean(editingBookingId) && isRemoteBillingConfigLoading) ||
    (Boolean(editingBookingId) && !hasEditChanges) ||
    Boolean(formError);
  const lockBookingDetails =
    bookingKind !== 'block' &&
    (
      Boolean(formError) ||
      isSelectionInPastBlocking ||
      shouldShowScheduleConflict ||
      hasDuplicateParticipants ||
      (shouldBlockSaveByQuote && !isSelectionInPastBlocking)
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
      label: 'Horario válido',
      ok: !isSelectionInPastBlocking && !shouldShowScheduleConflict && !shouldBlockSaveByQuote,
      detail: isSelectionInPastBlocking
        ? 'No se puede reservar en el pasado.'
        : shouldShowScheduleConflict
          ? 'Se superpone con otra reserva.'
          : shouldBlockSaveByQuote
            ? quoteError || 'Horario no permitido por configuración.'
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
            ? 'Revisá la configuración de cobro.'
            : undefined,
      });
    }

    if (isRecurringKind) {
      rows.push({
        key: 'recurring-courts',
        label: 'Canchas seleccionadas para la serie',
        ok: recurringCourtIds.length > 0,
        detail: recurringCourtIds.length > 0 ? undefined : 'Seleccioná al menos una cancha.',
      });
    }

    return rows;
  }, [
    blockingBillingWarnings.size,
    bookingKind,
    hasDuplicateParticipants,
    hasValidOwner,
    isRecurringKind,
    isSelectionInPastBlocking,
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
    if (isRecurringKind) {
      const selectedNames = effectiveCourts
        .filter((court) => recurringCourtIds.includes(court.id))
        .map((court) => court.name);
      if (selectedNames.length === 0) return 'Sin canchas seleccionadas';
      return selectedNames.join(', ');
    }
    return selectedCourt?.name || 'Cancha no definida';
  }, [effectiveCourts, isRecurringKind, recurringCourtIds, selectedCourt?.name]);

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
      if (isRecurringKind) return 'Creando serie...';
      if (bookingKind === 'block') return 'Creando bloqueo...';
      return 'Creando reserva...';
    }
    if (editingBookingId) return 'Guardar cambios';
    if (isRecurringKind) return 'Crear serie';
    if (bookingKind === 'block') return 'Crear bloqueo';
    return 'Crear reserva';
  }, [bookingKind, editingBookingId, isRecurringKind, isSubmittingBooking]);

  const primaryActionMeta = useMemo(() => {
    if (isRecurringKind) {
      if (recurringCourtIds.length <= 0) return 'sin canchas';
      return `${recurringCourtIds.length} cancha${recurringCourtIds.length === 1 ? '' : 's'}`;
    }
    return `${selectionMinutes} min`;
  }, [isRecurringKind, recurringCourtIds.length, selectionMinutes]);

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
    if (nowLineTop == null) return;
    const container = agendaScrollContainerRef.current;
    if (!container) return;

    const today = new Date();
    const sameDay =
      selectedDate.getFullYear() === today.getFullYear() &&
      selectedDate.getMonth() === today.getMonth() &&
      selectedDate.getDate() === today.getDate();
    if (!sameDay) return;

    const dateKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    if (lastAutoScrollDateKeyRef.current === dateKey) return;
    lastAutoScrollDateKeyRef.current = dateKey;

    const headerHeight = 40;
    const rawTarget = nowLineTop + headerHeight - container.clientHeight * 0.35;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextTop = Math.max(0, Math.min(maxTop, rawTarget));
    container.scrollTo({ top: nextTop, behavior: 'smooth' });
  }, [nowLineTop, selectedDate]);

  useEffect(() => {
    if (persistedEditingBookingId && bookingKind !== 'block' && !hasScheduleChanges) {
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
    hasScheduleChanges,
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
      showCalendarNotice('El saldo ya está cubierto por pagos registrados.');
      return;
    }
    void registerPaymentNow({
      amount: amountToRegister,
      method: 'CASH',
      successMessage: `Pago registrado: ${amountToRegister.toFixed(2)} $.`,
    });
  }, [bookingDrawerState.draft, registerPaymentNow, showCalendarNotice]);

  const handleBillingModeChange = useCallback((mode: 'INDIVIDUAL' | 'SHARED') => {
    if (editingBookingId && (isRemoteBillingConfigLoading || !isBillingConfigHydrated)) {
      return;
    }
    if (isBillingConfigLockedByPayments) {
      showCalendarNotice('No podés cambiar la asignación de cobro porque ya hay pagos registrados.');
      return;
    }
    const nextPaymentMode: PaymentMode = mode === 'SHARED' ? 'Dividido' : 'Único';
    setBillingConfigTouchedByUser(true);
    setPaymentMode(nextPaymentMode);
    bookingDrawerDispatch({ type: 'SET_CHARGE_MODE', payload: { mode } });
  }, [editingBookingId, isBillingConfigHydrated, isBillingConfigLockedByPayments, isRemoteBillingConfigLoading, showCalendarNotice]);

  const handleBillingResponsibleChange = useCallback((participantId: string) => {
    if (isBillingConfigLockedByPayments) {
      showCalendarNotice('No podés cambiar la asignación de cobro porque ya hay pagos registrados.');
      return;
    }
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'SET_CHARGE_RESPONSIBLE', payload: { participantId } });
  }, [isBillingConfigLockedByPayments, showCalendarNotice]);

  const handleBillingAssignmentAmountChange = useCallback((assignmentId: string, amount: number) => {
    if (isBillingConfigLockedByPayments) {
      showCalendarNotice('No podés cambiar la asignación de cobro porque ya hay pagos registrados.');
      return;
    }
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'SET_ASSIGNMENT_AMOUNT', payload: { assignmentId, amount } });
  }, [isBillingConfigLockedByPayments, showCalendarNotice]);

  const handleBillingToggleChargeable = useCallback((assignmentId: string, isChargeable: boolean) => {
    if (isBillingConfigLockedByPayments) {
      showCalendarNotice('No podés cambiar la asignación de cobro porque ya hay pagos registrados.');
      return;
    }
    setBillingConfigTouchedByUser(true);
    bookingDrawerDispatch({ type: 'TOGGLE_ASSIGNMENT_CHARGEABLE', payload: { assignmentId, isChargeable } });
  }, [isBillingConfigLockedByPayments, showCalendarNotice]);

  const closeSimplifiedPaymentModal = useCallback(() => {
    setActivePaymentModal(null);
    setSimplifiedPaymentModalVariant('PLAYTOMIC');
    setSimplifiedPaymentPayerParticipantIdDraft('');
    setSimplifiedPaymentCoveredParticipantIdDraft('');
    setSimplifiedPaymentCoveredParticipantIdsDraft([]);
    setSimplifiedPaymentAmountDraft('');
    setSimplifiedPaymentMethodDraft('');
    setSimplifiedPaymentQuickPreset('MY_SHARE');
    setSimplifiedPaymentImputationMode('BY_PARTICIPANT');
    setSimplifiedPaymentConceptMode('AUTO');
    setSimplifiedPaymentSelectedItemIdsDraft([]);
    setSimplifiedPaymentCustomItemAmountDraftById({});
    setSimplifiedSinglePaymentAdvancedOpen(false);
    setPlaytomicResultModal(null);
  }, []);

  useEffect(() => {
    if (activePaymentModal?.flow !== 'playtomicPayment') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSimplifiedPaymentModal();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePaymentModal, closeSimplifiedPaymentModal]);

  const modalBackdropPointerDownTargetRef = useRef<EventTarget | null>(null);
  const handleModalBackdropPointerDown = useCallback((event: any) => {
    modalBackdropPointerDownTargetRef.current = event.target;
  }, []);
  const handleModalBackdropPointerUp = useCallback((event: any, onClose: () => void) => {
    const startedOnBackdrop = modalBackdropPointerDownTargetRef.current === event.currentTarget;
    const endedOnBackdrop = event.target === event.currentTarget;
    modalBackdropPointerDownTargetRef.current = null;
    if (startedOnBackdrop && endedOnBackdrop) {
      onClose();
    }
  }, []);

  const openSimplifiedPaymentModal = useCallback(async () => {
    if (!persistedEditingBookingId) {
      showCalendarNotice('Primero creá la reserva. Después podés registrar cobros.');
      return;
    }
    if (isRemoteBillingConfigLoading) {
      return;
    }
    if (isPaymentLockedByManualPending) {
      showCalendarNotice('Primero confirmá la reserva para poder registrar pagos.');
      return;
    }

    const draft = bookingDrawerState.draft;
    if (!draft) {
      showCalendarNotice('No se pudo preparar el cobro. Reabrí la reserva e intentá de nuevo.');
      return;
    }

    if (participants.length === 0) {
      showCalendarNotice('Primero agregá al menos un participante.');
      return;
    }

    const requestSeq = remoteBillingConfigRequestSeqRef.current + 1;
    remoteBillingConfigRequestSeqRef.current = requestSeq;
    let latestConfig: BookingBillingConfig | null = null;
    let latestPaymentRemaining: number | null = null;
    try {
      setIsRemoteBillingConfigLoading(true);
      setBillingConfigLoadError('');
      const [config, latestFinancialSummary] = await Promise.all([
        getBookingBillingConfig(persistedEditingBookingId),
        refreshBookingFinancial(persistedEditingBookingId),
        loadBookingConsumptions(persistedEditingBookingId),
      ]);
      if (remoteBillingConfigRequestSeqRef.current !== requestSeq) return;
      latestConfig = config;
      setRemoteBillingConfig(config);
      setIsBillingConfigHydrated(true);
      const latestRemaining = Number(latestFinancialSummary?.remaining ?? simplifiedRemainingAfterQueue);
      if (Number.isFinite(latestRemaining)) {
        latestPaymentRemaining = Number(latestRemaining.toFixed(2));
      }
    } catch (error: any) {
      if (remoteBillingConfigRequestSeqRef.current !== requestSeq) return;
      const message = toUserSafeMessage(error?.message, 'No se pudo cargar la configuración de cobro.');
      setIsBillingConfigHydrated(false);
      setBillingConfigLoadError(message);
      showCalendarNotice(message);
      return;
    } finally {
      if (remoteBillingConfigRequestSeqRef.current === requestSeq) {
        setIsRemoteBillingConfigLoading(false);
      }
    }

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;

    const preferredPayerId = (() => {
      if (paymentMode === 'Dividido' && latestPaymentPayerRef) {
        const latestPayer = participants.find(
          (participant) =>
            buildStableParticipantRef(participant, { bookingClientId, bookingUserId }) === latestPaymentPayerRef
        );
        if (latestPayer) return String(latestPayer.id);
      }
      const persistedResponsibleRef = String(latestConfig?.chargeResponsibleRef || '').trim();
      if (persistedResponsibleRef) {
        const persistedResponsible = participants.find(
          (participant) =>
            buildStableParticipantRef(participant, { bookingClientId, bookingUserId }) === persistedResponsibleRef
        );
        if (persistedResponsible) return String(persistedResponsible.id);
      }

      const draftResponsible = String(draft.billing.chargeResponsibleParticipantId || '').trim();
      if (draftResponsible && participants.some((participant) => participant.id === draftResponsible)) {
        return draftResponsible;
      }
      const ownerParticipant = participants.find((participant) => participant.isOwner);
      return ownerParticipant?.id || participants[0]?.id || '';
    })();
    const payer = participants.find((participant) => participant.id === preferredPayerId);
    const preferredCoveredId = (() => {
      if (paymentMode === 'Único') {
        return String(singleChargeParticipantId || preferredPayerId || '');
      }
      return String(preferredPayerId || '').trim();
    })();
    const preferredAmount = Number((latestPaymentRemaining ?? simplifiedRemainingAfterQueue).toFixed(2));

    setSimplifiedPaymentPayerParticipantIdDraft(preferredPayerId);
    setSimplifiedPaymentCoveredParticipantIdDraft(preferredCoveredId);
    setSimplifiedPaymentCoveredParticipantIdsDraft(
      paymentMode === 'Dividido' && preferredCoveredId ? [preferredCoveredId] : []
    );
    setSimplifiedPaymentMethodDraft(payer?.paymentMethod || 'CASH');
    setSimplifiedPaymentAmountDraft(
      preferredAmount > 0.009 ? preferredAmount.toFixed(2) : ''
    );
    setSimplifiedPaymentQuickPreset('FULL');
    setSimplifiedPaymentImputationMode('BY_CONCEPT');
    setSimplifiedPaymentConceptMode('AUTO');
    setSimplifiedPaymentSelectedItemIdsDraft([]);
    setSimplifiedPaymentCustomItemAmountDraftById({});
    setSimplifiedSinglePaymentAdvancedOpen(false);
    setSimplifiedPaymentModalVariant('PLAYTOMIC');
    setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' });
    setFormError('');
  }, [
    bookingDrawerState.draft,
    editingBooking?.clientId,
    editingBooking?.userId,
    isPaymentLockedByManualPending,
    isRemoteBillingConfigLoading,
    loadBookingConsumptions,
    participants,
    persistedEditingBookingId,
    refreshBookingFinancial,
    showCalendarNotice,
    simplifiedRemainingAfterQueue,
    singleChargeParticipantId,
    latestPaymentPayerRef,
    paymentMode,
  ]);

  const queueSimplifiedPaymentFromModal = useCallback((options?: { skipPlaytomicPreconfirm?: boolean }) => {
    if (isPaymentLockedByManualPending) {
      showCalendarNotice('Primero confirmá la reserva para poder registrar pagos.');
      return;
    }

    const payerId = (() => {
      const selectedPayerId = String(simplifiedPaymentPayerParticipantIdDraft || '').trim();
      if (selectedPayerId) return selectedPayerId;
      const responsiblePayerId = String(singleChargeParticipantId || '').trim();
      if (responsiblePayerId) return responsiblePayerId;
      const ownerPayerId = participants.find((participant) => participant.isOwner)?.id || '';
      return String(ownerPayerId).trim();
    })();
    if (!payerId) {
      showCalendarNotice('Seleccioná quién paga esta reserva.');
      return;
    }
    const isPlaytomicFlow = simplifiedPaymentModalVariant === 'PLAYTOMIC';
    const isByConcept = isPlaytomicFlow || simplifiedPaymentImputationMode === 'BY_CONCEPT';
    const coveredIds = (() => {
      if (isPlaytomicFlow) {
        return [payerId];
      }
      if (isByConcept) {
        if (paymentMode === 'Único') {
          return [String(singleChargeParticipantId || payerId).trim() || payerId].filter(Boolean);
        }
        const preferredCoveredId =
          String(simplifiedPaymentCoveredParticipantIdDraft || '').trim() ||
          payerId;
        return [preferredCoveredId].filter(Boolean);
      }
      if (paymentMode === 'Único') {
        return [String(singleChargeParticipantId || payerId).trim() || payerId].filter(Boolean);
      }
      const selectedMany = Array.from(
        new Set(
          (Array.isArray(simplifiedPaymentCoveredParticipantIdsDraft)
            ? simplifiedPaymentCoveredParticipantIdsDraft
            : []
          )
            .map((value) => String(value || '').trim())
            .filter(
              (value) =>
                value.length > 0 &&
                participants.some((participant) => participant.id === value) &&
                Number(participantDebtAmountById.get(value) || 0) > 0.009
            )
        )
      );
      if (selectedMany.length > 0) {
        return selectedMany;
      }
      const selectedCoveredId = String(simplifiedPaymentCoveredParticipantIdDraft || '').trim();
      if (
        selectedCoveredId &&
        participants.some((participant) => participant.id === selectedCoveredId) &&
        Number(participantDebtAmountById.get(selectedCoveredId) || 0) > 0.009
      ) {
        return [selectedCoveredId];
      }
      if (Number(participantDebtAmountById.get(payerId) || 0) > 0.009) {
        return [payerId].filter(Boolean);
      }
      const firstWithDebt = participants.find(
        (participant) => Number(participantDebtAmountById.get(participant.id) || 0) > 0.009
      );
      return firstWithDebt?.id ? [firstWithDebt.id] : [];
    })();
    if (!isPlaytomicFlow && !isByConcept && coveredIds.length === 0) {
      showCalendarNotice('Seleccioná por quién se imputa el pago.');
      return;
    }
    if (!isPlaytomicFlow && paymentMode === 'Único') {
      const confirmedFromDraft = Boolean(
        bookingDrawerState.draft?.billing.payments.some(
          (payment) => payment.status === 'CONFIRMED' && Number(payment.amount || 0) > 0.009
        )
      );
      const confirmedFromFinancial = Number(bookingFinancial?.paid || 0) > 0.009;
      const hasConfirmedPayments = confirmedFromDraft || confirmedFromFinancial;
      const allowedPayerId = String(singleChargeParticipantId || '').trim() ||
        participants.find((participant) => participant.isOwner)?.id ||
        '';
      if (hasConfirmedPayments && allowedPayerId && payerId !== allowedPayerId) {
        showCalendarNotice('En pago único, solo puede pagar el responsable de cobro.');
        return;
      }
      if (!hasConfirmedPayments && payerId !== allowedPayerId) {
        setBillingConfigTouchedByUser(true);
        bookingDrawerDispatch({ type: 'SET_CHARGE_RESPONSIBLE', payload: { participantId: payerId } });
      }
    }
    if (!isParticipantPaymentMethod(simplifiedPaymentMethodDraft)) {
      showCalendarNotice('Seleccioná un método de pago.');
      return;
    }
    const selectedMethod = simplifiedPaymentMethodDraft as Participant['paymentMethod'];
    const selectedMethodLabel =
      selectedMethod === 'CASH'
        ? 'Efectivo'
        : selectedMethod === 'TRANSFER'
          ? 'Transferencia'
          : selectedMethod === 'CARD'
            ? 'Tarjeta'
            : 'Otro';

    const amount = Number(String(simplifiedPaymentAmountDraft || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0.009) {
      showCalendarNotice('Ingresá un monto mayor a 0.');
      return;
    }
    const roundedAmount = Number(amount.toFixed(2));
    let effectiveAmount = roundedAmount;
    let appliedClampReason = '';
    if (!isPlaytomicFlow && paymentMode === 'Dividido' && !isByConcept) {
      const coveredDebtTotal = Number(
        coveredIds.reduce((sum, participantId) => sum + Number(participantDebtAmountById.get(participantId) || 0), 0).toFixed(2)
      );
      if (coveredDebtTotal <= 0.009) {
        showCalendarNotice('Los participantes seleccionados no tienen deuda pendiente.');
        return;
      }
      if (effectiveAmount > coveredDebtTotal + 0.009) {
        if (!isPlaytomicFlow) {
          showCalendarNotice(`El monto supera la deuda de los participantes seleccionados (${coveredDebtTotal.toFixed(2)} $).`);
          return;
        }
        effectiveAmount = coveredDebtTotal;
        appliedClampReason = 'participantes';
      }
    }
    if (effectiveAmount > simplifiedRemainingAfterQueue + 0.009) {
      if (!isPlaytomicFlow) {
        showCalendarNotice(`El monto supera la deuda pendiente (${simplifiedRemainingAfterQueue.toFixed(2)} $).`);
        return;
      }
      effectiveAmount = simplifiedRemainingAfterQueue;
      appliedClampReason = 'reserva';
    }
    if (isPlaytomicFlow && !options?.skipPlaytomicPreconfirm) {
      setActivePaymentModal({ flow: 'playtomicPayment', step: 'preconfirm' });
      return;
    }

    const paymentAllocations = (() => {
      if (isPlaytomicFlow) {
        return [{ coveredParticipantId: payerId, amount: effectiveAmount }];
      }
      const firstCovered = String(coveredIds[0] || '').trim() || payerId;
      if (!firstCovered) return [];
      if (isByConcept || paymentMode === 'Único') {
        return [{ coveredParticipantId: firstCovered, amount: effectiveAmount }];
      }
      return allocatePaymentProportionallyByDebt({
        amount: effectiveAmount,
        participantDebts: coveredIds.map((coveredParticipantId) => ({
          participantId: coveredParticipantId,
          debt: Number(participantDebtAmountById.get(coveredParticipantId) || 0),
        })),
      });
    })();
    if (paymentAllocations.length === 0) {
      showCalendarNotice('No se pudo distribuir el pago entre los participantes seleccionados.');
      return;
    }
    const selectedConceptItems = (() => {
      if (!isByConcept) {
        return pendingAccountItems;
      }
      if (simplifiedPaymentConceptMode === 'AUTO') {
        return pendingAccountItems;
      }
      if (simplifiedPaymentConceptMode === 'COURT') {
        return pendingCourtAccountItems;
      }
      if (simplifiedPaymentConceptMode === 'CONSUMPTIONS') {
        return pendingConsumptionAccountItems;
      }
      const selectedSet = new Set(
        (Array.isArray(simplifiedPaymentSelectedItemIdsDraft)
          ? simplifiedPaymentSelectedItemIdsDraft
          : []
        )
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      );
      return pendingAccountItems.filter((item) => selectedSet.has(String(item.id)));
    })();
    if (isByConcept && simplifiedPaymentConceptMode !== 'AUTO' && selectedConceptItems.length === 0) {
      showCalendarNotice('Seleccioná al menos un concepto para imputar este pago.');
      return;
    }
    const selectedConceptDebt = Number(
      (
        simplifiedPaymentConceptMode === 'CUSTOM'
          ? computeCustomSelectedAmount(
              selectedConceptItems.map((item) => String(item.id)),
              simplifiedPaymentCustomItemAmountDraftById
            )
          : selectedConceptItems.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0)
      ).toFixed(2)
    );
    if (isByConcept && simplifiedPaymentConceptMode !== 'AUTO' && effectiveAmount > selectedConceptDebt + 0.009) {
      if (!isPlaytomicFlow) {
        showCalendarNotice(
          `El monto supera la deuda de los conceptos seleccionados (${selectedConceptDebt.toFixed(2)} $).`
        );
        return;
      }
      effectiveAmount = selectedConceptDebt;
      appliedClampReason = 'conceptos';
      if (effectiveAmount <= 0.009) {
        showCalendarNotice('Los conceptos seleccionados no tienen deuda pendiente.');
        return;
      }
    }
    if (effectiveAmount <= 0.009) {
      showCalendarNotice('No hay deuda pendiente para el alcance seleccionado.');
      return;
    }
    const remainingByItemId = new Map<string, number>();
    const sortedConceptItems = [...selectedConceptItems].sort((a, b) => {
      const aIsCourt = String(a.type || '').toUpperCase() === 'BOOKING';
      const bIsCourt = String(b.type || '').toUpperCase() === 'BOOKING';
      if (aIsCourt !== bIsCourt) return aIsCourt ? -1 : 1;
      const aNumeric = Number(a.id);
      const bNumeric = Number(b.id);
      if (Number.isFinite(aNumeric) && Number.isFinite(bNumeric)) return aNumeric - bNumeric;
      return String(a.id).localeCompare(String(b.id));
    });
    sortedConceptItems.forEach((item) => {
      remainingByItemId.set(String(item.id), Number(item.remainingAmount || 0));
    });
    const buildItemAllocationsForAmount = (amount: number) => {
      let remainingToAllocate = Number(amount.toFixed(2));
      const allocations: Array<{ accountItemId: string; amount: number }> = [];
      const desiredByItemId = new Map<string, number>();
      sortedConceptItems.forEach((item) => {
        const itemId = String(item.id);
        const maxRemaining = Number(item.remainingAmount || 0);
        if (simplifiedPaymentConceptMode === 'CUSTOM') {
          const rawDraft = String(simplifiedPaymentCustomItemAmountDraftById[itemId] ?? '').trim();
          const parsed = Number(rawDraft.replace(',', '.'));
          const fallback = maxRemaining;
          const resolved = rawDraft === '' ? 0 : Number.isFinite(parsed) ? parsed : fallback;
          desiredByItemId.set(itemId, Number(Math.max(0, Math.min(maxRemaining, resolved)).toFixed(2)));
          return;
        }
        desiredByItemId.set(itemId, maxRemaining);
      });
      sortedConceptItems.forEach((item) => {
        if (remainingToAllocate <= 0.009) return;
        const itemId = String(item.id);
        const available = Number(remainingByItemId.get(itemId) || 0);
        if (available <= 0.009) return;
        const desired = Number(desiredByItemId.get(itemId) || 0);
        if (desired <= 0.009) return;
        const portion = Number(Math.min(available, desired, remainingToAllocate).toFixed(2));
        if (portion <= 0.009) return;
        allocations.push({ accountItemId: itemId, amount: portion });
        remainingByItemId.set(itemId, Number((available - portion).toFixed(2)));
        remainingToAllocate = Number((remainingToAllocate - portion).toFixed(2));
      });
      if (remainingToAllocate > 0.009) {
        return null;
      }
      return allocations;
    };

    updateParticipant(payerId, { paymentMethod: selectedMethod });
    if (isPlaytomicFlow && appliedClampReason) {
      const reasonLabel =
        appliedClampReason === 'conceptos'
            ? 'la deuda de los conceptos seleccionados'
            : 'la deuda pendiente';
      showCalendarNotice(`El monto se ajustó automáticamente al máximo permitido por ${reasonLabel}.`, 'warning');
    }
    const openPlaytomicResult = (result: PlaytomicPaymentResultModal) => {
      setActivePaymentModal({ flow: 'playtomicPayment', step: 'result' });
      setPlaytomicResultModal(result);
    };
    void (async () => {
      let registeredAmount = 0;
      const appliedByItemId = new Map<string, number>();
      const conceptLabelById = new Map<string, string>(
        sortedConceptItems.map((item) => [
          String(item.id),
          item.type === 'BOOKING' ? 'Cancha' : item.description,
        ])
      );
      for (let index = 0; index < paymentAllocations.length; index += 1) {
        const allocation = paymentAllocations[index];
        const itemAllocations = buildItemAllocationsForAmount(allocation.amount);
        if (!itemAllocations || itemAllocations.length === 0) {
          if (isPlaytomicFlow) {
            const appliedItems = Array.from(appliedByItemId.entries()).map(([itemId, itemAmount]) => ({
              label: conceptLabelById.get(itemId) || 'Concepto',
              amount: itemAmount,
            }));
            openPlaytomicResult({
              variant: registeredAmount > 0.009 ? 'partial' : 'error',
              title: registeredAmount > 0.009 ? 'Cobro parcial registrado' : 'No se pudo registrar el cobro',
              detail:
                registeredAmount > 0.009
                  ? 'Parte del monto se registró, pero no se pudo imputar todo a conceptos pendientes.'
                  : 'No se pudo imputar el cobro a los conceptos seleccionados.',
              requestedAmount: roundedAmount,
              appliedAmount: registeredAmount,
              remainingAfter: Number(Math.max(0, simplifiedRemainingAfterQueue - registeredAmount).toFixed(2)),
              methodLabel: selectedMethodLabel,
              appliedItems,
            });
          } else if (registeredAmount > 0.009) {
            showCalendarNotice(
              `Pago parcial registrado: ${registeredAmount.toFixed(2)} $. Faltó imputar parte del pago a conceptos.`
            );
          } else {
            showCalendarNotice('No se pudo imputar el pago a los conceptos seleccionados.');
          }
          return;
        }
        const ok = await registerPaymentNow({
          amount: allocation.amount,
          method: selectedMethod,
          participantId: payerId,
          coveredParticipantId: allocation.coveredParticipantId,
          itemAllocations,
          silentSuccessNotice: paymentAllocations.length > 1,
        });
        if (!ok) {
          if (isPlaytomicFlow) {
            const appliedItems = Array.from(appliedByItemId.entries()).map(([itemId, itemAmount]) => ({
              label: conceptLabelById.get(itemId) || 'Concepto',
              amount: itemAmount,
            }));
            openPlaytomicResult({
              variant: registeredAmount > 0.009 ? 'partial' : 'error',
              title: registeredAmount > 0.009 ? 'Cobro parcial registrado' : 'No se pudo registrar el cobro',
              detail:
                registeredAmount > 0.009
                  ? 'Se registró una parte del cobro, pero falló la confirmación completa.'
                  : 'No se pudo confirmar el cobro. Revisá e intentá nuevamente.',
              requestedAmount: roundedAmount,
              appliedAmount: registeredAmount,
              remainingAfter: Number(Math.max(0, simplifiedRemainingAfterQueue - registeredAmount).toFixed(2)),
              methodLabel: selectedMethodLabel,
              appliedItems,
            });
          } else if (registeredAmount > 0.009) {
            showCalendarNotice(
              `Pago parcial registrado: ${registeredAmount.toFixed(2)} $. Revisá el resto e intentá nuevamente.`
            );
          }
          return;
        }
        itemAllocations.forEach((itemAllocation) => {
          const itemId = String(itemAllocation.accountItemId);
          const accumulated = Number(appliedByItemId.get(itemId) || 0);
          appliedByItemId.set(itemId, Number((accumulated + Number(itemAllocation.amount || 0)).toFixed(2)));
        });
        registeredAmount = Number((registeredAmount + allocation.amount).toFixed(2));
      }
      if (isPlaytomicFlow) {
        const appliedItems = Array.from(appliedByItemId.entries()).map(([itemId, itemAmount]) => ({
          label: conceptLabelById.get(itemId) || 'Concepto',
          amount: itemAmount,
        }));
        openPlaytomicResult({
          variant: 'success',
          title: 'Cobro registrado',
          detail: 'El cobro se registró correctamente.',
          requestedAmount: roundedAmount,
          appliedAmount: registeredAmount,
          remainingAfter: Number(Math.max(0, simplifiedRemainingAfterQueue - registeredAmount).toFixed(2)),
          methodLabel: selectedMethodLabel,
          appliedItems,
        });
        setFormError('');
        return;
      }
      closeSimplifiedPaymentModal();
      setFormError('');
      showCalendarNotice(
        !isPlaytomicFlow && paymentAllocations.length > 1
          ? `Pago registrado: ${registeredAmount.toFixed(2)} $ imputado a ${paymentAllocations.length} participantes.`
          : `Pago registrado: ${registeredAmount.toFixed(2)} $.`,
        'success'
      );
    })();
  }, [
    closeSimplifiedPaymentModal,
    bookingDrawerState.draft,
    bookingFinancial?.paid,
    isPaymentLockedByManualPending,
    registerPaymentNow,
    showCalendarNotice,
    simplifiedPaymentAmountDraft,
    simplifiedPaymentMethodDraft,
    simplifiedPaymentImputationMode,
    simplifiedPaymentPayerParticipantIdDraft,
    simplifiedPaymentCoveredParticipantIdDraft,
    simplifiedPaymentCoveredParticipantIdsDraft,
    simplifiedPaymentConceptMode,
    simplifiedPaymentCustomItemAmountDraftById,
    simplifiedPaymentSelectedItemIdsDraft,
    simplifiedPaymentModalVariant,
    simplifiedRemainingAfterQueue,
    singleChargeParticipantId,
    paymentMode,
    pendingAccountItems,
    pendingCourtAccountItems,
    pendingConsumptionAccountItems,
    computeCustomSelectedAmount,
    participantDebtAmountById,
    participants,
    updateParticipant,
  ]);

  const persistBillingConfig = useCallback(async (
    bookingId: number,
    options?: {
      bookingClientId?: string;
      bookingUserId?: number | null;
      bookingClientName?: string;
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
      const bookingClientName = String(options?.bookingClientName || '').trim();
      const participantsForPersist = participants.map((participant, index) => {
        if (!participant.isOwner || !bookingClientId) return participant;
        const normalizedRef = String(participant.entityRef || '').trim().toLowerCase();
        const shouldCanonicalizeOwnerRef =
          normalizedRef.length === 0 ||
          normalizedRef.startsWith('guest:') ||
          normalizedRef.startsWith('booking-user:');
        if (!shouldCanonicalizeOwnerRef) return participant;
        return {
          ...participant,
          name: bookingClientName || participant.name || `Titular ${index + 1}`,
          sourceType: 'clubClient' as const,
          entityRef: `booking-client:${bookingClientId}`,
        };
      });
      const participantRefById = new Map<string, string>();
      participantsForPersist.forEach((participant) => {
        participantRefById.set(
          String(participant.id),
          buildStableParticipantRef(participant, { bookingClientId, bookingUserId })
        );
      });

      const nextChargeMode: 'INDIVIDUAL' | 'SHARED' =
        draft.billing.chargeMode === 'SHARED' ? 'SHARED' : 'INDIVIDUAL';
      const nextMode: PaymentMode = nextChargeMode === 'SHARED' ? 'Dividido' : 'Único';
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
          const existing = participantsForPersist.find((entry) => String(entry.id) === String(participant.id));
          const assignedAmount = Number(assignment?.assignedAmount || 0);
          const confirmed = Number(confirmedByAssignment.get(String(assignment?.id || '')) || 0);
          const paid = assignment?.isChargeable ? confirmed + 0.009 >= assignedAmount && assignedAmount > 0 : false;
          const participantRef = participantRefById.get(String(participant.id)) || `guest:${participant.id}`;
          return {
            id: participant.id,
            name: existing?.name || participant.displayName,
            contact: existing?.contact || participant.contact || '',
            paid,
            isOwner:
              participant.id === draft.operational.bookingResponsibleParticipantId ||
              (!draft.operational.bookingResponsibleParticipantId && index === 0),
            sourceType: existing?.sourceType || participant.sourceType,
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

      let totalChargeableAmount = Number(
        Number(draft.billing.financialSummary.totalAmount || totalPrice || 0).toFixed(2)
      );
      try {
        const latestFinancial = await getBookingFinancialSummary(bookingId);
        const latestTotal = Number(latestFinancial?.total || 0);
        if (Number.isFinite(latestTotal) && latestTotal >= 0) {
          totalChargeableAmount = Number(latestTotal.toFixed(2));
        }
      } catch {
      }
      const assignmentRows = draft.billing.assignments.map((assignment) => ({
        id: String(assignment.id || `asg-${String(assignment.participantId)}`),
        participantId: String(assignment.participantId || ''),
        participantRef:
          participantRefById.get(String(assignment.participantId)) ||
          `guest:${String(assignment.participantId)}`,
        isChargeable: Boolean(assignment.isChargeable),
        assignedAmount: Number(Number(assignment.assignedAmount || 0).toFixed(2)),
        participantLinkState: (
          assignment.participantLinkState === 'ARCHIVED_REFERENCE'
            ? 'ARCHIVED_REFERENCE'
            : 'ACTIVE'
        ) as 'ACTIVE' | 'ARCHIVED_REFERENCE',
      }));
      let payloadAssignments: Array<{
        id: string;
        participantRef: string;
        isChargeable: boolean;
        assignedAmount: number;
        participantLinkState: 'ACTIVE' | 'ARCHIVED_REFERENCE';
      }> = [];
      let chargeResponsibleRef: string | undefined;

      if (nextChargeMode === 'INDIVIDUAL') {
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

        payloadAssignments = assignmentRows.map((assignment) => {
          const isChargeable = Boolean(chargeableAssignmentId) && assignment.id === chargeableAssignmentId;
          return {
            id: assignment.id,
            participantRef: assignment.participantRef,
            isChargeable,
            assignedAmount: isChargeable ? totalChargeableAmount : 0,
            participantLinkState: assignment.participantLinkState,
          };
        });

        chargeResponsibleRef =
          (resolvedResponsibleParticipantId
            ? participantRefById.get(String(resolvedResponsibleParticipantId))
            : undefined) ||
          payloadAssignments.find((assignment) => assignment.isChargeable)?.participantRef ||
          payloadAssignments[0]?.participantRef;

        if (!chargeResponsibleRef && resolvedResponsibleParticipantId) {
          chargeResponsibleRef = `guest:${String(resolvedResponsibleParticipantId)}`;
        }
      } else {
        const activeAmountByParticipantId = new Map<string, number>();
        nextParticipants.forEach((participant) => {
          activeAmountByParticipantId.set(
            String(participant.id),
            roundMoney(resolveParticipantPrice(participant))
          );
        });

        payloadAssignments = assignmentRows.map((assignment) => {
          const activeAmount = Number(activeAmountByParticipantId.get(assignment.participantId) || 0);
          const isActiveAssignment = assignment.participantLinkState !== 'ARCHIVED_REFERENCE';
          const isChargeable = isActiveAssignment && activeAmount > 0.009;
          return {
            id: assignment.id,
            participantRef: assignment.participantRef,
            isChargeable,
            assignedAmount: isChargeable ? activeAmount : 0,
            participantLinkState: assignment.participantLinkState,
          };
        });

        const hasChargeable = payloadAssignments.some(
          (assignment) =>
            assignment.isChargeable && assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
        );
        if (!hasChargeable) {
          const fallbackAssignmentId =
            assignmentRows.find((assignment) => assignment.participantLinkState !== 'ARCHIVED_REFERENCE')?.id ||
            assignmentRows[0]?.id;
          payloadAssignments = payloadAssignments.map((assignment) => {
            const isFallback = assignment.id === fallbackAssignmentId;
            return {
              ...assignment,
              isChargeable: isFallback,
              assignedAmount: isFallback ? totalChargeableAmount : 0,
            };
          });
        }

        const chargeableIndexes: number[] = [];
        let chargeableSum = 0;
        payloadAssignments.forEach((assignment, index) => {
          if (!assignment.isChargeable) return;
          chargeableIndexes.push(index);
          chargeableSum += Number(assignment.assignedAmount || 0);
        });
        const normalizedSum = roundMoney(chargeableSum);
        const delta = roundMoney(totalChargeableAmount - normalizedSum);
        if (Math.abs(delta) > 0.009 && chargeableIndexes.length > 0) {
          const firstIndex = chargeableIndexes[0];
          const firstAssignment = payloadAssignments[firstIndex];
          payloadAssignments[firstIndex] = {
            ...firstAssignment,
            assignedAmount: roundMoney(Math.max(0, Number(firstAssignment.assignedAmount || 0) + delta)),
          };
        }
      }
      const normalizedTotalCents = Math.max(0, Math.round(Number(totalChargeableAmount || 0) * 100));
      let normalizedChargeableIndexes = payloadAssignments
        .map((assignment, index) => ({ assignment, index }))
        .filter(({ assignment }) => Boolean(assignment.isChargeable))
        .map(({ index }) => index);
      if (normalizedChargeableIndexes.length === 0 && payloadAssignments.length > 0) {
        const fallbackIndex = payloadAssignments.findIndex(
          (assignment) => assignment.participantLinkState !== 'ARCHIVED_REFERENCE'
        );
        const safeFallbackIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
        payloadAssignments[safeFallbackIndex] = {
          ...payloadAssignments[safeFallbackIndex],
          isChargeable: true,
        };
        normalizedChargeableIndexes = [safeFallbackIndex];
      }
      if (normalizedChargeableIndexes.length > 0) {
        let assignedCents = 0;
        payloadAssignments = payloadAssignments.map((assignment, index) => {
          if (!normalizedChargeableIndexes.includes(index)) {
            return {
              ...assignment,
              isChargeable: false,
              assignedAmount: 0,
            };
          }
          const nextCents = Math.max(0, Math.round(Number(assignment.assignedAmount || 0) * 100));
          assignedCents += nextCents;
          return {
            ...assignment,
            isChargeable: true,
            assignedAmount: Number((nextCents / 100).toFixed(2)),
          };
        });
        const deltaCents = normalizedTotalCents - assignedCents;
        if (deltaCents !== 0) {
          const firstIndex = normalizedChargeableIndexes[0];
          const firstAssignment = payloadAssignments[firstIndex];
          const firstCents = Math.max(0, Math.round(Number(firstAssignment?.assignedAmount || 0) * 100));
          const nextCents = Math.max(0, firstCents + deltaCents);
          payloadAssignments[firstIndex] = {
            ...firstAssignment,
            assignedAmount: Number((nextCents / 100).toFixed(2)),
          };
        }
      }
      const sidebarParticipantsMetadata = buildSidebarParticipantsMetadata(nextParticipants);

      let backendPersisted = false;
      try {
        const savedConfig = await updateBookingBillingConfig(bookingId, {
          chargeMode: nextChargeMode,
          chargeResponsibleRef,
          assignments: payloadAssignments,
          metadata: {
            schemaVersion: 1,
            client: 'agenda-admin-v2',
            sidebarParticipants: sidebarParticipantsMetadata,
            sidebar: {
              participants: sidebarParticipantsMetadata,
            },
          },
        });
        remoteBillingConfigRequestSeqRef.current += 1;
        setRemoteBillingConfig(savedConfig);
        backendPersisted = true;
      } catch (error: any) {
        reportUiError({ area: 'AgendaPlayground', action: 'updateBillingConfig' }, error);
        const message = toUserSafeMessage(error?.message, 'No se pudo guardar la configuración de cobro.');
        showCalendarNotice(message);
      }

      setPaymentMode(nextMode);
      setParticipants(nextParticipants.length > 0 ? nextParticipants : initialParticipants.map((participant) => ({ ...participant })));
      setParticipantPriceDraftById({});
      return backendPersisted;
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'persistBillingConfig' }, error);
      return false;
    }
  }, [
    bookingDrawerState.draft,
    editingBooking?.clientId,
    editingBooking?.userId,
    participants,
    resolveParticipantPrice,
    showCalendarNotice,
    totalPrice,
  ]);

  const persistNewBookingDraftState = useCallback(
    async (
      bookingId: number,
      options?: {
        bookingClientId?: string;
        bookingUserId?: number | null;
        bookingClientName?: string;
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

  const handleAddConsumption = useCallback(async () => {
    if (!persistedEditingBookingId) {
      setBookingConsumptionError('Primero guardá la reserva para poder cargar consumos.');
      return;
    }
    const productId = Number(consumptionProductDraft || 0);
    const quantity = Math.max(1, Math.floor(Number(consumptionQuantityDraft || 1)));
    const selectedProduct = consumptionProducts.find((product) => product.id === productId) || null;
    if (!selectedProduct) {
      setBookingConsumptionError('Seleccioná un producto válido.');
      return;
    }
    if (selectedProduct.stock != null && selectedProduct.stock <= 0) {
      setBookingConsumptionError('Ese producto no tiene stock disponible.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBookingConsumptionError('La cantidad debe ser mayor a cero.');
      return;
    }
    setConsumptionAddInFlight(true);
    setBookingConsumptionError('');
    try {
      await ClubAdminService.addItemToBooking(
        persistedEditingBookingId,
        productId,
        quantity,
        'CASH',
        { applyDiscount: consumptionApplyDiscountDraft }
      );
      await Promise.all([
        loadBookingConsumptions(persistedEditingBookingId),
        refreshBookingFinancial(persistedEditingBookingId),
        reloadSchedule(),
      ]);
      setConsumptionQuantityDraft('1');
      setConsumptionQuote(null);
      setConsumptionQuoteError('');
      showCalendarNotice('Consumo agregado correctamente.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleAddConsumption' }, error);
      setBookingConsumptionError(error?.message || 'No se pudo agregar el consumo.');
    } finally {
      setConsumptionAddInFlight(false);
    }
  }, [
    consumptionApplyDiscountDraft,
    consumptionProductDraft,
    consumptionProducts,
    consumptionQuantityDraft,
    loadBookingConsumptions,
    persistedEditingBookingId,
    refreshBookingFinancial,
    reloadSchedule,
    showCalendarNotice,
  ]);

  const handleRemoveConsumption = useCallback(async (itemId: string) => {
    if (!persistedEditingBookingId || !itemId) return;
    setConsumptionRemovingId(itemId);
    setBookingConsumptionError('');
    try {
      await ClubAdminService.removeItemFromBooking(itemId);
      await Promise.all([
        loadBookingConsumptions(persistedEditingBookingId),
        refreshBookingFinancial(persistedEditingBookingId),
        reloadSchedule(),
      ]);
      showCalendarNotice('Consumo eliminado.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleRemoveConsumption' }, error);
      setBookingConsumptionError(error?.message || 'No se pudo eliminar el consumo.');
    } finally {
      setConsumptionRemovingId((previous) => (previous === itemId ? null : previous));
    }
  }, [loadBookingConsumptions, persistedEditingBookingId, refreshBookingFinancial, reloadSchedule, showCalendarNotice]);

  const handleCreateBooking = async (forceCreateRecurring = false, editSeriesScope?: EditSeriesScope) => {
    let recurringSummaryError = '';
    let recurringResultModalShouldOpen = false;
    let createdBookingId: string | null = null;

    const owner = participants.find((participant) => participant.isOwner);

    if (!owner || owner.name.trim().length === 0) {
      setBlockingFieldError('owner', 'Falta el responsable de la reserva.');
      return;
    }

    if (paymentMode === 'Único' && !simplifiedOwnerAdded) {
      setBlockingFieldError('owner', 'Primero agregá el titular.');
      return;
    }

    const ownerClientId = resolveParticipantClientId(owner);
    const ownerPhone = resolvePlaygroundClientPhone(owner);
    const ownerEmail = resolvePlaygroundClientEmail(owner);
    if (!ownerClientId && !ownerPhone) {
      setBlockingFieldError('owner', 'Cargá el teléfono del titular o seleccioná un cliente existente.');
      return;
    }
    // Fase 1.2: email es opcional en alta rápida admin. Solo phone es obligatorio.

    if (simplifiedNewParticipantOpen) {
      setBlockingFieldError('participants', 'Terminá de agregar el nuevo participante antes de guardar.');
      return;
    }

    if (hasDuplicateParticipants) {
      setBlockingFieldError('participants', 'No podés guardar con participantes duplicados.');
      return;
    }

    if (selectedEndSlot <= selectedStartSlot) {
      setBlockingFieldError('time', 'La hora de fin debe ser mayor a la de inicio.');
      return;
    }

    if (quoteLoading) {
      setBlockingFieldError('time', 'Esperá un instante: estamos validando disponibilidad.');
      return;
    }

    if (shouldBlockSaveByQuote) {
      setBlockingFieldError('time', quoteError || 'El horario seleccionado no está disponible.');
      return;
    }

    if (isCompletedReservation && hasScheduleChanges) {
      setBlockingFieldError('time', 'No podés reprogramar una reserva completada.');
      return;
    }

    if (isSelectionInPastBlocking) {
      setBlockingFieldError('time', 'No se pueden reservar turnos en el pasado.');
      return;
    }

    if (!isRecurringKind && hasConflict && (!editingBookingId || hasScheduleChanges)) {
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
      const editingFixedBookingId = Number(editingBooking?.fixedBookingId || 0);
      const isEditingRecurringSeries =
        Number.isFinite(editingFixedBookingId) &&
        editingFixedBookingId > 0;
      const numericEditingBookingId = Number(editingBookingId);

      if (isEditingRecurringSeries && hasScheduleChanges && !editSeriesScope) {
        setPendingSeriesScopeSave(null);
        setSeriesEditPreviewLoading(false);
        setSeriesEditPreviewScope(null);
        setSeriesEditPreviewSummary(null);
        setEditSeriesScopeModalOpen(true);
        return;
      }

      if (!hasScheduleChanges && !hasUserBillingConfigChanges && !hasSidebarParticipantsChanges) {
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
        const numericBookingId = numericEditingBookingId;
        let operationalSaved = true;
        let billingSaved = true;
        let recurringRescheduleResult: any = null;
        if (hasScheduleChanges) {
          if (isEditingRecurringSeries && editSeriesScope) {
            const numericCourtId = Number(selectedCourtId);
            if (!Number.isFinite(numericCourtId) || numericCourtId <= 0) {
              setBlockingFieldError('court', 'Seleccioná una cancha válida para editar la serie.');
              return;
            }
            const scopeStartDateTime = buildStartDateTimeFromSlot(selectedDate, selectedStartSlot);
            const scopeDurationMinutes = Math.max(15, (selectedEndSlot - selectedStartSlot) * slotMinutes);
            setPendingSeriesScopeSave(editSeriesScope);
            recurringRescheduleResult = await rescheduleFixedBooking(editingFixedBookingId, {
              scope: editSeriesScope,
              occurrenceBookingId: Number.isFinite(numericBookingId) && numericBookingId > 0 ? numericBookingId : undefined,
              courtId: numericCourtId,
              startDateTime: scopeStartDateTime,
              durationMinutes: scopeDurationMinutes,
            });
            setPendingSeriesScopeSave(null);
            setEditSeriesScopeModalOpen(false);
            setSeriesEditPreviewScope(null);
            setSeriesEditPreviewSummary(null);
          } else {
            await persistBookingMove(editingBookingId, selectedCourtId, selectedStartSlot, selectedEndSlot);
          }
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
            !billingSaved ? 'configuración de cobro' : '',
            failedPaymentTempIds.length > 0 ? `${failedPaymentTempIds.length} pagos` : '',
          ].filter(Boolean);
          bookingDrawerDispatch({
            type: 'SAVE_PARTIAL',
            payload: {
              message: `Guardado parcial: faltó guardar ${partialIssues.join(' y ')}.`,
              operationalSaved,
              billingSaved,
              failedPaymentTempIds,
            },
          });
          setFormError(
            !billingSaved
              ? 'Guardado parcial: no se pudo persistir toda la configuración de cobro.'
              : 'Guardado parcial.'
          );
          showCalendarNotice(
            !billingSaved
              ? 'Guardado parcial: configuración de cobro pendiente'
              : 'Guardado parcial'
          );
          return;
        }

        if (Number.isFinite(numericBookingId) && numericBookingId > 0) {
          const timelineRequestSeq = bookingTimelineRequestSeqRef.current + 1;
          bookingTimelineRequestSeqRef.current = timelineRequestSeq;
          setBookingTimelineLoading(true);
          setBookingTimelineError('');
          try {
            const events = await getBookingTimelineEvents(numericBookingId, { take: 200 });
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
        const pendingParticipantNotice = String(pendingParticipantSaveNoticeRef.current || '').trim();
        if (pendingParticipantNotice) {
          pendingParticipantSaveNoticeRef.current = '';
        }
        if (shouldClose) {
          setDrawerOpen(false);
          setEditingBookingId(null);
          setEditingBaseline(null);
        }
        setFormError('');
        const baseSuccessMessage = shouldClose ? 'Reserva actualizada correctamente.' : 'Cambios guardados.';
        showCalendarNotice(
          pendingParticipantNotice ? `${baseSuccessMessage} ${pendingParticipantNotice}` : baseSuccessMessage
        );
        if (isEditingRecurringSeries && editSeriesScope && recurringRescheduleResult) {
          const overlapItemsRaw = Array.isArray(recurringRescheduleResult?.overlaps) ? recurringRescheduleResult.overlaps : [];
          const updatedItemsRaw = Array.isArray(recurringRescheduleResult?.updatedItems)
            ? recurringRescheduleResult.updatedItems
            : Array.isArray(recurringRescheduleResult?.applicableItems)
              ? recurringRescheduleResult.applicableItems
              : [];
          const overlapItems = overlapItemsRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha'));
          const appliedItems = updatedItemsRaw
            .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha'))
            .sort((a, b) => (Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0)));
          const updatedCount = Number(
            recurringRescheduleResult?.updatedCount ?? recurringRescheduleResult?.willUpdateCount ?? 0
          );
          const skippedCount = Number(recurringRescheduleResult?.skippedCount || overlapItems.length);
          setSeriesOperationResult({
            mode: 'edit',
            title: updatedCount > 0 ? 'Serie editada correctamente' : 'No se aplicaron cambios en la serie',
            detail:
              updatedCount > 0
                ? `Se actualizaron ${updatedCount} ocurrencia(s) de la serie.`
                : 'Ninguna ocurrencia pudo reprogramarse con los datos elegidos.',
            appliedCount: updatedCount,
            appliedItems,
            skippedCount,
            overlapItems,
          });
          setSeriesOperationResultOpen(true);
        }
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

      if (isRecurringKind) {
        setRecurringOverlapModalOpen(false);
        setRecurringCreatedItems([]);

        if (selectedRecurringCourts.length === 0) {
          setFormError('Seleccioná al menos una cancha para crear la serie.');
          return;
        }
        if (recurringExecutionPlan.error) {
          setFormError(recurringExecutionPlan.error);
          return;
        }
        const baseDate = new Date(selectedDate);
        baseDate.setHours(12, 0, 0, 0);
        const recurrenceDays = recurringExecutionPlan.recurrenceDays;
        const frequencyDays = recurringExecutionPlan.frequencyDays;
        const repetitionsPerDay = recurringExecutionPlan.repetitionsPerDay;

        if (!forceCreateRecurring) {
          const previewOverlapDetails: RecurringOverlapItem[] = [];
          const previewErrors: string[] = [];
          let previewGeneratedCount = 0;
          let previewSkippedCount = 0;

          const pushPreviewOverlapDetail = (item: any, fallbackCourtName: string) => {
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
            const inferredRequestedEnd =
              hasRequestedStart && !hasRequestedEnd
                ? new Date((requestedStart as Date).getTime() + Math.max(15, selectionMinutes) * 60000)
                : null;

            previewOverlapDetails.push({
              courtName: String(item?.courtName || item?.conflictingCourtName || fallbackCourtName || 'Cancha'),
              requestedDateLabel: hasRequestedStart
                ? (requestedStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : 'Fecha no disponible',
              requestedTimeLabel: `${
                hasRequestedStart
                  ? (requestedStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : slotToTime(selectedStartSlot)
              } - ${
                hasRequestedEnd
                  ? (requestedEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : inferredRequestedEnd
                    ? inferredRequestedEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                    : slotToTime(selectedEndSlot)
              }`,
              conflictingDateLabel: hasConflictingStart
                ? (conflictingStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : undefined,
              conflictingTimeLabel:
                hasConflictingStart && hasConflictingEnd
                  ? `${(conflictingStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${(conflictingEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                  : undefined,
              activityName: String(item?.conflictingActivityName || item?.activityName || '').trim() || undefined,
              clientName: String(item?.conflictingClientName || item?.clientName || '').trim() || undefined,
            });
          };

          for (const court of selectedRecurringCourts) {
            const activityId = Number(court.activityTypeId || 0);
            if (!Number.isFinite(activityId) || activityId <= 0) {
              previewErrors.push(`${court.name}: sin actividad configurada`);
              continue;
            }

            for (const dayOfWeek of recurrenceDays) {
              const firstOccurrence = getNextDateForDay(baseDate, dayOfWeek, slotTime);
              try {
                const preview = await createFixedBooking(Number(court.id), activityId, firstOccurrence, {
                  durationMinutes: selectionMinutes,
                  everyDays: frequencyDays,
                  ...(Number.isFinite(repetitionsPerDay) ? { repetitions: repetitionsPerDay } : {}),
                  ...(ownerClientId
                    ? { clientId: ownerClientId }
                    : {
                        client: {
                          name: owner.name.trim(),
                          phone: ownerPhone,
                          email: ownerEmail,
                        },
                      }),
                  previewConflictsOnly: true,
                });
                previewGeneratedCount += Number(preview?.generatedCount || 0);
                const skippedOccurrences = Array.isArray(preview?.skippedOccurrences) ? preview.skippedOccurrences : [];
                previewSkippedCount += skippedOccurrences.length;
                skippedOccurrences.forEach((item: any) => {
                  pushPreviewOverlapDetail(item, court.name);
                });
              } catch (error: any) {
                const overlaps = Array.isArray(error?.details?.overlaps)
                  ? error.details.overlaps
                  : Array.isArray(error?.meta?.overlaps)
                    ? error.meta.overlaps
                    : Array.isArray(error?.overlaps)
                      ? error.overlaps
                      : [];
                if (overlaps.length > 0) {
                  previewSkippedCount += overlaps.length;
                  overlaps.forEach((item: any) => {
                    pushPreviewOverlapDetail(item, court.name);
                  });
                  continue;
                }
                previewErrors.push(`${court.name}: ${toUserSafeMessage(error?.message, 'Error al previsualizar la serie')}`);
              }
            }
          }

          if (previewErrors.length > 0) {
            setFormError(`No se pudo previsualizar la serie: ${previewErrors.join(' · ')}`);
            return;
          }

          setRecurringOverlapItems(previewOverlapDetails);
          setRecurringPreviewSummary({
            generatedCount: previewGeneratedCount,
            skippedCount: previewSkippedCount,
            courtsCount: selectedRecurringCourts.length,
          });
          setRecurringCreateConfirmOpen(true);
          setFormError('');
          return;
        }

        setRecurringOverlapItems([]);
        setRecurringPreviewSummary(null);

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
            ...(ownerClientId
              ? { clientId: ownerClientId }
              : {
                  client: {
                    name: owner.name.trim(),
                    phone: ownerPhone,
                    email: ownerEmail,
                  },
                }),
          });
          return result;
        };

        const overlapDetails: RecurringOverlapItem[] = [];
        const createdDetails: RecurringCreatedItem[] = [];
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
              const createdOccurrences = Array.isArray(result?.createdOccurrences) ? result.createdOccurrences : [];
              if (createdOccurrences.length > 0) {
                createdOccurrences.forEach((item: any) => {
                  const createdStartRaw = item?.startDateTime || null;
                  const createdEndRaw = item?.endDateTime || null;
                  const createdStart = createdStartRaw ? new Date(createdStartRaw) : null;
                  const createdEnd = createdEndRaw ? new Date(createdEndRaw) : null;
                  const hasCreatedStart = createdStart && !Number.isNaN(createdStart.getTime());
                  const hasCreatedEnd = createdEnd && !Number.isNaN(createdEnd.getTime());
                  createdDetails.push({
                    bookingId: Number.isFinite(Number(item?.bookingId)) ? Number(item.bookingId) : undefined,
                    courtName: String(item?.courtName || court.name || 'Cancha'),
                    requestedDateLabel: hasCreatedStart
                      ? (createdStart as Date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                      : 'Fecha no disponible',
                    requestedTimeLabel: `${
                      hasCreatedStart
                        ? (createdStart as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                        : slotToTime(selectedStartSlot)
                    } - ${
                      hasCreatedEnd
                        ? (createdEnd as Date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                        : slotToTime(selectedEndSlot)
                    }`,
                    activityName: String(item?.activityName || '').trim() || undefined,
                    sortStartMs: hasCreatedStart ? (createdStart as Date).getTime() : undefined,
                  });
                });
              }
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
          hasExplicitLimit: Number.isFinite(repetitionsPerDay),
        });
        const hasOnlyOverlapSkips =
          hardErrors.length === 0 &&
          generatedCount === 0 &&
          skippedCount > 0 &&
          overlapDetails.length > 0;
        const shouldOpenRecurringResultModal = generatedCount > 0 || hasOnlyOverlapSkips;
        recurringResultModalShouldOpen = shouldOpenRecurringResultModal;
        if (hardErrors.length > 0) {
          recurringSummaryError = `Algunas canchas fallaron: ${hardErrors.join(' · ')}`;
          setFormError(recurringSummaryError);
        } else if (hasOnlyOverlapSkips) {
          recurringSummaryError = recurringOverlapOnlyMessage;
          setFormError('');
        } else {
          setFormError('');
        }
        setRecurringOverlapItems(overlapDetails);
        setRecurringCreatedItems(
          [...createdDetails].sort((a, b) => {
            const aStart = Number.isFinite(a.sortStartMs) ? Number(a.sortStartMs) : Number.MAX_SAFE_INTEGER;
            const bStart = Number.isFinite(b.sortStartMs) ? Number(b.sortStartMs) : Number.MAX_SAFE_INTEGER;
            if (aStart !== bStart) return aStart - bStart;
            return a.courtName.localeCompare(b.courtName, 'es');
          })
        );
        setRecurringOverlapModalOpen(shouldOpenRecurringResultModal);
      } else {
        const selectedActivityId = Number(selectedCourt?.activityTypeId || 0);
        if (!Number.isFinite(selectedActivityId) || selectedActivityId <= 0) {
          setFormError('No se pudo resolver la actividad de la cancha. Revisá la configuración del club.');
          return;
        }
        const bookingDate = new Date(selectedDate);
        const createdPayload: any = await createBooking(Number(selectedCourtId), selectedActivityId, bookingDate, slotTime, {
          durationMinutes: selectionMinutes,
          ...(ownerClientId
            ? { clientId: ownerClientId }
            : {
                client: {
                  name: owner.name.trim(),
                  phone: ownerPhone,
                  email: ownerEmail,
                },
              }),
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
          let createdBookingClientName = String(
            bookingPayload?.client?.name || bookingPayload?.clientName || ''
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
              createdBookingClientName = String(
                hydratedBooking?.client?.name || hydratedBooking?.clientName || createdBookingClientName
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
            bookingClientName: createdBookingClientName || undefined,
          });
        }
      }

      const refreshedBookings = await reloadSchedule();
      if (isRecurringKind) {
        if (recurringSummaryError && !recurringResultModalShouldOpen) {
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
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setParticipantPriceDraftById({});
      setEditingBookingId(null);
      setEditingBaseline(null);
    } catch (error: any) {
      setPendingSeriesScopeSave(null);
      const normalized = normalizeApiError(error, 'No se pudo crear la reserva.');
      if (normalized.code === 'CLIENT_POSSIBLE_DUPLICATE' && !isRecurringKind) {
        const owner = participants.find((participant) => participant.isOwner);
        const selectedActivityId = Number(selectedCourt?.activityTypeId || 0);
        const slotTime = slotToTime(selectedStartSlot);
        const candidateRows = extractDuplicateCandidatesFromMeta(normalized.meta);
        if (owner && Number.isFinite(selectedActivityId) && selectedActivityId > 0 && candidateRows.length > 0) {
          const ownerName = owner.name.trim();
          const ownerPhone = resolvePlaygroundClientPhone(owner);
          const ownerEmail = resolvePlaygroundClientEmail(owner);
          const bookingDate = new Date(selectedDate);
          setDuplicateDecisionPendingPayload({
            courtId: Number(selectedCourtId),
            activityId: selectedActivityId,
            bookingDate,
            slotTime,
            durationMinutes: selectionMinutes,
            ownerName,
            ownerPhone,
            ownerEmail,
          });
          setDuplicateDecisionCandidates(candidateRows);
          setDuplicateDecisionSelectedClientId(String(candidateRows[0]?.id || ''));
          setDuplicateDecisionError('');
          setDuplicateDecisionOpen(true);
          setFormError('');
          return;
        }
      }
      applyBookingError(error, 'No se pudo crear la reserva.');
      reportUiError({ area: 'AgendaPlayground', action: 'createBooking' }, error);
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (recurringCourtsMenuRef.current && !recurringCourtsMenuRef.current.contains(target)) {
        setRecurringCourtsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, []);

  useEffect(() => {
    if (!bookingKindMenuOpen) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-booking-kind-menu-root="true"]')) return;
      setBookingKindMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [bookingKindMenuOpen]);

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRecurringCourtsMenuOpen(false);
        setCustomRecurrenceModalOpen(false);
        setRecurringOverlapModalOpen(false);
        setRecurringCreateConfirmOpen(false);
        setEditSeriesScopeModalOpen(false);
        setDeleteSeriesScopeModalOpen(false);
        setSeriesOperationResultOpen(false);
        setSeriesEditPreviewScope(null);
        setSeriesDeletePreviewScope(null);
        setSeriesEditPreviewSummary(null);
        setSeriesDeletePreviewSummary(null);
        setParticipantUiState({ mode: 'idle', participantId: null });
        setSimplifiedOwnerSuggestionsOpen(false);
        setSimplifiedOwnerSuggestionsPlacement(null);
        setSimplifiedNewParticipantSuggestionsOpen(false);
        setSimplifiedNewParticipantSuggestionsPlacement(null);
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    if (!editingBookingId) {
      setSimplifiedOwnerAdded(false);
      setSimplifiedOwnerPaymentMethodDraft('');
      setSimplifiedEditingParticipantId(null);
      setSimplifiedEditPaymentMethodDraft('');
      setSimplifiedOwnerSuggestionsOpen(false);
      setSimplifiedOwnerSearchLoading(false);
      setSimplifiedOwnerSuggestions([]);
      setSimplifiedNewParticipantOpen(false);
      setSimplifiedNewParticipantName('');
      setSimplifiedNewParticipantContact('');
      setSimplifiedNewParticipantSourceTypeDraft('guest');
      setSimplifiedNewParticipantEntityRefDraft('');
      setSimplifiedNewParticipantSuggestionsOpen(false);
      setSimplifiedNewParticipantSearchLoading(false);
      setSimplifiedNewParticipantSuggestions([]);
      closeSimplifiedPaymentModal();
    }
  }, [closeSimplifiedPaymentModal, drawerOpen, editingBookingId]);

  useEffect(() => {
    if (!drawerOpen || !editingBookingId) return;
    const namedOwner = participants.find(
      (participant) => participant.isOwner && participant.name.trim().length > 0
    );
    if (!namedOwner) return;
    setSimplifiedOwnerAdded(true);
    setSimplifiedOwnerPaymentMethodDraft(String(namedOwner.paymentMethod || ''));
    setSimplifiedEditingParticipantId(null);
    setSimplifiedEditPaymentMethodDraft('');
    setSimplifiedOwnerSuggestionsOpen(false);
    setSimplifiedOwnerSearchLoading(false);
    setSimplifiedOwnerSuggestions([]);
    setSimplifiedNewParticipantOpen(false);
    setSimplifiedNewParticipantName('');
    setSimplifiedNewParticipantContact('');
    setSimplifiedNewParticipantSourceTypeDraft('guest');
    setSimplifiedNewParticipantEntityRefDraft('');
    setSimplifiedNewParticipantSuggestionsOpen(false);
    setSimplifiedNewParticipantSearchLoading(false);
    setSimplifiedNewParticipantSuggestions([]);
  }, [drawerOpen, editingBookingId, participants]);

  const simplifiedParticipantWithPaymentControlsIdSet = useMemo(() => {
    return new Set(chargedParticipantIdSet);
  }, [chargedParticipantIdSet]);

  useEffect(() => {
    if (!simplifiedEditingParticipantId) return;
    const stillExistsAndCharged = participants.some(
      (participant) =>
        participant.id === simplifiedEditingParticipantId &&
        simplifiedParticipantWithPaymentControlsIdSet.has(participant.id)
    );
    if (stillExistsAndCharged && simplifiedOwnerAdded && !isBookingFullyPaid) return;
    setSimplifiedEditingParticipantId(null);
    setSimplifiedEditPaymentMethodDraft('');
  }, [
    isBookingFullyPaid,
    participants,
    simplifiedEditingParticipantId,
    simplifiedOwnerAdded,
    simplifiedParticipantWithPaymentControlsIdSet,
  ]);

  useEffect(() => {
    if (!simplifiedNewParticipantOpen) return;
    if (simplifiedOwnerAdded) return;
    setSimplifiedNewParticipantOpen(false);
    setSimplifiedNewParticipantName('');
    setSimplifiedNewParticipantContact('');
    setSimplifiedNewParticipantSourceTypeDraft('guest');
    setSimplifiedNewParticipantEntityRefDraft('');
    setSimplifiedNewParticipantSuggestionsOpen(false);
    setSimplifiedNewParticipantSearchLoading(false);
    setSimplifiedNewParticipantSuggestions([]);
  }, [simplifiedNewParticipantOpen, simplifiedOwnerAdded]);

  useEffect(() => {
    if (drawerOpen) return;
    closeSimplifiedPaymentModal();
  }, [closeSimplifiedPaymentModal, drawerOpen]);

  const resolveSuggestionPlacement = useCallback((
    anchor: HTMLDivElement | null,
    options?: { itemCount?: number; loading?: boolean }
  ): SuggestionPlacement => {
    if (!anchor) return { openUp: false, maxHeight: 280 };
    const rect = anchor.getBoundingClientRect();
    const footerTop =
      simplifiedSidebarFooterRef.current?.getBoundingClientRect().top ?? window.innerHeight;
    const lowerBoundary = Math.min(window.innerHeight, footerTop) - 8;
    const spaceBelow = Math.max(0, lowerBoundary - rect.bottom - 6);
    const spaceAbove = Math.max(0, rect.top - 12);
    const itemCount = Math.max(0, Number(options?.itemCount || 0));
    const loadingRows = options?.loading ? 1 : 0;
    const estimatedContentHeight = Math.max(120, Math.min(280, (itemCount + loadingRows) * 44 + 12));
    // Si con su alto natural tocaría el footer, abrir arriba.
    const openUp = spaceBelow < estimatedContentHeight;
    const available = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(estimatedContentHeight, Math.max(96, available || 96));
    return { openUp, maxHeight };
  }, []);

  useEffect(() => {
    if (!simplifiedOwnerSuggestionsOpen) {
      setSimplifiedOwnerSuggestionsPlacement(null);
      return;
    }
    setSimplifiedOwnerSuggestionsPlacement(
      resolveSuggestionPlacement(simplifiedOwnerInputContainerRef.current, {
        itemCount: simplifiedOwnerSuggestions.length,
        loading: simplifiedOwnerSearchLoading,
      })
    );
  }, [
    resolveSuggestionPlacement,
    simplifiedOwnerSearchLoading,
    simplifiedOwnerSuggestions.length,
    simplifiedOwnerSuggestionsOpen,
  ]);

  useEffect(() => {
    if (!simplifiedNewParticipantSuggestionsOpen) {
      setSimplifiedNewParticipantSuggestionsPlacement(null);
      return;
    }
    setSimplifiedNewParticipantSuggestionsPlacement(
      resolveSuggestionPlacement(simplifiedNewParticipantInputContainerRef.current, {
        itemCount: simplifiedNewParticipantSuggestions.length,
        loading: simplifiedNewParticipantSearchLoading,
      })
    );
  }, [
    resolveSuggestionPlacement,
    simplifiedNewParticipantSearchLoading,
    simplifiedNewParticipantSuggestions.length,
    simplifiedNewParticipantSuggestionsOpen,
  ]);

  useEffect(() => {
    if (!simplifiedOwnerSuggestionsOpen && !simplifiedNewParticipantSuggestionsOpen) return;
    const updatePosition = () => {
      setSimplifiedSuggestionsPositionTick((previous) => previous + 1);
    };
    updatePosition();
    const container = drawerScrollContainerRef.current;
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    container?.addEventListener('scroll', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      container?.removeEventListener('scroll', updatePosition as EventListener);
    };
  }, [simplifiedNewParticipantSuggestionsOpen, simplifiedOwnerSuggestionsOpen]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block' || paymentMode !== 'Único') return;
    if (!latestPaymentCoveredRef) return;

    const bookingClientId = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdRaw = Number(editingBooking?.userId || 0);
    const bookingUserId =
      Number.isFinite(bookingUserIdRaw) && bookingUserIdRaw > 0
        ? bookingUserIdRaw
        : undefined;

    setParticipants((previous) => {
      const matchedPayer = previous.find(
        (participant) =>
          buildStableParticipantRef(participant, { bookingClientId, bookingUserId }) === latestPaymentCoveredRef
      );
      if (!matchedPayer) return previous;

      let changed = false;
      const next = previous.map((participant) => {
        const shouldBePaid = participant.id === matchedPayer.id;
        if (participant.paid === shouldBePaid) return participant;
        changed = true;
        return { ...participant, paid: shouldBePaid };
      });
      return changed ? next : previous;
    });
  }, [
    bookingKind,
    drawerOpen,
    editingBooking?.clientId,
    editingBooking?.userId,
    latestPaymentCoveredRef,
    participants,
    paymentMode,
  ]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenés permiso para acceder al panel de administración." />;
  const recurringCourtSelectionLabel =
    selectedRecurringCourts.length === 0
      ? 'Seleccionar canchas'
      : selectedRecurringCourts.map((court) => court.name).join(', ');
  const useSimplifiedBookingSidebar = bookingKind === 'regular' || bookingKind === 'recurringV2';
  const simplifiedIsEditingReservation = Boolean(editingBookingId);
  const simplifiedIsEditingRecurringSeries = Boolean(
    editingBookingId && (editingBooking?.isRecurring || Number(editingBooking?.fixedBookingId || 0) > 0)
  );
  const simplifiedHeaderDateLabel = selectedDate
    .toLocaleDateString('es-AR', {
      weekday: 'long',
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
  const ownerHasTypedName = Boolean(ownerParticipant && ownerParticipant.name.trim().length > 0);
  const ownerContactPhoneDraft = extractPhoneFromParticipantContact(ownerParticipant?.contact);
  const ownerContactEmailDraft = extractEmailFromParticipantContact(ownerParticipant?.contact);
  const ownerHasLinkedSelection = Boolean(ownerParticipant && ownerParticipant.sourceType !== 'guest');
  const ownerHasName = Boolean(
    ownerParticipant &&
    ownerParticipant.name.trim().length > 0 &&
    String(ownerParticipant.entityRef || '').trim().length > 0
  );
  const ownerCanBeAdded = ownerHasName && (ownerHasLinkedSelection || ownerContactPhoneDraft.length > 0);
  const simplifiedSummaryOwnerLabel = ownerParticipant?.name.trim() || 'Titular sin asignar';
  const simplifiedSummaryCourtLabel = selectedCourt?.name || 'Cancha no definida';
  const sidebarTitle = (() => {
    if (simplifiedIsEditingReservation) {
      if (bookingKind === 'block') return 'Editar bloqueo';
      if (simplifiedIsEditingRecurringSeries) return 'Editar serie recurrente';
      return 'Editar reserva';
    }

    if (bookingKind === 'block') return 'Crear bloqueo';
    if (bookingKind === 'recurringV2') return 'Crear serie recurrente';
    if (useSimplifiedBookingSidebar) return `Crear reserva para ${simplifiedHeaderDateLabel}`;
    return 'Crear reserva';
  })();
  const simplifiedNamedParticipants = participants.filter((participant) => participant.name.trim().length > 0);
  const simplifiedNewParticipantHasLinkedSelection =
    String(simplifiedNewParticipantEntityRefDraft || '').trim().length > 0 &&
    simplifiedNewParticipantSourceTypeDraft !== 'guest';
  const hasValidSimplifiedNewParticipantName =
    simplifiedNewParticipantName.trim().length > 0 &&
    simplifiedNewParticipantEntityRefDraft.trim().length > 0;
  const simplifiedOwnerSuggestionsFloatingStyle = (() => {
    if (
      !simplifiedOwnerSuggestionsOpen ||
      !simplifiedOwnerInputContainerRef.current ||
      !simplifiedOwnerSuggestionsPlacement
    ) {
      return null;
    }
    const rect = simplifiedOwnerInputContainerRef.current.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      top: simplifiedOwnerSuggestionsPlacement.openUp ? undefined : Math.round(rect.bottom + 6),
      bottom: simplifiedOwnerSuggestionsPlacement.openUp
        ? Math.round(window.innerHeight - rect.top + 6)
        : undefined,
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      maxHeight: Math.round(simplifiedOwnerSuggestionsPlacement.maxHeight),
      zIndex: 90,
    };
  })();
  const simplifiedNewParticipantSuggestionsFloatingStyle = (() => {
    if (
      !simplifiedNewParticipantSuggestionsOpen ||
      !simplifiedNewParticipantInputContainerRef.current ||
      !simplifiedNewParticipantSuggestionsPlacement
    ) {
      return null;
    }
    const rect = simplifiedNewParticipantInputContainerRef.current.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      top: simplifiedNewParticipantSuggestionsPlacement.openUp
        ? undefined
        : Math.round(rect.bottom + 6),
      bottom: simplifiedNewParticipantSuggestionsPlacement.openUp
        ? Math.round(window.innerHeight - rect.top + 6)
        : undefined,
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      maxHeight: Math.round(simplifiedNewParticipantSuggestionsPlacement.maxHeight),
      zIndex: 90,
    };
  })();
  const ownerPaymentMethodOptions: Array<{ value: Participant['paymentMethod']; label: string }> = [
    { value: 'CASH', label: 'Efectivo' },
    { value: 'TRANSFER', label: 'Transferencia' },
    { value: 'CARD', label: 'Tarjeta' },
    { value: 'OTHER', label: 'Otro' },
  ];
  const simplifiedHasConfirmedPayments =
    Boolean(
      bookingDrawerState.draft?.billing.payments.some(
        (payment) => payment.status === 'CONFIRMED' && Number(payment.amount || 0) > 0.009
      )
    ) || Number(bookingFinancial?.paid || 0) > 0.009;
  const simplifiedLockedSinglePayerId = (() => {
    if (paymentMode !== 'Único' || !simplifiedHasConfirmedPayments) return '';
    const explicitResponsibleId = String(singleChargeParticipantId || '').trim();
    if (explicitResponsibleId && participants.some((participant) => participant.id === explicitResponsibleId)) {
      return explicitResponsibleId;
    }
    const ownerParticipant = participants.find((participant) => participant.isOwner);
    return ownerParticipant?.id || participants[0]?.id || '';
  })();
  const simplifiedPayerCandidates = (() => {
    return participants.map((participant, index) => ({
      ...participant,
      optionLabel:
        String(participant.name || '').trim() ||
        (participant.isOwner ? 'Titular sin nombre' : `Participante ${index + 1}`),
    }));
  })();
  const simplifiedPayerComboOptions: ComboOption[] = (() => {
    const lockedSinglePayer =
      paymentMode === 'Único' && simplifiedLockedSinglePayerId
        ? simplifiedPayerCandidates.filter((participant) => participant.id === simplifiedLockedSinglePayerId)
        : simplifiedPayerCandidates;
    const resolved = lockedSinglePayer.map((participant) => ({
      value: participant.id,
      label: `${participant.optionLabel}${participant.isOwner ? ' (titular)' : ''}`,
      secondary: String(participant.contact || '').trim() || undefined,
    }));
    return resolved;
  })();
  const simplifiedPaymentMethodComboOptions: ComboOption[] = [
    ...ownerPaymentMethodOptions.map((option) => ({ value: option.value, label: option.label })),
  ];
  const simplifiedPaymentMethodLabel = (() => {
    const selected = ownerPaymentMethodOptions.find(
      (option) => option.value === simplifiedPaymentMethodDraft
    );
    return selected?.label || 'Sin método';
  })();
  const simplifiedCoveredParticipantComboOptions: ComboOption[] = simplifiedPayerCandidates.map((participant) => {
    const debt = Number(participantDebtAmountById.get(participant.id) || 0);
    return {
      value: participant.id,
      label: participant.optionLabel,
      secondary: `Deuda ${debt.toFixed(2)} $`,
    };
  });
  const handleSimplifiedPayerChange = (nextParticipantId: string) => {
    if (
      paymentMode === 'Único' &&
      simplifiedLockedSinglePayerId &&
      nextParticipantId &&
      nextParticipantId !== simplifiedLockedSinglePayerId
    ) {
      showCalendarNotice('En pago único, después del primer pago queda fijo el pagador.');
      return;
    }
    setSimplifiedPaymentPayerParticipantIdDraft(nextParticipantId);
    if (paymentMode === 'Dividido' && simplifiedPaymentQuickPreset === 'MY_SHARE') {
      const preselectedCoveredId = String(nextParticipantId || '').trim();
      setSimplifiedPaymentCoveredParticipantIdDraft(preselectedCoveredId);
      setSimplifiedPaymentCoveredParticipantIdsDraft(preselectedCoveredId ? [preselectedCoveredId] : []);
      const nextDebt = Number(participantDebtAmountById.get(preselectedCoveredId) || 0);
      const nextAmount = Number(Math.max(0, Math.min(simplifiedRemainingAfterQueue, nextDebt)).toFixed(2));
      setSimplifiedPaymentAmountDraft(nextAmount > 0.009 ? nextAmount.toFixed(2) : '');
    } else if (paymentMode === 'Dividido' && simplifiedPaymentQuickPreset === 'FULL') {
      const idsWithDebt = simplifiedPayerCandidates
        .map((participant) => participant.id)
        .filter((participantId) => Number(participantDebtAmountById.get(participantId) || 0) > 0.009);
      setSimplifiedPaymentCoveredParticipantIdsDraft(idsWithDebt);
      setSimplifiedPaymentCoveredParticipantIdDraft(idsWithDebt[0] || nextParticipantId);
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(simplifiedRemainingAfterQueue));
    } else if (paymentMode === 'Dividido' && simplifiedPaymentQuickPreset === 'COURT_ONLY') {
      setSimplifiedPaymentCoveredParticipantIdsDraft(nextParticipantId ? [nextParticipantId] : []);
      setSimplifiedPaymentCoveredParticipantIdDraft(nextParticipantId);
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(computeConceptBasedMaxAmount('COURT')));
    } else if (paymentMode === 'Dividido' && simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS') {
      setSimplifiedPaymentCoveredParticipantIdsDraft(nextParticipantId ? [nextParticipantId] : []);
      setSimplifiedPaymentCoveredParticipantIdDraft(nextParticipantId);
      setSimplifiedPaymentAmountDraft(
        formatPaymentAmountDraft(
          computeConceptBasedMaxAmount(
            'CUSTOM',
            simplifiedPaymentSelectedItemIdsDraft,
            simplifiedPaymentCustomItemAmountDraftById
          )
        )
      );
    } else if (!String(simplifiedPaymentCoveredParticipantIdDraft || '').trim()) {
      setSimplifiedPaymentCoveredParticipantIdDraft(nextParticipantId);
    }
    const nextPayer = participants.find((participant) => participant.id === nextParticipantId);
    if (nextPayer) {
      setSimplifiedPaymentMethodDraft(nextPayer.paymentMethod || 'CASH');
    }
  };
  const simplifiedResolvedPayerParticipantId = (() => {
    if (paymentMode === 'Único' && simplifiedLockedSinglePayerId) {
      return simplifiedLockedSinglePayerId;
    }
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
  const simplifiedResolvedCoveredParticipantIds = (() => {
    if (paymentMode === 'Único') {
      const explicitResponsible = String(singleChargeParticipantId || '').trim();
      if (explicitResponsible && simplifiedPayerCandidates.some((participant) => participant.id === explicitResponsible)) {
        return [explicitResponsible];
      }
      return simplifiedResolvedPayerParticipantId ? [simplifiedResolvedPayerParticipantId] : [];
    }

    const draftManyIdSet = new Set(
      (Array.isArray(simplifiedPaymentCoveredParticipantIdsDraft)
        ? simplifiedPaymentCoveredParticipantIdsDraft
        : []
      )
        .map((value) => String(value || '').trim())
        .filter(
          (value) =>
            value.length > 0 &&
            simplifiedPayerCandidates.some((participant) => participant.id === value) &&
            Number(participantDebtAmountById.get(value) || 0) > 0.009
        )
    );
    if (draftManyIdSet.size > 0) {
      return simplifiedPayerCandidates
        .map((participant) => participant.id)
        .filter((participantId) => draftManyIdSet.has(participantId));
    }

    const draftCovered = String(simplifiedPaymentCoveredParticipantIdDraft || '').trim();
    if (
      draftCovered &&
      simplifiedPayerCandidates.some((participant) => participant.id === draftCovered) &&
      Number(participantDebtAmountById.get(draftCovered) || 0) > 0.009
    ) {
      return [draftCovered];
    }
    if (
      simplifiedResolvedPayerParticipantId &&
      Number(participantDebtAmountById.get(simplifiedResolvedPayerParticipantId) || 0) > 0.009
    ) {
      return [simplifiedResolvedPayerParticipantId];
    }
    const firstWithDebt = simplifiedPayerCandidates.find(
      (participant) => Number(participantDebtAmountById.get(participant.id) || 0) > 0.009
    );
    return firstWithDebt?.id ? [firstWithDebt.id] : [];
  })();
  const simplifiedResolvedCoveredParticipantId = simplifiedResolvedCoveredParticipantIds[0] || '';
  const simplifiedResolvedCoveredParticipant = participants.find(
    (participant) => participant.id === simplifiedResolvedCoveredParticipantId
  ) || null;
  const simplifiedResolvedCoveredParticipantsDebt = Number(
    simplifiedResolvedCoveredParticipantIds
      .reduce((sum, participantId) => sum + Number(participantDebtAmountById.get(participantId) || 0), 0)
      .toFixed(2)
  );
  const isPlaytomicPaymentModal = simplifiedPaymentModalVariant === 'PLAYTOMIC';
  const isConceptImputationMode =
    isPlaytomicPaymentModal || simplifiedPaymentImputationMode === 'BY_CONCEPT';
  const simplifiedParticipantBasedMaxAmount = Number(
    (
      isPlaytomicPaymentModal
        ? simplifiedRemainingAfterQueue
        : paymentMode === 'Dividido'
        ? Math.max(
            0,
            Math.min(
              simplifiedRemainingAfterQueue,
              simplifiedResolvedCoveredParticipantsDebt > 0.009
                ? simplifiedResolvedCoveredParticipantsDebt
                : simplifiedRemainingAfterQueue
            )
          )
        : simplifiedRemainingAfterQueue
    ).toFixed(2)
  );
  const simplifiedConceptBasedMaxAmount = Number(
    computeConceptBasedMaxAmount(simplifiedPaymentConceptMode).toFixed(2)
  );
  const simplifiedPaymentMaxAmount = Number(
    (isConceptImputationMode ? simplifiedConceptBasedMaxAmount : simplifiedParticipantBasedMaxAmount).toFixed(2)
  );
  const simplifiedPaymentAmountParsed = Number(String(simplifiedPaymentAmountDraft || '').replace(',', '.'));
  const hasValidSimplifiedPaymentAmount =
    Number.isFinite(simplifiedPaymentAmountParsed) &&
    simplifiedPaymentAmountParsed > 0.009 &&
    simplifiedPaymentAmountParsed <= simplifiedPaymentMaxAmount + 0.009;
  const hasValidSimplifiedPaymentMethod = isParticipantPaymentMethod(simplifiedPaymentMethodDraft);
  const simplifiedCanRegisterPayment =
    Boolean(persistedEditingBookingId) &&
    !isRemoteBillingConfigLoading &&
    !isPaymentLockedByManualPending &&
    simplifiedRemainingAfterQueue > 0.009;
  const playtomicPreviewRequestedAmount = Number(
    Math.max(
      0,
      Math.min(
        Number.isFinite(simplifiedPaymentAmountParsed) ? simplifiedPaymentAmountParsed : 0,
        simplifiedPaymentMaxAmount
      )
    ).toFixed(2)
  );
  const playtomicPreviewRemainingAfter = Number(
    Math.max(0, simplifiedRemainingAfterQueue - playtomicPreviewRequestedAmount).toFixed(2)
  );
  const playtomicPreviewConceptRows = (() => {
    const selectedItems =
      simplifiedPaymentConceptMode === 'AUTO'
        ? pendingAccountItems
        : simplifiedPaymentConceptMode === 'COURT'
          ? pendingCourtAccountItems
          : simplifiedPaymentConceptMode === 'CONSUMPTIONS'
            ? pendingConsumptionAccountItems
            : pendingAccountItems.filter((item) =>
                simplifiedPaymentSelectedItemIdsDraft.includes(String(item.id))
              );
    const customDesiredAmountById = new Map<string, number>();
    if (simplifiedPaymentConceptMode === 'CUSTOM') {
      selectedItems.forEach((item) => {
        const itemId = String(item.id);
        const fallback = Number(item.remainingAmount || 0);
        const rawDraft = String(simplifiedPaymentCustomItemAmountDraftById[itemId] ?? '').trim();
        const parsed = Number(rawDraft.replace(',', '.'));
        const resolved = rawDraft === '' ? 0 : Number.isFinite(parsed) ? parsed : fallback;
        customDesiredAmountById.set(itemId, Number(Math.max(0, Math.min(fallback, resolved)).toFixed(2)));
      });
    }
    let remaining = playtomicPreviewRequestedAmount;
    return selectedItems
      .map((item) => {
        const available = Number(item.remainingAmount || 0);
        const desired =
          simplifiedPaymentConceptMode === 'CUSTOM'
            ? Number(customDesiredAmountById.get(String(item.id)) || 0)
            : available;
        const amount = Number(Math.max(0, Math.min(available, desired, remaining)).toFixed(2));
        remaining = Number(Math.max(0, remaining - amount).toFixed(2));
        return {
          id: String(item.id),
          label: item.type === 'BOOKING' ? 'Cancha' : item.description,
          amount,
        };
      })
      .filter((row) => row.amount > 0.009);
  })();
  const participantIdsWithDebt = simplifiedPayerCandidates
    .map((participant) => participant.id)
    .filter((participantId) => Number(participantDebtAmountById.get(participantId) || 0) > 0.009);
  const applySimplifiedPaymentQuickPreset = (preset: PaymentQuickPreset) => {
    setSimplifiedPaymentQuickPreset(preset);
    const payerId = String(simplifiedResolvedPayerParticipantId || '').trim();
    if (isPlaytomicPaymentModal) {
      setSimplifiedPaymentImputationMode('BY_CONCEPT');
      setSimplifiedPaymentCoveredParticipantIdsDraft(payerId ? [payerId] : []);
      setSimplifiedPaymentCoveredParticipantIdDraft(payerId);
      if (preset === 'COURT_ONLY') {
        setSimplifiedPaymentConceptMode('COURT');
        setSimplifiedPaymentSelectedItemIdsDraft([]);
        setSimplifiedPaymentCustomItemAmountDraftById({});
        setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(computeConceptBasedMaxAmount('COURT')));
        return;
      }
      if (preset === 'CUSTOM_ITEMS') {
        setSimplifiedPaymentConceptMode('CUSTOM');
        setSimplifiedPaymentAmountDraft(
          formatPaymentAmountDraft(
            computeConceptBasedMaxAmount(
              'CUSTOM',
              simplifiedPaymentSelectedItemIdsDraft,
              simplifiedPaymentCustomItemAmountDraftById
            )
          )
        );
        return;
      }
      setSimplifiedPaymentConceptMode('AUTO');
      setSimplifiedPaymentSelectedItemIdsDraft([]);
      setSimplifiedPaymentCustomItemAmountDraftById({});
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(computeConceptBasedMaxAmount('AUTO')));
      return;
    }
    if (preset === 'MY_SHARE') {
      setSimplifiedPaymentImputationMode('BY_PARTICIPANT');
      setSimplifiedPaymentConceptMode('AUTO');
      setSimplifiedPaymentSelectedItemIdsDraft([]);
      setSimplifiedPaymentCustomItemAmountDraftById({});
      setSimplifiedPaymentCoveredParticipantIdsDraft(payerId ? [payerId] : []);
      setSimplifiedPaymentCoveredParticipantIdDraft(payerId);
      const payerDebt = Number(participantDebtAmountById.get(payerId) || 0);
      const nextAmount = Number(Math.max(0, Math.min(simplifiedRemainingAfterQueue, payerDebt)).toFixed(2));
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(nextAmount));
      return;
    }
    if (preset === 'FULL') {
      setSimplifiedPaymentImputationMode('BY_PARTICIPANT');
      setSimplifiedPaymentConceptMode('AUTO');
      setSimplifiedPaymentSelectedItemIdsDraft([]);
      setSimplifiedPaymentCustomItemAmountDraftById({});
      setSimplifiedPaymentCoveredParticipantIdsDraft(participantIdsWithDebt);
      setSimplifiedPaymentCoveredParticipantIdDraft(participantIdsWithDebt[0] || payerId);
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(simplifiedRemainingAfterQueue));
      return;
    }
    if (preset === 'COURT_ONLY') {
      setSimplifiedPaymentImputationMode('BY_CONCEPT');
      setSimplifiedPaymentConceptMode('COURT');
      setSimplifiedPaymentSelectedItemIdsDraft([]);
      setSimplifiedPaymentCustomItemAmountDraftById({});
      setSimplifiedPaymentCoveredParticipantIdsDraft(payerId ? [payerId] : []);
      setSimplifiedPaymentCoveredParticipantIdDraft(payerId);
      const nextAmount = computeConceptBasedMaxAmount('COURT');
      setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(nextAmount));
      return;
    }
    setSimplifiedPaymentImputationMode('BY_CONCEPT');
    setSimplifiedPaymentConceptMode('CUSTOM');
    setSimplifiedPaymentCoveredParticipantIdsDraft(payerId ? [payerId] : []);
    setSimplifiedPaymentCoveredParticipantIdDraft(payerId);
    const nextAmount = computeConceptBasedMaxAmount(
      'CUSTOM',
      simplifiedPaymentSelectedItemIdsDraft,
      simplifiedPaymentCustomItemAmountDraftById
    );
    setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(nextAmount));
  };
  const simplifiedSectionTabs: Array<{ id: SimplifiedSidebarSection; label: string }> = [
    { id: 'DETAILS', label: 'Detalle' },
    ...(bookingKind === 'block'
      ? []
      : [{ id: 'CONSUMPTIONS' as const, label: 'Consumos' }]),
    { id: 'BILLING', label: 'Cobros y participantes' },
    { id: 'HISTORY', label: 'Historial' },
  ];
  const consumptionProductOptions: ComboOption[] = consumptionProducts.map((product) => ({
    value: String(product.id),
    label: product.name,
    secondary:
      product.stock == null
        ? `${product.price.toFixed(2)} $`
        : `${product.price.toFixed(2)} $ · Stock ${Math.max(0, Math.floor(product.stock))}`,
  }));
  const selectedConsumptionProduct = consumptionProducts.find(
    (product) => String(product.id) === String(consumptionProductDraft)
  ) || null;
  const selectedConsumptionQuantity = Math.max(1, Math.floor(Number(consumptionQuantityDraft || 1)));
  const canAddConsumption =
    Boolean(persistedEditingBookingId) &&
    !consumptionAddInFlight &&
    !consumptionQuoteLoading &&
    Boolean(selectedConsumptionProduct) &&
    selectedConsumptionQuantity > 0 &&
    (selectedConsumptionProduct?.stock == null || selectedConsumptionProduct.stock >= selectedConsumptionQuantity);
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
      if (normalized === 'INDIVIDUAL') return 'Pago único';
      if (normalized === 'SHARED') return 'Pago dividido';
      return 'Sin definir';
    };
    const formatTimelineSourceLabel = (source: unknown): string => {
      const normalized = String(source || '').trim().toUpperCase();
      if (!normalized) return '';
      if (normalized === 'MANUAL') return 'Manual';
      if (normalized === 'SYSTEM') return 'Sistema';
      if (normalized === 'AUTOMATIC') return 'Automático';
      if (normalized === 'API') return 'Integración externa';
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
      if (normalized === 'ONLINE_GATEWAY') return 'Pasarela en línea';
      return 'Canal interno';
    };
    const bookingClientIdForRefs = String(editingBooking?.clientId || '').trim() || undefined;
    const bookingUserIdForRefsRaw = Number(editingBooking?.userId || 0);
    const bookingUserIdForRefs =
      Number.isFinite(bookingUserIdForRefsRaw) && bookingUserIdForRefsRaw > 0
        ? bookingUserIdForRefsRaw
        : undefined;
    const responsibleLabelByRef = new Map<string, string>();
    const registerResponsibleRef = (ref: string, label: string) => {
      const safeRef = String(ref || '').trim();
      const safeLabel = String(label || '').trim();
      if (!safeRef || !safeLabel) return;
      if (!responsibleLabelByRef.has(safeRef)) {
        responsibleLabelByRef.set(safeRef, safeLabel);
      }
    };
    Object.entries(participantLabelByRefCache).forEach(([ref, label]) => {
      registerResponsibleRef(ref, label);
    });
    participants.forEach((participant) => {
      const label =
        String(participant.name || '').trim() ||
        (participant.isOwner ? 'Titular' : 'Participante');
      const stableRef = buildStableParticipantRef(participant, {
        bookingClientId: bookingClientIdForRefs,
        bookingUserId: bookingUserIdForRefs,
      });
      const entityRef = String(participant.entityRef || '').trim();
      const guestRef = String(participant.id || '').trim();

      registerResponsibleRef(stableRef, label);
      registerResponsibleRef(entityRef, label);
      if (guestRef) {
        registerResponsibleRef(`guest:${guestRef}`, label);
      }
      if (participant.isOwner) {
        registerResponsibleRef('guest:owner', label);
        registerResponsibleRef('guest:booking-responsible', label);
        if (bookingClientIdForRefs) {
          registerResponsibleRef(`booking-client:${bookingClientIdForRefs}`, label);
        }
        if (bookingUserIdForRefs) {
          registerResponsibleRef(`booking-user:${bookingUserIdForRefs}`, label);
        }
      }
    });
    const formatResponsibleRefLabel = (rawRef: unknown): string => {
      const ref = String(rawRef || '').trim();
      if (!ref) return 'Sin asignar';
      const mappedLabel =
        responsibleLabelByRef.get(ref) ||
        Array.from(responsibleLabelByRef.entries()).find(
          ([candidateRef]) => candidateRef.toLowerCase() === ref.toLowerCase()
        )?.[1];
      if (mappedLabel) return mappedLabel;
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
        const payerNameRaw = String((payload as any)?.payerParticipantName || '').trim();
        const payerRefRaw = String((payload as any)?.payerParticipantRef || '').trim();
        const coveredNameRaw = String((payload as any)?.coveredParticipantName || '').trim();
        const coveredRefRaw = String((payload as any)?.coveredParticipantRef || '').trim();
        const payerLabel = payerNameRaw || (payerRefRaw ? formatResponsibleRefLabel(payerRefRaw) : '');
        const coveredLabel =
          coveredNameRaw ||
          (coveredRefRaw
            ? formatResponsibleRefLabel(coveredRefRaw)
            : (payerLabel || 'Sin asignar'));
        title = Number.isFinite(amount) && amount > 0.009
          ? `Pago recibido (${amount.toFixed(2)} $)`
          : 'Pago recibido';
        const detailParts = [
          payerLabel ? `Pagador: ${payerLabel}` : '',
          coveredLabel ? `Imputado a: ${coveredLabel}` : '',
          methodRaw ? `Método: ${formatPaymentMethodLabel(methodRaw)}` : '',
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
          detail = 'Se asignó el titular durante la creación.';
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
        title = 'Configuración de cobro actualizada';
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
      } else if (normalizedType === 'BOOKING_CLIENT_CHANGED') {
        const oldClientName = String((payload as any)?.oldClientName || '').trim();
        const newClientName = String((payload as any)?.newClientName || '').trim();
        title = 'Titular cambiado';
        if (oldClientName && newClientName) {
          detail = `${oldClientName} -> ${newClientName}`;
        } else if (newClientName) {
          detail = `Nuevo titular: ${newClientName}`;
        } else {
          detail = 'Se actualizó el titular de la reserva.';
        }
      } else if (normalizedType === 'PRODUCT_SOLD') {
        const productName = String((payload as any)?.productName || '').trim() || 'Consumo';
        const quantity = Number((payload as any)?.quantity || 0);
        const totalAmount = Number((payload as any)?.totalAmount || 0);
        title = 'Consumo agregado';
        const detailParts = [
          quantity > 0 ? `${quantity} x ${productName}` : productName,
          Number.isFinite(totalAmount) && totalAmount > 0.009 ? `Total: ${totalAmount.toFixed(2)} $` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Consumo agregado.';
      } else if (normalizedType === 'PRODUCT_REMOVED') {
        const productName = String((payload as any)?.productName || '').trim() || 'Consumo';
        const quantity = Number((payload as any)?.quantity || 0);
        const totalAmount = Number((payload as any)?.totalAmount || 0);
        title = 'Consumo eliminado';
        const detailParts = [
          quantity > 0 ? `${quantity} x ${productName}` : productName,
          Number.isFinite(totalAmount) && totalAmount > 0.009 ? `Total: ${totalAmount.toFixed(2)} $` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Consumo eliminado.';
      } else if (normalizedType === 'BOOKING_NOTES_UPDATED') {
        title = 'Notas actualizadas';
        const notes = String((payload as any)?.notes || '').trim();
        detail = notes.length > 0 ? 'Se actualizó el detalle interno de la reserva.' : 'Se quitaron las notas internas.';
      } else {
        detail = 'Se registró una actualización.';
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
  const showSimplifiedConsumptionsSection =
    simplifiedIsEditingReservation &&
    bookingKind !== 'block' &&
    simplifiedSidebarSection === 'CONSUMPTIONS';
  const showSimplifiedBillingSection =
    !simplifiedIsEditingReservation || simplifiedSidebarSection === 'BILLING';
  const showSimplifiedHistorySection =
    simplifiedIsEditingReservation && simplifiedSidebarSection === 'HISTORY';
  const seriesDeletePaidItems = seriesDeletePreviewSummary?.paidItems || [];
  const seriesDeleteHasPaidItems = seriesDeletePaidItems.length > 0;
  const seriesDeleteBlocksMassCancel =
    seriesDeleteHasPaidItems && seriesDeletePreviewSummary?.scope !== 'THIS_OCCURRENCE';
  const seriesDeleteUsesIndividualRefund =
    seriesDeleteHasPaidItems && seriesDeletePreviewSummary?.scope === 'THIS_OCCURRENCE';
  const calendarNoticeToneClassName = calendarNotice
    ? {
        error: 'border-p-error bg-p-error-bg text-p-error',
        success: 'border-emerald-300 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-300 bg-amber-50 text-amber-700',
        info: 'border-sky-300 bg-sky-50 text-sky-700',
      }[calendarNotice.tone]
    : '';

  return (
    <>
      <Head>
        <title>Agenda de reservas | Pique Admin</title>
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
      <AdminPlaygroundShell activeItem="Calendario" user={user}>

          <section ref={agendaSurfaceRef} className="relative flex-1 h-full min-w-0 rounded-tl-[12px] overflow-hidden bg-p-surface-2">
            {calendarNotice && (
              <div
                className={`pointer-events-none fixed right-5 top-[84px] z-[2147483600] max-w-[420px] rounded-xl border px-3 py-2 text-[12px] font-semibold shadow-sm ${calendarNoticeToneClassName}`}
              >
                {calendarNotice.message}
              </div>
            )}
            <div className="h-full min-w-0">
              <div className="h-full flex flex-col p-4 lg:p-6 gap-4">
                <AgendaToolbar
                  availableSports={availableSports}
                  sportFilter={sportFilter}
                  selectedDate={selectedDate}
                  quickDateInputRef={quickDateInputRef}
                  isQuickDatePickerOpen={isQuickDatePickerOpen}
                  onSportFilterChange={setSportFilter}
                  onQuickDatePickerOpenChange={setIsQuickDatePickerOpen}
                  onDateChange={(nextDate) => {
                    setSelectedDate(nextDate);
                    setFormError('');
                  }}
                  onMoveDate={moveDate}
                  onCreateBooking={() => openQuickCreateBooking(visibleCourts[0]?.id)}
                />

                <div className="flex-1 rounded-2xl border border-p-border bg-p-surface overflow-hidden">
                  <div ref={agendaScrollContainerRef} className="h-full overflow-auto">
                    <div className="min-w-max px-4 pb-4 pt-0">
                      <div className="flex min-w-full">
                        <AgendaTimeGutter
                          gridHeight={gridHeight}
                          nowLineTop={nowLineTop}
                          slotHeight={slotHeight}
                          slotsPerHour={slotsPerHour}
                          totalSlots={totalSlots}
                          slotToTime={slotToTime}
                        />

                        <div className="flex min-w-0 flex-1">
                          {visibleCourts.map((court) => {
                            const courtBookings = visibleBookings.filter((booking) => booking.courtId === court.id);
                            return (
                              <div key={court.id} className="min-w-[132px] flex-1 border-l border-p-border last:border-r">
                                <div className="sticky top-0 z-40 h-10 border-b border-p-border bg-p-surface grid place-items-center text-xs font-semibold text-p-text-secondary">
                                  {court.name}
                                </div>
                                <AgendaSlotLayer
                                  courtId={court.id}
                                  draggingBookingId={draggingBookingId}
                                  gridHeight={gridHeight}
                                  isDragging={isDragging}
                                  nowLineTop={nowLineTop}
                                  slotHeight={slotHeight}
                                  slotsPerHour={slotsPerHour}
                                  totalSlots={totalSlots}
                                  onSlotMouseDown={handleSlotMouseDown}
                                  onSlotMouseEnter={handleSlotMouseEnter}
                                >

                                  {(() => {
                                    const hasDragSelection = dragSelection && dragSelection.courtId === court.id;
                                    const isEditingMovedBookingPreview =
                                      Boolean(editingBookingId) &&
                                      Boolean(hasScheduleChanges) &&
                                      !hasDragSelection;
                                    const hasDrawerSelection =
                                      drawerOpen &&
                                      selectedCourtId === court.id &&
                                      selectedEndSlot > selectedStartSlot &&
                                      (!editingBookingId || hasScheduleChanges);
                                    if (!hasDragSelection && !hasDrawerSelection) return null;

                                    const range = hasDragSelection
                                      ? toSelectionRange(dragSelection as DraftSelection)
                                      : { start: selectedStartSlot, end: selectedEndSlot };
                                    const previewHeight = (range.end - range.start) * slotHeight - 4;
                                    const visibility = blockContentVisibility(previewHeight);
                                    const drawerPreviewIsConflicted = isEditingMovedBookingPreview && hasConflict;
                                    const editedState = editingBooking?.state || 'pending';
                                    const editedPaymentState = editingBooking?.paymentState || 'unpaid';
                                    return (
                                      <AgendaSelectionPreview
                                        range={range}
                                        slotHeight={slotHeight}
                                        slotMinutes={slotMinutes}
                                        visibility={visibility}
                                        slotToTime={slotToTime}
                                        isEditingMovedBookingPreview={isEditingMovedBookingPreview}
                                        isConflict={drawerPreviewIsConflicted}
                                        title={editingBooking?.title || 'Reserva'}
                                        state={editedState}
                                        paymentState={editedPaymentState}
                                        isRecurring={editingBooking?.isRecurring}
                                      />
                                    );
                                  })()}

                                  {bookingDropPreview && draggingBookingMeta && bookingDropPreview.courtId === court.id && (
                                    (() => {
                                      const top = bookingDropPreview.startSlot * slotHeight + 2;
                                      const height = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotHeight - 4;
                                      const visibility = blockContentVisibility(height);
                                      const isDropConflicted = bookingDropHasConflict;
                                      return (
                                        <AgendaBookingBlock
                                          title={draggingBookingMeta.title}
                                          state={draggingBookingMeta.state}
                                          paymentState={draggingBookingMeta.paymentState}
                                          isRecurring={draggingBookingMeta.isRecurring}
                                          participantsCount={draggingBookingMeta.participantsCount}
                                          sportLabel={court.sport}
                                          hasPendingNotification={draggingBookingMeta.hasPendingNotification}
                                          startSlot={bookingDropPreview.startSlot}
                                          endSlot={bookingDropPreview.endSlot}
                                          slotMinutes={slotMinutes}
                                          visibility={visibility}
                                          slotToTime={slotToTime}
                                          colorClass={isDropConflicted ? 'bg-red-200 text-ink-900 border-2 border-red-300' : 'bg-lima-100 text-ink-900'}
                                          isConflict={isDropConflicted}
                                          className="pointer-events-none z-20 overflow-hidden"
                                          style={{ top, height, opacity: isDropConflicted ? 1 : 0.75 }}
                                        />
                                      );
                                    })()
                                  )}

                                  {courtBookings.map((booking) => {
                                    if (draggingBookingId === booking.id) return null;
                                    if (drawerOpen && editingBookingId && hasScheduleChanges && String(booking.id) === String(editingBookingId)) return null;
                                    const top = booking.startSlot * slotHeight + 2;
                                    const height = (booking.endSlot - booking.startSlot) * slotHeight - 4;
                                    const visibility = blockContentVisibility(height);
                                    const isHovered = bookingHoverPreview?.booking?.id === booking.id;
                                    return (
                                      <AgendaBookingBlock
                                        key={booking.id}
                                        title={booking.title}
                                        state={booking.state}
                                        paymentState={booking.paymentState}
                                        totalAmount={booking.hoverPayment?.totalAmount}
                                        remainingAmount={booking.hoverPayment?.remainingAmount}
                                        isRecurring={booking.isRecurring}
                                        participantsCount={booking.participantsCount}
                                        sportLabel={court.sport}
                                        hasPendingNotification={booking.hasPendingNotification}
                                        startSlot={booking.startSlot}
                                        endSlot={booking.endSlot}
                                        slotMinutes={slotMinutes}
                                        visibility={visibility}
                                        slotToTime={slotToTime}
                                        colorClass={bookingColor(booking.state)}
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
                                        style={{
                                          top,
                                          height,
                                          cursor: booking.state === 'completed' ? 'pointer' : draggingBookingId ? 'grabbing' : 'grab',
                                          zIndex: isHovered ? 16 : 10,
                                        }}
                                      />
                                    );
                                  })}
                                </AgendaSlotLayer>
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
              <BookingHoverCard
                x={bookingHoverPreview.x}
                y={bookingHoverPreview.y}
                participants={resolveHoverParticipantsForBooking(bookingHoverPreview.booking)}
              />
            )}

            {customRecurrenceModalOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => setCustomRecurrenceModalOpen(false))
                }
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[25px] font-bold tracking-[-0.01em] text-p-text">Frecuencia personalizada</h3>
                    <button
                      type="button"
                      onClick={() => setCustomRecurrenceModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <p className="text-[13px] text-p-text-muted mb-2">Days</p>
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
                              ? 'border-p-accent bg-ink-900 text-ink-50'
                              : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                          }`}
                        >
                          Días hábiles
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
                              ? 'border-p-accent bg-ink-900 text-ink-50'
                              : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
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
                                  ? 'border-p-accent bg-ink-900 text-ink-50'
                                  : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                              }`}
                            >
                              {day.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[13px] text-p-text-muted">Repetir cada N semanas</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={customRepeatEveryWeeks}
                        onChange={(event) => setCustomRepeatEveryWeeks(Math.max(1, Number(event.target.value || 1)))}
                        className="mt-2 h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text outline-none"
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
                          className={`text-left ${customEndAfterEnabled ? '' : 'text-p-accent font-semibold hover:underline'}`}
                        >
                          <span className={`text-[13px] ${customEndAfterEnabled ? 'text-p-text-muted' : 'text-p-accent'}`}>
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
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-p-error hover:underline shrink-0"
                          >
                            <X size={12} />
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
                            className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text outline-none"
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
                            setFormError('Seleccioná al menos un día para la recurrencia personalizada.');
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
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
                      >
                        <Check size={14} />
                        Confirmar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {recurringCreateConfirmOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => {
                    setRecurringCreateConfirmOpen(false);
                    setRecurringPreviewSummary(null);
                  })
                }
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">Confirmar creación de serie</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setRecurringCreateConfirmOpen(false);
                        setRecurringPreviewSummary(null);
                      }}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[13px] text-p-accent">
                      Previsualización lista: revisá superposiciones antes de crear la serie.
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-p-surface-2 px-3 py-2 text-xs text-p-text-secondary flex justify-between">
                        <span>Disponibles para crear</span>
                        <strong>{recurringPreviewSummary?.generatedCount ?? 0}</strong>
                      </div>
                      <div className="rounded-lg bg-p-error-bg px-3 py-2 text-xs text-p-error flex justify-between">
                        <span>Superpuestas</span>
                        <strong>{recurringPreviewSummary?.skippedCount ?? recurringOverlapItems.length}</strong>
                      </div>
                    </div>
                    {recurringOverlapItems.length > 0 ? (
                      <div>
                        <p className="text-[13px] font-semibold text-p-text-secondary mb-2">
                          Detalle de superposiciones ({recurringOverlapItems.length})
                        </p>
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-p-border bg-p-surface divide-y divide-p-border">
                          {recurringOverlapItems.map((item, index) => (
                            <div key={`preview-overlap-item-${index}`} className="px-3 py-2">
                              <p className="text-[13px] font-semibold text-p-text">{item.courtName}</p>
                              <p className="text-[12px] text-p-text-secondary">
                                Solicitada: {item.requestedDateLabel} · {item.requestedTimeLabel}
                              </p>
                              {(item.conflictingDateLabel || item.conflictingTimeLabel) && (
                                <p className="text-[11px] text-p-text-muted">
                                  Ocupada: {item.conflictingDateLabel || item.requestedDateLabel}
                                  {item.conflictingTimeLabel ? ` · ${item.conflictingTimeLabel}` : ''}
                                </p>
                              )}
                              {(item.clientName || item.activityName) && (
                                <p className="text-[11px] text-p-text-muted">
                                  En conflicto con: {[item.clientName, item.activityName].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-p-positive bg-p-positive-bg px-3 py-2 text-[13px] text-p-positive">
                        No se detectaron superposiciones.
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRecurringCreateConfirmOpen(false);
                          setRecurringPreviewSummary(null);
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
                      >
                        <X size={14} />
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRecurringCreateConfirmOpen(false);
                          void handleCreateBooking(true);
                        }}
                        className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
                      >
                        {recurringOverlapItems.length > 0 ? 'Crear serie igualmente' : 'Crear serie'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {recurringOverlapModalOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, closeRecurringResultModal)
                }
              >
                <div
                  className="w-full max-w-[680px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">
                      {(recurringResult?.generatedCount ?? 0) === 0
                        ? 'No se pudo crear la serie'
                        : (recurringResult?.skippedCount ?? 0) > 0
                          ? 'Serie creada con superposiciones'
                          : 'Serie creada correctamente'}
                    </h3>
                    <button
                      type="button"
                      onClick={closeRecurringResultModal}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[13px] text-p-accent">
                      {(recurringResult?.generatedCount ?? 0) === 0
                        ? 'No se creó ningún turno porque todos los horarios se superponen.'
                        : (recurringResult?.skippedCount ?? 0) > 0
                          ? 'Se creó la serie en las ocurrencias válidas y se omitieron las superpuestas.'
                          : 'La serie se creó correctamente.'}
                    </div>
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                      <div className="rounded-lg bg-p-surface-2 px-3 py-2 text-xs text-p-text-secondary flex justify-between">
                        <span>Creadas</span>
                        <strong>{recurringResult?.generatedCount ?? 0}</strong>
                      </div>
                      {(recurringResult?.skippedCount ?? 0) > 0 && (
                        <div className="rounded-lg bg-p-error-bg px-3 py-2 text-xs text-p-error flex justify-between">
                          <span>Omitidas por superposición</span>
                          <strong>{recurringResult?.skippedCount ?? recurringOverlapItems.length}</strong>
                        </div>
                      )}
                    </div>
                    {Boolean(recurringResult?.hasExplicitLimit) && recurringCreatedItems.length > 0 && (
                      <div>
                        <p className="text-[13px] font-semibold text-p-text-secondary mb-2">
                          Turnos creados ({recurringCreatedItems.length})
                        </p>
                        <div className="max-h-64 overflow-y-auto rounded-xl border border-p-border bg-p-surface divide-y divide-p-border">
                          {recurringCreatedItems.map((item, index) => (
                            <div key={`created-item-${item.bookingId ?? index}`} className="px-3 py-2">
                              <p className="text-[13px] font-semibold text-p-text">{item.courtName}</p>
                              <p className="text-[12px] text-p-text-secondary">
                                {item.requestedDateLabel} · {item.requestedTimeLabel}
                              </p>
                              {item.activityName && (
                                <p className="text-[11px] text-p-text-muted">
                                  Actividad: {item.activityName}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {recurringOverlapItems.length > 0 && (
                      <div>
                        <p className="text-[13px] font-semibold text-p-text-secondary mb-2">
                          Detalle ({recurringOverlapItems.length})
                        </p>
                        <div className="max-h-64 overflow-y-auto rounded-xl border border-p-border bg-p-surface divide-y divide-p-border">
                          {recurringOverlapItems.map((item, index) => (
                            <div key={`overlap-item-${index}`} className="px-3 py-2">
                              <p className="text-[13px] font-semibold text-p-text">{item.courtName}</p>
                              <p className="text-[12px] text-p-text-secondary">
                                Solicitada: {item.requestedDateLabel} · {item.requestedTimeLabel}
                              </p>
                              {(item.conflictingDateLabel || item.conflictingTimeLabel) && (
                                <p className="text-[11px] text-p-text-muted">
                                  Ocupada: {item.conflictingDateLabel || item.requestedDateLabel}
                                  {item.conflictingTimeLabel ? ` · ${item.conflictingTimeLabel}` : ''}
                                </p>
                              )}
                              {(item.clientName || item.activityName) && (
                                <p className="text-[11px] text-p-text-muted">
                                  En conflicto con: {[item.clientName, item.activityName].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={closeRecurringResultModal}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
                      >
                        <Check size={14} />
                        Entendido
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {editSeriesScopeModalOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => {
                    if (isSubmittingBooking) return;
                    setEditSeriesScopeModalOpen(false);
                    setSeriesEditPreviewScope(null);
                    setSeriesEditPreviewSummary(null);
                  })
                }
              >
                <div
                  className="w-full max-w-[640px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">Editar serie</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setEditSeriesScopeModalOpen(false);
                        setSeriesEditPreviewScope(null);
                        setSeriesEditPreviewSummary(null);
                      }}
                      disabled={isSubmittingBooking}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2 disabled:opacity-50"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    {!seriesEditPreviewScope ? (
                      <>
                        <p className="text-[13px] text-p-text-secondary">
                          Elegí el alcance de esta edición para previsualizar impacto y superposiciones.
                        </p>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => void previewSeriesEditScope('THIS_OCCURRENCE')}
                            disabled={isSubmittingBooking || seriesEditPreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Editar solo esta ocurrencia</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Solo cambia este turno puntual.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void previewSeriesEditScope('NEXT_OCCURRENCES')}
                            disabled={isSubmittingBooking || seriesEditPreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Editar esta y las siguientes ocurrencias</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Aplica desde este turno en adelante dentro de la serie.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void previewSeriesEditScope('ALL_OCCURRENCES')}
                            disabled={isSubmittingBooking || seriesEditPreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Editar toda la serie</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Aplica a las ocurrencias futuras de la serie.</p>
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[13px] text-p-text-secondary">
                          Previsualización: {
                            seriesEditPreviewScope === 'THIS_OCCURRENCE'
                              ? 'solo esta ocurrencia'
                              : seriesEditPreviewScope === 'NEXT_OCCURRENCES'
                                ? 'esta y las siguientes'
                                : 'toda la serie'
                          }.
                        </p>
                        {seriesEditPreviewLoading && !seriesEditPreviewSummary && (
                          <div className="rounded-xl border border-p-accent bg-p-positive-bg px-4 py-5">
                            <div className="flex items-center justify-center">
                              <span className="h-4 w-4 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                            </div>
                          </div>
                        )}
                        {seriesEditPreviewSummary && (
                          <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[13px] text-p-accent">
                            <p>Se actualizarán <strong>{seriesEditPreviewSummary.applicableCount}</strong> ocurrencias.</p>
                            <p>Se omitirán <strong>{seriesEditPreviewSummary.skippedCount}</strong> ocurrencias.</p>
                          </div>
                        )}
                        {Boolean(seriesEditPreviewSummary?.applicableItems.length) && (
                          <div className="rounded-xl border border-p-border bg-p-surface">
                            <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                              Ocurrencias a actualizar ({seriesEditPreviewSummary.applicableItems.length})
                            </div>
                            <div className="max-h-44 overflow-y-auto divide-y divide-p-border">
                              {seriesEditPreviewSummary.applicableItems.map((item, index) => (
                                <div key={`edit-series-applicable-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                                  <p className="font-semibold text-p-text">{item.courtName}</p>
                                  <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                                  {item.activityName && <p>{item.activityName}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {Boolean(seriesEditPreviewSummary?.overlapItems.length) && (
                          <div className="rounded-xl border border-p-border bg-p-surface-2">
                            <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                              Superposiciones detectadas ({seriesEditPreviewSummary.overlapItems.length})
                            </div>
                            <div className="max-h-48 overflow-y-auto divide-y divide-p-border">
                              {seriesEditPreviewSummary.overlapItems.map((item, index) => (
                                <div key={`edit-series-overlap-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                                  <p className="font-semibold text-p-text">{item.courtName}</p>
                                  <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                                  {item.conflictingDateLabel && item.conflictingTimeLabel && (
                                    <p className="text-p-text-muted">
                                      Conflicta con {item.conflictingDateLabel} · {item.conflictingTimeLabel}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {Boolean(seriesEditPreviewSummary?.failureMessages.length) && (
                          <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
                            {seriesEditPreviewSummary.failureMessages.join(' · ')}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSeriesEditPreviewScope(null);
                              setSeriesEditPreviewSummary(null);
                            }}
                            disabled={isSubmittingBooking}
                            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
                          >
                            Cambiar alcance
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCreateBooking(false, seriesEditPreviewSummary?.scope || seriesEditPreviewScope)}
                            disabled={isSubmittingBooking || pendingSeriesScopeSave !== null || !seriesEditPreviewSummary}
                            className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900 disabled:opacity-50"
                          >
                            Guardar cambios de serie
                          </button>
                        </div>
                      </>
                    )}
                    {pendingSeriesScopeSave && (
                      <div className="rounded-xl border border-p-accent bg-p-positive-bg px-4 py-3">
                        <div className="flex items-center justify-center">
                          <span className="h-4 w-4 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {deleteSeriesScopeModalOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => {
                    if (isDeletingBooking) return;
                    setDeleteSeriesScopeModalOpen(false);
                    setSeriesDeletePreviewScope(null);
                    setSeriesDeletePreviewSummary(null);
                  })
                }
              >
                <div
                  className="w-full max-w-[640px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">Cancelar serie</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteSeriesScopeModalOpen(false);
                        setSeriesDeletePreviewScope(null);
                        setSeriesDeletePreviewSummary(null);
                      }}
                      disabled={isDeletingBooking}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2 disabled:opacity-50"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    {!seriesDeletePreviewScope ? (
                      <>
                        <p className="text-[13px] text-p-text-secondary">
                          Elegí el alcance para previsualizar cuántas ocurrencias se cancelarán.
                        </p>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => void previewSeriesDeleteScope('THIS_OCCURRENCE')}
                            disabled={isDeletingBooking || seriesDeletePreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Cancelar solo esta ocurrencia</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Solo cancela este turno puntual.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void previewSeriesDeleteScope('NEXT_OCCURRENCES')}
                            disabled={isDeletingBooking || seriesDeletePreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Cancelar esta y las siguientes</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Aplica desde este turno en adelante dentro de la serie.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void previewSeriesDeleteScope('ALL_OCCURRENCES')}
                            disabled={isDeletingBooking || seriesDeletePreviewLoading}
                            className="w-full rounded-xl border border-p-border bg-p-surface px-4 py-3 text-left hover:bg-p-surface-2 disabled:opacity-50"
                          >
                            <p className="text-[14px] font-semibold text-p-text">Cancelar toda la serie futura</p>
                            <p className="mt-1 text-[12px] text-p-text-muted">Cancela todas las ocurrencias pendientes de la serie.</p>
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[13px] text-p-text-secondary">
                          Previsualización: {
                            seriesDeletePreviewScope === 'THIS_OCCURRENCE'
                              ? 'solo esta ocurrencia'
                              : seriesDeletePreviewScope === 'NEXT_OCCURRENCES'
                                ? 'esta y las siguientes'
                                : 'toda la serie'
                          }.
                        </p>
                        {seriesDeletePreviewLoading && !seriesDeletePreviewSummary && (
                          <div className="rounded-xl border border-p-accent bg-p-positive-bg px-4 py-5">
                            <div className="flex items-center justify-center">
                              <span className="h-4 w-4 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                            </div>
                          </div>
                        )}
                        {seriesDeletePreviewSummary && (
                          <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[13px] text-p-accent">
                            <p>Se cancelarán <strong>{seriesDeletePreviewSummary.applicableCount}</strong> ocurrencias.</p>
                            <p>Se omitirán <strong>{seriesDeletePreviewSummary.skippedCount}</strong> ocurrencias.</p>
                          </div>
                        )}
                        {seriesDeleteHasPaidItems && (
                          <div className={`rounded-xl border px-3 py-2 text-[12px] font-semibold ${
                            seriesDeleteBlocksMassCancel
                              ? 'border-p-error bg-p-error-bg text-p-error'
                              : 'border-p-warning bg-p-warning-bg text-p-warning'
                          }`}>
                            {seriesDeleteBlocksMassCancel ? (
                              <>
                                <p>
                                  Hay {seriesDeletePaidItems.length} ocurrencia(s) con pagos por {Number(seriesDeletePreviewSummary?.paidAmountTotal || 0).toFixed(2)} $.
                                </p>
                                <p className="mt-1 font-medium">
                                  Para evitar cancelar cobros sin devolución, cancelá esas ocurrencias individualmente.
                                </p>
                              </>
                            ) : (
                              <p>
                                Esta ocurrencia tiene pagos por {Number(seriesDeletePaidItems[0]?.paidAmount || 0).toFixed(2)} $. Vas a continuar con el flujo de devolución puntual.
                              </p>
                            )}
                          </div>
                        )}
                        {Boolean(seriesDeletePreviewSummary?.applicableItems.length) && (
                          <div className="rounded-xl border border-p-border bg-p-surface">
                            <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                              Ocurrencias a cancelar ({seriesDeletePreviewSummary.applicableItems.length})
                            </div>
                            <div className="max-h-44 overflow-y-auto divide-y divide-p-border">
                              {seriesDeletePreviewSummary.applicableItems.map((item, index) => (
                                <div key={`delete-series-applicable-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                                  <p className="font-semibold text-p-text">{item.courtName}</p>
                                  <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                                  {item.activityName && <p>{item.activityName}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {Boolean(seriesDeletePreviewSummary?.overlapItems.length) && (
                          <div className="rounded-xl border border-p-border bg-p-surface-2">
                            <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                              Ocurrencias omitidas ({seriesDeletePreviewSummary.overlapItems.length})
                            </div>
                            <div className="max-h-44 overflow-y-auto divide-y divide-p-border">
                              {seriesDeletePreviewSummary.overlapItems.map((item, index) => (
                                <div key={`delete-series-skip-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                                  <p className="font-semibold text-p-text">{item.courtName}</p>
                                  <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                                  {item.activityName && <p>{item.activityName}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSeriesDeletePreviewScope(null);
                              setSeriesDeletePreviewSummary(null);
                            }}
                            disabled={isDeletingBooking}
                            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
                          >
                            Cambiar alcance
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const scope = seriesDeletePreviewSummary?.scope || seriesDeletePreviewScope;
                              if (seriesDeleteBlocksMassCancel) return;
                              if (seriesDeleteUsesIndividualRefund) {
                                const paidAmount = Number(seriesDeletePaidItems[0]?.paidAmount || cancelBookingPaidAmount || 0);
                                const bookingId = Number(editingBookingId || 0);
                                void (async () => {
                                  if (Number.isFinite(bookingId) && bookingId > 0) {
                                    try {
                                      await refreshBookingFinancial(bookingId);
                                    } catch (error: any) {
                                      applyBookingError(error, 'No se pudo cargar el impacto financiero de la reserva.');
                                      return;
                                    }
                                  }
                                  setCancelRefundAmountInput(paidAmount > 0.009 ? paidAmount.toFixed(2) : '');
                                  setCancelRefundReasonType(paidAmount > 0.009 ? 'FULL' : 'OTHER');
                                  setCancelRefundExecutionNotes('');
                                  setCancelRefundExecuteNow(true);
                                  setCancelBookingFlowError('');
                                  setDeleteBookingFinalConfirmOpen(false);
                                  setDeleteSeriesScopeModalOpen(false);
                                  setSeriesDeletePreviewScope(null);
                                  setSeriesDeletePreviewSummary(null);
                                  setDeleteBookingConfirmOpen(true);
                                })();
                                return;
                              }
                              setDeleteSeriesScopeModalOpen(false);
                              void handleDeleteBooking(scope);
                            }}
                            disabled={isDeletingBooking || !seriesDeletePreviewSummary || seriesDeleteBlocksMassCancel}
                            className="h-10 rounded-xl bg-p-error px-5 text-ink-50 text-sm font-bold hover:bg-p-error disabled:opacity-50"
                          >
                            {seriesDeleteUsesIndividualRefund ? 'Continuar devolución' : 'Confirmar cancelación'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {deleteBookingConfirmOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex justify-end p-3"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, closeDeleteBookingFlow)
                }
              >
                <div
                  className="flex h-full w-full max-w-[560px] flex-col rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-p-border px-5 py-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-p-text-muted">Agenda</p>
                      <h3 className="mt-1 text-[22px] font-bold tracking-[-0.01em] text-p-text">Cancelar reserva</h3>
                      <p className="mt-1 text-[12px] text-p-text-muted">
                        Revisá el impacto financiero antes de confirmar.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeDeleteBookingFlow}
                      disabled={isDeletingBooking}
                      className="grid h-8 w-8 place-items-center rounded-full border border-p-border text-p-text-muted transition hover:bg-p-surface-2 disabled:opacity-50"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                    <div className="rounded-xl border border-p-border bg-p-surface-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-p-text-muted">Reserva</p>
                          <p className="mt-1 text-[15px] font-bold text-p-text">{editingBooking?.title || 'Reserva seleccionada'}</p>
                          <p className="mt-0.5 text-[12px] text-p-text-muted">
                            {selectedDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} · {slotToTime(selectedStartSlot)} - {slotToTime(selectedEndSlot)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-p-border bg-p-surface px-3 py-2 text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-p-text-muted">Cancha</p>
                          <p className="mt-1 text-[13px] font-bold text-p-text">{selectedCourt?.name || 'Sin cancha'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-p-text-muted">Total</p>
                        <p className="mt-1 text-[17px] font-bold text-p-text">{Number(bookingFinancial?.total || totalPrice || 0).toFixed(2)} $</p>
                      </div>
                      <div className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-p-text-muted">Pagado</p>
                        <p className="mt-1 text-[17px] font-bold text-p-positive">{cancelBookingPaidAmount.toFixed(2)} $</p>
                      </div>
                      <div className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-p-text-muted">Saldo</p>
                        <p className="mt-1 text-[17px] font-bold text-p-text-muted">{Number(bookingFinancial?.remaining || 0).toFixed(2)} $</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-p-border bg-p-surface p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-p-text-muted">Devolución</p>
                          <p className="mt-1 text-[13px] text-p-text-muted">
                            {cancelBookingHasPayments
                              ? 'Se generará una devolución asociada a la cancelación.'
                              : 'Esta reserva no tiene pagos registrados.'}
                          </p>
                        </div>
                        {cancelBookingHasPayments && (
                          <span className="rounded-full bg-p-positive-bg px-2.5 py-1 text-[11px] font-bold text-p-accent">
                            Disponible {cancelBookingPaidAmount.toFixed(2)} $
                          </span>
                        )}
                      </div>

                      {isBookingFinancialLoading && (
                        <div className="mt-3 rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[12px] font-semibold text-p-accent">
                          Cargando impacto financiero...
                        </div>
                      )}

                      {cancelBookingHasPayments && (
                        <div className="mt-4 space-y-3">
                          <div>
                            <label className="text-[11px] font-semibold text-p-text-muted">Monto a devolver</label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={cancelRefundAmountInput}
                              onChange={(event) => {
                                setCancelRefundAmountInput(event.target.value);
                                setCancelBookingFlowError('');
                              }}
                              className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] font-semibold text-p-text outline-none focus:border-p-accent"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-p-text-muted">Motivo</label>
                            <select
                              value={cancelRefundReasonType}
                              onChange={(event) => setCancelRefundReasonType(event.target.value as CancelRefundReasonType)}
                              className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] font-semibold text-p-text outline-none focus:border-p-accent"
                            >
                              {cancelRefundReasonOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-p-text-muted">Nota interna</label>
                            <textarea
                              value={cancelRefundExecutionNotes}
                              onChange={(event) => setCancelRefundExecutionNotes(event.target.value)}
                              rows={3}
                              maxLength={500}
                              placeholder="Detalle operativo de la devolución"
                              className="mt-1 w-full resize-none rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] font-semibold text-p-text outline-none focus:border-p-accent"
                            />
                          </div>

                          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={cancelRefundExecuteNow}
                              onChange={(event) => {
                                setCancelRefundExecuteNow(event.target.checked);
                                setCancelBookingFlowError('');
                              }}
                              className="h-4 w-4 accent-p-brand"
                            />
                            <span className="text-[12px] font-semibold text-p-text">Ejecutar devolución ahora</span>
                          </label>
                        </div>
                      )}
                    </div>

                    {cancelBookingFlowError && (
                      <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] font-semibold text-p-error">
                        {cancelBookingFlowError}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-p-border px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeDeleteBookingFlow}
                        disabled={isDeletingBooking}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
                      >
                        <ChevronLeft size={14} />
                        Volver
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const result = buildCancelBookingOptions();
                          if (result.error) {
                            setCancelBookingFlowError(result.error);
                            return;
                          }
                          setCancelBookingFlowError('');
                          setDeleteBookingFinalConfirmOpen(true);
                        }}
                        disabled={isDeletingBooking || isBookingFinancialLoading}
                        className="h-10 rounded-xl bg-p-error px-5 text-sm font-bold text-ink-50 hover:bg-p-error disabled:opacity-50"
                      >
                        Cancelar reserva
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {deleteBookingFinalConfirmOpen && (
              <div
                className="fixed inset-0 z-[2147483300] flex items-center justify-center bg-[var(--overlay)] p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => {
                    if (!isDeletingBooking) setDeleteBookingFinalConfirmOpen(false);
                  })
                }
              >
                <div
                  className="w-full max-w-[460px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="border-b border-p-border px-5 py-4">
                    <h3 className="text-[21px] font-bold tracking-[-0.01em] text-p-text">Confirmar cancelación</h3>
                  </div>
                  <div className="space-y-4 px-5 py-5">
                    <p className="text-[14px] text-p-text-secondary">
                      {cancelBookingHasPayments
                        ? `Vas a cancelar esta reserva y devolver ${normalizedCancelRefundAmount.toFixed(2)} $.`
                        : 'Vas a cancelar esta reserva sin generar devolución.'}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteBookingFinalConfirmOpen(false)}
                        disabled={isDeletingBooking}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
                      >
                        <ChevronLeft size={14} />
                        Volver
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmCancelBookingFromDrawer()}
                        disabled={isDeletingBooking}
                        className="h-10 rounded-xl bg-p-error px-5 text-sm font-bold text-ink-50 hover:bg-p-error disabled:opacity-50"
                      >
                        {isDeletingBooking ? 'Cancelando...' : 'Confirmar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {seriesOperationResultOpen && seriesOperationResult && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, closeSeriesOperationResult)
                }
              >
                <div
                  className="w-full max-w-[620px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">{seriesOperationResult.title}</h3>
                    <button
                      type="button"
                      onClick={closeSeriesOperationResult}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-p-text-secondary">{seriesOperationResult.detail}</p>
                    <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[13px] text-p-text">
                      <p>Aplicadas: <strong>{seriesOperationResult.appliedCount}</strong></p>
                      <p>Omitidas: <strong>{seriesOperationResult.skippedCount}</strong></p>
                    </div>
                    {seriesOperationResult.appliedItems.length > 0 && (
                      <div className="rounded-xl border border-p-border bg-p-surface">
                        <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                          {seriesOperationResult.mode === 'delete'
                            ? `Canceladas (${seriesOperationResult.appliedItems.length})`
                            : `Actualizadas (${seriesOperationResult.appliedItems.length})`}
                        </div>
                        <div className="max-h-44 overflow-y-auto divide-y divide-p-border">
                          {seriesOperationResult.appliedItems.map((item, index) => (
                            <div key={`series-operation-applied-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                              <p className="font-semibold text-p-text">{item.courtName}</p>
                              <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                              {item.activityName && <p>{item.activityName}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {seriesOperationResult.overlapItems.length > 0 && (
                      <div className="rounded-xl border border-p-border bg-p-surface-2">
                        <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                          Detalle ({seriesOperationResult.overlapItems.length})
                        </div>
                        <div className="max-h-44 overflow-y-auto divide-y divide-p-border">
                          {seriesOperationResult.overlapItems.map((item, index) => (
                            <div key={`series-operation-result-${index}`} className="px-3 py-2 text-[12px] text-p-text-secondary">
                              <p className="font-semibold text-p-text">{item.courtName}</p>
                              <p>{item.requestedDateLabel} · {item.requestedTimeLabel}</p>
                              {item.activityName && <p>{item.activityName}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={closeSeriesOperationResult}
                        className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
                      >
                        Entendido
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {deleteParticipantConfirm.open && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () =>
                    setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })
                  )
                }
              >
                <div
                  className="w-full max-w-[500px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-text">Eliminar participante</h3>
                    <button
                      type="button"
                      onClick={() => setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-p-text-secondary">
                      ¿Querés eliminar a <strong>{deleteParticipantConfirm.participantName}</strong> de esta reserva?
                    </p>
                    {deleteParticipantContext.isChargeResponsible && (
                      <p className="rounded-lg border border-p-warning bg-p-warning-bg px-3 py-2 text-[12px] text-p-warning">
                        Este participante es el responsable de pago actual. Al eliminarlo, el responsable pasará a{' '}
                        <strong>{deleteParticipantContext.nextResponsibleLabel || 'otro participante disponible'}</strong>.
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteParticipantConfirm({ open: false, participantId: null, participantName: '' })}
                        className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
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
                        className="h-10 rounded-xl bg-p-error px-5 text-ink-50 text-sm font-bold hover:bg-p-error"
                      >
                        Sí, eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {blockingErrorModalOpen && (
              <div
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => setBlockingErrorModalOpen(false))
                }
              >
                <div
                  className="w-full max-w-[560px] rounded-2xl border border-p-error bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-error">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-error">No se puede continuar</h3>
                    <button
                      type="button"
                      onClick={() => setBlockingErrorModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-p-error grid place-items-center text-p-error hover:bg-p-error-bg"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-p-text-secondary">
                      Corregí primero la fecha/cancha/horario para poder seguir con pagos y participantes.
                    </p>
                    <div className="rounded-lg border border-p-error bg-p-error-bg px-3 py-2">
                      <p className="text-[13px] font-semibold text-p-error">{blockingActionMessage}</p>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setBlockingErrorModalOpen(false)}
                        className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
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
                className="fixed inset-0 z-[2147483200] bg-[var(--overlay)] flex items-center justify-center p-4"
                onPointerDown={handleModalBackdropPointerDown}
                onPointerUp={(event) =>
                  handleModalBackdropPointerUp(event, () => setBookingCreatedModalOpen(false))
                }
              >
                <div
                  className="w-full max-w-[520px] rounded-2xl border border-p-accent bg-p-surface shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
                    <h3 className="text-[23px] font-bold tracking-[-0.01em] text-p-accent">Reserva creada</h3>
                    <button
                      type="button"
                      onClick={() => setBookingCreatedModalOpen(false)}
                      className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <p className="text-[14px] text-p-text-secondary">
                      La reserva se creó correctamente y quedó abierta para edición.
                    </p>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setBookingCreatedModalOpen(false)}
                        className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
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
                className="absolute inset-0 z-50 bg-[var(--overlay)]"
                onClick={() => setDrawerOpen(false)}
              />
            )}

            <aside
              className={`absolute inset-y-0 right-0 z-[60] w-full md:max-w-[670px] border-l border-p-border bg-p-surface shadow-2xl transition-transform duration-300 ${
                drawerOpen ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              <div className="relative h-full w-full flex flex-col">
                {isWaitingQueuedPaymentConfirmation && (
                  <div className="absolute inset-0 z-50 bg-p-surface/65 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="rounded-2xl border border-p-border bg-p-surface px-5 py-4 shadow-xl text-center">
                      <div className="mx-auto h-8 w-8 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                      <p className="mt-3 text-[14px] font-semibold text-p-text">
                        Confirmando pago...
                      </p>
                      <p className="mt-1 text-[12px] text-p-text-muted">
                        Esperando confirmación del sistema.
                      </p>
                    </div>
                  </div>
                )}
                <header className="border-b border-p-border px-6 py-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-p-text">
                      {sidebarTitle}
                    </h2>
                    {!useSimplifiedBookingSidebar && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 relative">
                      <button
                        type="button"
                        onClick={() => setBookingKindMenuOpen((previous) => !previous)}
                        className="h-8 rounded-full border border-p-accent bg-p-positive-bg px-3 text-[13px] font-medium text-p-accent inline-flex items-center gap-1.5"
                      >
                        <selectedBookingKind.icon size={13} />
                        {selectedBookingKind.label}
                        <ChevronDown size={14} />
                      </button>
                      {bookingKindMenuOpen && (
                        <div className="absolute top-10 left-0 z-40 w-[420px] rounded-2xl border border-p-border bg-p-surface p-2 shadow-xl">
                          <div className="space-y-1">
                            {bookingKindOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setBookingKind(option.value);
                                  setBookingKindMenuOpen(false);
                                }}
                                className={`w-full text-left rounded-xl px-3 py-3 transition ${
                                  option.value === bookingKind ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                                }`}
                              >
                                <span className="flex items-start gap-2">
                                  <option.icon size={17} className="mt-[1px] text-p-text-secondary" />
                                  <span>
                                    <span className="block text-[19px] font-bold leading-none text-p-text">{option.label}</span>
                                    <span className="block mt-1 text-[12px] leading-snug text-p-text-muted">{option.description}</span>
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <label className="h-8 min-w-[124px] rounded-full border border-p-border bg-p-surface-2 px-3 text-[13px] font-medium text-p-text-secondary inline-flex items-center gap-1.5">
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
                          {!isRecurringKind && (
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
                    className="h-9 w-9 rounded-full border border-p-border text-p-text-muted grid place-items-center hover:bg-p-surface-2 shrink-0"
                  >
                    <X size={16} />
                  </button>
                </header>

                {useSimplifiedBookingSidebar && simplifiedIsEditingReservation && (
                  <div className="border-b border-p-border px-6">
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
                                ? 'border-p-accent text-p-accent'
                                : 'border-transparent text-p-text-muted hover:text-p-text'
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
                    <section className="rounded-2xl border border-p-border bg-p-surface px-4 py-4">
                      {showSimplifiedDetailsSection && (simplifiedIsEditingReservation ? (
                        <>
                          <div className="rounded-xl border border-p-border bg-p-surface-2 p-4">
                            <div className="flex items-center">
                              <p className="text-[18px] font-semibold text-p-text">Reserva del usuario</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
                              <div>
                                <p className="text-[12px] text-p-text-muted">Titular</p>
                                <p className="mt-0.5 text-[15px] font-medium text-p-text">{simplifiedSummaryOwnerLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-p-text-muted">Fecha</p>
                                <p className="mt-0.5 text-[15px] font-medium text-p-text">{simplifiedSummaryDateLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-p-text-muted">Origen</p>
                                <p className="mt-0.5 text-[15px] font-medium text-p-text">Administrador</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-p-text-muted">Horario</p>
                                <p className="mt-0.5 text-[15px] font-medium text-p-text">{simplifiedSummaryTimeLabel}</p>
                              </div>
                              <div>
                                <p className="text-[12px] text-p-text-muted">Cancha</p>
                                <p className="mt-0.5 text-[15px] font-medium text-p-text">{simplifiedSummaryCourtLabel}</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 max-w-[260px]">
                            <p className="text-[12px] font-medium text-p-text-muted">Precio</p>
                            <div className="mt-1 h-12 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between">
                              <input
                                type="number"
                                readOnly
                                value={isFinancialDisplayPending ? '' : Number(totalPrice.toFixed(2))}
                                className="w-full bg-transparent text-[18px] font-semibold text-p-text outline-none"
                              />
                              <span className="ml-2 text-[18px] font-semibold text-p-text-muted">$</span>
                            </div>
                          </div>
                          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="block">
                              <span className="text-[12px] font-medium text-p-text-muted">Hora de inicio</span>
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
                                disabled={isCompletedReservationScheduleLocked}
                                className="mt-1"
                              />
                            </div>
                            <div className="block">
                              <span className="text-[12px] font-medium text-p-text-muted">Hora de fin</span>
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
                                disabled={isCompletedReservationScheduleLocked}
                                className="mt-1"
                              />
                            </div>
                            {timeFieldError && (
                              <div className="md:col-span-2">
                                <p className="text-[12px] font-medium text-p-error">{timeFieldError}</p>
                              </div>
                            )}
                            <div className="block md:col-span-2">
                              <span className="text-[12px] font-medium text-p-text-muted">Cancha</span>
                              <PlaygroundCombo
                                value={selectedCourtId}
                                onChange={(next) => {
                                  setSelectedCourtId(next);
                                  setScheduleInputsDirty(true);
                                  setFormError('');
                                }}
                                options={effectiveCourts.map((court) => ({ value: court.id, label: court.name }))}
                                disabled={isCompletedReservationScheduleLocked}
                                className="mt-1"
                              />
                              {courtFieldError && (
                                <p className="mt-1 text-[12px] font-medium text-p-error">{courtFieldError}</p>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            data-booking-kind-menu-root="true"
                            className="relative rounded-xl border border-p-border bg-p-positive-bg px-3 py-2.5 flex items-center justify-between"
                          >
                            <div className="inline-flex items-center gap-2 text-[15px] font-medium text-p-accent">
                              <Clock3 size={16} />
                              <span>{bookingKind === 'recurringV2' ? 'Serie recurrente' : 'Reserva regular'}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setBookingKindMenuOpen((previous) => !previous)}
                              className="text-[14px] font-semibold text-p-accent underline underline-offset-2 hover:text-p-accent"
                            >
                              Cambiar tipo
                            </button>
                            {bookingKindMenuOpen && (
                              <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-p-border bg-p-surface p-2 shadow-xl">
                                <div className="space-y-1">
                                  {bookingKindOptions.map((option) => {
                                    const isLockedForChange = lockedBookingKindChangeValues.has(option.value);

                                    return (
                                      <button
                                        key={`simplified-booking-kind-${option.value}`}
                                        type="button"
                                        disabled={isLockedForChange}
                                        onClick={() => {
                                          if (isLockedForChange) return;
                                          setBookingKind(option.value);
                                          setBookingKindMenuOpen(false);
                                          setFormError('');
                                        }}
                                        title={isLockedForChange ? 'No disponible desde Cambiar tipo' : undefined}
                                        className={`w-full rounded-xl px-3 py-3 text-left transition ${
                                          option.value === bookingKind
                                            ? 'bg-p-positive-bg'
                                            : isLockedForChange
                                              ? 'cursor-not-allowed opacity-45'
                                              : 'hover:bg-p-surface-2'
                                        }`}
                                      >
                                        <span className="flex items-start gap-2">
                                          <option.icon size={17} className="mt-[1px] text-p-text-secondary" />
                                          <span>
                                            <span className="block text-[16px] font-bold leading-none text-p-text">{option.label}</span>
                                            <span className="block mt-1 text-[12px] leading-snug text-p-text-muted">{option.description}</span>
                                          </span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                          {dateFieldError && (
                            <p className="mt-2 text-[12px] font-medium text-p-error">{dateFieldError}</p>
                          )}

                          {bookingKind === 'recurringV2' ? (
                            <>
                              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="block">
                                  <span className="text-[12px] font-medium text-p-text-muted">Día de repetición</span>
                                  <PlaygroundCombo
                                    value={String(recurringDayOfWeek)}
                                    onChange={(nextValue) => {
                                      setRecurringDayOfWeek(Number(nextValue));
                                      setRecurringResult(null);
                                      setFormError('');
                                    }}
                                    options={WEEKDAY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                                    className="mt-1"
                                  />
                                </div>
                                <div className="block">
                                  <span className="text-[12px] font-medium text-p-text-muted">Frecuencia</span>
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
                                    className="mt-1"
                                  />
                                </div>
                                <div className="block">
                                  <span className="text-[12px] font-medium text-p-text-muted">Hora de inicio</span>
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
                                </div>
                                <div className="block">
                                  <span className="text-[12px] font-medium text-p-text-muted">Hora de fin</span>
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
                                </div>
                                {timeFieldError && (
                                  <div className="md:col-span-2">
                                    <p className="text-[12px] font-medium text-p-error">{timeFieldError}</p>
                                  </div>
                                )}
                              </div>

                              <div className="mt-4">
                                <p className="text-[12px] font-medium text-p-text-muted">Canchas para la serie</p>
                                <div ref={recurringCourtsMenuRef} className="relative mt-1">
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
                                    className={`h-11 w-full rounded-xl border px-3 text-left text-[15px] inline-flex items-center justify-between gap-2 bg-p-surface transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/30 focus-visible:ring-offset-0 ${
                                      recurringCourtsMenuOpen
                                        ? 'border-p-border ring-2 ring-lima-300/30 text-p-text'
                                        : 'border-p-border text-p-text hover:border-p-border-strong'
                                    }`}
                                  >
                                    <span className="truncate">{recurringCourtSelectionLabel || 'Seleccionar canchas'}</span>
                                    <ChevronDown
                                      size={15}
                                      className={`text-p-text-muted transition-transform ${recurringCourtsMenuOpen ? 'rotate-180' : ''}`}
                                    />
                                  </button>
                                  {recurringCourtsMenuOpen && (
                                    <div className="absolute left-0 right-0 mt-2 rounded-xl border border-p-border bg-p-surface shadow-xl z-40 overflow-hidden">
                                      <label className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[15px] text-p-text transition ${recurringAllCourtsSelected ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'}`}>
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
                                        <span className="grid h-7 w-7 place-items-center rounded-[10px] border border-p-border bg-p-surface text-[16px] leading-none text-p-accent peer-checked:border-p-accent peer-checked:bg-p-positive-bg">
                                          {recurringAllCourtsSelected ? <Check size={14} strokeWidth={3} /> : null}
                                        </span>
                                        <span className="font-medium">Todas las canchas</span>
                                      </label>
                                      <div className="h-px bg-p-surface-3" />
                                      <div className="max-h-56 overflow-y-auto">
                                        {effectiveCourts.map((court) => {
                                          const checked = recurringCourtIds.includes(court.id);
                                          return (
                                            <label
                                              key={`recurring-court-${court.id}`}
                                              className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[15px] text-p-text transition ${checked ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'}`}
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
                                              <span className="grid h-7 w-7 place-items-center rounded-[10px] border border-p-border bg-p-surface text-[16px] leading-none text-p-accent peer-checked:border-p-accent peer-checked:bg-p-positive-bg">
                                                {checked ? <Check size={14} strokeWidth={3} /> : null}
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

                              <div className="mt-4 rounded-xl border border-p-border bg-p-surface px-4 py-3">
                                {recurringFrequencyPreset === 'custom' && (
                                  <>
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-[12px] font-medium text-p-text-muted">Repetición personalizada</p>
                                      <button
                                        type="button"
                                        onClick={() => setCustomRecurrenceModalOpen(true)}
                                        className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-accent hover:bg-p-positive-bg"
                                      >
                                        Editar repetición
                                      </button>
                                    </div>
                                    <div className="my-2 h-px bg-p-surface-3" />
                                  </>
                                )}
                                <p className="text-[12px] text-p-text-muted">
                                  Primera ocurrencia:{' '}
                                  <strong className="ml-1 text-[14px] font-semibold text-p-text">
                                    {recurringFirstOccurrence.toLocaleDateString('es-AR', {
                                      weekday: 'long',
                                      day: '2-digit',
                                      month: 'short',
                                    })}{' '}
                                    · {slotToTime(selectedStartSlot)} - {slotToTime(selectedEndSlot)}
                                  </strong>
                                </p>
                                <p className="mt-1 text-[12px] text-p-text-muted">
                                  {recurringCadenceShortSummary} · {recurringCreationCountSummary}
                                </p>
                              </div>
                            </>
                          ) : (
                            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="block">
                                <span className="text-[12px] font-medium text-p-text-muted">Hora de inicio</span>
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
                              </div>
                              <div className="block">
                                <span className="text-[12px] font-medium text-p-text-muted">Hora de fin</span>
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
                              </div>
                              {timeFieldError && (
                                <div className="md:col-span-2">
                                  <p className="text-[12px] font-medium text-p-error">{timeFieldError}</p>
                                </div>
                              )}
                              <div className="block">
                                <span className="text-[12px] font-medium text-p-text-muted">Cancha</span>
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
                                  <p className="mt-1 text-[12px] font-medium text-p-error">{courtFieldError}</p>
                                )}
                              </div>
                            </div>
                          )}

                          {simplifiedIsEditingReservation && (
                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
                              <div>
                                <p className="text-[12px] font-medium text-p-text-muted">Tipo de pago</p>
                                <div className="mt-1 grid grid-cols-2 rounded-xl border border-p-border bg-p-surface-2 p-1">
                                  <button
                                    type="button"
                                    onClick={() => handleBillingModeChange('INDIVIDUAL')}
                                    disabled={isBillingModeSwitchLocked || isBillingConfigLockedByPayments}
                                    className={`h-11 rounded-lg text-[15px] font-semibold transition ${
                                      paymentMode === 'Único'
                                        ? 'bg-ink-900 text-ink-50'
                                        : 'text-p-text-muted hover:bg-p-surface-2'
                                    } disabled:opacity-55`}
                                  >
                                    Pago único
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleBillingModeChange('SHARED')}
                                    disabled={isBillingModeSwitchLocked || isBillingConfigLockedByPayments}
                                    className={`h-11 rounded-lg text-[15px] font-semibold transition ${
                                      paymentMode === 'Dividido'
                                        ? 'bg-ink-900 text-ink-50'
                                        : 'text-p-text-muted hover:bg-p-surface-2'
                                    } disabled:opacity-55`}
                                  >
                                    Pago dividido
                                  </button>
                                </div>
                              </div>
                              <div>
                                <p className="text-[12px] font-medium text-p-text-muted">
                                  {paymentMode === 'Único' ? 'Precio' : 'Precio por persona'}
                                </p>
                                <div className="mt-1 h-12 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between">
                                  <input
                                    type="number"
                                    readOnly
                                    value={isFinancialDisplayPending
                                      ? ''
                                      : paymentMode === 'Único'
                                        ? Number(totalPrice.toFixed(2))
                                        : Number((totalPrice / Math.max(chargedParticipantsCount, 1)).toFixed(2))}
                                    className="w-full bg-transparent text-[18px] font-semibold text-p-text outline-none"
                                  />
                                  <span className="ml-2 text-[18px] font-semibold text-p-text-muted">$</span>
                                </div>
                                {paymentFieldError && (
                                  <p className="mt-1 text-[12px] font-medium text-p-error">{paymentFieldError}</p>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      ))}

                      {showSimplifiedConsumptionsSection && (
                        <section className="rounded-xl border border-p-border bg-p-surface-2 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[18px] font-semibold text-p-text">Consumos</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] text-p-text-muted">Total consumos</p>
                              <p className="text-[18px] font-semibold text-p-text">
                                {bookingItemsAmount.toFixed(2)} $
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px] text-p-text-muted">
                            <div className="rounded-lg border border-p-border bg-p-surface px-2 py-1.5">
                              <p>Items</p>
                              <p className="text-[15px] font-semibold text-p-text">
                                {bookingConsumptionItems.length}
                              </p>
                            </div>
                            <div className="rounded-lg border border-p-border bg-p-surface px-2 py-1.5">
                              <p>Pagado</p>
                              <p className="text-[15px] font-semibold text-p-positive">
                                {bookingConsumptionsPaid.toFixed(2)} $
                              </p>
                            </div>
                            <div className="rounded-lg border border-p-border bg-p-surface px-2 py-1.5">
                              <p>Pendiente</p>
                              <p className="text-[15px] font-semibold text-p-warning">
                                {bookingConsumptionsRemaining.toFixed(2)} $
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 rounded-xl border border-p-border bg-p-surface p-3">
                            <p className="text-[13px] font-semibold text-p-text">Agregar consumo</p>
                            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_112px_auto]">
                              <div>
                                <span className="text-[12px] font-medium text-p-text-muted">Producto</span>
                                <PlaygroundCombo
                                  value={consumptionProductDraft}
                                  onChange={(value) => {
                                    setConsumptionProductDraft(String(value || ''));
                                    setBookingConsumptionError('');
                                  }}
                                  options={consumptionProductOptions}
                                  variant="participant"
                                  className="mt-1"
                                />
                              </div>
                              <label className="block">
                                <span className="text-[12px] font-medium text-p-text-muted">Cantidad</span>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={consumptionQuantityDraft}
                                  onChange={(event) => {
                                    setConsumptionQuantityDraft(event.target.value);
                                    setBookingConsumptionError('');
                                  }}
                                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none"
                                />
                              </label>
                              <div className="flex items-end">
                                <button
                                  type="button"
                                  onClick={() => void handleAddConsumption()}
                                  disabled={!canAddConsumption}
                                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                                >
                                  <Plus size={13} />
                                  {consumptionAddInFlight ? 'Agregando...' : 'Agregar'}
                                </button>
                              </div>
                            </div>

                            <label className="mt-2 inline-flex items-center gap-2 text-[12px] text-p-text-secondary">
                              <input
                                type="checkbox"
                                checked={consumptionApplyDiscountDraft}
                                onChange={(event) => setConsumptionApplyDiscountDraft(event.target.checked)}
                                className="h-4 w-4 accent-p-brand"
                              />
                              Aplicar descuentos automáticos del cliente
                            </label>

                            <div className="mt-2 min-h-[20px]">
                              {consumptionProductsLoading ? (
                                <p className="text-[12px] text-p-text-muted">Cargando productos...</p>
                              ) : consumptionProductsError ? (
                                <p className="text-[12px] text-p-error">{consumptionProductsError}</p>
                              ) : consumptionQuoteLoading ? (
                                <p className="text-[12px] text-p-text-muted">Cotizando...</p>
                              ) : consumptionQuoteError ? (
                                <p className="text-[12px] text-p-error">{consumptionQuoteError}</p>
                              ) : consumptionQuote ? (
                                <p className="text-[12px] text-p-text-secondary">
                                  Lista {consumptionQuote.listTotal.toFixed(2)} $ · Final {consumptionQuote.finalTotal.toFixed(2)} $
                                  {consumptionQuote.hasDiscount && consumptionQuote.discountAmount > 0.009
                                    ? ` · Descuento ${consumptionQuote.discountAmount.toFixed(2)} $`
                                    : ''}
                                </p>
                              ) : selectedConsumptionProduct ? (
                                <p className="text-[12px] text-p-text-secondary">
                                  Subtotal estimado:{' '}
                                  {roundMoney(selectedConsumptionProduct.price * selectedConsumptionQuantity).toFixed(2)} $
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {bookingConsumptionError && (
                            <p className="mt-3 text-[12px] font-medium text-p-error">{bookingConsumptionError}</p>
                          )}

                          <div className="mt-4 rounded-xl border border-p-border bg-p-surface">
                            <div className="border-b border-p-border px-3 py-2">
                              <p className="text-[13px] font-semibold text-p-text">Consumos cargados</p>
                            </div>
                            {bookingConsumptionLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <div className="h-5 w-5 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                              </div>
                            ) : bookingConsumptionItems.length === 0 ? (
                              <p className="px-3 py-4 text-[12px] text-p-text-muted">Todavía no hay consumos cargados.</p>
                            ) : (
                              <div className="divide-y divide-p-border">
                                {bookingConsumptionItems.map((item) => (
                                  <div
                                    key={`booking-consumption-${item.id}`}
                                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2.5"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-[14px] font-semibold text-p-text">{item.description}</p>
                                      <p className="text-[12px] text-p-text-muted">
                                        {item.quantity} x {item.unitPrice.toFixed(2)} $ · Total {item.totalPrice.toFixed(2)} $
                                      </p>
                                    </div>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                        item.remainingAmount <= 0.009
                                          ? 'bg-p-positive-bg text-p-positive'
                                          : item.paidAmount > 0.009
                                            ? 'bg-p-warning-bg text-p-warning'
                                            : 'bg-p-surface-3 text-p-text-secondary'
                                      }`}
                                    >
                                      {item.remainingAmount <= 0.009
                                        ? 'Pagado'
                                        : item.paidAmount > 0.009
                                          ? 'Parcial'
                                          : 'Pendiente'}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveConsumption(item.id)}
                                      disabled={consumptionRemovingId === item.id || item.paidAmount > 0.009}
                                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-error px-2 text-[12px] font-semibold text-p-error hover:bg-p-error-bg disabled:opacity-45"
                                    >
                                      <X size={12} />
                                      {consumptionRemovingId === item.id ? '...' : 'Quitar'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {showSimplifiedHistorySection && (
                      <section
                        className={`rounded-xl border border-p-border bg-p-surface-2 p-4 ${
                          showSimplifiedDetailsSection ? 'mt-2' : 'mt-0'
                        }`}
                      >
                          <p className="text-[18px] font-semibold text-p-text">Historial de la reserva</p>

                          {bookingTimelineLoading && simplifiedReservationHistoryTimeline.length > 0 && (
                            <p className="mt-3 text-[12px] text-p-text-muted">Actualizando historial...</p>
                          )}
                          {bookingTimelineError && (
                            <p className="mt-3 text-[13px] text-p-error">{bookingTimelineError}</p>
                          )}

                          {bookingTimelineLoading && simplifiedReservationHistoryTimeline.length === 0 ? (
                            <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-p-border bg-p-surface px-4 py-5">
                              <div className="h-5 w-5 rounded-full border-2 border-p-accent border-t-p-accent animate-spin" />
                              <p className="text-[13px] text-p-text-secondary">Cargando historial de la reserva...</p>
                            </div>
                          ) : simplifiedReservationHistoryTimeline.length === 0 ? (
                            <p className="mt-3 text-[13px] text-p-text-muted">Todavía no hay eventos en el historial.</p>
                          ) : (
                            <div className="mt-3 space-y-4">
                              {simplifiedReservationHistoryTimeline.map((group) => (
                                <div key={`history-group-${group.dateKey}`}>
                                  <div className="inline-flex rounded-full border border-p-border bg-p-surface px-3 py-1 text-[11px] font-semibold text-p-text-secondary">
                                    {group.dateLabel}
                                  </div>
                                  <div className="mt-2 rounded-xl border border-p-border bg-p-surface px-3 py-2 space-y-0">
                                    {group.events.map((event, index) => (
                                      <div
                                        key={`history-event-${event.id}`}
                                        className="grid grid-cols-[18px_1fr_auto] gap-2"
                                      >
                                        <div className="relative pt-1">
                                          <span className="absolute left-[4px] top-1.5 h-2.5 w-2.5 rounded-full bg-p-accent" />
                                          {index < group.events.length - 1 && (
                                            <span className="absolute left-[8px] top-4 bottom-[-12px] w-px bg-p-positive-bg" />
                                          )}
                                        </div>
                                        <div className="pb-3">
                                          <p className="text-[14px] font-semibold leading-[1.3] text-p-text">
                                            {event.title}
                                          </p>
                                          <p className="mt-0.5 text-[12px] text-p-text-muted">{event.detail}</p>
                                        </div>
                                        <p className="pt-0.5 text-[12px] font-semibold text-p-text-secondary">
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
                      {simplifiedIsEditingReservation && (
                        <section className="rounded-xl border border-p-border bg-p-surface-2 p-4">
                          <div className="flex items-center justify-between">
                            <p className="text-[18px] font-semibold text-p-text">Cobro</p>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                simplifiedPaymentStatusLabel === 'Pagado'
                                  ? 'bg-p-positive-bg text-p-positive'
                                  : simplifiedPaymentStatusLabel === 'Parcial'
                                    ? 'bg-p-warning-bg text-p-warning'
                                    : 'bg-p-surface-3 text-p-text-secondary'
                              }`}
                            >
                              {simplifiedPaymentStatusLabel}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-p-text-muted">
                            <div className="rounded-lg bg-p-surface px-2 py-1.5">
                              <p>Total</p>
                              <p className="text-[15px] font-semibold text-p-text">
                                {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                              </p>
                            </div>
                            <div className="rounded-lg bg-p-surface px-2 py-1.5">
                              <p>Pagado</p>
                              <p className="text-[15px] font-semibold text-p-positive">
                                {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                              </p>
                            </div>
                            <div className="rounded-lg bg-p-surface px-2 py-1.5">
                              <p>Deuda</p>
                              <p className="text-[15px] font-semibold text-p-warning">
                                {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-[12px] text-p-text-muted">
                            Cancha: {bookingCourtAmount.toFixed(2)} $ · Consumos: {bookingItemsAmount.toFixed(2)} $
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={openSimplifiedPaymentModal}
                              disabled={!simplifiedCanRegisterPayment}
                              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-4 text-[14px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                            >
                              <CreditCard size={14} />
                              Registrar pago
                            </button>
                            {!persistedEditingBookingId ? (
                              <p className="text-[12px] text-p-text-muted">Primero creá la reserva.</p>
                            ) : billingConfigLoadError ? (
                              <p className="text-[12px] text-p-error">{billingConfigLoadError}</p>
                            ) : isPaymentLockedByManualPending ? (
                              <p className="text-[12px] text-p-text-muted">Confirmá la reserva para habilitar pagos.</p>
                            ) : null}
                          </div>
                        </section>
                      )}

                      <section className="mt-4">
                        <div className="rounded-xl border border-p-border bg-p-surface-2 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[18px] font-semibold text-p-text">Participantes</p>
                            {simplifiedOwnerAdded && !simplifiedNewParticipantOpen && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSimplifiedNewParticipantOpen(true);
                                  setSimplifiedNewParticipantName('');
                                  setSimplifiedNewParticipantContact('');
                                  setSimplifiedNewParticipantSourceTypeDraft('guest');
                                  setSimplifiedNewParticipantEntityRefDraft('');
                                  setSimplifiedNewParticipantSuggestionsOpen(false);
                                  setSimplifiedNewParticipantSearchLoading(false);
                                  setSimplifiedNewParticipantSuggestions([]);
                                  setFormError('');
                                }}
                                className="text-[14px] font-semibold text-p-accent hover:text-p-accent"
                              >
                                + Nuevo participante
                              </button>
                            )}
                          </div>
                          {participantsFieldError && (
                            <p className="mt-2 mb-3 text-[12px] font-medium text-p-error">{participantsFieldError}</p>
                          )}
                          {simplifiedOwnerAdded && simplifiedNamedParticipants.length > 0 ? (
                            <div className="mt-3 space-y-3">
                              {simplifiedNamedParticipants.map((participant, index) => {
                                const normalizedParticipantRef = String(participant.entityRef || '').trim().toLowerCase();
                                const participantIsLinkedRecord =
                                  participant.sourceType !== 'guest' ||
                                  normalizedParticipantRef.startsWith('client:') ||
                                  normalizedParticipantRef.startsWith('user:');
                                const participantHasPaymentControls = simplifiedParticipantWithPaymentControlsIdSet.has(participant.id);
                                const participantPaidComputed = participantPaidComputedIdSet.has(participant.id);
                                const participantAssignedAmount = Number(participantAssignedAmountById.get(participant.id) || 0);
                                const participantCoveredAmount = Number(participantCoverageAmountById.get(participant.id) || 0);
                                const participantPayerAmount = Number(participantPayerAmountById.get(participant.id) || 0);
                                const participantDebtAmount = Number(participantDebtAmountById.get(participant.id) || 0);
                                const participantHasPayerActivity =
                                  paymentMode === 'Único' &&
                                  !participantHasPaymentControls &&
                                  participantPayerAmount > 0.009;
                                const participantPaymentStatusLabel =
                                  participantPaidComputed
                                    ? 'Pagado'
                                    : participantCoveredAmount > 0.009 && participantDebtAmount > 0.009
                                      ? 'Parcial'
                                      : 'Pendiente';
                                const participantPaymentStatusTone =
                                  participantPaymentStatusLabel === 'Pagado'
                                    ? 'bg-p-positive-bg text-p-positive'
                                    : participantPaymentStatusLabel === 'Parcial'
                                      ? 'bg-p-warning-bg text-p-warning'
                                      : 'bg-p-surface-3 text-p-text-secondary';
                                const participantDisplayedPrice = Number(
                                  (participantHasPaymentControls ? participantAssignedAmount : participantPayerAmount).toFixed(2)
                                );
                                const shouldShowParticipantAmount = participantHasPaymentControls;
                                return (
                                  <div
                                    key={`simplified-participant-${participant.id}`}
                                    data-participant-shell-id={participant.id}
                                    className="rounded-xl border border-p-border bg-p-surface px-3 py-3"
                                  >
                                    <div className={`grid ${shouldShowParticipantAmount ? 'grid-cols-[42px_minmax(0,1fr)_auto_32px]' : 'grid-cols-[42px_minmax(0,1fr)_32px]'} gap-2 items-start`}>
                                      <div className="h-10 w-10 rounded-full bg-p-surface-2 text-p-text-secondary text-[14px] font-semibold grid place-items-center">
                                        {participant.name.trim().charAt(0).toUpperCase() || 'P'}
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="inline-flex items-center rounded-full bg-p-positive-bg px-2.5 py-1 text-[11px] font-semibold text-p-accent">
                                            {participant.isOwner ? 'Titular' : `Participante ${index + 1}`}
                                          </span>
                                          <span
                                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                              participant.sourceType === 'guest'
                                                ? 'bg-p-surface-2 text-p-text-secondary'
                                                : 'bg-p-positive-bg text-p-positive'
                                            }`}
                                          >
                                            {participant.sourceType === 'guest' ? 'Invitado' : 'Vinculado'}
                                          </span>
                                          {participantHasPaymentControls && (
                                            <span
                                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${participantPaymentStatusTone}`}
                                            >
                                              {participantPaymentStatusLabel}
                                            </span>
                                          )}
                                          {participantHasPayerActivity && (
                                            <span className="inline-flex items-center rounded-full bg-p-positive-bg px-2.5 py-1 text-[11px] font-semibold text-p-accent">
                                              Pagador
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[15px] font-semibold text-p-text">{participant.name}</p>
                                        {participantHasPayerActivity && (
                                          <p className="mt-0.5 text-[12px] text-p-text-secondary">
                                            Pagó {participantPayerAmount.toFixed(2)} $
                                          </p>
                                        )}
                                      </div>
                                      {shouldShowParticipantAmount && (
                                        <div className="pt-0.5 text-right">
                                          <p className="text-[15px] font-semibold text-p-text">
                                            {participantDisplayedPrice} $
                                          </p>
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (expandedParticipantId === participant.id) {
                                            setExpandedParticipantId(null);
                                            return;
                                          }
                                          setParticipantMenuId((previous) =>
                                            previous === participant.id ? null : participant.id
                                          );
                                        }}
                                        className="h-8 w-8 justify-self-end rounded-full text-p-text-muted grid place-items-center hover:bg-p-surface-2"
                                        title="Acciones del participante"
                                      >
                                        <MoreVertical size={15} />
                                      </button>
                                    </div>
                                    {expandedParticipantId === participant.id && (
                                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                                        {participantIsLinkedRecord ? (
                                          <div className="md:col-span-2 rounded-xl border border-p-border bg-p-surface-2 px-3 py-2">
                                            <p className="text-[12px] text-p-text-secondary">
                                              Este participante está vinculado a un registro existente y no se puede editar manualmente.
                                            </p>
                                          </div>
                                        ) : (
                                          <>
                                            {(() => {
                                              const participantPhoneDraft = extractPhoneFromParticipantContact(participant.contact);
                                              const participantEmailDraft = extractEmailFromParticipantContact(participant.contact);
                                              return (
                                                <>
                                            <label className="block">
                                              <span className="text-[12px] font-medium text-p-text-muted">Nombre</span>
                                              <div className="mt-1 h-10 rounded-xl border border-p-border bg-p-surface px-3 flex items-center">
                                                <input
                                                  value={participant.name}
                                                  onChange={(event) =>
                                                    updateParticipant(participant.id, { name: event.target.value })
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === 'Escape') {
                                                      event.preventDefault();
                                                      setExpandedParticipantId((previous) =>
                                                        previous === participant.id ? null : previous
                                                      );
                                                    }
                                                  }}
                                                  placeholder="Nombre del participante"
                                                  className="w-full bg-transparent outline-none text-[13px] text-p-text"
                                                />
                                              </div>
                                            </label>
                                            <label className="block">
                                              <span className="text-[12px] font-medium text-p-text-muted">Teléfono</span>
                                              <div className="mt-1 h-10 rounded-xl border border-p-border bg-p-surface px-3 flex items-center">
                                                <input
                                                  ref={participantContactInputRef}
                                                  value={participantPhoneDraft}
                                                  onChange={(event) =>
                                                    updateParticipant(participant.id, {
                                                      contact: buildParticipantContactFromFields(
                                                        event.target.value,
                                                        participantEmailDraft
                                                      ),
                                                    })
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === 'Escape') {
                                                      event.preventDefault();
                                                      setExpandedParticipantId((previous) =>
                                                        previous === participant.id ? null : previous
                                                      );
                                                    }
                                                  }}
                                                  placeholder="3511234567"
                                                  className="w-full bg-transparent outline-none text-[13px] text-p-text"
                                                />
                                              </div>
                                            </label>
                                            <label className="block md:col-span-2">
                                              <span className="text-[12px] font-medium text-p-text-muted">Email <span className="font-normal text-p-text-muted opacity-60">(opcional)</span></span>
                                              <div className="mt-1 h-10 rounded-xl border border-p-border bg-p-surface px-3 flex items-center">
                                                <input
                                                  type="email"
                                                  value={participantEmailDraft}
                                                  onChange={(event) =>
                                                    updateParticipant(participant.id, {
                                                      contact: buildParticipantContactFromFields(
                                                        participantPhoneDraft,
                                                        event.target.value
                                                      ),
                                                    })
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === 'Escape') {
                                                      event.preventDefault();
                                                      setExpandedParticipantId((previous) =>
                                                        previous === participant.id ? null : previous
                                                      );
                                                    }
                                                  }}
                                                  placeholder="cliente@email.com"
                                                  className="w-full bg-transparent outline-none text-[13px] text-p-text"
                                                />
                                              </div>
                                            </label>
                                                </>
                                              );
                                            })()}
                                          </>
                                        )}
                                        <div className="md:col-span-2 flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => setExpandedParticipantId(null)}
                                            className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setExpandedParticipantId(null)}
                                            className="h-8 rounded-lg bg-[var(--accent-fg)] px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900"
                                          >
                                            Guardar
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {participantMenuId === participant.id && (
                                      <div className="mt-2 rounded-xl border border-p-border bg-p-surface shadow-sm p-2 text-[12px] text-p-text-secondary">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (participantIsLinkedRecord) {
                                              setParticipantMenuId(null);
                                              return;
                                            }
                                            setExpandedParticipantId((previous) =>
                                              previous === participant.id ? null : participant.id
                                            );
                                            setParticipantMenuId(null);
                                          }}
                                          className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2 disabled:opacity-50 disabled:hover:bg-transparent"
                                          disabled={participantIsLinkedRecord}
                                        >
                                          {participantIsLinkedRecord
                                            ? 'Participante vinculado (sin edición manual)'
                                            : expandedParticipantId === participant.id
                                            ? 'Finalizar edición'
                                            : 'Editar participante (nombre/contacto)'}
                                        </button>
                                        <div className="mt-1 border-t border-p-border pt-1">
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
                                            className="w-full text-left rounded-lg px-2 py-1.5 text-p-error hover:bg-p-error-bg disabled:opacity-40"
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
                          ) : (
                            <>
                              <p className="mt-3 text-[15px] font-semibold text-p-text">Agregar titular</p>
                              <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] font-medium text-p-text-muted">
                                <span>Nombre del cliente</span>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-3">
                                <div ref={simplifiedOwnerInputContainerRef} className="relative">
                                <div className="h-12 rounded-xl border border-p-border bg-p-surface px-3 flex items-center gap-2">
                                  <input
                                    value={ownerParticipant?.name || ''}
                                    onChange={(event) => {
                                      if (!ownerParticipant) return;
                                      void runSimplifiedOwnerSearch(ownerParticipant.id, event.target.value);
                                    }}
                                    onFocus={() => {
                                      if ((ownerParticipant?.name || '').trim().length > 0) {
                                        setSimplifiedOwnerSuggestionsOpen(true);
                                      }
                                    }}
                                    onBlur={() => {
                                      window.setTimeout(() => setSimplifiedOwnerSuggestionsOpen(false), 120);
                                    }}
                                    placeholder="Ingresá un nombre"
                                    className="w-full bg-transparent text-[15px] text-p-text outline-none"
                                  />
                                  {ownerHasTypedName ? (
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
                                        setSimplifiedOwnerSuggestionsOpen(false);
                                        setSimplifiedOwnerSearchLoading(false);
                                        setSimplifiedOwnerSuggestions([]);
                                        setSimplifiedNewParticipantOpen(false);
                                        setSimplifiedNewParticipantName('');
                                        setSimplifiedNewParticipantContact('');
                                        setSimplifiedNewParticipantSourceTypeDraft('guest');
                                        setSimplifiedNewParticipantEntityRefDraft('');
                                        setSimplifiedNewParticipantSuggestionsOpen(false);
                                        setSimplifiedNewParticipantSearchLoading(false);
                                        setSimplifiedNewParticipantSuggestions([]);
                                      }}
                                      className="h-7 w-7 rounded-full text-p-text-muted grid place-items-center hover:bg-p-surface-2"
                                      title="Limpiar titular"
                                    >
                                      <X size={14} />
                                    </button>
                                  ) : (
                                    <Search size={18} className="text-p-text-muted" />
                                  )}
                                </div>
                                {simplifiedOwnerSuggestionsOpen &&
                                  simplifiedOwnerSuggestionsFloatingStyle &&
                                  createPortal(
                                  <div
                                    style={{
                                      ...simplifiedOwnerSuggestionsFloatingStyle,
                                      maxHeight: undefined,
                                    }}
                                    className="rounded-xl border border-p-border bg-p-surface shadow-lg overflow-hidden"
                                  >
                                    <div
                                      style={{ maxHeight: simplifiedOwnerSuggestionsFloatingStyle.maxHeight }}
                                      className="overflow-y-auto overscroll-contain p-1"
                                    >
                                      {simplifiedOwnerSearchLoading && (
                                        <p className="px-2 py-1 text-[11px] text-p-text-muted">Buscando...</p>
                                      )}
                                      {simplifiedOwnerSuggestions.slice(0, 8).map((suggestion) => (
                                        <button
                                          key={`owner-suggestion-${suggestion.id}`}
                                          type="button"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => {
                                            if (!ownerParticipant) return;
                                            applySimplifiedOwnerSuggestion(ownerParticipant.id, suggestion);
                                          }}
                                          className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2"
                                        >
                                          <span className="block text-[12px] font-semibold text-p-text">{suggestion.label}</span>
                                          {suggestion.secondary && (
                                            <span className="block text-[11px] text-p-text-muted">{suggestion.secondary}</span>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  </div>,
                                  document.body
                                )}
                                </div>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <label className="block">
                                    <span className="text-[12px] font-medium text-p-text-muted">Teléfono</span>
                                    <input
                                      value={ownerContactPhoneDraft}
                                      onChange={(event) => {
                                        if (!ownerParticipant || ownerHasLinkedSelection) return;
                                        updateParticipant(ownerParticipant.id, {
                                          contact: buildParticipantContactFromFields(
                                            event.target.value,
                                            ownerContactEmailDraft
                                          ),
                                        });
                                      }}
                                      readOnly={ownerHasLinkedSelection}
                                      placeholder="3511234567"
                                      className={`mt-1 h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                        ownerHasLinkedSelection
                                          ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                          : 'border-p-border bg-p-surface'
                                      }`}
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-[12px] font-medium text-p-text-muted">Email <span className="font-normal text-p-text-muted opacity-60">(opcional)</span></span>
                                    <input
                                      type="email"
                                      value={ownerContactEmailDraft}
                                      onChange={(event) => {
                                        if (!ownerParticipant || ownerHasLinkedSelection) return;
                                        updateParticipant(ownerParticipant.id, {
                                          contact: buildParticipantContactFromFields(
                                            ownerContactPhoneDraft,
                                            event.target.value
                                          ),
                                        });
                                      }}
                                      readOnly={ownerHasLinkedSelection}
                                      placeholder="cliente@email.com"
                                      className={`mt-1 h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                        ownerHasLinkedSelection
                                          ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                          : 'border-p-border bg-p-surface'
                                      }`}
                                    />
                                  </label>
                                </div>
                                {!ownerHasLinkedSelection && ownerHasTypedName && ownerContactPhoneDraft.length === 0 && (
                                  <p className="text-[12px] text-p-text-muted">
                                    Para crear un cliente nuevo, cargá el teléfono antes de continuar.
                                  </p>
                                )}
                              </div>
                              {ownerFieldError && (
                                <p className="mt-2 text-[12px] font-medium text-p-error">{ownerFieldError}</p>
                              )}

                              <div className="mt-4 rounded-xl border border-p-border bg-p-surface px-4 py-3 flex items-center justify-between">
                                <p className="text-[12px] text-p-text-muted">
                                  Precio total:{' '}
                                  <strong className="ml-1 text-[15px] font-semibold text-p-text">
                                    {isFinancialDisplayPending ? '--' : `${Number(totalPrice.toFixed(2))} $`}
                                  </strong>
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    showCalendarNotice(
                                      'Este total es estimado para crear la reserva. El registro de pagos se habilita al editar la reserva creada.'
                                    )
                                  }
                                  className="grid h-7 w-7 place-items-center rounded-full text-p-text-muted transition hover:bg-p-surface-2"
                                  aria-label="Información del precio total"
                                  title="Cómo se usa el precio total"
                                >
                                  <CircleAlert size={16} />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  if (!ownerHasName) return;
                                  setSimplifiedOwnerAdded(true);
                                  setSimplifiedEditingParticipantId(null);
                                  setSimplifiedEditPaymentMethodDraft('');
                                  setSimplifiedOwnerSuggestionsOpen(false);
                                  setSimplifiedOwnerSearchLoading(false);
                                  setSimplifiedOwnerSuggestions([]);
                                  setSimplifiedNewParticipantOpen(false);
                                  setSimplifiedNewParticipantName('');
                                  setSimplifiedNewParticipantContact('');
                                  setSimplifiedNewParticipantSourceTypeDraft('guest');
                                  setSimplifiedNewParticipantEntityRefDraft('');
                                  setSimplifiedNewParticipantSuggestionsOpen(false);
                                  setSimplifiedNewParticipantSearchLoading(false);
                                  setSimplifiedNewParticipantSuggestions([]);
                                  setFormError('');
                                }}
                                disabled={!ownerCanBeAdded}
                                className={`mt-5 h-11 w-full rounded-xl text-[14px] leading-none font-semibold transition ${
                                  ownerCanBeAdded
                                    ? 'bg-ink-900 text-ink-50 hover:bg-ink-900'
                                    : 'border border-p-border bg-p-surface-3 text-p-text-muted'
                                }`}
                              >
                                Agregar titular
                              </button>
                            </>
                          )}

                          {simplifiedOwnerAdded && (
                            <div
                              className={`border-t border-p-border ${
                                simplifiedNewParticipantOpen ? 'mt-2 pt-2' : 'mt-3 pt-3'
                              }`}
                            >
                              {simplifiedNewParticipantOpen && (
                                <div className="mt-1 rounded-xl border border-p-border bg-p-surface p-4">
                                  <p className="text-[15px] font-semibold text-p-text">Nuevo participante</p>
                                  <div className="mt-3 space-y-2">
                                    <div ref={simplifiedNewParticipantInputContainerRef} className="relative">
                                      <input
                                        value={simplifiedNewParticipantName}
                                        onChange={(event) => {
                                          if (simplifiedNewParticipantHasLinkedSelection) return;
                                          void runSimplifiedNewParticipantSearch(event.target.value);
                                        }}
                                        onFocus={() => {
                                          if (simplifiedNewParticipantHasLinkedSelection) return;
                                          if (simplifiedNewParticipantName.trim().length > 0) {
                                            setSimplifiedNewParticipantSuggestionsOpen(true);
                                          }
                                        }}
                                        onBlur={() => {
                                          window.setTimeout(() => setSimplifiedNewParticipantSuggestionsOpen(false), 120);
                                        }}
                                        readOnly={simplifiedNewParticipantHasLinkedSelection}
                                        placeholder="Nombre del participante"
                                        className={`h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                          simplifiedNewParticipantHasLinkedSelection
                                            ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                            : 'border-p-border bg-p-surface'
                                        }`}
                                      />
                                      {simplifiedNewParticipantSuggestionsOpen &&
                                        simplifiedNewParticipantSuggestionsFloatingStyle &&
                                        createPortal(
                                        <div
                                          style={{
                                            ...simplifiedNewParticipantSuggestionsFloatingStyle,
                                            maxHeight: undefined,
                                          }}
                                          className="rounded-xl border border-p-border bg-p-surface shadow-lg overflow-hidden"
                                        >
                                          <div
                                            style={{ maxHeight: simplifiedNewParticipantSuggestionsFloatingStyle.maxHeight }}
                                            className="overflow-y-auto overscroll-contain p-1"
                                          >
                                            {simplifiedNewParticipantSearchLoading && (
                                              <p className="px-2 py-1 text-[11px] text-p-text-muted">Buscando...</p>
                                            )}
                                            {simplifiedNewParticipantSuggestions.slice(0, 8).map((suggestion) => (
                                              <button
                                                key={`new-suggestion-${suggestion.id}`}
                                                type="button"
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => applySimplifiedNewParticipantSuggestion(suggestion)}
                                                className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2"
                                              >
                                                <span className="block text-[12px] font-semibold text-p-text">{suggestion.label}</span>
                                                {suggestion.secondary && (
                                                  <span className="block text-[11px] text-p-text-muted">{suggestion.secondary}</span>
                                                )}
                                              </button>
                                            ))}
                                          </div>
                                        </div>,
                                        document.body
                                      )}
                                    </div>
                                    <input
                                      value={simplifiedNewParticipantContact}
                                      onChange={(event) => {
                                        if (simplifiedNewParticipantHasLinkedSelection) return;
                                        setSimplifiedNewParticipantContact(event.target.value);
                                      }}
                                      readOnly={simplifiedNewParticipantHasLinkedSelection}
                                      placeholder="Contacto (correo o teléfono)"
                                      className={`h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                        simplifiedNewParticipantHasLinkedSelection
                                          ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                          : 'border-p-border bg-p-surface'
                                      }`}
                                    />
                                  </div>
                                  {simplifiedNewParticipantHasLinkedSelection && (
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                      <p className="text-[12px] text-p-text-muted">
                                        Registro asociado seleccionado. No se puede editar manualmente.
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSimplifiedNewParticipantName('');
                                          setSimplifiedNewParticipantContact('');
                                          setSimplifiedNewParticipantSourceTypeDraft('guest');
                                          setSimplifiedNewParticipantEntityRefDraft('');
                                          setSimplifiedNewParticipantSuggestionsOpen(false);
                                          setSimplifiedNewParticipantSearchLoading(false);
                                          setSimplifiedNewParticipantSuggestions([]);
                                        }}
                                        className="shrink-0 text-[12px] font-semibold text-p-accent hover:text-[var(--accent-hover)]"
                                      >
                                        Cambiar selección
                                      </button>
                                    </div>
                                  )}
                                  {simplifiedNewParticipantName.trim().length > 0 && !hasValidSimplifiedNewParticipantName && (
                                    <p className="mt-2 text-[12px] text-p-text-muted">
                                      Seleccioná un registro de la lista (o Invitado) antes de agregar.
                                    </p>
                                  )}
                                  <div className="mt-3 flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!hasValidSimplifiedNewParticipantName) return;
                                        const normalizedEntityRef = simplifiedNewParticipantEntityRefDraft.trim();
                                        const duplicateLinked = participants.some(
                                          (participant) =>
                                            String(participant.entityRef || '').trim() === normalizedEntityRef
                                        );
                                        if (normalizedEntityRef && duplicateLinked) {
                                          setFormError('Ese participante ya está agregado en esta reserva.');
                                          return;
                                        }
                                        setParticipants((previous) => [
                                          ...previous,
                                          {
                                            id: `player-${Date.now()}`,
                                            name: simplifiedNewParticipantName.trim(),
                                            contact: simplifiedNewParticipantContact.trim(),
                                            paid: false,
                                            isOwner: false,
                                            sourceType: simplifiedNewParticipantSourceTypeDraft,
                                            paymentMethod: 'CASH',
                                            entityRef: simplifiedNewParticipantEntityRefDraft,
                                            customPrice: null,
                                          },
                                        ]);
                                        setSimplifiedNewParticipantOpen(false);
                                        setSimplifiedNewParticipantName('');
                                        setSimplifiedNewParticipantContact('');
                                        setSimplifiedNewParticipantSourceTypeDraft('guest');
                                        setSimplifiedNewParticipantEntityRefDraft('');
                                        setSimplifiedNewParticipantSuggestionsOpen(false);
                                        setSimplifiedNewParticipantSearchLoading(false);
                                        setSimplifiedNewParticipantSuggestions([]);
                                        setFormError('');
                                      }}
                                      disabled={!hasValidSimplifiedNewParticipantName}
                                      className={`h-10 min-w-[100px] rounded-xl px-4 text-[14px] font-semibold ${
                                        hasValidSimplifiedNewParticipantName
                                          ? 'bg-ink-900 text-ink-50 hover:bg-ink-900'
                                          : 'bg-p-surface-3 text-p-text-muted'
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
                                        setSimplifiedNewParticipantSourceTypeDraft('guest');
                                        setSimplifiedNewParticipantEntityRefDraft('');
                                        setSimplifiedNewParticipantSuggestionsOpen(false);
                                        setSimplifiedNewParticipantSearchLoading(false);
                                        setSimplifiedNewParticipantSuggestions([]);
                                      }}
                                      className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[14px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </section>

                      </>
                      )}

                    </section>
                  ) : (
                    <>
                  <section className="mb-6 rounded-xl border border-p-border bg-p-surface-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-semibold text-p-text">Checklist operativo</p>
                      <span className="text-[11px] text-p-text-muted">
                        {operationalChecklist.filter((row) => row.ok).length}/{operationalChecklist.length}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {operationalChecklist.map((row) => (
                        <div key={row.key} className="rounded-lg border border-p-border bg-p-surface px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] text-p-text">{row.label}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                row.ok ? 'bg-p-positive-bg text-p-positive' : 'bg-p-error-bg text-p-error'
                              }`}
                            >
                              {row.ok ? 'OK' : 'Revisar'}
                            </span>
                          </div>
                          {!row.ok && row.detail && (
                            <p className="mt-1 text-[11px] text-p-error">{row.detail}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="mb-6 rounded-xl border border-p-border bg-p-surface px-4 py-3">
                    <p className="text-[14px] font-semibold text-p-text">Resumen rápido</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Tipo</p>
                        <p className="text-[12px] font-semibold text-p-text">{selectedBookingKindLabel}</p>
                      </div>
                      <div className="rounded-lg bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Fecha</p>
                        <p className="text-[12px] font-semibold text-p-text">{quickSummaryDateLabel}</p>
                      </div>
                      <div className="rounded-lg bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">Horario</p>
                        <p className="text-[12px] font-semibold text-p-text">
                          {slotToTime(selectedStartSlot)} - {slotToTime(selectedEndSlot)} ({selectionMinutes} min)
                        </p>
                      </div>
                      <div className="rounded-lg bg-p-surface-2 px-2.5 py-2">
                        <p className="text-[11px] text-p-text-muted">
                          {isRecurringKind ? 'Canchas' : 'Cancha'}
                        </p>
                        <p className="text-[12px] font-semibold text-p-text truncate">{quickSummaryCourtsLabel}</p>
                      </div>
                    </div>
                  </section>
                  {bookingKind === 'block' ? (
                    <>
                      <section className="pb-6 border-b border-p-border">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-p-text-muted">Título (opcional)</span>
                            <input
                              value={blockingTitle}
                              onChange={(event) => setBlockingTitle(event.target.value)}
                              placeholder="Mantenimiento"
                              className="mt-2 h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text outline-none"
                            />
                          </label>
                          <div className="block">
                            <span className="text-[13px] text-p-text-muted">Cancha</span>
                            <PlaygroundCombo
                              value={selectedCourtId}
                              onChange={(next) => {
                                setSelectedCourtId(next);
                                setScheduleInputsDirty(true);
                              }}
                              options={effectiveCourts.map((court) => ({ value: court.id, label: court.name }))}
                              className="mt-2"
                            />
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-p-text-muted">Fecha</span>
                            <input
                              type="date"
                              value={formatLocalDate(selectedDate)}
                              onChange={(event) => {
                                const next = new Date(`${event.target.value}T12:00:00`);
                                if (!Number.isNaN(next.getTime())) {
                                  setSelectedDate(next);
                                }
                              }}
                              className="mt-2 h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text"
                            />
                          </label>
                          <div className="block">
                            <span className="text-[13px] text-p-text-muted">Hora de inicio</span>
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
                          </div>
                          <div className="block">
                            <span className="text-[13px] text-p-text-muted">Hora de fin</span>
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
                          </div>
                        </div>
                      </section>

                    </>
                  ) : (
                    <>
                  <fieldset
                    disabled={lockBookingDetails}
                    className={lockBookingDetails ? 'pointer-events-none opacity-60 select-none' : ''}
                  >
                  <section className="pb-6 border-b border-p-border">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-p-text">Cobro</p>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${reservationStatusTone}`}>
                          {reservationStatusLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${paymentStatusTone}`}>
                          {paymentStatusLabel}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] text-p-text-muted">
                      Registrá cobros de deuda común de la reserva desde este bloque.
                    </p>
                    {isCompletedReservation && (
                      <p className="mt-1 text-[12px] font-medium text-p-warning">
                        Reserva completada: podés gestionar consumos, participantes y cobros; no reprogramar.
                      </p>
                    )}
                    {shouldHideBillingUntilConfirmed ? (
                      <div className="mt-3 rounded-xl border border-p-warning bg-p-warning-bg px-3 py-3">
                        <p className="text-[12px] font-semibold text-p-warning">
                          {shouldHideBillingUntilCreated
                            ? 'Cobro disponible después de crear la reserva.'
                            : 'Cobro oculto hasta confirmar la reserva.'}
                        </p>
                        <p className="mt-1 text-[12px] text-p-warning">
                          {shouldHideBillingUntilCreated
                            ? 'Primero creá la reserva. Después podés registrar pagos.'
                            : 'Confirmá esta reserva para habilitar registro de pagos y saldo.'}
                        </p>
                        {!shouldHideBillingUntilCreated && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleConfirmPendingBooking()}
                              disabled={confirmingBooking}
                              className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-60"
                            >
                              {confirmingBooking ? 'Confirmando...' : 'Confirmar reserva'}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-p-border bg-p-surface-2 p-4">
                        <div className="grid grid-cols-3 gap-2 text-[12px] text-p-text-muted">
                          <div className="rounded-lg bg-p-surface px-2 py-1.5">
                            <p>Total</p>
                            <p className="text-[15px] font-semibold text-p-text">
                              {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                            </p>
                          </div>
                          <div className="rounded-lg bg-p-surface px-2 py-1.5">
                            <p>Pagado</p>
                            <p className="text-[15px] font-semibold text-p-positive">
                              {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                            </p>
                          </div>
                          <div className="rounded-lg bg-p-surface px-2 py-1.5">
                            <p>Deuda</p>
                            <p className="text-[15px] font-semibold text-p-warning">
                              {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[12px] text-p-text-muted">
                          Cancha: {bookingCourtAmount.toFixed(2)} $ · Consumos: {bookingItemsAmount.toFixed(2)} $
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={openSimplifiedPaymentModal}
                            disabled={!simplifiedCanRegisterPayment}
                            className="h-10 rounded-xl bg-ink-900 px-4 text-[14px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                          >
                            Registrar pago
                          </button>
                          {!persistedEditingBookingId ? (
                            <p className="text-[12px] text-p-text-muted">Primero creá la reserva.</p>
                          ) : billingConfigLoadError ? (
                            <p className="text-[12px] text-p-error">{billingConfigLoadError}</p>
                          ) : isPaymentLockedByManualPending ? (
                            <p className="text-[12px] text-p-text-muted">Confirmá la reserva para habilitar pagos.</p>
                          ) : null}
                        </div>
                      </div>
                    )}
                    {!isModernBillingEnabled && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className={isBookingFullyPaid ? 'col-span-2' : ''}>
                        <p className="text-[13px] text-p-text-muted">{priceFieldLabel}</p>
                        <div className="mt-2 h-11 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between text-[16px] text-p-text">
                          <input
                            type="number"
                            min={0}
                            max={MAX_MANUAL_PARTICIPANT_PRICE}
                            step="0.01"
                            value={isFinancialDisplayPending ? '' : Number(totalPrice.toFixed(2))}
                            readOnly
                            className="w-full bg-transparent outline-none text-p-text"
                          />
                          <span className="text-p-text-muted">$</span>
                        </div>
                        <p className="mt-1 text-[11px] text-p-text-muted">
                          Precio turno ({selectionMinutes} min):{' '}
                          <strong>{isFinancialDisplayPending ? '--' : `${totalPrice.toFixed(2)} $`}</strong>
                        </p>
                        <p className="mt-1 text-[11px] text-p-text-muted">{priceFieldHint}</p>
                        {isFinancialDisplayPending && (
                          <p className="mt-1 text-[11px] text-p-text-muted">Cargando precio...</p>
                        )}
                        {quoteLoading && <p className="mt-1 text-[11px] text-p-text-muted">Cotizando...</p>}
                        {quoteError && !isBlockingQuoteError(quoteError) && (
                          <p className="mt-1 text-[11px] text-p-error">{quoteError}</p>
                        )}
                        {bookingFinancial && (
                          <p className="mt-1 text-[11px] text-p-text-muted">
                            Pagado: <strong>{bookingFinancial.paid.toFixed(2)} $</strong> · Restante:{' '}
                            <strong>{bookingFinancial.remaining.toFixed(2)} $</strong>
                          </p>
                        )}
                        {exceedsRemainingWarning && (
                          <p className="mt-1 text-[11px] text-p-error">
                            El precio configurado supera el saldo pendiente. Al cobrar se ajustará al restante.
                          </p>
                        )}
                      </div>
                    </div>
                    )}
                  </section>

                  <section className="py-6 border-b border-p-border">
                    <div className="flex items-end justify-between">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-p-text">Participantes</p>
                      {!isModernBillingEnabled && (
                        <div className="grid grid-cols-[1fr_86px_132px_20px] gap-2 text-[12px] text-p-text-muted">
                          <span />
                          <span>Precio</span>
                          <span>Pago</span>
                          <span />
                        </div>
                      )}
                    </div>
                    {isModernBillingEnabled && (
                      <p className="mt-2 text-[12px] text-p-text-muted">
                        Acá gestionás personas de la reserva. La lógica de cobro está en la sección <strong>Cobro</strong>.
                      </p>
                    )}

                    <div className="mt-3 space-y-3">
                      {participants.map((participant) => {
                        const participantIsCharged = chargedParticipantIdSet.has(participant.id);
                        const participantPaidComputed = participantPaidComputedIdSet.has(participant.id);
                        const displayPrice = participantIsCharged ? resolveParticipantPrice(participant) : 0;
                        const isDuplicateParticipant = duplicateParticipantIds.has(participant.id);
                        return (
                          <div
                            key={participant.id}
                            data-participant-shell-id={participant.id}
                            className={`rounded-xl border bg-p-surface p-2 ${
                              isDuplicateParticipant ? 'border-p-error bg-p-error-bg' : 'border-p-border'
                            }`}
                          >
                            <p className="text-[13px] text-p-text-muted mb-2">
                              {participant.isOwner ? 'Responsable de la reserva' : 'Participante'}
                            </p>
                            <div className={`grid ${isModernBillingEnabled ? 'grid-cols-[1fr_20px]' : 'grid-cols-[1fr_86px_132px_20px]'} gap-2 items-center`}>
                              <div className="relative">
                                <div className="h-11 rounded-xl border border-p-border px-3 flex items-center gap-2 text-p-text-muted">
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
                                    placeholder="Buscar nombre, correo o teléfono"
                                    className="w-full bg-transparent outline-none text-[13px] text-p-text"
                                  />
                                </div>
                                {participantSearchOpenId === participant.id && (
                                  <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-p-border bg-p-surface shadow-lg p-1">
                                    {participantSearchLoadingId === participant.id && (
                                      <p className="px-2 py-1 text-[11px] text-p-text-muted">Buscando...</p>
                                    )}
                                    {(participantSuggestionsById[participant.id] || []).slice(0, 8).map((suggestion) => (
                                      <button
                                        key={suggestion.id}
                                        type="button"
                                        onClick={() => applyParticipantSuggestion(participant.id, suggestion)}
                                        className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2"
                                      >
                                        <span className="block text-[12px] font-semibold text-p-text">{suggestion.label}</span>
                                        {suggestion.secondary && (
                                          <span className="block text-[11px] text-p-text-muted">{suggestion.secondary}</span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {!isModernBillingEnabled && (
                              <div className="h-11 rounded-xl border border-p-border px-3 flex items-center justify-between text-[15px]">
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
                                <span className="text-p-text-muted">$</span>
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
                                  isBookingFullyPaid || participantPaidComputed || !participantIsCharged
                                    ? 'border-p-positive bg-p-positive-bg text-p-positive'
                                    : 'border-p-accent bg-p-positive-bg text-p-accent'
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
                                  : participantPaidComputed
                                    ? 'Pagado'
                                    : 'Pagar su parte'}
                              </button>
                              )}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (expandedParticipantId === participant.id) {
                                    setExpandedParticipantId(null);
                                    return;
                                  }
                                  setParticipantMenuId((previous) =>
                                    previous === participant.id ? null : participant.id
                                  );
                                }}
                                className="h-11 w-5 text-p-text-muted grid place-items-center"
                              >
                                <MoreVertical size={16} />
                              </button>
                            </div>
                            {expandedParticipantId === participant.id ? (
                              <div className="mt-2">
                                <div className="h-10 rounded-xl border border-p-border px-3 flex items-center gap-2 text-p-text-muted">
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
                                    placeholder="Email y teléfono"
                                    className="w-full bg-transparent outline-none text-[13px] text-p-text"
                                  />
                                </div>
                                <div className="mt-2 flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedParticipantId(null)}
                                    className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedParticipantId(null)}
                                    className="h-8 rounded-lg bg-[var(--accent-fg)] px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900"
                                  >
                                    Guardar
                                  </button>
                                </div>
                              </div>
                            ) : participant.contact.trim().length > 0 ? (
                              <p className="mt-2 text-[12px] text-p-text-muted">
                                Contacto: {participant.contact}
                              </p>
                            ) : null}
                            {isDuplicateParticipant && (
                              <p className="mt-2 text-[11px] font-semibold text-p-error">
                                Participante duplicado en esta reserva.
                              </p>
                            )}
                            {participantMenuId === participant.id && (
                              <div className="mt-2 rounded-xl border border-p-border bg-p-surface shadow-sm p-2 text-[12px] text-p-text-secondary">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedParticipantId((previous) =>
                                      previous === participant.id ? null : participant.id
                                    );
                                    setParticipantMenuId(null);
                                  }}
                                  className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2"
                                >
                                  {expandedParticipantId === participant.id
                                    ? 'Finalizar edición'
                                    : 'Editar participante (nombre/contacto)'}
                                </button>
                                {!isModernBillingEnabled && !isBookingFullyPaid && participantIsCharged && isPaymentsTabActive && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (participantPaidComputed) {
                                          markParticipantAsPending(participant.id);
                                        } else {
                                          if (isPaymentLockedByManualPending) return;
                                          void toggleParticipantPaid(participant.id);
                                        }
                                        setParticipantMenuId(null);
                                      }}
                                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-p-surface-2"
                                    >
                                      {participantPaidComputed ? 'Marcar como pendiente' : 'Pagar su parte'}
                                    </button>
                                  </>
                                )}
                                <div className="mt-1 border-t border-p-border pt-1">
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
                                    className="w-full text-left rounded-lg px-2 py-1.5 text-p-error hover:bg-p-error-bg disabled:opacity-40"
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
                          className="h-7 rounded-full px-3 border border-p-border text-p-text-secondary text-[12px] font-semibold"
                        >
                          Recalcular precios
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={addParticipantRow}
                        className="h-7 rounded-full px-3 border border-p-border text-p-text-secondary text-[12px] font-semibold inline-flex items-center gap-1"
                      >
                        <Plus size={12} />
                        Agregar participante
                      </button>
                    </div>
                  </section>

                  </fieldset>
                    </>
                  )}
                    </>
                  )}
                </div>

                <footer ref={simplifiedSidebarFooterRef} className="border-t border-p-border bg-p-surface px-6 py-4">
                  {useSimplifiedBookingSidebar ? (
                    <div className="space-y-3">
                      {shouldShowSeriesScopeHint && (
                        <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[12px] text-p-accent">
                          Esta reserva pertenece a una serie. Al guardar, vas a elegir si editar solo esta ocurrencia, desde esta en adelante o toda la serie.
                        </div>
                      )}
                      {hasBlockingActionError && (
                        <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2.5">
                          <p className="text-[12px] font-semibold text-p-error">
                            No podes continuar hasta corregir este error.
                          </p>
                          <p className="mt-0.5 text-[12px] text-p-error">{blockingActionMessage}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        {editingBookingId && !isCompletedReservation && (
                          <button
                            type="button"
                            onClick={openDeleteBookingFlow}
                            aria-label="Eliminar reserva"
                            title="Eliminar reserva"
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 w-10 rounded-xl border border-p-error bg-p-surface text-p-error grid place-items-center hover:bg-p-error-bg disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {editingBookingId &&
                          !isCompletedReservation &&
                          canChangeTitularFromUi &&
                          editingBooking?.state !== 'blocked' && (
                          <button
                            type="button"
                            onClick={openChangeTitularModal}
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-40"
                          >
                            Cambiar titular
                          </button>
                        )}
                        <div className="flex items-center gap-2">
                          {showConfirmMainAction && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmPendingBooking()}
                              disabled={confirmingBooking || isSubmittingBooking || isDeletingBooking}
                              className="h-10 rounded-xl border border-p-accent bg-p-surface px-4 text-[13px] font-semibold text-p-accent hover:bg-p-surface-2 disabled:opacity-50"
                            >
                              {confirmingBooking ? 'Confirmando...' : 'Confirmar reserva'}
                            </button>
                          )}
                          {hasBlockingActionError && (
                            <button
                              type="button"
                              onClick={() => setBlockingErrorModalOpen(true)}
                              className="h-10 rounded-xl border border-p-error bg-p-surface px-4 text-[13px] font-semibold text-p-error hover:bg-p-error-bg"
                            >
                              Ver detalle
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCreateBooking()}
                            disabled={primaryActionDisabled}
                            className="h-10 min-w-[170px] rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                          >
                            {editingBookingId ? 'Guardar cambios' : 'Crear reserva'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="space-y-3">
                    {shouldShowSeriesScopeHint && (
                      <div className="rounded-xl border border-p-accent bg-p-positive-bg px-3 py-2 text-[12px] text-p-accent">
                        Esta reserva pertenece a una serie. Al guardar, vas a elegir si editar solo esta ocurrencia, desde esta en adelante o toda la serie.
                      </div>
                    )}
                    {bookingKind !== 'block' && !shouldHideBillingUntilConfirmed && (
                      <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-p-text">Resumen de cobro</p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-p-surface px-2 py-1.5 text-[11px] text-p-text-muted">
                            <p>Total</p>
                            <p className="text-[13px] font-semibold text-p-text">
                              {Number(billingSummary.totalAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                          <div className="rounded-lg bg-p-surface px-2 py-1.5 text-[11px] text-p-text-muted">
                            <p>Pagado</p>
                            <p className="text-[13px] font-semibold text-p-positive">
                              {Number(billingSummary.paidAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                          <div className="rounded-lg bg-p-surface px-2 py-1.5 text-[11px] text-p-text-muted">
                            <p>Restante</p>
                            <p className="text-[13px] font-semibold text-p-warning">
                              {Number(billingSummary.remainingAmount || 0).toFixed(2)} $
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-p-text-muted">
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
                      <div className="rounded-xl border border-p-warning bg-p-warning-bg px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-p-warning">Cobro pendiente de confirmación</p>
                        <p className="mt-1 text-[12px] text-p-warning">
                          Confirmá la reserva para habilitar pagos y saldo.
                        </p>
                      </div>
                    )}

                    {hasBlockingActionError && (
                      <div className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-p-error">
                          No podés continuar hasta corregir este error.
                        </p>
                        <p className="mt-0.5 text-[12px] text-p-error">{blockingActionMessage}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        {editingBookingId && !isCompletedReservation && (
                          <button
                            type="button"
                            onClick={openDeleteBookingFlow}
                            aria-label="Eliminar reserva"
                            title="Eliminar reserva"
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 w-10 rounded-xl border border-p-error bg-p-surface text-p-error grid place-items-center hover:bg-p-error-bg disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {editingBookingId &&
                          !isCompletedReservation &&
                          canChangeTitularFromUi &&
                          editingBooking?.state !== 'blocked' && (
                          <button
                            type="button"
                            onClick={openChangeTitularModal}
                            disabled={isSubmittingBooking || isDeletingBooking}
                            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-40"
                          >
                            Cambiar titular
                          </button>
                        )}
                        {hasBlockingActionError && (
                          <button
                            type="button"
                            onClick={() => setBlockingErrorModalOpen(true)}
                            className="h-10 rounded-xl border border-p-error bg-p-surface px-4 text-[13px] font-semibold text-p-error hover:bg-p-error-bg"
                          >
                            Ver detalle
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleCreateBooking()}
                          disabled={primaryActionDisabled}
                          className="h-10 min-w-[232px] rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                        >
                          {isSubmittingBooking ? primaryActionLabel : `${primaryActionLabel} • ${primaryActionMeta}`}
                        </button>
                      </div>
                    </div>
                  </div>
                  )}
                </footer>
              </div>
            </aside>
            </section>
          </AdminPlaygroundShell>

      {duplicateDecisionOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/45 px-4">
          <div className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-xl">
            <div className="border-b border-p-border px-5 py-4">
              <p className="text-[16px] font-semibold text-p-text">Ya existe un cliente parecido en este club</p>
              <p className="mt-1 text-[13px] text-p-text-muted">
                Elegí cómo continuar. No se va a vincular ni fusionar automáticamente.
              </p>
            </div>
            <div className="max-h-[46vh] overflow-y-auto px-5 py-4 space-y-2">
              {duplicateDecisionCandidates.map((candidate) => {
                const isSelected = String(duplicateDecisionSelectedClientId) === String(candidate.id);
                return (
                  <button
                    key={`duplicate-candidate-${candidate.id}`}
                    type="button"
                    onClick={() => setDuplicateDecisionSelectedClientId(String(candidate.id))}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      isSelected
                        ? 'border-p-accent bg-p-positive-bg'
                        : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                    }`}
                  >
                    <p className="text-[13px] font-semibold text-p-text">{candidate.name}</p>
                    <p className="mt-0.5 text-[12px] text-p-text-muted">
                      {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'Sin contacto visible'}
                    </p>
                  </button>
                );
              })}
              {duplicateDecisionCandidates.length === 0 && (
                <p className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">
                  No llegaron candidatos detallados en la respuesta.
                </p>
              )}
            </div>
            {duplicateDecisionError && (
              <div className="px-5 pb-2">
                <p className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
                  {duplicateDecisionError}
                </p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">
              <button
                type="button"
                onClick={closeDuplicateDecisionModal}
                disabled={duplicateDecisionLoading}
                className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void runDuplicateDecisionRetry('USE_EXISTING')}
                disabled={duplicateDecisionLoading || !duplicateDecisionSelectedClientId}
                className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text disabled:opacity-40"
              >
                Usar cliente existente
              </button>
              <button
                type="button"
                onClick={() => void runDuplicateDecisionRetry('CREATE_NEW')}
                disabled={duplicateDecisionLoading}
                className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 disabled:opacity-40"
              >
                {duplicateDecisionLoading ? 'Creando...' : 'Crear cliente nuevo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {changeTitularModalOpen && (
        <div className="fixed inset-0 z-[92] flex items-center justify-center bg-ink-950/45 px-4">
          <div className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-xl">
            <div className="border-b border-p-border px-5 py-4">
              <p className="text-[16px] font-semibold text-p-text">Cambiar titular</p>
              <p className="mt-1 text-[13px] text-p-text-muted">
                Seleccioná manualmente un cliente del club para esta reserva.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                value={changeTitularSearch}
                onChange={(event) => setChangeTitularSearch(event.target.value)}
                placeholder="Buscar por nombre, teléfono o email"
                className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
              />
              <div className="max-h-[34vh] overflow-y-auto space-y-2">
                {changeTitularLoading && (
                  <p className="text-[12px] text-p-text-muted">Buscando clientes...</p>
                )}
                {!changeTitularLoading && changeTitularCandidates.length === 0 && (
                  <p className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">
                    Escribí al menos 2 caracteres para buscar.
                  </p>
                )}
                {changeTitularCandidates.map((candidate) => {
                  const isSelected = String(changeTitularSelectedClientId) === String(candidate.id);
                  return (
                    <button
                      key={`change-titular-candidate-${candidate.id}`}
                      type="button"
                      onClick={() => setChangeTitularSelectedClientId(String(candidate.id))}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        isSelected
                          ? 'border-p-accent bg-p-positive-bg'
                          : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                      }`}
                    >
                      <p className="text-[13px] font-semibold text-p-text">{candidate.name}</p>
                      <p className="mt-0.5 text-[12px] text-p-text-muted">
                        {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'Sin contacto visible'}
                      </p>
                    </button>
                  );
                })}
              </div>
              <textarea
                value={changeTitularReason}
                onChange={(event) => setChangeTitularReason(event.target.value)}
                placeholder="Motivo (opcional)"
                rows={2}
                className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none"
              />
              {changeTitularError && (
                <p className="rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] text-p-error">
                  {changeTitularError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">
              <button
                type="button"
                onClick={closeChangeTitularModal}
                disabled={changeTitularSubmitting}
                className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitChangeTitular()}
                disabled={changeTitularSubmitting || !changeTitularSelectedClientId}
                className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 disabled:opacity-40"
              >
                {changeTitularSubmitting ? 'Guardando...' : 'Confirmar cambio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'form' &&
        isPlaytomicPaymentModal && (
        <AdminDrawer
          open={true}
          onClose={closeSimplifiedPaymentModal}
          title="Registrar cobro"
          subtitle="Elegi método y monto. Si hace falta, ajusta conceptos."
          size="lg"
          footer={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeSimplifiedPaymentModal}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2"
              >
                Cancelar
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={
                  !simplifiedResolvedPayerParticipantId ||
                  !hasValidSimplifiedPaymentMethod ||
                  !hasValidSimplifiedPaymentAmount ||
                  simplifiedRemainingAfterQueue <= 0.009
                }
                onClick={() => queueSimplifiedPaymentFromModal()}
                className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-900 disabled:opacity-40"
              >
                Continuar
              </button>
            </div>
          }
        >
          <PaymentRegistrationDrawer
            methodOptions={ownerPaymentMethodOptions}
            methodValue={simplifiedPaymentMethodDraft || ownerPaymentMethodOptions[0]?.value || ''}
            onMethodChange={(value) => setSimplifiedPaymentMethodDraft(String(value || ''))}
            presetOptions={[
              { id: 'FULL', label: 'Todo pendiente' },
              { id: 'COURT_ONLY', label: 'Solo cancha' },
              { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
            ]}
            selectedPreset={
              simplifiedPaymentQuickPreset === 'MY_SHARE'
                ? 'FULL'
                : simplifiedPaymentQuickPreset
            }
            onPresetChange={applySimplifiedPaymentQuickPreset}
            pendingItems={pendingAccountItems}
            selectedItemIds={simplifiedPaymentSelectedItemIdsDraft}
            customAmountById={simplifiedPaymentCustomItemAmountDraftById}
            customSelectedTotal={computeCustomSelectedAmount(
              simplifiedPaymentSelectedItemIdsDraft,
              simplifiedPaymentCustomItemAmountDraftById
            )}
            onSelectAll={() => {
              const nextIds = pendingAccountItems.map((item) => String(item.id));
              const nextCustomDrafts: Record<string, string> = {};
              pendingAccountItems.forEach((item) => {
                nextCustomDrafts[String(item.id)] = Number(item.remainingAmount || 0).toFixed(2);
              });
              setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
              setSimplifiedPaymentCustomItemAmountDraftById(nextCustomDrafts);
              setSimplifiedPaymentAmountDraft(
                formatPaymentAmountDraft(
                  computeConceptBasedMaxAmount('CUSTOM', nextIds, nextCustomDrafts)
                )
              );
            }}
            onClear={() => {
              setSimplifiedPaymentSelectedItemIdsDraft([]);
              setSimplifiedPaymentCustomItemAmountDraftById({});
              setSimplifiedPaymentAmountDraft('');
            }}
            onToggleItem={(itemId, nextChecked) => {
              const nextSet = new Set(
                simplifiedPaymentSelectedItemIdsDraft
                  .map((value) => String(value || '').trim())
                  .filter(Boolean)
              );
              const nextDrafts: Record<string, string> = {
                ...simplifiedPaymentCustomItemAmountDraftById,
              };
              if (nextChecked) {
                nextSet.add(itemId);
                const item = pendingAccountItemById.get(itemId);
                const fallback = Number(item?.remainingAmount || 0);
                const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                if (!prevDraft) {
                  nextDrafts[itemId] = fallback.toFixed(2);
                }
              } else {
                nextSet.delete(itemId);
                delete nextDrafts[itemId];
              }
              const nextIds = Array.from(nextSet);
              setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
              setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
              setSimplifiedPaymentAmountDraft(
                formatPaymentAmountDraft(computeCustomSelectedAmount(nextIds, nextDrafts))
              );
            }}
            onItemAmountChange={(itemId, value) => {
              const nextDrafts: Record<string, string> = {
                ...simplifiedPaymentCustomItemAmountDraftById,
                [itemId]: value,
              };
              setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
              setSimplifiedPaymentAmountDraft(
                formatPaymentAmountDraft(
                  computeCustomSelectedAmount(
                    simplifiedPaymentSelectedItemIdsDraft,
                    nextDrafts
                  )
                )
              );
            }}
            amountDraft={simplifiedPaymentAmountDraft}
            onAmountChange={setSimplifiedPaymentAmountDraft}
            maxInlineLabel={`Maximo: ${simplifiedPaymentMaxAmount.toFixed(2)} $`}
            maxFooterLabel={`Máximo para este cobro: ${simplifiedPaymentMaxAmount.toFixed(2)} $`}
          />
        </AdminDrawer>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'form' &&
        !isPlaytomicPaymentModal && (
        <div
          className="fixed inset-0 z-[2147483200] flex items-center justify-center bg-[var(--overlay)] p-4"
          role="presentation"
          onPointerDown={handleModalBackdropPointerDown}
          onPointerUp={(event) => handleModalBackdropPointerUp(event, closeSimplifiedPaymentModal)}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-[700px] flex-col overflow-hidden rounded-2xl border border-p-border bg-p-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
              <div className="flex items-center justify-between border-b border-p-border px-4 py-3">
                <div>
                  <p className="text-[18px] font-semibold text-p-text">
                    {isPlaytomicPaymentModal ? 'Registrar cobro' : 'Registrar pago'}
                  </p>
                  <p className="text-[12px] text-p-text-secondary">
                    {isPlaytomicPaymentModal
                      ? 'Elegi metodo y monto. Si hace falta, ajusta conceptos.'
                      : paymentMode === 'Único'
                        ? 'Pago único: una persona paga el total en uno o varios pagos parciales.'
                        : 'Pago dividido: cualquier participante puede registrar pagos y cubrir saldo del grupo.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-8 w-8 rounded-full text-p-text-muted grid place-items-center hover:bg-p-surface-2"
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3 overflow-hidden px-4 py-3">
                {!isPlaytomicPaymentModal && (
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-p-text-muted">
                    <div className="rounded-lg border border-p-border bg-p-surface-2 px-2 py-1.5">
                      <p>Total</p>
                      <p className="text-[13px] font-semibold text-p-text">
                        {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-p-border bg-p-surface-2 px-2 py-1.5">
                      <p>Pagado</p>
                      <p className="text-[13px] font-semibold text-p-positive">
                        {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-p-border bg-p-surface-2 px-2 py-1.5">
                      <p>Deuda</p>
                      <p className="text-[13px] font-semibold text-p-warning">
                        {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                      </p>
                    </div>
                  </div>
                )}

                {isPlaytomicPaymentModal ? (
                  <>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="block">
                        <span className="text-[12px] font-medium text-p-text-muted">Método</span>
                        <select
                          value={simplifiedPaymentMethodDraft || ownerPaymentMethodOptions[0]?.value || ''}
                          onChange={(event) => setSimplifiedPaymentMethodDraft(String(event.target.value || ''))}
                          className="mt-1 h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none focus:border-p-accent"
                        >
                          {ownerPaymentMethodOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-p-text-secondary">Conceptos a cobrar</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                        {[
                          { id: 'FULL', label: 'Todo pendiente' },
                          { id: 'COURT_ONLY', label: 'Solo cancha' },
                          { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
                        ].map((option) => {
                          const isActive = simplifiedPaymentQuickPreset === option.id;
                          return (
                            <button
                              key={`payment-playtomic-preset-${option.id}`}
                              type="button"
                              onClick={() => applySimplifiedPaymentQuickPreset(option.id as PaymentQuickPreset)}
                              className={`h-9 rounded-lg border text-[12px] font-semibold transition ${
                                isActive
                                  ? 'border-p-accent bg-p-positive-bg text-p-accent'
                                  : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS' && (
                      <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold text-p-text-secondary">Selección manual</p>
                          <span className="text-[11px] font-semibold text-p-text-muted">
                            Total: {computeCustomSelectedAmount(
                              simplifiedPaymentSelectedItemIdsDraft,
                              simplifiedPaymentCustomItemAmountDraftById
                            ).toFixed(2)} $
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const nextIds = pendingAccountItems.map((item) => String(item.id));
                                const nextCustomDrafts: Record<string, string> = {};
                                pendingAccountItems.forEach((item) => {
                                  nextCustomDrafts[String(item.id)] = Number(item.remainingAmount || 0).toFixed(2);
                                });
                                setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                setSimplifiedPaymentCustomItemAmountDraftById(nextCustomDrafts);
                                setSimplifiedPaymentAmountDraft(
                                  formatPaymentAmountDraft(
                                    computeConceptBasedMaxAmount('CUSTOM', nextIds, nextCustomDrafts)
                                  )
                                );
                              }}
                              className="h-7 rounded-md border border-p-border bg-p-surface px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              Seleccionar todo
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSimplifiedPaymentSelectedItemIdsDraft([]);
                                setSimplifiedPaymentCustomItemAmountDraftById({});
                                setSimplifiedPaymentAmountDraft('');
                              }}
                              className="h-7 rounded-md border border-p-border bg-p-surface px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 max-h-[180px] overflow-auto rounded-lg border border-p-border bg-p-surface p-2">
                          {pendingAccountItems.length === 0 ? (
                            <p className="px-1 py-2 text-[12px] text-p-text-muted">
                              No hay conceptos con deuda pendiente.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {pendingAccountItems.map((item) => {
                                const checked = simplifiedPaymentSelectedItemIdsDraft.includes(String(item.id));
                                return (
                                  <div
                                    key={`payment-playtomic-concept-item-${item.id}`}
                                    onClick={() => {
                                      const nextChecked = !checked;
                                      const nextSet = new Set(
                                        simplifiedPaymentSelectedItemIdsDraft
                                          .map((value) => String(value || '').trim())
                                          .filter(Boolean)
                                      );
                                      const itemId = String(item.id);
                                      const nextDrafts: Record<string, string> = {
                                        ...simplifiedPaymentCustomItemAmountDraftById,
                                      };
                                      if (nextChecked) {
                                        nextSet.add(itemId);
                                        const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                        if (!prevDraft) {
                                          nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                        }
                                      } else {
                                        nextSet.delete(itemId);
                                        delete nextDrafts[itemId];
                                      }
                                      const nextIds = Array.from(nextSet);
                                      setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                      setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                      setSimplifiedPaymentAmountDraft(
                                        formatPaymentAmountDraft(
                                          computeCustomSelectedAmount(nextIds, nextDrafts)
                                        )
                                      );
                                    }}
                                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-p-surface-2"
                                  >
                                    <span className="min-w-0 flex items-center gap-2 text-[12px] text-p-text">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => {
                                          const nextChecked = event.target.checked;
                                          const nextSet = new Set(
                                            simplifiedPaymentSelectedItemIdsDraft
                                              .map((value) => String(value || '').trim())
                                              .filter(Boolean)
                                          );
                                          if (nextChecked) {
                                            nextSet.add(String(item.id));
                                            const itemId = String(item.id);
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                            };
                                            const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                            if (!prevDraft) {
                                              nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                            }
                                            const nextIds = Array.from(nextSet);
                                            setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(nextIds, nextDrafts)
                                              )
                                            );
                                            return;
                                          } else {
                                            nextSet.delete(String(item.id));
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                            };
                                            delete nextDrafts[String(item.id)];
                                            const nextIds = Array.from(nextSet);
                                            setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(nextIds, nextDrafts)
                                              )
                                            );
                                            return;
                                          }
                                        }}
                                        className="h-4 w-4 accent-p-brand"
                                      />
                                      <span className="truncate">
                                        {item.type === 'BOOKING' ? 'Cancha' : item.description}
                                      </span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <div className="flex h-8 w-[116px] items-center rounded-md border border-p-border bg-p-surface px-2">
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.01"
                                          disabled={!checked}
                                          onClick={(event) => event.stopPropagation()}
                                          value={
                                            checked
                                              ? String(
                                                  simplifiedPaymentCustomItemAmountDraftById[String(item.id)] ??
                                                    Number(item.remainingAmount || 0).toFixed(2)
                                                )
                                              : ''
                                          }
                                          onChange={(event) => {
                                            const itemId = String(item.id);
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                              [itemId]: event.target.value,
                                            };
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(
                                                  simplifiedPaymentSelectedItemIdsDraft,
                                                  nextDrafts
                                                )
                                              )
                                            );
                                          }}
                                          className="w-full bg-transparent text-right text-[12px] font-semibold text-p-text outline-none disabled:text-p-text-muted"
                                        />
                                        <span className="ml-1 text-[11px] font-semibold text-p-text-muted">$</span>
                                      </div>
                                      <span className="w-[88px] text-right text-[11px] font-semibold text-p-text-secondary">
                                        {Number(item.remainingAmount || 0).toFixed(2)} $
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <label className="block">
                      <span className="text-[12px] font-medium text-p-text-muted">Monto final</span>
                      <div className="mt-1 h-11 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={simplifiedPaymentAmountDraft}
                          onChange={(event) => setSimplifiedPaymentAmountDraft(event.target.value)}
                          className="w-full bg-transparent text-[16px] text-p-text outline-none"
                        />
                        <span className="text-[15px] font-semibold text-p-text-muted">$</span>
                      </div>
                      <p className="mt-1 text-[11px] text-p-text-muted">
                        Maximo: {simplifiedPaymentMaxAmount.toFixed(2)} $
                      </p>
                    </label>

                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="block">
                        <span className="text-[12px] font-medium text-p-text-muted">Pagador</span>
                        <PlaygroundCombo
                          value={simplifiedResolvedPayerParticipantId || simplifiedPayerComboOptions[0]?.value || ''}
                          onChange={handleSimplifiedPayerChange}
                          options={simplifiedPayerComboOptions}
                          variant="participant"
                          className="mt-1"
                        />
                        {simplifiedLockedSinglePayerId && (
                          <p className="mt-1 text-[11px] text-p-text-muted">
                            El pagador queda fijo después del primer pago confirmado.
                          </p>
                        )}
                      </div>
                      <div className="block">
                        <span className="text-[12px] font-medium text-p-text-muted">Imputar pago a</span>
                        {paymentMode === 'Único' ? (
                          <div className="mt-1 h-11 rounded-xl border border-p-border bg-p-surface-2 px-3 flex items-center text-[14px] font-medium text-p-text-secondary">
                            {simplifiedResolvedCoveredParticipant?.name || simplifiedResolvedPayerParticipant?.name || 'Titular'}
                          </div>
                        ) : (
                          <PlaygroundCombo
                            value={simplifiedResolvedCoveredParticipantId || simplifiedCoveredParticipantComboOptions[0]?.value || ''}
                            onChange={(value) => {
                              const nextCoveredId = String(value || '').trim();
                              setSimplifiedPaymentCoveredParticipantIdDraft(nextCoveredId);
                              setSimplifiedPaymentCoveredParticipantIdsDraft(nextCoveredId ? [nextCoveredId] : []);
                              setSimplifiedPaymentQuickPreset('MY_SHARE');
                              setSimplifiedPaymentImputationMode('BY_PARTICIPANT');
                              setSimplifiedPaymentConceptMode('AUTO');
                              const nextDebt = Number(participantDebtAmountById.get(nextCoveredId) || 0);
                              const nextAmount = Number(
                                Math.max(0, Math.min(simplifiedRemainingAfterQueue, nextDebt)).toFixed(2)
                              );
                              setSimplifiedPaymentAmountDraft(formatPaymentAmountDraft(nextAmount));
                            }}
                            options={simplifiedCoveredParticipantComboOptions}
                            variant="participant"
                            className="mt-1"
                          />
                        )}
                      </div>
                      <div className="block">
                        <span className="text-[12px] font-medium text-p-text-muted">Método</span>
                        <PlaygroundCombo
                          value={simplifiedPaymentMethodDraft || ownerPaymentMethodOptions[0]?.value || ''}
                          onChange={(value) => setSimplifiedPaymentMethodDraft(String(value || ''))}
                          options={simplifiedPaymentMethodComboOptions}
                          variant="participant"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-p-text-secondary">Qué quiere pagar</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                        {[
                          { id: 'MY_SHARE', label: 'Mi parte' },
                          { id: 'FULL', label: 'Todo pendiente' },
                          { id: 'COURT_ONLY', label: 'Solo cancha' },
                          { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
                        ].map((option) => {
                          const isActive = simplifiedPaymentQuickPreset === option.id;
                          return (
                            <button
                              key={`payment-quick-preset-${option.id}`}
                              type="button"
                              onClick={() => applySimplifiedPaymentQuickPreset(option.id as PaymentQuickPreset)}
                              className={`h-9 rounded-lg border text-[12px] font-semibold transition ${
                                isActive
                                  ? 'border-p-accent bg-p-positive-bg text-p-accent'
                                  : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-p-text-muted">
                        {simplifiedPaymentQuickPreset === 'MY_SHARE'
                          ? 'Cobra la deuda del participante imputado.'
                          : simplifiedPaymentQuickPreset === 'FULL'
                            ? 'Imputa el pago sobre todo el saldo pendiente de la reserva.'
                            : simplifiedPaymentQuickPreset === 'COURT_ONLY'
                              ? 'Imputa únicamente el saldo de cancha.'
                              : 'Seleccioná manualmente los conceptos que quiere pagar.'}
                      </p>
                    </div>

                    {simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS' && (
                      <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2.5">
                        <p className="text-[12px] font-semibold text-p-text-secondary">Conceptos a pagar</p>
                        <p className="mt-2 text-[11px] text-p-text-muted">
                          Total seleccionado: {computeCustomSelectedAmount(
                            simplifiedPaymentSelectedItemIdsDraft,
                            simplifiedPaymentCustomItemAmountDraftById
                          ).toFixed(2)} $
                        </p>

                        <div className="mt-2 max-h-[160px] overflow-auto rounded-lg border border-p-border bg-p-surface p-2">
                          {pendingAccountItems.length === 0 ? (
                            <p className="px-1 py-2 text-[12px] text-p-text-muted">No hay conceptos con deuda pendiente.</p>
                          ) : (
                            <div className="space-y-1">
                              {pendingAccountItems.map((item) => {
                                const checked = simplifiedPaymentSelectedItemIdsDraft.includes(String(item.id));
                                return (
                                  <div
                                    key={`payment-concept-item-${item.id}`}
                                    onClick={() => {
                                      const nextChecked = !checked;
                                      const nextSet = new Set(
                                        simplifiedPaymentSelectedItemIdsDraft
                                          .map((value) => String(value || '').trim())
                                          .filter(Boolean)
                                      );
                                      const itemId = String(item.id);
                                      const nextDrafts: Record<string, string> = {
                                        ...simplifiedPaymentCustomItemAmountDraftById,
                                      };
                                      if (nextChecked) {
                                        nextSet.add(itemId);
                                        const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                        if (!prevDraft) {
                                          nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                        }
                                      } else {
                                        nextSet.delete(itemId);
                                        delete nextDrafts[itemId];
                                      }
                                      const nextIds = Array.from(nextSet);
                                      setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                      setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                      setSimplifiedPaymentAmountDraft(
                                        formatPaymentAmountDraft(
                                          computeCustomSelectedAmount(nextIds, nextDrafts)
                                        )
                                      );
                                    }}
                                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-p-surface-2"
                                  >
                                    <span className="min-w-0 flex items-center gap-2 text-[12px] text-p-text">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => {
                                          const nextChecked = event.target.checked;
                                          const nextSet = new Set(
                                            simplifiedPaymentSelectedItemIdsDraft
                                              .map((value) => String(value || '').trim())
                                              .filter(Boolean)
                                          );
                                          if (nextChecked) {
                                            nextSet.add(String(item.id));
                                            const itemId = String(item.id);
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                            };
                                            const prevDraft = String(nextDrafts[itemId] ?? '').trim();
                                            if (!prevDraft) {
                                              nextDrafts[itemId] = Number(item.remainingAmount || 0).toFixed(2);
                                            }
                                            const nextIds = Array.from(nextSet);
                                            setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(nextIds, nextDrafts)
                                              )
                                            );
                                            return;
                                          } else {
                                            nextSet.delete(String(item.id));
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                            };
                                            delete nextDrafts[String(item.id)];
                                            const nextIds = Array.from(nextSet);
                                            setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(nextIds, nextDrafts)
                                              )
                                            );
                                            return;
                                          }
                                        }}
                                        className="h-4 w-4 accent-p-brand"
                                      />
                                      <span className="truncate">
                                        {item.type === 'BOOKING' ? 'Cancha' : item.description}
                                      </span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <div className="flex h-8 w-[116px] items-center rounded-md border border-p-border bg-p-surface px-2">
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.01"
                                          disabled={!checked}
                                          onClick={(event) => event.stopPropagation()}
                                          value={
                                            checked
                                              ? String(
                                                  simplifiedPaymentCustomItemAmountDraftById[String(item.id)] ??
                                                    Number(item.remainingAmount || 0).toFixed(2)
                                                )
                                              : ''
                                          }
                                          onChange={(event) => {
                                            const itemId = String(item.id);
                                            const nextDrafts: Record<string, string> = {
                                              ...simplifiedPaymentCustomItemAmountDraftById,
                                              [itemId]: event.target.value,
                                            };
                                            setSimplifiedPaymentCustomItemAmountDraftById(nextDrafts);
                                            setSimplifiedPaymentAmountDraft(
                                              formatPaymentAmountDraft(
                                                computeCustomSelectedAmount(
                                                  simplifiedPaymentSelectedItemIdsDraft,
                                                  nextDrafts
                                                )
                                              )
                                            );
                                          }}
                                          className="w-full bg-transparent text-right text-[12px] font-semibold text-p-text outline-none disabled:text-p-text-muted"
                                        />
                                        <span className="ml-1 text-[11px] font-semibold text-p-text-muted">$</span>
                                      </div>
                                      <span className="w-[88px] text-right text-[11px] font-semibold text-p-text-secondary">
                                        {Number(item.remainingAmount || 0).toFixed(2)} $
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <label className="block">
                  <span className="text-[12px] font-medium text-p-text-muted">Monto</span>
                  <div className="mt-1 h-11 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={simplifiedPaymentAmountDraft}
                      onChange={(event) => setSimplifiedPaymentAmountDraft(event.target.value)}
                      className="w-full bg-transparent text-[16px] text-p-text outline-none"
                    />
                    <span className="text-[15px] font-semibold text-p-text-muted">$</span>
                  </div>
                  <p className="mt-1 text-[11px] text-p-text-muted">
                    {isPlaytomicPaymentModal
                      ? `Máximo para este cobro: ${simplifiedPaymentMaxAmount.toFixed(2)} $`
                      : simplifiedPaymentImputationMode === 'BY_CONCEPT'
                        ? `Máximo por conceptos seleccionados: ${simplifiedPaymentMaxAmount.toFixed(2)} $`
                        : paymentMode === 'Único'
                          ? `Saldo pendiente de la reserva: ${simplifiedRemainingAfterQueue.toFixed(2)} $`
                          : `Máximo por participantes seleccionados: ${simplifiedPaymentMaxAmount.toFixed(2)} $`}
                  </p>
                  {!isPlaytomicPaymentModal &&
                    paymentMode === 'Dividido' &&
                    simplifiedPaymentImputationMode === 'BY_PARTICIPANT' && (
                      <p className="mt-0.5 text-[11px] text-p-text-muted">
                        Deuda seleccionada ({simplifiedResolvedCoveredParticipantIds.length}):{' '}
                        {simplifiedResolvedCoveredParticipantsDebt.toFixed(2)} $
                      </p>
                    )}
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-p-border px-4 py-3">
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-10 rounded-xl border border-p-border px-4 text-[14px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => queueSimplifiedPaymentFromModal()}
                  disabled={
                    !simplifiedResolvedPayerParticipantId ||
                    (!isPlaytomicPaymentModal &&
                      simplifiedPaymentImputationMode !== 'BY_CONCEPT' &&
                      !simplifiedResolvedCoveredParticipantId) ||
                    !hasValidSimplifiedPaymentMethod ||
                    !hasValidSimplifiedPaymentAmount ||
                    simplifiedRemainingAfterQueue <= 0.009
                  }
                  className="h-10 rounded-xl bg-ink-900 px-4 text-[14px] font-semibold text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                >
                  {isPlaytomicPaymentModal ? 'Continuar' : 'Registrar pago'}
                </button>
              </div>
            </div>
        </div>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'preconfirm' &&
        isPlaytomicPaymentModal && (
        <AdminDrawer
          open={true}
          onClose={() => setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' })}
          title="Confirmar cobro"
          subtitle="Revisá los datos antes de confirmar."
          size="lg"
          footer={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' })}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2"
              >
                Volver
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => queueSimplifiedPaymentFromModal({ skipPlaytomicPreconfirm: true })}
                className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-900 disabled:opacity-40"
              >
                Confirmar cobro
              </button>
            </div>
          }
        >
          <AdminDrawerSection title="Resumen del cobro" className="rounded-2xl border border-p-border bg-p-surface-2 p-4">
            <div className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
              <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] text-p-text-muted">Monto</span>
                <span className="text-right text-[13px] font-medium text-p-text">{`${playtomicPreviewRequestedAmount.toFixed(2)} $`}</span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] text-p-text-muted">Método</span>
                <span className="text-right text-[13px] font-medium text-p-text">{simplifiedPaymentMethodLabel}</span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px] text-p-text-muted">Saldo luego del cobro</span>
                <span className="text-right text-[13px] font-medium text-p-text">{`${playtomicPreviewRemainingAfter.toFixed(2)} $`}</span>
              </div>
            </div>
          </AdminDrawerSection>

          {playtomicPreviewConceptRows.length > 0 && (
            <AdminDrawerSection title="Conceptos cubiertos" className="rounded-2xl border border-p-border bg-p-surface-2 p-4">
              <div className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                {playtomicPreviewConceptRows.map((row) => (
                  <div key={`playtomic-preview-row-${row.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                    <span className="text-[13px] text-p-text">{row.label}</span>
                    <span className="text-right text-[13px] font-medium text-p-text">{`${row.amount.toFixed(2)} $`}</span>
                  </div>
                ))}
              </div>
            </AdminDrawerSection>
          )}

          <div className="rounded-xl border border-p-warning bg-p-warning-bg px-4 py-3">
            <p className="text-[13px] text-p-warning">
              Revisá los datos antes de confirmar. Esta acción no se puede deshacer directamente.
            </p>
          </div>
        </AdminDrawer>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'result' &&
        playtomicResultModal &&
        isPlaytomicPaymentModal && (
        <AdminDrawer
          open={true}
          onClose={closeSimplifiedPaymentModal}
          title={playtomicResultModal.title}
          subtitle={playtomicResultModal.detail}
          size="lg"
          footer={
            <div className="flex items-center gap-2">
              {playtomicResultModal.variant !== 'success' && (
                <button
                  type="button"
                  onClick={() => {
                    setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' });
                    void openSimplifiedPaymentModal();
                  }}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-medium text-p-text-muted transition hover:bg-p-surface-2"
                >
                  Reintentar
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={closeSimplifiedPaymentModal}
                className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-900"
              >
                {playtomicResultModal.variant === 'success' ? 'Ver cuenta' : 'Cerrar'}
              </button>
            </div>
          }
        >
          {(() => {
            const isSuccess = playtomicResultModal.variant === 'success';
            return (
              <>
                <div
                  className={[
                    'flex flex-col items-center gap-3 rounded-2xl border p-6 text-center',
                    isSuccess ? 'account-success-card account-success-glow-bold' : '',
                    isSuccess
                      ? 'border-emerald-500/35 bg-p-surface text-p-text'
                      : 'bg-p-error-bg text-[var(--error-fg)]',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'grid h-12 w-12 place-items-center rounded-full',
                      isSuccess ? 'account-success-icon account-success-icon-bold' : '',
                      isSuccess ? 'bg-emerald-500/20' : 'bg-[var(--error-fg)]',
                    ].join(' ')}
                  >
                    {isSuccess ? (
                      <Check size={24} className="text-emerald-300" />
                    ) : (
                      <X size={24} className="text-ink-50" />
                    )}
                  </div>
                  <p className={`text-[18px] font-bold ${isSuccess ? 'text-p-text account-success-title' : ''}`}>
                    {playtomicResultModal.title}
                  </p>
                  <p className={`text-[13px] ${isSuccess ? 'text-p-text-muted account-success-detail' : 'opacity-80'}`}>
                    {playtomicResultModal.detail}
                  </p>
                </div>

                {isSuccess && (
                  <AdminDrawerSection title="Detalle" className="rounded-2xl border border-p-border bg-p-surface-2 p-4">
                    <div className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                        <span className="text-[13px] text-p-text-muted">Cobrado</span>
                        <span className="text-right text-[13px] font-medium text-p-text">{`${playtomicResultModal.appliedAmount.toFixed(2)} $`}</span>
                      </div>
                      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                        <span className="text-[13px] text-p-text-muted">Método</span>
                        <span className="text-right text-[13px] font-medium text-p-text">{playtomicResultModal.methodLabel}</span>
                      </div>
                      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                        <span className="text-[13px] text-p-text-muted">Saldo restante</span>
                        <span className="text-right text-[13px] font-medium text-p-text">{`${playtomicResultModal.remainingAfter.toFixed(2)} $`}</span>
                      </div>
                    </div>
                  </AdminDrawerSection>
                )}

                {isSuccess && playtomicResultModal.appliedItems.length > 0 && (
                  <AdminDrawerSection title="Conceptos" className="rounded-2xl border border-p-border bg-p-surface-2 p-4">
                    <div className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                      {playtomicResultModal.appliedItems.map((row, index) => (
                        <div key={`playtomic-result-row-${index}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
                          <span className="text-[13px] text-p-text">{row.label}</span>
                          <span className="text-right text-[13px] font-semibold text-p-positive">{`${row.amount.toFixed(2)} $`}</span>
                        </div>
                      ))}
                    </div>
                  </AdminDrawerSection>
                )}
              </>
            );
          })()}
        </AdminDrawer>
      )}

      <style jsx global>{`
        @media (prefers-reduced-motion: no-preference) {
          .account-success-card {
            animation: accountSuccessCardIn 280ms cubic-bezier(0.22, 1, 0.36, 1);
          }
          .account-success-glow-bold {
            position: relative;
            overflow: hidden;
          }
          .account-success-glow-bold::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: inherit;
            transform: translateX(-130%);
            pointer-events: none;
            background: linear-gradient(
              110deg,
              transparent 14%,
              rgba(16, 185, 129, 0.2) 32%,
              rgba(110, 231, 183, 0.34) 50%,
              rgba(16, 185, 129, 0.2) 68%,
              transparent 86%
            );
            animation: accountSuccessSweep 980ms ease-out 120ms 1 both;
          }
          .account-success-glow-bold::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
            background: radial-gradient(88% 58% at 50% 0%, rgba(16, 185, 129, 0.18), transparent 72%);
            opacity: 0;
            animation: accountSuccessGlowFade 620ms ease-out 140ms both;
          }
          .account-success-icon {
            will-change: transform, opacity;
          }
          .account-success-icon-bold {
            animation: accountSuccessIconPopBold 520ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
          }
          .account-success-title {
            animation: accountSuccessTextIn 320ms ease-out 120ms both;
          }
          .account-success-detail {
            animation: accountSuccessTextIn 320ms ease-out 180ms both;
          }
          @keyframes accountSuccessCardIn {
            from {
              opacity: 0;
              transform: translateY(8px) scale(0.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes accountSuccessSweep {
            0% {
              transform: translateX(-130%);
              opacity: 0;
            }
            16% {
              opacity: 0.7;
            }
            100% {
              transform: translateX(135%);
              opacity: 0;
            }
          }
          @keyframes accountSuccessGlowFade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @keyframes accountSuccessIconPopBold {
            0% {
              opacity: 0;
              transform: scale(0.78) rotate(-14deg);
            }
            44% {
              opacity: 1;
              transform: scale(1.12) rotate(8deg);
            }
            70% {
              transform: scale(0.96) rotate(-2deg);
            }
            100% {
              opacity: 1;
              transform: scale(1) rotate(0deg);
            }
          }
          @keyframes accountSuccessTextIn {
            from {
              opacity: 0;
              transform: translateY(3px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        }

        body {
          background: var(--bg);
        }

        .p-admin-combo {
          position: relative;
        }

        .p-admin-combo-trigger {
          position: relative;
          width: 100%;
          height: 44px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface-1);
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 500;
          padding: 0 30px 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          transition: border-color 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
        }

        .p-admin-combo-chevron {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          transition: transform 0.16s ease;
        }

        .p-admin-combo-chevron.rotate-180 {
          transform: translateY(-50%) rotate(180deg);
        }

        .p-admin-combo-trigger:hover {
          border-color: var(--border-strong);
        }

        .p-admin-combo-trigger:focus-visible {
          outline: none;
          border-color: var(--border-strong);
          box-shadow: var(--shadow-focus);
        }

        .p-admin-combo-trigger-compact {
          height: 32px;
          border-radius: 9999px;
          border-color: var(--border);
          background: var(--surface-2);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
        }

        .p-admin-combo-menu {
          position: absolute;
          top: calc(100% + 6px);
          min-width: 100%;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          box-shadow: var(--shadow-lg);
          z-index: 60;
          overflow: hidden;
        }

        .p-admin-combo-option {
          width: 100%;
          border: 0;
          background: transparent;
          text-align: left;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 500;
          padding: 8px 12px;
          transition: background-color 0.14s ease, color 0.14s ease;
        }

        .p-admin-combo-option:hover {
          background: var(--surface-2);
        }

        .p-admin-combo-option-active {
          background: var(--accent-fg);
          color: var(--surface-1);
        }

        .p-admin-combo-option-active:hover {
          background: var(--accent-fg);
          color: var(--surface-1);
        }

        .p-admin-combo-menu-participant {
          border-radius: 14px;
          border-color: var(--border);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
        }

        .p-admin-combo-menu-participant > div {
          max-height: 236px;
          padding: 4px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-strong) var(--surface-2);
        }

        .p-admin-combo-menu-participant > div::-webkit-scrollbar {
          width: 10px;
        }

        .p-admin-combo-menu-participant > div::-webkit-scrollbar-track {
          background: var(--surface-2);
          border-radius: 9999px;
          margin: 6px 2px;
        }

        .p-admin-combo-menu-participant > div::-webkit-scrollbar-thumb {
          background: var(--border-strong);
          border-radius: 9999px;
          border: 2px solid var(--surface-2);
        }

        .p-admin-combo-option-participant {
          border-radius: 10px;
          padding: 9px 10px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.25;
        }

        .p-admin-combo-option-participant + .p-admin-combo-option-participant {
          margin-top: 2px;
        }

        .p-admin-combo-option-primary {
          color: inherit;
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .p-admin-combo-option-secondary {
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 500;
        }

        .p-admin-combo-option-participant:hover {
          background: var(--surface-2);
        }

        .p-admin-combo-option-participant.p-admin-combo-option-active {
          background: var(--positive-bg);
          color: var(--accent-fg);
        }

        .p-admin-combo-option-participant.p-admin-combo-option-active:hover {
          background: var(--positive-bg);
          color: var(--accent-fg);
        }
      `}</style>
    </>
  );
}
