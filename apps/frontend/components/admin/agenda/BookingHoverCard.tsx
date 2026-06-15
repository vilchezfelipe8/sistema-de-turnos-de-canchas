type BookingHoverParticipant = {
  id: string;
  name: string;
  isOwner?: boolean;
  modeLabel: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  payable: boolean;
  payer: boolean;
  payerAmount: number;
  debtAmount: number;
};

type BookingHoverCardProps = {
  x: number;
  y: number;
  participants: BookingHoverParticipant[];
};

function paymentStateClass(state: 'UNPAID' | 'PARTIAL' | 'PAID') {
  if (state === 'PAID') return 'bg-lima-200/90 text-ink-900';
  if (state === 'PARTIAL') return 'bg-amber-300/90 text-ink-900';
  return 'bg-ink-300/90 text-ink-900';
}

function formatCompactAmount(amount: number): string {
  const safeAmount = Number(amount || 0);
  if (!Number.isFinite(safeAmount)) return '$0';
  if (safeAmount >= 1000) return `$${Math.round(safeAmount / 1000)}k`;
  return `$${Math.round(safeAmount)}`;
}

function initialsFromName(name: string): string {
  const tokens = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
  return `${tokens[0].slice(0, 1)}${tokens[tokens.length - 1].slice(0, 1)}`.toUpperCase();
}

function HoverPersonRow({
  name,
  amount,
}: {
  name: string;
  amount?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#262c42] text-[11px] font-bold text-p-text-muted">
          {initialsFromName(name)}
        </span>
        <p className="truncate text-[12px] font-semibold text-p-text min-w-0">{name}</p>
      </div>
      {Number.isFinite(amount) && Number(amount) > 0.009 && (
        <span className="text-[10px] font-bold text-p-text-muted whitespace-nowrap">
          {formatCompactAmount(Number(amount || 0))}
        </span>
      )}
    </div>
  );
}

function CompactStateIcon({ state }: { state: 'UNPAID' | 'PARTIAL' | 'PAID' }) {
  if (state === 'PAID') {
    return (
      <span className="grid h-3.5 w-3.5 place-items-center">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" className="shrink-0">
          <path
            d="M6.8 12.4l3.2 3.2 7.2-7.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === 'PARTIAL') {
    return (
      <span className="grid h-3.5 w-3.5 place-items-center">
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" className="shrink-0">
          <path d="M12 3.5A8.5 8.5 0 0 0 12 20.5Z" fill="currentColor" />
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 3.5V20.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-3.5 w-3.5 place-items-center">
      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" className="shrink-0">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}

export default function BookingHoverCard({ x, y, participants }: BookingHoverCardProps) {
  const ownerRow = participants.find((participant) => participant.isOwner) || participants[0] || null;
  const participantRows = participants.filter((participant) => !participant.isOwner);
  const visibleParticipantRows = participantRows.slice(0, 2);
  const hiddenParticipantsCount = Math.max(0, participantRows.length - visibleParticipantRows.length);

  const chargeableParticipants = participants.filter((participant) => participant.payable !== false);
  const totalDebt = Number(
    chargeableParticipants.reduce((sum, participant) => sum + Number(participant.debtAmount || 0), 0).toFixed(2)
  );
  const totalPaid = Number(
    participants.reduce((sum, participant) => sum + Number(participant.payerAmount || 0), 0).toFixed(2)
  );

  const globalState: 'UNPAID' | 'PARTIAL' | 'PAID' = (() => {
    if (chargeableParticipants.length === 0) return 'UNPAID';
    if (totalDebt <= 0.009) return 'PAID';
    const hasAnyPaidSignal =
      chargeableParticipants.some((participant) => participant.status === 'PARTIAL' || participant.status === 'PAID') ||
      totalPaid > 0.009;
    return hasAnyPaidSignal ? 'PARTIAL' : 'UNPAID';
  })();

  return (
    <div
      className="pointer-events-none fixed z-40 hidden w-[280px] rounded-xl border border-p-border bg-p-surface shadow-xl text-p-text lg:block"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-p-border px-3 py-2">
        <span className="text-[12px] font-bold">Reserva</span>
        <div className="flex items-center gap-1">
          <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-[1px] ${paymentStateClass(globalState)}`}>
            <CompactStateIcon state={globalState} />
          </span>
          {totalDebt > 0.009 && (
            <span className="inline-flex items-center justify-center rounded-full bg-black/15 px-2 pt-[2px] pb-[3px] text-[11px] font-extrabold leading-none">
              {formatCompactAmount(totalDebt)}
            </span>
          )}
        </div>
      </div>
      <div className="px-3 py-2">
        {ownerRow && (
          <div className="min-w-0">
            <HoverPersonRow
              name={ownerRow.name}
              amount={ownerRow.payable !== false ? Number(ownerRow.debtAmount || 0) : 0}
            />
          </div>
        )}
        {participantRows.length > 0 && (
          <div className="mt-2">
            <div className="space-y-1.5">
              {visibleParticipantRows.map((participant) => (
                <HoverPersonRow key={participant.id} name={participant.name} />
              ))}
              {hiddenParticipantsCount > 0 && (
                <p className="pl-9 text-[10px] font-medium text-p-text-muted">
                  +{hiddenParticipantsCount} más
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
