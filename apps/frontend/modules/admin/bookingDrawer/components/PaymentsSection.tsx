import { useEffect, useMemo, useState } from 'react';
import type {
  BookingParticipant,
  BookingPayment,
  ChargeMode,
  PaymentAssignment,
  PaymentMethod,
} from '../types';

type QueueItem = {
  clientTempId: string;
  amount: number;
  method: PaymentMethod;
  assignmentId?: string;
  note?: string;
};

type Props = {
  payments: BookingPayment[];
  assignments: PaymentAssignment[];
  participants: BookingParticipant[];
  chargeMode: ChargeMode;
  pendingQueue: QueueItem[];
  remainingAmount?: number;
  paymentsLocked?: boolean;
  paymentsLockedReason?: string;
  onQueuePayment?: (input: Omit<QueueItem, 'clientTempId'>) => void;
  onRemoveQueuedPayment?: (clientTempId: string) => void;
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'OTHER', label: 'Otro' },
];

const UNASSIGNED_KEY = '__UNASSIGNED__';

function getDefaultAssignmentKey(
  options: Array<{ id: string; label: string; chargeable: boolean }>
) {
  return options[0]?.id || UNASSIGNED_KEY;
}

function formatPaymentMethod(method: PaymentMethod) {
  switch (method) {
    case 'CASH':
      return 'Efectivo';
    case 'TRANSFER':
      return 'Transferencia';
    case 'CARD':
      return 'Tarjeta';
    default:
      return 'Otro';
  }
}

function formatPaymentLifecycleStatus(status: BookingPayment['status']) {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmado';
    case 'PENDING':
      return 'Pendiente';
    case 'VOIDED':
      return 'Anulado';
    case 'REFUNDED':
      return 'Reintegrado';
    default:
      return 'Registrado';
  }
}

function getParticipantPaymentLabel(participant?: BookingParticipant | null) {
  if (!participant) return 'Participante archivado';
  const name = String(participant.displayName || '').trim();
  if (name.length > 0) return name;
  if (participant.bookingRole === 'BOOKING_RESPONSIBLE') {
    return 'Responsable de la reserva (pendiente de nombre)';
  }
  return 'Participante pendiente de nombre';
}

export default function PaymentsSection({
  payments,
  assignments,
  participants,
  chargeMode,
  pendingQueue,
  remainingAmount = 0,
  paymentsLocked = false,
  paymentsLockedReason,
  onQueuePayment,
  onRemoveQueuedPayment,
}: Props) {
  const [methodDraft, setMethodDraft] = useState<PaymentMethod>('CASH');
  const [assignmentDraft, setAssignmentDraft] = useState<string>(UNASSIGNED_KEY);
  const [noteDraft, setNoteDraft] = useState<string>('');

  const assignmentOptions = useMemo(
    () =>
      assignments.map((assignment) => {
        const participant = participants.find((entry) => entry.id === assignment.participantId);
        return {
          id: assignment.id,
          label: getParticipantPaymentLabel(participant),
          chargeable: assignment.isChargeable,
          assignedAmount: Number(assignment.assignedAmount || 0),
        };
      }),
    [assignments, participants]
  );

  const chargeableAssignmentOptions = useMemo(
    () => assignmentOptions.filter((item) => item.chargeable),
    [assignmentOptions]
  );

  const hasNonChargeableAssignments = useMemo(
    () => assignmentOptions.some((item) => !item.chargeable),
    [assignmentOptions]
  );

  useEffect(() => {
    const firstChargeableId = getDefaultAssignmentKey(chargeableAssignmentOptions);
    setAssignmentDraft((previous) => {
      if (
        previous !== UNASSIGNED_KEY &&
        chargeableAssignmentOptions.some((assignment) => assignment.id === previous)
      ) {
        return previous;
      }
      return firstChargeableId;
    });
  }, [chargeableAssignmentOptions]);

  const queuedAmount = useMemo(
    () =>
      Number(
        pendingQueue
          .reduce((accumulator, item) => accumulator + Number(item.amount || 0), 0)
          .toFixed(2)
      ),
    [pendingQueue]
  );

  const remainingAfterQueue = Number(
    Math.max(0, Number(remainingAmount || 0) - queuedAmount).toFixed(2)
  );

  const selectedAssignmentId = assignmentDraft === UNASSIGNED_KEY ? undefined : assignmentDraft;

  const assignmentRemainingById = useMemo(() => {
    const map = new Map<string, number>();
    for (const option of assignmentOptions) {
      if (!option.chargeable) {
        map.set(option.id, 0);
        continue;
      }

      const confirmed = payments
        .filter((payment) => payment.status === 'CONFIRMED' && payment.assignmentId === option.id)
        .reduce((accumulator, payment) => accumulator + Number(payment.amount || 0), 0);

      const queued = pendingQueue
        .filter((payment) => payment.assignmentId === option.id)
        .reduce((accumulator, payment) => accumulator + Number(payment.amount || 0), 0);

      map.set(option.id, Number(Math.max(0, option.assignedAmount - confirmed - queued).toFixed(2)));
    }
    return map;
  }, [assignmentOptions, payments, pendingQueue]);

  const payableAmount = Number(
    (
      selectedAssignmentId
        ? assignmentRemainingById.get(selectedAssignmentId) || 0
        : remainingAfterQueue
    ).toFixed(2)
  );

  const amountIsValid = payableAmount > 0.009;
  const isIndividualMode = chargeMode === 'INDIVIDUAL';

  const selectedAssignmentLabel = selectedAssignmentId
    ? assignmentOptions.find((assignment) => assignment.id === selectedAssignmentId)?.label || null
    : null;

  const orderedPayments = useMemo(
    () =>
      [...payments].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ),
    [payments]
  );

  return (
    <div className="mt-3 rounded-xl border border-p-border bg-p-surface p-3">
      <p className="text-[13px] font-semibold text-p-text">Registrar pago</p>
      <p className="mt-0.5 text-[11px] text-p-text-muted">
        Saldo pendiente actual: <strong>{Number(remainingAmount || 0).toFixed(2)} $</strong>
      </p>
      <p className="mt-1 text-[11px] text-p-text-muted">
        {isIndividualMode
          ? 'En modo Individual solo se permite cobrar el saldo completo.'
          : 'En modo Compartida solo se permite cobrar la parte completa o el saldo total.'}
      </p>

      {paymentsLocked && (
        <div className="mt-2 rounded-lg border border-p-warning bg-p-warning-bg px-2.5 py-2 text-[11px] text-p-warning">
          {paymentsLockedReason || 'Los pagos estan bloqueados para esta reserva.'}
        </div>
      )}

      <div className="mt-3 grid grid-cols-[1fr_150px] gap-2">
        <label className="block">
          <span className="text-[11px] text-p-text-muted">Imputacion</span>
          <select
            value={assignmentDraft}
            onChange={(event) => setAssignmentDraft(event.target.value)}
            disabled={paymentsLocked}
            className="mt-1 h-9 w-full rounded-lg border border-p-border bg-p-surface px-2 text-[12px]"
          >
            <option value={UNASSIGNED_KEY}>Saldo total (sin imputar)</option>
            {assignmentOptions.map((assignment) => (
              <option
                key={`assignment-option-${assignment.id}`}
                value={assignment.id}
                disabled={!assignment.chargeable}
              >
                {assignment.chargeable ? assignment.label : `${assignment.label} (sin cobro)`}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] text-p-text-muted">Metodo</span>
          <select
            value={methodDraft}
            onChange={(event) => setMethodDraft(event.target.value as PaymentMethod)}
            disabled={paymentsLocked}
            className="mt-1 h-9 w-full rounded-lg border border-p-border bg-p-surface px-2 text-[12px]"
          >
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <option key={`payment-method-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 rounded-lg border border-p-border bg-p-surface-2 px-2.5 py-2">
        <p className="text-[11px] text-p-text-muted">Monto a registrar</p>
        <p className="text-[14px] font-semibold text-p-text">{payableAmount.toFixed(2)} $</p>
        <p className="mt-0.5 text-[11px] text-p-text-muted">
          {selectedAssignmentLabel
            ? `Se cobrara la parte completa de ${selectedAssignmentLabel}.`
            : 'Se cobrara el saldo total pendiente de la reserva.'}
        </p>
      </div>

      <label className="mt-2 block">
        <span className="text-[11px] text-p-text-muted">Nota (opcional)</span>
        <input
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Opcional"
          disabled={paymentsLocked}
          className="mt-1 h-9 w-full rounded-lg border border-p-border bg-p-surface px-2 text-[12px]"
        />
      </label>

      {chargeableAssignmentOptions.length > 0 && (
        <p className="mt-1 text-[11px] text-p-text-muted">
          Si no elegis manualmente, se usa la imputacion sugerida.
        </p>
      )}

      {hasNonChargeableAssignments && (
        <p className="mt-1 text-[11px] text-p-warning">
          Los participantes marcados como "sin cobro" no se pueden imputar hasta activarlos en Asignación.
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!amountIsValid || paymentsLocked}
          onClick={() => {
            if (!amountIsValid) return;
            onQueuePayment?.({
              amount: payableAmount,
              method: methodDraft,
              assignmentId: selectedAssignmentId,
              note: noteDraft.trim().length > 0 ? noteDraft.trim() : undefined,
            });
            setAssignmentDraft(getDefaultAssignmentKey(chargeableAssignmentOptions));
            setNoteDraft('');
          }}
          className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 disabled:opacity-45"
        >
          {selectedAssignmentId ? 'Marcar como pagado' : 'Cobrar saldo total'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-[12px] font-semibold text-p-text">Pagos pendientes de guardar</p>
        {pendingQueue.length === 0 && (
          <p className="rounded-lg border border-dashed border-p-border bg-p-surface-2 px-2.5 py-2 text-[11px] text-p-text-muted">
            No hay pagos en cola.
          </p>
        )}
        {pendingQueue.map((item) => {
          const assignment = assignments.find((entry) => entry.id === item.assignmentId);
          const participant = assignment
            ? participants.find((entry) => entry.id === assignment.participantId)
            : null;
          return (
            <div
              key={item.clientTempId}
              className="rounded-lg border border-p-warning bg-p-warning-bg px-2.5 py-2 text-[12px]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-p-warning">{item.amount.toFixed(2)} $</p>
                <button
                  type="button"
                  onClick={() => onRemoveQueuedPayment?.(item.clientTempId)}
                  className="text-[11px] font-semibold text-p-warning hover:underline"
                >
                  Quitar
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-p-warning">
                {formatPaymentMethod(item.method)} - {participant ? getParticipantPaymentLabel(participant) : 'Sin imputar'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-[12px] font-semibold text-p-text">Pagos registrados</p>
        {orderedPayments.length === 0 && (
          <p className="rounded-lg border border-dashed border-p-border bg-p-surface-2 px-2.5 py-2 text-[11px] text-p-text-muted">
            Aun no hay pagos registrados.
          </p>
        )}
        {orderedPayments.map((payment) => {
          const assignment = assignments.find((entry) => entry.id === payment.assignmentId);
          const participant = assignment
            ? participants.find((entry) => entry.id === assignment.participantId)
            : null;
          return (
            <div key={payment.id} className="rounded-lg border border-p-border px-2.5 py-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-p-text">{payment.amount.toFixed(2)} $</span>
                <span className="text-p-text-muted">{formatPaymentMethod(payment.method)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-p-text-muted">
                {participant ? getParticipantPaymentLabel(participant) : 'Sin imputar'} - {formatPaymentLifecycleStatus(payment.status)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
