import { Router } from 'express';
import { CourtPriceRuleController } from '../controllers/CourtPriceRuleController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const controller = new CourtPriceRuleController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), controller.list);
router.post('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), controller.create);
router.put('/:id', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), controller.update);
router.delete('/:id', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), controller.remove);

export default router;
