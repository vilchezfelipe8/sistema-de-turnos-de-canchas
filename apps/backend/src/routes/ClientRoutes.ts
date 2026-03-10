import { Router } from 'express';
import { prisma } from '../prisma';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';

const router = Router();

// GET /api/clients/:slug — solo el admin de ese club puede ver la lista
router.get('/:slug', authMiddleware, verifyClubAccess, requireRole('ADMIN'), async (req, res) => {
  try {
    const club = (req as any).club;

    const clients = await prisma.client.findMany({
      where: {
        clubId: club.id
      },
      orderBy: {
        createdAt: 'desc'
      },
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
        clubId: club.id,
        sourceType: 'BOOKING'
      },
      select: {
        sourceId: true,
        totalAmount: true,
        paidAmount: true
      }
    });

    const accountBySourceId = new Map(bookingAccounts.map((account) => [account.sourceId, account]));
    const debtBookingIds = bookingAccounts
      .filter((account) => Number(account.totalAmount || 0) - Number(account.paidAmount || 0) > 0.009)
      .map((account) => Number(account.sourceId))
      .filter((id) => Number.isInteger(id) && id > 0);

    const debtBookings = debtBookingIds.length > 0
      ? await prisma.booking.findMany({
          where: {
            id: { in: debtBookingIds },
            clubId: club.id
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

    const debtBookingsByClient = new Map<string, any[]>();
    for (const booking of debtBookings) {
      if (!booking.clientId) continue;
      const existing = debtBookingsByClient.get(booking.clientId) || [];
      existing.push(booking);
      debtBookingsByClient.set(booking.clientId, existing);
    }

    const clientsArray = clients.map((client) => ({
      history: (debtBookingsByClient.get(client.id) || [])
        .map((booking) => {
          const accountRecord = accountBySourceId.get(String(booking.id));
          const total = Number(accountRecord?.totalAmount ?? booking.price ?? 0);
          const paid = Number(accountRecord?.paidAmount ?? 0);
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
        const paid = Number(accountRecord?.paidAmount ?? 0);
        const remaining = Math.max(0, Number((total - paid).toFixed(2)));
        return sum + remaining;
      }, 0)
    }));

    res.json(clientsArray);

  } catch (error) {
    console.error('Error getting clients:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;