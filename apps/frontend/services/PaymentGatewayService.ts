import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api/payment-gateways`;

type PaymentProvider = 'MERCADOPAGO' | 'BANK_TRANSFER' | 'MANUAL_POS' | 'OTHER';
type ProviderAccountStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR';
type GatewayTransactionStatus = 'PENDING' | 'IN_PROCESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED' | 'FAILED';
type FiscalDocumentStatus = 'PENDING' | 'PROCESSING' | 'AUTHORIZED' | 'REJECTED' | 'CANCELLED' | 'FAILED';
type FiscalDocumentType = 'INVOICE_B' | 'INVOICE_C' | 'CREDIT_NOTE_B' | 'CREDIT_NOTE_C' | 'DEBIT_NOTE_B' | 'DEBIT_NOTE_C' | 'RECEIPT_X';

export type PaymentProviderAccount = {
  id: string;
  createdAt: string;
  updatedAt: string;
  clubId: number;
  provider: PaymentProvider;
  status: ProviderAccountStatus;
  displayName: string;
  isDefault: boolean;
  externalMerchantId: string | null;
  accountAlias: string | null;
  accountCbu: string | null;
  accountCvu: string | null;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type GatewayTransaction = {
  id: string;
  createdAt: string;
  updatedAt: string;
  clubId: number;
  providerAccountId: string | null;
  provider: PaymentProvider;
  type: 'PAYMENT' | 'REFUND' | 'CHARGEBACK' | 'REVERSAL';
  status: GatewayTransactionStatus;
  externalId: string;
  externalReference: string | null;
  amount: number;
  netAmount: number | null;
  feeAmount: number | null;
  currency: string;
  paymentId: string | null;
  refundId: string | null;
  occurredAt: string | null;
  settledAt: string | null;
  reconciliationNotes: string | null;
};

export type FiscalDocument = {
  id: string;
  createdAt: string;
  updatedAt: string;
  clubId: number;
  accountId: string | null;
  provider: 'ARCA' | 'MANUAL' | 'OTHER';
  type: FiscalDocumentType;
  status: FiscalDocumentStatus;
  pointOfSale: number | null;
  documentNumber: number | null;
  cae: string | null;
  caeExpiresAt: string | null;
  authorizedAt: string | null;
  totalAmount: number;
  currency: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  lastAttemptAt: string | null;
};

async function parseError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return data?.error || data?.message || fallback;
  } catch {
    return fallback;
  }
}

export class PaymentGatewayService {
  static async listProviderAccounts(): Promise<PaymentProviderAccount[]> {
    const res = await fetchWithAuth(`${apiBase()}/provider-accounts`, { method: 'GET' });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las cuentas proveedoras'));
    return res.json();
  }

  static async createProviderAccount(payload: {
    provider: PaymentProvider;
    displayName: string;
    externalMerchantId?: string;
    accountAlias?: string;
    accountCbu?: string;
    accountCvu?: string;
    webhookSecretEncrypted?: string;
    isDefault?: boolean;
  }): Promise<PaymentProviderAccount> {
    const res = await fetchWithAuth(`${apiBase()}/provider-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear la cuenta proveedora'));
    return res.json();
  }

  static async updateProviderAccountStatus(providerAccountId: string, payload: {
    status: ProviderAccountStatus;
    isDefault?: boolean;
  }): Promise<PaymentProviderAccount> {
    const res = await fetchWithAuth(`${apiBase()}/provider-accounts/${providerAccountId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudo actualizar la cuenta proveedora'));
    return res.json();
  }

  static async getMercadoPagoOAuthStartUrl(providerAccountId?: string): Promise<{ authorizationUrl: string; state: string }> {
    const query = providerAccountId ? `?providerAccountId=${encodeURIComponent(providerAccountId)}` : '';
    const res = await fetchWithAuth(`${apiBase()}/oauth/mercadopago/start${query}`, { method: 'GET' });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudo iniciar OAuth de Mercado Pago'));
    return res.json();
  }

  static async listGatewayTransactions(filters?: {
    providerAccountId?: string;
    status?: GatewayTransactionStatus;
    paymentId?: string;
    refundId?: string;
    take?: number;
  }): Promise<GatewayTransaction[]> {
    const params = new URLSearchParams();
    if (filters?.providerAccountId) params.set('providerAccountId', filters.providerAccountId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.paymentId) params.set('paymentId', filters.paymentId);
    if (filters?.refundId) params.set('refundId', filters.refundId);
    if (filters?.take) params.set('take', String(filters.take));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithAuth(`${apiBase()}/transactions${query}`, { method: 'GET' });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudieron listar transacciones'));
    return res.json();
  }

  static async reprocessMercadoPagoTransaction(externalId: string, payload: {
    providerAccountId: string;
    paymentIdHint?: string;
  }): Promise<{ status: string; transaction: GatewayTransaction }> {
    const res = await fetchWithAuth(`${apiBase()}/reprocess/mercadopago/${encodeURIComponent(externalId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudo reprocesar la transaccion'));
    return res.json();
  }

  static async listFiscalDocuments(filters?: {
    paymentId?: string;
    refundId?: string;
    status?: FiscalDocumentStatus;
    take?: number;
  }): Promise<FiscalDocument[]> {
    const params = new URLSearchParams();
    if (filters?.paymentId) params.set('paymentId', filters.paymentId);
    if (filters?.refundId) params.set('refundId', filters.refundId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.take) params.set('take', String(filters.take));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithAuth(`${apiBase()}/fiscal-documents${query}`, { method: 'GET' });
    if (!res.ok) throw new Error(await parseError(res, 'No se pudieron listar documentos fiscales'));
    return res.json();
  }
}
