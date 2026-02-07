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

router.get('/availability', bookingController.getAvailability);
router.get('/all-availability', bookingController.getAllAvailableSlots);
router.get('/availability-with-courts', bookingController.getAvailableSlotsWithCourts);
router.post('/', optionalAuthMiddleware, bookingController.createBooking);
router.post('/cancel', authMiddleware, bookingController.cancelBooking);
router.post('/confirm', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, bookingController.confirmBooking);
router.get('/history/:userId', authMiddleware, bookingController.getHistory);
router.get('/admin/schedule', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, bookingController.getAdminSchedule);
router.post('/fixed', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, bookingController.createFixed);
router.delete('/fixed/:id', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, bookingController.cancelFixed);
router.get('/:id/items', authMiddleware, bookingController.getItems);
router.post('/:id/items', authMiddleware, bookingController.addItem);
router.delete('/items/:itemId', authMiddleware, bookingController.removeItem);
router.get('/debtors/list', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, bookingController.getDebtors);
router.patch('/:id/payment-status', authMiddleware, bookingController.updateStatus);

export default router;

