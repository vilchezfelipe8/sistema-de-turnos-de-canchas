const toBool = (value: string | undefined, fallback: boolean) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
};

const isProduction = process.env.NODE_ENV === 'production';

const toInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const normalizeSameSite = (
  value: string | undefined
): 'lax' | 'strict' | 'none' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'none') return normalized;
  return 'lax';
};

export const authConfig = {
  // Cookie sessions is the primary transport mode.
  enableCookieSessions: toBool(process.env.AUTH_ENABLE_COOKIE_SESSIONS, true),
  // Bearer fallback is temporary and must be explicitly enabled.
  allowBearerLegacy: toBool(process.env.AUTH_ALLOW_BEARER_LEGACY, false),
  accessCookieName: String(process.env.AUTH_ACCESS_COOKIE_NAME || 'tc_access').trim() || 'tc_access',
  refreshCookieName: String(process.env.AUTH_REFRESH_COOKIE_NAME || 'tc_refresh').trim() || 'tc_refresh',
  cookieDomain: String(process.env.AUTH_COOKIE_DOMAIN || '').trim() || undefined,
  cookieSecure: toBool(process.env.AUTH_COOKIE_SECURE, isProduction),
  cookieSameSite: normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE),
  accessTtlMinutes: toInt(process.env.AUTH_ACCESS_TTL_MINUTES, 15),
  refreshIdleDays: toInt(process.env.AUTH_REFRESH_IDLE_DAYS, 30),
  refreshAbsoluteDays: toInt(process.env.AUTH_REFRESH_ABSOLUTE_DAYS, 180),
  refreshPepper: String(process.env.AUTH_REFRESH_PEPPER || '').trim() || (isProduction ? '' : 'dev-refresh-pepper'),
  trustProxy: toBool(process.env.AUTH_TRUST_PROXY, isProduction)
};

if (!authConfig.enableCookieSessions && !authConfig.allowBearerLegacy) {
  throw new Error('Invalid auth config: enable cookie sessions or bearer legacy transport.');
}

if (authConfig.cookieSameSite === 'none' && !authConfig.cookieSecure) {
  throw new Error('Invalid auth config: SameSite=None requires AUTH_COOKIE_SECURE=true.');
}

if (isProduction) {
  if (authConfig.enableCookieSessions && !authConfig.cookieSecure) {
    throw new Error('Invalid auth config: AUTH_COOKIE_SECURE must be true in production.');
  }

  if (!authConfig.refreshPepper || authConfig.refreshPepper === 'dev-refresh-pepper') {
    throw new Error('Invalid auth config: configure AUTH_REFRESH_PEPPER for production.');
  }
}
