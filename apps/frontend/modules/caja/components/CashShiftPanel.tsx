// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashShiftInfo = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openingAmount: number;
  cashRegister?: {
    id: string;
    name: string;
    location?: string | null;
  } | null;
};

type CashShiftPanelProps = {
  shift: CashShiftInfo | null;
  loading: boolean;
  /** Abre sidebar open_shift o close_shift según estado actual. */
  onToggleShift: () => void;
  /** Navega a la pestaña Movimientos y abre el sidebar de nuevo movimiento. */
  onRegisterMovement: () => void;
  /** Navega a la pestaña Cierre. */
  onGoToClosures: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-AR')}`;

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#f0f2f7] py-2 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#98a1b3]">
        {label}
      </span>
      <span className="text-right text-[13px] font-medium text-[#2a3245]">{value}</span>
    </div>
  );
}

function QuickActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] font-semibold text-[#4e5870] transition hover:border-[#c0cadf] hover:bg-[#f5f6f8]"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashShiftPanel — panel operativo del turno activo (tab Resumen de Caja).
 *
 * Muestra el estado del turno, los datos de apertura y las acciones rápidas
 * (abrir/cerrar caja, registrar movimiento, ir a cierres).
 *
 * Puramente presentacional: sin estado propio, sin fetch.
 * Coherente con CashSummaryCards, CashCloseFlow y CashAccountDetailPanel.
 */
export default function CashShiftPanel({
  shift,
  loading,
  onToggleShift,
  onRegisterMovement,
  onGoToClosures,
}: CashShiftPanelProps) {
  const isOpen = Boolean(shift);

  return (
    <div className="rounded-xl border border-[#dce2ee] bg-white">
      <div className="grid min-h-full grid-cols-1 gap-4 p-4 md:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-[#dce2ee] bg-white md:col-span-1">
        <div className="flex items-center justify-between border-b border-[#edf0f6] px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-[#1a2035]">Turno de caja</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              isOpen
                ? 'border border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
                : 'border border-[#dce2ee] bg-[#f5f6f8] text-[#6f7890]'
            }`}
          >
            {isOpen ? 'Abierta' : 'Cerrada'}
          </span>
        </div>

        <div className="flex-1 px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[50, 70, 45].map((w, i) => (
                <div
                  key={i}
                  className="h-3 animate-pulse rounded bg-[#f0f2f7]"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : shift ? (
            <div className="rounded-xl border border-[#edf0f6] bg-[#f8f9fc] px-4 py-1">
              <DataRow label="Caja" value={shift.cashRegister?.name || 'Sin nombre'} />
              <DataRow label="Apertura" value={formatDateTime(shift.openedAt)} />
              <DataRow label="Monto inicial" value={formatMoney(Number(shift.openingAmount || 0))} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-[#6f7890]">
                No hay turno activo. Abrí caja para iniciar la operación diaria.
              </p>
            </div>
          )}
        </div>
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-[#dce2ee] bg-white px-5 py-4 md:col-span-2">

          {/* Estado + acción principal */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#edf0f6] bg-[#f8f9fc] px-4 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#98a1b3]">
                Estado de caja
              </p>
              <p className={`mt-1.5 text-[15px] font-bold ${isOpen ? 'text-[#15803d]' : 'text-[#6f7890]'}`}>
                {isOpen ? 'Caja abierta' : 'Caja cerrada'}
              </p>
              <p className="mt-1 text-[12px] text-[#6f7890]">
                {isOpen
                  ? 'Registrá movimientos desde la pestaña Movimientos.'
                  : 'Abrí caja para iniciar la operación diaria.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleShift}
              className={`shrink-0 h-9 rounded-lg px-4 text-[12px] font-semibold transition ${
                isOpen
                  ? 'border border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f5f6f8]'
                  : 'bg-[#3053e2] text-white hover:bg-[#2748cc]'
              }`}
            >
              {isOpen ? 'Cerrar caja' : 'Abrir caja'}
            </button>
          </div>

          {/* Acciones rápidas */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#98a1b3]">
              Acciones rápidas
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <QuickActionButton
                label="Registrar movimiento"
                onClick={onRegisterMovement}
              />
              <QuickActionButton
                label="Ver cierres"
                onClick={onGoToClosures}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
