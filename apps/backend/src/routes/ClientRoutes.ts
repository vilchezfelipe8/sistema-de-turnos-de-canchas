import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';
import { ClientDebtService } from '../services/ClientDebtService';
import { sendAppError, validationError } from '../errors';

const router = Router();
const clientDebtService = new ClientDebtService();

// GET /api/clients/:slug — solo el admin de ese club puede ver la lista
router.get('/:slug', authMiddleware, verifyClubAccess, requireTenantRole(['ADMIN', 'STAFF']), async (req, res) => {
  try {
    const club = (req as any).club;
    const rawScope = String(req.query.scope || 'all').trim().toLowerCase();
    if (rawScope !== 'all' && rawScope !== 'debt_open') {
      return sendAppError(
        res,
        validationError('Revisá los campos marcados.', {
          scope: 'scope inválido. Valores permitidos: all | debt_open.'
        })
      );
    }

    const clientsArray = await clientDebtService.listByClub(club.id, {
      scope: rawScope as 'all' | 'debt_open'
    });
    res.json(clientsArray);

  } catch (error) {
    return sendAppError(res, error, 'No se pudo cargar la lista de clientes');
  }
});

export default router;
