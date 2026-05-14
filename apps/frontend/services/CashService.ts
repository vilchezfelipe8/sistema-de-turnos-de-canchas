import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export class CashService {
  static async getSummary(options?: { date?: string; startDate?: string; endDate?: string }) {
    const params = new URLSearchParams();
    if (options?.date) params.set('date', options.date);
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    const query = params.toString() ? `?${params.toString()}` : '';

    const res = await fetchWithAuth(`${apiBase()}/cash/summary${query}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar caja');
    return res.json();
  }

  static async createMovement(data: {
    amount: number | string;
    description: string;
    type: 'INCOME' | 'EXPENSE';
    method: 'CASH' | 'TRANSFER' | 'CARD';
  }) {
    const res = await fetchWithAuth(`${apiBase()}/cash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: data.amount,
        concept: data.description,
        type: data.type === 'INCOME' ? 'PAYMENT_IN' : 'WITHDRAW',
        method: data.method
      })
    });
    if (!res.ok) throw new Error('Error al crear movimiento');
    return res.json();
  }

  static async getProducts() {
    const res = await fetchWithAuth(`${apiBase()}/cash/products`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar productos');
    return res.json();
  }

  // P2-C: ítems POS unificados (productos + servicios)
  static async getPosItems(): Promise<Array<{
    type: 'product' | 'service';
    id: number;
    name: string;
    price: number;
    stock: number | null;
    category: string;
  }>> {
    const res = await fetchWithAuth(`${apiBase()}/cash/pos-items`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar ítems de venta');
    return res.json();
  }

  static async getCashRegisters() {
    const res = await fetchWithAuth(`${apiBase()}/cash-registers`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar cajas registradoras');
    return res.json();
  }

  static async getCurrentShift() {
    const res = await fetchWithAuth(`${apiBase()}/cash-shifts/current`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar turno de caja actual');
    return res.json();
  }

  static async openShift(data: { cashRegisterId: string; openingAmount: number | string }) {
    const res = await fetchWithAuth(`${apiBase()}/cash-shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cashRegisterId: data.cashRegisterId,
        openingAmount: Number(data.openingAmount)
      })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al abrir turno de caja');
    }
    return res.json();
  }

  static async closeCurrentShift(data: { countedCash: number | string }) {
    const res = await fetchWithAuth(`${apiBase()}/cash-shifts/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countedCash: Number(data.countedCash)
      })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al cerrar turno de caja');
    }
    return res.json();
  }

  static async getShiftReport(shiftId: string) {
    const res = await fetchWithAuth(`${apiBase()}/cash-shifts/${shiftId}/report`, { method: 'GET' });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al obtener reporte de cierre');
    }
    return res.json();
  }

  static async createProductSale(payload: {
    productId?: number;
    quantity?: number;
    items?: Array<{
      itemKey?: string;
      productId?: number;
      serviceId?: number;
      quantity: number;
      customName?: string;
      unitPrice?: number;
    }>;
    method: 'CASH' | 'TRANSFER' | 'CARD';
    channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
    payments?: Array<{
      method: 'CASH' | 'TRANSFER' | 'CARD';
      channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
      amount: number;
      allocations?: Array<{ itemKey?: string; productId?: number; amount: number }>;
    }>;
    userId?: number;
    clientId?: string;
    clientDraft?: {
      name: string;
      phone?: string;
      phoneCountryCode?: string;
      phoneNumberLocal?: string;
      dni?: string;
      email?: string;
      isProfessor?: boolean;
    };
  }) {
    const idempotencyKey =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? (crypto as any).randomUUID()
        : `product-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    const res = await fetchWithAuth(`${apiBase()}/cash/product-sale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al registrar venta');
    }
    return res.json();
  }

  // Fase 1.6B: Crea cuenta de venta mostrador sin cobrar.
  // El pago se registra después desde AccountDrawer.
  static async createProductSaleAccount(payload: {
    items: Array<{ productId?: number; serviceId?: number; quantity: number; customName?: string; unitPrice?: number }>;
    clientId?: string;
    idempotencyKey?: string;
  }): Promise<{ accountId: string; total: number; description: string }> {
    const idempotencyKey =
      payload.idempotencyKey ||
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? (crypto as any).randomUUID()
        : `pos-account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    const res = await fetchWithAuth(`${apiBase()}/cash/product-sale/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, idempotencyKey })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al crear la cuenta de venta');
    }
    return res.json();
  }

  static async getPosReport(params?: { startDate?: string; endDate?: string; shiftId?: string }): Promise<{
    scope: { shiftId: string | null; startDate: string; endDate: string };
    totals: {
      salesTotal: number;
      paidTotal: number;
      pendingTotal: number;
      voidedTotal: number;
      productTotal: number;
      serviceTotal: number;
    };
    byProduct: Array<{ productId: number | null; name: string; quantity: number; total: number }>;
    byService: Array<{ name: string; quantity: number; total: number }>;
    paymentsByMethod: Array<{ method: string; count: number; total: number }>;
    accounts: Array<{
      id: string;
      label: string;
      clientName: string;
      status: 'OPEN' | 'CLOSED' | 'VOIDED';
      total: number;
      paid: number;
      pending: number;
      createdAt: string;
      closedAt: string | null;
    }>;
  }> {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.shiftId) query.set('shiftId', params.shiftId);
    const res = await fetchWithAuth(`${apiBase()}/cash/pos-report${query.toString() ? `?${query}` : ''}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar reporte POS');
    return res.json();
  }

  static async quoteProductSale(payload: {
    productId?: number;
    quantity?: number;
    items?: Array<{
      itemKey?: string;
      productId?: number;
      serviceId?: number;
      quantity: number;
      customName?: string;
      unitPrice?: number;
    }>;
    clientId?: string;
    clientDraft?: {
      name: string;
      phone?: string;
      phoneCountryCode?: string;
      phoneNumberLocal?: string;
      dni?: string;
      email?: string;
      isProfessor?: boolean;
    };
  }) {
    const res = await fetchWithAuth(`${apiBase()}/cash/product-sale/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Error al cotizar venta');
    }
    return res.json();
  }
}
