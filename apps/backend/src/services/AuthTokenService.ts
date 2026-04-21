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
    return jwt.verify(token, JWT_SECRET) as AccessTokenClaims;
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
