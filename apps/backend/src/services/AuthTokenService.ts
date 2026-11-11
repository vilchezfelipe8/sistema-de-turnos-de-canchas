import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authConfig } from '../utils/authConfig';

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

type AccessTokenClaims = {
  userId: number;
  role: string;
  sid?: string;
};

export class AuthTokenService {
  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, JWT_SECRET, {
      expiresIn: `${authConfig.accessTtlMinutes}m`
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    // Solo tokens de sesión: cualquier otro JWT firmado con el mismo secreto (ej. invitaciones) se rechaza.
    const claims = payload as Partial<AccessTokenClaims> & { typ?: unknown };
    if (
      !claims || typeof claims !== 'object' ||
      claims.typ !== undefined ||
      !Number.isInteger(claims.userId) || Number(claims.userId) <= 0
    ) {
      throw new jwt.JsonWebTokenError('invalid token type');
    }
    return claims as AccessTokenClaims;
  }

  generateRefreshToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return crypto
      .createHash('sha256')
      .update(`${token}.${authConfig.refreshPepper}`, 'utf8')
      .digest('hex');
  }
}
