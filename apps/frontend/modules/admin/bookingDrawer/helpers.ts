import type {
  BookingDrawerDraft,
  BookingPayment,
  FinancialSummary,
  PaymentAssignment,
  PaymentStatus,
} from './types';

function isSyntheticLegacyPayment(payment: BookingPayment): boolean {
  const id = String(payment.id || '').trim().toLowerCase();
  const note = String(payment.note || '').trim().toLowerCase();
  if (id.startsWith('legacy-paid-')) return true;
  if (note.includes('(legacy)')) return true;
  if (note.includes('pago ya registrado')) return true;
  return false;
}

export function roundMoney(value: number): number {
  return Number((Math.max(0, Number(value || 0)) || 0).toFixed(2));
}

export function getConfirmedPaidAmount(payments: BookingPayment[]): number {
  return roundMoney(
    payments
      .filter((payment) => payment.status === 'CONFIRMED')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
}

export function getPaymentStatus(total: number, paid: number): PaymentStatus {
  if (paid <= 0.009) return 'UNPAID';
  if (Math.max(0, total - paid) <= 0.009) return 'PAID';
  return 'PARTIAL';
}

export function recomputeFinancialSummaryOnly(draft: BookingDrawerDraft): BookingDrawerDraft {
  const prev = draft.billing.financialSummary;
  const paidAmount = getConfirmedPaidAmount(draft.billing.payments);
  const remainingAmount = roundMoney(Math.max(0, Number(prev.totalAmount || 0) - paidAmount));

  const nextSummary: FinancialSummary = {
    ...prev,
    paidAmount,
    remainingAmount,
    paymentStatus: getPaymentStatus(Number(prev.totalAmount || 0), paidAmount),
  };

  return {
    ...draft,
    billing: {
      ...draft.billing,
      financialSummary: nextSummary,
    },
  };
}

export function getUnattributedPaidAmount(payments: BookingPayment[]): number {
  return roundMoney(
    payments
      .filter(
        (payment) =>
          payment.status === 'CONFIRMED' &&
          !payment.assignmentId &&
          !isSyntheticLegacyPayment(payment)
      )
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
}

export function hasArchivedReferenceAssignments(draft: BookingDrawerDraft): boolean {
  return draft.billing.assignments.some((assignment) => assignment.participantLinkState === 'ARCHIVED_REFERENCE');
}

export function computeWarnings(draft: BookingDrawerDraft): string[] {
  const warnings: string[] = [];
  const summary = draft.billing.financialSummary;
  const assignedAmount = roundMoney(
    draft.billing.assignments.reduce((sum, assignment) => {
      if (!assignment.isChargeable) return sum;
      return sum + Number(assignment.assignedAmount || 0);
    }, 0)
  );

  if (summary.paidAmount > summary.totalAmount + 0.009) warnings.push('OVERPAID_BOOKING');
  if (Math.abs(assignedAmount - summary.totalAmount) > 0.009) warnings.push('ASSIGNMENT_SUM_MISMATCH');
  if (getUnattributedPaidAmount(draft.billing.payments) > 0.009) warnings.push('UNATTRIBUTED_PAYMENTS');
  if (draft.operational.status === 'CANCELLED' && summary.paidAmount > 0.009) warnings.push('CANCELLED_WITH_PAYMENTS');
  if (hasArchivedReferenceAssignments(draft)) warnings.push('ARCHIVED_PARTICIPANT_WITH_HISTORY');

  if (
    draft.billing.chargeMode === 'INDIVIDUAL' &&
    !draft.billing.chargeResponsibleParticipantId
  ) {
    warnings.push('INDIVIDUAL_WITHOUT_CHARGE_RESPONSIBLE');
  }

  return warnings;
}

export function removeParticipantSafely(
  draft: BookingDrawerDraft,
  participantId: string,
  archivedAt: string
): BookingDrawerDraft {
  const assignmentIds = draft.billing.assignments
    .filter((assignment) => assignment.participantId === participantId)
    .map((assignment) => assignment.id);

  const hasHistory = draft.billing.payments.some(
    (payment) => payment.assignmentId && assignmentIds.includes(payment.assignmentId)
  );

  if (!hasHistory) {
    return {
      ...draft,
      participants: draft.participants.filter((participant) => participant.id !== participantId),
      billing: {
        ...draft.billing,
        assignments: draft.billing.assignments.filter((assignment) => assignment.participantId !== participantId),
      },
    };
  }

  return {
    ...draft,
    participants: draft.participants.map((participant) =>
      participant.id === participantId
        ? { ...participant, archived: true, archivedAt }
        : participant
    ),
    billing: {
      ...draft.billing,
      assignments: draft.billing.assignments.map((assignment) =>
        assignment.participantId === participantId
          ? {
              ...assignment,
              participantLinkState: 'ARCHIVED_REFERENCE',
              isChargeable: false,
              assignedAmount: 0,
            }
          : assignment
      ),
    },
  };
}

export function buildSharedAssignments(
  participants: BookingDrawerDraft['participants'],
  totalAmount: number,
  previousAssignments: PaymentAssignment[]
): PaymentAssignment[] {
  const activeParticipants = participants.filter((participant) => !participant.archived);
  const chargeableParticipants = activeParticipants.filter(
    (participant) => participant.displayName.trim().length > 0
  );
  const baseAmount = chargeableParticipants.length > 0
    ? roundMoney(totalAmount / chargeableParticipants.length)
    : 0;
  let remainder = roundMoney(totalAmount - baseAmount * chargeableParticipants.length);

  return participants.map((participant) => {
    const previous = previousAssignments.find((assignment) => assignment.participantId === participant.id);
    const isChargeable = chargeableParticipants.some((entry) => entry.id === participant.id);
    if (!isChargeable) {
      return {
        id: previous?.id || `asg-${participant.id}`,
        participantId: participant.id,
        isChargeable: false,
        assignedAmount: 0,
        participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
      } satisfies PaymentAssignment;
    }

    if (previous) {
      return {
        ...previous,
        isChargeable: true,
        participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
      } satisfies PaymentAssignment;
    }

    const plus = remainder > 0.009 ? Math.min(0.01, remainder) : 0;
    const assigned = roundMoney(baseAmount + plus);
    remainder = roundMoney(remainder - plus);

    return {
      id: `asg-${participant.id}`,
      participantId: participant.id,
      isChargeable: true,
      assignedAmount: assigned,
      participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
    } satisfies PaymentAssignment;
  });
}
