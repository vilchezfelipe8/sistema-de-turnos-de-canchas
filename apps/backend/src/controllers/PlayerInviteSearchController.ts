import { Request, Response } from 'express';
import { z } from 'zod';
import { PlayerInviteSearchService } from '../services/PlayerInviteSearchService';
import { sendAuthError } from '../utils/authError';
import { AppError, ErrorCodes, flattenZodFieldErrors, sendAppError } from '../errors';

const sendZodControllerError = (res: Response, error: z.ZodError, message: string) => sendAppError(res, new AppError({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: flattenZodFieldErrors(error),
    meta: { issues: error.flatten() }
}));

const searchSchema = z.object({
    q: z.string().trim().min(1).max(80),
    clubSlug: z.string().trim().min(1).max(120).optional(),
    bookingId: z.coerce.number().int().positive().optional()
}).refine((value) => Boolean(value.clubSlug || value.bookingId), {
    path: ['clubSlug'],
    message: 'Indicá el club de la reserva.'
});

export class PlayerInviteSearchController {
    constructor(private readonly service = new PlayerInviteSearchService()) {}

    private requesterId(req: Request) {
        const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
        return Number.isInteger(userId) && userId > 0 ? userId : null;
    }

    search = async (req: Request, res: Response) => {
        try {
            const userId = this.requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para invitar jugadores.');
            const parsed = searchSchema.safeParse(req.query || {});
            if (!parsed.success) return sendZodControllerError(res, parsed.error, 'Revisá la búsqueda.');
            const items = await this.service.searchByName({
                requesterUserId: userId,
                query: parsed.data.q,
                clubSlug: parsed.data.clubSlug || null,
                bookingId: parsed.data.bookingId || null
            });
            return res.json({ items });
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos buscar jugadores.');
        }
    };

    frequent = async (req: Request, res: Response) => {
        try {
            const userId = this.requesterId(req);
            if (!userId) return sendAuthError(res, 401, ErrorCodes.AUTH_MISSING, 'Necesitás iniciar sesión para invitar jugadores.');
            const items = await this.service.frequentPlayers({ requesterUserId: userId });
            return res.json({ items });
        } catch (error: unknown) {
            return sendAppError(res, error, 'No pudimos cargar tus compañeros frecuentes.');
        }
    };
}
