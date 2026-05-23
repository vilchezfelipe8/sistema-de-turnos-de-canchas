import type { LucideIcon } from 'lucide-react';

export type SportFilter = string;

export type Court = {
  id: string;
  name: string;
  sport: string;
  activityTypeId?: number;
  defaultDurationMinutes?: number;
};

export type Booking = {
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

export type DraftSelection = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

export type BookingDropPreview = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

export type EditSeriesScope = 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';

export type RecurringOverlapItem = {
  courtName: string;
  requestedDateLabel: string;
  requestedTimeLabel: string;
  conflictingDateLabel?: string;
  conflictingTimeLabel?: string;
  activityName?: string;
  clientName?: string;
};

export type RecurringCreatedItem = {
  bookingId?: number;
  courtName: string;
  requestedDateLabel: string;
  requestedTimeLabel: string;
  activityName?: string;
  sortStartMs?: number;
};

export type SeriesPaidOccurrence = Omit<RecurringCreatedItem, 'bookingId'> & {
  bookingId: number;
  paidAmount: number;
};

export type SeriesScopePreviewSummary = {
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

export type SeriesOperationResult = {
  mode: 'edit' | 'delete';
  title: string;
  detail: string;
  appliedCount: number;
  appliedItems: RecurringCreatedItem[];
  skippedCount: number;
  overlapItems: RecurringOverlapItem[];
};

export type RecurringExecutionPlan = {
  recurrenceDays: number[];
  frequencyDays: number;
  repetitionsPerDay?: number;
  error?: string;
};

export type DraggingBookingMeta = {
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

export type PendingBookingPointer = {
  booking: Booking;
  startX: number;
  startY: number;
};

export type EditingBaseline = {
  id: string;
  courtId: string;
  startSlot: number;
  endSlot: number;
  title: string;
};

export type Participant = {
  id: string;
  bookingParticipantId?: string;
  name: string;
  contact: string;
  dni?: string;
  paid: boolean;
  isOwner: boolean;
  sourceType: 'clubClient' | 'systemUser' | 'guest';
  entityRef?: string;
  selectedUserId?: number;
  personKind?: 'linked' | 'clubClient' | 'systemUser' | 'newClientSuggestion';
  personKey?: string;
  personSearchQuery?: string;
  badges?: string[];
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  customPrice: number | null;
};

export type ParticipantSuggestion = {
  id: string;
  label: string;
  secondary?: string;
  sourceType: Participant['sourceType'];
  entityRef?: string;
  name: string;
  contact?: string;
  dni?: string;
  personKind?: Participant['personKind'];
  personKey?: string;
  personSearchQuery?: string;
  badges?: string[];
  selectedUserId?: number;
};

export type BookingHistoryTimelineEvent = {
  id: string;
  title: string;
  detail: string;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  sortKey: number;
};

export type BookingHistoryTimelineGroup = {
  dateKey: string;
  dateLabel: string;
  events: BookingHistoryTimelineEvent[];
};

export type BookingKind = 'regular' | 'recurringV2' | 'privateClass' | 'courseClass' | 'block';
export type RecurringFrequencyPreset = 'weekly' | 'biweekly' | 'custom';
export type CancelRefundReasonType =
  | 'FULL'
  | 'PARTIAL_COMMERCIAL'
  | 'PARTIAL_SERVICE_FAILURE'
  | 'PARTIAL_PRICING_ERROR'
  | 'OTHER';
export type ComboOption = { value: string; label: string; secondary?: string };
export type SimplifiedSidebarSection = 'DETAILS' | 'CONSUMPTIONS' | 'BILLING' | 'HISTORY';
export type ClubProductOption = {
  id: number;
  name: string;
  price: number;
  stock: number | null;
  isActive: boolean;
};
export type BookingConsumptionItem = {
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
export type ParticipantUiState =
  | { mode: 'idle'; participantId: null }
  | { mode: 'menu'; participantId: string }
  | { mode: 'editing'; participantId: string };
export type SuggestionPlacement = {
  openUp: boolean;
  maxHeight: number;
};

export type DuplicateClientCandidate = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
};

export type DuplicateDecisionActions = {
  onUseExisting: (clientId: string) => Promise<void>;
  onCreateNew: () => Promise<void>;
};

export type BookingKindOption = {
  value: BookingKind;
  label: string;
  description: string;
  icon: LucideIcon;
};
