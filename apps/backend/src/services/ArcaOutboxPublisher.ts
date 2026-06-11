import { Prisma } from '@prisma/client';
import { OutboxService, OUTBOX_TYPES } from './OutboxService';

type TxClient = Prisma.TransactionClient;

export type ArcaVoucherEventPayload = {
  facturaId: string;
};

export class ArcaOutboxPublisher {
  private readonly outboxService = new OutboxService();

  async publishInvoiceRequested(params: {
    clubId: number;
    facturaId: string;
    originType: string;
    originId: string;
    tx?: TxClient;
  }): Promise<void> {
    const dedupeKey = `club:${params.clubId}:origin:${params.originType}:${params.originId}:kind:INVOICE`;
    await this.outboxService.enqueue(
      {
        clubId: params.clubId,
        type: OUTBOX_TYPES.ARCA_INVOICE_REQUESTED,
        payload: { facturaId: params.facturaId },
        dedupeKey,
        aggregateType: 'Factura',
        aggregateId: params.facturaId
      },
      params.tx
    );
  }

  async publishCreditNoteRequested(params: {
    clubId: number;
    facturaId: string;
    originType: string;
    originId: string;
    tx?: TxClient;
  }): Promise<void> {
    const dedupeKey = `club:${params.clubId}:origin:${params.originType}:${params.originId}:kind:CREDIT_NOTE`;
    await this.outboxService.enqueue(
      {
        clubId: params.clubId,
        type: OUTBOX_TYPES.ARCA_CREDIT_NOTE_REQUESTED,
        payload: { facturaId: params.facturaId },
        dedupeKey,
        aggregateType: 'Factura',
        aggregateId: params.facturaId
      },
      params.tx
    );
  }

  async publishVoucherRetry(params: {
    clubId: number;
    facturaId: string;
    availableAt?: Date;
    tx?: TxClient;
  }): Promise<void> {
    await this.outboxService.enqueue(
      {
        clubId: params.clubId,
        type: OUTBOX_TYPES.ARCA_VOUCHER_RETRY_REQUESTED,
        payload: { facturaId: params.facturaId },
        aggregateType: 'Factura',
        aggregateId: params.facturaId,
        availableAt: params.availableAt
      },
      params.tx
    );
  }

  async publishVoucherRender(params: {
    clubId: number;
    facturaId: string;
    tx?: TxClient;
  }): Promise<void> {
    await this.outboxService.enqueue(
      {
        clubId: params.clubId,
        type: OUTBOX_TYPES.ARCA_VOUCHER_RENDER_REQUESTED,
        payload: { facturaId: params.facturaId },
        aggregateType: 'Factura',
        aggregateId: params.facturaId
      },
      params.tx
    );
  }
}
