import Head from 'next/head';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, MoreVertical, Pencil, Plus, Repeat, Search, User, Users, Settings, X, BarChart3, Trophy, MessageSquare, ShoppingBag, FileText, GraduationCap, Lock, Trash2 } from 'lucide-react';
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
import ChangeTitularModal, { type ChangeTitularCandidate } from '../../components/admin/agenda/ChangeTitularModal';
import DuplicateClientDecisionModal from '../../components/admin/agenda/DuplicateClientDecisionModal';
import BookingAccountSummarySection from '../../components/admin/agenda/sections/BookingAccountSummarySection';
import BookingHistorySection from '../../components/admin/agenda/sections/BookingHistorySection';
import type {
  Booking,
  BookingConsumptionItem,
  BookingHistoryTimelineEvent,
  BookingDropPreview,
  BookingHistoryTimelineGroup,
  BookingKind,
  CancelRefundReasonType,
  ClubProductOption,
  ComboOption,
  Court,
  DraggingBookingMeta,
  DraftSelection,
  DuplicateClientCandidate,
  DuplicateDecisionActions,
  EditSeriesScope,
  EditingBaseline,
  Participant,
  ParticipantSuggestion,
  ParticipantUiState,
  PendingBookingPointer,
  RecurringCreatedItem,
  RecurringExecutionPlan,
  RecurringFrequencyPreset,
  RecurringOverlapItem,
  SeriesOperationResult,
  SeriesPaidOccurrence,
  SeriesScopePreviewSummary,
  SimplifiedSidebarSection,
  SportFilter,
  SuggestionPlacement,
} from '../../components/admin/agenda/types/agendaTypes';
import {
  buildSelectionDateTime,
  buildStartDateTimeFromSlot,
  endHour,
  formatLocalDate,
  getNextDateForDay,
  gridHeight,
  minutesToHourLabel,
  rowHeight,
  slotHeight,
  slotMinutes,
  slotsPerHour,
  slotToTime,
  slotToTimeAmPm,
  startHour,
  timeToSlot,
  totalSlots,
  toSelectionRange,
} from '../../components/admin/agenda/utils/agendaDateUtils';
import {
  blockContentVisibility,
  bookingBadgeColor,
  bookingColor,
  bookingPaymentBadgeColor,
  bookingPaymentLabel,
  bookingStatusLabel,
  formatPaymentMethodLabel,
  humanizeClubSlug,
  inferCourtSport,
  localizeLegacyUiText,
  normalizeBookingDisplayTitle,
  toUserSafeMessage,
} from '../../components/admin/agenda/utils/agendaDisplayUtils';
import {
  formatSeriesDateLabel,
  formatSeriesTimeLabel,
  mapSeriesAppliedItem,
  mapSeriesImpactItem,
} from '../../components/admin/agenda/utils/bookingHistoryDisplay';
import {
  buildParticipantContactFromFields,
  extractEmailFromParticipantContact,
  extractPhoneFromParticipantContact,
  resolvePlaygroundClientDni,
  resolvePlaygroundClientEmail,
  resolvePlaygroundClientPhone,
} from '../../components/admin/agenda/utils/bookingParticipantDisplay';
import { ClubService } from '../../services/ClubService';
import {
  buildDefaultParticipantsForBooking,
  buildStableParticipantRef,
  createInitialParticipants,
  findExistingParticipantMatch,
  mapAdminParticipantToPlaygroundParticipant,
  mapPersonSearchResultToParticipantSuggestion,
  participantExplicitIdentityKeys,
  resolveParticipantClientId,
  resolveParticipantSelectedUserId,
} from '../../components/admin/agenda/utils/bookingParticipantMappers';
import {
  isBlockingQuoteError,
  isOwnerLikeParticipantId,
  isOwnerLikeParticipantRef,
} from '../../components/admin/agenda/utils/bookingValidation';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { addAdminBookingParticipant, cancelBooking, cancelFixedBooking, changeBookingClient, confirmBooking, createBooking, createFixedBooking, getAdminBookingHistory, getAdminBookingParticipants, getAdminSchedule, getBookingById, getBookingFinancialSummary, getBookingQuote, removeAdminBookingParticipant, rescheduleFixedBooking, type AdminBookingParticipantDto, type BookingHistoryEntryDto } from '../../services/BookingService';
import AccountDrawer, {
  type AccountDrawerContext,
  type AccountDrawerInitialView,
} from '../../modules/cuentas/components/AccountDrawer';
import { listAccounts } from '../../services/AccountService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { reportUiError } from '../../utils/uiError';
import { ADMIN_Z_INDEX_CLASS } from '../../utils/adminZIndex';
import { AdminFeedbackBanner } from '../../components/admin/ui/AdminFeedback';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, hasOperatorAccess, normalizeSessionUser } from '../../utils/session';
import { normalizeApiError } from '../../utils/apiError';
import { resolveBookingErrorBehavior } from '../../utils/bookingErrorMap';
import BookingDrawerShell from '../../modules/admin/bookingDrawer/components/BookingDrawerShell';
import { bookingDrawerReducer, initialBookingDrawerState } from '../../modules/admin/bookingDrawer/reducer';

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


function resolveHoverParticipantsForBooking(booking: Booking) {
  const ownerName = String(booking.title || '').trim();
  const hoverPayment = booking.hoverPayment;
  const status = hoverPayment?.status || (booking.paymentState === 'paid' ? 'PAID' : 'UNPAID');
  const chargeMode = String(hoverPayment?.chargeMode || 'INDIVIDUAL').trim().toUpperCase();
  const modeLabel = chargeMode === 'SHARED' ? 'Cuenta compartida' : 'Cuenta individual';
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

  const dedupedParticipants = normalizedParticipants.reduce<typeof normalizedParticipants>((accumulator, participant) => {
    const participantRefKey = String(participant.ref || '').trim().toLowerCase();
    const participantNameKey = String(participant.name || '').trim().toLowerCase();
    const existingIndex = accumulator.findIndex((current) => {
      const currentRefKey = String(current.ref || '').trim().toLowerCase();
      const currentNameKey = String(current.name || '').trim().toLowerCase();
      return (
        (participantRefKey && currentRefKey && participantRefKey === currentRefKey) ||
        (!participantRefKey && !currentRefKey && participantNameKey && participantNameKey === currentNameKey)
      );
    });
    if (existingIndex === -1) {
      accumulator.push(participant);
      return accumulator;
    }
    if (participant.isOwner && !accumulator[existingIndex].isOwner) {
      accumulator[existingIndex] = participant;
    }
    return accumulator;
  }, []);

  const participants =
    dedupedParticipants.length > 0
      ? dedupedParticipants
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
    const activeParticipants = participants.filter((participant) => participant.name.trim().length > 0);
    const target = activeParticipants.length > 0
      ? activeParticipants
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

  const orderedParticipants = [
    ...participants.filter((participant) => participant.isOwner),
    ...participants.filter((participant) => !participant.isOwner),
  ];

  return orderedParticipants.map((participant) => {
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

function mapScheduleParticipantForHover(rawParticipant: any, ownerFallbackName: string) {
  const ref = String(
    rawParticipant?.entityRef ||
      rawParticipant?.ref ||
      (rawParticipant?.clientId ? `client:${String(rawParticipant.clientId).trim()}` : '') ||
      (rawParticipant?.userId ? `user:${Number(rawParticipant.userId)}` : '')
  ).trim();
  const role = String(rawParticipant?.role || '').trim().toUpperCase();
  const name = String(
    rawParticipant?.displayName ||
      rawParticipant?.invitedName ||
      rawParticipant?.name ||
      rawParticipant?.client?.name ||
      rawParticipant?.user?.name ||
      ''
  ).trim();
  const isOwner = role === 'ORGANIZER' || Boolean(rawParticipant?.isOwner) || isOwnerLikeParticipantRef(ref);

  return {
    ref,
    name: name || (isOwner ? ownerFallbackName : ''),
    isOwner,
  };
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
  const fallbackHoverParticipants = Array.isArray(booking?.participants)
    ? booking.participants
        .map((rawParticipant: any) => mapScheduleParticipantForHover(rawParticipant, resolvedTitle))
        .filter((participant: { ref: string; name: string }) => participant.ref || participant.name)
    : [];
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
        : fallbackHoverParticipants,
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

export default function AdminAgendaPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [sportFilter, setSportFilter] = useState<SportFilter>('Todos');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [courtsData, setCourtsData] = useState<Court[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [dragSelection, setDragSelection] = useState<DraftSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingBookingId, setDraggingBookingId] = useState<string | null>(null);
  const [draggingBookingMeta, setDraggingBookingMeta] = useState<DraggingBookingMeta | null>(null);
  const [bookingDropPreview, setBookingDropPreview] = useState<BookingDropPreview | null>(null);
  const draggingBookingMetaRef = useRef<DraggingBookingMeta | null>(null);
  const pendingBookingPointerRef = useRef<PendingBookingPointer | null>(null);
  const lastValidDropPreviewRef = useRef<BookingDropPreview | null>(null);
  const dragGrabOffsetSlotsRef = useRef<number>(0);
  const modalBackdropPressedRef = useRef(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedStartSlot, setSelectedStartSlot] = useState(2);
  const [selectedEndSlot, setSelectedEndSlot] = useState(4);
  const [participants, setParticipants] = useState<Participant[]>(() => createInitialParticipants());
  const [simplifiedOwnerAdded, setSimplifiedOwnerAdded] = useState(false);
  const [simplifiedEditingParticipantId, setSimplifiedEditingParticipantId] = useState<string | null>(null);
  const [simplifiedNewParticipantOpen, setSimplifiedNewParticipantOpen] = useState(false);
  const [simplifiedNewParticipantName, setSimplifiedNewParticipantName] = useState('');
  const [simplifiedNewParticipantContact, setSimplifiedNewParticipantContact] = useState('');
  const [simplifiedNewParticipantSourceTypeDraft, setSimplifiedNewParticipantSourceTypeDraft] =
    useState<Participant['sourceType']>('guest');
  const [simplifiedNewParticipantEntityRefDraft, setSimplifiedNewParticipantEntityRefDraft] = useState('');
  const [simplifiedNewParticipantSelectedUserIdDraft, setSimplifiedNewParticipantSelectedUserIdDraft] = useState<number | undefined>(undefined);
  const [simplifiedNewParticipantPersonKindDraft, setSimplifiedNewParticipantPersonKindDraft] = useState<Participant['personKind'] | undefined>(undefined);
  const [simplifiedNewParticipantPersonKeyDraft, setSimplifiedNewParticipantPersonKeyDraft] = useState<string | undefined>(undefined);
  const [simplifiedNewParticipantPersonSearchQueryDraft, setSimplifiedNewParticipantPersonSearchQueryDraft] = useState<string | undefined>(undefined);
  const [simplifiedNewParticipantBadgesDraft, setSimplifiedNewParticipantBadgesDraft] = useState<string[] | undefined>(undefined);
  const [persistedAdminParticipants, setPersistedAdminParticipants] = useState<AdminBookingParticipantDto[] | null>(null);
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
  const [bookingHistoryEntries, setBookingHistoryEntries] = useState<BookingHistoryEntryDto[]>([]);
  const [bookingTimelineLoading, setBookingTimelineLoading] = useState(false);
  const [bookingTimelineError, setBookingTimelineError] = useState('');
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [accountDrawerAccountId, setAccountDrawerAccountId] = useState<string | null>(null);
  const [accountDrawerInitialView, setAccountDrawerInitialView] =
    useState<AccountDrawerInitialView>('overview');
  const [accountDrawerContext, setAccountDrawerContext] = useState<AccountDrawerContext | undefined>(undefined);
  const [bookingFinancial, setBookingFinancial] = useState<{
    courtTotal: number;
    itemsTotal: number;
    total: number;
    paid: number;
    remaining: number;
    confirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
  } | null>(null);
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
  const handleModalBackdropPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    modalBackdropPressedRef.current = event.target === event.currentTarget;
  }, []);
  const handleModalBackdropPointerUp = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    onClose: () => void
  ) => {
    const shouldClose = modalBackdropPressedRef.current && event.target === event.currentTarget;
    modalBackdropPressedRef.current = false;
    if (shouldClose) onClose();
  }, []);
  const moveDate = useCallback((days: number) => {
    if (!Number.isFinite(days) || days === 0) return;
    setSelectedDate((previous) => {
      const next = new Date(previous);
      next.setDate(next.getDate() + days);
      return next;
    });
    setFormError('');
  }, []);
  const nowLineTop = useMemo(() => {
    const now = new Date(nowTick);
    const isSameDay =
      now.getFullYear() === selectedDate.getFullYear() &&
      now.getMonth() === selectedDate.getMonth() &&
      now.getDate() === selectedDate.getDate();
    if (!isSameDay) return null;
    const minutesFromStart = now.getHours() * 60 + now.getMinutes() - startHour * 60;
    if (minutesFromStart < 0) return null;
    const maxMinutes = (endHour - startHour) * 60;
    const clampedMinutes = Math.min(minutesFromStart, maxMinutes);
    return Number(((clampedMinutes / slotMinutes) * slotHeight).toFixed(2));
  }, [nowTick, selectedDate]);
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
  const [changeTitularModalOpen, setChangeTitularModalOpen] = useState(false);
  const [changeTitularSearch, setChangeTitularSearch] = useState('');
  const [changeTitularReason, setChangeTitularReason] = useState('');
  const [changeTitularLoading, setChangeTitularLoading] = useState(false);
  const [changeTitularSubmitting, setChangeTitularSubmitting] = useState(false);
  const [changeTitularError, setChangeTitularError] = useState('');
  const [changeTitularCandidates, setChangeTitularCandidates] = useState<ChangeTitularCandidate[]>([]);
  const [changeTitularSelectedKey, setChangeTitularSelectedKey] = useState('');
  const [changeTitularDraftName, setChangeTitularDraftName] = useState('');
  const [changeTitularDraftPhone, setChangeTitularDraftPhone] = useState('');
  const [changeTitularDraftEmail, setChangeTitularDraftEmail] = useState('');
  const [changeTitularDraftDni, setChangeTitularDraftDni] = useState('');
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
  const [participantUiState, setParticipantUiState] = useState<ParticipantUiState>({
    mode: 'idle',
    participantId: null,
  });
  const [participantSearchOpenId, setParticipantSearchOpenId] = useState<string | null>(null);
  const [participantSearchLoadingId, setParticipantSearchLoadingId] = useState<string | null>(null);
  const [participantSuggestionsById, setParticipantSuggestionsById] = useState<Record<string, ParticipantSuggestion[]>>({});
  const [bookingDrawerState, bookingDrawerDispatch] = useReducer(
    bookingDrawerReducer,
    initialBookingDrawerState
  );
  const [recurringCourtsMenuOpen, setRecurringCourtsMenuOpen] = useState(false);
  const [selectedClubIdState, setSelectedClubIdState] = useState<number>(0);
  const [activeClubTimeZone, setActiveClubTimeZone] = useState<string>('');
  const [bookingHoverPreview, setBookingHoverPreview] = useState<{
    booking: Booking;
    x: number;
    y: number;
  } | null>(null);
  const [participantLabelByRefCache, setParticipantLabelByRefCache] = useState<Record<string, string>>({});
  const [isQuickDatePickerOpen, setIsQuickDatePickerOpen] = useState(false);
  const participantSearchSeqRef = useRef(0);
  const recurringCourtsMenuRef = useRef<HTMLDivElement | null>(null);
  const quickDateInputRef = useRef<HTMLInputElement | null>(null);
  const participantContactInputRef = useRef<HTMLInputElement | null>(null);
  const simplifiedOwnerInputContainerRef = useRef<HTMLDivElement | null>(null);
  const simplifiedOwnerPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const simplifiedNewParticipantInputContainerRef = useRef<HTMLDivElement | null>(null);
  const simplifiedSidebarFooterRef = useRef<HTMLElement | null>(null);
  const agendaSurfaceRef = useRef<HTMLElement | null>(null);
  const agendaScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrollDateKeyRef = useRef<string | null>(null);
  const drawerScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const drawerCloseCleanupTimerRef = useRef<number | null>(null);
  const bookingFinancialRequestSeqRef = useRef(0);
  const bookingTimelineRequestSeqRef = useRef(0);
  const bookingConsumptionRequestSeqRef = useRef(0);
  const consumptionQuoteRequestSeqRef = useRef(0);
  const duplicateDecisionActionsRef = useRef<DuplicateDecisionActions | null>(null);
  const activeDrawerBookingIdRef = useRef<number | null>(null);
  const accountDrawerBookingIdRef = useRef<number | null>(null);
  const refreshPersistedBookingViewRef = useRef<null | ((bookingId: number, options?: {
    schedule?: boolean;
    participants?: boolean;
    financial?: boolean;
    consumptions?: boolean;
    history?: boolean;
    forceDrawerSections?: boolean;
  }) => Promise<any>)>(null);
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

  const showAgendaToast = useCallback((
    message: string,
    tone: 'info' | 'success' | 'warning' | 'error' = 'error'
  ) => {
    const next = toUserSafeMessage(message, '');
    if (!next) return;
    showAdminToast(next, tone);
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
        showAgendaToast(safeMessage);
      }
      return { normalized, behavior, message: safeMessage };
    },
    [showAgendaToast]
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
        showAgendaToast(safeMessage);
      }
    },
    [showAgendaToast]
  );

  const closeDuplicateDecisionModal = useCallback(() => {
    setDuplicateDecisionOpen(false);
    setDuplicateDecisionLoading(false);
    setDuplicateDecisionError('');
    setDuplicateDecisionCandidates([]);
    setDuplicateDecisionSelectedClientId('');
    duplicateDecisionActionsRef.current = null;
  }, []);

  const closeRecurringResultModal = useCallback(() => {
    setRecurringOverlapModalOpen(false);
  }, []);

  const closeDeleteBookingFlow = useCallback(() => {
    if (isDeletingBooking) return;
    setDeleteBookingConfirmOpen(false);
    setDeleteBookingFinalConfirmOpen(false);
    setSeriesDeletePreviewScope(null);
    setSeriesDeletePreviewSummary(null);
    setSeriesDeletePreviewLoading(false);
    setCancelBookingFlowError('');
    setCancelRefundAmountInput('');
    setCancelRefundReasonType('FULL');
    setCancelRefundExecutionNotes('');
    setCancelRefundExecuteNow(true);
  }, [isDeletingBooking]);

  const closeSeriesOperationResult = useCallback(() => {
    setSeriesOperationResultOpen(false);
    setSeriesOperationResult(null);
  }, []);

  const openDuplicateDecisionModal = useCallback((params: {
    candidates: DuplicateClientCandidate[];
    selectedClientId?: string;
    onUseExisting: (clientId: string) => Promise<void>;
    onCreateNew: () => Promise<void>;
  }) => {
    const normalizedCandidates = (Array.isArray(params.candidates) ? params.candidates : []).filter(
      (candidate) => String(candidate?.id || '').trim().length > 0
    );
    const initialSelectedClientId = String(
      params.selectedClientId || normalizedCandidates[0]?.id || ''
    ).trim();
    duplicateDecisionActionsRef.current = {
      onUseExisting: params.onUseExisting,
      onCreateNew: params.onCreateNew,
    };
    setDuplicateDecisionCandidates(normalizedCandidates);
    setDuplicateDecisionSelectedClientId(initialSelectedClientId);
    setDuplicateDecisionError('');
    setDuplicateDecisionLoading(false);
    setDuplicateDecisionOpen(true);
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
    const actions = duplicateDecisionActionsRef.current;
    if (!actions) return;
    const selectedClientId = String(duplicateDecisionSelectedClientId || '').trim();
    if (mode === 'USE_EXISTING' && !selectedClientId) {
      setDuplicateDecisionError('Seleccioná un cliente existente para continuar.');
      return;
    }

    setDuplicateDecisionLoading(true);
    setDuplicateDecisionError('');
    try {
      if (mode === 'USE_EXISTING') {
        await actions.onUseExisting(selectedClientId);
      } else {
        await actions.onCreateNew();
      }
      closeDuplicateDecisionModal();
    } catch (error: any) {
      const normalized = normalizeApiError(error, 'No se pudo completar la operación.');
      if (normalized.code === 'CLIENT_POSSIBLE_DUPLICATE') {
        const nextCandidates = extractDuplicateCandidatesFromMeta(normalized.meta);
        if (nextCandidates.length > 0) {
          setDuplicateDecisionCandidates(nextCandidates);
          const nextPrimaryClientId = String(normalized.meta?.primaryClientId || '').trim();
          setDuplicateDecisionSelectedClientId(nextPrimaryClientId || String(nextCandidates[0]?.id || ''));
        }
      }
      setDuplicateDecisionError(toUserSafeMessage(normalized.message, 'No se pudo completar la operación.'));
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
  const timeFieldError = String(fieldErrors.time || '').trim();
  const dateFieldError = String(fieldErrors.date || '').trim();
  const courtFieldError = String(fieldErrors.court || '').trim();
  const ownerFieldError = String(fieldErrors.owner || '').trim();
  const participantsFieldError = String(fieldErrors.participants || '').trim();

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

  useEffect(() => {
    if (!Number.isInteger(selectedClubIdState) || selectedClubIdState <= 0) {
      setActiveClubTimeZone('');
      return;
    }
    let cancelled = false;
    void ClubService.getClubById(selectedClubIdState)
      .then((club) => {
        if (!cancelled) {
          setActiveClubTimeZone(String(club?.timeZone || '').trim());
        }
      })
      .catch(() => {
        if (!cancelled) setActiveClubTimeZone('');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClubIdState]);

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
    activeDrawerBookingIdRef.current =
      Number.isFinite(Number(booking.id)) && Number(booking.id) > 0 ? Number(booking.id) : null;
    bookingFinancialRequestSeqRef.current += 1;
    bookingTimelineRequestSeqRef.current += 1;
    setIsBookingFinancialLoading(booking.state !== 'blocked');
    setBookingTimelineLoading(booking.state !== 'blocked');
    setBookingTimelineError('');
    setBookingHistoryEntries([]);
    setBookingFinancial(null);
    setPersistedAdminParticipants(null);
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

  const resetSimplifiedNewParticipantDraft = useCallback(() => {
    setSimplifiedNewParticipantOpen(false);
    setSimplifiedNewParticipantName('');
    setSimplifiedNewParticipantContact('');
    setSimplifiedNewParticipantSourceTypeDraft('guest');
    setSimplifiedNewParticipantEntityRefDraft('');
    setSimplifiedNewParticipantSelectedUserIdDraft(undefined);
    setSimplifiedNewParticipantPersonKindDraft(undefined);
    setSimplifiedNewParticipantPersonKeyDraft(undefined);
    setSimplifiedNewParticipantPersonSearchQueryDraft(undefined);
    setSimplifiedNewParticipantBadgesDraft(undefined);
    setSimplifiedNewParticipantSuggestionsOpen(false);
    setSimplifiedNewParticipantSearchLoading(false);
    setSimplifiedNewParticipantSuggestions([]);
  }, []);
  const resetDrawerParticipantVisualState = useCallback(() => {
    setParticipants(createInitialParticipants());
    setSimplifiedOwnerAdded(false);
    setSimplifiedEditingParticipantId(null);
    setSimplifiedOwnerSuggestionsOpen(false);
    setSimplifiedOwnerSearchLoading(false);
    setSimplifiedOwnerSuggestions([]);
    resetSimplifiedNewParticipantDraft();
  }, [resetSimplifiedNewParticipantDraft]);
  const closeBookingDrawer = useCallback((options?: { clearFormError?: boolean }) => {
    setDrawerOpen(false);
    setEditingBookingId(null);
    setEditingBaseline(null);
    if (options?.clearFormError !== false) {
      setFormError('');
    }
    resetDrawerParticipantVisualState();
  }, [resetDrawerParticipantVisualState]);

  const loadAdminParticipantsForBooking = useCallback(async (bookingId: number) => {
    const items = await getAdminBookingParticipants(bookingId);
    setPersistedAdminParticipants(Array.isArray(items) ? items : []);
    return Array.isArray(items) ? items : [];
  }, []);

  const loadBookingHistoryForDrawer = useCallback(async (bookingId: number) => {
    const timelineRequestSeq = bookingTimelineRequestSeqRef.current + 1;
    bookingTimelineRequestSeqRef.current = timelineRequestSeq;
    setBookingTimelineLoading(true);
    setBookingTimelineError('');
    try {
      const events = await getAdminBookingHistory(bookingId);
      if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
        setBookingHistoryEntries(Array.isArray(events) ? events : []);
      }
      return Array.isArray(events) ? events : [];
    } catch (error: any) {
      if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
        setBookingHistoryEntries([]);
        const normalized = normalizeApiError(error, 'No se pudo cargar el historial de la reserva.');
        setBookingTimelineError(toUserSafeMessage(normalized.message, 'No se pudo cargar el historial de la reserva.'));
      }
      throw error;
    } finally {
      if (bookingTimelineRequestSeqRef.current === timelineRequestSeq) {
        setBookingTimelineLoading(false);
      }
    }
  }, []);

  const buildParticipantPersonSelection = useCallback(
    (
      draft: Pick<
        Participant,
        | 'name'
        | 'contact'
        | 'dni'
        | 'sourceType'
        | 'entityRef'
        | 'selectedUserId'
        | 'personKind'
        | 'personKey'
        | 'personSearchQuery'
      >,
      options?: { forceCreateNew?: boolean }
    ) => {
      const clientId = resolveParticipantClientId(draft as Participant);
      if (clientId) {
        return {
          kind: 'clubClient' as const,
          clientId,
        };
      }

      const selectedUserId = resolveParticipantSelectedUserId(draft as Participant);
      const personKey = String(draft.personKey || '').trim();
      const personSearchQuery = String(draft.personSearchQuery || '').trim();
      if (selectedUserId > 0 && personKey && personSearchQuery.length >= 2) {
        return {
          kind: (draft.personKind === 'linked' ? 'linked' : 'systemUser') as 'linked' | 'systemUser',
          userId: selectedUserId,
          personKey,
          searchQuery: personSearchQuery,
        };
      }

      const phone = resolvePlaygroundClientPhone(draft as Participant);
      if (!phone) return null;
      return {
        kind: 'newClient' as const,
        name: String(draft.name || '').trim(),
        phone,
        email: resolvePlaygroundClientEmail(draft as Participant) || undefined,
        dni: resolvePlaygroundClientDni(draft as Participant) || undefined,
        forceCreateNew: Boolean(options?.forceCreateNew),
      };
    },
    []
  );

  const addParticipantToExistingBooking = useCallback(async (
    bookingId: number,
    participantDraft: Pick<
      Participant,
      | 'name'
      | 'contact'
      | 'dni'
      | 'sourceType'
      | 'entityRef'
      | 'selectedUserId'
      | 'personKind'
      | 'personKey'
      | 'personSearchQuery'
    >,
    options?: {
      forceCreateNew?: boolean;
      successMessage?: string;
      onSuccess?: () => void;
    }
  ): Promise<'added' | 'deferred'> => {
    const selection = buildParticipantPersonSelection(participantDraft, {
      forceCreateNew: options?.forceCreateNew,
    });
    if (!selection) {
      throw new Error('Completá el participante con una persona válida o cargá un teléfono.');
    }

    try {
      await addAdminBookingParticipant(bookingId, {
        personSelection: selection as any,
      });
      await refreshPersistedBookingViewRef.current?.(bookingId, {
        participants: true,
        schedule: true,
        history: true,
      });
      options?.onSuccess?.();
      if (options?.successMessage) {
        showAgendaToast(options.successMessage, 'success');
      }
      return 'added';
    } catch (error: any) {
      const normalized = normalizeApiError(error, 'No se pudo agregar el participante.');
      const candidateRows = extractDuplicateCandidatesFromMeta(normalized.meta);
      const isNewClientDraft = selection.kind === 'newClient';
      if (normalized.code === 'CLIENT_POSSIBLE_DUPLICATE' && isNewClientDraft && candidateRows.length > 0) {
        const currentDraft = {
          ...participantDraft,
        };
        openDuplicateDecisionModal({
          candidates: candidateRows,
          selectedClientId: String(normalized.meta?.primaryClientId || candidateRows[0]?.id || ''),
          onUseExisting: async (selectedClientId) => {
            await addParticipantToExistingBooking(
              bookingId,
              {
                ...currentDraft,
                sourceType: 'clubClient',
                entityRef: `client:${selectedClientId}`,
                selectedUserId: undefined,
                personKind: 'clubClient',
                personKey: undefined,
                personSearchQuery: undefined,
              },
              options
            );
          },
          onCreateNew: async () => {
            await addParticipantToExistingBooking(
              bookingId,
              currentDraft,
              {
                ...options,
                forceCreateNew: true,
              }
            );
          },
        });
        return 'deferred';
      }
      throw error;
    }
  }, [
    buildParticipantPersonSelection,
    extractDuplicateCandidatesFromMeta,
    openDuplicateDecisionModal,
    showAgendaToast,
  ]);

  const removePersistedParticipantFromBooking = useCallback(async (
    bookingId: number,
    participantId: string
  ) => {
    await removeAdminBookingParticipant(bookingId, participantId);
    await refreshPersistedBookingViewRef.current?.(bookingId, {
      participants: true,
      schedule: true,
      history: true,
    });
  }, []);

  const removeParticipant = useCallback(async (participantId: string) => {
    const safeParticipantId = String(participantId || '').trim();
    if (!safeParticipantId) return;
    const participant = participants.find((item) => item.id === safeParticipantId);
    if (!participant || participant.isOwner) return;

    if (persistedEditingBookingId && participant.bookingParticipantId) {
      await removePersistedParticipantFromBooking(
        persistedEditingBookingId,
        participant.bookingParticipantId
      );
      showAgendaToast('Participante eliminado.', 'success');
      return;
    }

    setParticipants((previous) => previous.filter((item) => item.id !== safeParticipantId));
    showAgendaToast('Participante eliminado.', 'success');
  }, [
    participants,
    persistedEditingBookingId,
    removePersistedParticipantFromBooking,
    showAgendaToast,
  ]);

  const syncDraftParticipantsToPersistedBooking = useCallback(async (
    bookingId: number,
    participantDrafts: Participant[]
  ): Promise<'completed' | 'deferred'> => {
    const queue = participantDrafts.filter(
      (participant) => !participant.isOwner && String(participant.name || '').trim().length > 0
    );
    if (queue.length === 0) {
      await loadAdminParticipantsForBooking(bookingId);
      return 'completed';
    }

    for (const participant of queue) {
      const result = await addParticipantToExistingBooking(bookingId, participant);
      if (result === 'deferred') return 'deferred';
    }

    await loadAdminParticipantsForBooking(bookingId);
    return 'completed';
  }, [addParticipantToExistingBooking, loadAdminParticipantsForBooking]);

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
        const rows = await ClubAdminService.searchPeople(slug, query);
        if (cancelled) return;
        const normalizedRows = (Array.isArray(rows) ? rows : [])
          .filter((row: any) => String(row?.kind || '').trim() !== 'newClientSuggestion')
          .map((row: any) => ({
            key: String(row?.personKey || row?.clientId || row?.userId || '').trim(),
            kind: String(row?.kind || '').trim() as ChangeTitularCandidate['kind'],
            clientId: String(row?.clientId || '').trim() || undefined,
            userId: Number.isFinite(Number(row?.userId || 0)) && Number(row?.userId) > 0 ? Number(row.userId) : undefined,
            name: String(row?.displayName || '').trim() || 'Persona sin nombre',
            phone: String(row?.phone || '').trim() || undefined,
            email: String(row?.email || '').trim() || undefined,
            badges: Array.isArray(row?.badges) ? row.badges.filter(Boolean).map(String) : [],
            personKey: String(row?.personKey || '').trim() || undefined,
            searchQuery: query,
          }))
          .filter((candidate: any) => candidate.key.length > 0);
        setChangeTitularCandidates(normalizedRows);
      } catch (error: any) {
        if (cancelled) return;
        setChangeTitularCandidates([]);
        const normalized = normalizeApiError(error, 'No se pudo buscar clientes.');
        setChangeTitularError(toUserSafeMessage(normalized.message, 'No se pudo buscar clientes.'));
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
    setChangeTitularSelectedKey('');
    setChangeTitularDraftName('');
    setChangeTitularDraftPhone('');
    setChangeTitularDraftEmail('');
    setChangeTitularDraftDni('');
  }, []);

  const closeChangeTitularModal = useCallback(() => {
    if (changeTitularSubmitting) return;
    setChangeTitularModalOpen(false);
    setChangeTitularSearch('');
    setChangeTitularReason('');
    setChangeTitularError('');
    setChangeTitularCandidates([]);
    setChangeTitularSelectedKey('');
    setChangeTitularDraftName('');
    setChangeTitularDraftPhone('');
    setChangeTitularDraftEmail('');
    setChangeTitularDraftDni('');
  }, [changeTitularSubmitting]);

  const changeTitularSelectedCandidate = useMemo(
    () =>
      changeTitularCandidates.find(
        (candidate) => String(candidate.key) === String(changeTitularSelectedKey)
      ) || null,
    [changeTitularCandidates, changeTitularSelectedKey]
  );

  const submitChangeTitular = useCallback(async () => {
    if (changeTitularSubmitting) return;
    const bookingId = Number(editingBookingId || 0);
    const selectedCandidate = changeTitularSelectedCandidate;
    const newClientId = String(selectedCandidate?.kind === 'clubClient' ? (selectedCandidate?.clientId || '') : '').trim();
    const selectedUserId = Number(selectedCandidate?.userId || 0);
    const changeTitularOwnerSelection =
      selectedCandidate && (selectedCandidate.kind === 'linked' || selectedCandidate.kind === 'systemUser') && selectedUserId > 0
        ? {
            kind: selectedCandidate.kind,
            userId: selectedUserId,
            personKey: String(selectedCandidate.personKey || '').trim(),
            searchQuery: String(selectedCandidate.searchQuery || '').trim(),
          }
        : null;
    const isDraftMode =
      !selectedCandidate &&
      String(changeTitularDraftName || '').trim().length >= 2;
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      setChangeTitularError('Reserva inválida.');
      return;
    }
    if (!newClientId && !changeTitularOwnerSelection && !isDraftMode) {
      setChangeTitularError('Seleccioná una persona o cargá un nuevo titular para continuar.');
      return;
    }
    const currentClientId = String(editingBooking?.clientId || '').trim();
    if (currentClientId && newClientId && currentClientId === newClientId) {
      setChangeTitularError('Ese cliente ya es el titular actual.');
      return;
    }

    setChangeTitularSubmitting(true);
    setChangeTitularError('');
    try {
      await changeBookingClient(bookingId, {
        ...(newClientId ? { newClientId } : {}),
        ...(changeTitularOwnerSelection ? { ownerSelection: changeTitularOwnerSelection } : {}),
        ...(!newClientId && !changeTitularOwnerSelection && isDraftMode
          ? {
              newClient: {
                name: String(changeTitularDraftName || '').trim(),
                phone: String(changeTitularDraftPhone || '').trim() || undefined,
                email: String(changeTitularDraftEmail || '').trim() || undefined,
                dni: String(changeTitularDraftDni || '').trim() || undefined,
              },
            }
          : {}),
        reason: String(changeTitularReason || '').trim() || undefined,
      });
      await refreshPersistedBookingViewRef.current?.(bookingId, {
        schedule: true,
        participants: true,
        financial: true,
        history: true,
      });
      closeChangeTitularModal();
      setEditingBookingId(String(bookingId));
      showAgendaToast('Titular actualizado correctamente.', 'success');
    } catch (error: any) {
      const normalized = normalizeApiError(error, 'No se pudo cambiar el titular.');
      const candidateRows = extractDuplicateCandidatesFromMeta(normalized.meta);
      if (normalized.code === 'CLIENT_POSSIBLE_DUPLICATE' && isDraftMode && candidateRows.length > 0) {
        const nextDraftName = String(changeTitularDraftName || '').trim();
        const nextDraftPhone = String(changeTitularDraftPhone || '').trim();
        const nextDraftEmail = String(changeTitularDraftEmail || '').trim();
        const nextDraftDni = String(changeTitularDraftDni || '').trim();
        const nextReason = String(changeTitularReason || '').trim() || undefined;
        openDuplicateDecisionModal({
          candidates: candidateRows,
          selectedClientId: String(normalized.meta?.primaryClientId || candidateRows[0]?.id || ''),
          onUseExisting: async (selectedClientId) => {
            await changeBookingClient(bookingId, {
              newClientId: selectedClientId,
              reason: nextReason,
            });
            await refreshPersistedBookingViewRef.current?.(bookingId, {
              schedule: true,
              participants: true,
              financial: true,
              history: true,
            });
            closeChangeTitularModal();
            setEditingBookingId(String(bookingId));
            showAgendaToast('Titular actualizado con el cliente existente seleccionado.', 'success');
          },
          onCreateNew: async () => {
            await changeBookingClient(bookingId, {
              newClient: {
                name: nextDraftName,
                phone: nextDraftPhone || undefined,
                email: nextDraftEmail || undefined,
                dni: nextDraftDni || undefined,
                duplicateResolution: 'CREATE_NEW',
              },
              reason: nextReason,
            });
            await refreshPersistedBookingViewRef.current?.(bookingId, {
              schedule: true,
              participants: true,
              financial: true,
              history: true,
            });
            closeChangeTitularModal();
            setEditingBookingId(String(bookingId));
            showAgendaToast('Titular actualizado creando un cliente nuevo.', 'success');
          },
        });
        setChangeTitularError('');
        return;
      }
      setChangeTitularError(toUserSafeMessage(normalized.message, 'No se pudo cambiar el titular.'));
    } finally {
      setChangeTitularSubmitting(false);
    }
  }, [
    changeTitularReason,
    changeTitularSubmitting,
    changeTitularSelectedCandidate,
    changeTitularDraftDni,
    changeTitularDraftEmail,
    changeTitularDraftName,
    changeTitularDraftPhone,
    closeChangeTitularModal,
    extractDuplicateCandidatesFromMeta,
    editingBooking?.clientId,
    editingBookingId,
    openDuplicateDecisionModal,
    showAgendaToast,
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
      const normalized = normalizeApiError(error, 'No se pudieron cargar los productos del club.');
      setConsumptionProductsError(toUserSafeMessage(normalized.message, 'No se pudieron cargar los productos del club.'));
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
        const normalized = normalizeApiError(error, 'No se pudieron cargar los consumos.');
        setBookingConsumptionError(toUserSafeMessage(normalized.message, 'No se pudieron cargar los consumos.'));
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

  const refreshPersistedBookingView = useCallback(async (
    bookingId: number,
    options?: {
      schedule?: boolean;
      participants?: boolean;
      financial?: boolean;
      consumptions?: boolean;
      history?: boolean;
      forceDrawerSections?: boolean;
    }
  ) => {
    if (!Number.isFinite(bookingId) || bookingId <= 0) return {};

    const targetOptions = {
      schedule: Boolean(options?.schedule),
      participants: Boolean(options?.participants),
      financial: Boolean(options?.financial),
      consumptions: Boolean(options?.consumptions),
      history: Boolean(options?.history),
      forceDrawerSections: Boolean(options?.forceDrawerSections),
    };

    const shouldRefreshDrawerSections =
      targetOptions.forceDrawerSections ||
      (drawerOpen &&
        bookingKind !== 'block' &&
        Number(activeDrawerBookingIdRef.current || 0) === bookingId);

    const results: {
      schedule?: Booking[];
      participants?: AdminBookingParticipantDto[];
      financial?: Awaited<ReturnType<typeof refreshBookingFinancial>>;
    } = {};

    const tasks: Promise<void>[] = [];

    if (targetOptions.schedule) {
      tasks.push(
        reloadSchedule()
          .then((items) => {
            results.schedule = Array.isArray(items) ? items : [];
          })
          .catch((error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'refreshScheduleAfterMutation' }, error);
          })
      );
    }

    if (shouldRefreshDrawerSections && targetOptions.participants) {
      tasks.push(
        loadAdminParticipantsForBooking(bookingId)
          .then((items) => {
            results.participants = items;
          })
          .catch((error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'refreshBookingParticipantsAfterMutation' }, error);
            setPersistedAdminParticipants(null);
          })
      );
    }

    if (shouldRefreshDrawerSections && targetOptions.financial) {
      tasks.push(
        refreshBookingFinancial(bookingId)
          .then((summary) => {
            results.financial = summary;
          })
          .catch((error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'refreshBookingFinancialAfterMutation' }, error);
          })
      );
    }

    if (shouldRefreshDrawerSections && targetOptions.consumptions) {
      tasks.push(
        loadBookingConsumptions(bookingId)
          .then(() => undefined)
          .catch((error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'refreshBookingConsumptionsAfterMutation' }, error);
          })
      );
    }

    if (shouldRefreshDrawerSections && targetOptions.history) {
      tasks.push(
        loadBookingHistoryForDrawer(bookingId)
          .then(() => undefined)
          .catch((error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'refreshBookingHistoryAfterMutation' }, error);
          })
      );
    }

    await Promise.all(tasks);
    return results;
  }, [
    bookingKind,
    drawerOpen,
    loadAdminParticipantsForBooking,
    loadBookingConsumptions,
    loadBookingHistoryForDrawer,
    refreshBookingFinancial,
    reloadSchedule,
  ]);
  refreshPersistedBookingViewRef.current = refreshPersistedBookingView;

  const closeAgendaAccountDrawer = useCallback(() => {
    setAccountDrawerOpen(false);
    setAccountDrawerAccountId(null);
    setAccountDrawerInitialView('overview');
    setAccountDrawerContext(undefined);
    accountDrawerBookingIdRef.current = null;
  }, []);

  const openAgendaAccountDrawer = useCallback(async (
    bookingId: number,
    initialView: AccountDrawerInitialView = 'overview'
  ) => {
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      showAgendaToast('No se encontró una reserva válida para abrir la cuenta.');
      return;
    }

    const paymentLockedByPendingReservation = Boolean(
      bookingId === persistedEditingBookingId &&
      bookingKind !== 'block' &&
      bookingFinancial?.confirmationMode === 'MANUAL' &&
      editingBooking?.state === 'pending'
    );

    if (initialView === 'payment' && paymentLockedByPendingReservation) {
      showAgendaToast('Primero confirmá la reserva para habilitar cobros.');
      return;
    }

    try {
      const accounts = await listAccounts({ bookingId });
      const bookingAccount = Array.isArray(accounts) ? accounts[0] : null;
      if (!bookingAccount?.id) {
        showAgendaToast('No se encontró la cuenta de esta reserva.');
        return;
      }

      accountDrawerBookingIdRef.current = bookingId;
      setAccountDrawerAccountId(String(bookingAccount.id));
      setAccountDrawerInitialView(initialView);
      setAccountDrawerContext({
        title: String(editingBooking?.title || '').trim() || `Reserva #${bookingId}`,
        subtitle: selectedDate.toLocaleDateString('es-AR'),
        accountStatus: bookingAccount.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
      });
      setAccountDrawerOpen(true);
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'openAgendaAccountDrawer' }, error);
      showAgendaToast('No se pudo abrir la cuenta de la reserva.');
    }
  }, [
    bookingFinancial?.confirmationMode,
    bookingKind,
    editingBooking?.state,
    editingBooking?.title,
    persistedEditingBookingId,
    selectedDate,
    showAgendaToast,
  ]);

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
      setParticipantMenuId(null);
      setExpandedParticipantId(null);
      setParticipantSearchOpenId(null);
      setParticipantSearchLoadingId(null);
      setParticipantSuggestionsById({});
      setIsBookingFinancialLoading(false);
      setBookingTimelineLoading(false);
      setBookingTimelineError('');
      setBookingHistoryEntries([]);
      setBookingFinancial(null);
      setPersistedAdminParticipants(null);
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
      activeDrawerBookingIdRef.current = null;
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
    activeDrawerBookingIdRef.current = null;
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
    if (!drawerOpen || bookingKind === 'block') {
      setPersistedAdminParticipants(null);
      return;
    }
    if (!persistedEditingBookingId) {
      setPersistedAdminParticipants(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const items = await getAdminBookingParticipants(persistedEditingBookingId);
        if (cancelled) return;
        setPersistedAdminParticipants(Array.isArray(items) ? items : []);
      } catch (error) {
        if (cancelled) return;
        reportUiError({ area: 'AgendaPlayground', action: 'loadAdminBookingParticipants' }, error);
        setPersistedAdminParticipants(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bookingKind, drawerOpen, persistedEditingBookingId]);

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
        const normalized = normalizeApiError(error, 'No se pudo cotizar el consumo.');
        setConsumptionQuoteError(toUserSafeMessage(normalized.message, 'No se pudo cotizar el consumo.'));
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
        await refreshBookingFinancial(persistedEditingBookingId);
        if (cancelled) return;
      } catch {
        // Si falla la lectura financiera, mantenemos el estado actual local.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bookingKind, drawerOpen, persistedEditingBookingId, refreshBookingFinancial]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId || !editingBooking) return;
    if (!Array.isArray(persistedAdminParticipants) || persistedAdminParticipants.length === 0) return;

    setParticipants((previous) => {
      const mapped = persistedAdminParticipants.map((participant) =>
        mapAdminParticipantToPlaygroundParticipant(
          participant,
          findExistingParticipantMatch(participant, previous)
        )
      );
      if (!mapped.some((participant) => participant.isOwner)) {
        return buildDefaultParticipantsForBooking(editingBooking);
      }
      return mapped.map((participant) =>
        participant.isOwner ? participant : { ...participant, customPrice: null }
      );
    });
  }, [
    bookingKind,
    drawerOpen,
    editingBooking,
    persistedAdminParticipants,
    persistedEditingBookingId,
  ]);

  useEffect(() => {
    if (drawerOpen) return;
    setEditSeriesScopeModalOpen(false);
    setPendingSeriesScopeSave(null);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;

    let cancelled = false;
    const run = async () => {
      try {
        const events = await loadBookingHistoryForDrawer(persistedEditingBookingId);
        if (cancelled) return;
        setBookingHistoryEntries(Array.isArray(events) ? events : []);
      } catch {
        if (cancelled) return;
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
    loadBookingHistoryForDrawer,
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
          showAgendaToast(message);
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
          showAgendaToast(message);
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
          .then(() =>
            refreshPersistedBookingView(Number(meta.bookingId), {
              schedule: true,
              history: true,
            })
          )
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
        setParticipants(createInitialParticipants());
        setSimplifiedSidebarSection('DETAILS');
        bookingFinancialRequestSeqRef.current += 1;
        bookingTimelineRequestSeqRef.current += 1;
        setIsBookingFinancialLoading(false);
        setBookingTimelineLoading(false);
        setBookingTimelineError('');
        setBookingHistoryEntries([]);
        setBookingFinancial(null);
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
    refreshPersistedBookingView,
    reloadSchedule,
    selectedDate,
    showAgendaToast,
  ]);

  const visibleCourts = useMemo(() => {
    return effectiveCourts.filter((court) => {
      const bySport = sportFilter === 'Todos' || court.sport === sportFilter;
      return bySport;
    });
  }, [effectiveCourts, sportFilter]);

  const visibleCourtIds = useMemo(() => new Set(visibleCourts.map((court) => court.id)), [visibleCourts]);

  const visibleBookings = useMemo(() => bookings.filter((booking) => visibleCourtIds.has(booking.courtId)), [bookings, visibleCourtIds]);

  const hasOverlapForRange = useCallback((input: {
    courtId: string;
    startSlot: number;
    endSlot: number;
    ignoreBookingId?: string | null;
  }) => {
    const rangeStart = Math.min(input.startSlot, input.endSlot);
    const rangeEnd = Math.max(input.startSlot, input.endSlot);
    return visibleBookings.some((booking) => {
      if (booking.courtId !== input.courtId) return false;
      if (input.ignoreBookingId && String(booking.id) === String(input.ignoreBookingId)) return false;
      return rangeStart < booking.endSlot && rangeEnd > booking.startSlot;
    });
  }, [visibleBookings]);

  const openQuickCreateBooking = useCallback(
    (preferredCourtId?: string) => {
      const fallbackCourtId =
        (preferredCourtId && effectiveCourts.some((court) => court.id === preferredCourtId) ? preferredCourtId : '') ||
        (selectedCourtId && effectiveCourts.some((court) => court.id === selectedCourtId) ? selectedCourtId : '') ||
        effectiveCourts[0]?.id ||
        '';

      if (!fallbackCourtId) {
        showAgendaToast('Primero cargá al menos una cancha para crear una reserva.');
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
      setParticipants(createInitialParticipants());
      setSimplifiedSidebarSection('DETAILS');
      bookingFinancialRequestSeqRef.current += 1;
      bookingTimelineRequestSeqRef.current += 1;
      setIsBookingFinancialLoading(false);
      setBookingTimelineLoading(false);
      setBookingTimelineError('');
      setBookingHistoryEntries([]);
      setBookingFinancial(null);
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
      showAgendaToast,
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
  const hasScheduleChanges = useMemo(() => {
    if (!editingBaseline) return false;
    return (
      String(editingBaseline.courtId) !== String(selectedCourtId) ||
      Number(editingBaseline.startSlot) !== Number(selectedStartSlot) ||
      Number(editingBaseline.endSlot) !== Number(selectedEndSlot)
    );
  }, [editingBaseline, selectedCourtId, selectedEndSlot, selectedStartSlot]);
  const isCompletedReservation = Boolean(
    persistedEditingBookingId &&
    bookingKind !== 'block' &&
    editingBooking?.state === 'completed'
  );
  const isCompletedReservationScheduleLocked = isCompletedReservation;
  const isSelectionInPastBlocking = isSelectionInPast && (!editingBookingId || hasScheduleChanges);
  const shouldBlockSaveByQuote = hasBlockingQuoteError && (!editingBookingId || hasScheduleChanges);
  const hasConflict = useMemo(() => {
    if (!selectedCourtId) return false;
    const ignoreBookingId = editingBookingId && !hasScheduleChanges ? editingBookingId : null;
    return hasOverlapForRange({
      courtId: selectedCourtId,
      startSlot: selectedStartSlot,
      endSlot: selectedEndSlot,
      ignoreBookingId,
    });
  }, [
    editingBookingId,
    hasOverlapForRange,
    hasScheduleChanges,
    selectedCourtId,
    selectedEndSlot,
    selectedStartSlot,
  ]);
  const blockingActionMessage = isSelectionInPastBlocking
    ? 'No podés guardar una reserva en un horario pasado.'
    : shouldBlockSaveByQuote
      ? quoteError || 'No se pudo cotizar la reserva para ese horario.'
      : hasConflict
        ? 'Ese horario ya está ocupado en la cancha seleccionada.'
        : '';
  const hasBlockingActionError = blockingActionMessage.trim().length > 0;
  const isPaymentLockedByManualPending = Boolean(
    bookingKind !== 'block' &&
    bookingFinancial?.confirmationMode === 'MANUAL' &&
    editingBooking?.state === 'pending'
  );
  const selectedBookingKindLabel =
    bookingKind === 'block'
      ? 'Bloqueo'
      : isRecurringKind
        ? 'Serie'
        : editingBookingId
          ? 'Reserva'
          : 'Nueva reserva';
  const quickSummaryDateLabel = selectedDate.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const quickSummaryCourtsLabel = isRecurringKind
    ? (recurringCourtIds
        .map((courtId) => effectiveCourts.find((court) => court.id === courtId)?.name || '')
        .filter(Boolean)
        .join(', ') || (selectedCourt?.name || 'Sin cancha'))
    : (selectedCourt?.name || 'Sin cancha');
  const usesPersistedFinancialSummary = Boolean(persistedEditingBookingId && bookingKind !== 'block');
  const hasQuotedPrice = quotedFinalPrice != null || quotedListPrice != null;
  const isPersistedFinancialPending = usesPersistedFinancialSummary && (isBookingFinancialLoading || !bookingFinancial);
  const isQuoteFinancialPending =
    !usesPersistedFinancialSummary &&
    bookingKind !== 'block' &&
    (quoteLoading || !hasQuotedPrice);
  const isFinancialDisplayPending = isPersistedFinancialPending || isQuoteFinancialPending;
  const quotedBaseTotalPrice = quotedFinalPrice ?? quotedListPrice ?? 0;
  const sourceTotalPrice = usesPersistedFinancialSummary
    ? roundMoney(Number(bookingFinancial?.total || 0))
    : roundMoney(quotedBaseTotalPrice);
  const totalPrice = sourceTotalPrice;
  const simplifiedFinancialTotal = totalPrice;
  const simplifiedPaidAmount = usesPersistedFinancialSummary
    ? roundMoney(Number(bookingFinancial?.paid || 0))
    : 0;
  const simplifiedRemainingAmount = usesPersistedFinancialSummary
    ? roundMoney(Number(bookingFinancial?.remaining || 0))
    : roundMoney(Math.max(0, totalPrice - simplifiedPaidAmount));
  const bookingItemsAmount = roundMoney(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0)
  );
  const bookingConsumptionsPaid = roundMoney(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0)
  );
  const bookingConsumptionsRemaining = roundMoney(
    bookingConsumptionItems.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0)
  );
  const bookingCourtAmount = roundMoney(
    Number(bookingFinancial?.courtTotal ?? Math.max(0, totalPrice - bookingItemsAmount))
  );
  const billingSummary = {
    totalAmount: simplifiedFinancialTotal,
    paidAmount: simplifiedPaidAmount,
    remainingAmount: simplifiedRemainingAmount,
  };
  const shouldHideBillingUntilCreated = !persistedEditingBookingId;
  const shouldHideBillingUntilConfirmed = !shouldHideBillingUntilCreated && isPaymentLockedByManualPending;
  const showConfirmMainAction = Boolean(
    editingBookingId &&
    bookingKind !== 'block' &&
    editingBooking?.state === 'pending'
  );
  const reservationStatusLabel = editingBooking?.state === 'completed'
    ? 'Completada'
    : editingBooking?.state === 'confirmed'
      ? 'Confirmada'
      : editingBooking?.state === 'blocked'
        ? 'Bloqueada'
        : 'Pendiente';
  const reservationStatusTone = editingBooking?.state === 'completed'
    ? 'bg-p-positive-bg text-p-positive'
    : editingBooking?.state === 'confirmed'
      ? 'bg-p-accent-soft text-p-accent'
      : editingBooking?.state === 'blocked'
        ? 'bg-p-surface-3 text-p-text-secondary'
        : 'bg-p-warning-bg text-p-warning';
  const paymentStatusLabel = simplifiedRemainingAmount <= 0.009
    ? 'Pagado'
    : simplifiedPaidAmount > 0.009
      ? 'Parcial'
      : 'Pendiente';
  const paymentStatusTone = simplifiedRemainingAmount <= 0.009
    ? 'bg-p-positive-bg text-p-positive'
    : simplifiedPaidAmount > 0.009
      ? 'bg-p-warning-bg text-p-warning'
      : 'bg-p-surface-3 text-p-text-secondary';
  const lockBookingDetails = isCompletedReservationScheduleLocked;
  const shouldShowSeriesScopeHint = Boolean(
    editingBooking?.fixedBookingId && hasScheduleChanges && !pendingSeriesScopeSave
  );
  const hasDeferredEditChanges = Boolean(editingBookingId ? hasScheduleChanges : selectedCourtId);
  const primaryActionDisabled = Boolean(
    isSubmittingBooking ||
    isDeletingBooking ||
    confirmingBooking ||
    hasBlockingActionError ||
    !hasDeferredEditChanges
  );
  const primaryActionLabel = editingBookingId ? 'Guardar cambios' : 'Crear reserva';
  const primaryActionMeta = editingBookingId
    ? `${slotToTime(selectedStartSlot)} - ${slotToTime(selectedEndSlot)}`
    : (selectedCourt?.name || 'Sin cancha');
  const operationalChecklist = [
    {
      key: 'court',
      label: 'Cancha seleccionada',
      ok: Boolean(selectedCourtId),
      detail: selectedCourtId ? '' : 'Elegí una cancha para continuar.',
    },
    {
      key: 'time',
      label: 'Horario válido',
      ok: selectedEndSlot > selectedStartSlot,
      detail: selectedEndSlot > selectedStartSlot ? '' : 'La hora de fin debe ser posterior al inicio.',
    },
    {
      key: 'owner',
      label: 'Titular cargado',
      ok: Boolean(participants.find((participant) => participant.isOwner && participant.name.trim().length > 0)),
      detail: participants.find((participant) => participant.isOwner && participant.name.trim().length > 0)
        ? ''
        : 'Agregá un titular antes de guardar.',
    },
  ];

  const duplicateParticipantIds = useMemo(() => {
    const firstByToken = new Map<string, string>();
    const duplicates = new Set<string>();

    for (const participant of participants) {
      if (!participant.name.trim()) continue;
      const tokens = participantExplicitIdentityKeys(participant);
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
    patch: Partial<Participant>
  ) => {
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant
      )
    );
  }, []);

  const runParticipantSearch = useCallback(async (participantId: string, rawValue: string) => {
    updateParticipant(participantId, {
      name: rawValue,
      sourceType: 'guest',
      entityRef: undefined,
      selectedUserId: undefined,
      personKind: undefined,
      personKey: undefined,
      personSearchQuery: undefined,
      badges: undefined,
    });
    const query = String(rawValue || '').trim();
    if (!query) {
      setParticipantSearchOpenId(null);
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
      return;
    }

    setParticipantSearchOpenId(participantId);
    const seq = ++participantSearchSeqRef.current;
    setParticipantSearchLoadingId(participantId);
    try {
      const slug = getClubSlug();
      if (!slug || query.length < 2) {
        if (seq !== participantSearchSeqRef.current) return;
        setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
        return;
      }

      const rows = await ClubAdminService.searchPeople(slug, query);
      if (seq !== participantSearchSeqRef.current) return;

      const clientSuggestions: ParticipantSuggestion[] = (Array.isArray(rows) ? rows : [])
        .slice(0, 6)
        .map((row: any, index: number) =>
          mapPersonSearchResultToParticipantSuggestion(row, query, `club-${participantId}-${index}`)
        )
        .filter((suggestion): suggestion is ParticipantSuggestion => Boolean(suggestion));

      setParticipantSuggestionsById((previous) => ({
        ...previous,
        [participantId]: clientSuggestions,
      }));
    } catch {
      if (seq !== participantSearchSeqRef.current) return;
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
    } finally {
      if (seq === participantSearchSeqRef.current) {
        setParticipantSearchLoadingId((previous) => (previous === participantId ? null : previous));
      }
    }
  }, [getClubSlug, updateParticipant]);

  const fetchParticipantSuggestionsForDraft = useCallback(async (query: string) => {
    const safeQuery = String(query || '').trim();
    if (!safeQuery) return [] as ParticipantSuggestion[];

    const slug = getClubSlug();
    if (!slug || safeQuery.length < 2) return [] as ParticipantSuggestion[];

    try {
      const rows = await ClubAdminService.searchPeople(slug, safeQuery);
      const clientSuggestions: ParticipantSuggestion[] = (Array.isArray(rows) ? rows : [])
        .slice(0, 6)
        .map((row: any, index: number) => mapPersonSearchResultToParticipantSuggestion(row, safeQuery, `draft-${index}`))
        .filter((suggestion): suggestion is ParticipantSuggestion => Boolean(suggestion));
      return clientSuggestions;
    } catch {
      return [] as ParticipantSuggestion[];
    }
  }, [getClubSlug]);

  const runSimplifiedOwnerSearch = useCallback(async (ownerId: string, rawValue: string) => {
    const currentOwner = participants.find((participant) => participant.id === ownerId) || null;
    updateParticipant(ownerId, {
      name: rawValue,
      contact: currentOwner?.sourceType === 'guest' ? currentOwner.contact : '',
      dni: currentOwner?.sourceType === 'guest' ? currentOwner.dni : undefined,
      sourceType: 'guest',
      entityRef: undefined,
      selectedUserId: undefined,
      personKind: undefined,
      personKey: undefined,
      personSearchQuery: undefined,
      badges: undefined,
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
    try {
      const slug = getClubSlug();
      if (!slug || query.length < 2) {
        setSimplifiedOwnerSuggestions([]);
        return;
      }
      const rows = await ClubAdminService.searchPeople(slug, query);
      const ownerSuggestions: ParticipantSuggestion[] = (Array.isArray(rows) ? rows : [])
        .slice(0, 8)
        .map((row: any, index: number) =>
          mapPersonSearchResultToParticipantSuggestion(row, query, `owner-${index}`)
        )
        .filter((suggestion): suggestion is ParticipantSuggestion => Boolean(suggestion));
      setSimplifiedOwnerSuggestions(ownerSuggestions);
    } catch {
      setSimplifiedOwnerSuggestions([]);
    } finally {
      setSimplifiedOwnerSearchLoading(false);
    }
  }, [getClubSlug, participants, updateParticipant]);

  const applySimplifiedOwnerSuggestion = useCallback((ownerId: string, suggestion: ParticipantSuggestion) => {
    updateParticipant(ownerId, {
      name: suggestion.name,
      contact: suggestion.contact || '',
      dni: suggestion.dni,
      sourceType: suggestion.sourceType,
      entityRef: suggestion.entityRef,
      selectedUserId: suggestion.selectedUserId,
      personKind: suggestion.personKind,
      personKey: suggestion.personKey,
      personSearchQuery: suggestion.personSearchQuery,
      badges: suggestion.badges,
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
    setSimplifiedNewParticipantSelectedUserIdDraft(undefined);
    setSimplifiedNewParticipantPersonKindDraft(undefined);
    setSimplifiedNewParticipantPersonKeyDraft(undefined);
    setSimplifiedNewParticipantPersonSearchQueryDraft(undefined);
    setSimplifiedNewParticipantBadgesDraft(undefined);
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
        .flatMap((participant) => participantExplicitIdentityKeys(participant))
    );
    const filteredSuggestions = suggestions.filter((suggestion) => {
      const suggestionRef = String(suggestion.entityRef || '').trim().toLowerCase();
      if (suggestionRef && existingRefs.has(suggestionRef)) return false;
      const suggestionTokens = participantExplicitIdentityKeys({
        entityRef: suggestion.entityRef,
        selectedUserId: suggestion.selectedUserId,
        personKind: suggestion.personKind,
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
    setSimplifiedNewParticipantSelectedUserIdDraft(suggestion.selectedUserId);
    setSimplifiedNewParticipantPersonKindDraft(suggestion.personKind);
    setSimplifiedNewParticipantPersonKeyDraft(suggestion.personKey);
    setSimplifiedNewParticipantPersonSearchQueryDraft(suggestion.personSearchQuery);
    setSimplifiedNewParticipantBadgesDraft(suggestion.badges);
    setSimplifiedNewParticipantSuggestionsOpen(false);
    setSimplifiedNewParticipantSearchLoading(false);
    setSimplifiedNewParticipantSuggestions([]);
    setFormError('');
  }, []);

  const applyParticipantSuggestion = useCallback((participantId: string, suggestion: ParticipantSuggestion) => {
    const incomingTokens = participantExplicitIdentityKeys({
      entityRef: suggestion.entityRef,
      selectedUserId: suggestion.selectedUserId,
      personKind: suggestion.personKind,
    });
    const duplicateExists = participants.some((participant) => {
      if (participant.id === participantId) return false;
      if (!participant.name.trim()) return false;
      const currentTokens = participantExplicitIdentityKeys(participant);
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
      dni: suggestion.dni,
      sourceType: suggestion.sourceType,
      entityRef: suggestion.entityRef,
      selectedUserId: suggestion.selectedUserId,
      personKind: suggestion.personKind,
      personKey: suggestion.personKey,
      personSearchQuery: suggestion.personSearchQuery,
      badges: suggestion.badges,
    });
    setFormError('');
    setParticipantSearchOpenId(null);
    setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
  }, [participants, updateParticipant]);

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
      await refreshPersistedBookingView(persistedEditingBookingId, {
        consumptions: true,
        financial: true,
        schedule: true,
        history: true,
      });
      setConsumptionQuantityDraft('1');
      setConsumptionQuote(null);
      setConsumptionQuoteError('');
      showAgendaToast('Consumo agregado correctamente.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleAddConsumption' }, error);
      const normalized = normalizeApiError(error, 'No se pudo agregar el consumo.');
      setBookingConsumptionError(toUserSafeMessage(normalized.message, 'No se pudo agregar el consumo.'));
    } finally {
      setConsumptionAddInFlight(false);
    }
  }, [
    consumptionApplyDiscountDraft,
    consumptionProductDraft,
    consumptionProducts,
    consumptionQuantityDraft,
    persistedEditingBookingId,
    refreshPersistedBookingView,
    showAgendaToast,
  ]);

  const handleRemoveConsumption = useCallback(async (itemId: string) => {
    if (!persistedEditingBookingId || !itemId) return;
    setConsumptionRemovingId(itemId);
    setBookingConsumptionError('');
    try {
      await ClubAdminService.removeItemFromBooking(itemId);
      await refreshPersistedBookingView(persistedEditingBookingId, {
        consumptions: true,
        financial: true,
        schedule: true,
        history: true,
      });
      showAgendaToast('Consumo eliminado.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleRemoveConsumption' }, error);
      const normalized = normalizeApiError(error, 'No se pudo eliminar el consumo.');
      setBookingConsumptionError(toUserSafeMessage(normalized.message, 'No se pudo eliminar el consumo.'));
    } finally {
      setConsumptionRemovingId((previous) => (previous === itemId ? null : previous));
    }
  }, [persistedEditingBookingId, refreshPersistedBookingView, showAgendaToast]);

  const handleCreateBooking = async (forceCreateRecurring = false, editSeriesScope?: EditSeriesScope) => {
    if (isSubmittingBooking || isDeletingBooking || confirmingBooking) return;
    let recurringSummaryError = '';
    let recurringResultModalShouldOpen = false;
    let createdBookingId: string | null = null;

    const owner = participants.find((participant) => participant.isOwner);

    if (!owner || owner.name.trim().length === 0) {
      setBlockingFieldError('owner', 'Falta el responsable de la reserva.');
      return;
    }

    const ownerClientId = resolveParticipantClientId(owner);
    const ownerSelectedUserId = resolveParticipantSelectedUserId(owner);
    const ownerPhone = resolvePlaygroundClientPhone(owner);
    const ownerEmail = resolvePlaygroundClientEmail(owner);
    const ownerDni = resolvePlaygroundClientDni(owner);
    const ownerPersonSelection =
      !ownerClientId &&
      ownerSelectedUserId > 0 &&
      String(owner?.personKey || '').trim() &&
      String(owner?.personSearchQuery || '').trim().length >= 2
        ? {
            kind: (owner.personKind === 'linked' ? 'linked' : 'systemUser') as 'linked' | 'systemUser',
            userId: ownerSelectedUserId,
            personKey: String(owner.personKey || '').trim(),
            searchQuery: String(owner.personSearchQuery || '').trim(),
          }
        : null;
    if (!ownerClientId && !ownerPersonSelection && !ownerPhone) {
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

    const pendingParticipantDrafts = participants
      .filter((participant) => !participant.isOwner && participant.name.trim().length > 0)
      .map((participant) => ({ ...participant }));

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
          showAgendaToast('Bloqueo actualizado.', 'success');
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
      showAgendaToast('Bloqueo creado.', 'success');
      return;
    }

    if (editingBookingId) {
      // Draft-only: dentro del drawer estos cambios se persisten recién al guardar.
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

      if (!hasScheduleChanges) {
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
          await refreshPersistedBookingView(numericBookingId, {
            schedule: true,
            financial: true,
            history: true,
          });
        }
        bookingDrawerDispatch({ type: 'SAVE_SUCCESS' });
        const shouldClose = hasScheduleChanges;
        if (shouldClose) {
          setDrawerOpen(false);
          setEditingBookingId(null);
          setEditingBaseline(null);
        }
        setFormError('');
        const baseSuccessMessage = shouldClose ? 'Reserva actualizada correctamente.' : 'Cambios guardados.';
        showAgendaToast(baseSuccessMessage, 'success');
        if (isEditingRecurringSeries && editSeriesScope && recurringRescheduleResult) {
          const overlapItemsRaw = Array.isArray(recurringRescheduleResult?.overlaps) ? recurringRescheduleResult.overlaps : [];
          const updatedItemsRaw = Array.isArray(recurringRescheduleResult?.updatedItems)
            ? recurringRescheduleResult.updatedItems
            : Array.isArray(recurringRescheduleResult?.applicableItems)
              ? recurringRescheduleResult.applicableItems
              : [];
          const overlapItems = overlapItemsRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha', activeClubTimeZone));
          const appliedItems = updatedItemsRaw
            .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha', activeClubTimeZone))
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
                ? formatSeriesDateLabel(requestedStart, activeClubTimeZone)
                : 'Fecha no disponible',
              requestedTimeLabel: `${
                hasRequestedStart
                  ? formatSeriesTimeLabel(requestedStart, activeClubTimeZone)
                  : slotToTime(selectedStartSlot)
              } - ${
                hasRequestedEnd
                  ? formatSeriesTimeLabel(requestedEnd, activeClubTimeZone)
                  : inferredRequestedEnd
                    ? formatSeriesTimeLabel(inferredRequestedEnd, activeClubTimeZone)
                    : slotToTime(selectedEndSlot)
              }`,
              conflictingDateLabel: hasConflictingStart
                ? formatSeriesDateLabel(conflictingStart, activeClubTimeZone)
                : undefined,
              conflictingTimeLabel:
                hasConflictingStart && hasConflictingEnd
                  ? `${formatSeriesTimeLabel(conflictingStart as Date, activeClubTimeZone)} - ${formatSeriesTimeLabel(conflictingEnd as Date, activeClubTimeZone)}`
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
                    : ownerPersonSelection
                      ? { ownerSelection: ownerPersonSelection }
                    : {
                        client: {
                          name: owner.name.trim(),
                          phone: ownerPhone,
                          email: ownerEmail,
                          dni: ownerDni || undefined,
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
                const normalized = normalizeApiError(error, 'Error al previsualizar la serie');
                previewErrors.push(`${court.name}: ${toUserSafeMessage(normalized.message, 'Error al previsualizar la serie')}`);
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
              : ownerPersonSelection
                ? { ownerSelection: ownerPersonSelection }
              : {
                  client: {
                    name: owner.name.trim(),
                    phone: ownerPhone,
                    email: ownerEmail,
                    dni: ownerDni || undefined,
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
            ? formatSeriesDateLabel(requestedStart, activeClubTimeZone)
            : 'Fecha no disponible';
          const requestedStartLabel = hasRequestedStart
            ? formatSeriesTimeLabel(requestedStart, activeClubTimeZone)
            : Number.isFinite(Number(item?.startTimeMinutes))
              ? minutesToHourLabel(Number(item.startTimeMinutes))
              : slotToTime(selectedStartSlot);
          const inferredRequestedEnd =
            hasRequestedStart && !hasRequestedEnd
              ? new Date((requestedStart as Date).getTime() + Math.max(15, selectionMinutes) * 60000)
              : null;
          const requestedEndLabel = hasRequestedEnd
            ? formatSeriesTimeLabel(requestedEnd, activeClubTimeZone)
            : inferredRequestedEnd
              ? formatSeriesTimeLabel(inferredRequestedEnd, activeClubTimeZone)
            : Number.isFinite(Number(item?.endTimeMinutes))
              ? minutesToHourLabel(Number(item.endTimeMinutes))
              : slotToTime(selectedEndSlot);

          const conflictingDateLabel = hasConflictingStart
            ? formatSeriesDateLabel(conflictingStart, activeClubTimeZone)
            : undefined;
          const conflictingStartLabel = hasConflictingStart
            ? formatSeriesTimeLabel(conflictingStart, activeClubTimeZone)
            : Number.isFinite(Number(item?.startTimeMinutes))
              ? minutesToHourLabel(Number(item.startTimeMinutes))
              : undefined;
          const conflictingEndLabel = hasConflictingEnd
            ? formatSeriesTimeLabel(conflictingEnd, activeClubTimeZone)
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
                      ? formatSeriesDateLabel(createdStart as Date, activeClubTimeZone)
                      : 'Fecha no disponible',
                    requestedTimeLabel: `${
                      hasCreatedStart
                        ? formatSeriesTimeLabel(createdStart as Date, activeClubTimeZone)
                        : slotToTime(selectedStartSlot)
                    } - ${
                      hasCreatedEnd
                        ? formatSeriesTimeLabel(createdEnd as Date, activeClubTimeZone)
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
                    requestedDateLabel: formatSeriesDateLabel(firstOccurrence, activeClubTimeZone),
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
                const normalized = normalizeApiError(error, '');
                const recurringMessage = toUserSafeMessage(normalized.message, '');
                if (recurringMessage.length > 0) {
                  recurringOverlapOnlyMessage = recurringMessage;
                }
                continue;
              }
              const normalized = normalizeApiError(error, 'Error al crear serie');
              hardErrors.push(`${court.name}: ${toUserSafeMessage(normalized.message, 'Error al crear serie')}`);
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
        if (generatedCount > 0) {
          showAgendaToast(`Reserva fija creada: ${generatedCount} turnos.`, 'success');
        }
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
            : ownerPersonSelection
              ? { ownerSelection: ownerPersonSelection }
            : {
                client: {
                  name: owner.name.trim(),
                  phone: ownerPhone,
                  email: ownerEmail,
                  dni: ownerDni || undefined,
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
          if (pendingParticipantDrafts.length > 0) {
            const syncResult = await syncDraftParticipantsToPersistedBooking(
              Number(createdBooking.id),
              pendingParticipantDrafts
            );
            await refreshPersistedBookingView(Number(createdBooking.id), {
              schedule: true,
              participants: true,
              financial: true,
              consumptions: true,
              history: true,
              forceDrawerSections: true,
            });
            if (syncResult === 'deferred') {
              showAgendaToast('Reserva creada. Completá la decisión para agregar el participante.', 'warning');
              return;
            }
          } else {
            await refreshPersistedBookingView(Number(createdBooking.id), {
              schedule: true,
              participants: true,
              financial: true,
              consumptions: true,
              history: true,
              forceDrawerSections: true,
            });
          }
          setBookingCreatedModalOpen(true);
          showAgendaToast('Reserva creada.', 'success');
          return;
        }
      }
      setDrawerOpen(false);
      setFormError('');
      setParticipants(createInitialParticipants());
      setEditingBookingId(null);
      setEditingBaseline(null);
      showAgendaToast('Reserva creada.', 'success');
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
          const ownerDni = resolvePlaygroundClientDni(owner);
          const bookingDate = new Date(selectedDate);
          openDuplicateDecisionModal({
            candidates: candidateRows,
            selectedClientId: String(normalized.meta?.primaryClientId || candidateRows[0]?.id || ''),
            onUseExisting: async (selectedClientId) => {
              const createdPayload: any = await createBooking(
                Number(selectedCourtId),
                selectedActivityId,
                bookingDate,
                slotTime,
                {
                  durationMinutes: selectionMinutes,
                  clientId: selectedClientId,
                }
              );

              const maybeId = Number(
                createdPayload?.booking?.id ?? createdPayload?.id ?? createdPayload?.bookingId
              );
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
                if (
                  !createdBookingClientIdRaw &&
                  !(Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0)
                ) {
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
                const createdBookingClientId =
                  createdBookingClientIdRaw.length > 0 ? createdBookingClientIdRaw : undefined;
                const createdBookingUserId =
                  Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0
                    ? createdBookingUserIdRaw
                    : undefined;
              }

              await reloadSchedule();
              setFormError('');
              setDrawerOpen(false);
              showAgendaToast('Reserva creada con el cliente existente seleccionado.', 'success');
            },
            onCreateNew: async () => {
              const createdPayload: any = await createBooking(
                Number(selectedCourtId),
                selectedActivityId,
                bookingDate,
                slotTime,
                {
                  durationMinutes: selectionMinutes,
                  client: {
                    name: ownerName,
                    phone: ownerPhone,
                    email: ownerEmail,
                    dni: ownerDni || undefined,
                    duplicateResolution: 'CREATE_NEW',
                  },
                }
              );

              const maybeId = Number(
                createdPayload?.booking?.id ?? createdPayload?.id ?? createdPayload?.bookingId
              );
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
                if (
                  !createdBookingClientIdRaw &&
                  !(Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0)
                ) {
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
                const createdBookingClientId =
                  createdBookingClientIdRaw.length > 0 ? createdBookingClientIdRaw : undefined;
                const createdBookingUserId =
                  Number.isFinite(createdBookingUserIdRaw) && createdBookingUserIdRaw > 0
                    ? createdBookingUserIdRaw
                    : undefined;
              }

              await reloadSchedule();
              setFormError('');
              setDrawerOpen(false);
              showAgendaToast('Reserva creada como cliente nuevo (duplicado permitido).', 'success');
            },
          });
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
      setSimplifiedEditingParticipantId(null);
      setSimplifiedOwnerSuggestionsOpen(false);
      setSimplifiedOwnerSearchLoading(false);
      setSimplifiedOwnerSuggestions([]);
      resetSimplifiedNewParticipantDraft();
    }
  }, [drawerOpen, editingBookingId, resetSimplifiedNewParticipantDraft]);

  useEffect(() => {
    if (!drawerOpen || !editingBookingId) return;
    const namedOwner = participants.find(
      (participant) => participant.isOwner && participant.name.trim().length > 0
    );
    if (!namedOwner) return;
    setSimplifiedOwnerAdded(true);
    setSimplifiedEditingParticipantId(null);
    setSimplifiedOwnerSuggestionsOpen(false);
    setSimplifiedOwnerSearchLoading(false);
    setSimplifiedOwnerSuggestions([]);
    resetSimplifiedNewParticipantDraft();
  }, [drawerOpen, editingBookingId, participants, resetSimplifiedNewParticipantDraft]);

  useEffect(() => {
    if (drawerOpen) return;
    resetDrawerParticipantVisualState();
  }, [drawerOpen, resetDrawerParticipantVisualState]);

  useEffect(() => {
    if (!simplifiedEditingParticipantId) return;
    const stillExists = participants.some(
      (participant) => participant.id === simplifiedEditingParticipantId
    );
    if (stillExists) return;
    setSimplifiedEditingParticipantId(null);
  }, [
    participants,
    simplifiedEditingParticipantId,
  ]);

  useEffect(() => {
    if (!simplifiedNewParticipantOpen) return;
    if (simplifiedOwnerAdded) return;
    resetSimplifiedNewParticipantDraft();
  }, [resetSimplifiedNewParticipantDraft, simplifiedNewParticipantOpen, simplifiedOwnerAdded]);

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

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasOperatorAccess(user)) return <NotFound message="No tenés permiso para acceder al panel de administración." />;
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
  const ownerDniDraft = resolvePlaygroundClientDni(ownerParticipant);
  const ownerHasLinkedSelection = Boolean(ownerParticipant && ownerParticipant.sourceType !== 'guest');
  const ownerHasName = Boolean(ownerParticipant && ownerParticipant.name.trim().length > 0);
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
  const ownerEntries = participants.filter((participant) => participant.isOwner);
  const otherEntries = participants.filter((participant) => !participant.isOwner);
  const orderedParticipants = [...ownerEntries, ...otherEntries];
  const simplifiedNamedParticipants = orderedParticipants.filter((participant) => participant.name.trim().length > 0);
  const simplifiedNewParticipantHasLinkedSelection =
    String(simplifiedNewParticipantEntityRefDraft || '').trim().length > 0 &&
    simplifiedNewParticipantSourceTypeDraft !== 'guest';
  const simplifiedNewParticipantPhoneDraft = extractPhoneFromParticipantContact(simplifiedNewParticipantContact);
  const simplifiedNewParticipantEmailDraft = extractEmailFromParticipantContact(simplifiedNewParticipantContact);
  const simplifiedNewParticipantHasUserSelection =
    Number.isFinite(Number(simplifiedNewParticipantSelectedUserIdDraft || 0)) &&
    Number(simplifiedNewParticipantSelectedUserIdDraft) > 0 &&
    String(simplifiedNewParticipantPersonKeyDraft || '').trim().length > 0 &&
    String(simplifiedNewParticipantPersonSearchQueryDraft || '').trim().length >= 2;
  const hasValidSimplifiedNewParticipantName =
    (
      simplifiedNewParticipantName.trim().length > 0 &&
      (
        simplifiedNewParticipantEntityRefDraft.trim().length > 0 ||
        simplifiedNewParticipantHasUserSelection
      )
    ) || (
      simplifiedNewParticipantName.trim().length >= 2 &&
      simplifiedNewParticipantPhoneDraft.length >= 8
    );
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
  const simplifiedPaymentStatusLabel = isFinancialDisplayPending
    ? 'Cargando'
    : simplifiedRemainingAmount <= 0.009
      ? 'Pagado'
      : simplifiedPaidAmount > 0.009
        ? 'Parcial'
        : 'Pendiente';
  const simplifiedCanRegisterPayment =
    Boolean(persistedEditingBookingId) &&
    !isPaymentLockedByManualPending &&
    simplifiedRemainingAmount > 0.009;

  const simplifiedSectionTabs: Array<{ id: SimplifiedSidebarSection; label: string }> = [
    { id: 'DETAILS', label: 'Detalle' },
    ...(bookingKind === 'block'
      ? []
      : [{ id: 'CONSUMPTIONS' as const, label: 'Consumos' }]),
    { id: 'BILLING', label: 'Participantes y cuenta' },
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
  const previewSeriesEditScope = async (scope: EditSeriesScope) => {
    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    const occurrenceBookingId = Number(editingBookingId || 0);
    const courtId = Number(selectedCourtId || 0);
    if (!Number.isFinite(fixedBookingId) || fixedBookingId <= 0) return;
    if (!Number.isFinite(courtId) || courtId <= 0) {
      setFormError('Seleccioná una cancha válida para previsualizar la serie.');
      return;
    }

    setSeriesEditPreviewLoading(true);
    setSeriesEditPreviewScope(scope);
    setSeriesEditPreviewSummary(null);
    try {
      const startDateTime = buildStartDateTimeFromSlot(selectedDate, selectedStartSlot);
      const durationMinutes = Math.max(15, (selectedEndSlot - selectedStartSlot) * slotMinutes);
      const result = await rescheduleFixedBooking(fixedBookingId, {
        scope,
        occurrenceBookingId: Number.isFinite(occurrenceBookingId) && occurrenceBookingId > 0
          ? occurrenceBookingId
          : undefined,
        courtId,
        startDateTime,
        durationMinutes,
        previewOnly: true,
      });
      const overlapItemsRaw = Array.isArray((result as any)?.overlaps) ? (result as any).overlaps : [];
      const applicableItemsRaw = Array.isArray((result as any)?.applicableItems)
        ? (result as any).applicableItems
        : [];
      const failureMessages = Array.isArray((result as any)?.failures)
        ? (result as any).failures
            .map((item: any) => String(item?.reason || '').trim())
            .filter((reason: string) => reason.length > 0)
        : [];
      setSeriesEditPreviewSummary({
        scope,
        totalCandidates: Number((result as any)?.totalCandidates || applicableItemsRaw.length || overlapItemsRaw.length || 0),
        applicableCount: Number((result as any)?.willUpdateCount ?? applicableItemsRaw.length ?? 0),
        applicableItems: applicableItemsRaw
          .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha', activeClubTimeZone))
          .sort((a, b) => Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0)),
        skippedCount: Number((result as any)?.skippedCount || overlapItemsRaw.length),
        overlapItems: overlapItemsRaw.map((item: any) => mapSeriesImpactItem(item, selectedCourt?.name || 'Cancha', activeClubTimeZone)),
        failureMessages,
      });
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'previewSeriesEditScope' }, error);
      const normalized = normalizeApiError(error, 'No se pudo previsualizar la edición de la serie.');
      setSeriesEditPreviewSummary({
        scope,
        totalCandidates: 0,
        applicableCount: 0,
        applicableItems: [],
        skippedCount: 0,
        overlapItems: [],
        failureMessages: [toUserSafeMessage(normalized.message, 'No se pudo previsualizar la edición de la serie.')],
      });
    } finally {
      setSeriesEditPreviewLoading(false);
    }
  };

  const previewSeriesDeleteScope = async (scope: EditSeriesScope) => {
    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    const occurrenceBookingId = Number(editingBookingId || 0);
    if (!Number.isFinite(fixedBookingId) || fixedBookingId <= 0) return;

    setSeriesDeletePreviewLoading(true);
    setSeriesDeletePreviewScope(scope);
    setSeriesDeletePreviewSummary(null);
    try {
      const result = await cancelFixedBooking(fixedBookingId, {
        scope,
        occurrenceBookingId: Number.isFinite(occurrenceBookingId) && occurrenceBookingId > 0
          ? occurrenceBookingId
          : undefined,
        previewOnly: true,
      });
      const applicableItemsRaw = Array.isArray((result as any)?.applicableItems)
        ? (result as any).applicableItems
        : [];
      const skippedRaw = Array.isArray((result as any)?.skipped) ? (result as any).skipped : [];
      setSeriesDeletePreviewSummary({
        scope,
        totalCandidates: Number((result as any)?.totalCandidates || applicableItemsRaw.length || skippedRaw.length || 0),
        applicableCount: Number((result as any)?.cancelledCount ?? applicableItemsRaw.length ?? 0),
        applicableItems: applicableItemsRaw
          .map((item: any) => mapSeriesAppliedItem(item, selectedCourt?.name || 'Cancha', activeClubTimeZone))
          .sort((a, b) => Number(a.sortStartMs || 0) - Number(b.sortStartMs || 0)),
        skippedCount: Number((result as any)?.skippedCount || skippedRaw.length),
        overlapItems: skippedRaw.map((item: any) =>
          mapSeriesImpactItem(
            {
              requestedStartDateTime: item?.startDateTime,
              conflictingCourtName: selectedCourt?.name || 'Cancha',
              conflictingActivityName: String(item?.reason || '').trim() || 'Ocurrencia omitida',
            },
            selectedCourt?.name || 'Cancha',
            activeClubTimeZone
          )
        ),
        failureMessages: skippedRaw
          .map((item: any) => String(item?.reason || '').trim())
          .filter((reason: string) => reason.length > 0),
      });
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'previewSeriesDeleteScope' }, error);
      const normalized = normalizeApiError(error, 'No se pudo previsualizar la cancelación de la serie.');
      setSeriesDeletePreviewSummary({
        scope,
        totalCandidates: 0,
        applicableCount: 0,
        applicableItems: [],
        skippedCount: 0,
        overlapItems: [],
        failureMessages: [toUserSafeMessage(normalized.message, 'No se pudo previsualizar la cancelación de la serie.')],
      });
    } finally {
      setSeriesDeletePreviewLoading(false);
    }
  };
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
  const simplifiedReservationHistoryTimeline: BookingHistoryTimelineGroup[] = (() => {
    const events: BookingHistoryTimelineEvent[] = [];

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
      if (normalized === 'INDIVIDUAL') return 'Modo individual';
      if (normalized === 'SHARED') return 'Modo compartido';
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
    const domainEvents = Array.isArray(bookingHistoryEntries) ? bookingHistoryEntries : [];

    domainEvents.forEach((event, index) => {
      const payload =
        event.detail && typeof event.detail === 'object'
          ? event.detail
          : {};
      const previousState =
        event.previousState && typeof event.previousState === 'object'
          ? event.previousState
          : {};
      const nextState =
        event.nextState && typeof event.nextState === 'object'
          ? event.nextState
          : {};
      const normalizedType = String(event.action || '').trim().toUpperCase();
      const rawCreatedAt = String(event.occurredAt || '');
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
        const source = formatTimelineSourceLabel(event.source || (payload as any)?.source);
        title = 'Reserva cancelada';
        detail = source ? `Origen: ${source}` : 'Reserva cancelada.';
      } else if (normalizedType === 'BOOKING_RESCHEDULED') {
        const previousStart = formatTimelineDateTime((previousState as any)?.startDateTime);
        const nextStart = formatTimelineDateTime((nextState as any)?.startDateTime);
        const previousCourtId = Number((previousState as any)?.courtId || (payload as any)?.previousCourtId || 0);
        const courtId = Number((nextState as any)?.courtId || (payload as any)?.courtId || 0);
        title = 'Reserva reprogramada';
        const detailParts = [
          previousStart ? `Desde: ${previousStart}` : '',
          nextStart ? `Hasta: ${nextStart}` : '',
          previousCourtId > 0 && courtId > 0 && previousCourtId !== courtId ? `Cancha ${previousCourtId} -> ${courtId}` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Reserva reprogramada.';
      } else if (normalizedType === 'BOOKING_CONFIRMED' || normalizedType === 'CONFIRMED') {
        const source = formatTimelineSourceLabel(event.source || (payload as any)?.source);
        title = 'Reserva confirmada';
        detail = source ? `Origen: ${source}` : 'Reserva confirmada.';
      } else if (normalizedType === 'BOOKING_COMPLETED' || normalizedType === 'COMPLETED') {
        const source = formatTimelineSourceLabel(event.source || (payload as any)?.source);
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
      } else if (normalizedType === 'BOOKING_OWNER_CHANGED' || normalizedType === 'BOOKING_CLIENT_CHANGED') {
        const oldClientName = String((previousState as any)?.clientName || (payload as any)?.oldClientName || '').trim();
        const newClientName = String((nextState as any)?.clientName || (payload as any)?.newClientName || '').trim();
        title = 'Titular cambiado';
        if (oldClientName && newClientName) {
          detail = `${oldClientName} -> ${newClientName}`;
        } else if (newClientName) {
          detail = `Nuevo titular: ${newClientName}`;
        } else {
          detail = 'Se actualizó el titular de la reserva.';
        }
      } else if (normalizedType === 'BOOKING_CONSUMPTION_ADDED' || normalizedType === 'PRODUCT_SOLD') {
        const productName = String((payload as any)?.productName || '').trim() || 'Consumo';
        const quantity = Number((payload as any)?.quantity || 0);
        const totalAmount = Number((payload as any)?.totalAmount || 0);
        title = 'Consumo agregado';
        const detailParts = [
          quantity > 0 ? `${quantity} x ${productName}` : productName,
          Number.isFinite(totalAmount) && totalAmount > 0.009 ? `Total: ${totalAmount.toFixed(2)} $` : '',
        ].filter(Boolean);
        detail = detailParts.length > 0 ? detailParts.join(' - ') : 'Consumo agregado.';
      } else if (normalizedType === 'BOOKING_CONSUMPTION_REMOVED' || normalizedType === 'PRODUCT_REMOVED') {
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
        const notes = String((nextState as any)?.notes || (payload as any)?.notes || '').trim();
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
  const cancelBookingPaidAmount = roundMoney(
    Number(bookingFinancial?.paid ?? editingBooking?.hoverPayment?.paidAmount ?? 0)
  );
  const cancelBookingHasPayments = cancelBookingPaidAmount > 0.009;
  const normalizedCancelRefundAmount = roundMoney(
    Math.max(0, Number(cancelRefundAmountInput || 0))
  );
  const buildCancelBookingOptions = () => {
    if (!cancelBookingHasPayments || !cancelRefundExecuteNow) {
      return { options: undefined as Parameters<typeof cancelBooking>[1] | undefined };
    }
    const amount = Number(cancelRefundAmountInput || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return { error: 'Ingresá un monto de devolución válido.' };
    }
    if (amount - cancelBookingPaidAmount > 0.009) {
      return { error: 'La devolución no puede superar lo pagado.' };
    }
    return {
      options: {
        refund: {
          amount,
          executeNow: true,
          reasonType: cancelRefundReasonType,
          executionNotes: String(cancelRefundExecutionNotes || '').trim() || undefined,
        },
      } satisfies Parameters<typeof cancelBooking>[1],
    };
  };
  const handleDeleteBooking = async (scope?: EditSeriesScope) => {
    const bookingId = Number(editingBookingId || 0);
    const fixedBookingId = Number(editingBooking?.fixedBookingId || 0);
    if (!Number.isFinite(bookingId) || bookingId <= 0) return;
    setIsDeletingBooking(true);
    setCancelBookingFlowError('');
    try {
      if (Number.isFinite(fixedBookingId) && fixedBookingId > 0 && scope) {
        await cancelFixedBooking(fixedBookingId, {
          scope,
          occurrenceBookingId: bookingId,
        });
      } else {
        const result = buildCancelBookingOptions();
        if ('error' in result && result.error) {
          setCancelBookingFlowError(result.error);
          return;
        }
        await cancelBooking(bookingId, result.options);
      }
      await reloadSchedule();
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
      closeDeleteBookingFlow();
      showAgendaToast('Reserva cancelada.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleDeleteBooking' }, error);
      const normalized = normalizeApiError(error, 'No se pudo cancelar la reserva.');
      setCancelBookingFlowError(toUserSafeMessage(normalized.message, 'No se pudo cancelar la reserva.'));
    } finally {
      setIsDeletingBooking(false);
    }
  };
  const handleConfirmPendingBooking = async () => {
    const bookingId = Number(editingBookingId || 0);
    if (!Number.isFinite(bookingId) || bookingId <= 0 || confirmingBooking) return;
    try {
      setConfirmingBooking(true);
      await confirmBooking(bookingId);
      await refreshPersistedBookingView(bookingId, {
        schedule: true,
        financial: true,
        consumptions: true,
        history: true,
      });
      showAgendaToast('Reserva confirmada.', 'success');
    } catch (error: any) {
      reportUiError({ area: 'AgendaPlayground', action: 'handleConfirmPendingBooking' }, error);
      applyBookingError(error, 'No se pudo confirmar la reserva.');
    } finally {
      setConfirmingBooking(false);
    }
  };
  const openDeleteBookingFlow = () => {
    setCancelBookingFlowError('');
    setDeleteBookingFinalConfirmOpen(false);
    if (editingBooking?.fixedBookingId) {
      setSeriesDeletePreviewScope(null);
      setSeriesDeletePreviewSummary(null);
      setDeleteSeriesScopeModalOpen(true);
      return;
    }
    setDeleteBookingConfirmOpen(true);
  };
  const addParticipantRow = () => {
    setParticipants((previous) => [
      ...previous,
      {
        id: `participant-${Date.now()}-${previous.length + 1}`,
        name: '',
        contact: '',
        paid: false,
        isOwner: false,
        sourceType: 'guest',
        paymentMethod: 'CASH',
        customPrice: null,
      },
    ]);
  };
  const confirmCancelBookingFromDrawer = async () => {
    setDeleteBookingFinalConfirmOpen(false);
    await handleDeleteBooking();
  };
  const seriesDeletePaidItems = seriesDeletePreviewSummary?.paidItems || [];
  const seriesDeleteHasPaidItems = seriesDeletePaidItems.length > 0;
  const seriesDeleteBlocksMassCancel =
    seriesDeleteHasPaidItems && seriesDeletePreviewSummary?.scope !== 'THIS_OCCURRENCE';
  const seriesDeleteUsesIndividualRefund =
    seriesDeleteHasPaidItems && seriesDeletePreviewSummary?.scope === 'THIS_OCCURRENCE';
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
                                      drawerOpen &&
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
                                    const previewTitle = isEditingMovedBookingPreview
                                      ? editingBooking?.title || 'Reserva'
                                      : bookingKind === 'block'
                                        ? (blockingTitle.trim() || 'Bloqueo')
                                        : 'Reserva';
                                    const previewState = isEditingMovedBookingPreview
                                      ? editingBooking?.state || 'pending'
                                      : bookingKind === 'block'
                                        ? 'blocked'
                                        : 'pending';
                                    const previewPaymentState = isEditingMovedBookingPreview
                                      ? editingBooking?.paymentState || 'unpaid'
                                      : 'unpaid';
                                    const previewIsRecurring = isEditingMovedBookingPreview
                                      ? Boolean(editingBooking?.isRecurring)
                                      : bookingKind === 'recurringV2';
                                    return (
                                      <AgendaSelectionPreview
                                        range={range}
                                        slotHeight={slotHeight}
                                        slotMinutes={slotMinutes}
                                        visibility={visibility}
                                        slotToTime={slotToTime}
                                        isEditingMovedBookingPreview={isEditingMovedBookingPreview}
                                        isConflict={drawerPreviewIsConflicted}
                                        title={previewTitle}
                                        state={previewState}
                                        paymentState={previewPaymentState}
                                        isRecurring={previewIsRecurring}
                                      />
                                    );
                                  })()}

                                  {bookingDropPreview && draggingBookingMeta && bookingDropPreview.courtId === court.id && (
                                    (() => {
                                      const top = bookingDropPreview.startSlot * slotHeight + 2;
                                      const height = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotHeight - 4;
                                      const visibility = blockContentVisibility(height);
                                      const isDropConflicted = false;
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex justify-end p-3`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modalStacked} flex items-center justify-center bg-[var(--overlay)] p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                            void removeParticipant(participantId);
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                className={`fixed inset-0 ${ADMIN_Z_INDEX_CLASS.modal} bg-[var(--overlay)] flex items-center justify-center p-4`}
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
                onClick={() => closeBookingDrawer({ clearFormError: false })}
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
                    onClick={() => closeBookingDrawer({ clearFormError: false })}
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
                            <AdminFeedbackBanner tone="error" compact className="mt-3">
                              {bookingConsumptionError}
                            </AdminFeedbackBanner>
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
                        <BookingHistorySection
                          groups={simplifiedReservationHistoryTimeline}
                          loading={bookingTimelineLoading}
                          error={bookingTimelineError}
                          className={showSimplifiedDetailsSection ? 'mt-2' : 'mt-0'}
                        />
                      )}

                      {showSimplifiedBillingSection && (
                      <>
                      {simplifiedIsEditingReservation && (
                        <BookingAccountSummarySection
                          title="Cuenta"
                          statusLabel={simplifiedPaymentStatusLabel}
                          showStatusBadge
                          showActionIcons
                          totalAmount={simplifiedFinancialTotal}
                          paidAmount={simplifiedPaidAmount}
                          remainingAmount={simplifiedRemainingAmount}
                          courtAmount={bookingCourtAmount}
                          consumptionsAmount={bookingItemsAmount}
                          isPending={isFinancialDisplayPending}
                          onOpenOverview={() => {
                            void openAgendaAccountDrawer(persistedEditingBookingId || 0, 'overview');
                          }}
                          onOpenPayment={() => {
                            void openAgendaAccountDrawer(persistedEditingBookingId || 0, 'payment');
                          }}
                          disableOverview={!persistedEditingBookingId}
                          disablePayment={!simplifiedCanRegisterPayment}
                          helperMessage={
                            !persistedEditingBookingId
                              ? 'Primero creá la reserva.'
                              : isPaymentLockedByManualPending
                                ? 'Confirmá la reserva para habilitar pagos.'
                                : null
                          }
                        />
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
                                    setSimplifiedNewParticipantSelectedUserIdDraft(undefined);
                                    setSimplifiedNewParticipantPersonKindDraft(undefined);
                                    setSimplifiedNewParticipantPersonKeyDraft(undefined);
                                    setSimplifiedNewParticipantPersonSearchQueryDraft(undefined);
                                    setSimplifiedNewParticipantBadgesDraft(undefined);
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
                                const participantOrdinal = participant.isOwner
                                  ? null
                                  : simplifiedNamedParticipants
                                      .slice(0, index + 1)
                                      .filter((entry) => !entry.isOwner).length;
                                const normalizedParticipantRef = String(participant.entityRef || '').trim().toLowerCase();
                                const participantIsLinkedRecord =
                                  participant.sourceType !== 'guest' ||
                                  normalizedParticipantRef.startsWith('client:') ||
                                  normalizedParticipantRef.startsWith('user:');
                                const showParticipantActions = !(participant.isOwner && (participantIsLinkedRecord || !persistedEditingBookingId));
                                return (
                                  <div
                                    key={`simplified-participant-${participant.id}`}
                                    data-participant-shell-id={participant.id}
                                    className="rounded-xl border border-p-border bg-p-surface px-3 py-3"
                                  >
                                    <div className="grid grid-cols-[42px_minmax(0,1fr)_32px] gap-2 items-start">
                                      <div className="h-10 w-10 rounded-full bg-p-surface-2 text-p-text-secondary text-[14px] font-semibold grid place-items-center">
                                        {participant.name.trim().charAt(0).toUpperCase() || 'P'}
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="inline-flex items-center rounded-full bg-p-positive-bg px-2.5 py-1 text-[11px] font-semibold text-p-accent">
                                            {participant.isOwner ? 'Titular' : `Participante ${participantOrdinal}`}
                                          </span>
                                        </div>
                                        <p className="text-[15px] font-semibold text-p-text">{participant.name}</p>
                                      </div>
                                      {showParticipantActions && (
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
                                      )}
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
                                          dni: undefined,
                                          sourceType: 'guest',
                                          entityRef: undefined,
                                          selectedUserId: undefined,
                                          personKind: undefined,
                                          personKey: undefined,
                                          personSearchQuery: undefined,
                                          badges: undefined,
                                        });
                                        setSimplifiedOwnerAdded(false);
                                        setSimplifiedEditingParticipantId(null);
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
                                          {Array.isArray(suggestion.badges) && suggestion.badges.length > 0 && (
                                            <span className="mt-1 flex flex-wrap gap-1">
                                              {suggestion.badges.map((badge) => (
                                                <span
                                                  key={`${suggestion.id}-${badge}`}
                                                  className="inline-flex items-center rounded-full border border-p-border bg-p-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-p-text-muted"
                                                >
                                                  {badge}
                                                </span>
                                              ))}
                                            </span>
                                          )}
                                          {suggestion.secondary && (
                                            <span className="block text-[11px] text-p-text-muted">{suggestion.secondary}</span>
                                          )}
                                        </button>
                                      ))}
                                      {ownerHasTypedName && (
                                        <>
                                          {simplifiedOwnerSuggestions.length === 0 && !simplifiedOwnerSearchLoading && (
                                            <p className="px-2 py-1 text-[11px] text-p-text-muted">
                                              No encontramos personas con ese dato.
                                            </p>
                                          )}
                                          <button
                                            type="button"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => {
                                              if (!ownerParticipant) return;
                                              updateParticipant(ownerParticipant.id, {
                                                name: ownerParticipant.name.trim(),
                                                contact: '',
                                                dni: undefined,
                                                sourceType: 'guest',
                                                entityRef: undefined,
                                                selectedUserId: undefined,
                                                personKind: undefined,
                                                personKey: undefined,
                                                personSearchQuery: undefined,
                                                badges: undefined,
                                              });
                                              setSimplifiedOwnerSuggestionsOpen(false);
                                              setSimplifiedOwnerSearchLoading(false);
                                              setSimplifiedOwnerSuggestions([]);
                                              setFormError('');
                                              window.setTimeout(() => simplifiedOwnerPhoneInputRef.current?.focus(), 0);
                                            }}
                                            className="mt-1 w-full rounded-lg border border-dashed border-p-border px-2 py-2 text-left hover:bg-p-surface-2"
                                          >
                                            <span className="block text-[12px] font-semibold text-p-text">Cargar nuevo titular</span>
                                            <span className="block text-[11px] text-p-text-muted">
                                              Usar &quot;{ownerParticipant.name.trim()}&quot;, cargar teléfono y, si querés, sumar email o DNI acá mismo.
                                            </span>
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>,
                                  document.body
                                )}
                                </div>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <label className="block">
                                    <span className="text-[12px] font-medium text-p-text-muted">Teléfono</span>
                                    <input
                                      ref={simplifiedOwnerPhoneInputRef}
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
                                  <label className="block md:col-span-2">
                                    <span className="text-[12px] font-medium text-p-text-muted">DNI <span className="font-normal text-p-text-muted opacity-60">(opcional)</span></span>
                                    <input
                                      value={ownerDniDraft}
                                      onChange={(event) => {
                                        if (!ownerParticipant || ownerHasLinkedSelection) return;
                                        updateParticipant(ownerParticipant.id, {
                                          dni: event.target.value,
                                        });
                                      }}
                                      readOnly={ownerHasLinkedSelection}
                                      placeholder="30111222"
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
                                    Si no existe, cargá el teléfono para crear el nuevo titular al guardar la reserva.
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
                                    showAgendaToast(
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
                                                {Array.isArray(suggestion.badges) && suggestion.badges.length > 0 && (
                                                  <span className="mt-1 flex flex-wrap gap-1">
                                                    {suggestion.badges.map((badge) => (
                                                      <span
                                                        key={`${suggestion.id}-${badge}`}
                                                        className="inline-flex items-center rounded-full border border-p-border bg-p-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-p-text-muted"
                                                      >
                                                        {badge}
                                                      </span>
                                                    ))}
                                                  </span>
                                                )}
                                                {suggestion.secondary && (
                                                  <span className="block text-[11px] text-p-text-muted">{suggestion.secondary}</span>
                                                )}
                                              </button>
                                            ))}
                                            {simplifiedNewParticipantName.trim().length > 0 && (
                                              <>
                                                {simplifiedNewParticipantSuggestions.length === 0 && !simplifiedNewParticipantSearchLoading && (
                                                  <p className="px-2 py-1 text-[11px] text-p-text-muted">
                                                    No encontramos personas con ese dato.
                                                  </p>
                                                )}
                                                <button
                                                  type="button"
                                                  onMouseDown={(event) => event.preventDefault()}
                                                  onClick={() => {
                                                    setSimplifiedNewParticipantSourceTypeDraft('guest');
                                                    setSimplifiedNewParticipantEntityRefDraft('');
                                                    setSimplifiedNewParticipantSelectedUserIdDraft(undefined);
                                                    setSimplifiedNewParticipantPersonKindDraft(undefined);
                                                    setSimplifiedNewParticipantPersonKeyDraft(undefined);
                                                    setSimplifiedNewParticipantPersonSearchQueryDraft(undefined);
                                                    setSimplifiedNewParticipantBadgesDraft(undefined);
                                                    setSimplifiedNewParticipantSuggestionsOpen(false);
                                                    setSimplifiedNewParticipantSearchLoading(false);
                                                    setSimplifiedNewParticipantSuggestions([]);
                                                    setFormError('');
                                                  }}
                                                  className="mt-1 w-full rounded-lg border border-dashed border-p-border px-2 py-2 text-left shadow-p-md hover:bg-p-surface-2 hover:shadow-p-md"
                                                >
                                                  <span className="block text-[12px] font-semibold text-p-text">Crear nuevo cliente</span>
                                                  <span className="block text-[11px] text-p-text-muted">
                                                    Usar &quot;{simplifiedNewParticipantName.trim()}&quot;, cargar teléfono y, si querés, sumar email o DNI acá mismo.
                                                  </span>
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>,
                                        document.body
                                      )}
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                      <input
                                        value={simplifiedNewParticipantPhoneDraft}
                                        onChange={(event) => {
                                          if (simplifiedNewParticipantHasLinkedSelection) return;
                                          setSimplifiedNewParticipantContact(
                                            buildParticipantContactFromFields(
                                              event.target.value,
                                              simplifiedNewParticipantEmailDraft
                                            )
                                          );
                                        }}
                                        readOnly={simplifiedNewParticipantHasLinkedSelection}
                                        placeholder="Teléfono"
                                        className={`h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                          simplifiedNewParticipantHasLinkedSelection
                                            ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                            : 'border-p-border bg-p-surface'
                                        }`}
                                      />
                                      <input
                                        type="email"
                                        value={simplifiedNewParticipantEmailDraft}
                                        onChange={(event) => {
                                          if (simplifiedNewParticipantHasLinkedSelection) return;
                                          setSimplifiedNewParticipantContact(
                                            buildParticipantContactFromFields(
                                              simplifiedNewParticipantPhoneDraft,
                                              event.target.value
                                            )
                                          );
                                        }}
                                        readOnly={simplifiedNewParticipantHasLinkedSelection}
                                        placeholder="Email (opcional)"
                                        className={`h-11 w-full rounded-xl border px-3 text-[15px] outline-none ${
                                          simplifiedNewParticipantHasLinkedSelection
                                            ? 'border-p-border bg-p-surface-2 text-p-text-secondary cursor-not-allowed'
                                            : 'border-p-border bg-p-surface'
                                        }`}
                                      />
                                    </div>
                                  </div>
                                  {simplifiedNewParticipantHasLinkedSelection && (
                                    <div className="mt-2 flex items-center justify-between gap-2">
                                      <div>
                                        <p className="text-[12px] text-p-text-muted">
                                          Registro asociado seleccionado. No se puede editar manualmente.
                                        </p>
                                        {Array.isArray(simplifiedNewParticipantBadgesDraft) && simplifiedNewParticipantBadgesDraft.length > 0 && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {simplifiedNewParticipantBadgesDraft.map((badge) => (
                                              <span
                                                key={`draft-badge-${badge}`}
                                                className="inline-flex items-center rounded-full border border-p-border bg-p-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-p-text-muted"
                                              >
                                                {badge}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={resetSimplifiedNewParticipantDraft}
                                        className="shrink-0 text-[12px] font-semibold text-p-accent hover:text-[var(--accent-hover)]"
                                      >
                                        Cambiar selección
                                      </button>
                                    </div>
                                  )}
                                  {simplifiedNewParticipantName.trim().length > 0 && !hasValidSimplifiedNewParticipantName && (
                                    <p className="mt-2 text-[12px] text-p-text-muted">
                                      Seleccioná una persona existente o cargá teléfono para crear un cliente nuevo.
                                    </p>
                                  )}
                                  <div className="mt-3 flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!hasValidSimplifiedNewParticipantName) return;
                                        const normalizedEntityRef = simplifiedNewParticipantEntityRefDraft.trim();
                                        const duplicateLinked = participants.some(
                                          (participant) =>
                                            !participant.isOwner &&
                                            String(participant.entityRef || '').trim() === normalizedEntityRef
                                        );
                                        if (normalizedEntityRef && duplicateLinked) {
                                          setFormError('Ese participante ya está agregado en esta reserva.');
                                          return;
                                        }
                                        const participantDraft: Participant = {
                                          id: `player-${Date.now()}`,
                                          name: simplifiedNewParticipantName.trim(),
                                          contact: simplifiedNewParticipantContact.trim(),
                                          dni: undefined,
                                          paid: false,
                                          isOwner: false,
                                          sourceType: simplifiedNewParticipantSourceTypeDraft,
                                          entityRef: simplifiedNewParticipantEntityRefDraft || undefined,
                                          selectedUserId: simplifiedNewParticipantSelectedUserIdDraft,
                                          personKind: simplifiedNewParticipantPersonKindDraft,
                                          personKey: simplifiedNewParticipantPersonKeyDraft,
                                          personSearchQuery: simplifiedNewParticipantPersonSearchQueryDraft,
                                          badges: simplifiedNewParticipantBadgesDraft,
                                          paymentMethod: 'CASH',
                                          customPrice: null,
                                        };
                                        try {
                                          if (persistedEditingBookingId) {
                                            const result = await addParticipantToExistingBooking(
                                              persistedEditingBookingId,
                                              participantDraft,
                                              {
                                                successMessage: 'Participante agregado correctamente.',
                                                onSuccess: () => {
                                                  resetSimplifiedNewParticipantDraft();
                                                  setFormError('');
                                                },
                                              }
                                            );
                                            if (result === 'deferred') return;
                                          } else {
                                            setParticipants((previous) => [...previous, participantDraft]);
                                            resetSimplifiedNewParticipantDraft();
                                            setFormError('');
                                          }
                                        } catch (error: any) {
                                          const normalized = normalizeApiError(error, 'No se pudo agregar el participante.');
                                          setFormError(toUserSafeMessage(normalized.message, 'No se pudo agregar el participante.'));
                                        }
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
                                      onClick={resetSimplifiedNewParticipantDraft}
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
                      <BookingAccountSummarySection
                        className="mt-3"
                        totalAmount={simplifiedFinancialTotal}
                        paidAmount={simplifiedPaidAmount}
                        remainingAmount={simplifiedRemainingAmount}
                        courtAmount={bookingCourtAmount}
                        consumptionsAmount={bookingItemsAmount}
                        isPending={isFinancialDisplayPending}
                        onOpenOverview={() => {
                          void openAgendaAccountDrawer(persistedEditingBookingId || 0, 'overview');
                        }}
                        onOpenPayment={() => {
                          void openAgendaAccountDrawer(persistedEditingBookingId || 0, 'payment');
                        }}
                        disableOverview={!persistedEditingBookingId}
                        disablePayment={!simplifiedCanRegisterPayment}
                        helperMessage={
                          !persistedEditingBookingId
                            ? 'Primero creá la reserva.'
                            : isPaymentLockedByManualPending
                              ? 'Confirmá la reserva para habilitar pagos.'
                              : null
                        }
                      />
                    )}
                  </section>

                  <section className="py-6 border-b border-p-border">
                    <div className="flex items-end justify-between">
                      <p className="text-[19px] font-semibold tracking-[-0.01em] text-p-text">Participantes</p>
                    </div>
                    <p className="mt-2 text-[12px] text-p-text-muted">
                      Acá gestionás personas de la reserva. La cuenta y los cobros se manejan desde <strong>Cuenta</strong>.
                    </p>

                    <div className="mt-3 space-y-3">
                      {orderedParticipants.map((participant) => {
                        const isDuplicateParticipant = duplicateParticipantIds.has(participant.id);
                        const normalizedParticipantRef = String((participant as any).entityRef || '').trim().toLowerCase();
                        const participantIsLinkedRecord =
                          participant.sourceType !== 'guest' ||
                          normalizedParticipantRef.startsWith('client:') ||
                          normalizedParticipantRef.startsWith('user:');
                        const showParticipantActions = !(participant.isOwner && (participantIsLinkedRecord || !persistedEditingBookingId));
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
                            <div className="grid grid-cols-[1fr_20px] gap-2 items-center">
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
                              {showParticipantActions && (
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
                              )}
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

      <DuplicateClientDecisionModal
        open={duplicateDecisionOpen}
        candidates={duplicateDecisionCandidates}
        selectedClientId={duplicateDecisionSelectedClientId}
        loading={duplicateDecisionLoading}
        error={duplicateDecisionError}
        onSelectClient={setDuplicateDecisionSelectedClientId}
        onClose={closeDuplicateDecisionModal}
        onUseExisting={() => void runDuplicateDecisionRetry('USE_EXISTING')}
        onCreateNew={() => void runDuplicateDecisionRetry('CREATE_NEW')}
      />

      <ChangeTitularModal
        open={changeTitularModalOpen}
        currentTitle={String(editingBooking?.title || '').trim()}
        search={changeTitularSearch}
        reason={changeTitularReason}
        candidates={changeTitularCandidates}
        selectedKey={changeTitularSelectedKey}
        selectedCandidate={changeTitularSelectedCandidate}
        draftName={changeTitularDraftName}
        draftPhone={changeTitularDraftPhone}
        draftEmail={changeTitularDraftEmail}
        draftDni={changeTitularDraftDni}
        loading={changeTitularLoading}
        submitting={changeTitularSubmitting}
        error={changeTitularError}
        onSearchChange={(value) => {
          setChangeTitularSearch(value);
          setChangeTitularSelectedKey('');
          setChangeTitularDraftName('');
          setChangeTitularDraftPhone('');
          setChangeTitularDraftEmail('');
          setChangeTitularDraftDni('');
        }}
        onReasonChange={setChangeTitularReason}
        onSelectCandidate={(candidateKey) => {
          setChangeTitularSelectedKey(candidateKey);
          setChangeTitularDraftName('');
          setChangeTitularDraftPhone('');
          setChangeTitularDraftEmail('');
          setChangeTitularDraftDni('');
          setChangeTitularError('');
        }}
        onDraftNameChange={setChangeTitularDraftName}
        onDraftPhoneChange={setChangeTitularDraftPhone}
        onDraftEmailChange={setChangeTitularDraftEmail}
        onDraftDniChange={setChangeTitularDraftDni}
        onUseNewClient={() => {
          setChangeTitularSelectedKey('');
          setChangeTitularDraftName(String(changeTitularSearch || '').trim());
          setChangeTitularDraftPhone('');
          setChangeTitularDraftEmail('');
          setChangeTitularDraftDni('');
          setChangeTitularError('');
        }}
        onClose={closeChangeTitularModal}
        onSubmit={() => void submitChangeTitular()}
      />

      <AccountDrawer
        accountId={accountDrawerAccountId}
        open={accountDrawerOpen}
        initialView={accountDrawerInitialView}
        context={accountDrawerContext}
        onClose={closeAgendaAccountDrawer}
        onSuccess={() => {
          const bookingId = Number(accountDrawerBookingIdRef.current || persistedEditingBookingId || 0);
          if (!Number.isFinite(bookingId) || bookingId <= 0) return;
          void refreshPersistedBookingView(bookingId, {
            schedule: true,
            financial: true,
            consumptions: true,
            history: true,
          });
        }}
      />
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
