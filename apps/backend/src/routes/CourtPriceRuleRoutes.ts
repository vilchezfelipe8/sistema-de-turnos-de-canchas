import { Router } from 'express';
import { CourtPriceRuleController } from '../controllers/CourtPriceRuleController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const controller = new CourtPriceRuleController();

router.get('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, controller.list);
router.post('/', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, controller.create);
router.put('/:id', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, controller.update);
router.delete('/:id', authMiddleware, requireRole('ADMIN'), setAdminClubFromUser, controller.remove);

export default router;
