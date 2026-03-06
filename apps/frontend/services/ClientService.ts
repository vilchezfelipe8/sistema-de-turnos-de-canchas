import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export class ClientService {
  static async searchByClubSlug(slug: string, query: string) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`,
      { method: 'GET' }
    );

    if (!res.ok) return [];
    return res.json();
  }

  static async listDebtors() {
    const res = await fetchWithAuth(`${apiBase()}/bookings/debtors/list`, { method: 'GET' });
    if (!res.ok) throw new Error('Error cargando deudores');
    return res.json();
  }
}
