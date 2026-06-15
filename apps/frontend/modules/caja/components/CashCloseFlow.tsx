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
    <div className="flex items-baseline justify-between gap-4 border-b border-p-border py-2 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
        {label}
      </span>
      <span className="text-right text-[13px] font-medium text-p-text">{value}</span>
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
      <div className="flex flex-col rounded-xl border border-p-border bg-p-surface">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-p-border px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-p-text">Estado del turno</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              shift
                ? 'border border-p-positive bg-p-positive-bg text-[var(--positive-fg)]'
                : 'border border-p-border bg-p-surface-2 text-p-text-muted'
            }`}
          >
            {shift ? 'Caja abierta' : 'Caja cerrada'}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          {shift ? (
            <>
              {/* Datos del turno */}
              <div className="rounded-xl border border-p-border bg-p-surface-2 px-4 py-1">
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

              <p className="text-[12px] text-p-text-muted">
                Registrá el efectivo contado para generar el arqueo y cerrar el turno.
              </p>

              <div>
                <button
                  type="button"
                  onClick={onCloseShift}
                  className="h-9 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800"
                >
                  Cerrar caja
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-start gap-3 py-2">
              <p className="text-[13px] text-p-text-muted">
                No hay ningún turno activo en este momento. Abrí caja desde la pestaña Resumen para iniciar la operación.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Panel derecho: Último arqueo ── */}
      <div className="flex flex-col rounded-xl border border-p-border bg-p-surface">

        {/* Header */}
        <div className="border-b border-p-border px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-p-text">Último arqueo</h2>
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          {lastReport ? (
            <>
              {/* Tres métricas de arqueo */}
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-p-border bg-p-border">
                {[
                  {
                    label: 'Esperado',
                    value: formatMoney(lastReport.expectedCash),
                    color: 'text-p-text',
                  },
                  {
                    label: 'Contado',
                    value: formatMoney(lastReport.countedCash),
                    color: 'text-p-text',
                  },
                  {
                    label: 'Diferencia',
                    value: `${diffPositive ? '+' : '−'}${formatMoney(Math.abs(diff))}`,
                    color: diffPositive ? 'text-[var(--positive-fg)]' : 'text-[var(--error-fg)]',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-p-surface px-3 py-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-p-text-muted">
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
                <div className="rounded-xl border border-p-border bg-p-surface-2 px-4 py-1">
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
                  className="h-9 rounded-lg border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
                >
                  Ver detalle del arqueo
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-start gap-2 py-2">
              <p className="text-[13px] text-p-text-muted">
                Aún no hay un arqueo generado en esta sesión. Aparecerá aquí después del primer cierre.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
