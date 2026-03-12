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
        totalAmount: true
      }
    });

    const accountIds = bookingAccounts.map((account) => account.id);
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

    const accountBySourceId = new Map(bookingAccounts.map((account) => [account.sourceId, account]));
    const debtBookingIds = bookingAccounts
      .filter((account) => {
        const netPaid = Math.max(0, (paymentByAccount.get(account.id) || 0) - (refundByAccount.get(account.id) || 0));
        return Number(account.totalAmount || 0) - netPaid > 0.009;
      })
      .map((account) => Number(account.sourceId))
      .filter((id) => Number.isInteger(id) && id > 0);

    const debtBookings = debtBookingIds.length > 0
      ? await prisma.booking.findMany({
          where: {
            id: { in: debtBookingIds },
            clubId
          },
          select: {
            id: true,
            clientId: true,
            startDateTime: true,
            status: true,
            price: true,
            court: {
              select: {
                name: true
              }
            }
          }
        })
      : [];

    const debtBookingsByClient = new Map<string, Array<(typeof debtBookings)[number]>>();
    for (const booking of debtBookings) {
      if (!booking.clientId) continue;
      const existing = debtBookingsByClient.get(booking.clientId) || [];
      existing.push(booking);
      debtBookingsByClient.set(booking.clientId, existing);
    }

    return clients.map((client) => ({
      history: (debtBookingsByClient.get(client.id) || [])
        .map((booking) => {
          const accountRecord = accountBySourceId.get(String(booking.id));
          const total = Number(accountRecord?.totalAmount ?? booking.price ?? 0);
          const paid = accountRecord
            ? Math.max(0, (paymentByAccount.get(accountRecord.id) || 0) - (refundByAccount.get(accountRecord.id) || 0))
            : 0;
          const remaining = Math.max(0, Number((total - paid).toFixed(2)));
          const paymentStatus = remaining <= 0.009 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DEBT';
          const dt = new Date(booking.startDateTime);
          const hh = String(dt.getHours()).padStart(2, '0');
          const mm = String(dt.getMinutes()).padStart(2, '0');

          return {
            id: booking.id,
            sourceType: 'BOOKING',
            date: dt.toISOString().slice(0, 10),
            time: `${hh}:${mm}`,
            status: booking.status,
            paymentStatus,
            price: Number(booking.price ?? 0),
            amount: remaining,
            courtName: booking.court?.name,
            items: []
          };
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
      id: client.id,
      firstName: client.name,
      lastName: '',
      dni: client.dni || null,
      email: client.email,
      phoneNumber: client.phone,
      totalBookings: client._count.bookings,
      totalDebt: (debtBookingsByClient.get(client.id) || []).reduce((sum, booking) => {
        const accountRecord = accountBySourceId.get(String(booking.id));
        const total = Number(accountRecord?.totalAmount ?? booking.price ?? 0);
        const paid = accountRecord
          ? Math.max(0, (paymentByAccount.get(accountRecord.id) || 0) - (refundByAccount.get(accountRecord.id) || 0))
          : 0;
        const remaining = Math.max(0, Number((total - paid).toFixed(2)));
        return sum + remaining;
      }, 0)
    }));
  }
}
