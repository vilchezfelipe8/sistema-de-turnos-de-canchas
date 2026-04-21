import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const DOMAIN_EVENTS = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PRODUCT_SOLD: 'PRODUCT_SOLD'
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

type DbClient = Prisma.TransactionClient | PrismaClient;

export class EventService {
  async createEvent(
    clubId: number,
    type: DomainEventType | string,
    payload: Record<string, any>,
    tx?: DbClient
  ) {
    const client = tx ?? prisma;
    return client.event.create({
      data: {
        clubId,
        type,
        payload,
        processed: true
      }
    });
  }

  async bookingCreated(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_CREATED, payload, tx);
  }

  async bookingCancelled(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_CANCELLED, payload, tx);
  }

  async paymentReceived(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.PAYMENT_RECEIVED, payload, tx);
  }

  async productSold(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.PRODUCT_SOLD, payload, tx);
  }
}
