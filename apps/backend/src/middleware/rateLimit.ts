import rateLimit from 'express-rate-limit';

const parseWindowMs = (envKey: string, defaultMs: number) => {
  const val = process.env[envKey];
  if (!val) return defaultMs;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
};

const parseMax = (envKey: string, defaultVal: number) => {
  const val = process.env[envKey];
  if (!val) return defaultVal;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
};

/** 5 intentos de login por minuto (brute force) */
export const loginLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_LOGIN_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_LOGIN_MAX', 5),
  message: { error: 'Demasiados intentos de login. Intentá de nuevo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false
});

/** 3 registros por minuto (spam) */
export const registerLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_REGISTER_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_REGISTER_MAX', 3),
  message: { error: 'Demasiados registros. Intentá de nuevo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false
});

/** 5 solicitudes de magic link por minuto */
export const magicLinkRequestLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_MAGIC_LINK_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_MAGIC_LINK_MAX', 5),
  message: { error: 'Demasiadas solicitudes de enlace. Esperá un momento e intentá de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false
});

/** 20 refresh attempts por minuto */
export const sessionRefreshLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_SESSION_REFRESH_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_SESSION_REFRESH_MAX', 20),
  message: { error: 'Demasiadas solicitudes de refresco de sesión. Esperá un momento.' },
  standardHeaders: true,
  legacyHeaders: false
});

/** 30 pagos por minuto por IP */
export const paymentLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_PAYMENT_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_PAYMENT_MAX', 30),
  message: { error: 'Demasiadas solicitudes de pago. Esperá un momento.' },
  standardHeaders: true,
  legacyHeaders: false
});

/** 10 reservas por minuto (spam reservas, bots) */
export const bookingLimiter = rateLimit({
  windowMs: parseWindowMs('RATE_LIMIT_BOOKING_WINDOW_MS', 60_000),
  max: parseMax('RATE_LIMIT_BOOKING_MAX', 10),
  message: { error: 'Demasiadas reservas. Esperá un momento antes de intentar de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false
});
