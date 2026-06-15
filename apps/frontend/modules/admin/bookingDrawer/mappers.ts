import type {
  BookingDrawerDTO,
  BookingDrawerDraft,
  BookingParticipant,
  BookingPayment,
} from './types';
import { recomputeFinancialSummaryOnly, roundMoney } from './helpers';

function participantLocalIdFromDTO(index: number, personId?: number, name?: string) {
  if (personId && Number.isFinite(personId)) return `person-${personId}`;
  return `guest-${index}-${String(name || '').trim().toLowerCase().replace(/\s+/g, '-') || 'participant'}`;
}

export function fromDTOToDraft(dto: BookingDrawerDTO): BookingDrawerDraft {
  const participants: BookingParticipant[] = (dto.participants || []).map((item, index) => ({
    id: participantLocalIdFromDTO(index, item.personId, item.name),
    personId: item.personId,
    displayName: String(item.name || ''),
    contact: String(item.contact || ''),
    sourceType: item.sourceType,
    linked: Boolean(item.personId),
    bookingRole: item.bookingRole,
  }));

  const payments: BookingPayment[] = (dto.payments || []).map((payment) => ({
    id: payment.id,
    bookingId: dto.booking.id,
    amount: roundMoney(payment.amount),
    method: payment.method,
    status: payment.status || 'CONFIRMED',
    createdAt: payment.createdAt,
    createdByUserId: payment.createdByUserId,
    assignmentId: payment.assignmentId,
    note: payment.note,
  }));

  const assignments = (dto.billingConfig.assignments || []).map((assignment, index) => {
    const participantByPerson = participants.find(
      (participant) => participant.personId && participant.personId === assignment.participantPersonId
    );
    const participantId =
      participantByPerson?.id ||
      assignment.participantTempKey ||
      `unmatched-${index}`;

    return {
      id: assignment.id || `asg-${participantId}`,
      participantId,
      isChargeable: Boolean(assignment.isChargeable),
      assignedAmount: roundMoney(assignment.assignedAmount),
      participantLinkState: (participantByPerson ? 'ACTIVE' : 'ARCHIVED_REFERENCE') as 'ACTIVE' | 'ARCHIVED_REFERENCE',
    };
  });

  const chargeResponsibleParticipantId =
    participants.find((participant) => participant.personId === dto.billingConfig.chargeResponsiblePersonId)?.id;
  const bookingResponsibleParticipantId =
    participants.find((participant) => participant.personId === dto.booking.bookingResponsiblePersonId)?.id;

  return recomputeFinancialSummaryOnly({
    operational: {
      bookingId: dto.booking.id,
      clubId: dto.booking.clubId,
      courtId: dto.booking.courtId,
      activityId: dto.booking.activityId,
      startDateTime: dto.booking.startDateTime,
      endDateTime: dto.booking.endDateTime,
      status: dto.booking.status,
      notes: dto.booking.notes || '',
      bookingResponsibleParticipantId,
    },
    participants,
    billing: {
      chargeMode: dto.billingConfig.chargeMode,
      chargeResponsibleParticipantId,
      assignments,
      payments,
      pendingPaymentsQueue: [],
      financialSummary: {
        totalAmount: roundMoney(dto.financialSummary.totalAmount),
        paidAmount: roundMoney(dto.financialSummary.paidAmount),
        remainingAmount: roundMoney(dto.financialSummary.remainingAmount),
        paymentStatus: dto.financialSummary.paymentStatus,
        depositRequiredAmount:
          dto.financialSummary.depositRequiredAmount == null
            ? undefined
            : roundMoney(dto.financialSummary.depositRequiredAmount),
        depositPaidAmount:
          dto.financialSummary.depositPaidAmount == null
            ? undefined
            : roundMoney(dto.financialSummary.depositPaidAmount),
      },
    },
  });
}

export function fromDraftToOperationalPayload(draft: BookingDrawerDraft) {
  const bookingResponsible = draft.participants.find(
    (participant) => participant.id === draft.operational.bookingResponsibleParticipantId
  );

  return {
    courtId: draft.operational.courtId,
    activityId: draft.operational.activityId,
    startDateTime: draft.operational.startDateTime,
    endDateTime: draft.operational.endDateTime,
    status: draft.operational.status,
    notes: draft.operational.notes || '',
    bookingResponsiblePersonId: bookingResponsible?.personId,
  };
}

export function fromDraftToBillingConfigPayload(draft: BookingDrawerDraft) {
  const chargeResponsible = draft.participants.find(
    (participant) => participant.id === draft.billing.chargeResponsibleParticipantId
  );

  return {
    chargeMode: draft.billing.chargeMode,
    chargeResponsiblePersonId: chargeResponsible?.personId,
    assignments: draft.billing.assignments.map((assignment) => {
      const participant = draft.participants.find((entry) => entry.id === assignment.participantId);
      return {
        id: assignment.id,
        participantPersonId: participant?.personId,
        participantTempKey: participant?.id,
        isChargeable: assignment.isChargeable,
        assignedAmount: roundMoney(assignment.assignedAmount),
      };
    }),
  };
}

export function toRegisterPaymentPayload(input: {
  bookingId: number;
  amount: number;
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  assignmentId?: string;
  note?: string;
}) {
  return {
    bookingId: input.bookingId,
    amount: roundMoney(input.amount),
    method: input.method,
    assignmentId: input.assignmentId,
    note: input.note?.trim() || undefined,
  };
}
