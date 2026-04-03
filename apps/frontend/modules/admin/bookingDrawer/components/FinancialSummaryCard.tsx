import type { ChargeMode, FinancialSummary } from '../types';

type Props = {
  summary: FinancialSummary;
  chargeMode: ChargeMode;
  chargeResponsibleName?: string;
  warnings?: string[];
  onRegisterPayment?: () => void;
  onCollectRemaining?: () => void;
};

export default function FinancialSummaryCard({
  summary,
  chargeMode,
  chargeResponsibleName,
  warnings = [],
  onRegisterPayment,
  onCollectRemaining,
}: Props) {
  const paymentStatusLabel =
    summary.paymentStatus === 'PAID'
      ? 'Pagada'
      : summary.paymentStatus === 'PARTIAL'
        ? 'Parcial'
        : 'Sin pago';

  const paymentStatusTone =
    summary.paymentStatus === 'PAID'
      ? 'bg-[#e9f8ec] text-[#16733f]'
      : summary.paymentStatus === 'PARTIAL'
        ? 'bg-[#fff4e5] text-[#9a5a00]'
        : 'bg-[#eef1f7] text-[#5c667f]';

  return (
    <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#2e3650]">Resumen de cobro</p>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white border border-[#dbe2ef] px-2 py-0.5 text-[11px] text-[#5c667f]">
            {chargeMode === 'INDIVIDUAL' ? 'Individual' : 'Compartida'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${paymentStatusTone}`}>
            {paymentStatusLabel}
          </span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div className="rounded-lg bg-white border border-[#e2e7f1] px-2 py-1.5">
          <p className="text-[#7a8398]">Total</p>
          <p className="font-semibold text-[#2a3348]">{summary.totalAmount.toFixed(2)} $</p>
        </div>
        <div className="rounded-lg bg-white border border-[#e2e7f1] px-2 py-1.5">
          <p className="text-[#7a8398]">Pagado</p>
          <p className="font-semibold text-[#1c7a44]">{summary.paidAmount.toFixed(2)} $</p>
        </div>
        <div className="rounded-lg bg-white border border-[#e2e7f1] px-2 py-1.5">
          <p className="text-[#7a8398]">Restante</p>
          <p className="font-semibold text-[#9a5a00]">{summary.remainingAmount.toFixed(2)} $</p>
        </div>
      </div>
      {chargeMode === 'INDIVIDUAL' && (
        <p className="mt-2 text-[12px] text-[#5c667f]">
          Responsable del cobro: <strong>{chargeResponsibleName || '-'}</strong>
        </p>
      )}
      {warnings.length > 0 && (
        <p className="mt-2 text-[11px] text-[#b42346]">
          Hay {warnings.length} advertencia{warnings.length === 1 ? '' : 's'} de consistencia para revisar.
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onRegisterPayment && (
          <button
            type="button"
            onClick={onRegisterPayment}
            className="h-8 rounded-lg border border-[#dbe2ef] bg-white px-3 text-[12px] font-semibold text-[#2f53df]"
          >
            Registrar pago
          </button>
        )}
        {onCollectRemaining && summary.remainingAmount > 0.009 && (
          <button
            type="button"
            onClick={onCollectRemaining}
            className="h-8 rounded-lg bg-[#3053e2] px-3 text-[12px] font-semibold text-white"
          >
            Agregar saldo
          </button>
        )}
      </div>
    </div>
  );
}
