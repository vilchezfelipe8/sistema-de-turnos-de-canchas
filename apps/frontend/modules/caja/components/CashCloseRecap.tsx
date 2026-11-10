// Cierre de caja en palabras del mostrador: qué entró, qué salió, cuánto debería haber y qué se contó.

export type CashShiftBreakdown = {
  cashIn: number;
  cashOut: number;
  transfer: number;
  card: number;
  other: number;
};

export type CashClosedShift = {
  id: string;
  openedAt: string;
  closedAt?: string | null;
  openingAmount: number;
  expectedCash?: number | null;
  countedCash?: number | null;
  difference?: number | null;
  breakdown?: CashShiftBreakdown | null;
  cashRegister?: { name: string } | null;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

const formatDayTime = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} ${time}`;
};

const EPS = 0.009;

/** "Coincide", "Sobraron $500", "Faltaron $1.000". */
export const closeResultText = (difference: number): { text: string; ok: boolean } => {
  if (Math.abs(difference) <= EPS) return { text: 'Coincide', ok: true };
  return difference > 0
    ? { text: `Sobraron ${formatMoney(difference)}`, ok: false }
    : { text: `Faltaron ${formatMoney(Math.abs(difference))}`, ok: false };
};

function Line({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={muted ? 'text-p-text-muted' : 'text-p-text-secondary'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[15px] font-bold text-p-text' : 'font-semibold text-p-text'}`}>{value}</span>
    </div>
  );
}

/** Lo digital no se cuenta en el cajón: se muestra aparte, solo si hubo. */
function DigitalLines({ breakdown }: { breakdown: CashShiftBreakdown }) {
  const rows = [
    { label: 'Transferencias', value: breakdown.transfer },
    { label: 'Tarjetas', value: breakdown.card },
    { label: 'Otros medios', value: breakdown.other },
  ].filter((row) => Math.abs(row.value) > EPS);
  if (rows.length === 0) return <p className="text-[12px] text-p-text-muted">No hubo cobros digitales.</p>;
  return (
    <div className="text-[13px]">
      {rows.map((row) => (
        <Line key={row.label} label={row.label} value={formatMoney(row.value)} />
      ))}
    </div>
  );
}

/** Cuenta del efectivo: empezó con + entró − salió = debería haber. */
export function CashDrawerMath({
  openingAmount,
  breakdown,
  expectedCash,
}: {
  openingAmount: number;
  breakdown?: CashShiftBreakdown | null;
  expectedCash: number;
}) {
  return (
    <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[13px]">
      <Line label="Empezó con" value={formatMoney(openingAmount)} />
      {breakdown && (
        <>
          <Line label="Entró en efectivo" value={`+ ${formatMoney(breakdown.cashIn)}`} />
          <Line label="Salió en efectivo" value={`− ${formatMoney(breakdown.cashOut)}`} />
        </>
      )}
      <div className="mt-1 border-t border-p-border pt-1">
        <Line label="Debería haber en el cajón" value={formatMoney(expectedCash)} strong />
      </div>
    </div>
  );
}

/** Antes de contar: qué pasó en el turno. */
export function CashCloseRecap({
  openingAmount,
  breakdown,
  expectedCash,
  openedAt,
  registerName,
}: {
  openingAmount: number;
  breakdown?: CashShiftBreakdown | null;
  expectedCash: number;
  openedAt?: string | null;
  registerName?: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-p-text-muted">
        {registerName || 'Caja'} · abierta {formatDayTime(openedAt)}
      </p>
      <CashDrawerMath openingAmount={openingAmount} breakdown={breakdown} expectedCash={expectedCash} />
      {breakdown && (
        <div>
          <p className="text-[12px] font-semibold text-p-text-secondary">Cobrado sin efectivo (no se cuenta)</p>
          <DigitalLines breakdown={breakdown} />
        </div>
      )}
    </div>
  );
}

/** Comprobante de un cierre. */
export function CashClosedShiftCard({ shift }: { shift: CashClosedShift }) {
  const expected = Number(shift.expectedCash || 0);
  const counted = Number(shift.countedCash || 0);
  const difference = shift.difference == null ? counted - expected : Number(shift.difference);
  const result = closeResultText(difference);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[15px] font-bold text-p-text">Cerrada el {formatDayTime(shift.closedAt)}</p>
        <p className="text-[12px] text-p-text-muted">
          {shift.cashRegister?.name || 'Caja'} · abierta {formatDayTime(shift.openedAt)}
        </p>
      </div>
      <CashDrawerMath openingAmount={Number(shift.openingAmount || 0)} breakdown={shift.breakdown} expectedCash={expected} />
      <div className="rounded-xl border border-p-border px-3 py-2 text-[13px]">
        <Line label="Contaron" value={formatMoney(counted)} strong />
        <p
          className={`mt-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ${
            result.ok ? 'bg-p-positive-bg text-p-positive' : 'bg-p-warning-bg text-p-warning'
          }`}
        >
          {result.text}
        </p>
      </div>
      {shift.breakdown && (
        <div>
          <p className="text-[12px] font-semibold text-p-text-secondary">Cobrado sin efectivo</p>
          <DigitalLines breakdown={shift.breakdown} />
        </div>
      )}
    </div>
  );
}

/** Lista de cierres anteriores; tocar uno lo muestra arriba. */
export function CashClosesHistory({
  items,
  selectedId,
  onSelect,
}: {
  items: CashClosedShift[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return <p className="text-[13px] text-p-text-muted">Todavía no se cerró ninguna caja.</p>;
  return (
    <ul className="divide-y divide-p-border rounded-xl border border-p-border">
      {items.map((item) => {
        const expected = Number(item.expectedCash || 0);
        const counted = Number(item.countedCash || 0);
        const difference = item.difference == null ? counted - expected : Number(item.difference);
        const result = closeResultText(difference);
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] ${
                selected ? 'bg-p-surface-2' : 'hover:bg-p-surface-2'
              }`}
            >
              <span className="min-w-0">
                <span className="block font-semibold text-p-text">{formatDayTime(item.closedAt)}</span>
                <span className="block text-[12px] text-p-text-muted">Contaron {formatMoney(counted)}</span>
              </span>
              <span className={`flex-none text-[12px] font-semibold ${result.ok ? 'text-p-positive' : 'text-p-warning'}`}>
                {result.text}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
