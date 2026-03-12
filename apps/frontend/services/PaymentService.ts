import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'READY_TO_EXECUTE' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
export type RefundExecutionMethod = 'CASH' | 'TRANSFER' | 'CARD_REVERSAL' | 'MP_REFUND' | 'CREDIT_NOTE' | 'OTHER';
export type RefundReasonType = 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER';

export type RefundRecord = {
  id: string;
  createdAt: string;
  amount: number;
  reason: string | null;
  reasonType: RefundReasonType;
  status: RefundStatus;
  executionMethod: RefundExecutionMethod | null;
  paymentId: string;
  accountId: string;
  clubId: number;
  cashShiftId: string | null;
  createdByUserId: number | null;
  approvedAt: string | null;
  approvedByUserId: number | null;
  executedAt: string | null;
  executedByUserId: number | null;
  cancelledAt: string | null;
  cancelledByUserId: number | null;
  cancelReason: string | null;
  executionReference: string | null;
  executionNotes: string | null;
  failedAt: string | null;
  failedReason: string | null;
};

async function parseError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return data?.error || data?.message || fallback;
  } catch {
    return fallback;
  }
}

export const listPendingRefunds = async (take = 50): Promise<RefundRecord[]> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/pending?take=${encodeURIComponent(String(take))}`, {
    method: 'GET'
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudieron listar devoluciones pendientes'));
  }
  return res.json();
};

export const listRefunds = async (filters?: {
  status?: RefundStatus[];
  paymentId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  take?: number;
}): Promise<RefundRecord[]> => {
  const params = new URLSearchParams();
  if (filters?.status?.length) params.set('status', filters.status.join(','));
  if (filters?.paymentId) params.set('paymentId', filters.paymentId);
  if (filters?.accountId) params.set('accountId', filters.accountId);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.take) params.set('take', String(filters.take));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds${query}`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudieron listar devoluciones'));
  }
  return res.json();
};

export const requestPaymentRefund = async (
  paymentId: string,
  body: {
    amount: number;
    reason?: string;
    reasonType?: RefundReasonType;
    executionMethod?: RefundExecutionMethod;
    executionNotes?: string;
    executeNow?: boolean;
    cashShiftId?: string;
  }
): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/${paymentId}/refunds/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo solicitar devolucion'));
  }
  return res.json();
};

export const approveRefund = async (
  refundId: string,
  body?: { executeNow?: boolean; cashShiftId?: string; executionReference?: string; executionNotes?: string }
): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/${refundId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo aprobar devolucion'));
  }
  return res.json();
};

export const executeRefund = async (
  refundId: string,
  body?: { cashShiftId?: string; executionReference?: string; executionNotes?: string }
): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/${refundId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo ejecutar devolucion'));
  }
  return res.json();
};

export const retryRefund = async (
  refundId: string,
  body?: { executeNow?: boolean; cashShiftId?: string; executionReference?: string; executionNotes?: string }
): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/${refundId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo reintentar devolucion'));
  }
  return res.json();
};

export const cancelRefund = async (refundId: string, reason: string): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/${refundId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo cancelar devolucion'));
  }
  return res.json();
};

export const failRefund = async (refundId: string, reason: string): Promise<RefundRecord> => {
  const res = await fetchWithAuth(`${apiBase()}/payments/refunds/${refundId}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  if (!res.ok) {
    throw new Error(await parseError(res, 'No se pudo marcar devolucion fallida'));
  }
  return res.json();
};
