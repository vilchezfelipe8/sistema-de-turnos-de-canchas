// ---------------------------------------------------------------------------
// Types (mirrors AccountRow / AccountDetail shapes — no new imports needed)
// ---------------------------------------------------------------------------

export type CashDetailAccount = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT';
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
  /** Opens the refund request drawer for this account. */
  onRefund: () => void;
  /** Opens the close account confirmation flow. */
  onCloseAccount: () => void;
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
  CLASS_PASS: 'Pack de clases',
  CLASS_ENROLLMENT: 'Clase',
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

const methodBadgeClass = (method: string): string => {
  const m = method.toUpperCase();
  if (m === 'CASH') return 'border-p-positive bg-p-positive-bg text-p-positive';
  if (m === 'TRANSFER') return 'border-p-info bg-p-info-bg text-p-info';
  if (m === 'CARD') return 'border-p-warning bg-p-warning-bg text-p-warning';
  return 'border-p-border bg-p-surface-2 text-p-text-muted';
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
    <div className="flex items-center justify-between border-b border-p-border px-4 py-2.5">
      <p className="text-[12px] font-semibold text-p-text">{title}</p>
      {count !== undefined && (
        <span className="rounded-full bg-p-surface-3 px-2 py-0.5 text-[10px] font-semibold text-p-text-muted">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="px-4 py-5 text-center text-[12px] text-p-text-muted">{message}</p>
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
  onRefund,
  onCloseAccount,
}: CashAccountDetailPanelProps) {
  // ── Empty state ──
  if (!account) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-p-border bg-p-surface px-6 py-10 text-center">
        <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-p-surface-3">
          <span className="text-[18px] text-p-text-muted">$</span>
        </div>
        <p className="text-[13px] font-semibold text-p-text-muted">Seleccioná una cuenta</p>
        <p className="mt-1 text-[12px] text-p-text-muted">
          El detalle aparece aquí al hacer clic en una cuenta de la lista.
        </p>
      </div>
    );
  }

  const clientName = account.booking?.clientName?.trim() || `Cuenta ${shortId(account.id)}`;
  const isOpen = account.status === 'OPEN';
  const hasPending = detail ? detail.remaining > EPSILON : false;
  const canClose = Boolean(detail && isOpen && !hasPending);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-p-border bg-p-surface">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-p-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-snug text-p-text">
              {clientName}
            </p>
            <p className="mt-0.5 text-[11px] text-p-text-muted">
              {sourceLabel[account.sourceType]}
              {account.booking?.courtName ? ` · ${account.booking.courtName}` : ''}
              {' · '}
              <span className="font-mono">#{shortId(account.id)}</span>
            </p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isOpen
                ? 'border border-p-accent bg-p-surface-2 text-p-accent'
                : 'border border-p-positive bg-p-positive-bg text-[var(--positive-fg)]'
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
                className="h-3 animate-pulse rounded bg-p-surface-3"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="m-4 rounded-xl border border-p-error bg-p-error-bg px-3 py-2 text-[12px] font-semibold text-[var(--error-fg)]">
            {error}
          </div>
        ) : detail ? (
          <div className="space-y-0 divide-y divide-p-border">

            {/* ── Financial summary ── */}
            <div className="grid grid-cols-3 gap-px bg-p-surface-3 border-b border-p-border">
              {[
                { label: 'Total', value: detail.total, color: 'text-p-text' },
                { label: 'Pagado', value: detail.paid, color: 'text-[var(--positive-fg)]' },
                { label: 'Pendiente', value: detail.remaining, color: hasPending ? 'text-[var(--warn-fg)]' : 'text-p-text-muted' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-p-surface px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-p-text-muted">
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
              <div className="max-h-[200px] overflow-y-auto divide-y divide-p-border">
                {detail.items.length === 0 ? (
                  <EmptyRow message="Sin conceptos cargados." />
                ) : (
                  detail.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-p-text">
                          {item.description}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="inline-flex rounded-full bg-p-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-p-text-muted">
                            {itemTypeLabel[String(item.type).toUpperCase()] ?? item.type}
                          </span>
                          <span className="text-[10px] text-p-text-muted">× {item.quantity}</span>
                        </div>
                      </div>
                      <p className="shrink-0 text-[12px] font-semibold text-p-text">
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
              <div className="max-h-[180px] overflow-y-auto divide-y divide-p-border">
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
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${methodBadgeClass(payment.method)}`}>
                              {methodLabel(payment.method)}
                            </span>
                            {channel && (
                              <span className="text-[10px] text-p-text-muted">{channel}</span>
                            )}
                          </div>
                          {time && (
                            <p className="mt-0.5 text-[10px] text-p-text-muted">{time}</p>
                          )}
                        </div>
                        <p className="shrink-0 text-[12px] font-semibold text-[var(--positive-fg)]">
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
          <div className="px-4 py-6 text-center text-[12px] text-p-text-muted">
            No se encontró detalle para esta cuenta.
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      {account && (
        <div className="shrink-0 border-t border-p-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasPending && isOpen && (
              <button
                type="button"
                onClick={onPay}
                className="h-9 rounded-lg bg-ink-900 px-4 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                Cobrar
              </button>
            )}
            {canClose && (
              <button
                type="button"
                onClick={onCloseAccount}
                className="h-9 rounded-lg border border-p-error bg-p-error-bg px-4 text-[12px] font-semibold text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50"
              >
                Cerrar cuenta
              </button>
            )}
            <button
              type="button"
              onClick={onManage}
              className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
            >
              Gestionar cuenta
            </button>
            <button
              type="button"
              onClick={onRefund}
              disabled={!detail || detail.payments.length === 0}
              className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-muted transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Devolución
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
