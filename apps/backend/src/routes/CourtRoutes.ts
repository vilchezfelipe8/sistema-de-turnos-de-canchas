import { Router } from 'express';
import { CourtController } from '../controllers/CourtController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser, optionalSetAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const courtController = new CourtController();

// GET: sin auth devuelve todas las canchas (p. ej. grilla pública); con auth de admin solo las de su club
router.get('/', optionalAuthMiddleware, optionalSetAdminClubFromUser, courtController.getAllCourts);

router.post('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, courtController.createCourt);
router.put('/:id', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, courtController.updateCourt);
router.put('/:id/suspend', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, courtController.suspendCourt);
router.put('/:id/reactivate', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, courtController.reactivateCourt);

export default router;

