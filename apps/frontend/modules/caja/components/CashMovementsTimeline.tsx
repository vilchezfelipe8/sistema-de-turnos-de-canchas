import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashMovement = {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  /** Texto para buscar (quién + qué). */
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
  /** Cobro de una cuenta, devolución, o ingreso/egreso a mano. */
  kind?: 'PAYMENT' | 'REFUND' | 'MANUAL';
  /** "Lionel Messi", "Venta mostrador", "Compra de pelotas"… */
  who?: string;
  /** "Reserva · Cancha 1 · mar 3 nov 22:00" */
  what?: string;
  accountId?: string | null;
  paymentId?: string | null;
};

type CashMovementsTimelineProps = {
  movements: CashMovement[];
  /** Todos los movimientos del período (sin filtros), para emparejar cobros con sus devoluciones. */
  allMovements?: CashMovement[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Tocar un cobro o devolución abre su cuenta. */
  onOpenAccount?: (accountId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;
const EPS = 0.009;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const movementMethodText = (method: CashMovement['method']): string => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
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

const formatShortDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dayKey(iso) === dayKey(new Date().toISOString())
    ? `hoy ${formatTime(iso)}`
    : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '')} ${formatTime(iso)}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashMovementsTimeline — qué entró y qué salió, agrupado por día.
 * Cada fila: hora, quién, qué y cómo se pagó, y el monto con signo.
 * Un cobro devuelto muestra la devolución al lado; se pueden ocultar los dos.
 */
export default function CashMovementsTimeline({
  movements,
  allMovements,
  loading = false,
  emptyTitle = 'No hubo movimientos',
  emptyDescription = 'En este período no entró ni salió plata.',
  className,
  onOpenAccount,
}: CashMovementsTimelineProps) {
  const [hideRefunded, setHideRefunded] = useState(false);

  // Cobro ↔ devoluciones del mismo pago.
  const pairing = useMemo(() => {
    const source = allMovements || movements;
    const paymentByPaymentId = new Map<string, CashMovement>();
    const refundedByPaymentId = new Map<string, { amount: number; lastDate: string }>();
    source.forEach((movement) => {
      if (!movement.paymentId) return;
      if (movement.kind === 'PAYMENT') paymentByPaymentId.set(movement.paymentId, movement);
      if (movement.kind === 'REFUND') {
        const prev = refundedByPaymentId.get(movement.paymentId) || { amount: 0, lastDate: '' };
        refundedByPaymentId.set(movement.paymentId, {
          amount: prev.amount + movement.amount,
          lastDate: movement.date > prev.lastDate ? movement.date : prev.lastDate,
        });
      }
    });
    const fullyRefunded = new Set<string>();
    refundedByPaymentId.forEach((refund, paymentId) => {
      const payment = paymentByPaymentId.get(paymentId);
      if (payment && refund.amount >= payment.amount - EPS) fullyRefunded.add(paymentId);
    });
    return { paymentByPaymentId, refundedByPaymentId, fullyRefunded };
  }, [allMovements, movements]);

  const hiddenCount = useMemo(
    () => movements.filter((m) => m.paymentId && pairing.fullyRefunded.has(m.paymentId)).length,
    [movements, pairing]
  );
  const visible = useMemo(
    () => (hideRefunded ? movements.filter((m) => !(m.paymentId && pairing.fullyRefunded.has(m.paymentId))) : movements),
    [hideRefunded, movements, pairing]
  );

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

  const sorted = [...visible].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
      {hiddenCount > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 px-1 text-[12px] font-semibold text-p-text-secondary">
          <input
            type="checkbox"
            checked={hideRefunded}
            onChange={(event) => setHideRefunded(event.target.checked)}
            className="h-4 w-4 accent-current"
          />
          Ocultar cobros devueltos ({hiddenCount} {hiddenCount === 1 ? 'línea' : 'líneas'})
        </label>
      )}

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-p-border px-4 py-6 text-center text-[13px] text-p-text-muted">
          Solo hay cobros devueltos. Destildá “Ocultar cobros devueltos” para verlos.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 px-1">
            <p className="text-[13px] font-semibold text-p-text first-letter:uppercase">{group.label}</p>
            <p className="text-[12px] tabular-nums text-p-text-muted">
              En el día {group.net < 0 ? '−' : '+'}
              {formatMoney(Math.abs(group.net))}
            </p>
          </div>
          <ul className="divide-y divide-p-border rounded-xl border border-p-border bg-p-surface">
            {group.items.map((movement) => {
              const income = movement.type === 'INCOME';
              const who = movement.who || (income ? 'Ingreso' : 'Egreso');
              const refund =
                movement.kind === 'PAYMENT' && movement.paymentId
                  ? pairing.refundedByPaymentId.get(movement.paymentId)
                  : undefined;
              const original =
                movement.kind === 'REFUND' && movement.paymentId
                  ? pairing.paymentByPaymentId.get(movement.paymentId)
                  : undefined;
              const clickable = Boolean(onOpenAccount && movement.accountId);
              const body = (
                <>
                  <span className="text-[12px] tabular-nums text-p-text-muted">{formatTime(movement.date)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-p-text">{who}</p>
                    <p className="text-[12px] text-p-text-muted sm:truncate">
                      {[movement.what, movementMethodText(movement.method)].filter(Boolean).join(' · ')}
                    </p>
                    {refund && (
                      <p className="mt-0.5 text-[12px] font-semibold text-p-warning">
                        {refund.amount >= movement.amount - EPS ? 'Devuelto' : `Devolvieron ${formatMoney(refund.amount)}`}{' '}
                        {formatShortDay(refund.lastDate)}
                      </p>
                    )}
                    {original && (
                      <p className="mt-0.5 text-[12px] text-p-text-muted">Del cobro del {formatShortDay(original.date)}</p>
                    )}
                  </div>
                  <span className="flex items-center gap-1">
                    <span
                      className={cx(
                        'text-[14px] font-semibold tabular-nums',
                        income ? 'text-p-positive' : 'text-p-error',
                        refund && refund.amount >= movement.amount - EPS && 'line-through opacity-60'
                      )}
                    >
                      {income ? '+' : '−'}
                      {formatMoney(movement.amount)}
                    </span>
                    {clickable && <ChevronRight size={14} className="text-p-text-muted" />}
                  </span>
                </>
              );
              const rowClass = 'grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left';
              return (
                <li key={movement.id}>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onOpenAccount?.(String(movement.accountId))}
                      className={cx(rowClass, 'hover:bg-p-surface-2')}
                      title="Ver la cuenta"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={rowClass}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
