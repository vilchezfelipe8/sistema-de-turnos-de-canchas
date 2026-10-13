import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type ClubMemberStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type AppAccountStatus = 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED';

// Resumen que devuelven las búsquedas de clientes para mostrar el badge de socio.
export type MemberSummary = {
  id: string;
  status: ClubMemberStatus;
  categoryId: string;
  categoryName: string;
  memberNumber: string | null;
  validUntil: string | null;
  isCurrent: boolean;
};

export type MemberCategory = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  activeMembersCount: number;
};

export type ClientMemberDetail = {
  membersEnabled: boolean;
  member: (MemberSummary & {
    joinedAt: string | null;
    leftAt: string | null;
    statusReason: string | null;
    notes: string | null;
  }) | null;
  appAccount: { userId: number; status: AppAccountStatus } | null;
  account?: { status: string; detail?: string };
};

export type MemberListItem = MemberSummary & {
  joinedAt: string | null;
  leftAt: string | null;
  statusReason: string | null;
  notes: string | null;
  client: { id: string; name: string; dni: string | null; phone: string | null; email: string | null };
  appAccount: { userId: number; status: AppAccountStatus } | null;
};

export type MemberHistoryEntry = {
  id: string;
  action: string;
  fromStatus: ClubMemberStatus | null;
  toStatus: ClubMemberStatus | null;
  fromCategoryName: string | null;
  toCategoryName: string | null;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
};

export const MEMBER_STATUS_LABELS: Record<ClubMemberStatus, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  INACTIVE: 'Baja'
};

// Etiqueta corta del badge: "Socio · Activo · N° 1234" / "Socio suspendido" / "No socio".
export const formatMemberBadge = (member: MemberSummary | null | undefined) => {
  if (!member) return 'No socio';
  if (!member.isCurrent) {
    if (member.status === 'SUSPENDED') return 'Socio suspendido';
    if (member.status === 'INACTIVE') return 'Ex socio';
    return 'Socio no vigente';
  }
  return `Socio · ${member.categoryName}${member.memberNumber ? ` · N° ${member.memberNumber}` : ''}`;
};

const request = async <T>(path: string, init: RequestInit, fallback: string): Promise<T> => {
  const res = await fetchWithAuth(`${apiBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, fallback);
  return res.json();
};

export const MemberAdminService = {
  getSettings: (slug: string) =>
    request<{ membersEnabled: boolean }>(`/clubs/${slug}/admin/members-settings`, { method: 'GET' }, 'No se pudo obtener la configuración de socios.'),

  updateSettings: (slug: string, membersEnabled: boolean) =>
    request<{ membersEnabled: boolean }>(
      `/clubs/${slug}/admin/members-settings`,
      { method: 'PUT', body: JSON.stringify({ membersEnabled }) },
      'No se pudo actualizar la configuración de socios.'
    ),

  listCategories: (slug: string) =>
    request<MemberCategory[]>(`/clubs/${slug}/admin/member-categories`, { method: 'GET' }, 'No se pudieron cargar las categorías.'),

  createCategory: (slug: string, body: { code: string; name: string; description?: string | null; sortOrder?: number }) =>
    request<MemberCategory>(
      `/clubs/${slug}/admin/member-categories`,
      { method: 'POST', body: JSON.stringify(body) },
      'No se pudo crear la categoría.'
    ),

  updateCategory: (
    slug: string,
    categoryId: string,
    body: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean }
  ) =>
    request<MemberCategory>(
      `/clubs/${slug}/admin/member-categories/${categoryId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      'No se pudo actualizar la categoría.'
    ),

  listMembers: (slug: string, params: { status?: ClubMemberStatus; categoryId?: string; q?: string; page?: number; pageSize?: number }) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') search.set(key, String(value));
    });
    return request<{ page: number; pageSize: number; total: number; items: MemberListItem[] }>(
      `/clubs/${slug}/admin/members?${search.toString()}`,
      { method: 'GET' },
      'No se pudo cargar el padrón.'
    );
  },

  getClientMember: (slug: string, clientId: string) =>
    request<ClientMemberDetail>(`/clubs/${slug}/admin/clients/${clientId}/member`, { method: 'GET' }, 'No se pudo cargar el socio.'),

  createMember: (
    slug: string,
    clientId: string,
    body: { categoryId: string; memberNumber?: string | null; joinedAt?: string | null; validUntil?: string | null; notes?: string | null }
  ) =>
    request<ClientMemberDetail>(
      `/clubs/${slug}/admin/clients/${clientId}/member`,
      { method: 'POST', body: JSON.stringify(body) },
      'No se pudo dar de alta al socio.'
    ),

  updateMember: (
    slug: string,
    clientId: string,
    body: { categoryId?: string; memberNumber?: string | null; joinedAt?: string | null; validUntil?: string | null; notes?: string | null }
  ) =>
    request<ClientMemberDetail>(
      `/clubs/${slug}/admin/clients/${clientId}/member`,
      { method: 'PATCH', body: JSON.stringify(body) },
      'No se pudo actualizar el socio.'
    ),

  changeStatus: (slug: string, clientId: string, status: ClubMemberStatus, reason?: string) =>
    request<ClientMemberDetail>(
      `/clubs/${slug}/admin/clients/${clientId}/member/status`,
      { method: 'POST', body: JSON.stringify({ status, reason: reason || null }) },
      'No se pudo cambiar el estado del socio.'
    ),

  getHistory: (slug: string, clientId: string) =>
    request<MemberHistoryEntry[]>(`/clubs/${slug}/admin/clients/${clientId}/member/history`, { method: 'GET' }, 'No se pudo cargar el historial.'),

  provisionAppAccount: (slug: string, clientId: string) =>
    request<{ status: string; detail?: string; userId?: number }>(
      `/clubs/${slug}/admin/clients/${clientId}/member/app-account`,
      { method: 'POST', body: '{}' },
      'No se pudo preparar la cuenta de la app.'
    ),

  issueActivationCode: (slug: string, clientId: string, channel: 'ADMIN_ISSUED' | 'WHATSAPP') =>
    request<{ purpose: 'ACTIVATION' | 'PASSWORD_RESET'; channel: string; expiresAt: string; code: string | null }>(
      `/clubs/${slug}/admin/clients/${clientId}/activation-code`,
      { method: 'POST', body: JSON.stringify({ channel }) },
      'No se pudo generar el código.'
    )
};
