import crypto from 'crypto';
import type { Request, Response } from 'express';
import { authConfig } from './authConfig';

const getCookieOptions = () => ({
  httpOnly: false,
  secure: authConfig.cookieSecure,
  sameSite: authConfig.cookieSameSite,
  domain: authConfig.cookieDomain,
  path: '/'
} as const);

export const readCsrfTokenFromRequest = (req: Request): string | null => {
  const fromCookieParser = String((req as any).cookies?.[authConfig.csrfCookieName] || '').trim();
  return fromCookieParser || null;
};

export const issueCsrfToken = (res: Response, existingToken?: string | null): string => {
  const nextToken = String(existingToken || '').trim() || crypto.randomBytes(24).toString('base64url');
  res.cookie(authConfig.csrfCookieName, nextToken, getCookieOptions());
  return nextToken;
};

export const ensureCsrfToken = (req: Request, res: Response): string =>
  issueCsrfToken(res, readCsrfTokenFromRequest(req));
