import type {
  BookingDrawerDraft,
  BookingDrawerState,
  BookingParticipant,
  ChargeMode,
  Money,
  BookingPayment,
  PaymentAssignment,
} from './types';
import {
  recomputeFinancialSummaryOnly,
  computeWarnings,
  removeParticipantSafely,
  buildSharedAssignments,
  roundMoney,
} from './helpers';

export type BillingTab = 'SUMMARY' | 'ASSIGNMENTS' | 'PAYMENTS';

export type BookingDrawerEvent =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: BookingDrawerDraft }
  | { type: 'LOAD_FAILED'; payload: { message: string } }
  | { type: 'CLEAR' }
  | { type: 'SET_BILLING_TAB'; payload: BillingTab }
  | {
      type: 'SYNC_FROM_FORM';
      payload: {
        participants: BookingParticipant[];
        bookingResponsibleParticipantId?: string;
        chargeMode: ChargeMode;
        totalAmount: Money;
      };
    }
  | { type: 'UPDATE_OPERATIONAL'; payload: Partial<BookingDrawerDraft['operational']> }
  | { type: 'ADD_PARTICIPANT'; payload: BookingParticipant }
  | { type: 'UPDATE_PARTICIPANT'; payload: { participantId: string; patch: Partial<BookingParticipant> } }
  | { type: 'REMOVE_PARTICIPANT'; payload: { participantId: string; archivedAt: string } }
  | { type: 'SET_CHARGE_MODE'; payload: { mode: ChargeMode; chargeResponsibleParticipantId?: string } }
  | { type: 'SET_CHARGE_RESPONSIBLE'; payload: { participantId: string } }
  | { type: 'SET_ASSIGNMENT_AMOUNT'; payload: { assignmentId: string; amount: Money } }
  | { type: 'TOGGLE_ASSIGNMENT_CHARGEABLE'; payload: { assignmentId: string; isChargeable: boolean } }
  | { type: 'QUEUE_PAYMENT'; payload: BookingDrawerDraft['billing']['pendingPaymentsQueue'][number] }
  | { type: 'DEQUEUE_PAYMENT'; payload: { clientTempId: string } }
  | { type: 'REGISTER_PAYMENT_LOCAL'; payload: BookingPayment }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; payload?: BookingDrawerDraft }
  | {
      type: 'SAVE_PARTIAL';
      payload: {
        message: string;
        operationalSaved: boolean;
        billingSaved: boolean;
        failedPaymentTempIds: string[];
      };
    }
  | { type: 'SAVE_FAILED'; payload: { message: string } }
  | { type: 'RESET_TO_SOURCE' };

export const initialBookingDrawerState: BookingDrawerState = {
  source: null,
  draft: null,
  ui: {
    activeBillingTab: 'SUMMARY',
    loading: false,
    saveStatus: 'IDLE',
    saveMessage: undefined,
    savePartial: undefined,
    errors: {},
    warnings: [],
    dirtyFlags: {
      operational: false,
      billingConfig: false,
      paymentsQueue: false,
    },
  },
};

function withDerived(state: BookingDrawerState, nextDraft: BookingDrawerDraft): BookingDrawerState {
  const draft = recomputeFinancialSummaryOnly(nextDraft);
  return {
    ...state,
    draft,
    ui: {
      ...state.ui,
      warnings: computeWarnings(draft),
    },
  };
}

function buildSyncComparableSnapshot(draft: BookingDrawerDraft | null) {
  if (!draft) return null;

  const participants = [...draft.participants]
    .map((participant) => ({
      id: String(participant.id || ''),
      personId: Number(participant.personId || 0) || 0,
      displayName: String(participant.displayName || ''),
      contact: String(participant.contact || ''),
      sourceType: participant.sourceType,
      linked: Boolean(participant.linked),
      bookingRole: participant.bookingRole,
      archived: Boolean(participant.archived),
      archivedAt: String(participant.archivedAt || ''),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const assignments = [...draft.billing.assignments]
    .map((assignment) => ({
      id: String(assignment.id || ''),
      participantId: String(assignment.participantId || ''),
      isChargeable: Boolean(assignment.isChargeable),
      assignedAmount: roundMoney(Number(assignment.assignedAmount || 0)),
      participantLinkState:
        assignment.participantLinkState === 'ARCHIVED_REFERENCE'
          ? 'ARCHIVED_REFERENCE'
          : 'ACTIVE',
    }))
    .sort((left, right) => {
      const byId = left.id.localeCompare(right.id);
      if (byId !== 0) return byId;
      return left.participantId.localeCompare(right.participantId);
    });

  return {
    bookingResponsibleParticipantId: String(draft.operational.bookingResponsibleParticipantId || ''),
    participants,
    billing: {
      chargeMode: draft.billing.chargeMode,
      chargeResponsibleParticipantId: String(draft.billing.chargeResponsibleParticipantId || ''),
      totalAmount: roundMoney(Number(draft.billing.financialSummary.totalAmount || 0)),
      assignments,
    },
  };
}

function hasSyncFormDiff(reference: BookingDrawerDraft | null, candidate: BookingDrawerDraft): boolean {
  const left = buildSyncComparableSnapshot(reference);
  const right = buildSyncComparableSnapshot(candidate);
  if (!left || !right) return true;
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function bookingDrawerReducer(
  state: BookingDrawerState,
  event: BookingDrawerEvent
): BookingDrawerState {
  switch (event.type) {
    case 'CLEAR':
      return initialBookingDrawerState;

    case 'LOAD_START':
      return {
        ...state,
        ui: {
          ...state.ui,
          loading: true,
          errors: {},
        },
      };

    case 'LOAD_SUCCESS': {
      const draft = recomputeFinancialSummaryOnly(event.payload);
      return {
        source: draft,
        draft,
        ui: {
          ...state.ui,
          loading: false,
          saveStatus: 'IDLE',
          saveMessage: undefined,
          savePartial: undefined,
          errors: {},
          warnings: computeWarnings(draft),
          dirtyFlags: {
            operational: false,
            billingConfig: false,
            paymentsQueue: false,
          },
        },
      };
    }

    case 'LOAD_FAILED':
      return {
        ...state,
        ui: {
          ...state.ui,
          loading: false,
          errors: { load: event.payload.message },
        },
      };

    case 'SET_BILLING_TAB':
      return { ...state, ui: { ...state.ui, activeBillingTab: event.payload } };

    case 'SYNC_FROM_FORM': {
      if (!state.draft) return state;

      const totalAmount = roundMoney(event.payload.totalAmount);
      const nextChargeMode = event.payload.chargeMode;
      const activeParticipants = event.payload.participants.map((participant) => ({
        ...participant,
        archived: false,
        archivedAt: undefined,
      }));
      const archivedParticipants = state.draft.participants.filter((participant) => participant.archived);
      const activeParticipantIds = new Set(activeParticipants.map((participant) => participant.id));
      const mergedParticipants = [
        ...activeParticipants,
        ...archivedParticipants.filter((participant) => !activeParticipantIds.has(participant.id)),
      ];

      const previousAssignments = state.draft.billing.assignments;
      const fallbackResponsible =
        event.payload.bookingResponsibleParticipantId ||
        activeParticipants.find((participant) => participant.bookingRole === 'BOOKING_RESPONSIBLE')?.id ||
        activeParticipants[0]?.id;

      let nextChargeResponsibleParticipantId: string | undefined;
      let nextAssignments: PaymentAssignment[] = [];

      if (nextChargeMode === 'INDIVIDUAL') {
        const currentResponsible = state.draft.billing.chargeResponsibleParticipantId;
        const resolvedResponsible = currentResponsible && activeParticipantIds.has(currentResponsible)
          ? currentResponsible
          : fallbackResponsible;
        nextChargeResponsibleParticipantId = resolvedResponsible;
        nextAssignments = mergedParticipants.map((participant) => {
          const previous = previousAssignments.find((assignment) => assignment.participantId === participant.id);
          const isChargeable =
            !participant.archived &&
            Boolean(nextChargeResponsibleParticipantId) &&
            participant.id === nextChargeResponsibleParticipantId;
          return {
            id: previous?.id || `asg-${participant.id}`,
            participantId: participant.id,
            isChargeable,
            assignedAmount: isChargeable ? totalAmount : 0,
            participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
          } satisfies PaymentAssignment;
        });
      } else {
        nextChargeResponsibleParticipantId = undefined;
        nextAssignments = buildSharedAssignments(mergedParticipants, totalAmount, previousAssignments);
      }

      const nextDraft: BookingDrawerDraft = {
        ...state.draft,
        participants: mergedParticipants,
        operational: {
          ...state.draft.operational,
          bookingResponsibleParticipantId: fallbackResponsible,
        },
        billing: {
          ...state.draft.billing,
          chargeMode: nextChargeMode,
          chargeResponsibleParticipantId: nextChargeResponsibleParticipantId,
          assignments: nextAssignments,
          financialSummary: {
            ...state.draft.billing.financialSummary,
            totalAmount,
          },
        },
      };

      if (!hasSyncFormDiff(state.draft, nextDraft)) return state;
      const nextBillingDirty = hasSyncFormDiff(state.source, nextDraft);

      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: nextBillingDirty,
            },
          },
        },
        nextDraft
      );
    }

    case 'UPDATE_OPERATIONAL':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              operational: true,
            },
          },
        },
        {
          ...state.draft,
          operational: {
            ...state.draft.operational,
            ...event.payload,
          },
        }
      );

    case 'ADD_PARTICIPANT':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        {
          ...state.draft,
          participants: [...state.draft.participants, event.payload],
        }
      );

    case 'UPDATE_PARTICIPANT':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        {
          ...state.draft,
          participants: state.draft.participants.map((participant) =>
            participant.id === event.payload.participantId
              ? { ...participant, ...event.payload.patch }
              : participant
          ),
        }
      );

    case 'REMOVE_PARTICIPANT':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        removeParticipantSafely(state.draft, event.payload.participantId, event.payload.archivedAt)
      );

    case 'SET_CHARGE_MODE': {
      if (!state.draft) return state;
      const next = { ...state.draft };
      next.billing = { ...next.billing, chargeMode: event.payload.mode };

      if (event.payload.mode === 'INDIVIDUAL') {
        const activeParticipants = next.participants.filter((participant) => !participant.archived);
        const fallbackResponsibleParticipantId =
          event.payload.chargeResponsibleParticipantId ||
          next.billing.chargeResponsibleParticipantId ||
          next.operational.bookingResponsibleParticipantId ||
          activeParticipants.find((participant) => participant.bookingRole === 'BOOKING_RESPONSIBLE')?.id ||
          activeParticipants[0]?.id;

        next.billing.chargeResponsibleParticipantId = fallbackResponsibleParticipantId;
        next.billing.assignments = next.billing.assignments.map((assignment) => ({
          ...assignment,
          isChargeable: assignment.participantId === fallbackResponsibleParticipantId,
          assignedAmount:
            assignment.participantId === fallbackResponsibleParticipantId
              ? next.billing.financialSummary.totalAmount
              : 0,
        }));
      } else {
        next.billing.chargeResponsibleParticipantId = undefined;
        next.billing.assignments = buildSharedAssignments(
          next.participants,
          next.billing.financialSummary.totalAmount,
          next.billing.assignments
        );
      }

      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        next
      );
    }

    case 'SET_CHARGE_RESPONSIBLE':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        {
          ...state.draft,
          billing: {
            ...state.draft.billing,
            chargeResponsibleParticipantId: event.payload.participantId,
            assignments: state.draft.billing.assignments.map((assignment) => ({
              ...assignment,
              isChargeable: assignment.participantId === event.payload.participantId,
              assignedAmount:
                assignment.participantId === event.payload.participantId
                  ? state.draft.billing.financialSummary.totalAmount
                  : 0,
            })),
          },
        }
      );

    case 'SET_ASSIGNMENT_AMOUNT':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        {
          ...state.draft,
          billing: {
            ...state.draft.billing,
            assignments: state.draft.billing.assignments.map((assignment) =>
              assignment.id === event.payload.assignmentId
                ? { ...assignment, assignedAmount: Math.max(0, Number(event.payload.amount || 0)) }
                : assignment
            ),
          },
        }
      );

    case 'TOGGLE_ASSIGNMENT_CHARGEABLE':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              billingConfig: true,
            },
          },
        },
        {
          ...state.draft,
          billing: {
            ...state.draft.billing,
            assignments: state.draft.billing.assignments.map((assignment) =>
              assignment.id === event.payload.assignmentId
                ? {
                    ...assignment,
                    isChargeable: event.payload.isChargeable,
                    assignedAmount: event.payload.isChargeable ? assignment.assignedAmount : 0,
                  }
                : assignment
            ),
          },
        }
      );

    case 'QUEUE_PAYMENT':
      if (!state.draft) return state;
      return withDerived(
        {
          ...state,
          ui: {
            ...state.ui,
            dirtyFlags: {
              ...state.ui.dirtyFlags,
              paymentsQueue: true,
            },
          },
        },
        {
          ...state.draft,
          billing: {
            ...state.draft.billing,
            pendingPaymentsQueue: [...state.draft.billing.pendingPaymentsQueue, event.payload],
          },
        }
      );

    case 'DEQUEUE_PAYMENT':
      if (!state.draft) return state;
      return withDerived(state, {
        ...state.draft,
        billing: {
          ...state.draft.billing,
          pendingPaymentsQueue: state.draft.billing.pendingPaymentsQueue.filter(
            (payment) => payment.clientTempId !== event.payload.clientTempId
          ),
        },
      });

    case 'REGISTER_PAYMENT_LOCAL':
      if (!state.draft) return state;
      return withDerived(state, {
        ...state.draft,
        billing: {
          ...state.draft.billing,
          payments: [...state.draft.billing.payments, event.payload],
        },
      });

    case 'SAVE_START':
      return {
        ...state,
        ui: {
          ...state.ui,
          saveStatus: 'SAVING',
          saveMessage: undefined,
          savePartial: undefined,
        },
      };

    case 'SAVE_SUCCESS': {
      const sourceDraft = event.payload || state.draft;
      if (!sourceDraft) {
        return {
          ...state,
          ui: {
            ...state.ui,
            saveStatus: 'SUCCESS',
            saveMessage: 'Guardado correctamente.',
            savePartial: undefined,
            dirtyFlags: {
              operational: false,
              billingConfig: false,
              paymentsQueue: false,
            },
          },
        };
      }
      const draft = recomputeFinancialSummaryOnly(sourceDraft);
      return {
        source: draft,
        draft,
        ui: {
          ...state.ui,
          saveStatus: 'SUCCESS',
          saveMessage: 'Guardado correctamente.',
          savePartial: undefined,
          warnings: computeWarnings(draft),
          dirtyFlags: {
            operational: false,
            billingConfig: false,
            paymentsQueue: false,
          },
        },
      };
    }

    case 'SAVE_PARTIAL':
      return {
        ...state,
        ui: {
          ...state.ui,
          saveStatus: 'PARTIAL',
          saveMessage: event.payload.message,
          savePartial: {
            operationalSaved: event.payload.operationalSaved,
            billingSaved: event.payload.billingSaved,
            failedPaymentTempIds: event.payload.failedPaymentTempIds,
          },
        },
      };

    case 'SAVE_FAILED':
      return {
        ...state,
        ui: {
          ...state.ui,
          saveStatus: 'FAILED',
          saveMessage: event.payload.message,
        },
      };

    case 'RESET_TO_SOURCE':
      if (!state.source) return state;
      return {
        ...state,
        draft: state.source,
        ui: {
          ...state.ui,
          dirtyFlags: {
            operational: false,
            billingConfig: false,
            paymentsQueue: false,
          },
          warnings: computeWarnings(state.source),
        },
      };

    default:
      return state;
  }
}
