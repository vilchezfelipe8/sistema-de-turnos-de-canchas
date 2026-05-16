import crypto from 'crypto';
import { AppError, ErrorCodes, conflict } from '../errors';
import { mercadoPagoConfig } from '../utils/mercadoPagoConfig';

type MercadoPagoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  user_id?: string | number;
  expires_in?: number;
  scope?: string;
  live_mode?: boolean;
  token_type?: string;
  [key: string]: unknown;
};

type MercadoPagoPreferenceItem = {
  id?: string;
  title: string;
  description?: string;
  quantity: number;
  currency_id: 'ARS';
  unit_price: number;
  category_id?: string;
};

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
  [key: string]: unknown;
};

type MercadoPagoPaymentResponse = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number | string;
  currency_id?: string;
  payment_type_id?: string;
  date_approved?: string;
  date_last_updated?: string;
  metadata?: Record<string, unknown> | null;
  payer?: {
    email?: string;
  } | null;
  [key: string]: unknown;
};

const safeTrim = (value: unknown) => String(value || '').trim();

export class MercadoPagoService {
  isConfigured() {
    return Boolean(
      mercadoPagoConfig.enabled &&
      mercadoPagoConfig.clientId &&
      mercadoPagoConfig.clientSecret &&
      mercadoPagoConfig.redirectUri
    );
  }

  assertConfigured() {
    if (this.isConfigured()) return;
    throw new AppError({
      statusCode: 503,
      code: ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED,
      message: 'Mercado Pago no está configurado para este entorno.'
    });
  }

  buildAuthorizationUrl(state: string) {
    this.assertConfigured();
    const url = new URL(mercadoPagoConfig.authUrl);
    url.searchParams.set('client_id', mercadoPagoConfig.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('redirect_uri', mercadoPagoConfig.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'offline_access');
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string) {
    this.assertConfigured();
    const payload: Record<string, unknown> = {
      client_id: mercadoPagoConfig.clientId,
      client_secret: mercadoPagoConfig.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: mercadoPagoConfig.redirectUri,
      test_token: mercadoPagoConfig.useTestToken
    };

    return this.postJson<MercadoPagoTokenResponse>('/oauth/token', payload, false);
  }

  async refreshAccessToken(refreshToken: string) {
    this.assertConfigured();
    const payload: Record<string, unknown> = {
      client_id: mercadoPagoConfig.clientId,
      client_secret: mercadoPagoConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    };

    return this.postJson<MercadoPagoTokenResponse>('/oauth/token', payload, false);
  }

  async createPreference(params: {
    accessToken: string;
    title: string;
    description?: string;
    quantity?: number;
    unitPrice: number;
    payer?: {
      name?: string | null;
      surname?: string | null;
      email?: string | null;
    };
    externalReference: string;
    notificationUrl: string;
    successUrl: string;
    pendingUrl: string;
    failureUrl: string;
    metadata?: Record<string, unknown>;
  }) {
    const body = {
      items: [
        {
          id: params.externalReference,
          title: params.title,
          description: params.description || params.title,
          quantity: Number(params.quantity || 1),
          currency_id: 'ARS' as const,
          unit_price: Number(Number(params.unitPrice || 0).toFixed(2))
        } satisfies MercadoPagoPreferenceItem
      ],
      payer: params.payer && params.payer.email
        ? {
            name: safeTrim(params.payer.name) || undefined,
            surname: safeTrim(params.payer.surname) || undefined,
            email: safeTrim(params.payer.email)
          }
        : undefined,
      external_reference: params.externalReference,
      notification_url: params.notificationUrl,
      back_urls: {
        success: params.successUrl,
        pending: params.pendingUrl,
        failure: params.failureUrl
      },
      auto_return: 'approved',
      metadata: params.metadata || undefined
    };

    return this.postJson<MercadoPagoPreferenceResponse>('/checkout/preferences', body, true, params.accessToken);
  }

  async getPayment(accessToken: string, paymentId: string) {
    return this.getJson<MercadoPagoPaymentResponse>(`/v1/payments/${encodeURIComponent(paymentId)}`, accessToken);
  }

  validateWebhookSignature(params: {
    dataId: string;
    xSignature: string | null | undefined;
    xRequestId: string | null | undefined;
  }) {
    const secret = safeTrim(mercadoPagoConfig.webhookSecret);
    if (!secret) return false;

    const xSignature = safeTrim(params.xSignature);
    const xRequestId = safeTrim(params.xRequestId);
    const dataId = safeTrim(params.dataId).toLowerCase();
    if (!xSignature || !xRequestId || !dataId) return false;

    const parts = xSignature.split(',').map((part) => part.trim());
    const ts = parts.find((part) => part.startsWith('ts='))?.slice(3) || '';
    const v1 = parts.find((part) => part.startsWith('v1='))?.slice(3) || '';
    if (!ts || !v1) return false;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const digest = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    const expected = Buffer.from(digest, 'utf8');
    const received = Buffer.from(v1, 'utf8');
    if (expected.length !== received.length) return false;

    return crypto.timingSafeEqual(expected, received);
  }

  private async postJson<T>(
    path: string,
    body: Record<string, unknown>,
    useBearerAccessToken: boolean,
    accessToken?: string
  ): Promise<T> {
    const url = `${mercadoPagoConfig.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (useBearerAccessToken) {
      headers.Authorization = `Bearer ${safeTrim(accessToken)}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    return this.parseMercadoPagoResponse<T>(response);
  }

  private async getJson<T>(path: string, accessToken: string): Promise<T> {
    const url = `${mercadoPagoConfig.apiBaseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${safeTrim(accessToken)}`,
        'Content-Type': 'application/json'
      }
    });

    return this.parseMercadoPagoResponse<T>(response);
  }

  private async parseMercadoPagoResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      return payload as T;
    }

    const message =
      safeTrim((payload as any)?.message) ||
      safeTrim((payload as any)?.error_description) ||
      safeTrim((payload as any)?.error) ||
      'Mercado Pago devolvió un error.';

    const code =
      response.status === 401 || response.status === 403
        ? ErrorCodes.PAYMENT_PROVIDER_AUTH_FAILED
        : ErrorCodes.CHECKOUT_NOT_AVAILABLE;

    throw conflict(message, code, {
      provider: 'MERCADO_PAGO',
      status: response.status,
      payload
    });
  }
}
