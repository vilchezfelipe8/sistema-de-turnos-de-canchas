import { Router } from 'express';
import { prisma } from '../prisma';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
/** Middleware: verifica que clubSlug en query sea el club del admin autenticado */
const verifyClubSlugAccess = async (req: any, res: any, next: Function) => {
  try {
    const clubSlug = req.query.clubSlug;
    if (!clubSlug) return res.status(400).json({ error: 'Falta el clubSlug' });
    const club = await prisma.club.findUnique({ where: { slug: String(clubSlug) } });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    const fullUser = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { clubId: true } });
    if (!fullUser || fullUser.clubId !== club.id) return res.status(403).json({ error: 'No tienes acceso a este club' });
    req.club = club;
    next();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /clients?clubSlug=... — solo el admin de ese club puede ver la lista
router.get('/', authMiddleware, requireRole('ADMIN'), verifyClubSlugAccess, async (req, res) => {
  try {
    const club = (req as any).club;

    // Buscamos todas las reservas de ese club
    // CORRECCIÓN APLICADA AQUÍ ABAJO 👇
    const bookings = await prisma.booking.findMany({
      where: {
        court: {            // Entramos a la relación con la Cancha
          clubId: club.id   // Filtramos las canchas de este club
        }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        guestName: true,
        guestPhone: true,
        guestEmail: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true
          }
        }
      }
    });

    // 3. "Fabricamos" los clientes agrupando por Teléfono o Nombre
    const clientsMap = new Map();

    bookings.forEach((booking) => {
      // Prioridad: Usuario registrado > Invitado
      const phone = booking.user?.phoneNumber || booking.guestPhone || '';
      
      const rawName = booking.user 
        ? `${booking.user.firstName} ${booking.user.lastName}` 
        : booking.guestName;
      
      const email = booking.user?.email || booking.guestEmail || '';

      // Usamos el teléfono como ID único. Si no tiene, usamos el nombre.
      const uniqueKey = phone && phone.length > 4 ? phone.trim() : (rawName ? rawName.trim() : 'Desconocido');

      if (uniqueKey === 'Desconocido') return;

      if (!clientsMap.has(uniqueKey)) {
        clientsMap.set(uniqueKey, {
          id: booking.id, // ID ficticio para la tabla visual
          firstName: rawName || 'Sin Nombre',
          lastName: '',   
          email: email,
          phoneNumber: phone,
          totalBookings: 0 
        });
      }

      // Sumar al contador de reservas
      const client = clientsMap.get(uniqueKey);
      client.totalBookings += 1;
      
      // Actualizar datos si la reserva es más nueva y tiene mejor info
      if (!client.phoneNumber && phone) client.phoneNumber = phone;
      if (!client.email && email) client.email = email;
    });

    const clientsArray = Array.from(clientsMap.values());

    res.json(clientsArray);

  } catch (error) {
    console.error('Error getting clients:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /clients/me?q=... — busca clientes del club del admin (usa req.clubId)
router.get('/me', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, async (req: any, res: any) => {
  try {
    const clubId = req.clubId;
    if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });

    const query = String(req.query.q || '').toLowerCase().trim();

    const bookings = await prisma.booking.findMany({
      where: { court: { clubId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        guestName: true,
        guestPhone: true,
        guestEmail: true,
        guestDni: true,
        user: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, dni: true } }
      }
    });

    const clientsMap = new Map();

    bookings.forEach((booking) => {
      const phone = booking.user?.phoneNumber || booking.guestPhone || '';
      const rawName = booking.user ? `${booking.user.firstName} ${booking.user.lastName}` : booking.guestName;
      const email = booking.user?.email || booking.guestEmail || '';
      const dni = booking.user?.dni || booking.guestDni || '';

      const uniqueKey = phone && phone.length > 4 ? phone.trim() : (dni ? `dni_${dni}` : (rawName ? rawName.trim() : null));
      if (!uniqueKey) return;

      if (!clientsMap.has(uniqueKey)) {
        clientsMap.set(uniqueKey, {
          id: booking.user?.id || booking.id,
          userId: booking.user?.id || null,
          name: rawName || 'Sin Nombre',
          email,
          phoneNumber: phone,
          dni,
          totalBookings: 0
        });
      }

      const client = clientsMap.get(uniqueKey);
      client.totalBookings += 1;
      if (!client.phoneNumber && phone) client.phoneNumber = phone;
      if (!client.email && email) client.email = email;
    });

    let clientsArray = Array.from(clientsMap.values());
    if (query) {
      const isNumeric = /^\d+$/.test(query);
      if (isNumeric) {
        // Si la búsqueda es numérica, priorizamos DNI
        clientsArray = clientsArray.filter((c: any) => {
          const dni = (c.dni || '').toLowerCase();
          return dni.includes(query);
        });
      } else {
        // Búsqueda por nombre/telefono/dni cuando no es numérica
        clientsArray = clientsArray.filter((c: any) => {
          const fullName = (c.name || '').toLowerCase();
          const phone = (c.phoneNumber || '').toLowerCase();
          const dni = (c.dni || '').toLowerCase();
          return fullName.includes(query) || phone.includes(query) || dni.includes(query);
        });
      }
    } else {
      clientsArray = [];
    }

    res.json(clientsArray);
  } catch (error) {
    console.error('Error en /clients/me:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;