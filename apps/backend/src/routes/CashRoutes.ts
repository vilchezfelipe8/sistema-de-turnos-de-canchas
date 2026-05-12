import { Router } from 'express';
import { CashController } from '../controllers/CashController';
import { CashService } from '../services/CashService';
import { CashRepository } from '../repositories/CashRepository';

// Middlewares
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireTenantRole } from '../middleware/RoleMiddleware';
import { setAdminClubFromUser } from '../middleware/ClubMiddleware';

const router = Router();

// Inyección de dependencias manual (igual que en tu BookingRoutes)
const cashRepository = new CashRepository();
const cashService = new CashService(cashRepository);
const cashController = new CashController(cashService);

// --- RUTAS ---

router.get(
    '/summary',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.getSummary
);

// POST: Registrar un movimiento (Cobrar/Gastar)
// ADMIN puede cobrar. Si tienes rol 'STAFF', agrégalo aquí también.
router.post(
    '/', 
    authMiddleware, 
    setAdminClubFromUser, 
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.createMovement
);

// GET: Productos del club (para ventas directas)
router.get(
    '/products',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.getProducts
);

// GET: Ítems POS unificados — productos + servicios (P2-C)
router.get(
    '/pos-items',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.getPosItems
);

// POST: Venta directa de producto (sin reserva)
router.post(
    '/product-sale',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.createProductSale
);

// POST: Venta mostrador — crea cuenta + items + stock, sin cobrar (Fase 1.6B)
router.post(
    '/product-sale/account',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.createProductSaleAccount
);

router.post(
    '/product-sale/quote',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.quoteProductSale
);

// GET: Reporte POS (P2-D)
router.get(
    '/pos-report',
    authMiddleware,
    setAdminClubFromUser,
    requireTenantRole(['ADMIN', 'STAFF']),
    cashController.getPosReport
);

export default router;
