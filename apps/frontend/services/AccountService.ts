import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { getPaymentIdempotencyKey } from '../utils/paymentIdempotency';

const apiBase = () => `${getApiUrl()}/api`;

const humanizeAccountItemValidationError = (payload: any) => {
  const rawError = payload?.error;
  if (!rawError || typeof rawError !== 'object') return '';

  const fieldMap: Record<string, string> = {
    description: 'Ingresa una descripcion.',
    quantity: 'La cantidad debe ser mayor a 0.',
    unitPrice: 'El precio unitario debe ser mayor a 0.',
    type: 'Selecciona un tipo de concepto valido.'
  };

  const fieldEntries = Object.entries(rawError).filter(([key]) => key !== '_errors');
  for (const [field, detail] of fieldEntries) {
    if (fieldMap[field]) {
      return fieldMap[field];
    }
    const fieldErrors = Array.isArray((detail as any)?._errors) ? (detail as any)._errors : [];
    if (fieldErrors.length > 0 && typeof fieldErrors[0] === 'string') {
      return `${field}: ${fieldErrors[0]}`;
    }
  }

  const rootErrors = Array.isArray((rawError as any)?._errors) ? (rawError as any)._errors : [];
  if (rootErrors.length > 0 && typeof rootErrors[0] === 'string') {
    return rootErrors[0];
  }

  return '';
};

export type AccountSource = 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT';
export type AccountStatus = 'OPEN' | 'CLOSED';
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
export type PaymentChannel = 'AUTO' | 'CASH_DRAWER' | 'BANK_ACCOUNT' | 'CARD_TERMINAL' | 'VIRTUAL_WALLET' | 'OTHER';
export type PaymentSource = 'POS' | 'ONLINE' | 'BACKOFFICE';

export const listAccounts = async (filters?: { status?: AccountStatus; bookingId?: number }) => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.bookingId) params.set('bookingId', String(filters.bookingId));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetchWithAuth(`${apiBase()}/accounts${query}`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudieron listar las cuentas');
  }
  return res.json();
};

export const openAccount = async (body: { sourceType: AccountSource; sourceId: string }) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo abrir la cuenta');
  }
  return res.json();
};

export const getAccountById = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo obtener la cuenta');
  }
  return res.json();
};

export const getAccountSummary = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/summary`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo obtener el resumen de la cuenta');
  }
  return res.json();
};

export const getAccountBalance = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/balance`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo obtener el balance de la cuenta');
  }
  return res.json();
};

export const getAccountLedger = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/ledger`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo obtener el ledger de la cuenta');
  }
  return res.json();
};

export const getOrCreateBookingAccount = async (bookingId: number) => {
  const found = await listAccounts({ bookingId });
  if (Array.isArray(found) && found.length > 0) return found[0];
  return openAccount({ sourceType: 'BOOKING', sourceId: String(bookingId) });
};

export const addAccountItem = async (accountId: string, body: {
  description: string;
  quantity: number;
  unitPrice: number;
  type?: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  productId?: number;
  serviceCode?: string;
  applyDiscount?: boolean;
}) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json();
    const validationMessage = humanizeAccountItemValidationError(error);
    throw new Error(validationMessage || error.error || 'No se pudo agregar el consumo');
  }
  return res.json();
};

export const registerPayment = async (body: {
  accountId: string;
  amount: number;
  method: PaymentMethod;
  channel?: PaymentChannel;
  collectorAccountLabel?: string;
  externalReference?: string;
  source?: PaymentSource;
  cashShiftId?: string;
  payerParticipantRef?: string;
  payerParticipantName?: string;
  coveredParticipantRef?: string;
  coveredParticipantName?: string;
  allocations?: Array<{ accountItemId: string; amount: number }>;
}) => {
  if (body.method === 'TRANSFER' && body.channel !== 'BANK_ACCOUNT' && body.channel !== 'VIRTUAL_WALLET') {
    throw new Error('El canal es obligatorio para pagos por transferencia');
  }

  const idempotencyKey = getPaymentIdempotencyKey({
    accountId: body.accountId,
    amount: body.amount,
    method: body.method,
    channel: body.channel,
    collectorAccountLabel: body.collectorAccountLabel,
    externalReference: body.externalReference,
    source: body.source,
    cashShiftId: body.cashShiftId,
    payerParticipantRef: body.payerParticipantRef,
    payerParticipantName: body.payerParticipantName,
    coveredParticipantRef: body.coveredParticipantRef,
    coveredParticipantName: body.coveredParticipantName,
    allocations: body.allocations
  });
  const res = await fetchWithAuth(`${apiBase()}/accounts/${body.accountId}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      amount: body.amount,
      method: body.method,
      channel: body.channel,
      collectorAccountLabel: body.collectorAccountLabel,
      externalReference: body.externalReference,
      source: body.source ?? 'POS',
      cashShiftId: body.cashShiftId,
      payerParticipantRef: body.payerParticipantRef,
      payerParticipantName: body.payerParticipantName,
      coveredParticipantRef: body.coveredParticipantRef,
      coveredParticipantName: body.coveredParticipantName,
      allocations: body.allocations
    })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo registrar el pago');
  }
  return res.json();
};

export const closeAccount = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const error = await res.json();
    const closeError = new Error(error.error || 'No se pudo cerrar la cuenta') as Error & {
      code?: string;
      remaining?: number;
    };
    if (typeof error?.code === 'string') {
      closeError.code = error.code;
    }
    if (Number.isFinite(Number(error?.remaining))) {
      closeError.remaining = Number(error.remaining);
    }
    throw closeError;
  }
  return res.json();
};

// P2-B: Anular venta de mostrador — restaura stock
export const voidPosAccount = async (accountId: string) => {
  const res = await fetchWithAuth(`${apiBase()}/accounts/${accountId}/void-pos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo anular la cuenta');
  }
  return res.json();
};

export const createCashMovement = async (body: { type: 'PAYMENT_IN' | 'REFUND' | 'WITHDRAW' | 'DEPOSIT'; amount: number; method: 'CASH' | 'TRANSFER' | 'CARD'; concept: string }) => {
  const res = await fetchWithAuth(`${apiBase()}/cash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'No se pudo registrar el movimiento de caja');
  }
  return res.json();
};
