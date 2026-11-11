// "App del club": cuando la app instalada (acceso directo / PWA) se abre en la página de un club,
// la navegación se enfoca en ese club (barra con su identidad y pestañas Inicio · Reservar · Mis reservas).
// Se guarda en sessionStorage: cada ventana de app instalada tiene la suya, así el ícono general de
// Pique y el de cada club no se pisan entre sí.

export type ClubAppIdentity = { slug: string; name: string; logoUrl: string | null };

const STORAGE_KEY = 'pique:club-app';
const LAUNCH_KEY = 'pique:app-launch-checked';
export const CLUB_APP_CHANGED_EVENT = 'pique:club-app-changed';
export const CLUB_APP_QUERY_VALUE = 'club';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

// Última lectura en memoria (solo en el navegador): cada pantalla nueva arranca ya en modo club,
// sin dibujarse un instante como la web. undefined = todavía no se leyó.
let cachedClubApp: ClubAppIdentity | null | undefined;
export const getCachedClubApp = (): ClubAppIdentity | null =>
  typeof window === 'undefined' ? null : cachedClubApp ?? null;

export const isValidClubSlug = (slug: unknown): slug is string => typeof slug === 'string' && SLUG_RE.test(slug);

// Abierta como app instalada (Android/computadora: display-mode; iPhone: navigator.standalone).
export const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const iosStandalone = Boolean((window.navigator as any).standalone);
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
};

const safeSession = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const readClubAppFromStorage = (): ClubAppIdentity | null => {
  const storage = safeSession();
  if (!storage || !isStandaloneDisplay()) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || !isValidClubSlug(parsed.slug)) return null;
    return { slug: parsed.slug, name: String(parsed.name || ''), logoUrl: parsed.logoUrl ? String(parsed.logoUrl) : null };
  } catch {
    return null;
  }
};

export const readClubApp = (): ClubAppIdentity | null => {
  const identity = readClubAppFromStorage();
  if (typeof window !== 'undefined') cachedClubApp = identity;
  return identity;
};

const writeClubApp = (identity: ClubAppIdentity) => {
  const storage = safeSession();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(identity));
    cachedClubApp = identity;
    window.dispatchEvent(new Event(CLUB_APP_CHANGED_EVENT));
  } catch {
    // noop
  }
};

// Al abrir la app instalada: si arranca en /club/<slug> (o trae ?app=club), queda en modo club.
// Se decide una sola vez por ventana; después se mantiene aunque navegue a Mis reservas o al checkout.
export const detectClubAppLaunch = (pathname: string, query: Record<string, unknown>) => {
  const storage = safeSession();
  if (!storage || !isStandaloneDisplay()) return;
  const slug = typeof query.slug === 'string' ? query.slug : null;
  const isClubPage = pathname === '/club/[slug]' && isValidClubSlug(slug);
  const forced = query.app === CLUB_APP_QUERY_VALUE;
  try {
    const alreadyChecked = storage.getItem(LAUNCH_KEY) === '1';
    storage.setItem(LAUNCH_KEY, '1');
    if (isClubPage && (forced || !alreadyChecked) && !readClubApp()) {
      writeClubApp({ slug: slug as string, name: '', logoUrl: null });
    }
  } catch {
    // noop
  }
};

// La página del club completa nombre y logo cuando los carga.
export const updateClubAppIdentity = (identity: ClubAppIdentity) => {
  const current = readClubApp();
  if (!current || current.slug !== identity.slug) return;
  if (current.name === identity.name && current.logoUrl === identity.logoUrl) return;
  writeClubApp(identity);
};

export const clubInitials = (name: string) =>
  String(name || '')
    .replace(/\b(club|atl[eé]tico|de|del|la|el|los|las)\b/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || String(name || '?').charAt(0).toUpperCase();

export const clubManifestHref = (slug: string, name: string) =>
  `/club-app/manifest?slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}`;

// El ícono usa el logo del club si tiene (lo busca por slug); si no, sus iniciales a partir del nombre.
export const clubIconHref = (slug: string, name: string, size: number) =>
  `/club-app/icon?slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}&size=${size}`;
