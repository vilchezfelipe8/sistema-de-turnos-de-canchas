import { Router } from 'express';
import { BookingController } from '../controllers/BookingController';
import { CourtController } from '../controllers/CourtController';
import { ClubController } from '../controllers/ClubController';
import { BookingService } from '../services/BookingService';
import { ClubService } from '../services/ClubService';
import { ClubRepository } from '../repositories/ClubRepository';
import { BookingRepository } from '../repositories/BookingRepository';
import { CourtRepository } from '../repositories/CourtRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';
import { ProductController } from '../controllers/ProductController';
import { ProductRepository } from '../repositories/ProductRepository';
import { CashRepository } from '../repositories/CashRepository';

const router = Router();

// Inicializar servicios y controladores
const bookingRepository = new BookingRepository();
const courtRepository = new CourtRepository();
const userRepository = new UserRepository();
const activityRepository = new ActivityTypeRepository();
const clubRepository = new ClubRepository();
const productController = new ProductController();
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

const clubService = new ClubService(clubRepository, activityRepository);

const bookingController = new BookingController(bookingService);
const courtController = new CourtController();
const clubController = new ClubController(clubService);

// Todas las rutas requieren autenticación, rol ADMIN y verificación de acceso al club
// El middleware verifyClubAccess agrega req.clubId al request
// Las rutas se montan en /api/clubs/:slug/admin

// Obtener schedule del admin para un club específico
router.get('/:slug/admin/schedule', 
    authMiddleware, 
    requireRole('ADMIN'), 
    verifyClubAccess, 
    bookingController.getAdminSchedule
);

// Obtener todas las canchas del club
router.get('/:slug/admin/courts',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    courtController.getAllCourts
);

// Crear cancha en el club
router.post('/:slug/admin/courts',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    courtController.createCourt
);

// Actualizar cancha (solo si pertenece al club)
router.put('/:slug/admin/courts/:id',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    courtController.updateCourt
);

// Suspender/Reactivar cancha
router.put('/:slug/admin/courts/:id/suspend',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    courtController.suspendCourt
);

router.put('/:slug/admin/courts/:id/reactivate',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    courtController.reactivateCourt
);

// Obtener información del club
router.get('/:slug/admin/info',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    (req: any, res: any) => {
        res.json(req.club);
    }
);

// Actualizar información del club
router.put('/:slug/admin/info',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    async (req: any, res: any) => {
        try {
            const club = await clubController.updateClub(req.club.id, req.body);
            res.json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
);

// Crear reserva fija
router.post('/:slug/admin/bookings/fixed',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    bookingController.createFixed
);

// Cancelar reserva fija
router.delete('/:slug/admin/bookings/fixed/:id',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    bookingController.cancelFixed
);

// Confirmar reserva
router.post('/:slug/admin/bookings/confirm',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    bookingController.confirmBooking
);

// Cancelar reserva
router.post('/:slug/admin/bookings/cancel',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    bookingController.cancelBooking
);

// 1. Obtener todos los productos del club
router.get('/:slug/admin/products',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    productController.getAll
);

// 2. Crear un nuevo producto
router.post('/:slug/admin/products',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    productController.create
);

// 3. Editar un producto existente (precio, stock, nombre)
router.put('/:slug/admin/products/:id',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    productController.update
);

// 4. Eliminar un producto
router.delete('/:slug/admin/products/:id',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    productController.delete
);

router.get('/:slug/admin/clients-list',
    authMiddleware,
    requireRole('ADMIN'),
    verifyClubAccess,
    clubController.getClubClientsList 
);

export default router;
