import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';

const router = Router();

const bookingRepository = new BookingRepository();
const courtRepository = new CourtRepository();
const userRepository = new UserRepository();
const activityRepository = new ActivityTypeRepository();

const bookingService = new BookingService(
    bookingRepository,
    courtRepository,
    userRepository,
    activityRepository
);

const bookingController = new BookingController(bookingService);

import { requireRole } from '../middleware/RoleMiddleware';

router.get('/availability', bookingController.getAvailability);
router.get('/all-availability', bookingController.getAllAvailableSlots);
router.get('/availability-with-courts', bookingController.getAvailableSlotsWithCourts);
router.post('/', optionalAuthMiddleware, bookingController.createBooking);
router.post('/cancel', authMiddleware, bookingController.cancelBooking);
router.post('/confirm', authMiddleware, requireRole('ADMIN'), bookingController.confirmBooking);
router.get('/history/:userId', authMiddleware, bookingController.getHistory);
router.get('/admin/schedule', authMiddleware, requireRole('ADMIN'), bookingController.getAdminSchedule);
router.post('/fixed', authMiddleware, requireRole('ADMIN'), bookingController.createFixed);
router.delete('/fixed/:id', authMiddleware, requireRole('ADMIN'), bookingController.cancelFixed);
router.get('/:id/items', authMiddleware, bookingController.getItems);
router.post('/:id/items', authMiddleware, bookingController.addItem);
router.delete('/items/:itemId', authMiddleware, bookingController.removeItem);

export default router;

