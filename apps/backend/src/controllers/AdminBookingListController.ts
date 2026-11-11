import { Request, Response } from 'express';
import { z } from 'zod';
import { fromZonedTime } from 'date-fns-tz';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { sendAppError, zodValidationAppError } from '../errors';

// Lista de reservas de varios días (la agenda carga de a un día).

const PAGE_SIZE = 25;

// TO_RESOLVE: pendientes cuyo turno ya terminó sin que nadie las confirme ni cancele.
const VIEWS = ['UPCOMING', 'PENDING', 'CANCELLED', 'PAST', 'TO_RESOLVE'] as const;
type BookingListView = (typeof VIEWS)[number];

const listSchema = z.object({
  view: z.enum(VIEWS).default('UPCOMING'),
  q: z.string().trim().max(100).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')
    .optional(),
  page: z.coerce.number().int().min(1).default(1)
});

const viewWhere = (view: BookingListView, now: Date): Prisma.BookingWhereInput => {
  switch (view) {
    case 'UPCOMING':
      return { status: { in: ['PENDING', 'CONFIRMED'] }, endDateTime: { gte: now } };
    case 'PENDING':
      return { status: 'PENDING', endDateTime: { gte: now } };
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    case 'PAST':
      return { status: { in: ['CONFIRMED', 'COMPLETED'] }, endDateTime: { lt: now } };
    case 'TO_RESOLVE':
      return { status: 'PENDING', endDateTime: { lt: now } };
  }
};

const viewOrder = (view: BookingListView): Prisma.BookingOrderByWithRelationInput[] => {
  if (view === 'UPCOMING' || view === 'PENDING') return [{ startDateTime: 'asc' }, { id: 'asc' }];
  // Canceladas: las que se cancelaron más recién, primero.
  if (view === 'CANCELLED') {
    return [
      { cancelledAt: { sort: 'desc', nulls: 'last' } },
      { autoCancelledAt: { sort: 'desc', nulls: 'last' } },
      { id: 'desc' }
    ];
  }
  return [{ startDateTime: 'desc' }, { id: 'desc' }];
};

export class AdminBookingListController {
  // GET /:slug/admin/bookings?view=&q=&date=&page=
  list = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error));
      const { view, q, date, page } = parsed.data;

      const settings = await prisma.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
      const timeZone = settings?.timeZone || 'America/Argentina/Buenos_Aires';
      const now = new Date();

      // Filtros comunes a todas las vistas (los conteos de las pestañas los respetan).
      const common: Prisma.BookingWhereInput[] = [{ clubId }];
      if (q) {
        const digits = q.replace(/\D/g, '');
        common.push({
          OR: [
            { client: { name: { contains: q, mode: 'insensitive' } } },
            ...(digits.length >= 3
              ? [{ client: { phone: { contains: digits } } }, { client: { dni: { contains: digits } } }]
              : []),
            ...(/^[A-Za-z0-9-]{4,}$/.test(q) ? [{ displayCode: { equals: q.toUpperCase() } }] : [])
          ]
        });
      }
      if (date) {
        const start = fromZonedTime(`${date}T00:00:00`, timeZone);
        const end = fromZonedTime(`${date}T23:59:59.999`, timeZone);
        common.push({ startDateTime: { gte: start, lte: end } });
      }

      const where: Prisma.BookingWhereInput = { AND: [...common, viewWhere(view, now)] };

      const [total, rows, ...counts] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          orderBy: viewOrder(view),
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: {
            id: true,
            displayCode: true,
            startDateTime: true,
            endDateTime: true,
            status: true,
            price: true,
            createdAt: true,
            cancelledAt: true,
            cancelledBy: true,
            autoCancelledAt: true,
            autoCancelReason: true,
            fixedBookingId: true,
            client: { select: { id: true, name: true, phone: true } },
            court: { select: { id: true, name: true } },
            activity: { select: { id: true, name: true } }
          }
        }),
        ...VIEWS.map((v) => prisma.booking.count({ where: { AND: [...common, viewWhere(v, now)] } }))
      ]);

      // Cuánto falta cobrar de cada reserva (su cuenta).
      const accounts = rows.length
        ? await prisma.account.findMany({
            where: { clubId, sourceType: 'BOOKING', sourceId: { in: rows.map((r) => String(r.id)) } },
            select: { sourceId: true, totalAmount: true, paidAmount: true }
          })
        : [];
      const accountByBooking = new Map(accounts.map((a) => [a.sourceId, a]));

      // Quién canceló (nombre), si fue alguien del club o el jugador.
      const cancellerIds = [...new Set(rows.map((r) => r.cancelledBy).filter((id): id is number => id != null))];
      const cancellers = cancellerIds.length
        ? await prisma.user.findMany({
            where: { id: { in: cancellerIds } },
            select: { id: true, firstName: true, lastName: true }
          })
        : [];
      const cancellerName = new Map(
        cancellers.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null])
      );

      const items = rows.map((r) => {
        const account = accountByBooking.get(String(r.id));
        const totalAmount = account ? Number(account.totalAmount) : Number(r.price);
        const paidAmount = account ? Number(account.paidAmount) : 0;
        return {
          id: r.id,
          displayCode: r.displayCode,
          startDateTime: r.startDateTime.toISOString(),
          endDateTime: r.endDateTime.toISOString(),
          status: r.status,
          client: r.client,
          court: r.court,
          activity: r.activity,
          isFixed: r.fixedBookingId != null,
          createdAt: r.createdAt.toISOString(),
          totalAmount,
          paidAmount,
          remainingAmount: Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100),
          cancelledAt: (r.cancelledAt ?? r.autoCancelledAt)?.toISOString() ?? null,
          cancelledByName: r.cancelledBy != null ? cancellerName.get(r.cancelledBy) ?? null : null,
          autoCancelled: r.autoCancelledAt != null,
          autoCancelReason: r.autoCancelReason
        };
      });

      const [upcoming, pending, cancelled, past, toResolve] = counts;
      return res.json({
        items,
        total,
        page,
        pageSize: PAGE_SIZE,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        counts: { upcoming, pending, cancelled, past, toResolve },
        timeZone
      });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las reservas');
    }
  };

  // GET /:slug/admin/bookings/fixed-list?q=
  // Turnos fijos activos, con el próximo turno y cuántos quedan reservados.
  listFixed = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const parsed = z.object({ q: z.string().trim().max(100).optional() }).safeParse(req.query);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error));
      const { q } = parsed.data;

      const settings = await prisma.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
      const timeZone = settings?.timeZone || 'America/Argentina/Buenos_Aires';
      const now = new Date();

      const where: Prisma.FixedBookingWhereInput = { clubId, status: 'ACTIVE' };
      if (q) {
        const digits = q.replace(/\D/g, '');
        where.OR = [
          { client: { name: { contains: q, mode: 'insensitive' } } },
          ...(digits.length >= 3 ? [{ client: { phone: { contains: digits } } }] : [])
        ];
      }

      const rows = await prisma.fixedBooking.findMany({
        where,
        orderBy: [{ dayOfWeek: 'asc' }, { startTimeMinutes: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          dayOfWeek: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          startDate: true,
          client: { select: { id: true, name: true, phone: true } },
          court: { select: { id: true, name: true } },
          activity: { select: { id: true, name: true } },
          bookings: {
            where: { status: { in: ['PENDING', 'CONFIRMED'] }, startDateTime: { gte: now } },
            orderBy: { startDateTime: 'asc' },
            select: { id: true, startDateTime: true }
          }
        }
      });

      // Cuánto ya se pagó de los turnos que quedan (si hay, se cancela desde el calendario).
      const upcomingIds = rows.flatMap((r) => r.bookings.map((b) => String(b.id)));
      const accounts = upcomingIds.length
        ? await prisma.account.findMany({
            where: { clubId, sourceType: 'BOOKING', sourceId: { in: upcomingIds } },
            select: { sourceId: true, paidAmount: true }
          })
        : [];
      const paidByBooking = new Map(accounts.map((a) => [a.sourceId, Number(a.paidAmount)]));

      const items = rows.map((r) => {
        const next = r.bookings[0] ?? null;
        const upcomingPaidAmount = r.bookings.reduce((sum, b) => sum + (paidByBooking.get(String(b.id)) ?? 0), 0);
        return {
          id: r.id,
          dayOfWeek: r.dayOfWeek,
          startTimeMinutes: r.startTimeMinutes,
          endTimeMinutes: r.endTimeMinutes,
          startDate: r.startDate.toISOString(),
          client: r.client,
          court: r.court,
          activity: r.activity,
          nextBooking: next ? { id: next.id, startDateTime: next.startDateTime.toISOString() } : null,
          upcomingCount: r.bookings.length,
          upcomingPaidAmount: Math.round(upcomingPaidAmount * 100) / 100
        };
      });

      return res.json({ items, timeZone });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los turnos fijos');
    }
  };
}
