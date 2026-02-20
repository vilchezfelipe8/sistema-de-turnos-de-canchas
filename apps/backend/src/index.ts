import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { whatsappService } from './services/WhatsappService';

import { prisma } from './prisma';
import { BookingStatus } from './entities/Enums';

import bookingRoutes from './routes/BookingRoutes';
import CourtRoutes from './routes/CourtRoutes';
import ClubRoutes from './routes/ClubRoutes';
import ClubAdminRoutes from './routes/ClubAdminRoutes';
import LocationRoutes from './routes/LocationRoutes';
import authRoutes from './routes/AuthRoutes';
import ClientRoutes from './routes/ClientRoutes';
import HealthRoutes from './routes/HealthRoutes';
import CashRoutes from './routes/CashRoutes';

import { errorHandler } from './middleware/ErrorHandler';
import { authMiddleware } from './middleware/AuthMiddleware';
import { requireRole } from './middleware/RoleMiddleware';

const app = express();

/* =====================================================
   CORS
===================================================== */

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',

  // Dominio producción
  'https://tucancha.app',
  'https://www.tucancha.app',

  // IP pública
  'http://187.77.48.97',
  'https://187.77.48.97'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueado para:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization', 'Cache-Control', 'Pragma', 'Expires']
}));

/* =====================================================
   CONFIG
===================================================== */

const PORT = Number(process.env.PORT) || 3000;

if (!process.env.JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment.');
  process.exit(1);
}

const BOOKINGS_COMPLETION_INTERVAL_MS =
  Number(process.env.BOOKINGS_COMPLETION_INTERVAL_MS) || 60_000;

/* =====================================================
   MIDDLEWARES
===================================================== */

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

/* =====================================================
   RUTAS
===================================================== */

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/courts', CourtRoutes);
app.use('/api/clubs', ClubRoutes);
app.use('/api/clubs', ClubAdminRoutes);
app.use('/api/locations', LocationRoutes);
app.use('/api/health', HealthRoutes);
app.use('/api/cash', CashRoutes);
app.use('/clients', ClientRoutes);

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'API Sistema de Turnos' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/* =====================================================
   WHATSAPP
===================================================== */

app.get(
  '/whatsapp/qr',
  authMiddleware,
  requireRole('ADMIN'),
  async (_req: Request, res: Response) => {

    const status = whatsappService.getStatus();

    if (status.disabled) {
      return res.status(200).send(`<h1>📵 WhatsApp Deshabilitado</h1>`);
    }

    const qr = whatsappService.getQR();

    if (!qr) {
      if (status.ready) {
        return res.status(200).send(`<h1>✅ WhatsApp Conectado</h1>`);
      }
      return res
        .status(404)
        .send(`<meta http-equiv="refresh" content="5"><h1>⏳ Esperando QR...</h1>`);
    }

    try {
      const qrSvg = await QRCode.toString(qr, {
        type: 'svg',
        width: 300,
        margin: 2
      });

      res.status(200).send(`
        <html>
        <body style="text-align:center;font-family:sans-serif;">
          <h1>📱 Escanea el código QR</h1>
          ${qrSvg}
        </body>
        </html>
      `);
    } catch (error) {
      console.error('Error generando QR:', error);
      res.status(500).send('Error generando QR');
    }
  }
);

app.get('/whatsapp/status', (_req: Request, res: Response) => {
  res.json(whatsappService.getStatus());
});

/* =====================================================
   START SERVER
===================================================== */

const startServer = async () => {
  try {
    await prisma.$connect();

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
          .filter(b => b.endDateTime.getTime() <= now.getTime())
          .map(b => b.id);

        if (toComplete.length > 0) {
          await prisma.booking.updateMany({
            where: { id: { in: toComplete } },
            data: { status: BookingStatus.COMPLETED }
          });
        }
      } catch (error) {
        console.error('❌ Error completando turnos:', error);
      }
    };

    await completePastBookings();

    const interval = setInterval(
      completePastBookings,
      BOOKINGS_COMPLETION_INTERVAL_MS
    );

    interval.unref?.();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server listening on port ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

app.use(errorHandler);

startServer();
