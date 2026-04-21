import { Request, Response, NextFunction } from 'express';
import { sendAuthError } from '../utils/authError';
import { authConfig } from '../utils/authConfig';
import { AuthTokenService } from '../services/AuthTokenService';

const getCookieValue = (rawCookieHeader: string | undefined, key: string): string | null => {
    const source = String(rawCookieHeader || '');
    if (!source.trim()) return null;
    const parts = source.split(';');
    for (const part of parts) {
        const eqIndex = part.indexOf('=');
        if (eqIndex <= 0) continue;
        const cookieKey = part.slice(0, eqIndex).trim();
        if (cookieKey !== key) continue;
        const cookieValue = part.slice(eqIndex + 1).trim();
        if (!cookieValue) return null;
        try {
            return decodeURIComponent(cookieValue);
        } catch {
            return cookieValue;
        }
    }
    return null;
};

const tokenService = new AuthTokenService();

const resolveAuthToken = (req: Request): { token: string | null; source: 'cookie' | 'bearer' | null } => {
    if (authConfig.enableCookieSessions) {
        const cookieTokenFromParser = String((req as any).cookies?.[authConfig.accessCookieName] || '').trim();
        const cookieToken = cookieTokenFromParser || getCookieValue(req.headers.cookie, authConfig.accessCookieName);
        if (cookieToken) return { token: cookieToken, source: 'cookie' };
    }

    if (authConfig.allowBearerLegacy) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.split(' ')[1];
        if (bearerToken) return { token: bearerToken, source: 'bearer' };
    }

    return { token: null, source: null };
};

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const { token, source } = resolveAuthToken(req);

    if (!token) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'Acceso denegado. Falta el token.');
    }

    try {
        const user = tokenService.verifyAccessToken(token);
        (req as any).user = user;
        (req as any).authSource = source;
        (req as any).setLogContext?.({ userId: user?.userId });
        next();
    } catch (err: any) {
        const code = String(err?.name || '') === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
        return sendAuthError(res, 401, code, 'Token inválido o expirado.');
    }
};

// Middleware opcional: si viene token lo verifica y setea req.user, si no viene token sigue sin error.
export const optionalAuthMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    const { token, source } = resolveAuthToken(req);
    if (!token) {
        (req as any).user = null;
        (req as any).authState = 'guest';
        return next();
    }

    try {
        const user = tokenService.verifyAccessToken(token);
        (req as any).user = user;
        (req as any).authState = 'authenticated';
        (req as any).authSource = source;
        (req as any).setLogContext?.({ userId: user?.userId });
        next();
    } catch {
        // No bloqueamos, dejamos user null para que el controlador decida
        (req as any).user = null;
        (req as any).authState = 'invalid_token';
        next();
    }
};
