import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../errors';
import { authConfig } from '../utils/authConfig';
import { readCsrfTokenFromRequest } from '../utils/csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXCLUDED_PATHS = new Set([
  '/api/auth/oauth/apple/callback'
]);

const hasSessionCookie = (req: Request) => {
  const accessCookie = String((req as any).cookies?.[authConfig.accessCookieName] || '').trim();
  const refreshCookie = String((req as any).cookies?.[authConfig.refreshCookieName] || '').trim();
  return Boolean(accessCookie || refreshCookie);
};

export const csrfProtection = (req: Request, _res: Response, next: NextFunction) => {
  if (!authConfig.enableCookieSessions) return next();
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();
  if (CSRF_EXCLUDED_PATHS.has(String(req.path || '').trim())) return next();
  if (!hasSessionCookie(req)) return next();

  const cookieToken = readCsrfTokenFromRequest(req);
  const headerToken = String(req.header('x-csrf-token') || '').trim();

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new AppError({
      statusCode: 403,
      code: ErrorCodes.CSRF_INVALID,
      message: 'La sesión necesita revalidarse antes de continuar.'
    }));
  }

  return next();
};
