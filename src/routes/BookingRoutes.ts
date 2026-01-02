import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
// IMPORTANTE: Asegúrate de que la ruta coincida con tu carpeta (middlewares o middleware)
import { authMiddleware } from '../middleware/AuthMiddleware';

// 1. Importar TODOS los repositorios necesarios
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';

const router = Router();

// --- INYECCIÓN DE DEPENDENCIAS ---

// 2. Instanciamos todos los repositorios
const bookingRepository = new BookingRepository();
const courtRepository = new CourtRepository();
const userRepository = new UserRepository();
const activityRepository = new ActivityTypeRepository();

// 3. Instanciamos el Servicio pasándole LOS 4 argumentos
const bookingService = new BookingService(
    bookingRepository, 
    courtRepository, 
    userRepository, 
    activityRepository
);

// 4. Instanciamos el Controlador
const bookingController = new BookingController(bookingService);


// --- DEFINICIÓN DE RUTAS PROTEGIDAS ---

// A. Disponibilidad (PÚBLICA: Cualquiera puede ver horarios libres)
router.get('/availability', bookingController.getAvailability);

// B. Rutas que requieren LOGIN (authMiddleware)

// 1. Crear reserva
router.post('/', authMiddleware, bookingController.createBooking);

// 2. Cancelar reserva
router.post('/cancel', authMiddleware, bookingController.cancelBooking);

// 3. Ver historial de un usuario
router.get('/history/:userId', authMiddleware, bookingController.getHistory);

// 4. Ver grilla completa (Admin)
router.get('/admin/schedule', authMiddleware, bookingController.getAdminSchedule);

export default router;