import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type CourtPriceRule = {
  id: number;
  courtId: number;
  clubId: number;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  price: number;
  createdAt: string;
};

export class CourtPriceRuleService {
  static async list(courtId?: number): Promise<CourtPriceRule[]> {
    const query = new URLSearchParams();
    if (courtId) query.set('courtId', String(courtId));
    const res = await fetchWithAuth(`${apiBase()}/court-price-rules?${query.toString()}`, {
      method: 'GET'
    });
    if (!res.ok) throw new Error('Error al cargar reglas de precio');
    return res.json();
  }

  static async create(payload: {
    courtId: number;
    dayOfWeek: number;
    startMinutes: number;
    endMinutes: number;
    price: number;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/court-price-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al crear regla de precio');
    return res.json();
  }

  static async update(id: number, payload: Partial<{
    dayOfWeek: number;
    startMinutes: number;
    endMinutes: number;
    price: number;
  }>) {
    const res = await fetchWithAuth(`${apiBase()}/court-price-rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al actualizar regla de precio');
    return res.json();
  }

  static async remove(id: number) {
    const res = await fetchWithAuth(`${apiBase()}/court-price-rules/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar regla de precio');
    return res.json();
  }
}
