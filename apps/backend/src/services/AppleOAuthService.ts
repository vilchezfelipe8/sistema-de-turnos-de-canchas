import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createPublicKey, KeyObject } from 'crypto';
import { UserOAuthProvider } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeEmail } from '../utils/magicLink';
import { logger } from '../utils/logger';
import { OAuthStateStore } from './OAuthStateStore';

const APPLE_AUTHORIZATION_ENDPOINT = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS_ENDPOINT = 'https://appleid.apple.com/auth/keys';
const DEFAULT_FIRST_NAME = 'Nuevo';
const DEFAULT_LAST_NAME = 'Usuario';
const DEFAULT_PHONE = '+0000000000';

type AppleTokenResponse = {
  access_token?: string;
  id_token?: string;
};

type AppleIdTokenPayload = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false' | string;
};

type AppleUserEnvelope = {
  name?: {
    firstName?: string;
    lastName?: string;
  };
  email?: string;
};

type AppleOAuthProfile = {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
};

type AppleJwk = {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
};

type AppleKeysDocument = {
  keys?: AppleJwk[];
};

type FetchLike = typeof fetch;

const splitName = (fullName: string) => {
  const safe = String(fullName || '').trim();
  if (!safe) {
    return {
      firstName: DEFAULT_FIRST_NAME,
      lastName: DEFAULT_LAST_NAME
    };
  }
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: DEFAULT_LAST_NAME
    };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
};

const parseAppleUserEnvelope = (rawUser: unknown): AppleUserEnvelope | null => {
  if (!rawUser) return null;
  if (typeof rawUser === 'object') {
    return rawUser as AppleUserEnvelope;
  }
  const safe = String(rawUser || '').trim();
  if (!safe) return null;
  try {
    return JSON.parse(safe) as AppleUserEnvelope;
  } catch {
    return null;
  }
};

const normalizeBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  const safe = String(value || '').trim().toLowerCase();
  return safe === 'true' || safe === '1';
};

export class AppleOAuthService {
  private readonly fetcher: FetchLike;
  private readonly stateStore: OAuthStateStore;
  private keysCache: { value: AppleJwk[]; expiresAt: number } | null = null;

  constructor(fetcher?: FetchLike, stateStore?: OAuthStateStore) {
    this.fetcher = fetcher || fetch.bind(globalThis);
    this.stateStore = stateStore || new OAuthStateStore();
  }

  isConfigured() {
    return Boolean(
      this.getClientId() &&
      this.getTeamId() &&
      this.getKeyId() &&
      this.getPrivateKey() &&
      this.getRedirectUri()
    );
  }

  getStateTtlMs() {
    return this.stateStore.getStateTtlMs();
  }

  normalizeReturnTo(value: string | null | undefined) {
    return this.stateStore.normalizeReturnTo(value);
  }

  async createState(returnTo?: string | null, intent: 'login' | 'connect' = 'login') {
    return this.stateStore.createState('apple', returnTo, intent);
  }

  async consumeState(state: string) {
    return this.stateStore.consumeState('apple', state);
  }

  async inspectState(state: string) {
    return this.stateStore.inspectState('apple', state);
  }

  async buildAuthorizationUrl(state: string) {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error('APPLE_OAUTH_CONFIG_INVALID');
    }

    const url = new URL(APPLE_AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('scope', this.getScopes().join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async authenticateCallback(input: {
    code: string;
    state: string;
    user?: unknown;
    currentUserId?: number | null;
  }) {
    const { returnTo, intent } = await this.consumeState(input.state);
    const profile = await this.exchangeCodeForProfile(String(input.code || '').trim(), input.user);
    const userId =
      intent === 'connect'
        ? await this.linkIdentityToUser(profile, input.currentUserId)
        : await this.resolveOrCreateUser(profile);
    return { userId, returnTo, intent };
  }

  private getClientId() {
    return String(process.env.APPLE_OAUTH_CLIENT_ID || '').trim();
  }

  private getTeamId() {
    return String(process.env.APPLE_OAUTH_TEAM_ID || '').trim();
  }

  private getKeyId() {
    return String(process.env.APPLE_OAUTH_KEY_ID || '').trim();
  }

  private getPrivateKey() {
    const raw = String(process.env.APPLE_OAUTH_PRIVATE_KEY || '').trim();
    return raw ? raw.replace(/\\n/g, '\n') : '';
  }

  private getRedirectUri() {
    const explicit = String(process.env.APPLE_OAUTH_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const appBase = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!appBase) return '';
    return `${appBase}/api/auth/oauth/apple/callback`;
  }

  private getScopes() {
    const configured = String(process.env.APPLE_OAUTH_SCOPES || '').trim();
    if (!configured) {
      return ['name', 'email'];
    }
    const scopes = configured.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
    return scopes.length > 0 ? scopes : ['name', 'email'];
  }

  private async buildClientSecret() {
    const clientId = this.getClientId();
    const teamId = this.getTeamId();
    const keyId = this.getKeyId();
    const privateKey = this.getPrivateKey();

    if (!clientId || !teamId || !keyId || !privateKey) {
      throw new Error('APPLE_OAUTH_CONFIG_INVALID');
    }

    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: teamId,
        aud: 'https://appleid.apple.com',
        sub: clientId,
        iat: now,
        exp: now + 5 * 60
      },
      privateKey,
      {
        algorithm: 'ES256',
        keyid: keyId
      }
    );
  }

  private async exchangeCodeForProfile(code: string, rawUser?: unknown): Promise<AppleOAuthProfile> {
    if (!code) {
      throw new Error('APPLE_OAUTH_CODE_MISSING');
    }

    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error('APPLE_OAUTH_CONFIG_INVALID');
    }

    const tokenPayload = new URLSearchParams();
    tokenPayload.set('client_id', clientId);
    tokenPayload.set('client_secret', await this.buildClientSecret());
    tokenPayload.set('code', code);
    tokenPayload.set('grant_type', 'authorization_code');
    tokenPayload.set('redirect_uri', redirectUri);

    const tokenResponse = await this.fetcher(APPLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenPayload.toString()
    });

    if (!tokenResponse.ok) {
      logger.warn({ status: tokenResponse.status }, 'Apple OAuth token exchange failed');
      throw new Error('APPLE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const tokenData = (await tokenResponse.json()) as AppleTokenResponse;
    const idToken = String(tokenData?.id_token || '').trim();
    if (!idToken) {
      throw new Error('APPLE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const verifiedPayload = await this.verifyIdToken(idToken);
    const providerUserId = String(verifiedPayload?.sub || '').trim();
    const email = normalizeEmail(String(verifiedPayload?.email || ''));
    const emailVerified = normalizeBoolean(verifiedPayload?.email_verified);

    if (!providerUserId) {
      throw new Error('APPLE_OAUTH_PROFILE_INVALID');
    }
    if (!email) {
      throw new Error('APPLE_OAUTH_EMAIL_UNAVAILABLE');
    }
    if (!emailVerified) {
      throw new Error('APPLE_OAUTH_EMAIL_UNVERIFIED');
    }

    const appleUser = parseAppleUserEnvelope(rawUser);
    const firstName = String(appleUser?.name?.firstName || '').trim();
    const lastName = String(appleUser?.name?.lastName || '').trim();
    const fallbackName = splitName('');

    return {
      providerUserId,
      email,
      emailVerified,
      firstName: firstName || fallbackName.firstName,
      lastName: lastName || fallbackName.lastName
    };
  }

  private async verifyIdToken(idToken: string) {
    const decoded = jwt.decode(idToken, { complete: true }) as { header?: { kid?: string; alg?: string } } | null;
    const headerKid = String(decoded?.header?.kid || '').trim();
    const headerAlg = String(decoded?.header?.alg || '').trim();
    if (!headerKid || headerAlg !== 'RS256') {
      throw new Error('APPLE_OAUTH_ID_TOKEN_INVALID');
    }

    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error('APPLE_OAUTH_CONFIG_INVALID');
    }

    const keys = await this.getAppleKeys();
    const signingKey = keys.find((key) => key.kid === headerKid);
    if (!signingKey) {
      throw new Error('APPLE_OAUTH_ID_TOKEN_INVALID');
    }

    const publicKey = createPublicKey({
      key: signingKey as any,
      format: 'jwk'
    });

    return jwt.verify(idToken, publicKey as KeyObject, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: 'https://appleid.apple.com'
    }) as AppleIdTokenPayload;
  }

  private async getAppleKeys() {
    const now = Date.now();
    if (this.keysCache && this.keysCache.expiresAt > now) {
      return this.keysCache.value;
    }

    const response = await this.fetcher(APPLE_KEYS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('APPLE_OAUTH_KEYS_FETCH_FAILED');
    }

    const data = (await response.json()) as AppleKeysDocument;
    const keys = Array.isArray(data?.keys) ? data.keys.filter(Boolean) : [];
    if (keys.length === 0) {
      throw new Error('APPLE_OAUTH_KEYS_FETCH_FAILED');
    }

    this.keysCache = {
      value: keys,
      expiresAt: now + 60 * 60 * 1000
    };
    return keys;
  }

  private async resolveOrCreateUser(profile: AppleOAuthProfile) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.APPLE,
            providerUserId: profile.providerUserId
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      if (existingIdentity?.id) {
        await tx.user.update({
          where: { id: existingIdentity.userId },
          data: {
            lastLoginAt: now,
            emailVerifiedAt: now
          },
          select: { id: true }
        });

        await tx.userOAuthIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            providerEmail: profile.email,
            providerEmailVerified: profile.emailVerified,
            lastLoginAt: now
          }
        });

        return existingIdentity.userId;
      }

      let user = await tx.user.findUnique({
        where: { email: profile.email },
        select: { id: true }
      });

      if (!user) {
        const placeholderPassword = await bcrypt.hash(`${profile.providerUserId}.${Date.now()}`, 10);
        user = await tx.user.create({
          data: {
            email: profile.email,
            password: placeholderPassword,
            firstName: profile.firstName || DEFAULT_FIRST_NAME,
            lastName: profile.lastName || DEFAULT_LAST_NAME,
            phoneNumber: DEFAULT_PHONE,
            role: 'MEMBER',
            emailVerifiedAt: now,
            lastLoginAt: now
          },
          select: { id: true }
        });
      } else {
        await tx.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: now,
            emailVerifiedAt: now
          },
          select: { id: true }
        });
      }

      await tx.userOAuthIdentity.create({
        data: {
          userId: user.id,
          provider: UserOAuthProvider.APPLE,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
          linkedAt: now,
          lastLoginAt: now
        }
      });

      return user.id;
    });
  }

  private async linkIdentityToUser(profile: AppleOAuthProfile, currentUserId?: number | null) {
    const userId = Number(currentUserId || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('OAUTH_CONNECT_AUTH_REQUIRED');
    }

    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.APPLE,
            providerUserId: profile.providerUserId
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      if (existingIdentity?.id && existingIdentity.userId !== userId) {
        throw new Error('APPLE_OAUTH_ALREADY_LINKED');
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          emailVerifiedAt: now
        },
        select: { id: true }
      });

      if (existingIdentity?.id) {
        await tx.userOAuthIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            providerEmail: profile.email,
            providerEmailVerified: profile.emailVerified,
            lastLoginAt: now
          }
        });
        return userId;
      }

      await tx.userOAuthIdentity.create({
        data: {
          userId,
          provider: UserOAuthProvider.APPLE,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
          linkedAt: now,
          lastLoginAt: now
        }
      });

      return userId;
    });
  }
}
