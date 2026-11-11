import { AlertTriangle, ArrowDownUp, Landmark, Lock, ShoppingBag } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashShiftInfo = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openingAmount: number;
  /** Efectivo que debería haber en el cajón ahora (inicial + entradas − salidas en efectivo). */
  expectedCash?: number | null;
  /** Cobrado por medios digitales en el turno. */
  digitalAmount?: number | null;
  cashRegister?: {
    id: string;
    name: string;
    location?: string | null;
  } | null;
};

type CashShiftPanelProps = {
  shift: CashShiftInfo | null;
  loading: boolean;
  /** Abre el cierre (si está abierta) o la apertura (si está cerrada). */
  onToggleShift: () => void;
  /** Abre el alta de ingreso / egreso. */
  onRegisterMovement: () => void;
  /** Abre la venta mostrador. */
  onProductSale?: () => void;
  /** Muestra el último cierre, si hay uno. */
  onViewLastClose?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;

const formatOpenedAt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} ${time}`;
};

/** Días completos desde la apertura (0 = hoy). */
const daysSince = (iso: string): number => {
  const opened = new Date(iso);
  if (Number.isNaN(opened.getTime())) return 0;
  const start = new Date(opened.getFullYear(), opened.getMonth(), opened.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - start) / 86_400_000));
};

function ActionButton({
  icon: Icon,
  label,
  onClick,
  primary = false,
}: {
  icon: typeof Landmark;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition ${
        primary
          ? 'bg-ink-900 text-ink-50 hover:bg-ink-800'
          : 'border border-p-border bg-p-surface text-p-text hover:bg-p-surface-2'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashShiftPanel — la caja de hoy: cuánta plata hay y qué se puede hacer.
 *
 * Lo primero que se mira es el efectivo que debería haber en el cajón;
 * después lo digital y las acciones del mostrador. Puramente presentacional.
 */
export default function CashShiftPanel({
  shift,
  loading,
  onToggleShift,
  onRegisterMovement,
  onProductSale,
  onViewLastClose,
}: CashShiftPanelProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-p-border bg-p-surface p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-p-surface-3" />
        <div className="mt-3 h-8 w-56 animate-pulse rounded bg-p-surface-3" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-p-border bg-p-surface p-5">
        <div>
          <p className="text-[20px] font-bold text-p-text">La caja está cerrada</p>
          <p className="mt-1 text-[13px] text-p-text-muted">Abrila para empezar a cobrar en el mostrador.</p>
          {onViewLastClose && (
            <button
              type="button"
              onClick={onViewLastClose}
              className="mt-2 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
            >
              Ver cierres anteriores
            </button>
          )}
        </div>
        <ActionButton icon={Landmark} label="Abrir caja" onClick={onToggleShift} primary />
      </div>
    );
  }

  const openingAmount = Number(shift.openingAmount || 0);
  const expectedCash = shift.expectedCash == null ? openingAmount : Number(shift.expectedCash);
  const cashMovement = expectedCash - openingAmount;
  const digitalAmount = Number(shift.digitalAmount || 0);
  const openDays = daysSince(shift.openedAt);

  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-5">
      {openDays >= 1 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-p-warning-bg px-3 py-2.5 text-[13px] text-p-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="flex-1">
            <span className="font-semibold">
              La caja está abierta desde hace {openDays === 1 ? '1 día' : `${openDays} días`}.
            </span>{' '}
            Cerrala al terminar cada día así la cuenta del cajón da justa.
          </p>
          <button
            type="button"
            onClick={onToggleShift}
            className="h-8 flex-none rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-800"
          >
            Cerrar ahora
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="text-[13px] font-medium text-p-text-muted">Efectivo en caja</p>
            <p className="text-[34px] font-bold leading-tight tracking-tight tabular-nums text-p-text">
              {formatMoney(expectedCash)}
            </p>
            <p className="text-[12px] tabular-nums text-p-text-muted">
              Empezó con {formatMoney(openingAmount)}
              {Math.abs(cashMovement) > 0.009
                ? ` · ${cashMovement > 0 ? '+' : '−'}${formatMoney(Math.abs(cashMovement))} en efectivo`
                : ''}
            </p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-p-text-muted">Digital</p>
            <p className="text-[34px] font-bold leading-tight tracking-tight tabular-nums text-p-text-secondary">
              {formatMoney(digitalAmount)}
            </p>
            <p className="text-[12px] text-p-text-muted">Transferencias y tarjetas del turno</p>
          </div>
        </div>
        <p className="text-[12px] text-p-text-muted">
          {shift.cashRegister?.name || 'Caja'} · abierta {formatOpenedAt(shift.openedAt)}
          {onViewLastClose && (
            <>
              {' · '}
              <button
                type="button"
                onClick={onViewLastClose}
                className="font-semibold text-p-accent underline-offset-2 hover:underline"
              >
                Cierres anteriores
              </button>
            </>
          )}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {onProductSale && <ActionButton icon={ShoppingBag} label="Venta mostrador" onClick={onProductSale} primary />}
        <ActionButton icon={ArrowDownUp} label="Ingreso o egreso" onClick={onRegisterMovement} />
        <ActionButton icon={Lock} label="Cerrar caja" onClick={onToggleShift} />
      </div>
    </div>
  );
}
