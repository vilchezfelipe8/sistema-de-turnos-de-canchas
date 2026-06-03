import { PrismaClient, Prisma, WhatsappProvider } from '@prisma/client';
import { prisma } from '../prisma';
import { OUTBOX_TYPES } from './OutboxService';
import { WhatsappNotificationPolicyService } from './WhatsappNotificationPolicyService';
import { type WhatsappSendV2Payload } from '../types/notifications';

type DbClient = Prisma.TransactionClient | PrismaClient;

export type EnqueueWhatsappSendV2Result = {
  outboxMessage: {
    id: string;
    clubId: number;
    type: string;
    dedupeKey: string | null;
    payload: unknown;
  };
  whatsappDelivery: {
    id: string;
    outboxMessageId: string;
    status: string;
    provider: WhatsappProvider;
  };
  created: boolean;
};

export class WhatsappNotificationOutboxService {
  private readonly policy = new WhatsappNotificationPolicyService();

  async enqueueSendV2(
    input: WhatsappSendV2Payload,
    tx?: DbClient
  ): Promise<EnqueueWhatsappSendV2Result> {
    const outboxPayload = this.policy.buildOutboxPayload(input);

    const run = async (client: DbClient): Promise<EnqueueWhatsappSendV2Result> => {
      const existing = await client.outboxMessage.findUnique({
        where: { dedupeKey: outboxPayload.dedupeKey },
        include: { whatsappDelivery: true }
      });

      if (existing) {
        if (existing.type !== OUTBOX_TYPES.WHATSAPP_SEND_V2) {
          throw new Error(
            `dedupeKey ya usado por otro tipo de outbox: ${existing.type}`
          );
        }

        const delivery =
          existing.whatsappDelivery ||
          (await client.whatsappDelivery.create({
            data: {
              clubId: outboxPayload.clubId,
              outboxMessageId: existing.id,
              recipientRole: outboxPayload.recipientRole,
              recipientPhone: outboxPayload.recipientPhone,
              eventType: outboxPayload.eventType,
              provider: 'META_CLOUD_API',
              status: 'QUEUED'
            }
          }));

        return {
          outboxMessage: existing,
          whatsappDelivery: delivery,
          created: false
        };
      }

      const outboxMessage = await client.outboxMessage.create({
        data: {
          clubId: outboxPayload.clubId,
          type: OUTBOX_TYPES.WHATSAPP_SEND_V2,
          aggregateType: outboxPayload.referenceType,
          aggregateId: outboxPayload.referenceId,
          payload: outboxPayload as Prisma.InputJsonValue,
          dedupeKey: outboxPayload.dedupeKey
        }
      });

      const whatsappDelivery = await client.whatsappDelivery.create({
        data: {
          clubId: outboxPayload.clubId,
          outboxMessageId: outboxMessage.id,
          recipientRole: outboxPayload.recipientRole,
          recipientPhone: outboxPayload.recipientPhone,
          eventType: outboxPayload.eventType,
          provider: 'META_CLOUD_API',
          status: 'QUEUED'
        }
      });

      return {
        outboxMessage,
        whatsappDelivery,
        created: true
      };
    };

    if (tx) {
      return run(tx);
    }

    return prisma.$transaction((innerTx) => run(innerTx));
  }
}
