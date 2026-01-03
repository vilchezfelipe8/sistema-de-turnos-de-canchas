import { Router } from 'express';
import { CourtController } from '../controllers/CourtController';


const router = Router();
const courtController = new CourtController();
import { requireRole } from '../middleware/RoleMiddleware';

router.get('/', courtController.getAllCourts);
router.post('/', requireRole('ADMIN'), courtController.createCourt);
router.put('/:id', requireRole('ADMIN'), courtController.updateCourt);

export default router;