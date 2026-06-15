import { OutboxMessage, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { featureFlags } from '../config/featureFlags';
import { MetaCloudWhatsappProvider } from './MetaCloudWhatsappProvider';
import { WhatsappNotificationPolicyService } from './WhatsappNotificationPolicyService';
import { WhatsappSenderResolver } from './WhatsappSenderResolver';
import { WhatsappTemplateResolver } from './WhatsappTemplateResolver';
import { getWhatsappMetaConfig } from '../utils/whatsappMetaConfig';
import {
  WHATSAPP_CHANNEL,
  WHATSAPP_SEND_V2_VERSION,
  type SendTemplateMessageInput,
  type WhatsappSendV2OutboxPayload,
  type WhatsappSendV2Payload,
} from '../types/notifications';

type DbClient = Prisma.TransactionClient | PrismaClient;

type DispatchableOutboxMessage = Pick<
  OutboxMessage,
  'id' | 'clubId' | 'type' | 'payload' | 'aggregateType' | 'aggregateId' | 'dedupeKey'
>;

type DispatcherDependencies = {
  db?: DbClient;
  policy?: WhatsappNotificationPolicyService;
  senderResolver?: WhatsappSenderResolver;
  templateResolver?: WhatsappTemplateResolver;
  provider?: MetaCloudWhatsappProvider;
};

export type WhatsappSendV2DispatchResult =
  | {
      ok: true;
      providerMessageId: string | null;
      outboxLastError: null;
    }
  | {
      ok: false;
      retryable: boolean;
      errorCode: string;
      errorMessage: string;
      outboxLastError: string;
    };

const toInputJson = (value: unknown) => value as Prisma.InputJsonValue;

const formatOutboxLastError = (errorCode: string, errorMessage: string) =>
  `${errorCode}: ${errorMessage}`;

const maskPhone = (phone: string) =>
  phone.length <= 4 ? phone : `${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;

export class WhatsappSendV2Dispatcher {
  private readonly db: DbClient;
  private readonly policy: WhatsappNotificationPolicyService;
  private readonly senderResolver: WhatsappSenderResolver;
  private readonly templateResolver: WhatsappTemplateResolver;
  private readonly provider: MetaCloudWhatsappProvider;

  constructor(deps: DispatcherDependencies = {}) {
    this.db = deps.db || prisma;
    this.policy = deps.policy || new WhatsappNotificationPolicyService();
    this.senderResolver = deps.senderResolver || new WhatsappSenderResolver();
    this.templateResolver = deps.templateResolver || new WhatsappTemplateResolver();
    this.provider = deps.provider || new MetaCloudWhatsappProvider();
  }

  async dispatch(
    message: DispatchableOutboxMessage
  ): Promise<WhatsappSendV2DispatchResult> {
    const existingDelivery = await this.db.whatsappDelivery.findUnique({
      where: { outboxMessageId: message.id },
    });

    const parsedPayload = this.parseOutboxPayload(message.payload);
    if (!parsedPayload.ok) {
      if (existingDelivery) {
        await this.db.whatsappDelivery.update({
          where: { id: existingDelivery.id },
          data: {
            status: 'FAILED',
            errorCode: parsedPayload.errorCode,
            errorMessage: parsedPayload.errorMessage,
            updatedAt: new Date(),
          },
        });
      }

      return {
        ok: false,
        retryable: false,
        errorCode: parsedPayload.errorCode,
        errorMessage: parsedPayload.errorMessage,
        outboxLastError: formatOutboxLastError(
          parsedPayload.errorCode,
          parsedPayload.errorMessage
        ),
      };
    }

    const payload = parsedPayload.payload;
    const delivery = existingDelivery
      ? await this.db.whatsappDelivery.update({
          where: { id: existingDelivery.id },
          data: {
            recipientRole: payload.recipientRole,
            recipientPhone: payload.recipientPhone,
            eventType: payload.eventType,
            provider: 'META_CLOUD_API',
            updatedAt: new Date(),
          },
        })
      : await this.db.whatsappDelivery.create({
          data: {
            clubId: payload.clubId,
            outboxMessageId: message.id,
            recipientRole: payload.recipientRole,
            recipientPhone: payload.recipientPhone,
            eventType: payload.eventType,
            provider: 'META_CLOUD_API',
            status: 'QUEUED',
          },
        });

    const senderResult = await this.senderResolver.resolve({
      clubId: payload.clubId,
      recipientRole: payload.recipientRole,
      eventType: payload.eventType,
    });

    if (!senderResult.ok) {
      await this.db.whatsappDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorCode: senderResult.errorCode,
          errorMessage: senderResult.errorMessage,
          updatedAt: new Date(),
        },
      });

      return {
        ok: false,
        retryable: false,
        errorCode: senderResult.errorCode,
        errorMessage: senderResult.errorMessage,
        outboxLastError: formatOutboxLastError(
          senderResult.errorCode,
          senderResult.errorMessage
        ),
      };
    }

    const templateResult = await this.templateResolver.resolve({
      senderId: senderResult.sender.id,
      eventType: payload.eventType,
      recipientRole: payload.recipientRole,
    });

    if (!templateResult.ok) {
      await this.db.whatsappDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          senderId: senderResult.sender.id,
          errorCode: templateResult.errorCode,
          errorMessage: templateResult.errorMessage,
          updatedAt: new Date(),
        },
      });

      return {
        ok: false,
        retryable: false,
        errorCode: templateResult.errorCode,
        errorMessage: templateResult.errorMessage,
        outboxLastError: formatOutboxLastError(
          templateResult.errorCode,
          templateResult.errorMessage
        ),
      };
    }

    const providerInput: SendTemplateMessageInput = {
      senderId: senderResult.sender.id,
      templateName: templateResult.template.templateName,
      languageCode: templateResult.template.languageCode,
      toPhone: payload.recipientPhone,
      recipientRole: payload.recipientRole,
      eventType: payload.eventType,
      params: payload.templateParams,
      templateParameterOrder: payload.templateParameterOrder,
      outboxMessageId: message.id,
    };

    const rawRequest = this.provider.buildTemplateRequestBody(providerInput);

    if (featureFlags.ENABLE_WHATSAPP_V2_DRY_RUN) {
      await this.db.whatsappDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SKIPPED',
          senderId: senderResult.sender.id,
          templateMappingId: templateResult.template.id,
          rawRequest: toInputJson(rawRequest),
          rawResponse: toInputJson({ mode: 'DRY_RUN' }),
          errorCode: 'WHATSAPP_V2_DRY_RUN',
          errorMessage: 'Dry-run activo: no se llamó a Meta Cloud API.',
          updatedAt: new Date(),
        },
      });

      console.info('[WHATSAPP_V2_DISPATCH] dry-run skip', {
        outboxMessageId: message.id,
        whatsappDeliveryId: delivery.id,
        eventType: payload.eventType,
        recipientRole: payload.recipientRole,
        clubId: payload.clubId,
        errorCode: 'WHATSAPP_V2_DRY_RUN'
      });

      return {
        ok: true,
        providerMessageId: null,
        outboxLastError: null,
      };
    }

    const metaConfig = getWhatsappMetaConfig();
    if (
      metaConfig.recipientAllowlist.length > 0 &&
      !metaConfig.recipientAllowlist.includes(payload.recipientPhone)
    ) {
      await this.db.whatsappDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SKIPPED',
          senderId: senderResult.sender.id,
          templateMappingId: templateResult.template.id,
          rawRequest: toInputJson(rawRequest),
          rawResponse: toInputJson({ mode: 'ALLOWLIST_BLOCKED' }),
          errorCode: 'WHATSAPP_RECIPIENT_NOT_ALLOWLISTED',
          errorMessage: 'Destinatario fuera de allowlist para envíos reales.',
          updatedAt: new Date(),
        },
      });

      console.warn('[WHATSAPP_V2_DISPATCH] allowlist blocked recipient', {
        outboxMessageId: message.id,
        whatsappDeliveryId: delivery.id,
        eventType: payload.eventType,
        recipientRole: payload.recipientRole,
        clubId: payload.clubId,
        recipientPhoneMasked: maskPhone(payload.recipientPhone),
        errorCode: 'WHATSAPP_RECIPIENT_NOT_ALLOWLISTED'
      });

      return {
        ok: true,
        providerMessageId: null,
        outboxLastError: null,
      };
    }

    console.info('[WHATSAPP_V2_DISPATCH] dispatching to provider', {
      outboxMessageId: message.id,
      whatsappDeliveryId: delivery.id,
      eventType: payload.eventType,
      recipientRole: payload.recipientRole,
      clubId: payload.clubId,
      recipientPhoneMasked: maskPhone(payload.recipientPhone)
    });

    const providerResult = await this.provider.sendTemplateMessage(providerInput);

    if (providerResult.status === 'ACCEPTED') {
      await this.db.whatsappDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'ACCEPTED',
          senderId: senderResult.sender.id,
          templateMappingId: templateResult.template.id,
          providerMessageId: providerResult.providerMessageId || null,
          rawRequest: toInputJson(rawRequest),
          rawResponse: toInputJson(providerResult.rawResponse ?? null),
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        },
      });

      return {
        ok: true,
        providerMessageId: providerResult.providerMessageId || null,
        outboxLastError: null,
      };
    }

    await this.db.whatsappDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        senderId: senderResult.sender.id,
        templateMappingId: templateResult.template.id,
        rawRequest: toInputJson(rawRequest),
        rawResponse: toInputJson(providerResult.rawResponse ?? null),
        errorCode: providerResult.errorCode || 'WHATSAPP_DISPATCH_FAILED',
        errorMessage:
          providerResult.errorMessage || 'No pudimos despachar el mensaje por WhatsApp.',
        updatedAt: new Date(),
      },
    });

    const errorCode = providerResult.errorCode || 'WHATSAPP_DISPATCH_FAILED';
    const errorMessage =
      providerResult.errorMessage || 'No pudimos despachar el mensaje por WhatsApp.';

    return {
      ok: false,
      retryable: Boolean(providerResult.retryable),
      errorCode,
      errorMessage,
      outboxLastError: formatOutboxLastError(errorCode, errorMessage),
    };
  }

  private parseOutboxPayload(payload: unknown):
    | { ok: true; payload: WhatsappSendV2Payload }
    | { ok: false; errorCode: string; errorMessage: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SEND_V2_PAYLOAD_INVALID',
        errorMessage: 'El payload del outbox V2 no tiene un formato válido.',
      };
    }

    const rawPayload = payload as Record<string, unknown>;
    if (rawPayload.version !== WHATSAPP_SEND_V2_VERSION) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SEND_V2_PAYLOAD_INVALID',
        errorMessage: 'El payload del outbox V2 tiene una versión inválida.',
      };
    }

    if (rawPayload.channel !== WHATSAPP_CHANNEL) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SEND_V2_PAYLOAD_INVALID',
        errorMessage: 'El payload del outbox V2 no pertenece al canal WhatsApp.',
      };
    }

    try {
      return {
        ok: true,
        payload: this.policy.validatePayload({
          eventType: rawPayload.eventType as WhatsappSendV2Payload['eventType'],
          recipientRole: rawPayload.recipientRole as WhatsappSendV2Payload['recipientRole'],
          clubId: Number(rawPayload.clubId),
          recipientPhone: String(rawPayload.recipientPhone || ''),
          referenceType:
            rawPayload.referenceType as WhatsappSendV2Payload['referenceType'],
          referenceId: String(rawPayload.referenceId || ''),
          dedupeKey: String(rawPayload.dedupeKey || ''),
          templateParams:
            (rawPayload.templateParams as WhatsappSendV2Payload['templateParams']) || {},
          templateParameterOrder: Array.isArray(rawPayload.templateParameterOrder)
            ? (rawPayload.templateParameterOrder as string[])
            : undefined,
          metadata:
            rawPayload.metadata as WhatsappSendV2Payload['metadata'] | undefined,
        }),
      };
    } catch (error: any) {
      return {
        ok: false,
        errorCode: 'WHATSAPP_SEND_V2_PAYLOAD_INVALID',
        errorMessage:
          error?.message || 'El payload del outbox V2 no pasó las validaciones.',
      };
    }
  }
}
