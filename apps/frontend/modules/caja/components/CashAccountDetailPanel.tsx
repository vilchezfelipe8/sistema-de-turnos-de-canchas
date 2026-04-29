import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types (mirrors AccountRow / AccountDetail shapes — no new imports needed)
// ---------------------------------------------------------------------------

export type CashDetailAccount = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  booking?: {
    id?: number;
    clientName?: string | null;
    courtName?: string | null;
  } | null;
};

export type CashDetailItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
};

export type CashDetailPayment = {
  id: string;
  amount: number;
  method: string;
  channel?: string | null;
  createdAt?: string | null;
};

export type CashAccountDetail = {
  total: number;
  paid: number;
  remaining: number;
  items: CashDetailItem[];
  payments: CashDetailPayment[];
};

type CashAccountDetailPanelProps = {
  account: CashDetailAccount | null;
  detail: CashAccountDetail | null;
  loading: boolean;
  error: string;
  /** Opens the full account management sidebar (overview → payment flow). */
  onManage: () => void;
  /** Opens the payment flow directly. */
  onPay: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;

const EPSILON = 0.009;

const sourceLabel: Record<CashDetailAccount['sourceType'], string> = {
  BOOKING: 'Reserva',
  BAR: 'Consumos',
  TABLE: 'Mesa',
  MANUAL: 'Manual',
};

const itemTypeLabel: Record<string, string> = {
  BOOKING: 'Cancha',
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  ADJUSTMENT: 'Ajuste',
};

const methodLabel = (method: string): string => {
  const m = method.toUpperCase();
  if (m === 'CASH') return 'Efectivo';
  if (m === 'TRANSFER') return 'Transferencia';
  if (m === 'CARD') return 'Tarjeta';
  return method || '-';
};

const channelLabel = (channel: string | null | undefined): string | null => {
  if (!channel) return null;
  const c = channel.toUpperCase();
  if (c === 'BANK_ACCOUNT') return 'Cuenta bancaria';
  if (c === 'VIRTUAL_WALLET') return 'Billetera virtual';
  if (c === 'CASH_DRAWER') return 'Caja';
  if (c === 'CARD_TERMINAL') return 'Terminal';
  return channel;
};

const formatTime = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

const shortId = (id: string) => (id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between border-b border-[#edf0f6] px-4 py-2.5">
      <p className="text-[12px] font-semibold text-[#2a3245]">{title}</p>
      {count !== undefined && (
        <span className="rounded-full bg-[#f0f2f7] px-2 py-0.5 text-[10px] font-semibold text-[#6f7890]">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="px-4 py-5 text-center text-[12px] text-[#98a1b3]">{message}</p>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashAccountDetailPanel — panel derecho de detalle de cuenta en Caja → Cuentas.
 *
 * Puramente presentacional: recibe datos y callbacks, sin fetch ni estado propio.
 * Diseñado para ser coherente con CashAccountsList en la misma pantalla.
 */
export default function CashAccountDetailPanel({
  account,
  detail,
  loading,
  error,
  onManage,
  onPay,
}: CashAccountDetailPanelProps) {
  // ── Empty state ──
  if (!account) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-[#dce2ee] bg-white px-6 py-10 text-center">
        <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-[#f0f2f7]">
          <span className="text-[18px] text-[#b0b8c8]">$</span>
        </div>
        <p className="text-[13px] font-semibold text-[#6f7890]">Seleccioná una cuenta</p>
        <p className="mt-1 text-[12px] text-[#b0b8c8]">
          El detalle aparece aquí al hacer clic en una cuenta de la lista.
        </p>
      </div>
    );
  }

  const clientName = account.booking?.clientName?.trim() || `Cuenta ${shortId(account.id)}`;
  const isOpen = account.status === 'OPEN';
  const hasPending = detail ? detail.remaining > EPSILON : false;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#dce2ee] bg-white">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-[#edf0f6] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-snug text-[#1a2035]">
              {clientName}
            </p>
            <p className="mt-0.5 text-[11px] text-[#6f7890]">
              {sourceLabel[account.sourceType]}
              {account.booking?.courtName ? ` · ${account.booking.courtName}` : ''}
              {' · '}
              <span className="font-mono">#{shortId(account.id)}</span>
            </p>
          </div>
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
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            {[40, 28, 64, 48].map((w, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-[#f0f2f7]"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="m-4 rounded-xl border border-[#f2b8c3] bg-[#fff2f5] px-3 py-2 text-[12px] font-semibold text-[#b42346]">
            {error}
          </div>
        ) : detail ? (
          <div className="space-y-0 divide-y divide-[#f0f2f7]">

            {/* ── Financial summary ── */}
            <div className="grid grid-cols-3 gap-px bg-[#f0f2f7] border-b border-[#edf0f6]">
              {[
                { label: 'Total', value: detail.total, color: 'text-[#2a3245]' },
                { label: 'Pagado', value: detail.paid, color: 'text-[#15803d]' },
                { label: 'Pendiente', value: detail.remaining, color: hasPending ? 'text-[#b45309]' : 'text-[#98a1b3]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98a1b3]">
                    {label}
                  </p>
                  <p className={`mt-1 text-[15px] font-bold leading-none ${color}`}>
                    {formatMoney(value)}
                  </p>
                </div>
              ))}
            </div>

            {/* ── Items / conceptos ── */}
            <div>
              <SectionHeader title="Conceptos" count={detail.items.length} />
              <div className="max-h-[200px] overflow-y-auto divide-y divide-[#f0f2f7]">
                {detail.items.length === 0 ? (
                  <EmptyRow message="Sin conceptos cargados." />
                ) : (
                  detail.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-[#2a3245]">
                          {item.description}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="inline-flex rounded-full bg-[#f0f2f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#6f7890]">
                            {itemTypeLabel[String(item.type).toUpperCase()] ?? item.type}
                          </span>
                          <span className="text-[10px] text-[#98a1b3]">× {item.quantity}</span>
                        </div>
                      </div>
                      <p className="shrink-0 text-[12px] font-semibold text-[#2a3245]">
                        {formatMoney(item.total)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Pagos asociados ── */}
            <div>
              <SectionHeader title="Pagos" count={detail.payments.length} />
              <div className="max-h-[180px] overflow-y-auto divide-y divide-[#f0f2f7]">
                {detail.payments.length === 0 ? (
                  <EmptyRow message="Sin pagos registrados." />
                ) : (
                  detail.payments.map((payment) => {
                    const channel = channelLabel(payment.channel);
                    const time = formatTime(payment.createdAt);
                    return (
                      <div key={payment.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#1e40af]">
                              {methodLabel(payment.method)}
                            </span>
                            {channel && (
                              <span className="text-[10px] text-[#98a1b3]">{channel}</span>
                            )}
                          </div>
                          {time && (
                            <p className="mt-0.5 text-[10px] text-[#98a1b3]">{time}</p>
                          )}
                        </div>
                        <p className="shrink-0 text-[12px] font-semibold text-[#15803d]">
                          {formatMoney(payment.amount)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-[12px] text-[#98a1b3]">
            No se encontró detalle para esta cuenta.
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      {account && (
        <div className="shrink-0 border-t border-[#edf0f6] px-4 py-3">
          <div className="flex items-center gap-2">
            {hasPending && isOpen && (
              <button
                type="button"
                onClick={onPay}
                className="h-9 rounded-lg bg-[#3053e2] px-4 text-[12px] font-semibold text-white transition hover:bg-[#2748cc]"
              >
                Cobrar
              </button>
            )}
            <button
              type="button"
              onClick={onManage}
              className={[
                'h-9 rounded-lg border px-3 text-[12px] font-semibold transition',
                hasPending && isOpen
                  ? 'border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f5f6f8]'
                  : 'border-[#dce2ee] bg-[#3053e2] text-white hover:bg-[#2748cc]',
              ].join(' ')}
            >
              Gestionar cuenta
            </button>
            <Link
              href="/admin/caja?tab=refunds"
              className="h-9 rounded-lg border border-[#dce2ee] bg-white px-3 inline-flex items-center text-[12px] font-semibold text-[#6f7890] transition hover:bg-[#f5f6f8]"
            >
              Devolución
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
