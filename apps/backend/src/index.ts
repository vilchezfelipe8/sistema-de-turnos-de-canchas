import 'dotenv/config';
import express, { Request, Response } from 'express';
import { prisma } from './prisma'; 
import bookingRoutes from './routes/BookingRoutes'; // <--- SOLO IMPORTAMOS RESERVAS
import CourtRoutes from './routes/CourtRoutes';
import authRoutes from './routes/AuthRoutes';
import cors from 'cors';
import { BookingStatus } from './entities/Enums';

const app = express();

// Configurar CORS dinámicamente según el entorno
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3001', // Para desarrollo local
  'http://localhost:3000', // Alternativa local
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment. Set it in .env or as an environment variable.');
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment. Set it in .env or as an environment variable.');
  process.exit(1);
}
const NODE_ENV = process.env.NODE_ENV || 'development';
const BOOKINGS_COMPLETION_INTERVAL_MS = Number(process.env.BOOKINGS_COMPLETION_INTERVAL_MS) || 1 * 60 * 1000;

app.use(express.json());

// --- SOLO RUTAS DE RESERVAS ---
app.use('/api/bookings', bookingRoutes); 
// Borré la linea de app.use('/api/activities'...) porque no la vamos a usar.

app.use('/api/courts', CourtRoutes);

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'API Sistema de Turnos' });
});

// Healthcheck endpoint for readiness probes
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

import { errorHandler } from './middleware/ErrorHandler';

const startServer = async () => {
  try {
    await prisma.$connect();
    app.use('/api/auth', authRoutes);

    const completePastBookings = async () => {
      try {
        const now = new Date();
        const candidates = await prisma.booking.findMany({
          where: {
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
            startDateTime: { lt: now }
          },
          select: { id: true, endDateTime: true }
        });

        const toComplete = candidates
          .filter((booking) => booking.endDateTime.getTime() <= now.getTime())
          .map((booking) => booking.id);

        if (toComplete.length > 0) {
          await prisma.booking.updateMany({
            where: { id: { in: toComplete } },
            data: { status: BookingStatus.COMPLETED }
          });
        }
      } catch (error) {
        console.error('❌ Error al completar turnos vencidos:', error);
      }
    };

    await completePastBookings();
    const completionInterval = setInterval(completePastBookings, BOOKINGS_COMPLETION_INTERVAL_MS);
    completionInterval.unref?.();

    app.listen(PORT, '0.0.0.0', () => {
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

// Error handler (último middleware)
app.use(errorHandler);

startServer();

