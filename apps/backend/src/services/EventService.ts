import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const DOMAIN_EVENTS = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_PARTICIPANT_ADDED: 'BOOKING_PARTICIPANT_ADDED',
  BOOKING_PARTICIPANT_REMOVED: 'BOOKING_PARTICIPANT_REMOVED',
  BOOKING_BILLING_CONFIG_UPDATED: 'BOOKING_BILLING_CONFIG_UPDATED',
  BOOKING_NOTES_UPDATED: 'BOOKING_NOTES_UPDATED',
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

  async bookingRescheduled(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_RESCHEDULED, payload, tx);
  }

  async bookingConfirmed(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_CONFIRMED, payload, tx);
  }

  async bookingCompleted(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_COMPLETED, payload, tx);
  }

  async bookingCancelled(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_CANCELLED, payload, tx);
  }

  async bookingParticipantAdded(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_PARTICIPANT_ADDED, payload, tx);
  }

  async bookingParticipantRemoved(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_PARTICIPANT_REMOVED, payload, tx);
  }

  async bookingBillingConfigUpdated(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_BILLING_CONFIG_UPDATED, payload, tx);
  }

  async bookingNotesUpdated(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.BOOKING_NOTES_UPDATED, payload, tx);
  }

  async paymentReceived(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.PAYMENT_RECEIVED, payload, tx);
  }

  async productSold(clubId: number, payload: Record<string, any>, tx?: DbClient) {
    return this.createEvent(clubId, DOMAIN_EVENTS.PRODUCT_SOLD, payload, tx);
  }
}
