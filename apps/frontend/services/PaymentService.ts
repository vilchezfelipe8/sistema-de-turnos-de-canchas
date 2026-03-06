import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type PaymentStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'DEBT';

export class PaymentService {
  static async list(params?: {
    bookingId?: number;
    userId?: number;
    status?: PaymentStatus;
    method?: string;
    from?: string;
    to?: string;
    take?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.bookingId) query.set('bookingId', String(params.bookingId));
    if (params?.userId) query.set('userId', String(params.userId));
    if (params?.status) query.set('status', params.status);
    if (params?.method) query.set('method', params.method);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.take) query.set('take', String(params.take));

    const res = await fetchWithAuth(`${apiBase()}/payments?${query.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar pagos');
    return res.json();
  }

  static async create(payload: {
    amount: number;
    method: string;
    status?: PaymentStatus;
    bookingId?: number;
    userId?: number;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al crear pago');
    return res.json();
  }

  static async updateStatus(id: string, status: PaymentStatus) {
    const res = await fetchWithAuth(`${apiBase()}/payments/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Error al actualizar pago');
    return res.json();
  }
}
