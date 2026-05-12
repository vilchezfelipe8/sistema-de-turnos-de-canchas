import { Router } from 'express';
import { ClubController } from '../controllers/ClubController';
import { ClubFavoriteController } from '../controllers/ClubFavoriteController';
import { ClubService } from '../services/ClubService';
import { ClubFavoriteService } from '../services/ClubFavoriteService';
import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { requireGlobalRole, requireTenantRole } from '../middleware/RoleMiddleware';
import { verifyClubAccessById } from '../middleware/ClubMiddleware';

const router = Router();

const clubRepository = new ClubRepository();
const activityRepository = new ActivityTypeRepository();
const clubService = new ClubService(clubRepository, activityRepository);
const clubController = new ClubController(clubService);
const clubFavoriteService = new ClubFavoriteService();
const clubFavoriteController = new ClubFavoriteController(clubFavoriteService);

// Rutas públicas
router.get('/', clubController.getAllClubs);
router.get('/slug/:slug', clubController.getClubBySlug);
router.get('/favorites/me', authMiddleware, clubFavoriteController.listMyFavorites);
router.get('/:id', clubController.getClubById);
router.post('/:id/favorite', authMiddleware, clubFavoriteController.markFavorite);
router.delete('/:id/favorite', authMiddleware, clubFavoriteController.unmarkFavorite);

// Rutas protegidas: solo el admin del club puede actualizar ese club
router.post('/', authMiddleware, requireGlobalRole('ADMIN'), clubController.createClub);
router.put('/:id', authMiddleware, verifyClubAccessById, requireTenantRole('ADMIN'), clubController.updateClub);
router.patch('/:id', authMiddleware, verifyClubAccessById, requireTenantRole('ADMIN'), clubController.updateClub);

export default router;
