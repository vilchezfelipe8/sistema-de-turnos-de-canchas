import React from 'react';
import type { RefundRecord } from '../../../modules/refunds/refund.types';
import { formatRefundExecutionMethod, formatRefundStatus } from '../../../modules/refunds/refund.constants';

type RefundListProps = {
  refunds: RefundRecord[];
  loading?: boolean;
  emptyText?: string;
  maxHeightClass?: string;
  actionBusyId?: string | null;
  renderActions?: (refund: RefundRecord, isBusy: boolean) => React.ReactNode;
};

export default function RefundList({
  refunds,
  loading = false,
  emptyText = 'No hay devoluciones.',
  maxHeightClass = 'max-h-56',
  actionBusyId = null,
  renderActions
}: RefundListProps) {
  if (loading) {
    return <div className="rounded-xl border border-[#347048]/10 bg-white/80 px-3 py-4 text-xs font-bold text-[#347048]/60">Cargando devoluciones...</div>;
  }

  if (!refunds.length) {
    return <div className="rounded-xl border border-[#347048]/10 bg-white/80 px-3 py-4 text-xs font-bold text-[#347048]/50">{emptyText}</div>;
  }

  return (
    <div className={`space-y-2 overflow-y-auto pr-1 ${maxHeightClass}`}>
      {refunds.map((refund) => {
        const isBusy = actionBusyId === refund.id;
        return (
          <div key={refund.id} className="rounded-xl border border-[#347048]/15 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-[#347048] truncate">
                  ${Number(refund.amount || 0).toLocaleString()} · {formatRefundStatus(refund.status)}
                </p>
                <p className="text-[10px] font-bold text-[#347048]/60 truncate">
                  {formatRefundExecutionMethod(refund.executionMethod) || 'Sin metodo'} · pago {refund.paymentId}
                </p>
                <p className="text-[10px] font-semibold text-[#347048]/55 truncate">
                  Cuenta: {refund.accountId || 'sin cuenta'}
                </p>
                {refund.failedReason ? (
                  <p className="text-[10px] font-bold text-red-600 truncate">Fallo: {refund.failedReason}</p>
                ) : null}
              </div>
              {renderActions ? (
                <div className="flex flex-wrap items-center justify-end gap-1">{renderActions(refund, isBusy)}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
