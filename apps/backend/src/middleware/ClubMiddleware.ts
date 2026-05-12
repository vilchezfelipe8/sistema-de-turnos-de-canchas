import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { sendAuthError } from '../utils/authError';

const handleClubContextError = (error: unknown, res: Response, fallbackMessage: string) => {
    const message = error instanceof Error ? error.message : fallbackMessage;
    if (message.includes('x-active-club-id')) {
        return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', message);
    }
    if (message.includes('Debe seleccionar un club activo')) {
        return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', message);
    }
    return sendAuthError(res, 403, 'AUTH_FORBIDDEN', fallbackMessage);
};

/**
 * Middleware para verificar que el usuario autenticado pertenece al club especificado en el slug
 * Debe usarse después de authMiddleware
 */
export const verifyClubAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        const slug = req.params.slug;

        if (!slug) {
            return res.status(400).json({ error: 'Slug de club requerido' });
        }

        // Obtener el club por slug
        const club = await prisma.club.findUnique({
            where: { slug: slug as string }
        });

        if (!club) {
            return res.status(404).json({ error: 'Club no encontrado' });
        }

        let context;
        try {
            context = await getUserClubContext(Number(user.userId), club.id);
        } catch (error) {
            return handleClubContextError(error, res, 'No tienes acceso a este club');
        }

        if (!context || context.clubId !== club.id) {
            return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a este club');
        }

        (req as any).club = club;
        (req as any).clubId = club.id;
        (req as any).membershipRole = context.role;
        (req as any).setLogContext?.({ clubId: club.id });

        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Middleware para verificar que el usuario puede acceder a un club por ID
 */
export const verifyClubAccessById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        const clubId = req.params.id != null ? parseInt(req.params.id as string) : NaN;
        const parsed = !isNaN(clubId) ? clubId : (req.body?.clubId != null ? parseInt(String(req.body.clubId)) : NaN);

        if (!parsed || isNaN(parsed)) {
            return res.status(400).json({ error: 'ID de club inválido' });
        }

        let context;
        try {
            context = await getUserClubContext(Number(user.userId), parsed);
        } catch (error) {
            return handleClubContextError(error, res, 'No tienes acceso a este club');
        }

        if (!context || context.clubId !== parsed) {
            return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a este club');
        }

        (req as any).clubId = parsed;
        (req as any).membershipRole = context.role;
        (req as any).setLogContext?.({ clubId: parsed });
        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Middleware para rutas admin que no llevan slug en la URL.
 * Establece req.clubId con el club del usuario autenticado.
 * Debe usarse después de authMiddleware.
 * Luego la ruta debe validar membresía/rol tenant con requireTenantRole/requireClubMembership.
 */
export const setAdminClubFromUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        if (!user?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }
        let context;
        try {
            const preferredClubId = getPreferredClubIdFromRequest(req);
            context = await getUserClubContext(Number(user.userId), preferredClubId);
        } catch (error) {
            return handleClubContextError(error, res, 'No tienes un club asignado');
        }

        (req as any).clubId = context.clubId;
        (req as any).membershipRole = context.role;
        (req as any).setLogContext?.({ clubId: context.clubId });
        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Versión opcional: solo setea req.clubId si el usuario está autenticado y es ADMIN con club.
 * Para GET /api/courts: sin auth devuelve todas las canchas; con auth de admin devuelve solo las de su club.
 */
export const optionalSetAdminClubFromUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        if (!user?.userId) return next();
        try {
            const preferredClubId = getPreferredClubIdFromRequest(req);
            const context = await getUserClubContext(Number(user.userId), preferredClubId);
            if (context?.clubId != null) {
                (req as any).clubId = context.clubId;
                (req as any).membershipRole = context.role;
                (req as any).setLogContext?.({ clubId: context.clubId });
            }
        } catch {
        }
        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
