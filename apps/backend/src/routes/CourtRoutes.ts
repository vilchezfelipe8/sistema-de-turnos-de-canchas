import { Router } from 'express';
import { CourtController } from '../controllers/CourtController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser, optionalSetAdminClubFromUser } from '../middleware/ClubMiddleware';
import { sendAuthError } from '../utils/authError';

const router = Router();
const courtController = new CourtController();

// GET: sin auth devuelve todas las canchas (p. ej. grilla pública); con auth de admin solo las de su club
router.get('/', optionalAuthMiddleware, optionalSetAdminClubFromUser, courtController.getAllCourts);

// Alta de canchas deshabilitada: solo se gestiona desde base de datos.
router.post('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), (_req, res) => {
	return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'Alta de canchas deshabilitada. Contacte soporte.');
});
router.put('/:id', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), courtController.updateCourt);
router.put('/:id/suspend', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), courtController.suspendCourt);
router.put('/:id/reactivate', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), courtController.reactivateCourt);
router.delete('/:id', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), courtController.deleteCourt);

export default router;
