import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { featureFlags } from '../config/featureFlags';
import { prisma } from '../prisma';
import {
  WHATSAPP_META_WEBHOOK_STATUSES,
  type WhatsappDeliveryStatus,
  type WhatsappMetaWebhookStatus,
  type WhatsappWebhookVerificationResult,
} from '../types/notifications';
import { getWhatsappMetaConfig } from '../utils/whatsappMetaConfig';

type TransactionClient = Parameters<typeof prisma.$transaction>[0] extends (
  tx: infer T
) => Promise<unknown>
  ? T
  : typeof prisma;

type MetaWebhookStatusEvent = {
  providerEventId: string;
  providerMessageId: string | null;
  senderPhoneNumberId: string | null;
  externalStatus: string | null;
  mappedStatus: WhatsappDeliveryStatus | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerConversationId: string | null;
  rawPayload: Record<string, unknown>;
};

type MetaWebhookGenericEvent = {
  providerEventId: string | null;
  providerMessageId: string | null;
  senderPhoneNumberId: string | null;
  eventType: string;
  rawPayload: Record<string, unknown>;
};

type WhatsappWebhookProcessResult = {
  acknowledged: true;
  ignored: boolean;
  reason?: 'FEATURE_DISABLED';
  persistedEvents: number;
  duplicateEvents: number;
  orphanEvents: number;
  updatedDeliveries: number;
  inboundEvents: number;
  unknownEvents: number;
};

type ProcessorDependencies = {
  db?: typeof prisma;
  flags?: typeof featureFlags;
};

const STATUS_RANK: Record<
  Exclude<WhatsappDeliveryStatus, 'FAILED' | 'SKIPPED'>,
  number
> = {
  QUEUED: 0,
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

const isMetaWebhookStatus = (
  value: string | null | undefined
): value is WhatsappMetaWebhookStatus =>
  WHATSAPP_META_WEBHOOK_STATUSES.includes(
    String(value || '').trim().toLowerCase() as WhatsappMetaWebhookStatus
  );

export function mapMetaStatusToWhatsappDeliveryStatus(
  status: string | null | undefined
): WhatsappDeliveryStatus | null {
  const normalized = String(status || '').trim().toLowerCase();
  if (!isMetaWebhookStatus(normalized)) {
    return null;
  }

  switch (normalized) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

export function shouldApplyWhatsappDeliveryStatusTransition(
  currentStatus: WhatsappDeliveryStatus,
  nextStatus: WhatsappDeliveryStatus
): boolean {
  if (currentStatus === nextStatus) {
    return false;
  }

  if (nextStatus === 'FAILED') {
    return currentStatus !== 'READ';
  }

  if (currentStatus === 'FAILED') {
    return nextStatus === 'DELIVERED' || nextStatus === 'READ';
  }

  if (currentStatus === 'SKIPPED' || nextStatus === 'SKIPPED') {
    return false;
  }

  if (currentStatus === 'READ') {
    return false;
  }

  return STATUS_RANK[nextStatus as keyof typeof STATUS_RANK] >
    STATUS_RANK[currentStatus as keyof typeof STATUS_RANK];
}

const buildStableProviderEventId = (parts: Array<string | null | undefined>) => {
  const serialized = parts
    .map((part) => String(part || '').trim())
    .join('|');
  return createHash('sha256').update(serialized).digest('hex');
};

const isUniqueConstraintError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
  );

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const extractFailedMeta = (status: Record<string, unknown>) => {
  const errors = asArray(status.errors);
  const firstError = asRecord(errors[0]);
  const code = String(firstError.code || '').trim() || null;
  const title = String(firstError.title || '').trim();
  const details = String(firstError.details || '').trim();
  const message = [title, details].filter(Boolean).join(' - ').trim();

  return {
    errorCode: code,
    errorMessage: message || null,
  };
};

export class WhatsappWebhookProcessor {
  private readonly db: typeof prisma;
  private readonly flags: typeof featureFlags;

  constructor(deps: ProcessorDependencies = {}) {
    this.db = deps.db || prisma;
    this.flags = deps.flags || featureFlags;
  }

  verifyWebhook(input: {
    mode?: string | null;
    verifyToken?: string | null;
    challenge?: string | null;
  }): WhatsappWebhookVerificationResult {
    const mode = String(input.mode || '').trim();
    const verifyToken = String(input.verifyToken || '').trim();
    const challenge = String(input.challenge || '').trim();
    const { webhookVerifyToken } = getWhatsappMetaConfig();

    if (mode !== 'subscribe') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'El modo de verificación del webhook no es válido.',
      };
    }

    if (!challenge || !verifyToken) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_INPUT',
        errorMessage: 'Faltan parámetros obligatorios para verificar el webhook.',
      };
    }

    if (!webhookVerifyToken) {
      return {
        ok: false,
        statusCode: 503,
        errorCode: 'WHATSAPP_WEBHOOK_VERIFY_NOT_CONFIGURED',
        errorMessage: 'La verificación del webhook de WhatsApp no está configurada.',
      };
    }

    if (verifyToken !== webhookVerifyToken) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        errorMessage: 'El verify token de WhatsApp no es válido.',
      };
    }

    return { ok: true, challenge };
  }

  async processWebhook(payload: unknown): Promise<WhatsappWebhookProcessResult> {
    if (!this.flags.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR) {
      return {
        acknowledged: true,
        ignored: true,
        reason: 'FEATURE_DISABLED',
        persistedEvents: 0,
        duplicateEvents: 0,
        orphanEvents: 0,
        updatedDeliveries: 0,
        inboundEvents: 0,
        unknownEvents: 0,
      };
    }

    const statusEvents = this.extractStatusEvents(payload);
    const inboundEvents = this.extractInboundEvents(payload);
    const unknownEvents = this.extractUnknownEvents(payload);

    let persistedEvents = 0;
    let duplicateEvents = 0;
    let orphanEvents = 0;
    let updatedDeliveries = 0;

    for (const event of statusEvents) {
      const result = await this.persistStatusEvent(event);
      if (result.duplicate) {
        duplicateEvents += 1;
        continue;
      }

      persistedEvents += 1;
      if (result.orphan) {
        orphanEvents += 1;
      }
      if (result.updatedDelivery) {
        updatedDeliveries += 1;
      }
    }

    for (const event of inboundEvents) {
      const result = await this.persistGenericEvent(event);
      if (result.duplicate) {
        duplicateEvents += 1;
        continue;
      }
      persistedEvents += 1;
      orphanEvents += 1;
    }

    for (const event of unknownEvents) {
      const result = await this.persistGenericEvent(event);
      if (result.duplicate) {
        duplicateEvents += 1;
        continue;
      }
      persistedEvents += 1;
      orphanEvents += 1;
    }

    return {
      acknowledged: true,
      ignored: false,
      persistedEvents,
      duplicateEvents,
      orphanEvents,
      updatedDeliveries,
      inboundEvents: inboundEvents.length,
      unknownEvents: unknownEvents.length,
    };
  }

  private extractStatusEvents(payload: unknown): MetaWebhookStatusEvent[] {
    const events: MetaWebhookStatusEvent[] = [];

    for (const envelope of this.extractChangeEnvelopes(payload)) {
      const statuses = asArray(envelope.value.statuses);
      for (const statusValue of statuses) {
        const status = asRecord(statusValue);
        const externalStatus = String(status.status || '').trim().toLowerCase() || null;
        const providerMessageId = String(status.id || '').trim() || null;
        const senderPhoneNumberId =
          String(envelope.metadata.phone_number_id || '').trim() || null;
        const timestamp = String(status.timestamp || '').trim() || null;
        const failedMeta = externalStatus === 'failed'
          ? extractFailedMeta(status)
          : { errorCode: null, errorMessage: null };

        events.push({
          providerEventId: buildStableProviderEventId([
            'meta-whatsapp-status',
            senderPhoneNumberId,
            providerMessageId,
            externalStatus,
            timestamp,
            failedMeta.errorCode,
          ]),
          providerMessageId,
          senderPhoneNumberId,
          externalStatus,
          mappedStatus: mapMetaStatusToWhatsappDeliveryStatus(externalStatus),
          errorCode: failedMeta.errorCode,
          errorMessage: failedMeta.errorMessage,
          providerConversationId:
            String(asRecord(status.conversation).id || '').trim() || null,
          rawPayload: {
            entryId: envelope.entryId,
            changeField: envelope.changeField,
            metadata: envelope.metadata,
            status,
          },
        });
      }
    }

    return events;
  }

  private extractInboundEvents(payload: unknown): MetaWebhookGenericEvent[] {
    const events: MetaWebhookGenericEvent[] = [];

    for (const envelope of this.extractChangeEnvelopes(payload)) {
      const messages = asArray(envelope.value.messages);
      for (const messageValue of messages) {
        const message = asRecord(messageValue);
        const providerMessageId = String(message.id || '').trim() || null;
        const senderPhoneNumberId =
          String(envelope.metadata.phone_number_id || '').trim() || null;

        events.push({
          providerEventId: providerMessageId
            ? buildStableProviderEventId([
                'meta-whatsapp-inbound',
                senderPhoneNumberId,
                providerMessageId,
              ])
            : null,
          providerMessageId,
          senderPhoneNumberId,
          eventType: 'message_inbound_ignored',
          rawPayload: {
            entryId: envelope.entryId,
            changeField: envelope.changeField,
            metadata: envelope.metadata,
            message,
          },
        });
      }
    }

    return events;
  }

  private extractUnknownEvents(payload: unknown): MetaWebhookGenericEvent[] {
    const events: MetaWebhookGenericEvent[] = [];

    for (const envelope of this.extractChangeEnvelopes(payload)) {
      const statuses = asArray(envelope.value.statuses);
      const messages = asArray(envelope.value.messages);
      if (statuses.length > 0 || messages.length > 0) {
        continue;
      }

      const senderPhoneNumberId =
        String(envelope.metadata.phone_number_id || '').trim() || null;

      events.push({
        providerEventId: null,
        providerMessageId: null,
        senderPhoneNumberId,
        eventType: 'webhook_event_ignored',
        rawPayload: {
          entryId: envelope.entryId,
          changeField: envelope.changeField,
          metadata: envelope.metadata,
          value: envelope.value,
        },
      });
    }

    return events;
  }

  private extractChangeEnvelopes(payload: unknown) {
    const root = asRecord(payload);
    const entries = asArray(root.entry);

    return entries.flatMap((entryValue) => {
      const entry = asRecord(entryValue);
      const entryId = String(entry.id || '').trim() || null;
      const changes = asArray(entry.changes);

      return changes.map((changeValue) => {
        const change = asRecord(changeValue);
        const value = asRecord(change.value);
        return {
          entryId,
          changeField: String(change.field || '').trim() || null,
          metadata: asRecord(value.metadata),
          value,
        };
      });
    });
  }

  private async persistStatusEvent(event: MetaWebhookStatusEvent) {
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.whatsappWebhookEvent.create({
          data: {
            providerEventId: event.providerEventId,
            providerMessageId: event.providerMessageId,
            eventType: 'message_status',
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
            ...(event.mappedStatus ? { status: event.mappedStatus } : {}),
          },
        });

        const senderId = await this.findSenderId(tx, event.senderPhoneNumberId);
        const delivery = event.providerMessageId
          ? await tx.whatsappDelivery.findUnique({
              where: { providerMessageId: event.providerMessageId },
            })
          : null;

        let updatedDelivery = false;
        let orphan = true;

        if (delivery) {
          orphan = false;
          const nextStatus = event.mappedStatus;
          const shouldApply = nextStatus
            ? shouldApplyWhatsappDeliveryStatusTransition(
                delivery.status as WhatsappDeliveryStatus,
                nextStatus
              )
            : false;

          if (shouldApply && nextStatus) {
            updatedDelivery = true;
            await tx.whatsappDelivery.update({
              where: { id: delivery.id },
              data: {
                status: nextStatus,
                errorCode: nextStatus === 'FAILED' ? event.errorCode : null,
                errorMessage: nextStatus === 'FAILED' ? event.errorMessage : null,
                providerConversationId:
                  event.providerConversationId || delivery.providerConversationId,
              },
            });
          } else if (event.providerConversationId && !delivery.providerConversationId) {
            await tx.whatsappDelivery.update({
              where: { id: delivery.id },
              data: {
                providerConversationId: event.providerConversationId,
              },
            });
          }
        }

        await tx.whatsappWebhookEvent.update({
          where: { id: created.id },
          data: {
            senderId: senderId || delivery?.senderId || null,
            deliveryId: delivery?.id || null,
            processedAt: new Date(),
          },
        });

        return { duplicate: false, updatedDelivery, orphan };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { duplicate: true, updatedDelivery: false, orphan: false };
      }

      throw error;
    }
  }

  private async persistGenericEvent(event: MetaWebhookGenericEvent) {
    try {
      const senderId = await this.findSenderId(this.db, event.senderPhoneNumberId);
      await this.db.whatsappWebhookEvent.create({
        data: {
          senderId,
          providerEventId: event.providerEventId,
          providerMessageId: event.providerMessageId,
          eventType: event.eventType,
          rawPayload: event.rawPayload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });

      return { duplicate: false };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { duplicate: true };
      }

      throw error;
    }
  }

  private async findSenderId(
    db: Pick<typeof prisma, 'whatsappSender'> | TransactionClient,
    phoneNumberId: string | null
  ) {
    if (!phoneNumberId) {
      return null;
    }

    const sender = await db.whatsappSender.findFirst({
      where: { phoneNumberId },
      select: { id: true },
    });

    return sender?.id || null;
  }
}
