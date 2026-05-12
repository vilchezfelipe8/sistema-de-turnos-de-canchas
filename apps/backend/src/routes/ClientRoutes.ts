import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { verifyClubAccess } from '../middleware/ClubMiddleware';
import { ClientDebtService } from '../services/ClientDebtService';

const router = Router();
const clientDebtService = new ClientDebtService();
const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && String(error.message || '').trim().length > 0
    ? error.message
    : fallback;
const isIntegrityInconsistencyError = (error: unknown) =>
  getErrorMessage(error, '').includes('Inconsistencia de integridad');

// GET /api/clients/:slug — solo el admin de ese club puede ver la lista
router.get('/:slug', authMiddleware, verifyClubAccess, requireTenantRole(['ADMIN', 'STAFF']), async (req, res) => {
  try {
    const club = (req as any).club;
    const rawScope = String(req.query.scope || 'all').trim().toLowerCase();
    if (rawScope !== 'all' && rawScope !== 'debt_open') {
      return res.status(400).json({ error: 'scope inválido. Valores permitidos: all | debt_open' });
    }

    const clientsArray = await clientDebtService.listByClub(club.id, {
      scope: rawScope as 'all' | 'debt_open'
    });
    res.json(clientsArray);

  } catch (error) {
    console.error('Error getting clients:', error);
    if (isIntegrityInconsistencyError(error)) {
      return res.status(409).json({ error: getErrorMessage(error, 'Inconsistencia de integridad en clientes/deuda') });
    }
    res.status(500).json({ error: getErrorMessage(error, 'Error interno del servidor') });
  }
});

export default router;
