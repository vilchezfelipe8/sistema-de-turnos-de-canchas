import type { RefundExecutionMethod, RefundReasonType, RefundStatus } from './refund.types';

export const REFUND_REASON_OPTIONS: Array<{ value: RefundReasonType; label: string }> = [
  { value: 'FULL', label: 'Total' },
  { value: 'PARTIAL_COMMERCIAL', label: 'Parcial comercial' },
  { value: 'PARTIAL_SERVICE_FAILURE', label: 'Parcial por falla del servicio' },
  { value: 'PARTIAL_PRICING_ERROR', label: 'Parcial por error de precio' },
  { value: 'OTHER', label: 'Otro' }
];

const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Solicitada',
  APPROVED: 'Aprobada',
  READY_TO_EXECUTE: 'Lista para ejecutar',
  EXECUTED: 'Ejecutada',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada'
};

const REFUND_EXECUTION_METHOD_LABELS: Partial<Record<RefundExecutionMethod | 'CASH' | 'TRANSFER' | 'CARD' | 'POS' | 'ONLINE' | 'BACKOFFICE', string>> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  CARD_REVERSAL: 'Reversa de tarjeta',
  CREDIT_NOTE: 'Nota de crédito',
  OTHER: 'Otro',
  POS: 'Mostrador (POS)',
  ONLINE: 'En línea',
  BACKOFFICE: 'Administración'
};

export function formatRefundStatus(status?: string | null): string {
  if (!status) return '-';
  return REFUND_STATUS_LABELS[status as RefundStatus] || status;
}

export function formatRefundReasonType(reasonType?: string | null): string {
  if (!reasonType) return '-';
  const found = REFUND_REASON_OPTIONS.find((opt) => opt.value === reasonType);
  return found?.label || reasonType;
}

export function formatRefundExecutionMethod(method?: string | null, paymentChannel?: string | null): string {
  if (!method) return '-';
  if (method === 'TRANSFER' && paymentChannel === 'VIRTUAL_WALLET') {
    return 'Billetera virtual';
  }
  return REFUND_EXECUTION_METHOD_LABELS[method as keyof typeof REFUND_EXECUTION_METHOD_LABELS] || method;
}
