import type { BookingParticipant, ChargeMode, PaymentAssignment } from '../types';

type Props = {
  mode: ChargeMode;
  participants: BookingParticipant[];
  assignments: PaymentAssignment[];
  totalAmount: number;
  chargeResponsibleParticipantId?: string;
  onModeChange?: (mode: ChargeMode) => void;
  onResponsibleChange?: (participantId: string) => void;
  onAssignmentAmountChange?: (assignmentId: string, amount: number) => void;
  onToggleChargeable?: (assignmentId: string, isChargeable: boolean) => void;
};

export default function ChargeAssignmentSection({
  mode,
  participants,
  assignments,
  totalAmount,
  chargeResponsibleParticipantId,
  onModeChange,
  onResponsibleChange,
  onAssignmentAmountChange,
  onToggleChargeable,
}: Props) {
  const participantLabel = (participant: BookingParticipant, index: number) => {
    const name = String(participant.displayName || '').trim();
    if (name.length > 0) return name;
    if (participant.bookingRole === 'BOOKING_RESPONSIBLE') {
      return 'Responsable de la reserva (pendiente de nombre)';
    }
    return `Participante ${index + 1} (pendiente de nombre)`;
  };

  const activeParticipants = participants.filter((participant) => !participant.archived);
  const assignmentByParticipantId = new Map(assignments.map((assignment) => [assignment.participantId, assignment]));
  const assignedTotal = assignments.reduce(
    (accumulator, assignment) => accumulator + (assignment.isChargeable ? Number(assignment.assignedAmount || 0) : 0),
    0
  );
  const remainingToAssign = Number(totalAmount || 0) - Number(assignedTotal || 0);

  return (
    <div className="mt-3 rounded-xl border border-p-border bg-p-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-p-text">Asignación de cobro</p>
          <p className="mt-0.5 text-[11px] text-p-text-muted">
            Defini quien asume el cobro de esta reserva.
          </p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-p-border bg-p-surface-2 p-1">
          <button
            type="button"
            onClick={() => onModeChange?.('INDIVIDUAL')}
            className={`h-7 rounded-md px-2 text-[11px] font-semibold ${
              mode === 'INDIVIDUAL'
                ? 'bg-p-surface text-p-accent border border-p-accent'
                : 'text-p-text-secondary'
            }`}
          >
            Individual
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.('SHARED')}
            className={`h-7 rounded-md px-2 text-[11px] font-semibold ${
              mode === 'SHARED'
                ? 'bg-p-surface text-p-accent border border-p-accent'
                : 'text-p-text-secondary'
            }`}
          >
            Compartida
          </button>
        </div>
      </div>

      {mode === 'INDIVIDUAL' ? (
        <div className="mt-3 space-y-2">
          {activeParticipants.map((participant, index) => {
            const isResponsible = participant.id === chargeResponsibleParticipantId;
            return (
              <button
                key={participant.id}
                type="button"
                onClick={() => onResponsibleChange?.(participant.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  isResponsible
                    ? 'border-p-accent bg-p-positive-bg'
                    : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold text-p-text">
                    {participantLabel(participant, index)}
                  </span>
                  {isResponsible && (
                    <span className="rounded-full bg-p-surface px-2 py-0.5 text-[10px] font-semibold text-p-accent">
                      Responsable
                    </span>
                  )}
                </div>
                {isResponsible && (
                  <p className="mt-1 text-[11px] text-p-accent">
                    Asume el total: {Number(totalAmount || 0).toFixed(2)} $
                  </p>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-2 rounded-lg border border-p-border bg-p-surface-2 px-2.5 py-2 text-[11px] text-p-text-secondary">
            <div className="flex items-center justify-between">
              <span>Total asignado</span>
              <strong className="text-p-text">{assignedTotal.toFixed(2)} $</strong>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>Saldo por asignar</span>
              <strong className={remainingToAssign > 0.009 || remainingToAssign < -0.009 ? 'text-[var(--error-fg)]' : 'text-p-positive'}>
                {remainingToAssign.toFixed(2)} $
              </strong>
            </div>
          </div>

          <div className="space-y-2">
            {activeParticipants.map((participant, index) => {
              const assignment = assignmentByParticipantId.get(participant.id);
              if (!assignment) return null;
              return (
                <div key={assignment.id} className="rounded-lg border border-p-border px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-p-text">
                      {participantLabel(participant, index)}
                    </span>
                    <label className="inline-flex items-center gap-1 text-[11px] text-p-text-muted">
                      <input
                        type="checkbox"
                        checked={assignment.isChargeable}
                        onChange={(event) => onToggleChargeable?.(assignment.id, event.target.checked)}
                      />
                      Cobra
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={Number(assignment.assignedAmount || 0)}
                      disabled={!assignment.isChargeable}
                      onChange={(event) =>
                        onAssignmentAmountChange?.(assignment.id, Number(event.target.value || 0))
                      }
                      className="h-9 w-full rounded-lg border border-p-border px-2 text-[12px] disabled:bg-p-surface-2 disabled:text-p-text-muted"
                    />
                    <span className="text-[12px] text-p-text-muted">$</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
