import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_RECIPIENT_ROLES,
  WHATSAPP_CHANNEL,
  WHATSAPP_SEND_V2_VERSION,
  type NotificationMetadata,
  type TemplateParams,
  type WhatsappSendV2OutboxPayload,
  type WhatsappSendV2Payload
} from '../types/notifications';
import { toDialablePhoneNumber } from '../utils/phone';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSerializableMetadata(value: unknown): boolean {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isSerializableMetadata(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isSerializableMetadata(item));
  }

  return false;
}

function isTemplateParams(value: unknown): value is TemplateParams {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((item) => {
    return (
      item == null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    );
  });
}

function isTemplateParameterOrder(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === 'string' && String(item).trim().length > 0);
}

export class WhatsappNotificationPolicyService {
  validatePayload(input: WhatsappSendV2Payload): WhatsappSendV2Payload {
    if (!NOTIFICATION_EVENT_TYPES.includes(input.eventType)) {
      throw new Error(`eventType inv\u00e1lido para WHATSAPP_SEND_V2: ${String(input.eventType)}`);
    }

    if (String(input.recipientRole || '').trim() === 'BOOKING_OWNER') {
      throw new Error('BOOKING_OWNER no es un rol persistente v\u00e1lido para WHATSAPP_SEND_V2');
    }

    if (!NOTIFICATION_RECIPIENT_ROLES.includes(input.recipientRole)) {
      throw new Error(
        `recipientRole inv\u00e1lido para WHATSAPP_SEND_V2: ${String(input.recipientRole)}`
      );
    }

    if (!Number.isInteger(input.clubId) || input.clubId <= 0) {
      throw new Error('clubId inv\u00e1lido para WHATSAPP_SEND_V2');
    }

    const recipientPhone = toDialablePhoneNumber(input.recipientPhone);
    if (!recipientPhone) {
      throw new Error('recipientPhone inv\u00e1lido para WHATSAPP_SEND_V2');
    }

    if (!String(input.referenceType || '').trim()) {
      throw new Error('referenceType requerido para WHATSAPP_SEND_V2');
    }

    if (!String(input.referenceId || '').trim()) {
      throw new Error('referenceId requerido para WHATSAPP_SEND_V2');
    }

    if (!String(input.dedupeKey || '').trim()) {
      throw new Error('dedupeKey requerido para WHATSAPP_SEND_V2');
    }

    if (!isTemplateParams(input.templateParams)) {
      throw new Error('templateParams inv\u00e1lidos para WHATSAPP_SEND_V2');
    }

    if (
      input.templateParameterOrder != null &&
      !isTemplateParameterOrder(input.templateParameterOrder)
    ) {
      throw new Error('templateParameterOrder inv\u00e1lido para WHATSAPP_SEND_V2');
    }

    if (input.metadata != null && !isSerializableMetadata(input.metadata)) {
      throw new Error('metadata inv\u00e1lida para WHATSAPP_SEND_V2');
    }

    return {
      ...input,
      recipientPhone,
      referenceType: String(input.referenceType).trim() as WhatsappSendV2Payload['referenceType'],
      referenceId: String(input.referenceId).trim(),
      dedupeKey: String(input.dedupeKey).trim(),
      templateParameterOrder: input.templateParameterOrder?.map((item) => String(item).trim()),
      metadata: input.metadata as NotificationMetadata | undefined
    };
  }

  buildOutboxPayload(input: WhatsappSendV2Payload): WhatsappSendV2OutboxPayload {
    const validated = this.validatePayload(input);
    return {
      version: WHATSAPP_SEND_V2_VERSION,
      channel: WHATSAPP_CHANNEL,
      ...validated
    };
  }
}
