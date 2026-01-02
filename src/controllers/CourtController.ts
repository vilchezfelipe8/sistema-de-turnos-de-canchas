import { Request, Response } from 'express';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma'; // Importamos prisma directo para updates rápidos

export class CourtController {
    private courtRepo: CourtRepository;

    constructor() {
        this.courtRepo = new CourtRepository();
    }

    // POST: Crear una nueva cancha
    createCourt = async (req: Request, res: Response) => {
        try {
            const { name, clubId, isIndoor, surface } = req.body;

            // Validación básica
            if (!name || !clubId) {
                return res.status(400).json({ error: "Faltan datos obligatorios (name, clubId)" });
            }

            const newCourt = await prisma.court.create({
                data: {
                    name,
                    clubId,
                    isIndoor: isIndoor || false,    // Por defecto false si no lo mandan
                    surface: surface || 'Sintetico' // Por defecto Sintetico
                }
            });

            res.status(201).json(newCourt);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // PUT: Poner en mantenimiento (o editar datos)
    updateCourt = async (req: Request, res: Response) => {
        try {
            const { id } = req.params; // Viene por URL: /api/courts/1
            const { isUnderMaintenance, name } = req.body;

            const updatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: isUnderMaintenance, // true o false
                    name: name // Opcional, por si quiere cambiar el nombre
                }
            });

            res.json(updatedCourt);
        } catch (error: any) {
            res.status(400).json({ error: "No se pudo actualizar la cancha. Verifica el ID." });
        }
    }
    
    // GET: Listar todas (ya lo tenías en mente, lo agregamos para completar)
    getAllCourts = async (req: Request, res: Response) => {
        const courts = await this.courtRepo.findAll();
        res.json(courts);
    }
}