import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
import { authMiddleware } from '../middleware/AuthMiddleware';
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
router.post('/', authMiddleware, bookingController.createBooking);
router.post('/cancel', authMiddleware, bookingController.cancelBooking);
router.get('/history/:userId', authMiddleware, bookingController.getHistory);
router.get('/admin/schedule', authMiddleware, requireRole('ADMIN'), bookingController.getAdminSchedule);

export default router;

