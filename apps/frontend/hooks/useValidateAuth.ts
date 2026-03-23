import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getToken } from '../services/AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { persistSessionUser, type MembershipLite } from '../utils/session';

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  role: string;
  clubId: number | null;
  memberships?: MembershipLite[];
  activeClubId?: number | null;
  activeMembership?: MembershipLite | null;
  club?: { id?: number; slug?: string | null } | null;
}

const apiBase = () => `${getApiUrl()}/api`;

export interface UseValidateAuthOptions {
  /** Si es true, solo permite acceso a usuarios con role ADMIN; si no, redirige a / */
  requireAdmin?: boolean;
  /** Si es true, permite navegar sin token (modo invitado) y no redirige */
  allowGuest?: boolean;
}

/**
 * Valida el token con el backend (GET /api/auth/me).
 * - Sin token o token inválido: redirige a / (home).
 * - Con requireAdmin y usuario no ADMIN: no redirige; la página debe mostrar 404.
 */
export function useValidateAuth(options: UseValidateAuthOptions = {}): { authChecked: boolean; user: AuthUser | null } {
  const { requireAdmin = false, allowGuest = false } = options;
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? getToken() : null;
    if (!token) {
      if (allowGuest) {
        setUser(null);
        setAuthChecked(true);
        return;
      }
      router.replace('/');
      return;
    }

    (async () => {
      try {
        const res = await fetchWithAuth(`${apiBase()}/auth/me`, { method: 'GET' });
        if (!res.ok) return;
        const data: AuthUser = await res.json();
        const normalized = persistSessionUser(data as any) as AuthUser | null;
        if (typeof window !== 'undefined') {
          if (!normalized) {
            localStorage.removeItem('user');
          }
        }
        setUser(normalized || data);
        setAuthChecked(true);
      } catch {
        // 401/403: fetchWithAuth hace logout; el redirect al home lo maneja la app
      }
    })();
  }, [router, requireAdmin, allowGuest]);

  return { authChecked, user };
}
