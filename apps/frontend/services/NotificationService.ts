import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  channel?: string | null;
  isRead: boolean;
  status?: string | null;
  sentAt?: string | null;
  createdAt: string;
  userId?: number | null;
  clubId: number;
};

export class NotificationService {
  static async list(unreadOnly = false, take = 20): Promise<NotificationItem[]> {
    const query = new URLSearchParams();
    if (unreadOnly) query.set('unreadOnly', 'true');
    query.set('take', String(take));

    const res = await fetchWithAuth(`${apiBase()}/notifications?${query.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar notificaciones');
    return res.json();
  }

  static async markRead(id: string) {
    const res = await fetchWithAuth(`${apiBase()}/notifications/${id}/read`, { method: 'PATCH' });
    if (!res.ok) throw new Error('Error al marcar notificación');
    return res.json();
  }

  static async markAllRead() {
    const res = await fetchWithAuth(`${apiBase()}/notifications/read-all`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('Error al marcar todas como leídas');
    return res.json();
  }
}
