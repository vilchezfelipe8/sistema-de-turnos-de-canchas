export const NOTIFICATION_RECIPIENT_ROLES = ['CUSTOMER', 'CLUB_STAFF'] as const;
export type NotificationRecipientRole =
  (typeof NOTIFICATION_RECIPIENT_ROLES)[number];
export const SEMANTIC_NOTIFICATION_RECIPIENT_ROLES = [
  'CUSTOMER',
  'CLUB_STAFF',
  'BOOKING_OWNER'
] as const;
export type SemanticNotificationRecipientRole =
  (typeof SEMANTIC_NOTIFICATION_RECIPIENT_ROLES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_PENDING_WARNING',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const WHATSAPP_SENDER_MODES = ['PIQUE_DEFAULT', 'CLUB_OWN'] as const;
export type WhatsappSenderMode = (typeof WHATSAPP_SENDER_MODES)[number];

export const WHATSAPP_PROVIDERS = [
  'META_CLOUD_API',
  'WHATSAPP_WEB_LEGACY',
] as const;
export type WhatsappProvider = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_SENDER_STATUSES = [
  'ACTIVE',
  'DISABLED',
  'PENDING_SETUP',
  'ERROR',
] as const;
export type WhatsappSenderStatus =
  (typeof WHATSAPP_SENDER_STATUSES)[number];

export const WHATSAPP_DELIVERY_STATUSES = [
  'QUEUED',
  'ACCEPTED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
] as const;
export type WhatsappDeliveryStatus =
  (typeof WHATSAPP_DELIVERY_STATUSES)[number];

export const WHATSAPP_META_WEBHOOK_STATUSES = [
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export type WhatsappMetaWebhookStatus =
  (typeof WHATSAPP_META_WEBHOOK_STATUSES)[number];

export const WHATSAPP_TEMPLATE_STATUSES = [
  'ACTIVE',
  'DISABLED',
  'PENDING_APPROVAL',
  'REJECTED',
] as const;
export type WhatsappTemplateStatus =
  (typeof WHATSAPP_TEMPLATE_STATUSES)[number];

export const WHATSAPP_TEMPLATE_CATEGORIES = [
  'UTILITY',
  'MARKETING',
  'AUTHENTICATION',
] as const;
export type WhatsappTemplateCategory =
  (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];

export const NOTIFICATION_REFERENCE_TYPES = ['BOOKING'] as const;
export type NotificationReferenceType =
  (typeof NOTIFICATION_REFERENCE_TYPES)[number];

export type TemplateParamValue = string | number | boolean | null;
export type TemplateParams = Record<string, TemplateParamValue>;
export type NotificationMetadata = Record<string, unknown>;

export const WHATSAPP_CHANNEL = 'WHATSAPP' as const;
export const WHATSAPP_SEND_V2_VERSION = 2 as const;
export const DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE = 'es_AR' as const;

// BOOKING_OWNER stays as a semantic alias of CUSTOMER, not a persisted role.
export type WhatsappSendV2Payload = {
  eventType: NotificationEventType;
  recipientRole: NotificationRecipientRole;
  clubId: number;
  recipientPhone: string;
  referenceType: NotificationReferenceType;
  referenceId: string;
  dedupeKey: string;
  templateParams: TemplateParams;
  templateParameterOrder?: string[];
  metadata?: NotificationMetadata;
};

export type WhatsappSendV2OutboxPayload = WhatsappSendV2Payload & {
  version: typeof WHATSAPP_SEND_V2_VERSION;
  channel: typeof WHATSAPP_CHANNEL;
};

export type SendTemplateMessageInput = {
  senderId: string;
  templateName: string;
  languageCode: string;
  toPhone: string;
  recipientRole: NotificationRecipientRole;
  eventType: NotificationEventType;
  params: TemplateParams;
  templateParameterOrder?: string[];
  outboxMessageId: string;
};

export type SendTemplateMessageResult = {
  status: 'ACCEPTED' | 'FAILED';
  providerMessageId?: string;
  rawResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
};

export type ResolveWhatsappSenderInput = {
  clubId: number;
  recipientRole: NotificationRecipientRole;
  eventType: NotificationEventType;
};

export type ResolveWhatsappSenderResult =
  | {
      ok: true;
      sender: {
        id: string;
        code: string;
        mode: WhatsappSenderMode;
        provider: WhatsappProvider;
        phoneNumberId: string | null;
        wabaId: string | null;
        tokenSecretRef: string | null;
        status: WhatsappSenderStatus;
      };
    }
  | {
      ok: false;
      errorCode:
        | 'WHATSAPP_SENDER_NOT_CONFIGURED'
        | 'WHATSAPP_SENDER_DISABLED'
        | 'WHATSAPP_SENDER_INVALID';
      errorMessage: string;
    };

export type ResolveWhatsappTemplateInput = {
  senderId: string;
  eventType: NotificationEventType;
  recipientRole: NotificationRecipientRole;
  languageCode?: string;
};

export type ResolveWhatsappTemplateResult =
  | {
      ok: true;
      template: {
        id: string;
        templateName: string;
        languageCode: string;
        category: WhatsappTemplateCategory;
        status: WhatsappTemplateStatus;
      };
    }
  | {
      ok: false;
      errorCode:
        | 'WHATSAPP_TEMPLATE_NOT_CONFIGURED'
        | 'WHATSAPP_TEMPLATE_DISABLED'
        | 'WHATSAPP_TEMPLATE_INVALID_ROLE';
      errorMessage: string;
    };

export type WhatsappWebhookVerificationResult =
  | {
      ok: true;
      challenge: string;
    }
  | {
      ok: false;
      statusCode: number;
      errorCode: string;
      errorMessage: string;
    };

export type WhatsappPreflightCheckSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type WhatsappPreflightCheck = {
  key: string;
  severity: WhatsappPreflightCheckSeverity;
  ok: boolean;
  message: string;
};

export type WhatsappV2PreflightResult = {
  ok: boolean;
  status: 'OK' | 'WARN' | 'FAIL';
  checks: WhatsappPreflightCheck[];
};

export function normalizeSemanticRecipientRole(
  role: SemanticNotificationRecipientRole
): NotificationRecipientRole {
  if (role === 'BOOKING_OWNER') {
    return 'CUSTOMER';
  }

  return role;
}
