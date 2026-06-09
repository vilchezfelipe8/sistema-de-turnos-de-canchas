import bcrypt from 'bcryptjs';
import { UserOAuthProvider } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeEmail } from '../utils/magicLink';
import { logger } from '../utils/logger';
import { OAuthStateStore } from './OAuthStateStore';

const DEFAULT_FIRST_NAME = 'Nuevo';
const DEFAULT_LAST_NAME = 'Usuario';
const DEFAULT_PHONE = '+0000000000';
const DEFAULT_GRAPH_VERSION = 'v19.0';

type FacebookProfile = {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  picture: string | null;
};

type FacebookTokenResponse = {
  access_token?: string;
};

type FacebookUserResponse = {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
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

export class FacebookOAuthService {
  private readonly fetcher: FetchLike;
  private readonly stateStore: OAuthStateStore;

  constructor(fetcher?: FetchLike, stateStore?: OAuthStateStore) {
    this.fetcher = fetcher || fetch.bind(globalThis);
    this.stateStore = stateStore || new OAuthStateStore();
  }

  isConfigured() {
    return Boolean(this.getClientId() && this.getClientSecret() && this.getRedirectUri());
  }

  getStateTtlMs() {
    return this.stateStore.getStateTtlMs();
  }

  normalizeReturnTo(value: string | null | undefined) {
    return this.stateStore.normalizeReturnTo(value);
  }

  async createState(returnTo?: string | null, intent: 'login' | 'connect' = 'login') {
    return this.stateStore.createState('facebook', returnTo, intent);
  }

  async consumeState(state: string) {
    return this.stateStore.consumeState('facebook', state);
  }

  async inspectState(state: string) {
    return this.stateStore.inspectState('facebook', state);
  }

  async buildAuthorizationUrl(state: string) {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error('FACEBOOK_OAUTH_CONFIG_INVALID');
    }

    const url = new URL(`https://www.facebook.com/${this.getGraphVersion()}/dialog/oauth`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.getScopes().join(','));
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  async authenticateCallback(input: {
    code: string;
    state: string;
    currentUserId?: number | null;
  }) {
    const { returnTo, intent } = await this.consumeState(input.state);
    const profile = await this.exchangeCodeForProfile(String(input.code || '').trim());
    const userId =
      intent === 'connect'
        ? await this.linkIdentityToUser(profile, input.currentUserId)
        : await this.resolveOrCreateUser(profile);
    return { userId, returnTo, intent };
  }

  private getClientId() {
    return String(process.env.FACEBOOK_OAUTH_CLIENT_ID || '').trim();
  }

  private getClientSecret() {
    return String(process.env.FACEBOOK_OAUTH_CLIENT_SECRET || '').trim();
  }

  private getRedirectUri() {
    const explicit = String(process.env.FACEBOOK_OAUTH_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    const appBase = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!appBase) return '';
    return `${appBase}/api/auth/oauth/facebook/callback`;
  }

  private getScopes() {
    const configured = String(process.env.FACEBOOK_OAUTH_SCOPES || '').trim();
    if (!configured) return ['email', 'public_profile'];
    const scopes = configured.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
    return scopes.length > 0 ? scopes : ['email', 'public_profile'];
  }

  private getGraphVersion() {
    return String(process.env.FACEBOOK_OAUTH_GRAPH_VERSION || '').trim() || DEFAULT_GRAPH_VERSION;
  }

  private async exchangeCodeForProfile(code: string): Promise<FacebookProfile> {
    if (!code) {
      throw new Error('FACEBOOK_OAUTH_CODE_MISSING');
    }

    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('FACEBOOK_OAUTH_CONFIG_INVALID');
    }

    const tokenUrl = new URL(`https://graph.facebook.com/${this.getGraphVersion()}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenResponse = await this.fetcher(tokenUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!tokenResponse.ok) {
      logger.warn({ status: tokenResponse.status }, 'Facebook OAuth token exchange failed');
      throw new Error('FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const tokenData = (await tokenResponse.json()) as FacebookTokenResponse;
    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) {
      throw new Error('FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED');
    }

    const profileUrl = new URL(`https://graph.facebook.com/${this.getGraphVersion()}/me`);
    profileUrl.searchParams.set('fields', 'id,email,first_name,last_name,name,picture.type(large)');
    profileUrl.searchParams.set('access_token', accessToken);

    const profileResponse = await this.fetcher(profileUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!profileResponse.ok) {
      logger.warn({ status: profileResponse.status }, 'Facebook OAuth profile fetch failed');
      throw new Error('FACEBOOK_OAUTH_PROFILE_FETCH_FAILED');
    }

    const profile = (await profileResponse.json()) as FacebookUserResponse;
    const providerUserId = String(profile?.id || '').trim();
    const email = normalizeEmail(String(profile?.email || ''));

    if (!providerUserId) {
      throw new Error('FACEBOOK_OAUTH_PROFILE_INVALID');
    }
    if (!email) {
      throw new Error('FACEBOOK_OAUTH_EMAIL_UNAVAILABLE');
    }

    const fallbackName = splitName(String(profile?.name || ''));
    return {
      providerUserId,
      email,
      emailVerified: true,
      firstName: String(profile?.first_name || '').trim() || fallbackName.firstName,
      lastName: String(profile?.last_name || '').trim() || fallbackName.lastName,
      picture: String(profile?.picture?.data?.url || '').trim() || null
    };
  }

  private async resolveOrCreateUser(profile: FacebookProfile) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.FACEBOOK,
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
          provider: UserOAuthProvider.FACEBOOK,
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

  private async linkIdentityToUser(profile: FacebookProfile, currentUserId?: number | null) {
    const userId = Number(currentUserId || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('OAUTH_CONNECT_AUTH_REQUIRED');
    }

    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.userOAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: UserOAuthProvider.FACEBOOK,
            providerUserId: profile.providerUserId
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      if (existingIdentity?.id && existingIdentity.userId !== userId) {
        throw new Error('FACEBOOK_OAUTH_ALREADY_LINKED');
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
          provider: UserOAuthProvider.FACEBOOK,
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
