import { Request, Response } from 'express';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma';

export class CourtController {
    private courtRepo: CourtRepository;

    constructor() {
        this.courtRepo = new CourtRepository();
    }

    createCourt = async (req: Request, res: Response) => {
        try {
            const { name, isIndoor, surface, activityTypeId } = req.body;
            const clubId = (req as any).clubId; // Solo del middleware (admin de un club), nunca del body
            
            if (!name) {
                return res.status(400).json({ error: "Falta el nombre de la cancha" });
            }
            
            if (!clubId) {
                return res.status(400).json({ error: "No se pudo determinar el club" });
            }

            const data: any = {
                name,
                clubId,
                isIndoor: isIndoor || false,
                surface: surface || 'Sintético'
            };
            if (activityTypeId) data.activityTypeId = Number(activityTypeId);

            const newCourt = await prisma.court.create({
                data,
                include: { club: true, activities: true, activityType: true } as any
            });

            res.status(201).json(newCourt);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    updateCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { isUnderMaintenance, name, activityTypeId } = req.body;
            const clubId = (req as any).clubId;

            // Si hay clubId en el request, verificar que la cancha pertenece al club
            if (clubId) {
                const court = await prisma.court.findUnique({
                    where: { id: Number(id) }
                });
                if (!court) {
                    return res.status(404).json({ error: "Cancha no encontrada" });
                }
                if (court.clubId !== clubId) {
                    return res.status(403).json({ error: "No tienes acceso a esta cancha" });
                }
            }

            const data: any = {
                isUnderMaintenance: isUnderMaintenance,
                name: name
            };
            if (activityTypeId) data.activityTypeId = Number(activityTypeId);

            const updatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data,
                include: { club: true, activities: true, activityType: true } as any
            });

            res.json(updatedCourt);
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo actualizar la cancha. Verifica el ID." });
        }
    }

    getAllCourts = async (req: Request, res: Response) => {
        let clubId = (req as any).clubId;
        const clubSlug = req.query.clubSlug;

        if (!clubId && typeof clubSlug === 'string' && clubSlug.trim()) {
            const club = await prisma.club.findUnique({ where: { slug: clubSlug.trim() } });
            if (club) clubId = club.id;
        }

        const courts = await this.courtRepo.findAll(clubId);
        res.json(courts);
    }

    suspendCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const clubId = (req as any).clubId;

            // Si hay clubId, verificar que la cancha pertenece al club
            if (clubId) {
                const court = await prisma.court.findUnique({
                    where: { id: Number(id) }
                });
                if (!court) {
                    return res.status(404).json({ error: "Cancha no encontrada" });
                }
                if (court.clubId !== clubId) {
                    return res.status(403).json({ error: "No tienes acceso a esta cancha" });
                }
            }

            const suspendedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: true
                },
                include: { club: true, activities: true, activityType: true } as any
            });

            res.json({ message: "Cancha suspendida exitosamente", court: suspendedCourt });
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo suspender la cancha. Verifica el ID." });
        }
    }

    reactivateCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const clubId = (req as any).clubId;

            // Si hay clubId, verificar que la cancha pertenece al club
            if (clubId) {
                const court = await prisma.court.findUnique({
                    where: { id: Number(id) }
                });
                if (!court) {
                    return res.status(404).json({ error: "Cancha no encontrada" });
                }
                if (court.clubId !== clubId) {
                    return res.status(403).json({ error: "No tienes acceso a esta cancha" });
                }
            }

            const reactivatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: false
                },
                include: { club: true, activities: true }
            });

            res.json({ message: "Cancha reactivada exitosamente", court: reactivatedCourt });
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo reactivar la cancha. Verifica el ID." });
        }
    }
}

