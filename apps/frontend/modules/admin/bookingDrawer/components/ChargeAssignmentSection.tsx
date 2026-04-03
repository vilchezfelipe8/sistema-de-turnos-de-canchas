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
    <div className="mt-3 rounded-xl border border-[#dce2ee] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-[#2f364b]">Asignacion de cobro</p>
          <p className="mt-0.5 text-[11px] text-[#6f7890]">
            Defini quien asume el cobro de esta reserva.
          </p>
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-[#dce2ee] bg-[#f8f9fc] p-1">
          <button
            type="button"
            onClick={() => onModeChange?.('INDIVIDUAL')}
            className={`h-7 rounded-md px-2 text-[11px] font-semibold ${
              mode === 'INDIVIDUAL'
                ? 'bg-white text-[#2e58e5] border border-[#d8dff0]'
                : 'text-[#5f6880]'
            }`}
          >
            Individual
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.('SHARED')}
            className={`h-7 rounded-md px-2 text-[11px] font-semibold ${
              mode === 'SHARED'
                ? 'bg-white text-[#2e58e5] border border-[#d8dff0]'
                : 'text-[#5f6880]'
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
                    ? 'border-[#cfd9f7] bg-[#eef2ff]'
                    : 'border-[#e3e8f2] bg-white hover:bg-[#f8faff]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold text-[#2f364b]">
                    {participantLabel(participant, index)}
                  </span>
                  {isResponsible && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#2f53df]">
                      Responsable
                    </span>
                  )}
                </div>
                {isResponsible && (
                  <p className="mt-1 text-[11px] text-[#4d5f98]">
                    Asume el total: {Number(totalAmount || 0).toFixed(2)} $
                  </p>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-2 rounded-lg border border-[#e3e8f2] bg-[#f8f9fd] px-2.5 py-2 text-[11px] text-[#5f6880]">
            <div className="flex items-center justify-between">
              <span>Total asignado</span>
              <strong className="text-[#2f364b]">{assignedTotal.toFixed(2)} $</strong>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>Saldo por asignar</span>
              <strong className={remainingToAssign > 0.009 || remainingToAssign < -0.009 ? 'text-[#b42346]' : 'text-[#1c7a44]'}>
                {remainingToAssign.toFixed(2)} $
              </strong>
            </div>
          </div>

          <div className="space-y-2">
            {activeParticipants.map((participant, index) => {
              const assignment = assignmentByParticipantId.get(participant.id);
              if (!assignment) return null;
              return (
                <div key={assignment.id} className="rounded-lg border border-[#e3e8f2] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-[#2f364b]">
                      {participantLabel(participant, index)}
                    </span>
                    <label className="inline-flex items-center gap-1 text-[11px] text-[#6f7890]">
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
                      className="h-9 w-full rounded-lg border border-[#dbe2ef] px-2 text-[12px] disabled:bg-[#f4f6fb] disabled:text-[#8a92a5]"
                    />
                    <span className="text-[12px] text-[#7b8396]">$</span>
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
