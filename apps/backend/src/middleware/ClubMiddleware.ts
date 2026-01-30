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
        const clubId = parseInt(req.params.id as string) || parseInt(req.body.clubId as string);

        if (!clubId || isNaN(clubId)) {
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
        if (fullUser.clubId !== clubId) {
            return res.status(403).json({ error: 'No tienes acceso a este club' });
        }

        // Agregar el clubId al request
        (req as any).clubId = clubId;

        next();
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
