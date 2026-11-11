import { Check } from 'lucide-react';
import type { CashAccountItem } from './CashAccountsList';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashDetailItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  // Precio por jugador: parte de un jugador (lugar) y si su precio socio está pendiente de validar.
  playerSlot?: {
    bookingId: number;
    slotIndex: number;
    displayName: string | null;
    memberPricePending: boolean;
    memberCategoryName: string | null;
    isFrozen: boolean;
  } | null;
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
  account: CashAccountItem | null;
  detail: CashAccountDetail | null;
  loading: boolean;
  error: string;
  /** Abre la gestión completa de la cuenta (agregar consumos, descuentos…). */
  onManage: () => void;
  /** Abre el cobro. */
  onPay: () => void;
  /** Abre la devolución de un pago. */
  onRefund: () => void;
  /** Cierra la cuenta (sin saldo). */
  onCloseAccount: () => void;
  /** Abre "Emitir factura". Solo se pasa si el club factura. */
  onInvoice?: () => void;
  /** Valida en el mostrador el precio socio pendiente de un jugador. */
  onValidateMember?: (item: CashDetailItem) => void;
  validatingItemId?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;

const EPSILON = 0.009;

const methodLabel = (method: string, channel?: string | null): string => {
  const m = String(method || '').toUpperCase();
  const c = String(channel || '').toUpperCase();
  if (m === 'CASH') return 'Efectivo';
  if (m === 'CARD') return 'Tarjeta';
  if (m === 'TRANSFER') return c === 'VIRTUAL_WALLET' ? 'Transferencia (billetera)' : 'Transferencia';
  return method || 'Pago';
};

const formatPaymentWhen = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} ${time}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashAccountDetailPanel — detalle de una cuenta en Caja → Cuentas.
 *
 * Se lee igual que el panel de reserva de la agenda: quién y cuándo arriba,
 * cuánto debe en grande con el botón de cobrar, y después qué se consumió y
 * qué se pagó. Puramente presentacional.
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
  onInvoice,
  onValidateMember,
  validatingItemId,
}: CashAccountDetailPanelProps) {
  if (!account) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-p-border px-6 py-10 text-center">
        <p className="text-[14px] font-semibold text-p-text-secondary">Elegí una cuenta</p>
        <p className="mt-1 text-[12px] text-p-text-muted">Acá ves qué consumió, qué pagó y cuánto debe.</p>
      </div>
    );
  }

  const total = detail ? detail.total : account.total;
  const paid = detail ? detail.paid : account.paid;
  const remaining = detail ? detail.remaining : account.remaining;
  const isOpen = account.status === 'OPEN';
  const owes = isOpen && remaining > EPSILON;
  const canClose = Boolean(detail && isOpen && remaining <= EPSILON);
  const hasPayments = Boolean(detail && detail.payments.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-p-border bg-p-surface">
      {/* Quién y cuándo */}
      <div className="shrink-0 border-b border-p-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-[20px] font-bold leading-tight tracking-tight text-p-text">{account.title}</p>
          {!isOpen && (
            <span className="shrink-0 rounded-full bg-p-surface-3 px-2.5 py-1 text-[11px] font-bold text-p-text-secondary">
              Cerrada
            </span>
          )}
        </div>
        <p className="mt-1 text-[14px] text-p-text-secondary">
          {account.dateLabel}
          {account.timeLabel ? ` · ${account.timeLabel}` : ''} · {account.concept}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Cuánto */}
        <div className="border-b border-p-border px-5 py-4">
          {owes ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[13px] text-p-text-muted">Debe</p>
                <p className="text-[30px] font-bold leading-tight tabular-nums text-p-warning">{formatMoney(remaining)}</p>
                <p className="text-[12px] tabular-nums text-p-text-muted">
                  Total {formatMoney(total)}
                  {paid > EPSILON ? ` · pagó ${formatMoney(paid)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onPay}
                className="h-11 rounded-xl bg-ink-900 px-5 text-[14px] font-semibold text-ink-50 transition hover:bg-ink-800"
              >
                Cobrar {formatMoney(remaining)}
              </button>
            </div>
          ) : total <= EPSILON ? (
            <div>
              <p className="text-[16px] font-semibold text-p-text-secondary">Sin cargo</p>
              <p className="text-[12px] text-p-text-muted">No tiene nada para cobrar (por ejemplo, una reserva cancelada).</p>
            </div>
          ) : remaining <= EPSILON ? (
            <div>
              <p className="inline-flex items-center gap-1.5 text-[18px] font-bold text-p-positive">
                <Check size={18} />
                Pagado
              </p>
              <p className="text-[12px] tabular-nums text-p-text-muted">Total {formatMoney(total)}</p>
            </div>
          ) : (
            <div>
              <p className="text-[16px] font-semibold text-p-text-secondary">Cerrada sin cobrar</p>
              <p className="text-[12px] tabular-nums text-p-text-muted">
                Quedaron {formatMoney(remaining)} sin cobrar (por ejemplo, una reserva cancelada).
              </p>
            </div>
          )}
        </div>

        {loading && !detail ? (
          <div className="space-y-3 px-5 py-4">
            {[60, 40, 70].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded bg-p-surface-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : error && !detail ? (
          <p className="m-5 rounded-xl bg-p-error-bg px-3 py-2 text-[12px] font-semibold text-p-error">{error}</p>
        ) : detail ? (
          <>
            {/* Qué se consumió */}
            <div className="px-5 py-4">
              <p className="text-[13px] font-semibold text-p-text">Qué incluye</p>
              {detail.items.length === 0 ? (
                <p className="mt-2 text-[12px] text-p-text-muted">Todavía no tiene nada cargado.</p>
              ) : (
                <ul className="mt-2 divide-y divide-p-border">
                  {detail.items.map((item) => {
                    const memberPending = Boolean(item.playerSlot?.memberPricePending && !item.playerSlot.isFrozen);
                    return (
                      <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[13px] text-p-text">
                            {item.description}
                            {item.quantity > 1 ? <span className="text-p-text-muted"> × {item.quantity}</span> : null}
                          </p>
                          {memberPending && (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-semibold text-p-warning">Dice ser socio: falta validar</span>
                              {onValidateMember && (
                                <button
                                  type="button"
                                  onClick={() => onValidateMember(item)}
                                  disabled={validatingItemId === item.id}
                                  title="Verificá su carnet o DNI y aplicá el precio socio antes de cobrar"
                                  className="text-[12px] font-semibold text-p-accent hover:underline underline-offset-2 disabled:opacity-50"
                                >
                                  {validatingItemId === item.id ? 'Validando...' : 'Validar socio'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="shrink-0 text-[13px] font-semibold tabular-nums text-p-text">{formatMoney(item.total)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Qué se pagó */}
            <div className="border-t border-p-border px-5 py-4">
              <p className="text-[13px] font-semibold text-p-text">Pagos</p>
              {detail.payments.length === 0 ? (
                <p className="mt-2 text-[12px] text-p-text-muted">Todavía no pagó nada.</p>
              ) : (
                <ul className="mt-2 divide-y divide-p-border">
                  {detail.payments.map((payment) => {
                    const when = formatPaymentWhen(payment.createdAt);
                    return (
                      <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[13px] text-p-text">{methodLabel(payment.method, payment.channel)}</p>
                          {when && <p className="text-[11px] text-p-text-muted">{when}</p>}
                        </div>
                        <p className="shrink-0 text-[13px] font-semibold tabular-nums text-p-positive">
                          {formatMoney(payment.amount)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Acciones secundarias */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-p-border px-5 py-3">
        {isOpen && (
          <button
            type="button"
            onClick={onManage}
            className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
          >
            Agregar consumo o descuento
          </button>
        )}
        {hasPayments && (
          <button
            type="button"
            onClick={onRefund}
            className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2"
          >
            Devolver un pago
          </button>
        )}
        {onInvoice && hasPayments && total > EPSILON && (
          <button
            type="button"
            onClick={onInvoice}
            className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2"
          >
            Emitir factura
          </button>
        )}
        {canClose && (
          <button
            type="button"
            onClick={onCloseAccount}
            className="ml-auto h-9 rounded-lg border border-p-border px-3.5 text-[13px] font-semibold text-p-text hover:bg-p-surface-2"
          >
            Cerrar cuenta
          </button>
        )}
      </div>
    </div>
  );
}
