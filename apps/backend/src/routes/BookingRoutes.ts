import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { CashRepository } from '../repositories/CashRepository';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';
import { ProductRepository } from '../repositories/ProductRepository';
import { bookingLimiter } from '../middleware/rateLimit';

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
router.get('/availability-with-courts', optionalAuthMiddleware, (req, res) => bookingController.getAvailableSlotsWithCourts(req, res));
router.post('/quote', bookingLimiter, optionalAuthMiddleware, (req, res) => bookingController.quoteBookingPrice(req, res));

// Cancelación: usuario puede cancelar la propia; admin con clubId valida que sea de su club
router.post('/cancel', authMiddleware, (req, res) => bookingController.cancelBooking(req, res));
router.post('/:id/confirm', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.confirmBooking(req, res));
router.post('/:id/complete', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.completeBooking(req, res));

// Crear Reserva (Base)
router.post('/', bookingLimiter, optionalAuthMiddleware, (req, res) => bookingController.createBooking(req, res));
// Items y Productos
router.get('/:id/items', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.getItems(req, res));
router.post('/:id/items', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.addItem(req, res));
router.post('/:id/items/quote', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.quoteItem(req, res));
router.delete('/items/:itemId', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.removeItem(req, res));

// Historial y Estados
router.get('/history/:userId', authMiddleware, (req, res) => bookingController.getHistory(req, res));
router.get('/:id', authMiddleware, setAdminClubFromUser, requireTenantRole(['ADMIN', 'STAFF']), (req, res) => bookingController.getById(req, res));

// Commit 3 — Cambio explícito de titular (solo OWNER/ADMIN, bloqueado si hay pagos/devoluciones)
router.patch('/:id/client', authMiddleware, setAdminClubFromUser, requireTenantRole(['OWNER', 'ADMIN']), (req, res) => bookingController.changeBookingClient(req, res));

export default router;
