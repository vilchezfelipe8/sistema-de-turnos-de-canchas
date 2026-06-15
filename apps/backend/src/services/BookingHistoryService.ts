import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

type DbClient = Prisma.TransactionClient | PrismaClient;

export type BookingHistoryCategory =
  | 'BOOKING'
  | 'PARTICIPANT'
  | 'PAYMENT'
  | 'CONSUMPTION'
  | 'BILLING';

export type BookingHistorySource =
  | 'ADMIN'
  | 'PLAYER'
  | 'SYSTEM'
  | 'SYSTEM_BACKFILL'
  | 'PAYMENT_POS'
  | 'PAYMENT_ONLINE'
  | 'BOOKING_CONSUMPTION';

export type AppendBookingHistoryEntryInput = {
  bookingId: number;
  clubId: number;
  action: string;
  category: BookingHistoryCategory | string;
  source: BookingHistorySource | string;
  summary: string;
  actorUserId?: number | null;
  actorLabel?: string | null;
  detail?: Prisma.InputJsonValue | null;
  previousState?: Prisma.InputJsonValue | null;
  nextState?: Prisma.InputJsonValue | null;
  bookingParticipantId?: string | null;
  paymentId?: string | null;
  accountId?: string | null;
  sourceEventId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  idempotencyKey?: string | null;
  occurredAt?: Date | null;
};

function parsePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseNonEmptyString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveActorLabelTx(
  tx: DbClient,
  actorUserId: number | null,
  explicitLabel?: string | null
) {
  const explicit = parseNonEmptyString(explicitLabel);
  if (explicit) return explicit;
  if (!actorUserId) return null;
  try {
    const user = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { firstName: true, lastName: true, email: true },
    });
    const fullName = `${String(user?.firstName || '').trim()} ${String(user?.lastName || '').trim()}`.trim();
    return parseNonEmptyString(fullName) ?? parseNonEmptyString(user?.email) ?? null;
  } catch {
    return null;
  }
}

export class BookingHistoryService {
  async listByBooking(input: { clubId: number; bookingId: number; take?: number }, tx?: DbClient) {
    const client = tx ?? prisma;
    return client.bookingHistoryEntry.findMany({
      where: {
        clubId: input.clubId,
        bookingId: input.bookingId,
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: Number.isFinite(input.take) && Number(input.take) > 0 ? Number(input.take) : 200,
    });
  }

  async appendBookingHistoryEntryTx(tx: DbClient, input: AppendBookingHistoryEntryInput) {
    const actorUserId = parsePositiveInt(input.actorUserId) ?? null;
    const sourceEventId = parseNonEmptyString(input.sourceEventId);
    const idempotencyKey = parseNonEmptyString(input.idempotencyKey);
    const actorLabel = await resolveActorLabelTx(tx, actorUserId, input.actorLabel);

    try {
      return await tx.bookingHistoryEntry.create({
        data: {
          clubId: input.clubId,
          bookingId: input.bookingId,
          actorUserId,
          actorLabel,
          action: String(input.action || '').trim(),
          category: String(input.category || 'BOOKING').trim(),
          source: String(input.source || 'SYSTEM').trim(),
          summary: String(input.summary || '').trim() || 'Actualización registrada',
          detail: input.detail ?? Prisma.JsonNull,
          previousState: input.previousState ?? Prisma.JsonNull,
          nextState: input.nextState ?? Prisma.JsonNull,
          bookingParticipantId: parseNonEmptyString(input.bookingParticipantId),
          paymentId: parseNonEmptyString(input.paymentId),
          accountId: parseNonEmptyString(input.accountId),
          sourceEventId,
          idempotencyKey,
          metadata: input.metadata ?? Prisma.JsonNull,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002' && (sourceEventId || idempotencyKey)) {
        return null;
      }
      throw error;
    }
  }
}
