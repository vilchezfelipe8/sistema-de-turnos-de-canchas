import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';

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

        // Obtener el usuario completo de la base de datos
        const fullUser = await prisma.user.findUnique({
            where: { id: user.userId }
        });

        if (!fullUser) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        // Verificar que el usuario pertenece al club
        if (fullUser.clubId !== club.id) {
            return res.status(403).json({ error: 'No tienes acceso a este club' });
        }

        // Agregar el club al request para uso posterior
        (req as any).club = club;
        (req as any).clubId = club.id;

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

        // Obtener el usuario completo de la base de datos
        const fullUser = await prisma.user.findUnique({
            where: { id: user.userId }
        });

        if (!fullUser) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        // Verificar que el usuario pertenece al club
        if (fullUser.clubId !== parsed) {
            return res.status(403).json({ error: 'No tienes acceso a este club' });
        }

        (req as any).clubId = parsed;
        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Middleware para rutas admin que no llevan slug en la URL.
 * Establece req.clubId con el club del usuario autenticado.
 * Debe usarse después de authMiddleware y requireRole('ADMIN').
 * Si el admin no tiene clubId, responde 403.
 */
export const setAdminClubFromUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        if (!user?.userId) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        const fullUser = await prisma.user.findUnique({
            where: { id: user.userId },
            select: { clubId: true }
        });
        if (!fullUser) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }
        if (fullUser.clubId == null) {
            return res.status(403).json({ error: 'No tienes un club asignado' });
        }
        (req as any).clubId = fullUser.clubId;
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
        if (!user?.userId || user.role !== 'ADMIN') return next();
        const fullUser = await prisma.user.findUnique({
            where: { id: user.userId },
            select: { clubId: true }
        });
        if (fullUser?.clubId != null) (req as any).clubId = fullUser.clubId;
        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
