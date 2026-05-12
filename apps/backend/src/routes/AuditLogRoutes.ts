import { Router } from 'express';
import { AuditLogController } from '../controllers/AuditLogController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();
const auditLogController = new AuditLogController();

router.get('/', authMiddleware, setAdminClubFromUser, requireTenantRole('ADMIN'), auditLogController.list);

export default router;
