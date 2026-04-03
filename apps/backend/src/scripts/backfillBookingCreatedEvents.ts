import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type Args = {
  apply: boolean;
  clubId?: number;
  fromDate?: Date;
  toDate?: Date;
  batchSize: number;
  limit?: number;
};

type BookingRow = {
  id: number;
  clubId: number;
  userId: number | null;
  courtId: number;
  activityId: number;
  price: Prisma.Decimal;
  createdAt: Date;
};

type BackfillSummary = {
  scanned: number;
  withCreatedEvent: number;
  missingCreatedEvent: number;
  createdEvents: number;
  skippedByLimit: number;
  sampleMissingBookingIds: number[];
};

const DEFAULT_BATCH_SIZE = 200;
const MAX_SAMPLE_IDS = 30;

const parseDateArg = (raw: string, options?: { endOfDay?: boolean }): Date | null => {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T${options?.endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    apply: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (const raw of argv) {
    if (raw === '--apply') {
      args.apply = true;
      continue;
    }
    if (raw.startsWith('--club-id=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      if (Number.isInteger(n) && n > 0) args.clubId = n;
      continue;
    }
    if (raw.startsWith('--from=')) {
      const parsed = parseDateArg(raw.split('=').slice(1).join('='));
      if (parsed) args.fromDate = parsed;
      continue;
    }
    if (raw.startsWith('--to=')) {
      const parsed = parseDateArg(raw.split('=').slice(1).join('='), { endOfDay: true });
      if (parsed) args.toDate = parsed;
      continue;
    }
    if (raw.startsWith('--batch=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      if (Number.isInteger(n) && n > 0) args.batchSize = Math.min(2000, n);
      continue;
    }
    if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      if (Number.isInteger(n) && n > 0) args.limit = n;
    }
  }

  return args;
};

const ensureValidDateWindow = (args: Args) => {
  if (args.fromDate && args.toDate && args.fromDate.getTime() > args.toDate.getTime()) {
    throw new Error('Rango inválido: --from no puede ser mayor que --to');
  }
};

const extractBookingIdFromPayload = (payload: unknown): number | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>).bookingId;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const buildCreatedEventPayload = (booking: BookingRow): Prisma.InputJsonValue => {
  return {
    bookingId: booking.id,
    clubId: booking.clubId,
    userId: booking.userId ?? null,
    courtId: booking.courtId,
    activityId: booking.activityId,
    amount: Number(booking.price || 0),
  } as Prisma.InputJsonValue;
};

const collectExistingCreatedEventBookingIds = async (
  clubId: number,
  bookingIds: number[]
): Promise<Set<number>> => {
  const whereOr = bookingIds.flatMap((bookingId) => [
    { payload: { path: ['bookingId'], equals: bookingId } },
    { payload: { path: ['bookingId'], equals: String(bookingId) } },
  ]);
  if (whereOr.length === 0) return new Set<number>();

  const events = await prisma.event.findMany({
    where: {
      clubId,
      type: 'BOOKING_CREATED',
      OR: whereOr,
    },
    select: {
      payload: true,
    },
  });

  const found = new Set<number>();
  for (const event of events) {
    const bookingId = extractBookingIdFromPayload(event.payload);
    if (bookingId) found.add(bookingId);
  }
  return found;
};

const processBatch = async (
  bookings: BookingRow[],
  apply: boolean,
  summary: BackfillSummary
) => {
  const byClub = new Map<number, BookingRow[]>();
  for (const booking of bookings) {
    if (!byClub.has(booking.clubId)) byClub.set(booking.clubId, []);
    byClub.get(booking.clubId)?.push(booking);
  }

  for (const [clubId, clubBookings] of byClub.entries()) {
    const bookingIds = clubBookings.map((booking) => booking.id);
    const existingBookingIds = await collectExistingCreatedEventBookingIds(clubId, bookingIds);

    const missingBookings = clubBookings.filter((booking) => !existingBookingIds.has(booking.id));
    summary.withCreatedEvent += clubBookings.length - missingBookings.length;
    summary.missingCreatedEvent += missingBookings.length;

    for (const booking of missingBookings) {
      if (summary.sampleMissingBookingIds.length < MAX_SAMPLE_IDS) {
        summary.sampleMissingBookingIds.push(booking.id);
      }
    }

    if (!apply || missingBookings.length === 0) continue;

    await prisma.event.createMany({
      data: missingBookings.map((booking) => ({
        clubId: booking.clubId,
        type: 'BOOKING_CREATED',
        payload: buildCreatedEventPayload(booking),
        createdAt: booking.createdAt,
        processed: true,
      })),
    });
    summary.createdEvents += missingBookings.length;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  ensureValidDateWindow(args);

  console.log('[START] booking-created-events-backfill', {
    mode: args.apply ? 'APPLY' : 'DRY_RUN',
    clubId: args.clubId ?? null,
    from: args.fromDate?.toISOString() ?? null,
    to: args.toDate?.toISOString() ?? null,
    batchSize: args.batchSize,
    limit: args.limit ?? null,
  });

  const summary: BackfillSummary = {
    scanned: 0,
    withCreatedEvent: 0,
    missingCreatedEvent: 0,
    createdEvents: 0,
    skippedByLimit: 0,
    sampleMissingBookingIds: [],
  };

  let lastBookingId = 0;
  let done = false;

  while (!done) {
    const remaining = args.limit ? Math.max(0, args.limit - summary.scanned) : args.batchSize;
    if (args.limit && remaining <= 0) {
      done = true;
      break;
    }
    const take = Math.max(1, Math.min(args.batchSize, remaining));

    const batch = await prisma.booking.findMany({
      where: {
        id: { gt: lastBookingId },
        ...(args.clubId ? { clubId: args.clubId } : {}),
        ...(args.fromDate || args.toDate
          ? {
              createdAt: {
                ...(args.fromDate ? { gte: args.fromDate } : {}),
                ...(args.toDate ? { lte: args.toDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        clubId: true,
        userId: true,
        courtId: true,
        activityId: true,
        price: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) {
      done = true;
      break;
    }

    lastBookingId = batch[batch.length - 1].id;
    summary.scanned += batch.length;

    await processBatch(batch as BookingRow[], args.apply, summary);

    console.log('[BATCH]', {
      scanned: summary.scanned,
      withCreatedEvent: summary.withCreatedEvent,
      missingCreatedEvent: summary.missingCreatedEvent,
      createdEvents: summary.createdEvents,
      lastBookingId,
    });
  }

  if (args.limit && summary.scanned > args.limit) {
    summary.skippedByLimit = summary.scanned - args.limit;
  }

  console.log('[DONE] booking-created-events-backfill', {
    ...summary,
    sampleMissingBookingIds: summary.sampleMissingBookingIds,
  });
};

main()
  .catch((error) => {
    console.error('[ERROR] booking-created-events-backfill', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
