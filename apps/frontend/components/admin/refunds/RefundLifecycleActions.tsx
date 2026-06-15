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
          className="rounded-lg bg-lima-700 text-ink-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Aprobar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onApprove}
          onClick={() => handlers.onApprove?.(true)}
          className="rounded-lg bg-p-accent text-ink-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Aprobar + ejecutar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-p-error bg-p-error-bg/50 text-p-error px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
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
          className="rounded-lg bg-lima-700 text-ink-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Ejecutar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onFail}
          onClick={() => handlers.onFail?.()}
          className="rounded-lg border border-p-accent bg-p-accent/5 text-p-accent px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Marcar fallida
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-p-error bg-p-error-bg/50 text-p-error px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
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
          className="rounded-lg bg-p-accent text-ink-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Reintentar
        </button>
        <button
          type="button"
          disabled={disabled || !handlers.onCancel}
          onClick={() => handlers.onCancel?.()}
          className="rounded-lg border border-p-error bg-p-error-bg/50 text-p-error px-2.5 py-1 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          Cancelar
        </button>
      </>
    );
  }

  return null;
}
