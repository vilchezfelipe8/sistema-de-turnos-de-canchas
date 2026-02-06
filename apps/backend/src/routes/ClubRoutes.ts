import { Router } from 'express';
import { ClubController } from '../controllers/ClubController';
import { ClubService } from '../services/ClubService';
import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireRole } from '../middleware/RoleMiddleware';
import { verifyClubAccessById } from '../middleware/ClubMiddleware';

const router = Router();

const clubRepository = new ClubRepository();
const activityRepository = new ActivityTypeRepository();
const clubService = new ClubService(clubRepository, activityRepository);
const clubController = new ClubController(clubService);

// Rutas públicas
router.get('/', clubController.getAllClubs);
router.get('/slug/:slug', clubController.getClubBySlug);
router.get('/:id', clubController.getClubById);

// Rutas protegidas: solo el admin del club puede actualizar ese club
router.post('/', authMiddleware, requireRole('ADMIN'), clubController.createClub);
router.put('/:id', authMiddleware, requireRole('ADMIN'), verifyClubAccessById, clubController.updateClub);
router.patch('/:id', authMiddleware, requireRole('ADMIN'), verifyClubAccessById, clubController.updateClub);

export default router;
