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
import { z } from 'zod';
import { ActivityTypeAdminService } from '../services/ActivityTypeAdminService';
import { DiscountController } from '../controllers/DiscountController';
import { ClubServiceCatalogController } from '../controllers/ClubServiceCatalogController';

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
const activityTypeAdminService = new ActivityTypeAdminService();
const discountController = new DiscountController();
const clubServiceCatalogController = new ClubServiceCatalogController();

// Todas las rutas requieren autenticación, rol ADMIN y verificación de acceso al club
// El middleware verifyClubAccess agrega req.clubId al request
// Las rutas se montan en /api/clubs/:slug/admin

// Obtener schedule del admin para un club específico
router.get('/:slug/admin/schedule', 
    authMiddleware, 
    verifyClubAccess, 
    requireRole('ADMIN'), 
    bookingController.getAdminSchedule
);

// Obtener todas las canchas del club
router.get('/:slug/admin/courts',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    courtController.getAllCourts
);

// Crear cancha en el club
router.post('/:slug/admin/courts',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    courtController.createCourt
);

// Actualizar cancha (solo si pertenece al club)
router.put('/:slug/admin/courts/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    courtController.updateCourt
);

// Suspender/Reactivar cancha
router.put('/:slug/admin/courts/:id/suspend',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    courtController.suspendCourt
);

router.put('/:slug/admin/courts/:id/reactivate',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    courtController.reactivateCourt
);

// Obtener información del club
router.get('/:slug/admin/info',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    (req: any, res: any) => {
        res.json(req.club);
    }
);

// Actualizar información del club
router.put('/:slug/admin/info',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const club = await clubService.updateClub(Number(req.club.id), req.body);
            res.json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
);

router.get('/:slug/admin/activity-types',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const clubId = Number(req.clubId || req.club?.id);
            if (!Number.isFinite(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'No se pudo determinar el club activo' });
            }

            const activities = await activityTypeAdminService.listByClub(clubId);

            res.json(activities);
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Error al obtener actividades' });
        }
    }
);

router.put('/:slug/admin/activity-types/:id/schedule',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de actividad inválido' });
            }

            const bodySchema = z.object({
                scheduleMode: z.enum(['FIXED', 'RANGE']),
                scheduleOpenTime: z.string().nullable().optional(),
                scheduleCloseTime: z.string().nullable().optional(),
                scheduleIntervalMinutes: z.union([z.number(), z.string()]).nullable().optional().transform((v) => {
                    if (v === '' || v === undefined || v === null) return null;
                    return Number(v);
                }),
                scheduleDurations: z.array(z.union([z.number(), z.string()])).optional(),
                scheduleFixedSlots: z.array(z.object({
                    start: z.string(),
                    duration: z.union([z.number(), z.string()]).transform((v) => Number(v))
                })).optional()
            });

            const bodyParsed = bodySchema.safeParse(req.body);
            if (!bodyParsed.success) {
                return res.status(400).json({ error: bodyParsed.error.format() });
            }

            const clubId = Number(req.clubId || req.club?.id);
            if (!Number.isFinite(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'No se pudo determinar el club activo' });
            }

            const updated = await activityTypeAdminService.updateSchedule(clubId, idParsed.data, bodyParsed.data as any);

            res.json(updated);
        } catch (error: any) {
            const status = error?.message === 'Actividad no encontrada'
                ? 404
                : (error?.message === 'La actividad no pertenece a este club' ? 403 : 400);
            res.status(status).json({ error: error.message || 'No se pudo actualizar la configuración de actividad' });
        }
    }
);

// Crear reserva fija
router.post('/:slug/admin/bookings/fixed',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    bookingController.createFixed
);

// Cancelar reserva fija
router.delete('/:slug/admin/bookings/fixed/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    bookingController.cancelFixed
);

// Cancelar reserva
router.post('/:slug/admin/bookings/cancel',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    bookingController.cancelBooking
);

router.post('/:slug/admin/bookings/:id/confirm',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    bookingController.confirmBooking
);

router.post('/:slug/admin/bookings/:id/complete',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    bookingController.completeBooking
);

// 1. Obtener todos los productos del club
router.get('/:slug/admin/products',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    productController.getAll
);

// 2. Crear un nuevo producto
router.post('/:slug/admin/products',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    productController.create
);

// 3. Editar un producto existente (precio, stock, nombre)
router.put('/:slug/admin/products/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    productController.update
);

// 4. Eliminar un producto
router.delete('/:slug/admin/products/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    productController.delete
);

router.get('/:slug/admin/services',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubServiceCatalogController.list
);

router.post('/:slug/admin/services',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubServiceCatalogController.create
);

router.put('/:slug/admin/services/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubServiceCatalogController.update
);

router.delete('/:slug/admin/services/:id',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubServiceCatalogController.delete
);

router.get('/:slug/admin/clients-list',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubController.getClubClientsList 
);

router.post('/:slug/admin/clients',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubController.createClubClient
);

router.put('/:slug/admin/clients/:clientId',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubController.updateClubClient
);

router.delete('/:slug/admin/clients/:clientId',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    clubController.deleteClubClient
);

router.get('/:slug/admin/discount-policies',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.listPolicies
);

router.post('/:slug/admin/discount-policies',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.createPolicy
);

router.patch('/:slug/admin/discount-policies/:policyId',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.updatePolicy
);

router.get('/:slug/admin/clients/:clientId/discount-assignments',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.listClientAssignments
);

router.post('/:slug/admin/clients/:clientId/discount-assignments',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.assignToClient
);

router.patch('/:slug/admin/discount-assignments/:assignmentId',
    authMiddleware,
    verifyClubAccess,
    requireRole('ADMIN'),
    discountController.setAssignmentStatus
);

router.get('/:slug/admin/stats/dashboard', 
    authMiddleware,       
    verifyClubAccess,     
    requireRole('ADMIN'), 
    bookingController.getDashboardStats
);

export default router;
