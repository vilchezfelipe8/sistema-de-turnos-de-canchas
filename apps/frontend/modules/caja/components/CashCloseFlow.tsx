// ---------------------------------------------------------------------------
// Types (espeja los tipos de pagos-playground.tsx — sin importarlos)
// ---------------------------------------------------------------------------

export type CashCloseShift = {
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

export type CashCloseReport = {
  shift: {
    id: string;
    openedAt?: string;
    closedAt?: string | null;
  };
  expectedCash: number;
  countedCash: number;
  difference: number;
};

type CashCloseFlowProps = {
  shift: CashCloseShift | null;
  lastReport: CashCloseReport | null;
  /** Resets the form and opens the close-shift sidebar. */
  onCloseShift: () => void;
  /** Opens the close-report detail sidebar. */
  onViewReport: () => void;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CashCloseFlow — vista de cierre de caja para Caja → Cierre.
 *
 * Puramente presentacional: recibe estado del turno y último arqueo,
 * y expone callbacks para abrir el sidebar correspondiente.
 * Compatible visual con CashSummaryCards, CashAccountsList y CashAccountDetailPanel.
 */
export default function CashCloseFlow({
  shift,
  lastReport,
  onCloseShift,
  onViewReport,
}: CashCloseFlowProps) {
  const diff = Number(lastReport?.difference || 0);
  const diffPositive = diff >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

      {/* ── Panel izquierdo: Estado del turno ── */}
      <div className="flex flex-col rounded-xl border border-[#dce2ee] bg-white">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#edf0f6] px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-[#1a2035]">Estado del turno</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              shift
                ? 'border border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
                : 'border border-[#dce2ee] bg-[#f5f6f8] text-[#6f7890]'
            }`}
          >
            {shift ? 'Caja abierta' : 'Caja cerrada'}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          {shift ? (
            <>
              {/* Datos del turno */}
              <div className="rounded-xl border border-[#edf0f6] bg-[#f8f9fc] px-4 py-1">
                <DataRow
                  label="Caja"
                  value={shift.cashRegister?.name || 'Sin nombre'}
                />
                <DataRow
                  label="Apertura"
                  value={formatDateTime(shift.openedAt)}
                />
                <DataRow
                  label="Monto inicial"
                  value={formatMoney(Number(shift.openingAmount || 0))}
                />
              </div>

              <p className="text-[12px] text-[#6f7890]">
                Registrá el efectivo contado para generar el arqueo y cerrar el turno.
              </p>

              <div>
                <button
                  type="button"
                  onClick={onCloseShift}
                  className="h-9 rounded-lg bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
                >
                  Cerrar caja
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-start gap-3 py-2">
              <p className="text-[13px] text-[#6f7890]">
                No hay ningún turno activo en este momento. Abrí caja desde la pestaña Resumen para iniciar la operación.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Panel derecho: Último arqueo ── */}
      <div className="flex flex-col rounded-xl border border-[#dce2ee] bg-white">

        {/* Header */}
        <div className="border-b border-[#edf0f6] px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-[#1a2035]">Último arqueo</h2>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          {lastReport ? (
            <>
              {/* Tres métricas de arqueo */}
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[#edf0f6] bg-[#edf0f6]">
                {[
                  {
                    label: 'Esperado',
                    value: formatMoney(lastReport.expectedCash),
                    color: 'text-[#2a3245]',
                  },
                  {
                    label: 'Contado',
                    value: formatMoney(lastReport.countedCash),
                    color: 'text-[#2a3245]',
                  },
                  {
                    label: 'Diferencia',
                    value: `${diffPositive ? '+' : '−'}${formatMoney(Math.abs(diff))}`,
                    color: diffPositive ? 'text-[#15803d]' : 'text-[#b91c1c]',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-white px-3 py-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98a1b3]">
                      {label}
                    </p>
                    <p className={`mt-1 text-[15px] font-bold leading-none ${color}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Datos del cierre */}
              {lastReport.shift?.id && (
                <div className="rounded-xl border border-[#edf0f6] bg-[#f8f9fc] px-4 py-1">
                  <DataRow label="ID cierre" value={lastReport.shift.id} />
                  {lastReport.shift.closedAt && (
                    <DataRow
                      label="Cerrado"
                      value={formatDateTime(lastReport.shift.closedAt)}
                    />
                  )}
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={onViewReport}
                  className="h-9 rounded-lg border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f5f6f8]"
                >
                  Ver detalle del arqueo
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-start gap-2 py-2">
              <p className="text-[13px] text-[#6f7890]">
                Aún no hay un arqueo generado en esta sesión. Aparecerá aquí después del primer cierre.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
