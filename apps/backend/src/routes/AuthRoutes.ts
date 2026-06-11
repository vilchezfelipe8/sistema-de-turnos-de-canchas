import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/AuthMiddleware';
import { loginLimiter, magicLinkRequestLimiter, registerLimiter, sessionRefreshLimiter } from '../middleware/rateLimit';

const router = Router();
const authController = new AuthController();

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/email/request-link', magicLinkRequestLimiter, authController.requestEmailMagicLink);
router.get('/email/verify', authController.verifyEmailMagicLink);
router.get('/oauth/google/start', authController.startGoogleOAuth);
router.get('/oauth/google/callback', optionalAuthMiddleware, authController.googleOAuthCallback);
router.get('/oauth/apple/start', authController.startAppleOAuth);
router.get('/oauth/apple/callback', optionalAuthMiddleware, authController.appleOAuthCallback);
router.post('/oauth/apple/callback', optionalAuthMiddleware, authController.appleOAuthCallback);
router.get('/oauth/facebook/start', authController.startFacebookOAuth);
router.get('/oauth/facebook/callback', optionalAuthMiddleware, authController.facebookOAuthCallback);
router.get('/csrf', authController.csrfToken);
router.get('/me', authMiddleware, authController.getMe);
router.patch('/me', authMiddleware, authController.updateMe);
router.get('/account/security', authMiddleware, authController.accountSecurityOverview);
router.post('/account/club-profiles/:clubId/claim', authMiddleware, authController.claimClubProfile);
router.post('/oauth/google/disconnect', authMiddleware, authController.disconnectGoogleOAuth);
router.post('/oauth/apple/disconnect', authMiddleware, authController.disconnectAppleOAuth);
router.post('/oauth/facebook/disconnect', authMiddleware, authController.disconnectFacebookOAuth);
router.get('/session/me', authMiddleware, authController.sessionMe);
router.post('/session/refresh', sessionRefreshLimiter, authController.sessionRefresh);
router.post('/session/logout', authController.sessionLogout);
router.post('/session/logout-all', authMiddleware, authController.sessionLogoutAll);

export default router;
