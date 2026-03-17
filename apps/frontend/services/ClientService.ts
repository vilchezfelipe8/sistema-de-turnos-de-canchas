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
      email: client.email || '',
      isProfessor: Boolean(client.isProfessor),
      totalBookings: Number(client.totalBookings || 0),
      totalDebt: Number(client.totalDebt || 0),
      history: Array.isArray(client.history) ? client.history : [],
      bookings: Array.isArray(client.bookings)
        ? client.bookings
        : (Array.isArray(client.history) ? client.history : [])
    }));
  }

  static async createByClubSlug(slug: string, body: {
    name: string;
    phone?: string;
    dni?: string;
    email?: string;
    isProfessor?: boolean;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo crear el cliente');
    }
    return res.json();
  }

  static async updateByClubSlug(slug: string, clientId: string, body: {
    name: string;
    phone?: string;
    dni?: string;
    email?: string;
    isProfessor?: boolean;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo actualizar el cliente');
    }
    return res.json();
  }

  static async deleteByClubSlug(slug: string, clientId: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo eliminar el cliente');
    }
    return true;
  }
}
