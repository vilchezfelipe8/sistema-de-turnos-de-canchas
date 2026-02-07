import { Router } from 'express';
import { CashController } from '../controllers/CashController';
import { CashService } from '../services/CashService';
import { CashRepository } from '../repositories/CashRepository';

// Middlewares
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();

// Inyección de dependencias manual (igual que en tu BookingRoutes)
const cashRepository = new CashRepository();
const cashService = new CashService(cashRepository);
const cashController = new CashController(cashService);

// --- RUTAS ---

// GET: Ver balance y movimientos
// Solo ADMIN puede ver cuánto se ganó en total
router.get(
    '/', 
    authMiddleware, 
    requireRole('ADMIN'), 
    setAdminClubFromUser, 
    cashController.getSummary
);

// POST: Registrar un movimiento (Cobrar/Gastar)
// ADMIN puede cobrar. Si tienes rol 'STAFF', agrégalo aquí también.
router.post(
    '/', 
    authMiddleware, 
    requireRole('ADMIN'), // O requireRole(['ADMIN', 'STAFF']) si soportas array
    setAdminClubFromUser, 
    cashController.createMovement
);

export default router;