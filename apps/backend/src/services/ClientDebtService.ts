import { prisma } from '../prisma';

export class ClientDebtService {
  async listByClub(
    clubId: number,
    options?: {
      scope?: 'all' | 'debt_open';
    }
  ) {
    const scope = options?.scope === 'debt_open' ? 'debt_open' : 'all';
    const clients = await prisma.client.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            bookings: true
          }
        }
      }
    });
    const clientIds = clients.map((client) => String(client.id));

    const bookingAccounts = await prisma.account.findMany({
      where: {
        clubId,
        sourceType: 'BOOKING'
      },
      select: {
        id: true,
        sourceId: true,
        totalAmount: true,
        status: true,
        createdAt: true
      }
    });

    const accountedBookingIds = new Set(
      bookingAccounts
        .map((account) => Number(account.sourceId))
        .filter((id) => Number.isInteger(id) && id > 0)
    );

    const confirmedOrCompletedBookings = await prisma.booking.findMany({
      where: {
        clubId,
        status: { in: ['CONFIRMED', 'COMPLETED'] }
      },
      select: {
        id: true,
        status: true
      }
    });

    const inconsistentBookings = confirmedOrCompletedBookings.filter(
      (booking) => !accountedBookingIds.has(Number(booking.id))
    );
    if (inconsistentBookings.length > 0) {
      const preview = inconsistentBookings
        .slice(0, 10)
        .map((booking) => `${booking.id}:${booking.status}`)
        .join(', ');
      throw new Error(
        `Inconsistencia de integridad: hay reservas CONFIRMED/COMPLETED sin Account BOOKING en club ${clubId}. Ejemplos: ${preview}`
      );
    }

    const bookingIds = bookingAccounts
      .map((account) => Number(account.sourceId))
      .filter((id) => Number.isInteger(id) && id > 0);

    const bookings = bookingIds.length > 0
      ? await prisma.booking.findMany({
          where: {
            id: { in: bookingIds },
            clubId
          },
          select: {
            id: true,
            clientId: true,
            startDateTime: true,
            status: true,
            court: {
              select: {
                name: true
              }
            }
          }
        })
      : [];
    const allClientBookings = clientIds.length > 0
      ? await prisma.booking.findMany({
          where: {
            clubId,
            clientId: { in: clientIds }
          },
          select: {
            id: true,
            clientId: true,
            startDateTime: true,
            status: true,
            listPrice: true,
            price: true,
            court: {
              select: {
                name: true
              }
            }
          },
          orderBy: {
            startDateTime: 'asc'
          }
        })
      : [];

    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
    const clientAccountPairs = bookingAccounts
      .map((account) => {
        const bookingId = Number(account.sourceId);
        const booking = bookingById.get(bookingId);
        if (!booking?.clientId) return null;
        return { account, booking };
      })
      .filter((pair): pair is { account: (typeof bookingAccounts)[number]; booking: (typeof bookings)[number] } => Boolean(pair));

    const accountIds = clientAccountPairs.map((pair) => pair.account.id);
    const [paymentAgg, refundAgg] = await Promise.all([
      accountIds.length > 0
        ? prisma.payment.groupBy({
            by: ['accountId'],
            where: { accountId: { in: accountIds } },
            _sum: { amount: true }
          })
        : Promise.resolve([] as Array<{ accountId: string; _sum: { amount: any } }>),
      accountIds.length > 0
        ? prisma.refund.groupBy({
            by: ['accountId'],
            where: { accountId: { in: accountIds }, status: 'EXECUTED' },
            _sum: { amount: true }
          })
        : Promise.resolve([] as Array<{ accountId: string; _sum: { amount: any } }>)
    ]);

    const paymentByAccount = new Map(paymentAgg.map((row) => [row.accountId, Number(row._sum.amount || 0)]));
    const refundByAccount = new Map(refundAgg.map((row) => [row.accountId, Number(row._sum.amount || 0)]));

    const accountsByClient = new Map<string, Array<{
      id: string;
      sourceType: 'BOOKING';
      sourceId: string;
      accountStatus: string;
      date: string;
      time: string;
      createdAt: Date;
      bookingId: number;
      bookingStatus: string;
      paymentStatus: 'PAID' | 'PARTIAL' | 'DEBT';
      totalAmount: number;
      paidAmount: number;
      amount: number;
      courtName: string | null;
      items: never[];
    }>>();

    for (const { account, booking } of clientAccountPairs) {
      const clientId = booking.clientId;
      if (!clientId) continue;

      const paid = Math.max(0, (paymentByAccount.get(account.id) || 0) - (refundByAccount.get(account.id) || 0));
      const total = Number(account.totalAmount || 0);
      const remaining = Math.max(0, Number((total - paid).toFixed(2)));
      const paymentStatus = remaining <= 0.009 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DEBT';

      const dt = new Date(booking.startDateTime);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');

      const existing = accountsByClient.get(clientId) || [];
      existing.push({
        id: account.id,
        sourceType: 'BOOKING',
        sourceId: account.sourceId,
        accountStatus: account.status,
        date: dt.toISOString().slice(0, 10),
        time: `${hh}:${mm}`,
        createdAt: account.createdAt,
        bookingId: booking.id,
        bookingStatus: booking.status,
        paymentStatus,
        totalAmount: total,
        paidAmount: Number(paid.toFixed(2)),
        amount: remaining,
        courtName: booking.court?.name ?? null,
        items: []
      });
      accountsByClient.set(clientId, existing);
    }

    const bookingTimelineByClient = new Map<
      string,
      {
        lastBookingAt: string | null;
        nextBookingAt: string | null;
      }
    >();
    const detailedBookingsByClient = new Map<
      string,
      Array<{
        id: number;
        bookingId: number;
        startDateTime: string;
        date: string;
        time: string;
        status: string;
        courtName: string | null;
        listPrice: number;
        price: number;
      }>
    >();
    const bookingsByClient = new Map<string, Array<{ startDateTime: Date; status: string }>>();
    for (const booking of allClientBookings) {
      const clientId = String(booking.clientId || '').trim();
      if (!clientId) continue;
      const existing = bookingsByClient.get(clientId) || [];
      existing.push({
        startDateTime: booking.startDateTime,
        status: String(booking.status || '')
      });
      bookingsByClient.set(clientId, existing);

      const dt = new Date(booking.startDateTime);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      const detailRows = detailedBookingsByClient.get(clientId) || [];
      detailRows.push({
        id: booking.id,
        bookingId: booking.id,
        startDateTime: booking.startDateTime.toISOString(),
        date: dt.toISOString().slice(0, 10),
        time: `${hh}:${mm}`,
        status: String(booking.status || ''),
        courtName: booking.court?.name ?? null,
        listPrice: Number(booking.listPrice || 0),
        price: Number(booking.price || 0)
      });
      detailedBookingsByClient.set(clientId, detailRows);
    }
    const nowTs = Date.now();
    for (const [clientId, bookingRows] of bookingsByClient.entries()) {
      const ordered = bookingRows
        .slice()
        .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime());
      const pastBookings = ordered.filter((row) => row.startDateTime.getTime() <= nowTs);
      const upcomingBookings = ordered.filter((row) => row.startDateTime.getTime() > nowTs && row.status !== 'CANCELLED');
      bookingTimelineByClient.set(clientId, {
        lastBookingAt: pastBookings.length > 0 ? pastBookings[pastBookings.length - 1].startDateTime.toISOString() : null,
        nextBookingAt: upcomingBookings.length > 0 ? upcomingBookings[0].startDateTime.toISOString() : null
      });
    }

    const rows = clients.map((client) => {
      const history = (accountsByClient.get(client.id) || [])
        .slice()
        .sort((a, b) => {
          const aTs = new Date(a.createdAt).getTime();
          const bTs = new Date(b.createdAt).getTime();
          if (aTs !== bTs) return bTs - aTs;
          return a.id < b.id ? 1 : -1;
        });
      const totalDebt = history.reduce((sum, account) => sum + Number(account.amount || 0), 0);
      const hasOpenAccount = history.some((account) => String(account.accountStatus || '').toUpperCase() === 'OPEN');
      const timeline = bookingTimelineByClient.get(String(client.id)) || {
        lastBookingAt: null,
        nextBookingAt: null
      };
      return {
        history,
        bookings: (detailedBookingsByClient.get(String(client.id)) || [])
          .slice()
          .sort((a, b) => {
            const aTs = new Date(a.startDateTime).getTime();
            const bTs = new Date(b.startDateTime).getTime();
            if (aTs !== bTs) return bTs - aTs;
            return b.bookingId - a.bookingId;
          }),
        id: client.id,
        firstName: client.name,
        lastName: '',
        dni: client.dni || null,
        email: client.email,
        phoneNumber: client.phone,
        isProfessor: Boolean((client as any).isProfessor),
        totalBookings: client._count.bookings,
        totalDebt,
        hasOpenAccount,
        lastBookingAt: timeline.lastBookingAt,
        nextBookingAt: timeline.nextBookingAt
      };
    });

    if (scope === 'debt_open') {
      return rows.filter((client) => client.totalDebt > 0.009 || client.hasOpenAccount);
    }

    return rows.map(({ hasOpenAccount: _hasOpenAccount, ...client }) => client);
  }
}
