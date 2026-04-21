import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { loginLimiter, magicLinkRequestLimiter, registerLimiter, sessionRefreshLimiter } from '../middleware/rateLimit';

const router = Router();
const authController = new AuthController();

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/email/request-link', magicLinkRequestLimiter, authController.requestEmailMagicLink);
router.get('/email/verify', authController.verifyEmailMagicLink);
router.get('/me', authMiddleware, authController.getMe);
router.patch('/me', authMiddleware, authController.updateMe);
router.get('/session/me', authMiddleware, authController.sessionMe);
router.post('/session/refresh', sessionRefreshLimiter, authController.sessionRefresh);
router.post('/session/logout', authController.sessionLogout);
router.post('/session/logout-all', authMiddleware, authController.sessionLogoutAll);

export default router;
