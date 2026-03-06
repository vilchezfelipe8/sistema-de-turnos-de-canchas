import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export class AuditLogService {
  static async list(params?: {
    entity?: string;
    entityId?: string;
    action?: string;
    userId?: number;
    take?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.entity) query.set('entity', params.entity);
    if (params?.entityId) query.set('entityId', params.entityId);
    if (params?.action) query.set('action', params.action);
    if (params?.userId) query.set('userId', String(params.userId));
    if (params?.take) query.set('take', String(params.take));

    const res = await fetchWithAuth(`${apiBase()}/audit-logs?${query.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error('Error al cargar auditoría');
    return res.json();
  }
}
