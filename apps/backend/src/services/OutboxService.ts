import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const OUTBOX_TYPES = {
  WHATSAPP_SEND: 'WHATSAPP_SEND',
  WHATSAPP_SEND_V2: 'WHATSAPP_SEND_V2',
  NOTIFICATION_CREATE: 'NOTIFICATION_CREATE',
  ARCA_INVOICE_REQUESTED: 'ARCA_INVOICE_REQUESTED',
  ARCA_CREDIT_NOTE_REQUESTED: 'ARCA_CREDIT_NOTE_REQUESTED',
  ARCA_VOUCHER_RETRY_REQUESTED: 'ARCA_VOUCHER_RETRY_REQUESTED',
  ARCA_AUTH_REFRESH_REQUESTED: 'ARCA_AUTH_REFRESH_REQUESTED',
  ARCA_VOUCHER_RENDER_REQUESTED: 'ARCA_VOUCHER_RENDER_REQUESTED',
  FISCAL_INCIDENT_CREATED: 'FISCAL_INCIDENT_CREATED'
} as const;

type DbClient = Prisma.TransactionClient | PrismaClient;

export type OutboxPayload = Record<string, unknown>;

export type EnqueueOutboxInput = {
  clubId: number;
  type: string;
  payload: OutboxPayload;
  dedupeKey?: string;
  aggregateType?: string;
  aggregateId?: string;
  availableAt?: Date;
};

export class OutboxService {
  async enqueue(input: EnqueueOutboxInput, tx?: DbClient) {
    const client = tx ?? prisma;
    return client.outboxMessage.create({
      data: {
        clubId: input.clubId,
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        availableAt: input.availableAt
      }
    });
  }

  async enqueueMany(inputs: EnqueueOutboxInput[], tx?: DbClient) {
    if (inputs.length === 0) return [];
    const client = tx ?? prisma;
    return Promise.all(inputs.map((input) => this.enqueue(input, client)));
  }
}
