import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export class EventService {
  static async list(params?: { processed?: boolean; type?: string; take?: number }) {
    const query = new URLSearchParams();
    if (params?.processed !== undefined) query.set('processed', String(params.processed));
    if (params?.type) query.set('type', params.type);
    if (params?.take) query.set('take', String(params.take));

    const res = await fetchWithAuth(`${apiBase()}/events?${query.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar eventos');
    return res.json();
  }

  static async create(type: string, payload: Record<string, any>) {
    const res = await fetchWithAuth(`${apiBase()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload })
    });
    if (!res.ok) throw new Error('Error al crear evento');
    return res.json();
  }

  static async processPending(batchSize = 50) {
    const res = await fetchWithAuth(`${apiBase()}/events/process-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSize })
    });
    if (!res.ok) throw new Error('Error al procesar eventos');
    return res.json();
  }
}
