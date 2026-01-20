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
            const { name, clubId, isIndoor, surface } = req.body;
            if (!name || !clubId) {
                return res.status(400).json({ error: "Faltan datos obligatorios (name, clubId)" });
            }

            const newCourt = await prisma.court.create({
                data: {
                    name,
                    clubId,
                    isIndoor: isIndoor || false,
                    surface: surface || 'Sintético'
                }
            });

            res.status(201).json(newCourt);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    updateCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { isUnderMaintenance, name } = req.body;

            const updatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: isUnderMaintenance,
                    name: name
                }
            });

            res.json(updatedCourt);
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo actualizar la cancha. Verifica el ID." });
        }
    }

    getAllCourts = async (req: Request, res: Response) => {
        const courts = await this.courtRepo.findAll();
        res.json(courts);
    }

    suspendCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const suspendedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: true
                }
            });

            res.json({ message: "Cancha suspendida exitosamente", court: suspendedCourt });
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo suspender la cancha. Verifica el ID." });
        }
    }

    reactivateCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const reactivatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: false
                }
            });

            res.json({ message: "Cancha reactivada exitosamente", court: reactivatedCourt });
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo reactivar la cancha. Verifica el ID." });
        }
    }
}

