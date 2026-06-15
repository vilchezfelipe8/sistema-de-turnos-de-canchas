import type { BookingParticipant } from '../types';

type Props = {
  participants: BookingParticipant[];
  bookingResponsibleParticipantId?: string;
  chargeResponsibleParticipantId?: string;
  onSetBookingResponsible?: (participantId: string) => void;
  onAddParticipant?: () => void;
  onArchiveParticipant?: (participantId: string) => void;
};

export default function ParticipantsSection({
  participants,
  bookingResponsibleParticipantId,
  chargeResponsibleParticipantId,
  onSetBookingResponsible,
  onAddParticipant,
  onArchiveParticipant,
}: Props) {
  const active = participants.filter((participant) => !participant.archived);
  const archived = participants.filter((participant) => participant.archived);

  return (
    <div className="mt-3 rounded-xl border border-p-border bg-p-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-p-text">Participantes</p>
        <button
          type="button"
          onClick={onAddParticipant}
          className="text-[12px] font-semibold text-p-accent"
        >
          Agregar participante
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {active.map((participant) => (
          <div key={participant.id} className="rounded-lg border border-p-border px-2 py-2 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-p-text">{participant.displayName || 'Sin nombre'}</span>
              <div className="flex items-center gap-1">
                {bookingResponsibleParticipantId === participant.id && (
                  <span className="rounded-full bg-p-positive-bg px-2 py-0.5 text-[10px] text-p-accent">
                    Responsable de la reserva
                  </span>
                )}
                {chargeResponsibleParticipantId === participant.id && (
                  <span className="rounded-full bg-p-positive-bg px-2 py-0.5 text-[10px] text-p-positive">
                    Responsable del cobro
                  </span>
                )}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => onSetBookingResponsible?.(participant.id)}
                className="text-[11px] text-p-accent"
              >
                Definir responsable reserva
              </button>
              <button
                type="button"
                onClick={() => onArchiveParticipant?.(participant.id)}
                className="text-[11px] text-[var(--error-fg)]"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
      {archived.length > 0 && (
        <div className="mt-3 rounded-lg border border-p-border bg-p-surface-2 px-2 py-2 text-[11px] text-p-text-muted">
          <p className="font-semibold text-p-text-secondary">Participantes archivados (histórico)</p>
          {archived.map((participant) => (
            <p key={participant.id} className="mt-1">
              {participant.displayName || 'Sin nombre'} · Eliminado
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

