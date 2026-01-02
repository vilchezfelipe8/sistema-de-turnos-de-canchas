import 'dotenv/config';
import express, { Request, Response } from 'express';
import { prisma } from './prisma'; 
import bookingRoutes from './routes/BookingRoutes'; // <--- SOLO IMPORTAMOS RESERVAS
import CourtRoutes from './routes/CourtRoutes';
import authRoutes from './routes/AuthRoutes';

const app = express();
const PORT = process.env.PORT || 3000;
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
if (!['development', 'production', 'test'].includes(NODE_ENV)) {
  console.warn(`⚠️ NODE_ENV value "${NODE_ENV}" is uncommon. Expected one of development|production|test`);
}

app.use(express.json());

// --- SOLO RUTAS DE RESERVAS ---
app.use('/api/bookings', bookingRoutes); 
// Borré la linea de app.use('/api/activities'...) porque no la vamos a usar.

app.use('/api/courts', CourtRoutes);

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'API Sistema de Turnos (Solo Padel) 🚀' });
});

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Conectado a la base de datos');

    app.use('/api/auth', authRoutes);

    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

startServer();