import { OutboxMessage } from '@prisma/client';
import { prisma } from '../prisma';
import { featureFlags } from '../config/featureFlags';
import { OUTBOX_TYPES } from './OutboxService';
import { WhatsappDeliveryService } from './WhatsappDeliveryService';
import { NotificationService } from './NotificationService';
import { metricsService } from './MetricsService';
import { ArcaWorkerHandler, ArcaRetryError } from './ArcaWorkerHandler';

type ClaimedOutboxRow = OutboxMessage;

export class OutboxWorker {
  private readonly whatsappDelivery = new WhatsappDeliveryService();
  private readonly notificationService = new NotificationService();
  private readonly arcaHandler = new ArcaWorkerHandler();
  private readonly workerId =
    process.env.OUTBOX_WORKER_ID ||
    `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

  async processPending(batchSize = 25) {
    const claimed = await this.claimBatch(batchSize);

    for (const message of claimed) {
      try {
        await this.dispatch(message);
        await prisma.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            processedAt: new Date(),
            lastError: null,
            updatedAt: new Date()
          }
        });
        metricsService.recordOutbox(message.type, 'sent');
      } catch (error: any) {
        const attempts = message.attempts + 1;
        const delayMs =
          error instanceof ArcaRetryError
            ? error.delayMs
            : Math.min(60_000, attempts * 5_000);

        await prisma.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: 'FAILED',
            attempts,
            availableAt: new Date(Date.now() + delayMs),
            claimedAt: null,
            claimedBy: null,
            lastError: error?.message || 'Error procesando outbox',
            updatedAt: new Date()
          }
        });
        metricsService.recordOutbox(message.type, 'failed');
      }
    }

    return { processed: claimed.length };
  }

  private async claimBatch(batchSize: number) {
    const rows = await prisma.$queryRaw<ClaimedOutboxRow[]>`
      WITH claimed AS (
        SELECT id
        FROM "OutboxMessage"
        WHERE "status" IN ('PENDING'::"OutboxStatus", 'FAILED'::"OutboxStatus")
          AND "availableAt" <= NOW()
          AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - INTERVAL '5 minutes')
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxMessage" o
      SET
        "status" = 'PROCESSING'::"OutboxStatus",
        "claimedAt" = NOW(),
        "claimedBy" = ${this.workerId},
        "updatedAt" = NOW()
      FROM claimed
      WHERE o.id = claimed.id
      RETURNING o.*;
    `;

    return rows;
  }

  private async dispatch(message: ClaimedOutboxRow) {
    if (message.type === OUTBOX_TYPES.WHATSAPP_SEND) {
      if (!featureFlags.ENABLE_WHATSAPP_WORKER) {
        return;
      }
      const payload = (message.payload || {}) as { phone?: string; message?: string };
      if (!payload.phone || !payload.message) {
        throw new Error('Payload inválido para WHATSAPP_SEND');
      }
      await this.whatsappDelivery.sendMessage(payload.phone, payload.message);
      return;
    }

    if (message.type === OUTBOX_TYPES.NOTIFICATION_CREATE) {
      const payload = (message.payload || {}) as {
        userId?: number | null;
        clubId?: number;
        title?: string;
        message?: string;
      };

      if (!payload.clubId || !payload.title || !payload.message) {
        throw new Error('Payload inválido para NOTIFICATION_CREATE');
      }

      await this.notificationService.createNotification(
        payload.userId ?? null,
        payload.clubId,
        payload.title,
        payload.message
      );
      return;
    }

    if (
      message.type === OUTBOX_TYPES.ARCA_INVOICE_REQUESTED ||
      message.type === OUTBOX_TYPES.ARCA_CREDIT_NOTE_REQUESTED ||
      message.type === OUTBOX_TYPES.ARCA_VOUCHER_RETRY_REQUESTED ||
      message.type === OUTBOX_TYPES.ARCA_AUTH_REFRESH_REQUESTED ||
      message.type === OUTBOX_TYPES.ARCA_VOUCHER_RENDER_REQUESTED ||
      message.type === OUTBOX_TYPES.FISCAL_INCIDENT_CREATED
    ) {
      if (!featureFlags.ENABLE_ARCA_WORKER) {
        return;
      }
      return this.arcaHandler.handle(message);
    }

    throw new Error(`Tipo de outbox no soportado: ${message.type}`);
  }
}
