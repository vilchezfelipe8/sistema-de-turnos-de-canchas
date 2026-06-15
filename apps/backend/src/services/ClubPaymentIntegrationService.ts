import crypto from 'crypto';
import { PaymentIntegrationStatus, PaymentProvider, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, ErrorCodes, badRequest, forbidden, notFound } from '../errors';
import { MercadoPagoService } from './MercadoPagoService';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../utils/integrationSecrets';
import { mercadoPagoConfig } from '../utils/mercadoPagoConfig';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

type ListClubIntegrationsInput = {
  clubId: number;
  actorUserId: number;
};

type StartMercadoPagoConnectInput = {
  clubId: number;
  actorUserId: number;
};

type HandleMercadoPagoCallbackInput = {
  code?: string | null;
  state?: string | null;
  providerError?: string | null;
  providerErrorDescription?: string | null;
};

type DisconnectMercadoPagoInput = {
  clubId: number;
  actorUserId: number;
};

export type AdminClubPaymentIntegrationDto = {
  provider: 'MERCADO_PAGO';
  status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'ERROR';
  connected: boolean;
  publicKey: string | null;
  externalUserId: string | null;
  connectedBy: {
    id: number;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string;
};

export class ClubPaymentIntegrationService {
  private readonly mercadoPagoService = new MercadoPagoService();

  async listIntegrations(input: ListClubIntegrationsInput): Promise<AdminClubPaymentIntegrationDto[]> {
    await this.assertAdminClubActor(input.clubId, input.actorUserId);

    const existing = await prisma.clubPaymentIntegration.findMany({
      where: {
        clubId: input.clubId
      },
      include: {
        connectedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const byProvider = new Map<string, any>(existing.map((item) => [item.provider, item]));
    const integration = byProvider.get('MERCADO_PAGO') || null;

    return [this.mapAdminIntegrationDto(integration)];
  }

  async startMercadoPagoConnect(input: StartMercadoPagoConnectInput) {
    await this.assertAdminClubActor(input.clubId, input.actorUserId);
    this.mercadoPagoService.assertConfigured();

    const existingIntegration = await prisma.clubPaymentIntegration.findUnique({
      where: {
        clubId_provider: {
          clubId: input.clubId,
          provider: 'MERCADO_PAGO'
        }
      }
    });

    const state = await prisma.paymentProviderOAuthState.create({
      data: {
        clubId: input.clubId,
        provider: 'MERCADO_PAGO',
        userId: input.actorUserId,
        integrationId: existingIntegration?.id ?? null,
        nonce: crypto.randomBytes(24).toString('base64url'),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS)
      }
    });

    return {
      authorizationUrl: this.mercadoPagoService.buildAuthorizationUrl(state.nonce)
    };
  }

  async handleMercadoPagoCallback(input: HandleMercadoPagoCallbackInput) {
    const nonce = String(input.state || '').trim();
    if (!nonce) {
      throw new AppError({
        statusCode: 400,
        code: ErrorCodes.PAYMENT_PROVIDER_STATE_INVALID,
        message: 'La validación de la conexión con Mercado Pago no es válida.'
      });
    }

    const state = await prisma.paymentProviderOAuthState.findUnique({
      where: { nonce },
      include: {
        club: {
          select: {
            id: true,
            slug: true
          }
        }
      }
    });

    if (!state || state.provider !== 'MERCADO_PAGO' || state.consumedAt || state.expiresAt.getTime() < Date.now()) {
      throw new AppError({
        statusCode: 400,
        code: ErrorCodes.PAYMENT_PROVIDER_STATE_INVALID,
        message: 'La conexión con Mercado Pago expiró o ya no es válida.'
      });
    }

    const redirectUrl = this.buildAdminSettingsRedirect(state.club.slug, {
      provider: 'mercadopago',
      status: 'error'
    });

    if (String(input.providerError || '').trim()) {
      throw new AppError({
        statusCode: 400,
        code: ErrorCodes.PAYMENT_PROVIDER_CALLBACK_INVALID,
        message: 'Mercado Pago no pudo completar la autorización.',
        meta: {
          redirectUrl
        }
      });
    }

    const code = String(input.code || '').trim();
    if (!code) {
      throw new AppError({
        statusCode: 400,
        code: ErrorCodes.PAYMENT_PROVIDER_CALLBACK_INVALID,
        message: 'Mercado Pago no devolvió un código de autorización válido.',
        meta: {
          redirectUrl
        }
      });
    }

    const tokenResponse = await this.mercadoPagoService.exchangeAuthorizationCode(code);
    const accessToken = String(tokenResponse.access_token || '').trim();
    const refreshToken = String(tokenResponse.refresh_token || '').trim();
    if (!accessToken || !refreshToken) {
      throw new AppError({
        statusCode: 502,
        code: ErrorCodes.PAYMENT_PROVIDER_AUTH_FAILED,
        message: 'Mercado Pago devolvió una respuesta incompleta durante la conexión.',
        meta: {
          redirectUrl
        }
      });
    }

    const expiresAt = Number(tokenResponse.expires_in || 0) > 0
      ? new Date(Date.now() + Number(tokenResponse.expires_in) * 1000)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.paymentProviderOAuthState.update({
        where: { id: state.id },
        data: { consumedAt: new Date() }
      });

      const integration = await tx.clubPaymentIntegration.upsert({
        where: {
          clubId_provider: {
            clubId: state.clubId,
            provider: 'MERCADO_PAGO'
          }
        },
        create: {
          clubId: state.clubId,
          provider: 'MERCADO_PAGO',
          status: 'CONNECTED',
          accessTokenEnc: encryptIntegrationSecret(accessToken),
          refreshTokenEnc: encryptIntegrationSecret(refreshToken),
          publicKey: String(tokenResponse.public_key || '').trim() || null,
          externalUserId: String(tokenResponse.user_id || '').trim() || null,
          expiresAt,
          connectedById: state.userId,
          disconnectedAt: null
        },
        update: {
          status: 'CONNECTED',
          accessTokenEnc: encryptIntegrationSecret(accessToken),
          refreshTokenEnc: encryptIntegrationSecret(refreshToken),
          publicKey: String(tokenResponse.public_key || '').trim() || null,
          externalUserId: String(tokenResponse.user_id || '').trim() || null,
          expiresAt,
          connectedById: state.userId,
          disconnectedAt: null
        }
      });

      await tx.paymentProviderOAuthState.updateMany({
        where: {
          integrationId: null,
          clubId: state.clubId,
          provider: 'MERCADO_PAGO'
        },
        data: {
          integrationId: integration.id
        }
      });

      await tx.auditLog.create({
        data: {
          clubId: state.clubId,
          userId: state.userId,
          entity: 'CLUB_PAYMENT_INTEGRATION',
          entityId: integration.id,
          action: 'MERCADO_PAGO_CONNECTED',
          payload: {
            provider: 'MERCADO_PAGO',
            externalUserId: integration.externalUserId,
            connectedById: state.userId
          }
        }
      });
    });

    return {
      redirectUrl: this.buildAdminSettingsRedirect(state.club.slug, {
        provider: 'mercadopago',
        status: 'connected'
      })
    };
  }

  async disconnectMercadoPago(input: DisconnectMercadoPagoInput) {
    await this.assertAdminClubActor(input.clubId, input.actorUserId);

    const integration = await prisma.clubPaymentIntegration.findUnique({
      where: {
        clubId_provider: {
          clubId: input.clubId,
          provider: 'MERCADO_PAGO'
        }
      }
    });

    if (!integration) {
      throw notFound('La integración de Mercado Pago no existe para este club.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }

    const updated = await prisma.clubPaymentIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'DISCONNECTED',
        accessTokenEnc: null,
        refreshTokenEnc: null,
        publicKey: null,
        externalUserId: null,
        expiresAt: null,
        disconnectedAt: new Date()
      },
      include: {
        connectedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    await prisma.auditLog.create({
      data: {
        clubId: input.clubId,
        userId: input.actorUserId,
        entity: 'CLUB_PAYMENT_INTEGRATION',
        entityId: integration.id,
        action: 'MERCADO_PAGO_DISCONNECTED',
        payload: {
          provider: 'MERCADO_PAGO'
        }
      }
    });

    return this.mapAdminIntegrationDto(updated);
  }

  async getMercadoPagoAccessTokenForClub(clubId: number): Promise<string | null> {
    const integration = await prisma.clubPaymentIntegration.findUnique({
      where: {
        clubId_provider: {
          clubId,
          provider: 'MERCADO_PAGO'
        }
      }
    });

    if (!integration || integration.status !== 'CONNECTED' || !integration.accessTokenEnc) {
      return null;
    }

    const refreshToken = decryptIntegrationSecret(integration.refreshTokenEnc);
    const accessToken = decryptIntegrationSecret(integration.accessTokenEnc);
    if (!accessToken) return null;

    if (!integration.expiresAt || integration.expiresAt.getTime() - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS) {
      return accessToken;
    }

    if (!refreshToken) {
      await prisma.clubPaymentIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'EXPIRED'
        }
      });
      return null;
    }

    try {
      const refreshed = await this.mercadoPagoService.refreshAccessToken(refreshToken);
      const nextAccessToken = String(refreshed.access_token || '').trim();
      const nextRefreshToken = String(refreshed.refresh_token || '').trim();
      if (!nextAccessToken || !nextRefreshToken) {
        throw new Error('Missing refreshed access token');
      }

      const nextExpiresAt = Number(refreshed.expires_in || 0) > 0
        ? new Date(Date.now() + Number(refreshed.expires_in) * 1000)
        : null;

      await prisma.clubPaymentIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'CONNECTED',
          accessTokenEnc: encryptIntegrationSecret(nextAccessToken),
          refreshTokenEnc: encryptIntegrationSecret(nextRefreshToken),
          publicKey: String(refreshed.public_key || '').trim() || integration.publicKey,
          externalUserId: String(refreshed.user_id || '').trim() || integration.externalUserId,
          expiresAt: nextExpiresAt
        }
      });

      return nextAccessToken;
    } catch {
      await prisma.clubPaymentIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'EXPIRED'
        }
      });
      return null;
    }
  }

  async getMercadoPagoIntegrationStatusForClub(clubId: number) {
    if (!mercadoPagoConfig.enabled || !this.mercadoPagoService.isConfigured()) {
      return {
        connected: false,
        status: 'DISCONNECTED' as PaymentIntegrationStatus
      };
    }

    const integration = await prisma.clubPaymentIntegration.findUnique({
      where: {
        clubId_provider: {
          clubId,
          provider: 'MERCADO_PAGO'
        }
      }
    });

    return {
      connected: Boolean(integration && integration.status === 'CONNECTED'),
      status: integration?.status || 'DISCONNECTED'
    };
  }

  private async assertAdminClubActor(clubId: number, actorUserId: number) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_clubId: {
          userId: actorUserId,
          clubId
        }
      },
      select: {
        role: true
      }
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw forbidden('No tenés permiso para gestionar integraciones de pago.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }
  }

  private mapAdminIntegrationDto(integration: (Prisma.ClubPaymentIntegrationGetPayload<{
    include: {
      connectedBy: {
        select: {
          id: true;
          email: true;
          firstName: true;
          lastName: true;
        };
      };
    };
  }>) | null): AdminClubPaymentIntegrationDto {
    return {
      provider: 'MERCADO_PAGO',
      status: integration?.status || 'DISCONNECTED',
      connected: Boolean(integration && integration.status === 'CONNECTED'),
      publicKey: integration?.publicKey || null,
      externalUserId: integration?.externalUserId || null,
      connectedBy: integration?.connectedBy || null,
      connectedAt: integration?.createdAt ? integration.createdAt.toISOString() : null,
      disconnectedAt: integration?.disconnectedAt ? integration.disconnectedAt.toISOString() : null,
      updatedAt: (integration?.updatedAt || new Date(0)).toISOString()
    };
  }

  private buildAdminSettingsRedirect(
    clubSlug: string,
    params: { provider: string; status: 'connected' | 'error' | 'disconnected' }
  ) {
    const url = new URL(`${mercadoPagoConfig.frontendUrl}/admin/ajustes`);
    url.searchParams.set('tab', 'integraciones');
    url.searchParams.set('provider', params.provider);
    url.searchParams.set('integrationStatus', params.status);
    url.searchParams.set('club', clubSlug);
    return url.toString();
  }
}
