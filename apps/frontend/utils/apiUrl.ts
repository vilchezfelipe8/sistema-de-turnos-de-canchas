/** Puerto del backend en desarrollo local (Docker: backend 3001, frontend 3000). */
const DEFAULT_BACKEND_PORT = '3001';

/**
 * Base URL del backend (sin /api). Todas las llamadas usan: ${getApiUrl()}/api/...
 * - Producción: usar NEXT_PUBLIC_API_URL=/api (mismo origen; nginx hace proxy de /api al backend).
 * - Local: usar NEXT_PUBLIC_API_URL=http://localhost:3001 (backend en 3001).
 */
export const getApiUrl = (): string => {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) {
    const s = String(env).replace(/\/+$/, '');
    if (s === '/api' || s === '') return ''; // mismo origen
    return s.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    return `${protocol || 'http:'}//${hostname}:${DEFAULT_BACKEND_PORT}`;
  }
  return `http://localhost:${DEFAULT_BACKEND_PORT}`;
};
