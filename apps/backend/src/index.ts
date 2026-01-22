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

// WhatsApp QR endpoint
app.get('/whatsapp/qr', (_req: Request, res: Response) => {
  const { whatsappService } = require('./services/WhatsappService');
  const qr = whatsappService.getQR();
  const status = whatsappService.getStatus();

  if (!qr) {
    if (status.ready) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WhatsApp - Conectado</title>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .status { background: #25D366; color: white; padding: 20px; border-radius: 10px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="status">
            <h1>✅ WhatsApp Conectado</h1>
            <p>El servicio de WhatsApp ya está listo y funcionando.</p>
          </div>
        </body>
        </html>
      `);
    }
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp - Sin QR</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .status { background: #ff9800; color: white; padding: 20px; border-radius: 10px; display: inline-block; }
        </style>
        <meta http-equiv="refresh" content="5">
      </head>
      <body>
        <div class="status">
          <h1>⏳ Esperando QR...</h1>
          <p>El código QR se generará automáticamente. Esta página se actualizará en 5 segundos.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Generar HTML con el QR usando una librería CDN
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp QR Code</title>
      <meta charset="utf-8">
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js" onload="window.qrcodeLoaded = true"></script>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          text-align: center; 
          padding: 50px; 
          background: #f5f5f5; 
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          display: inline-block;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        #qrcode {
          margin: 20px 0;
        }
        .instructions {
          margin-top: 20px;
          color: #666;
          max-width: 400px;
          margin-left: auto;
          margin-right: auto;
        }
        .status {
          color: #25D366;
          font-weight: bold;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 Escanea el código QR</h1>
        <p>Usa WhatsApp en tu teléfono para escanear este código:</p>
        <div id="qrcode"></div>
        <div class="instructions">
          <p>1. Abre WhatsApp en tu teléfono</p>
          <p>2. Ve a Configuración → Dispositivos vinculados</p>
          <p>3. Toca "Vincular un dispositivo"</p>
          <p>4. Escanea este código QR</p>
        </div>
        <div class="status" id="status">⏳ Esperando conexión...</div>
        <p style="margin-top: 20px; color: #999; font-size: 12px;">
          Esta página se actualizará automáticamente cuando WhatsApp se conecte.
        </p>
      </div>
      <script>
        const qrData = ${JSON.stringify(qr)};
        
        // Esperar a que la librería QRCode se cargue completamente
        function generateQR() {
          if (typeof QRCode === 'undefined' || !window.qrcodeLoaded) {
            console.log('Esperando QRCode...');
            setTimeout(generateQR, 100);
            return;
          }
          
          try {
            QRCode.toCanvas(document.getElementById('qrcode'), qrData, {
              width: 300,
              margin: 2
            }, function (error) {
              if (error) {
                console.error(error);
                document.getElementById('qrcode').innerHTML = '<p style="color: red;">Error generando QR</p>';
              }
            });
          } catch (error) {
            console.error('Error al generar QR:', error);
            document.getElementById('qrcode').innerHTML = '<p style="color: red;">Error generando QR: ' + error.message + '</p>';
          }
        }
        
        // Esperar a que todo esté listo
        window.addEventListener('load', function() {
          generateQR();
        });
        
        // También intentar inmediatamente si ya está cargado
        if (document.readyState === 'complete' && typeof QRCode !== 'undefined' && window.qrcodeLoaded) {
          generateQR();
        }

        // Verificar estado cada 3 segundos
        setInterval(function() {
          fetch('/whatsapp/status')
            .then(res => res.json())
            .then(data => {
              if (data.ready) {
                document.getElementById('status').innerHTML = '✅ WhatsApp Conectado!';
                document.getElementById('status').style.color = '#25D366';
                setTimeout(() => {
                  window.location.reload();
                }, 2000);
              }
            })
            .catch(err => console.error('Error:', err));
        }, 3000);
      </script>
    </body>
    </html>
  `);
});

// WhatsApp status endpoint
app.get('/whatsapp/status', (_req: Request, res: Response) => {
  const { whatsappService } = require('./services/WhatsappService');
  const status = whatsappService.getStatus();
  res.json(status);
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

