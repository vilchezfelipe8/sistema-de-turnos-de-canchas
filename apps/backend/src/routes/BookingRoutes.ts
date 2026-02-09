import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { CashRepository } from '../repositories/CashRepository';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { ProductRepository } from '../repositories/ProductRepository';

const router = Router();

// 1. Instanciamos todo
const bookingRepository = new BookingRepository();
const courtRepository = new CourtRepository();
const userRepository = new UserRepository();
const activityRepository = new ActivityTypeRepository();
const cashRepository = new CashRepository();
const productRepository = new ProductRepository();

const bookingService = new BookingService(
    bookingRepository,
    courtRepository,
    userRepository,
    activityRepository,
    cashRepository,
    productRepository
);

const bookingController = new BookingController(bookingService);

// Disponibilidad
router.get('/availability', (req, res) => bookingController.getAvailability(req, res));
router.get('/all-availability', (req, res) => bookingController.getAllAvailableSlots(req, res));
router.get('/availability-with-courts', (req, res) => bookingController.getAvailableSlotsWithCourts(req, res));

router.post('/confirm', authMiddleware, (req, res) => bookingController.confirmBooking(req, res));

// Cancelación
router.post('/cancel', authMiddleware, (req, res) => bookingController.cancelBooking(req, res));

// Rutas de Admin (Schedule, Fixed, Debtors)
router.get('/admin/schedule', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, (req, res) => bookingController.getAdminSchedule(req, res));
router.post('/fixed', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, (req, res) => bookingController.createFixed(req, res));
router.delete('/fixed/:id', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, (req, res) => bookingController.cancelFixed(req, res));

// Deudores (Esta tiene que ir ANTES de cualquier ruta con /:id para no confundirse)
router.get('/debtors/list', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, (req, res) => bookingController.getDebtors(req, res));

// Crear Reserva (Base)
router.post('/', optionalAuthMiddleware, (req, res) => bookingController.createBooking(req, res));


// Items y Productos
router.get('/:id/items', authMiddleware, (req, res) => bookingController.getItems(req, res));
router.post('/:id/items', authMiddleware, (req, res) => bookingController.addItem(req, res));
router.delete('/items/:itemId', authMiddleware, (req, res) => bookingController.removeItem(req, res));

// Historial y Estados
router.get('/history/:userId', authMiddleware, (req, res) => bookingController.getHistory(req, res));
router.patch('/:id/payment-status', authMiddleware, (req, res) => bookingController.updateStatus(req, res));


export default router;