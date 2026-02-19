import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getToken } from '../services/AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  role: string;
  clubId: number | null;
}

const API_URL = getApiUrl();

export interface UseValidateAuthOptions {
  /** Si es true, solo permite acceso a usuarios con role ADMIN; si no, redirige a / */
  requireAdmin?: boolean;
}

/**
 * Valida el token con el backend (GET /api/auth/me).
 * - Sin token o token inválido: redirige a /login (ruta protegida).
 * - Con requireAdmin y usuario no ADMIN: no redirige; la página debe mostrar 404.
 */
export function useValidateAuth(options: UseValidateAuthOptions = {}): { authChecked: boolean; user: AuthUser | null } {
  const { requireAdmin = false } = options;
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? getToken() : null;
    if (!token) {
      const from = typeof router.asPath === 'string' && router.asPath && router.asPath !== '/' ? router.asPath : undefined;
      router.replace(from ? { pathname: '/login', query: { from } } : '/login');
      return;
    }

    (async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/auth/me`, { method: 'GET' });
        if (!res.ok) return;
        const data: AuthUser = await res.json();
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(data));
        }
        setUser(data);
        setAuthChecked(true);
      } catch {
        // 401/403: fetchWithAuth hace logout; el redirect a /login lo maneja la app
      }
    })();
  }, [router, requireAdmin]);

  return { authChecked, user };
}
