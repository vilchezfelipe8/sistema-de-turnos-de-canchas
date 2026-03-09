import { Router } from 'express';
import { prisma } from '../prisma';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { getUserClubContext } from '../utils/getUserClubContext';

const router = Router();
/** Middleware: verifica que clubSlug en query sea el club del admin autenticado */
const verifyClubSlugAccess = async (req: any, res: any, next: Function) => {
  try {
    const clubSlug = req.query.clubSlug;
    if (!clubSlug) return res.status(400).json({ error: 'Falta el clubSlug' });
    const club = await prisma.club.findUnique({ where: { slug: String(clubSlug) } });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    let context;
    try {
      context = await getUserClubContext(Number(req.user.userId), club.id);
    } catch {
      return res.status(403).json({ error: 'No tienes acceso a este club' });
    }

    if (!context || context.clubId !== club.id) return res.status(403).json({ error: 'No tienes acceso a este club' });
    req.club = club;
    req.clubContext = context;
    req.membershipRole = context.role;
    next();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/clients?clubSlug=... — solo el admin de ese club puede ver la lista
router.get('/', authMiddleware, verifyClubSlugAccess, requireRole('ADMIN'), async (req, res) => {
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
        bookings: {
          where: {
            clubId: club.id
          },
          select: {
            id: true,
            startDateTime: true,
            status: true,
            price: true,
            court: {
              select: {
                name: true
              }
            }
          }
        },
        _count: {
          select: {
            bookings: true
          }
        }
      }
    });

    const allBookingIds = clients.flatMap((client) => client.bookings.map((booking) => booking.id));
    const bookingAccounts = allBookingIds.length
      ? await prisma.account.findMany({
          where: {
            clubId: club.id,
            sourceType: 'BOOKING',
            sourceId: {
              in: allBookingIds.map((id) => String(id))
            }
          },
          select: {
            sourceId: true,
            totalAmount: true,
            paidAmount: true
          }
        })
      : [];

    const accountBySourceId = new Map(bookingAccounts.map((account) => [account.sourceId, account]));

    const clientsArray = clients.map((client) => ({
      history: client.bookings
        .map((booking) => {
          const account = accountBySourceId.get(String(booking.id));
          const total = Number(account?.totalAmount ?? booking.price ?? 0);
          const paid = Number(account?.paidAmount ?? 0);
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
      totalDebt: client.bookings.reduce((sum, booking) => {
        const account = accountBySourceId.get(String(booking.id));
        const total = Number(account?.totalAmount ?? booking.price ?? 0);
        const paid = Number(account?.paidAmount ?? 0);
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