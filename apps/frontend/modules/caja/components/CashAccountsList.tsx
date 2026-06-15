// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashAccountItem = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT';
  hasDebt: boolean;
  booking?: {
    id?: number;
    clientName?: string | null;
    courtName?: string | null;
  } | null;
  /** Loaded lazily from accountDetailById. Null = still loading. */
  detail?: {
    total: number;
    paid: number;
    remaining: number;
    lastPaymentAt?: string | null;
  } | null;
};

type CashAccountsListProps = {
  accounts: CashAccountItem[];
  selectedId: string | null;
  /** Called when the user clicks the card. */
  onSelect: (id: string) => void;
  loading?: boolean;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (value: number) =>
  `$${Number(value || 0).toLocaleString('es-AR')}`;

const sourceLabel: Record<CashAccountItem['sourceType'], string> = {
  BOOKING: 'Reserva',
  BAR: 'Consumos',
  TABLE: 'Mesa',
  MANUAL: 'Manual',
  CLASS_PASS: 'Pack de clases',
  CLASS_ENROLLMENT: 'Clase',
};

const shortId = (value: string): string => {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

const EPSILON = 0.009;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AccountCard({
  account,
  isSelected,
  onSelect,
}: {
  account: CashAccountItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const { detail } = account;
  const clientName =
    account.booking?.clientName?.trim() || `Cuenta ${shortId(account.id)}`;
  const courtInfo = account.booking?.courtName
    ? `${sourceLabel[account.sourceType]} · ${account.booking.courtName}`
    : sourceLabel[account.sourceType];

  const remaining = detail?.remaining ?? null;
  const hasPending = remaining !== null && remaining > EPSILON;
  const isOpen = account.status === 'OPEN';
  const cardToneClass = isSelected
    ? isOpen
      ? 'border-p-accent bg-p-positive-bg'
      : 'border-p-border-strong bg-p-surface-2'
    : isOpen
    ? 'border-p-accent bg-p-surface'
    : 'border-p-border bg-p-surface-2';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(account.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(account.id);
      }}
      className={[
        'group relative flex cursor-pointer flex-col gap-2 rounded-xl border px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-lima-300/40',
        cardToneClass,
      ].join(' ')}
    >
      {/* ── Top row: name + status badge ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-snug text-p-text">
            {clientName}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-p-text-muted">{courtInfo}</p>
        </div>

        <span
          className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isOpen
              ? 'border border-p-accent bg-p-surface-2 text-p-accent'
              : 'border border-p-border bg-p-surface-3 text-p-text-muted'
          }`}
        >
          {isOpen ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      {/* ── Financial summary ── */}
      <div className="flex items-center gap-4 text-[12px]">
        {detail ? (
          <>
            <span className="text-p-text-muted">
              Total <span className="font-semibold text-p-text">{formatMoney(detail.total)}</span>
            </span>
            {detail.paid > EPSILON && (
              <span className="text-p-text-muted">
                Pagado <span className="font-semibold text-[var(--positive-fg)]">{formatMoney(detail.paid)}</span>
              </span>
            )}
            {hasPending ? (
              <span className="text-p-text-muted">
                Pendiente{' '}
                <span className="font-semibold text-[var(--warn-fg)]">{formatMoney(remaining!)}</span>
              </span>
            ) : (
              <span className="font-semibold text-[var(--positive-fg)]">Sin deuda</span>
            )}
          </>
        ) : (
          <span className="text-p-text-muted">Cargando detalle…</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashAccountsList — lista enriquecida operativa de cuentas.
 *
 * Reemplaza la vista tabular de Caja → Cuentas con cards compactas
 * que muestran cliente, origen, totales y acciones primarias por item.
 *
 * Diseño per Documento Maestro v1.1: no tabla genérica, cards operativas
 * con [Cobrar] y [Ver cuenta] por fila.
 */
export default function CashAccountsList({
  accounts,
  selectedId,
  onSelect,
  loading = false,
  className,
}: CashAccountsListProps) {
  if (loading) {
    return (
      <div className={['space-y-2', className].filter(Boolean).join(' ')}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-p-border bg-p-surface px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-p-surface-3" />
                <div className="h-2.5 w-20 animate-pulse rounded bg-p-surface-3" />
              </div>
              <div className="h-5 w-14 animate-pulse rounded-full bg-p-surface-3" />
            </div>
            <div className="flex gap-4">
              <div className="h-3 w-20 animate-pulse rounded bg-p-surface-3" />
              <div className="h-3 w-20 animate-pulse rounded bg-p-surface-3" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-16 animate-pulse rounded-lg bg-p-surface-3" />
              <div className="h-8 w-20 animate-pulse rounded-lg bg-p-surface-3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div
        className={[
          'grid min-h-[140px] place-items-center rounded-xl border border-dashed border-p-border bg-p-surface-2 px-4 py-8 text-center',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div>
          <p className="text-[14px] font-semibold text-p-text-muted">Sin cuentas</p>
          <p className="mt-1 text-[12px] text-p-text-muted">
            No hay cuentas para los filtros actuales.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={['space-y-2', className].filter(Boolean).join(' ')}>
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          isSelected={selectedId === account.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
