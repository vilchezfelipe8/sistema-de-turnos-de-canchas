import { fetchWithAuth } from '../utils/apiClient';
import { throwApiErrorFromResponse } from '../utils/apiError';
import { getApiUrl } from '../utils/apiUrl';
import { getActiveClubSlug, normalizeSessionUser } from '../utils/session';

const apiBase = () => `${getApiUrl()}/api`;

export type ClientIdentityAuditEntry = {
  id: string;
  action: string;
  kind: string;
  kindLabel: string;
  sourceLabel: string | null;
  summary: string;
  createdAt: string;
  actorUser: {
    id: number;
    displayName: string;
    email: string | null;
  } | null;
  payload: Record<string, any> | null;
};

export class ClientService {
  static async getIdentityOverviewByClubSlug(slug: string, clientId: string) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}/identity-overview`,
      { method: 'GET' }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo cargar el estado de identidad del cliente');
    }
    return res.json();
  }

  static async getIdentityAuditByClubSlug(slug: string, clientId: string, take = 12): Promise<ClientIdentityAuditEntry[]> {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}/identity-audit?take=${encodeURIComponent(String(take))}`,
      { method: 'GET' }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo cargar la auditoría de identidad');
    }
    const payload = await res.json();
    return Array.isArray(payload?.entries) ? payload.entries : [];
  }

  static async createIdentityIncidentByClubSlug(slug: string, clientId: string, body?: { note?: string }) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}/identity-incident`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: body?.note || '' })
      }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo marcar el caso para revisión');
    }
    return res.json();
  }

  static async searchByClubSlug(slug: string, query: string) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients-list?q=${encodeURIComponent(query)}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo buscar clientes');
    }
    const payload = await res.json();
    if (!Array.isArray(payload)) {
      throw new Error('Respuesta inválida: clients-list debe devolver un arreglo');
    }
    return payload;
  }

  static async listDebtors(
    clubSlug?: string,
    options?: {
      scope?: 'all' | 'debt_open';
    }
  ) {
    const slug = clubSlug || getActiveClubSlug(normalizeSessionUser(null));
    if (!slug) return [];
    const scope = options?.scope === 'debt_open' ? 'debt_open' : 'all';

    const res = await fetchWithAuth(
      `${apiBase()}/clients/${encodeURIComponent(slug)}?scope=${encodeURIComponent(scope)}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo obtener clientes');
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) {
      throw new Error('Respuesta inválida: /clients debe devolver un arreglo');
    }

    return rows.map((client: any) => ({
      id: client.id,
      name: [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || client.firstName || 'Sin nombre',
      phone: client.phoneNumber || '',
      dni: client.dni || '-',
      email: client.email || '',
      userId: Number(client.userId || 0) || null,
      linkedUser: client.linkedUser || null,
      isProfessor: Boolean(client.isProfessor),
      totalBookings: Number(client.totalBookings || 0),
      totalDebt: Number(client.totalDebt || 0),
      clubTimeZone: client.clubTimeZone ? String(client.clubTimeZone) : null,
      lastBookingAt: client.lastBookingAt ? String(client.lastBookingAt) : null,
      nextBookingAt: client.nextBookingAt ? String(client.nextBookingAt) : null,
      history: Array.isArray(client.history) ? client.history : [],
      bookings: Array.isArray(client.bookings)
        ? client.bookings
        : (Array.isArray(client.history) ? client.history : [])
    }));
  }

  static async createByClubSlug(slug: string, body: {
    name: string;
    phone?: string;
    phoneCountryCode?: string;
    phoneNumberLocal?: string;
    dni?: string;
    email?: string;
    isProfessor?: boolean;
    forceCreateNew?: boolean;
  }) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo crear el cliente');
    }
    return res.json();
  }

  static async updateByClubSlug(slug: string, clientId: string, body: {
    name: string;
    phone?: string;
    phoneCountryCode?: string;
    phoneNumberLocal?: string;
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
      await throwApiErrorFromResponse(res, 'No se pudo actualizar el cliente');
    }
    return res.json();
  }

  static async deleteByClubSlug(slug: string, clientId: string) {
    const res = await fetchWithAuth(`${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo eliminar el cliente');
    }
    return true;
  }

  static async linkUserByClubSlug(slug: string, clientId: string, userId: number) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}/link-user`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo vincular el cliente al usuario');
    }
    return res.json();
  }

  static async unlinkUserByClubSlug(slug: string, clientId: string) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(clientId)}/unlink-user`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo desvincular el cliente del usuario');
    }
    return res.json();
  }

  static async mergeByClubSlug(
    slug: string,
    sourceClientId: string,
    targetClientId: string,
    options?: { incidentId?: string; resolutionNotes?: string }
  ) {
    const res = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/clients/${encodeURIComponent(sourceClientId)}/merge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetClientId,
          ...(options?.incidentId ? { incidentId: options.incidentId } : {}),
          ...(options?.resolutionNotes ? { resolutionNotes: options.resolutionNotes } : {}),
        }),
      }
    );
    if (!res.ok) {
      await throwApiErrorFromResponse(res, 'No se pudo fusionar el cliente');
    }
    return res.json();
  }
}
