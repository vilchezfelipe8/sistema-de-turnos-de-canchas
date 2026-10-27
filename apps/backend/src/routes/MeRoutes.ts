import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { BookingService } from '../services/BookingService';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { playerLookupLimiter, playerSearchLimiter } from '../middleware/rateLimit';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { CashRepository } from '../repositories/CashRepository';
import { ProductRepository } from '../repositories/ProductRepository';
import { PlayerSlotController } from '../controllers/PlayerSlotController';
import { PlayerInviteSearchController } from '../controllers/PlayerInviteSearchController';

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

router.get('/bookings', authMiddleware, (req, res) => bookingController.getMyBookings(req, res));
router.get('/bookings/:id/checkout', authMiddleware, (req, res) => bookingController.getMyBookingCheckout(req, res));
router.post('/bookings/:id/checkout/mercadopago', authMiddleware, (req, res) => bookingController.createMyBookingMercadoPagoCheckout(req, res));
router.get('/bookings/:id/participants', authMiddleware, (req, res) => bookingController.getMyBookingParticipants(req, res));
router.post('/bookings/:id/participants/invite', authMiddleware, (req, res) => bookingController.inviteMyBookingParticipant(req, res));
const playerSlotController = new PlayerSlotController();
router.get('/bookings/:id/player-slots', authMiddleware, (req, res) => playerSlotController.getMySlots(req, res));
router.post('/bookings/:id/participants/:participantId/remove', authMiddleware, (req, res) => bookingController.removeMyBookingParticipant(req, res));
router.post('/bookings/:id/cancel', authMiddleware, (req, res) => bookingController.cancelMyBooking(req, res));
router.post('/bookings/:id/leave', authMiddleware, (req, res) => bookingController.leaveMyBooking(req, res));
router.post('/players/lookup', authMiddleware, playerLookupLimiter, (req, res) => bookingController.lookupPlayerForInvitation(req, res));
// Invitar por nombre: búsqueda acotada al club y "Jugaron con vos".
const playerInviteSearchController = new PlayerInviteSearchController();
router.get('/players/search', authMiddleware, playerSearchLimiter, (req, res) => playerInviteSearchController.search(req, res));
router.get('/players/frequent', authMiddleware, playerSearchLimiter, (req, res) => playerInviteSearchController.frequent(req, res));
router.get('/booking-invitations', authMiddleware, (req, res) => bookingController.getMyBookingInvitations(req, res));
router.post('/booking-invitations/:id/accept', authMiddleware, (req, res) => bookingController.acceptMyBookingInvitation(req, res));
router.post('/booking-invitations/:id/decline', authMiddleware, (req, res) => bookingController.declineMyBookingInvitation(req, res));

export default router;
