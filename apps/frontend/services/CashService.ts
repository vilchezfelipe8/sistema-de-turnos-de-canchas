import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export class CashService {
  static async getSummary() {
    const res = await fetchWithAuth(`${apiBase()}/cash/summary`, { method: 'GET' });
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
    productId: number;
    quantity: number;
    method: 'CASH' | 'TRANSFER' | 'CARD';
    channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
    payments?: Array<{ method: 'CASH' | 'TRANSFER' | 'CARD'; channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'; amount: number }>;
    userId?: number;
    clientId?: string;
    createClientIfMissing?: boolean;
    guestName?: string;
    guestPhone?: string;
    guestDni?: string;
    guestEmail?: string;
    guestIsProfessor?: boolean;
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
}
