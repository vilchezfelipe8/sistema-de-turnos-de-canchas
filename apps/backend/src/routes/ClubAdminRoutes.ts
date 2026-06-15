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
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';
import { ProductController } from '../controllers/ProductController';
import { ProductRepository } from '../repositories/ProductRepository';
import { CashRepository } from '../repositories/CashRepository';
import { z } from 'zod';
import { ActivityTypeAdminService } from '../services/ActivityTypeAdminService';
import { DiscountController } from '../controllers/DiscountController';
import { ClubServiceCatalogController } from '../controllers/ClubServiceCatalogController';
import { ClubReviewController } from '../controllers/ClubReviewController';
import { ClientDuplicateIncidentController } from '../controllers/ClientDuplicateIncidentController';
import { ClientDuplicateIncidentService } from '../services/ClientDuplicateIncidentService';
import { MembershipAdminController } from '../controllers/MembershipAdminController';
import { TeacherAdminController } from '../controllers/TeacherAdminController';
import { ClientRelationshipAdminController } from '../controllers/ClientRelationshipAdminController';
import { ClassSessionAdminController } from '../controllers/ClassSessionAdminController';
import { ClassEnrollmentAdminController } from '../controllers/ClassEnrollmentAdminController';
import { ClassPassAdminController } from '../controllers/ClassPassAdminController';
import { ClassCreditUsageAdminController } from '../controllers/ClassCreditUsageAdminController';
import { AcademyStudentAdminController } from '../controllers/AcademyStudentAdminController';

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
const clubReviewController = new ClubReviewController();
const clientDuplicateIncidentService = new ClientDuplicateIncidentService();
const clientDuplicateIncidentController = new ClientDuplicateIncidentController(clientDuplicateIncidentService);
const membershipAdminController = new MembershipAdminController();
const teacherAdminController = new TeacherAdminController();
const clientRelationshipAdminController = new ClientRelationshipAdminController();
const classSessionAdminController = new ClassSessionAdminController();
const classEnrollmentAdminController = new ClassEnrollmentAdminController();
const classPassAdminController = new ClassPassAdminController();
const classCreditUsageAdminController = new ClassCreditUsageAdminController();
const academyStudentAdminController = new AcademyStudentAdminController();

// Todas las rutas requieren autenticación y verificación de acceso al club.
// El rol tenant se define por endpoint (ADMIN/OWNER para configuración sensible,
// ADMIN/OWNER/STAFF para operación diaria).
// El middleware verifyClubAccess agrega req.clubId al request
// Las rutas se montan en /api/clubs/:slug/admin

// Obtener schedule del admin para un club específico
router.get('/:slug/admin/schedule', 
    authMiddleware, 
    verifyClubAccess, 
    requireTenantRole(['ADMIN', 'STAFF']), 
    bookingController.getAdminSchedule
);

// Obtener todas las canchas del club
router.get('/:slug/admin/courts',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    courtController.getAllCourts
);

// Crear cancha en el club
router.post('/:slug/admin/courts',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    courtController.createCourt
);

// Actualizar cancha (solo si pertenece al club)
router.put('/:slug/admin/courts/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    courtController.updateCourt
);

// Suspender/Reactivar cancha
router.put('/:slug/admin/courts/:id/suspend',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    courtController.suspendCourt
);

router.put('/:slug/admin/courts/:id/reactivate',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    courtController.reactivateCourt
);

// Obtener información del club
router.get('/:slug/admin/info',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    (req: any, res: any) => {
        res.json(req.club);
    }
);

// Actualizar información del club
router.put('/:slug/admin/info',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
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
    requireTenantRole(['ADMIN', 'STAFF']),
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
    requireTenantRole('ADMIN'),
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
                scheduleWindows: z.array(z.object({
                    start: z.string(),
                    end: z.string()
                })).nullable().optional(),
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

router.get('/:slug/admin/activity-types/:id/schedule-exceptions',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de actividad inválido' });
            }

            const querySchema = z.object({
                fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
            });
            const parsedQuery = querySchema.safeParse(req.query || {});
            if (!parsedQuery.success) {
                return res.status(400).json({ error: parsedQuery.error.format() });
            }

            const clubId = Number(req.clubId || req.club?.id);
            if (!Number.isFinite(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'No se pudo determinar el club activo' });
            }

            const rows = await activityTypeAdminService.listScheduleExceptions(
                clubId,
                idParsed.data,
                parsedQuery.data.fromDate,
                parsedQuery.data.toDate
            );

            return res.json(rows);
        } catch (error: any) {
            const status = error?.message === 'Actividad no encontrada'
                ? 404
                : (error?.message === 'La actividad no pertenece a este club' ? 403 : 400);
            return res.status(status).json({ error: error.message || 'No se pudieron listar excepciones de agenda' });
        }
    }
);

router.put('/:slug/admin/activity-types/:id/schedule-exceptions/:localDate',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de actividad inválido' });
            }

            const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
            const dateParsed = dateSchema.safeParse(req.params.localDate);
            if (!dateParsed.success) {
                return res.status(400).json({ error: 'localDate inválida. Formato esperado: YYYY-MM-DD' });
            }

            const bodySchema = z.object({
                isClosed: z.boolean().optional(),
                scheduleMode: z.enum(['FIXED', 'RANGE']).optional(),
                scheduleOpenTime: z.string().nullable().optional(),
                scheduleCloseTime: z.string().nullable().optional(),
                scheduleIntervalMinutes: z.union([z.number(), z.string()]).nullable().optional().transform((v) => {
                    if (v === '' || v === undefined || v === null) return null;
                    return Number(v);
                }),
                scheduleWindows: z.array(z.object({
                    start: z.string(),
                    end: z.string()
                })).nullable().optional(),
                scheduleDurations: z.array(z.union([z.number(), z.string()])).optional(),
                scheduleFixedSlots: z.array(z.object({
                    start: z.string(),
                    duration: z.union([z.number(), z.string()]).transform((v) => Number(v))
                })).optional()
            });
            const bodyParsed = bodySchema.safeParse(req.body || {});
            if (!bodyParsed.success) {
                return res.status(400).json({ error: bodyParsed.error.format() });
            }

            const clubId = Number(req.clubId || req.club?.id);
            if (!Number.isFinite(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'No se pudo determinar el club activo' });
            }

            const row = await activityTypeAdminService.upsertScheduleException(clubId, idParsed.data, {
                localDate: dateParsed.data,
                ...bodyParsed.data
            } as any);

            return res.json(row);
        } catch (error: any) {
            const status = error?.message === 'Actividad no encontrada'
                ? 404
                : (error?.message === 'La actividad no pertenece a este club' ? 403 : 400);
            return res.status(status).json({ error: error.message || 'No se pudo guardar la excepción de agenda' });
        }
    }
);

router.delete('/:slug/admin/activity-types/:id/schedule-exceptions/:localDate',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    async (req: any, res: any) => {
        try {
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de actividad inválido' });
            }

            const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
            const dateParsed = dateSchema.safeParse(req.params.localDate);
            if (!dateParsed.success) {
                return res.status(400).json({ error: 'localDate inválida. Formato esperado: YYYY-MM-DD' });
            }

            const clubId = Number(req.clubId || req.club?.id);
            if (!Number.isFinite(clubId) || clubId <= 0) {
                return res.status(400).json({ error: 'No se pudo determinar el club activo' });
            }

            const result = await activityTypeAdminService.deleteScheduleException(clubId, idParsed.data, dateParsed.data);
            return res.json(result);
        } catch (error: any) {
            const status = error?.message === 'Actividad no encontrada'
                ? 404
                : (error?.message === 'La actividad no pertenece a este club' ? 403 : 400);
            return res.status(status).json({ error: error.message || 'No se pudo eliminar la excepción de agenda' });
        }
    }
);

// Crear reserva fija
router.post('/:slug/admin/bookings/fixed',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.createFixed
);

// Cancelar reserva fija
router.delete('/:slug/admin/bookings/fixed/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.cancelFixed
);

router.patch('/:slug/admin/bookings/fixed/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.rescheduleFixed
);

// Cancelar reserva
router.post('/:slug/admin/bookings/cancel',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.cancelBooking
);

router.post('/:slug/admin/bookings/:id/confirm',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.confirmBooking
);

router.post('/:slug/admin/bookings/:id/complete',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.completeBooking
);

router.patch('/:slug/admin/bookings/:id/reschedule',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.rescheduleBooking
);

router.get('/:slug/admin/bookings/:id/billing-config',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.getBookingBillingConfig
);

router.put('/:slug/admin/bookings/:id/billing-config',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    bookingController.upsertBookingBillingConfig
);

// 1. Obtener todos los productos del club
router.get('/:slug/admin/products',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    productController.getAll
);

// 2. Crear un nuevo producto
router.post('/:slug/admin/products',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    productController.create
);

// 3. Editar un producto existente (precio, stock, nombre)
router.put('/:slug/admin/products/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    productController.update
);

// 4. Eliminar un producto
router.delete('/:slug/admin/products/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    productController.delete
);

router.get('/:slug/admin/services',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubServiceCatalogController.list
);

router.get('/:slug/admin/teachers',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    teacherAdminController.list
);

router.get('/:slug/admin/teachers/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    teacherAdminController.getById
);

router.post('/:slug/admin/teachers',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    teacherAdminController.create
);

router.put('/:slug/admin/teachers/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    teacherAdminController.update
);

router.patch('/:slug/admin/teachers/:id/status',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    teacherAdminController.setStatus
);

router.get('/:slug/admin/client-relationships',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clientRelationshipAdminController.list
);

router.post('/:slug/admin/client-relationships',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientRelationshipAdminController.create
);

router.put('/:slug/admin/client-relationships/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientRelationshipAdminController.update
);

router.delete('/:slug/admin/client-relationships/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientRelationshipAdminController.remove
);

router.get('/:slug/admin/class-sessions',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classSessionAdminController.list
);

router.get('/:slug/admin/class-sessions/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classSessionAdminController.getById
);

router.post('/:slug/admin/class-sessions',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classSessionAdminController.create
);

router.put('/:slug/admin/class-sessions/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classSessionAdminController.update
);

router.patch('/:slug/admin/class-sessions/:id/status',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classSessionAdminController.setStatus
);

router.get('/:slug/admin/class-sessions/:classSessionId/enrollments',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classEnrollmentAdminController.list
);

router.post('/:slug/admin/class-sessions/:classSessionId/enrollments',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classEnrollmentAdminController.create
);

router.put('/:slug/admin/class-sessions/:classSessionId/enrollments/:enrollmentId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classEnrollmentAdminController.update
);

router.patch('/:slug/admin/class-sessions/:classSessionId/enrollments/:enrollmentId/cancel',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classEnrollmentAdminController.cancel
);

router.patch('/:slug/admin/class-sessions/:classSessionId/enrollments/:enrollmentId/attendance',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classEnrollmentAdminController.setAttendanceStatus
);

router.get('/:slug/admin/class-enrollments/:enrollmentId/account',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classEnrollmentAdminController.getAccount
);

router.post('/:slug/admin/class-enrollments/:enrollmentId/account',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classEnrollmentAdminController.openAccount
);

router.get('/:slug/admin/class-passes',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classPassAdminController.list
);

router.get('/:slug/admin/class-passes/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classPassAdminController.getById
);

router.post('/:slug/admin/class-passes',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classPassAdminController.create
);

router.put('/:slug/admin/class-passes/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classPassAdminController.update
);

router.patch('/:slug/admin/class-passes/:id/status',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classPassAdminController.setStatus
);

router.get('/:slug/admin/class-passes/:passId/account',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classPassAdminController.getAccount
);

router.post('/:slug/admin/class-passes/:passId/account',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classPassAdminController.openAccount
);

router.get('/:slug/admin/class-passes/:passId/usages',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classCreditUsageAdminController.listByClassPass
);

router.post('/:slug/admin/class-passes/:passId/usages',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    classCreditUsageAdminController.create
);

router.get('/:slug/admin/class-enrollments/:enrollmentId/credit-usages',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    classCreditUsageAdminController.listByEnrollment
);

router.get('/:slug/admin/academy-students',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    academyStudentAdminController.list
);

router.get('/:slug/admin/academy-students/:clientId/overview',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    academyStudentAdminController.getOverview
);

router.post('/:slug/admin/services',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubServiceCatalogController.create
);

router.put('/:slug/admin/services/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubServiceCatalogController.update
);

router.delete('/:slug/admin/services/:id',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubServiceCatalogController.delete
);

router.patch('/:slug/admin/reviews/:reviewId/status',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubReviewController.setStatus
);

router.get('/:slug/admin/reviews',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubReviewController.listForAdmin
);

router.get('/:slug/admin/clients-list',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubController.getClubClientsList 
);

router.get('/:slug/admin/participants-search',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubController.searchClubParticipants
);

router.get('/:slug/admin/person-search',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubController.searchClubPeople
);

router.post('/:slug/admin/clients',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubController.createClubClient
);

router.put('/:slug/admin/clients/:clientId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole(['ADMIN', 'STAFF']),
    clubController.updateClubClient
);

router.delete('/:slug/admin/clients/:clientId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.deleteClubClient
);

router.post('/:slug/admin/clients/:clientId/link-user',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.linkClubClientUser
);

router.post('/:slug/admin/clients/:clientId/unlink-user',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.unlinkClubClientUser
);

router.get('/:slug/admin/clients/:clientId/identity-overview',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.getClubClientIdentityOverview
);

router.get('/:slug/admin/clients/:clientId/identity-audit',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.getClubClientIdentityAuditTimeline
);

router.post('/:slug/admin/clients/:clientId/identity-incident',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.createClubClientIdentityIncident
);

router.get('/:slug/admin/client-identity-incidents',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.listClubClientIdentityQueue
);

router.post('/:slug/admin/clients/:clientId/merge',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clubController.mergeClubClients
);

router.get('/:slug/admin/discount-policies',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.listPolicies
);

router.post('/:slug/admin/discount-policies',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.createPolicy
);

router.patch('/:slug/admin/discount-policies/:policyId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.updatePolicy
);

router.get('/:slug/admin/clients/:clientId/discount-assignments',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.listClientAssignments
);

router.post('/:slug/admin/clients/:clientId/discount-assignments',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.assignToClient
);

router.patch('/:slug/admin/discount-assignments/:assignmentId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.setAssignmentStatus
);

router.delete('/:slug/admin/discount-assignments/:assignmentId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    discountController.deleteAssignment
);

router.get('/:slug/admin/client-duplicate-incidents',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientDuplicateIncidentController.list
);

router.get('/:slug/admin/client-duplicate-incidents/:incidentId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientDuplicateIncidentController.getById
);

router.post('/:slug/admin/client-duplicate-incidents/:incidentId/resolve-link',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientDuplicateIncidentController.resolveLink
);

router.post('/:slug/admin/client-duplicate-incidents/:incidentId/dismiss',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    clientDuplicateIncidentController.dismiss
);

router.get('/:slug/admin/members',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    membershipAdminController.list
);

router.post('/:slug/admin/members/invite',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    membershipAdminController.invite
);

router.patch('/:slug/admin/members/:membershipId/role',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    membershipAdminController.updateRole
);

router.delete('/:slug/admin/members/:membershipId',
    authMiddleware,
    verifyClubAccess,
    requireTenantRole('ADMIN'),
    membershipAdminController.remove
);

router.get('/:slug/admin/stats/dashboard', 
    authMiddleware,       
    verifyClubAccess,     
    requireTenantRole(['ADMIN', 'STAFF']), 
    bookingController.getDashboardStats
);

export default router;
