import { Router } from 'express';
import { CourtPriceRuleController } from '../controllers/CourtPriceRuleController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const controller = new CourtPriceRuleController();

router.get('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.create);
router.put('/:id', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.update);
router.delete('/:id', authMiddleware, setAdminClubFromUser, requireRole('ADMIN'), controller.remove);

export default router;
