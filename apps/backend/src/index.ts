import 'dotenv/config';
import express, { Request, Response } from 'express';
import { prisma } from './prisma'; 
import bookingRoutes from './routes/BookingRoutes'; 
import CourtRoutes from './routes/CourtRoutes';
import ClubRoutes from './routes/ClubRoutes';
import ClubAdminRoutes from './routes/ClubAdminRoutes';
import LocationRoutes from './routes/LocationRoutes';
import authRoutes from './routes/AuthRoutes';
import cors from 'cors';
import { BookingStatus } from './entities/Enums';
import QRCode from 'qrcode';
// 👇 Importante: Importamos la ruta de clientes
import ClientRoutes from './routes/ClientRoutes';
import { errorHandler } from './middleware/ErrorHandler'; // Movi el import aquí arriba para ordenar
import HealthRoutes from './routes/HealthRoutes'; // Importamos las rutas de healthcheck
import CashRoutes from './routes/CashRoutes';

const app = express();

// Configurar CORS dinámicamente según el entorno
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3001', // Para desarrollo local
  'http://localhost:3000', // Alternativa local
  'https://sistema-de-turnos-production-83b8.up.railway.app', // Frontend en Railway
  'https://sistema-de-turnos-de-canchas.vercel.app', // Frontend en Vercel
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Verificar si el origen está en la lista permitida
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Permitir cualquier subdominio de railway.app o vercel.app (para flexibilidad)
    if (origin.includes('.railway.app') || origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // Permitir IPs locales para desarrollo
    const localIpPattern = /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+|localhost|127\.0\.0\.1)(:\d+)?$/;
    if (localIpPattern.test(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

const PORT = Number(process.env.PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment.');
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment.');
  process.exit(1);
}
const BOOKINGS_COMPLETION_INTERVAL_MS = Number(process.env.BOOKINGS_COMPLETION_INTERVAL_MS) || 1 * 60 * 1000;

app.use(express.json());

// 👇 ZONA DE RUTAS
app.use('/clients', ClientRoutes); 

app.use('/api/bookings', bookingRoutes); 
app.use('/api/courts', CourtRoutes);
app.use('/api/clubs', ClubRoutes); // Para rutas generales de club
app.use('/api/clubs', ClubAdminRoutes); // Para rutas admin de club
app.use('/api/locations', LocationRoutes);
app.use('/api/health', HealthRoutes);
app.use('/api/cash', CashRoutes); // Ruta para caja

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'API Sistema de Turnos' });
});

// Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// WhatsApp QR endpoint
app.get('/whatsapp/qr', async (_req: Request, res: Response) => {
  // Nota: Usamos require aquí para evitar cargar el servicio si no se usa la ruta, 
  // pero idealmente debería importarse arriba. Lo dejo como lo tenías.
  const { whatsappService } = require('./services/WhatsappService');
  const status = whatsappService.getStatus();

  if (status.disabled) {
    return res.status(200).send(`<html><body><h1>📵 WhatsApp Deshabilitado</h1></body></html>`);
  }

  const qr = whatsappService.getQR();

  if (!qr) {
    if (status.ready) {
      return res.status(200).send(`<html><body><h1>✅ WhatsApp Conectado</h1></body></html>`);
    }
    return res.status(404).send(`<html><head><meta http-equiv="refresh" content="5"></head><body><h1>⏳ Esperando QR...</h1></body></html>`);
  }

  try {
    const qrSvg = await QRCode.toString(qr, { type: 'svg', width: 300, margin: 2 });
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>WhatsApp QR</title></head>
      <body style="text-align:center; font-family:sans-serif;">
        <h1>📱 Escanea el código QR</h1>
        <div>${qrSvg}</div>
        <script>
          setInterval(() => {
            fetch('/whatsapp/status').then(r=>r.json()).then(d=>{
              if(d.ready) location.reload();
            });
          }, 3000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).send('Error generando QR');
  }
});

app.get('/whatsapp/status', (_req: Request, res: Response) => {
  const { whatsappService } = require('./services/WhatsappService');
  res.json(whatsappService.getStatus());
});


const startServer = async () => {
  try {
    await prisma.$connect();
    // Movemos authRoutes aquí para mantener tu lógica original
    app.use('/api/auth', authRoutes);

    // Lógica de completar turnos viejos
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
      console.log(`🚀 Server listening on port ${PORT}`);
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