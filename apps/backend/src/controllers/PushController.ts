import { Request, Response } from 'express';
import { z } from 'zod';
import { getVapidPublicKey, isPushConfigured, pushNotificationService } from '../services/PushNotificationService';
import { sendAuthError } from '../utils/authError';
import { AppError, ErrorCodes, flattenZodFieldErrors, sendAppError } from '../errors';

const sendValidationError = (res: Response, error: z.ZodError, message: string) => sendAppError(res, new AppError({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: flattenZodFieldErrors(error),
    meta: { issues: error.flatten() }
}));

const subscriptionSchema = z.object({
    endpoint: z.string().trim().url().max(2000),
    keys: z.object({
        p256dh: z.string().trim().min(10).max(500),
        auth: z.string().trim().min(5).max(500)
    })
});

const removeSchema = z.object({ endpoint: z.string().trim().url().max(2000) });

const preferencesSchema = z.object({
    invitations: z.boolean().optional(),
    invitationResponses: z.boolean().optional(),
    bookingReminders: z.boolean().optional()
});

const requesterId = (req: Request) => {
    const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
};

export class PushController {
    config = async (_req: Request, res: Response) => {
        const enabled = isPushConfigured();
        return res.json({ enabled, publicKey: enabled ? getVapidPublicKey() : null });
    };

    saveSubscription = async (req: Request, res: Response) => {
        try {
            const userId = requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para activar los avisos.');
            const parsed = subscriptionSchema.safeParse(req.body || {});
            if (!parsed.success) return sendValidationError(res, parsed.error, 'No pudimos activar los avisos en este dispositivo.');
            await pushNotificationService.saveSubscription(userId, {
                endpoint: parsed.data.endpoint,
                p256dh: parsed.data.keys.p256dh,
                auth: parsed.data.keys.auth,
                userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null
            });
            return res.status(201).json({ ok: true });
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos activar los avisos.');
        }
    };

    removeSubscription = async (req: Request, res: Response) => {
        try {
            const userId = requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión.');
            const parsed = removeSchema.safeParse(req.body || {});
            if (!parsed.success) return sendValidationError(res, parsed.error, 'Dispositivo inválido.');
            await pushNotificationService.deleteSubscription(userId, parsed.data.endpoint);
            return res.json({ ok: true });
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos desactivar los avisos.');
        }
    };

    getPreferences = async (req: Request, res: Response) => {
        try {
            const userId = requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión.');
            return res.json(await pushNotificationService.getPreferences(userId));
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos cargar tus avisos.');
        }
    };

    updatePreferences = async (req: Request, res: Response) => {
        try {
            const userId = requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión.');
            const parsed = preferencesSchema.safeParse(req.body || {});
            if (!parsed.success) return sendValidationError(res, parsed.error, 'Revisá los avisos elegidos.');
            return res.json(await pushNotificationService.updatePreferences(userId, parsed.data));
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos guardar tus avisos.');
        }
    };
}
