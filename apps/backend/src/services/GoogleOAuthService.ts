import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserOAuthProvider } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeEmail } from '../utils/magicLink';
import { logger } from '../utils/logger';

const GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_FIRST_NAME = 'Nuevo';
const DEFAULT_LAST_NAME = 'Usuario';
const DEFAULT_PHONE = '+0000000000';

type DiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
};

type StatePayload = {
  provider: 'google';
  returnTo: string;
  intent: 'login' | 'connect';
};

type GoogleProfile = {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  picture: string | null;
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

export class GoogleOAuthService {
  private readonly fetcher: FetchLike;
  private discoveryCache: { value: DiscoveryDocument; expiresAt: number } | null = null;

  constructor(fetcher?: FetchLike) {
    this.fetcher = fetcher || fetch.bind(globalThis);
  }

  isConfigured() {
    return Boolean(this.getClientId() && this.getClientSecret() && this.getRedirectUri());
  }

  getStateTtlMs() {
    return GOOGLE_STATE_TTL_SECONDS * 1000;
  }

  normalizeReturnTo(value: string | null | undefined) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//')) return '/';
    return raw;
  }

  createStateToken(returnTo?: string | null, intent: 'login' | 'connect' = 'login') {
    const jwtSecret = this.getJwtSecret();
    if (!jwtSecret) {
      throw new Error('GOOGLE_OAUTH_CONFIG_INVALID');
    }

    return jwt.sign(
      {
        provider: 'google',
        returnTo: this.normalizeReturnTo(returnTo),
        intent
      } satisfies StatePayload,
      jwtSecret,
      { expiresIn: GOOGLE_STATE_TTL_SECONDS }
    );
  }

  verifyStateToken(receivedState: string, expectedState: string): { returnTo: string; intent: 'login' | 'connect' } {
    const safeReceived = String(receivedState || '').trim();
    const safeExpected = String(expectedState || '').trim();
    if (!safeReceived || !safeExpected || safeReceived !== safeExpected) {
      throw new Error('GOOGLE_OAUTH_STATE_INVALID');
    }
    const jwtSecret = this.getJwtSecret();
    if (!jwtSecret) {
      throw new Error('GOOGLE_OAUTH_CONFIG_INVALID');
    }

    const payload = jwt.verify(safeReceived, jwtSecret) as StatePayload;
    if (payload.provider !== 'google') {
      throw new Error('GOOGLE_OAUTH_STATE_INVALID');
    }

    return {
      returnTo: this.normalizeReturnTo(payload.returnTo),
      intent: payload.intent === 'connect' ? 'connect' : 'login'
    };
  }

  async buildAuthorizationUrl(state: string) {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error('GOOGLE_OAUTH_CONFIG_INVALID');
    }

    const discovery = await this.getDiscoveryDocument();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.getScopes().join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    return url.toString();
  }

  async authenticateCallback(input: {
    code: string;
    receivedState: string;
    expectedState: string;
    currentUserId?: number | null;
  }) {
    const { returnTo, intent } = this.verifyStateToken(input.receivedState, input.expectedState);
    const profile = await this.exchangeCodeForProfile(String(input.code || '').trim());
    const userId =
      intent === 'connect'
        ? await this.linkIdentityToUser(profile, input.currentUserId)
        : await this.resolveOrCreateUser(profile);
    return { userId, returnTo, intent };
  }

  private getClientId() {
    return String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  }

  private getJwtSecret() {
    return String(process.env.JWT_SECRET || '').trim();
  }

  private getClientSecret() {
    return String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  }

  private getRedirectUri() {
    const explicit = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const appBase = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!appBase) return '';
    return `${appBase}/api/auth/oauth/google/callback`;
  }

  private getScopes() {
    const configured = String(process.env.GOOGLE_OAUTH_SCOPES || '').trim();
    if (!configured) {
      return ['openid', 'email', 'profile'];
    }
    const scopes = configured.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
    return scopes.length > 0 ? scopes : ['openid', 'email', 'profile'];
  }

  private async getDiscoveryDocument() {
    const now = Date.now();
    if (this.discoveryCache && this.discoveryCache.expiresAt > now) {
      return this.discoveryCache.value;
    }

    const response = await this.fetcher(GOOGLE_DISCOVERY_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('GOOGLE_OAUTH_DISCOVERY_FAILED');
    }

    const data = (await response.json()) as DiscoveryDocument;
    if (!data?.authorization_endpoint || !data?.token_endpoint || !data?.userinfo_endpoint) {
      throw new Error('GOOGLE_OAUTH_DISCOVERY_FAILED');
    }

    this.discoveryCache = {
      value: data,
      expiresAt: now + 60 * 60 * 1000
    };

    return data;
  }

  private async exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
    if (!code) {
      throw new Error('GOOGLE_OAUTH_CODE_MISSING');
    }

    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('GOOGLE_OAUTH_CONFIG_INVALID');
    }

    const discovery = await this.getDiscoveryDocument();
    const tokenPayload = new URLSearchParams();
    tokenPayload.set('code', code);
    tokenPayload.set('client_id', clientId);
    tokenPayload.set('client_secret', clientSecret);
    tokenPayload.set('redirect_uri', redirectUri);
    tokenPayload.set('grant_type', 'authorization_code');

    const tokenResponse = await this.fetcher(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenPayload.toString()
    });

    if (!tokenResponse.ok) {
      logger.warn({ status: tokenResponse.status }, 'Google OAuth token exchange failed');
      throw new Error('GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) {
      throw new Error('GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const profileResponse = await this.fetcher(discovery.userinfo_endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!profileResponse.ok) {
      logger.warn({ status: profileResponse.status }, 'Google OAuth userinfo fetch failed');
      throw new Error('GOOGLE_OAUTH_PROFILE_FETCH_FAILED');
    }

    const profile = (await profileResponse.json()) as GoogleUserInfo;
    const providerUserId = String(profile?.sub || '').trim();
    const email = normalizeEmail(String(profile?.email || ''));
    const emailVerified = Boolean(profile?.email_verified);

    if (!providerUserId) {
      throw new Error('GOOGLE_OAUTH_PROFILE_INVALID');
    }
    if (!email) {
      throw new Error('GOOGLE_OAUTH_EMAIL_UNAVAILABLE');
    }
    if (!emailVerified) {
      throw new Error('GOOGLE_OAUTH_EMAIL_UNVERIFIED');
    }

    const fallbackName = splitName(String(profile?.name || ''));
    return {
      providerUserId,
      email,
      emailVerified,
      firstName: String(profile?.given_name || '').trim() || fallbackName.firstName,
      lastName: String(profile?.family_name || '').trim() || fallbackName.lastName,
      picture: String(profile?.picture || '').trim() || null
    };
  }

  private async resolveOrCreateUser(profile: GoogleProfile) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.GOOGLE,
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
            profilePhotoUrl: profile.picture,
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
          provider: UserOAuthProvider.GOOGLE,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
          profilePhotoUrl: profile.picture,
          linkedAt: now,
          lastLoginAt: now
        }
      });

      return user.id;
    });
  }

  private async linkIdentityToUser(profile: GoogleProfile, currentUserId?: number | null) {
    const userId = Number(currentUserId || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('OAUTH_CONNECT_AUTH_REQUIRED');
    }

    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.GOOGLE,
            providerUserId: profile.providerUserId
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      if (existingIdentity?.id && existingIdentity.userId !== userId) {
        throw new Error('GOOGLE_OAUTH_ALREADY_LINKED');
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
            profilePhotoUrl: profile.picture,
            lastLoginAt: now
          }
        });
        return userId;
      }

      await tx.userOAuthIdentity.create({
        data: {
          userId,
          provider: UserOAuthProvider.GOOGLE,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          providerEmailVerified: profile.emailVerified,
          profilePhotoUrl: profile.picture,
          linkedAt: now,
          lastLoginAt: now
        }
      });

      return userId;
    });
  }
}
