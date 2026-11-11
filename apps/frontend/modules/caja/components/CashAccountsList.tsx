import { Check } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashAccountItem = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT' | 'SUBSCRIPTION_INSTALLMENT';
  /** Quién: cliente o titular de la reserva. */
  title: string;
  /** Qué: "Reserva · Cancha 1", "Cuota de plan"… */
  concept: string;
  /** Cuándo: "sáb 7 nov". */
  dateLabel: string;
  /** Horario del turno, si es una reserva: "08:30–10:00". */
  timeLabel: string | null;
  bookingId?: number | null;
  total: number;
  paid: number;
  remaining: number;
};

type CashAccountsListProps = {
  accounts: CashAccountItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Cobro directo desde la fila (solo cuentas abiertas que deben). */
  onPay?: (id: string) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

const EPSILON = 0.009;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const accountOwes = (account: Pick<CashAccountItem, 'status' | 'remaining'>) =>
  account.status === 'OPEN' && account.remaining > EPSILON;

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function AccountRow({
  account,
  isSelected,
  onSelect,
  onPay,
}: {
  account: CashAccountItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onPay?: (id: string) => void;
}) {
  const owes = accountOwes(account);
  const paidInFull = account.remaining <= EPSILON;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(account.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(account.id);
      }}
      className={cx(
        'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 outline-none transition focus-visible:ring-2 focus-visible:ring-lima-300/40 sm:grid-cols-[104px_minmax(0,1fr)_auto]',
        isSelected ? 'border-ink-900 bg-p-surface-2' : 'border-p-border bg-p-surface hover:bg-p-surface-2'
      )}
    >
      {/* Cuándo */}
      <div className="col-span-2 flex items-baseline gap-2 sm:col-span-1 sm:block">
        <p className="text-[13px] font-semibold text-p-text">{account.dateLabel}</p>
        {account.timeLabel && (
          <p className="text-[12px] tabular-nums text-p-text-muted">{account.timeLabel}</p>
        )}
      </div>

      {/* Quién y qué */}
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold text-p-text">{account.title}</p>
        <p className="truncate text-[12px] text-p-text-muted">{account.concept}</p>
      </div>

      {/* Cuánto */}
      <div className="flex items-center justify-end gap-3">
        {owes ? (
          <>
            <div className="text-right">
              <p className="text-[14px] font-bold tabular-nums text-p-warning">Debe {formatMoney(account.remaining)}</p>
              {account.paid > EPSILON && (
                <p className="text-[11px] tabular-nums text-p-text-muted">pagó {formatMoney(account.paid)}</p>
              )}
            </div>
            {onPay && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPay(account.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="h-9 rounded-lg bg-ink-900 px-3.5 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                Cobrar
              </button>
            )}
          </>
        ) : account.total <= EPSILON ? (
          <p className="text-[13px] font-medium text-p-text-muted">Sin cargo</p>
        ) : paidInFull ? (
          <p className="inline-flex items-center gap-1 text-[13px] font-semibold text-p-positive">
            <Check size={14} />
            Pagado {formatMoney(account.total)}
          </p>
        ) : (
          <p className="text-[13px] font-medium text-p-text-muted">Cerrada sin cobrar</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashAccountsList — una fila por cuenta: cuándo, quién, qué y cuánto debe.
 * Puramente presentacional.
 */
export default function CashAccountsList({
  accounts,
  selectedId,
  onSelect,
  onPay,
  loading = false,
  emptyTitle = 'No hay cuentas',
  emptyDescription = 'No hay cuentas para este filtro.',
  className,
}: CashAccountsListProps) {
  if (loading) {
    return (
      <div className={cx('space-y-2', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-p-border bg-p-surface px-4 py-3">
            <div className="h-3.5 w-20 animate-pulse rounded bg-p-surface-3" />
            <div className="h-3.5 flex-1 animate-pulse rounded bg-p-surface-3" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-p-surface-3" />
          </div>
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className={cx('rounded-xl border border-dashed border-p-border px-4 py-10 text-center', className)}>
        <p className="text-[14px] font-semibold text-p-text-secondary">{emptyTitle}</p>
        <p className="mt-1 text-[12px] text-p-text-muted">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={cx('space-y-2', className)}>
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          isSelected={selectedId === account.id}
          onSelect={onSelect}
          onPay={onPay}
        />
      ))}
    </div>
  );
}
