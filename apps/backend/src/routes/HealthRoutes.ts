// apps/backend/src/routes/health.routes.ts
import { Router } from 'express';
import { getSystemHealth } from '../controllers/HealthController';

const router = Router();

// Definimos la ruta raíz de este módulo (que será /health)
router.get('/', getSystemHealth);

export default router;