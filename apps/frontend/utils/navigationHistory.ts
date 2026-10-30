// Recuerda las últimas pantallas visitadas dentro de la app (por pestaña), para botones "Volver"
// que deben llevar a donde estaba el usuario. No se usa el historial del navegador porque varias
// navegaciones lo reemplazan (pestañas de la app del club, redirecciones al login).

const STACK_KEY = 'pique:nav-stack';
const MAX_ENTRIES = 15;

const pathnameOf = (path: string) => String(path || '').split(/[?#]/)[0];

const safeSession = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const readStack = (): string[] => {
  try {
    const parsed = JSON.parse(safeSession()?.getItem(STACK_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

const writeStack = (stack: string[]) => {
  try {
    safeSession()?.setItem(STACK_KEY, JSON.stringify(stack.slice(-MAX_ENTRIES)));
  } catch {
    // noop
  }
};

// Primera carga de la pestaña: si se llegó desde otra página de Pique (navegación completa), esa es la anterior.
export const initNavigationHistory = (initialPath: string) => {
  const stack: string[] = [];
  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (referrer && referrer.origin === window.location.origin && pathnameOf(referrer.pathname) !== pathnameOf(initialPath)) {
      stack.push(`${referrer.pathname}${referrer.search}`);
    }
  } catch {
    // noop
  }
  stack.push(initialPath);
  writeStack(stack);
};

// En cada cambio de pantalla. Los cambios de query en la misma pantalla actualizan la última entrada.
export const trackRouteChange = (nextPath: string) => {
  const stack = readStack();
  const last = stack[stack.length - 1];
  if (last && pathnameOf(last) === pathnameOf(nextPath)) {
    stack[stack.length - 1] = nextPath;
  } else {
    stack.push(nextPath);
  }
  writeStack(stack);
};

// Pantallas que sin sesión mandan al login: "Volver" desde el login no puede llevar ahí (volvería a abrirlo).
export const AUTH_REQUIRED_PATHS = ['/login', '/bookings', '/checkout', '/perfil', '/admin'];

const matchesPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

// Última pantalla visitada que no coincida con las indicadas (la ruta exacta o cualquier subruta).
export const getPreviousInAppPath = (options: { skipPaths: string[] }): string | null => {
  const stack = readStack();
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    const pathname = pathnameOf(entry);
    if (!options.skipPaths.some((base) => matchesPath(pathname, base))) return entry;
  }
  return null;
};
