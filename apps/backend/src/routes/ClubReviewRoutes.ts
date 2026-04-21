import { Router } from 'express';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { ClubReviewController } from '../controllers/ClubReviewController';

const router = Router();
const controller = new ClubReviewController();

router.get('/:slug/reviews/summary', controller.getSummary);
router.get('/:slug/reviews', controller.listPublished);
router.get('/:slug/reviews/mine', authMiddleware, controller.getMineForBooking);
router.post('/:slug/reviews', authMiddleware, controller.createOrUpdateMine);

export default router;
