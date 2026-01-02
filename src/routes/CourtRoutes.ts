import { Router } from 'express';
import { CourtController } from '../controllers/CourtController';


const router = Router();
const courtController = new CourtController();

// Listar todas
router.get('/', courtController.getAllCourts);

// Crear cancha (Solo Admin debería poder, pero por ahora lo dejamos libre)
router.post('/', courtController.createCourt);

// Actualizar (Ej: Poner en mantenimiento)
router.put('/:id', courtController.updateCourt);

export default router;