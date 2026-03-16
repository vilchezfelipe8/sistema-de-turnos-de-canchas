import crypto from 'crypto';
import { GatewayTransactionStatus, GatewayTransactionType } from '@prisma/client';

type OAuthStatePayload = {
  clubId: number;
  providerAccountId?: string;
  iat: number;
  exp: number;
  nonce: string;
};

type MercadoPagoOAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  public_key?: string;
  refresh_token?: string;
  live_mode?: boolean;
  user_id?: number;
  expires_in?: number;
  scope?: string;
};

type MercadoPagoPaymentDetails = {
  id: number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_details?: {
    net_received_amount?: number;
    total_paid_amount?: number;
  };
  fee_details?: Array<{ amount?: number }>;
  date_created?: string;
  date_approved?: string;
  date_last_updated?: string;
  external_reference?: string;
  metadata?: Record<string, unknown>;
};

type ParsedWebhook = {
  externalId: string;
  type: GatewayTransactionType;
  status: GatewayTransactionStatus;
  amount: number;
  netAmount?: number;
  feeAmount?: number;
  occurredAt?: Date;
  settledAt?: Date;
  externalReference?: string;
  paymentId?: string;
  refundId?: string;
  rawPayload: Record<string, unknown>;
};

export class MercadoPagoService {
  private getClientId() {
    const value = process.env.MP_CLIENT_ID?.trim();
    if (!value) throw new Error('Falta MP_CLIENT_ID en variables de entorno');
    return value;
  }

  private getClientSecret() {
    const value = process.env.MP_CLIENT_SECRET?.trim();
    if (!value) throw new Error('Falta MP_CLIENT_SECRET en variables de entorno');
    return value;
  }

  private getOauthRedirectUri() {
    const value = process.env.MP_OAUTH_REDIRECT_URI?.trim();
    if (!value) throw new Error('Falta MP_OAUTH_REDIRECT_URI en variables de entorno');
    return value;
  }

  private getOauthBaseUrl() {
    return process.env.MP_OAUTH_BASE_URL?.trim() || 'https://auth.mercadopago.com.ar/authorization';
  }

  private getApiBaseUrl() {
    return process.env.MP_API_BASE_URL?.trim() || 'https://api.mercadopago.com';
  }

  private getStateSecret() {
    return process.env.MP_OAUTH_STATE_SECRET?.trim() || process.env.JWT_SECRET?.trim() || '';
  }

  private base64UrlEncode(input: string) {
    return Buffer.from(input, 'utf8').toString('base64url');
  }

  private base64UrlDecode(input: string) {
    return Buffer.from(input, 'base64url').toString('utf8');
  }

  private signPayload(payload: string) {
    const secret = this.getStateSecret();
    if (!secret) throw new Error('Falta MP_OAUTH_STATE_SECRET (o JWT_SECRET) para firmar estado OAuth');
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private mapPaymentStatus(status?: string): GatewayTransactionStatus {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'approved') return 'APPROVED';
    if (normalized === 'in_process') return 'IN_PROCESS';
    if (normalized === 'rejected') return 'REJECTED';
    if (normalized === 'cancelled') return 'CANCELLED';
    if (normalized === 'refunded' || normalized === 'charged_back') return 'REFUNDED';
    return 'PENDING';
  }

  private parseIsoDate(value: unknown) {
    if (!value || typeof value !== 'string') return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private readExternalReferenceCandidate(rawPayload: Record<string, unknown>) {
    const direct = typeof rawPayload.external_reference === 'string'
      ? rawPayload.external_reference
      : undefined;
    if (direct) return direct;

    const data = rawPayload.data;
    if (data && typeof data === 'object' && data != null) {
      const record = data as Record<string, unknown>;
      if (typeof record.external_reference === 'string') {
        return record.external_reference;
      }
    }
    return undefined;
  }

  buildOAuthStartUrl(params: { clubId: number; providerAccountId?: string }) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 10 * 60;
    const statePayload: OAuthStatePayload = {
      clubId: params.clubId,
      providerAccountId: params.providerAccountId,
      iat: now,
      exp,
      nonce: crypto.randomUUID()
    };

    const serialized = JSON.stringify(statePayload);
    const encodedPayload = this.base64UrlEncode(serialized);
    const signature = this.signPayload(encodedPayload);
    const state = `${encodedPayload}.${signature}`;

    const url = new URL(this.getOauthBaseUrl());
    url.searchParams.set('client_id', this.getClientId());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('redirect_uri', this.getOauthRedirectUri());
    url.searchParams.set('state', state);

    return { authorizationUrl: url.toString(), state };
  }

  verifyOAuthState(rawState: string) {
    const value = String(rawState || '').trim();
    const parts = value.split('.');
    if (parts.length !== 2) throw new Error('Estado OAuth invalido');
    const [encodedPayload, signature] = parts;

    const expected = this.signPayload(encodedPayload);
    const left = Buffer.from(signature, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length) throw new Error('Firma de estado OAuth invalida');
    const valid = crypto.timingSafeEqual(left, right);
    if (!valid) throw new Error('Firma de estado OAuth invalida');

    const payload = JSON.parse(this.base64UrlDecode(encodedPayload)) as OAuthStatePayload;
    if (!payload.clubId || !payload.iat || !payload.exp || !payload.nonce) {
      throw new Error('Estado OAuth incompleto');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error('Estado OAuth expirado');

    return payload;
  }

  async exchangeOAuthCode(code: string): Promise<MercadoPagoOAuthTokenResponse> {
    const response = await fetch(`${this.getApiBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
        code,
        redirect_uri: this.getOauthRedirectUri()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data as any)?.message || (data as any)?.error_description || 'Error OAuth Mercado Pago';
      throw new Error(message);
    }

    const parsed = data as MercadoPagoOAuthTokenResponse;
    if (!parsed.access_token) {
      throw new Error('Mercado Pago no devolvio access_token');
    }
    return parsed;
  }

  async fetchPaymentById(accessToken: string, paymentId: string) {
    const response = await fetch(`${this.getApiBaseUrl()}/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data as any)?.message || 'No se pudo consultar el pago en Mercado Pago';
      throw new Error(message);
    }

    return data as MercadoPagoPaymentDetails;
  }

  validateWebhookSignature(params: {
    rawBody: string;
    headerSignature?: string | null;
    headerRequestId?: string | null;
    dataId?: string | null;
    secret?: string | null;
  }) {
    const secret = String(params.secret || '').trim();
    const header = String(params.headerSignature || '').trim();
    if (!secret) return true;
    if (!header) return false;

    const directExpected = crypto.createHmac('sha256', secret).update(params.rawBody).digest('hex');
    const requestId = String(params.headerRequestId || '').trim();

    // format: sha256=<hex>
    if (header.includes('sha256=')) {
      const match = header.match(/sha256=([a-fA-F0-9]+)/);
      if (!match) return false;
      return match[1].toLowerCase() === directExpected.toLowerCase();
    }

    // format: ts=...,v1=<hex>
    const tsMatch = header.match(/ts=([^,]+)/);
    const v1Match = header.match(/v1=([a-fA-F0-9]+)/);
    if (v1Match) {
      const rawDataId = String(params.dataId || '').trim();
      const normalizedDataId = /^[a-zA-Z0-9]+$/.test(rawDataId)
        ? rawDataId.toLowerCase()
        : rawDataId;

      if (tsMatch && requestId && normalizedDataId) {
        const manifest = `id:${normalizedDataId};request-id:${requestId};ts:${tsMatch[1]};`;
        const manifestExpected = crypto
          .createHmac('sha256', secret)
          .update(manifest)
          .digest('hex');
        if (v1Match[1].toLowerCase() === manifestExpected.toLowerCase()) {
          return true;
        }
      }

      const withTsExpected = crypto
        .createHmac('sha256', secret)
        .update(tsMatch ? `${tsMatch[1]}.${params.rawBody}` : params.rawBody)
        .digest('hex');

      const incoming = v1Match[1].toLowerCase();
      return incoming === withTsExpected.toLowerCase() || incoming === directExpected.toLowerCase();
    }

    return false;
  }

  async parseWebhookToGatewayTransaction(params: {
    rawPayload: Record<string, unknown>;
    accessToken?: string;
  }): Promise<ParsedWebhook> {
    const payload = params.rawPayload || {};
    const payloadType = String(payload.type || payload.topic || '').toLowerCase();
    const data = (payload.data && typeof payload.data === 'object'
      ? payload.data
      : {}) as Record<string, unknown>;

    const paymentIdFromPayload =
      typeof data.id === 'string'
        ? data.id
        : typeof data.id === 'number'
          ? String(data.id)
          : typeof payload.id === 'string'
            ? payload.id
            : typeof payload.id === 'number'
              ? String(payload.id)
              : '';

    if (!paymentIdFromPayload) {
      throw new Error('Webhook Mercado Pago sin identificador de pago');
    }

    let details: MercadoPagoPaymentDetails | null = null;
    if (params.accessToken) {
      details = await this.fetchPaymentById(params.accessToken, paymentIdFromPayload);
    }

    const externalReference =
      details?.external_reference ||
      this.readExternalReferenceCandidate(payload) ||
      undefined;
    const metadata = (details?.metadata || {}) as Record<string, unknown>;

    const feeAmount = Array.isArray(details?.fee_details)
      ? details!.fee_details.reduce((sum, fee) => sum + Number(fee?.amount || 0), 0)
      : undefined;
    const amount = Number(details?.transaction_amount || payload.transaction_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('No se pudo resolver un monto valido del webhook');
    }

    const status = this.mapPaymentStatus(details?.status || String(payload.status || ''));
    const occurredAt =
      this.parseIsoDate(details?.date_created) ||
      this.parseIsoDate((payload as any).date_created);
    const settledAt =
      this.parseIsoDate(details?.date_approved) ||
      this.parseIsoDate(details?.date_last_updated);

    const paymentIdCandidate = typeof metadata.paymentId === 'string' ? metadata.paymentId : undefined;
    const refundIdCandidate = typeof metadata.refundId === 'string' ? metadata.refundId : undefined;

    return {
      externalId: paymentIdFromPayload,
      type: payloadType === 'chargebacks' ? 'CHARGEBACK' : 'PAYMENT',
      status,
      amount,
      netAmount: details?.transaction_details?.net_received_amount,
      feeAmount: feeAmount,
      occurredAt,
      settledAt,
      externalReference,
      paymentId: paymentIdCandidate,
      refundId: refundIdCandidate,
      rawPayload: payload
    };
  }
}
