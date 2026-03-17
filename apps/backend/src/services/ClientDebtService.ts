import { prisma } from '../prisma';

export class ClientDebtService {
  async listByClub(clubId: number) {
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

    return clients.map((client) => ({
      history: (accountsByClient.get(client.id) || [])
        .slice()
        .sort((a, b) => {
          const aTs = new Date(a.createdAt).getTime();
          const bTs = new Date(b.createdAt).getTime();
          if (aTs !== bTs) return bTs - aTs;
          return a.id < b.id ? 1 : -1;
        }),
      id: client.id,
      firstName: client.name,
      lastName: '',
      dni: client.dni || null,
      email: client.email,
      phoneNumber: client.phone,
      isProfessor: Boolean((client as any).isProfessor),
      totalBookings: client._count.bookings,
      totalDebt: (accountsByClient.get(client.id) || []).reduce((sum, account) => sum + Number(account.amount || 0), 0)
    }));
  }
}
