// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashMovement = {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
};

type CashMovementsTimelineProps = {
  movements: CashMovement[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const movementMethodText = (method: CashMovement['method']): string => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
};

/**
 * Convierte el concepto técnico en algo que se lee de un vistazo.
 * "Pago reserva Cancha 1 - Juan" → título "Juan", detalle "Cobro de reserva · Cancha 1".
 */
export const describeMovement = (movement: CashMovement): { title: string; detail: string } => {
  const raw = String(movement.description || '').trim();
  const booking = raw.match(/^Pago reserva\s+(.+?)\s+-\s+(.+)$/i);
  if (booking) return { title: booking[2], detail: `Cobro de reserva · ${booking[1]}` };
  if (/^(Reintegro de pago|Devoluci[oó]n)\b/i.test(raw)) return { title: 'Devolución', detail: 'Plata devuelta' };
  if (/^Pago de cuenta\b/i.test(raw)) return { title: 'Cobro de cuenta', detail: '' };
  // Sin códigos internos (#cmw5…) a la vista.
  const clean = raw.replace(/\s*#\S+/g, '').trim();
  if (!clean) {
    return { title: movement.type === 'INCOME' ? 'Ingreso' : 'Egreso', detail: '' };
  }
  return { title: clean, detail: movement.type === 'INCOME' ? 'Ingreso' : 'Egreso' };
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin-fecha';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const formatDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin fecha';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoy';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ayer';
  return d
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(/,/g, '');
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashMovementsTimeline — qué entró y qué salió, agrupado por día.
 * Cada fila: hora, quién o qué, cómo se pagó y el monto con signo.
 */
export default function CashMovementsTimeline({
  movements,
  loading = false,
  emptyTitle = 'No hubo movimientos',
  emptyDescription = 'En este período no entró ni salió plata.',
  className,
}: CashMovementsTimelineProps) {
  if (loading && movements.length === 0) {
    return (
      <div className={cx('space-y-2', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-p-surface-2" />
        ))}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className={cx('rounded-xl border border-dashed border-p-border px-4 py-10 text-center', className)}>
        <p className="text-[14px] font-semibold text-p-text-secondary">{emptyTitle}</p>
        <p className="mt-1 text-[12px] text-p-text-muted">{emptyDescription}</p>
      </div>
    );
  }

  const sorted = [...movements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const groups: Array<{ key: string; label: string; items: CashMovement[]; net: number }> = [];
  for (const movement of sorted) {
    const key = dayKey(movement.date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: formatDay(movement.date), items: [], net: 0 };
      groups.push(group);
    }
    group.items.push(movement);
    group.net += movement.type === 'INCOME' ? movement.amount : -movement.amount;
  }

  return (
    <div className={cx('space-y-5', className)}>
      {groups.map((group) => (
        <section key={group.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 px-1">
            <p className="text-[13px] font-semibold capitalize text-p-text">{group.label}</p>
            <p className="text-[12px] tabular-nums text-p-text-muted">
              En el día {group.net < 0 ? '−' : '+'}
              {formatMoney(Math.abs(group.net))}
            </p>
          </div>
          <ul className="divide-y divide-p-border rounded-xl border border-p-border bg-p-surface">
            {group.items.map((movement) => {
              const { title, detail } = describeMovement(movement);
              const income = movement.type === 'INCOME';
              return (
                <li key={movement.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  <span className="text-[12px] tabular-nums text-p-text-muted">{formatTime(movement.date)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-p-text">{title}</p>
                    <p className="truncate text-[12px] text-p-text-muted">
                      {detail ? `${detail} · ` : ''}
                      {movementMethodText(movement.method)}
                    </p>
                  </div>
                  <span
                    className={cx(
                      'text-[14px] font-semibold tabular-nums',
                      income ? 'text-p-positive' : 'text-p-error'
                    )}
                  >
                    {income ? '+' : '−'}
                    {formatMoney(movement.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
