import { Router } from 'express';
import { CourtController } from '../controllers/CourtController';
import { authMiddleware } from '../middleware/AuthMiddleware';


const router = Router();
const courtController = new CourtController();
import { requireRole } from '../middleware/RoleMiddleware';

router.get('/', courtController.getAllCourts);


router.post('/',authMiddleware ,requireRole('ADMIN'), courtController.createCourt);
router.put('/:id',authMiddleware, requireRole('ADMIN'), courtController.updateCourt);
router.put('/:id/suspend', authMiddleware, requireRole('ADMIN'), courtController.suspendCourt);
router.put('/:id/reactivate', authMiddleware, requireRole('ADMIN'), courtController.reactivateCourt);

export default router;

