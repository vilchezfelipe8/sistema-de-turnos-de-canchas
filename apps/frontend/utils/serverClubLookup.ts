import type { IncomingMessage } from 'http';

// Solo servidor: datos básicos del club para armar el manifest y el <head> de la app del club
// en la primera carga (iPhone toma el manifest que viene con la página y no el que se cambia después).

const firstHeader = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();

export const resolveRequestOrigin = (req: IncomingMessage) => {
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host) || 'localhost:3001';
  const proto = firstHeader(req.headers['x-forwarded-proto']) || ((req.socket as any)?.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
};

export const fetchClubBasics = async (
  slug: string,
  origin: string
): Promise<{ name: string; logoUrl: string | null } | null> => {
  const apiBase = (process.env.INTERNAL_API_URL || origin).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${apiBase}/api/clubs/slug/${encodeURIComponent(slug)}`, { signal: controller.signal });
    if (!res.ok) return null;
    const club = await res.json();
    const name = String(club?.name || '').trim();
    return name ? { name, logoUrl: club?.logoUrl ? String(club.logoUrl) : null } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
