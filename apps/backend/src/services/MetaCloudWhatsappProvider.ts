import { prisma } from '../prisma';
import {
  type SendTemplateMessageInput,
  type SendTemplateMessageResult,
  type TemplateParamValue
} from '../types/notifications';
import { getWhatsappMetaConfig } from '../utils/whatsappMetaConfig';

type MetaSuccessResponse = {
  messages?: Array<{
    id?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type MetaErrorResponse = {
  error?: {
    message?: string;
    code?: number | string;
    error_subcode?: number | string;
    type?: string;
    fbtrace_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type FetchLike = typeof fetch;

const safeTrim = (value: unknown) => String(value || '').trim();

function sanitizeRawResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload ?? null;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeRawResponse(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (String(key).toLowerCase().includes('token')) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    sanitized[key] = sanitizeRawResponse(value);
  }

  return sanitized;
}

export class MetaCloudWhatsappProvider {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async sendTemplateMessage(
    input: SendTemplateMessageInput
  ): Promise<SendTemplateMessageResult> {
    const sender = await prisma.whatsappSender.findUnique({
      where: { id: input.senderId },
      select: {
        id: true,
        provider: true,
        status: true,
        phoneNumberId: true,
        tokenSecretRef: true
      }
    });

    if (!sender || sender.provider !== 'META_CLOUD_API') {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_SENDER_INVALID',
        errorMessage: 'Sender inexistente o no compatible con Meta Cloud API',
        retryable: false
      };
    }

    if (sender.status !== 'ACTIVE') {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_SENDER_INVALID',
        errorMessage: `Sender no activo para Meta Cloud API. status=${sender.status}`,
        retryable: false
      };
    }

    if (!sender.phoneNumberId) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_PHONE_NUMBER_ID_MISSING',
        errorMessage: 'El sender no tiene phoneNumberId configurado',
        retryable: false
      };
    }

    const tokenSecretRef = safeTrim(sender.tokenSecretRef);
    if (!tokenSecretRef) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_TOKEN_NOT_CONFIGURED',
        errorMessage: 'El sender no tiene tokenSecretRef configurado',
        retryable: false
      };
    }

    const accessToken = safeTrim(process.env[tokenSecretRef]);
    if (!accessToken) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_TOKEN_NOT_CONFIGURED',
        errorMessage: `No existe secreto cargado para ${tokenSecretRef}`,
        retryable: false
      };
    }

    const config = getWhatsappMetaConfig();
    const url =
      `${config.graphApiBaseUrl}/${config.graphApiVersion}/` +
      `${encodeURIComponent(sender.phoneNumberId)}/messages`;

    const body = this.buildTemplateRequestBody(input);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('WHATSAPP_META_TIMEOUT')),
      config.requestTimeoutMs
    );

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));
      const rawResponse = sanitizeRawResponse(payload);

      if (response.ok) {
        const providerMessageId = safeTrim(
          (payload as MetaSuccessResponse)?.messages?.[0]?.id
        );

        return {
          status: 'ACCEPTED',
          providerMessageId: providerMessageId || undefined,
          rawResponse
        };
      }

      return this.mapMetaErrorResponse(response.status, payload, rawResponse);
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message === 'WHATSAPP_META_TIMEOUT') {
        return {
          status: 'FAILED',
          errorCode: 'WHATSAPP_META_TEMPORARY_ERROR',
          errorMessage: 'Timeout comunicando con Meta Cloud API',
          retryable: true
        };
      }

      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_TEMPORARY_ERROR',
        errorMessage: 'Error de red comunicando con Meta Cloud API',
        retryable: true
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  buildTemplateRequestBody(input: SendTemplateMessageInput) {
    return {
      messaging_product: 'whatsapp',
      to: safeTrim(input.toPhone),
      type: 'template',
      template: {
        name: safeTrim(input.templateName),
        language: {
          code: safeTrim(input.languageCode)
        },
        components: [
          {
            type: 'body',
            parameters: this.buildTemplateParameters(input)
          }
        ]
      }
    };
  }

  buildTemplateParameters(input: SendTemplateMessageInput) {
    const order =
      Array.isArray(input.templateParameterOrder) && input.templateParameterOrder.length > 0
        ? input.templateParameterOrder
        : Object.keys(input.params).sort((a, b) => a.localeCompare(b));

    return order.map((key) => ({
      type: 'text',
      text: this.serializeTemplateParam(input.params[key])
    }));
  }

  private serializeTemplateParam(value: TemplateParamValue): string {
    if (value == null) return '';
    return String(value);
  }

  private mapMetaErrorResponse(
    statusCode: number,
    payload: unknown,
    rawResponse: unknown
  ): SendTemplateMessageResult {
    const metaError = (payload as MetaErrorResponse)?.error;
    const message =
      safeTrim(metaError?.message) ||
      `Meta Cloud API devolvi\u00f3 error HTTP ${statusCode}`;

    if (statusCode === 401 || statusCode === 403) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_AUTH_FAILED',
        errorMessage: message,
        rawResponse,
        retryable: false
      };
    }

    if (statusCode === 429) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_RATE_LIMITED',
        errorMessage: message,
        rawResponse,
        retryable: true
      };
    }

    if (statusCode >= 500) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_TEMPORARY_ERROR',
        errorMessage: message,
        rawResponse,
        retryable: true
      };
    }

    if (statusCode === 400) {
      return {
        status: 'FAILED',
        errorCode: 'WHATSAPP_META_PERMANENT_ERROR',
        errorMessage: message,
        rawResponse,
        retryable: false
      };
    }

    return {
      status: 'FAILED',
      errorCode: 'WHATSAPP_META_REQUEST_FAILED',
      errorMessage: message,
      rawResponse,
      retryable: statusCode >= 500
    };
  }
}
