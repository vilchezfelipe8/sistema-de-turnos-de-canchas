// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashAccountItem = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
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
  /** Called when the user clicks the card or "Ver cuenta". */
  onSelect: (id: string) => void;
  /** Called when the user clicks "Cobrar" — opens payment flow directly. */
  onPay: (id: string) => void;
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
  onPay,
}: {
  account: CashAccountItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onPay: (id: string) => void;
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

  return (
    <div
      className={[
        'group relative flex flex-col gap-2 rounded-xl border px-4 py-3 transition',
        isSelected
          ? 'border-[#3053e2] bg-[#eef1fd]'
          : 'border-[#dce2ee] bg-white hover:border-[#c0cadf] hover:bg-[#fafbff]',
      ].join(' ')}
    >
      {/* ── Top row: name + status badge ── */}
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelect(account.id)}
          className="min-w-0 text-left"
        >
          <p className="truncate text-[13px] font-semibold leading-snug text-[#1a2035]">
            {clientName}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#6f7890]">{courtInfo}</p>
        </button>

        <span
          className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isOpen
              ? 'border border-[#bfdbfe] bg-[#eff6ff] text-[#1e40af]'
              : 'border border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
          }`}
        >
          {isOpen ? 'Abierta' : 'Cerrada'}
        </span>
      </div>

      {/* ── Financial summary ── */}
      <div className="flex items-center gap-4 text-[12px]">
        {detail ? (
          <>
            <span className="text-[#6f7890]">
              Total <span className="font-semibold text-[#2a3245]">{formatMoney(detail.total)}</span>
            </span>
            {detail.paid > EPSILON && (
              <span className="text-[#6f7890]">
                Pagado <span className="font-semibold text-[#15803d]">{formatMoney(detail.paid)}</span>
              </span>
            )}
            {hasPending ? (
              <span className="text-[#6f7890]">
                Pendiente{' '}
                <span className="font-semibold text-[#b45309]">{formatMoney(remaining!)}</span>
              </span>
            ) : (
              <span className="font-semibold text-[#15803d]">Sin deuda</span>
            )}
          </>
        ) : (
          <span className="text-[#98a1b3]">Cargando detalle…</span>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center gap-2">
        {hasPending && isOpen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPay(account.id);
            }}
            className="h-8 rounded-lg bg-[#3053e2] px-3 text-[12px] font-semibold text-white transition hover:bg-[#2748cc]"
          >
            Cobrar
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(account.id);
          }}
          className="h-8 rounded-lg border border-[#dce2ee] bg-white px-3 text-[12px] font-semibold text-[#4e5870] transition hover:border-[#c0cadf] hover:bg-[#f5f6f8]"
        >
          Ver cuenta
        </button>
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
  onPay,
  loading = false,
  className,
}: CashAccountsListProps) {
  if (loading) {
    return (
      <div className={['space-y-2', className].filter(Boolean).join(' ')}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-[#dce2ee] bg-white px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-[#f0f2f7]" />
                <div className="h-2.5 w-20 animate-pulse rounded bg-[#f0f2f7]" />
              </div>
              <div className="h-5 w-14 animate-pulse rounded-full bg-[#f0f2f7]" />
            </div>
            <div className="flex gap-4">
              <div className="h-3 w-20 animate-pulse rounded bg-[#f0f2f7]" />
              <div className="h-3 w-20 animate-pulse rounded bg-[#f0f2f7]" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-16 animate-pulse rounded-lg bg-[#f0f2f7]" />
              <div className="h-8 w-20 animate-pulse rounded-lg bg-[#f0f2f7]" />
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
          'grid min-h-[140px] place-items-center rounded-xl border border-dashed border-[#dce2ee] bg-[#f8f9fc] px-4 py-8 text-center',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div>
          <p className="text-[14px] font-semibold text-[#98a1b3]">Sin cuentas</p>
          <p className="mt-1 text-[12px] text-[#b0b8c8]">
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
          onPay={onPay}
        />
      ))}
    </div>
  );
}
