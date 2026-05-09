type BookingHoverParticipant = {
  id: string;
  name: string;
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
  const rows = participants;

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
      <div className="px-2 py-1.5">
        {rows.map((participant) => (
          <div key={participant.id} className="grid grid-cols-[16px_1fr] items-start gap-2 px-1 py-1.5">
            <div className="grid h-4 w-4 place-items-center rounded-full bg-p-surface-2 text-[9px] font-bold text-p-text-secondary">
              {participant.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold min-w-0">{participant.name}</p>
                {participant.payable !== false && participant.debtAmount > 0.009 && (
                  <span className="text-[10px] font-bold text-p-text-muted whitespace-nowrap">
                    {formatCompactAmount(Number(participant.debtAmount || 0))}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
