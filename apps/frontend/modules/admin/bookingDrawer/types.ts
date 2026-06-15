export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type ChargeMode = 'INDIVIDUAL' | 'SHARED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
export type SaveStatus = 'IDLE' | 'SAVING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type Money = number;

export type BookingPaymentLifecycleStatus =
  | 'CONFIRMED'
  | 'PENDING'
  | 'VOIDED'
  | 'REFUNDED';

export interface BookingParticipant {
  id: string;
  personId?: number;
  displayName: string;
  contact?: string;
  sourceType: 'clubClient' | 'systemUser' | 'guest';
  linked: boolean;
  bookingRole: 'BOOKING_RESPONSIBLE' | 'PARTICIPANT';
  archived?: boolean;
  archivedAt?: string;
}

export interface PaymentAssignment {
  id: string;
  participantId: string;
  isChargeable: boolean;
  assignedAmount: Money;
  participantLinkState?: 'ACTIVE' | 'ARCHIVED_REFERENCE';
}

export interface BookingPayment {
  id: string;
  bookingId: number;
  amount: Money;
  method: PaymentMethod;
  status: BookingPaymentLifecycleStatus;
  createdAt: string;
  createdByUserId: number;
  assignmentId?: string;
  note?: string;
}

export interface FinancialSummary {
  totalAmount: Money;
  paidAmount: Money;
  remainingAmount: Money;
  paymentStatus: PaymentStatus;
  depositRequiredAmount?: Money;
  depositPaidAmount?: Money;
}

export interface BookingOperationalDraft {
  bookingId?: number;
  clubId: number;
  courtId: number;
  activityId: number;
  startDateTime: string;
  endDateTime: string;
  status: BookingStatus;
  notes?: string;
  bookingResponsibleParticipantId?: string;
}

export interface BookingBillingDraft {
  chargeMode: ChargeMode;
  chargeResponsibleParticipantId?: string;
  assignments: PaymentAssignment[];
  payments: BookingPayment[];
  pendingPaymentsQueue: Array<{
    clientTempId: string;
    amount: Money;
    method: PaymentMethod;
    assignmentId?: string;
    note?: string;
  }>;
  financialSummary: FinancialSummary;
}

export interface BookingDrawerDraft {
  operational: BookingOperationalDraft;
  participants: BookingParticipant[];
  billing: BookingBillingDraft;
}

export interface BookingDrawerState {
  source: BookingDrawerDraft | null;
  draft: BookingDrawerDraft | null;
  ui: {
    activeBillingTab: 'SUMMARY' | 'ASSIGNMENTS' | 'PAYMENTS';
    loading: boolean;
    saveStatus: SaveStatus;
    saveMessage?: string;
    savePartial?: {
      operationalSaved: boolean;
      billingSaved: boolean;
      failedPaymentTempIds: string[];
    };
    errors: Record<string, string>;
    warnings: string[];
    dirtyFlags: {
      operational: boolean;
      billingConfig: boolean;
      paymentsQueue: boolean;
    };
  };
}

export interface BookingDrawerDTO {
  booking: {
    id: number;
    clubId: number;
    courtId: number;
    activityId: number;
    startDateTime: string;
    endDateTime: string;
    status: BookingStatus;
    notes?: string;
    bookingResponsiblePersonId?: number;
  };
  financialSummary: {
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    paymentStatus: PaymentStatus;
    depositRequiredAmount?: number;
    depositPaidAmount?: number;
  };
  participants: Array<{
    personId?: number;
    name: string;
    contact?: string;
    sourceType: 'clubClient' | 'systemUser' | 'guest';
    bookingRole: 'BOOKING_RESPONSIBLE' | 'PARTICIPANT';
  }>;
  billingConfig: {
    chargeMode: ChargeMode;
    chargeResponsiblePersonId?: number;
    assignments: Array<{
      id: string;
      participantPersonId?: number;
      participantTempKey?: string;
      isChargeable: boolean;
      assignedAmount: number;
    }>;
  };
  payments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    status?: BookingPaymentLifecycleStatus;
    createdAt: string;
    createdByUserId: number;
    assignmentId?: string;
    note?: string;
  }>;
}
