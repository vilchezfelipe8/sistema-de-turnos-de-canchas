import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { getActiveClubSlug, normalizeSessionUser } from '../utils/session';

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

  static async listDebtors(clubSlug?: string) {
    const slug = clubSlug || getActiveClubSlug(normalizeSessionUser(null));
    if (!slug) return [];

    const res = await fetchWithAuth(
      `${apiBase()}/clients/${encodeURIComponent(slug)}`,
      { method: 'GET' }
    );

    if (!res.ok) return [];

    const rows = await res.json();
    if (!Array.isArray(rows)) return [];

    return rows.map((client: any) => ({
      id: client.id,
      name: [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || client.firstName || 'Sin nombre',
      phone: client.phoneNumber || '',
      dni: client.dni || '-',
      totalBookings: Number(client.totalBookings || 0),
      totalDebt: Number(client.totalDebt || 0),
      history: Array.isArray(client.history) ? client.history : [],
      bookings: Array.isArray(client.bookings)
        ? client.bookings
        : (Array.isArray(client.history) ? client.history : [])
    }));
  }
}
