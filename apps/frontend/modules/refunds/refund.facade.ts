import {
  approveRefund,
  cancelRefund,
  executeRefund,
  failRefund,
  listPendingRefunds,
  listRefunds,
  requestPaymentRefund,
  retryRefund
} from '../../services/PaymentService';
import type { RefundDraft, RefundRecord } from './refund.types';

export async function loadAccountRefunds(accountId: string): Promise<RefundRecord[]> {
  const data = await listRefunds({ accountId, take: 100 });
  return Array.isArray(data) ? data : [];
}

export async function loadRefundInbox(take = 100): Promise<RefundRecord[]> {
  const data = await listRefunds({ take });
  return Array.isArray(data) ? data : [];
}

export async function searchRefunds(filters?: {
  status?: Array<'REQUESTED' | 'APPROVED' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'FAILED' | 'CANCELLED'>;
  paymentId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  take?: number;
}): Promise<RefundRecord[]> {
  const data = await listRefunds(filters);
  return Array.isArray(data) ? data : [];
}

export async function loadPendingRefundQueue(take = 50): Promise<RefundRecord[]> {
  const data = await listPendingRefunds(take);
  return Array.isArray(data) ? data : [];
}

export async function requestManualRefund(paymentId: string, draft: RefundDraft, maxAmount: number, reason?: string): Promise<RefundRecord> {
  const parsedAmount = Number(draft.amountInput);
  const boundedAmount = Number.isFinite(parsedAmount)
    ? Math.max(0, Math.min(parsedAmount, Number(maxAmount || 0)))
    : 0;

  return requestPaymentRefund(paymentId, {
    amount: Number(boundedAmount.toFixed(2)),
    reasonType: draft.reasonType,
    reason: reason || 'Devolucion solicitada desde administracion',
    executionMethod: 'CASH',
    executionNotes: draft.executionNotes.trim() || undefined,
    executeNow: draft.executeNow
  });
}

export const refundActions = {
  approve: (refundId: string, executeNow = false) => approveRefund(refundId, { executeNow }),
  execute: (refundId: string) => executeRefund(refundId),
  retry: (refundId: string, executeNow = true) => retryRefund(refundId, { executeNow }),
  fail: (refundId: string, reason = 'Fallo manual informado por administrador') => failRefund(refundId, reason),
  cancel: (refundId: string, reason = 'Cancelada por administrador') => cancelRefund(refundId, reason)
};
