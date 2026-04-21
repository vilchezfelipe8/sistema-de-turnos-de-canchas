import React from 'react';
import type { RefundRecord } from '../../../modules/refunds/refund.types';
import { formatRefundExecutionMethod, formatRefundStatus } from '../../../modules/refunds/refund.constants';
import { formatAccountCode, formatPaymentCode, formatRefundCode } from '../../../utils/displayCode';

type RefundListProps = {
  refunds: RefundRecord[];
  loading?: boolean;
  emptyText?: string;
  maxHeightClass?: string;
  actionBusyId?: string | null;
  renderActions?: (refund: RefundRecord, isBusy: boolean) => React.ReactNode;
  selectedRefundId?: string | null;
  onSelectRefund?: (refund: RefundRecord) => void;
};

export default function RefundList({
  refunds,
  loading = false,
  emptyText = 'No hay devoluciones.',
  maxHeightClass = 'max-h-56',
  actionBusyId = null,
  renderActions,
  selectedRefundId = null,
  onSelectRefund
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
        const isSelected = selectedRefundId === refund.id;
        const clickable = typeof onSelectRefund === 'function';
        return (
          <div
            key={refund.id}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={() => onSelectRefund?.(refund)}
            onKeyDown={(event) => {
              if (!clickable) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectRefund?.(refund);
              }
            }}
            className={`rounded-xl border bg-white px-3 py-3 shadow-sm transition-colors ${
              isSelected ? 'border-[#347048] ring-2 ring-[#347048]/15' : 'border-[#347048]/15'
            } ${clickable ? 'cursor-pointer hover:border-[#347048]/35' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-[#347048] truncate">
                  {formatRefundCode(refund.id, (refund as any)?.displayCode)} · ${Number(refund.amount || 0).toLocaleString()} · {formatRefundStatus(refund.status)}
                </p>
                <p className="text-[10px] font-bold text-[#347048]/60 truncate">
                  {formatRefundExecutionMethod(refund.executionMethod, (refund as any)?.paymentChannel) || 'Sin método'} · pago {formatPaymentCode(refund.paymentId)}
                </p>
                <p className="text-[10px] font-semibold text-[#347048]/55 truncate">
                  Cuenta: {refund.accountId ? formatAccountCode(refund.accountId) : 'sin cuenta'}
                </p>
                {refund.failedReason ? (
                  <p className="text-[10px] font-bold text-red-600 truncate">Fallo: {refund.failedReason}</p>
                ) : null}
              </div>
              {renderActions ? (
                <div
                  className="flex flex-wrap items-center justify-end gap-1"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {renderActions(refund, isBusy)}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
