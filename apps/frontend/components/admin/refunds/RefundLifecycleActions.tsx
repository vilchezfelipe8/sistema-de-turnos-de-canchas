import React from 'react';
import type { RefundActionHandlers, RefundStatus } from '../../../modules/refunds/refund.types';

type RefundLifecycleActionsProps = {
  status?: RefundStatus | string;
  disabled?: boolean;
  handlers: RefundActionHandlers;
};

export default function RefundLifecycleActions({ status, disabled = false, handlers }: RefundLifecycleActionsProps) {
  if (!status) return null;

  if (status === 'REQUESTED') {
    return (
      <>
        <button
          type="button"
          disabled={disabled || !handlers.onApprove}
          onClick={() => handlers.onApprove?.(false)}
          className="rounded-lg bg-[#347048] text-[#EBE1D8] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Aprobar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onApprove}
          onClick={() => handlers.onApprove?.(true)}
          className="rounded-lg bg-[#926699] text-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Aprobar + ejecutar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-red-200 bg-red-50/50 text-red-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Cancelar
        </button>
      </>
    );
  }

  if (status === 'APPROVED' || status === 'READY_TO_EXECUTE') {
    return (
      <>
        <button
          type="button"
          disabled={disabled || !handlers.onExecute}
          onClick={() => handlers.onExecute?.()}
          className="rounded-lg bg-[#347048] text-[#EBE1D8] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Ejecutar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onFail}
          onClick={() => handlers.onFail?.()}
          className="rounded-lg border border-[#926699]/35 bg-[#926699]/5 text-[#926699] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Marcar fallida
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-red-200 bg-red-50/50 text-red-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Cancelar
        </button>
      </>
    );
  }

  if (status === 'FAILED') {
    return (
      <>
        <button
          type="button"
          disabled={disabled || !handlers.onRetry}
          onClick={() => handlers.onRetry?.(true)}
          className="rounded-lg bg-[#926699] text-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Reintentar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-red-200 bg-red-50/50 text-red-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Cancelar
        </button>
      </>
    );
  }

  return null;
}
