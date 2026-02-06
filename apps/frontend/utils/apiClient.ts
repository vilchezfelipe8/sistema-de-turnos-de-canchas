/**
 * Cliente HTTP que añade el token de auth y, si el servidor responde 401 o 403
 * (token expirado o inválido), cierra sesión y redirige a /login.
 */
import { getToken, logout } from '../services/AuthService';

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error('Sesión expirada. Volvé a iniciar sesión.');
  }

  return res;
}
