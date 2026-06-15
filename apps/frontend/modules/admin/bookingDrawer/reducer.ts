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

function cloneBookingDrawerDraft(draft: BookingDrawerDraft): BookingDrawerDraft {
  return {
    operational: {
      ...draft.operational,
    },
    participants: draft.participants.map((participant) => ({
      ...participant,
    })),
    billing: {
      ...draft.billing,
      assignments: draft.billing.assignments.map((assignment) => ({
        ...assignment,
      })),
      payments: draft.billing.payments.map((payment) => ({
        ...payment,
      })),
      pendingPaymentsQueue: draft.billing.pendingPaymentsQueue.map((payment) => ({
        ...payment,
      })),
      financialSummary: {
        ...draft.billing.financialSummary,
      },
    },
  };
}

function normalizeComparableParticipantId(participant: BookingParticipant): string {
  if (participant.bookingRole === 'BOOKING_RESPONSIBLE') return 'owner';
  return String(participant.id || '').trim();
}

function buildSyncComparableSnapshot(draft: BookingDrawerDraft | null) {
  if (!draft) return null;

  const comparableParticipantIdByOriginalId = new Map<string, string>();
  const participants = [...draft.participants]
    .map((participant) => ({
      id: normalizeComparableParticipantId(participant),
      displayName: String(participant.displayName || ''),
      contact: String(participant.contact || ''),
      bookingRole: participant.bookingRole,
      archived: Boolean(participant.archived),
      archivedAt: String(participant.archivedAt || ''),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  draft.participants.forEach((participant) => {
    const originalId = String(participant.id || '').trim();
    if (!originalId) return;
    comparableParticipantIdByOriginalId.set(
      originalId,
      normalizeComparableParticipantId(participant)
    );
  });

  const assignmentByComparableParticipantId = new Map<string, PaymentAssignment>();
  draft.billing.assignments.forEach((assignment) => {
    const originalParticipantId = String(assignment.participantId || '').trim();
    if (!originalParticipantId) return;
    const comparableParticipantId =
      comparableParticipantIdByOriginalId.get(originalParticipantId) ||
      originalParticipantId;
    if (!comparableParticipantId || assignmentByComparableParticipantId.has(comparableParticipantId)) return;
    assignmentByComparableParticipantId.set(comparableParticipantId, assignment);
  });
  const assignments = participants
    .map((participant) => {
      const assignment = assignmentByComparableParticipantId.get(participant.id);
      const participantArchived = Boolean(participant.archived);
      const isChargeable = participantArchived
        ? false
        : Boolean(assignment?.isChargeable);
      return {
        participantId: participant.id,
        isChargeable,
        assignedAmount: isChargeable ? roundMoney(Number(assignment?.assignedAmount || 0)) : 0,
        participantLinkState: participantArchived
          ? 'ARCHIVED_REFERENCE'
          : (
              assignment?.participantLinkState === 'ARCHIVED_REFERENCE'
                ? 'ARCHIVED_REFERENCE'
                : 'ACTIVE'
            ),
      } as const;
    })
    .sort((left, right) => left.participantId.localeCompare(right.participantId));

  const comparableBookingResponsibleParticipantId =
    draft.participants.find(
      (participant) =>
        String(participant.id || '').trim() ===
        String(draft.operational.bookingResponsibleParticipantId || '').trim()
    )?.bookingRole === 'BOOKING_RESPONSIBLE'
      ? 'owner'
      : String(draft.operational.bookingResponsibleParticipantId || '');

  return {
    bookingResponsibleParticipantId: comparableBookingResponsibleParticipantId,
    participants,
    billing: {
      chargeMode: draft.billing.chargeMode,
      chargeResponsibleParticipantId:
        draft.billing.chargeMode === 'INDIVIDUAL'
          ? (() => {
              const rawResponsible = String(draft.billing.chargeResponsibleParticipantId || '').trim();
              if (!rawResponsible) return '';
              return (
                comparableParticipantIdByOriginalId.get(rawResponsible) ||
                rawResponsible
              );
            })()
          : '',
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

function resolveBillingDirtyFromSource(state: BookingDrawerState, candidate: BookingDrawerDraft): boolean {
  return hasSyncFormDiff(state.source, candidate);
}

function normalizeRestoreText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function participantRestoreKey(participant: BookingParticipant): string {
  return [
    participant.bookingRole === 'BOOKING_RESPONSIBLE' ? 'OWNER' : 'PARTICIPANT',
    normalizeRestoreText(participant.displayName),
    normalizeRestoreText(participant.contact),
    participant.archived ? 'ARCHIVED' : 'ACTIVE',
  ].join('|');
}

function resolveSourceToCurrentParticipantMap(
  source: BookingDrawerDraft,
  current: BookingDrawerDraft
): Map<string, string> | null {
  if (source.participants.length !== current.participants.length) return null;

  const buildBuckets = (participants: BookingParticipant[]) => {
    const buckets = new Map<string, string[]>();
    participants.forEach((participant) => {
      const key = participantRestoreKey(participant);
      const ids = buckets.get(key) || [];
      ids.push(String(participant.id || ''));
      buckets.set(key, ids);
    });
    buckets.forEach((ids, key) => {
      buckets.set(
        key,
        [...ids].sort((left, right) => left.localeCompare(right))
      );
    });
    return buckets;
  };

  const sourceBuckets = buildBuckets(source.participants);
  const currentBuckets = buildBuckets(current.participants);
  if (sourceBuckets.size !== currentBuckets.size) return null;

  for (const [key, sourceIds] of sourceBuckets.entries()) {
    const currentIds = currentBuckets.get(key);
    if (!currentIds) return null;
    if (currentIds.length !== sourceIds.length) return null;
  }

  const sourceToCurrent = new Map<string, string>();
  for (const [key, sourceIds] of sourceBuckets.entries()) {
    const currentIds = currentBuckets.get(key) || [];
    sourceIds.forEach((sourceId, index) => {
      const currentId = String(currentIds[index] || '');
      if (!sourceId || !currentId) return;
      sourceToCurrent.set(sourceId, currentId);
    });
  }

  if (sourceToCurrent.size !== source.participants.length) return null;
  return sourceToCurrent;
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
      const normalizedDraft = recomputeFinancialSummaryOnly(event.payload);
      const source = cloneBookingDrawerDraft(normalizedDraft);
      const draft = cloneBookingDrawerDraft(normalizedDraft);
      return {
        source,
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
      {
        const nextDraft: BookingDrawerDraft = {
          ...state.draft,
          participants: [...state.draft.participants, event.payload],
        };
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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

    case 'UPDATE_PARTICIPANT':
      if (!state.draft) return state;
      {
        const nextDraft: BookingDrawerDraft = {
          ...state.draft,
          participants: state.draft.participants.map((participant) =>
            participant.id === event.payload.participantId
              ? { ...participant, ...event.payload.patch }
              : participant
          ),
        };
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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

    case 'REMOVE_PARTICIPANT':
      if (!state.draft) return state;
      {
        const nextDraft = removeParticipantSafely(state.draft, event.payload.participantId, event.payload.archivedAt);
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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

    case 'SET_CHARGE_MODE': {
      if (!state.draft) return state;
      const next = { ...state.draft };
      next.billing = { ...next.billing, chargeMode: event.payload.mode };
      const source = state.source;
      const sourceToCurrentParticipantMap = source
        ? resolveSourceToCurrentParticipantMap(source, next)
        : null;
      const canRestoreModeFromSource = (mode: ChargeMode): boolean => {
        if (!source) return false;
        if (source.billing.chargeMode !== mode) return false;
        if (!sourceToCurrentParticipantMap) return false;
        if (
          roundMoney(Number(source.billing.financialSummary.totalAmount || 0)) !==
          roundMoney(Number(next.billing.financialSummary.totalAmount || 0))
        ) {
          return false;
        }
        return true;
      };

      if (event.payload.mode === 'INDIVIDUAL') {
        const activeParticipants = next.participants.filter((participant) => !participant.archived);
        if (canRestoreModeFromSource('INDIVIDUAL') && source && sourceToCurrentParticipantMap) {
          const sourceAssignmentsByCurrentParticipantId = new Map<string, PaymentAssignment>();
          source.billing.assignments.forEach((assignment) => {
            const sourceParticipantId = String(assignment.participantId || '');
            const currentParticipantId = sourceToCurrentParticipantMap.get(sourceParticipantId);
            if (!currentParticipantId) return;
            if (sourceAssignmentsByCurrentParticipantId.has(currentParticipantId)) return;
            sourceAssignmentsByCurrentParticipantId.set(currentParticipantId, {
              ...assignment,
              participantId: currentParticipantId,
            });
          });
          const activeParticipantIds = new Set(activeParticipants.map((participant) => participant.id));
          const sourceResponsible = sourceToCurrentParticipantMap.get(
            String(source.billing.chargeResponsibleParticipantId || '')
          ) || '';
          const fallbackResponsibleParticipantId =
            event.payload.chargeResponsibleParticipantId ||
            (sourceResponsible && activeParticipantIds.has(sourceResponsible) ? sourceResponsible : '') ||
            next.billing.chargeResponsibleParticipantId ||
            next.operational.bookingResponsibleParticipantId ||
            activeParticipants.find((participant) => participant.bookingRole === 'BOOKING_RESPONSIBLE')?.id ||
            activeParticipants[0]?.id;

          next.billing.chargeResponsibleParticipantId = fallbackResponsibleParticipantId;
          next.billing.assignments = next.participants.map((participant) => {
            const sourceAssignment = sourceAssignmentsByCurrentParticipantId.get(participant.id);
            const isChargeable =
              !participant.archived &&
              Boolean(fallbackResponsibleParticipantId) &&
              participant.id === fallbackResponsibleParticipantId;
            return {
              id: sourceAssignment?.id || `asg-${participant.id}`,
              participantId: participant.id,
              isChargeable,
              assignedAmount: isChargeable
                ? roundMoney(
                    Number(
                      sourceAssignment?.assignedAmount ||
                      next.billing.financialSummary.totalAmount
                    )
                  )
                : 0,
              participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
            } satisfies PaymentAssignment;
          });
        } else {
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
        }
      } else {
        next.billing.chargeResponsibleParticipantId = undefined;
        if (canRestoreModeFromSource('SHARED') && source && sourceToCurrentParticipantMap) {
          const sourceAssignmentByCurrentParticipantId = new Map<string, PaymentAssignment>();
          source.billing.assignments.forEach((assignment) => {
            const sourceParticipantId = String(assignment.participantId || '');
            const currentParticipantId = sourceToCurrentParticipantMap.get(sourceParticipantId);
            if (!currentParticipantId) return;
            if (sourceAssignmentByCurrentParticipantId.has(currentParticipantId)) return;
            sourceAssignmentByCurrentParticipantId.set(currentParticipantId, {
              ...assignment,
              participantId: currentParticipantId,
            });
          });
          next.billing.assignments = next.participants.map((participant) => {
            const sourceAssignment = sourceAssignmentByCurrentParticipantId.get(participant.id);
            if (!sourceAssignment) {
              return {
                id: `asg-${participant.id}`,
                participantId: participant.id,
                isChargeable: false,
                assignedAmount: 0,
                participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
              } satisfies PaymentAssignment;
            }
            return {
              ...sourceAssignment,
              participantId: participant.id,
              isChargeable: participant.archived ? false : Boolean(sourceAssignment.isChargeable),
              assignedAmount: participant.archived ? 0 : roundMoney(Number(sourceAssignment.assignedAmount || 0)),
              participantLinkState: participant.archived ? 'ARCHIVED_REFERENCE' : 'ACTIVE',
            } satisfies PaymentAssignment;
          });
        } else {
          next.billing.assignments = buildSharedAssignments(
            next.participants,
            next.billing.financialSummary.totalAmount,
            next.billing.assignments
          );
        }
      }

      {
        const nextBillingDirty = resolveBillingDirtyFromSource(state, next);
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
          next
        );
      }
    }

    case 'SET_CHARGE_RESPONSIBLE':
      if (!state.draft) return state;
      {
        const nextDraft: BookingDrawerDraft = {
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
        };
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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

    case 'SET_ASSIGNMENT_AMOUNT':
      if (!state.draft) return state;
      {
        const nextDraft: BookingDrawerDraft = {
          ...state.draft,
          billing: {
            ...state.draft.billing,
            assignments: state.draft.billing.assignments.map((assignment) =>
              assignment.id === event.payload.assignmentId
                ? { ...assignment, assignedAmount: Math.max(0, Number(event.payload.amount || 0)) }
                : assignment
            ),
          },
        };
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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

    case 'TOGGLE_ASSIGNMENT_CHARGEABLE':
      if (!state.draft) return state;
      {
        const nextDraft: BookingDrawerDraft = {
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
        };
        const nextBillingDirty = resolveBillingDirtyFromSource(state, nextDraft);
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
      const normalizedDraft = recomputeFinancialSummaryOnly(sourceDraft);
      const source = cloneBookingDrawerDraft(normalizedDraft);
      const draft = cloneBookingDrawerDraft(normalizedDraft);
      return {
        source,
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
        draft: cloneBookingDrawerDraft(state.source),
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
