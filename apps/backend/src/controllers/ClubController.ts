import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';

export class ClubController {
    constructor(private clubService: ClubService) {}

    createClub = async (req: Request, res: Response) => {
        try {
            const { slug, name, address, contact, phone, logoUrl, instagramUrl, facebookUrl, websiteUrl, description } = req.body;
            if (!slug) {
                return res.status(400).json({ error: 'El slug es requerido' });
            }
            const club = await this.clubService.createClub(
                slug,
                name, 
                address, 
                contact,
                phone,
                logoUrl,
                instagramUrl,
                facebookUrl,
                websiteUrl,
                description
            );
            res.status(201).json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getClubById = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'ID de club inválido' });
            }
            const club = await this.clubService.getClubById(id);
            res.json(club);
        } catch (error: any) {
            res.status(404).json({ error: error.message });
        }
    }

    getClubBySlug = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            if (!slug) {
                return res.status(400).json({ error: 'Slug de club requerido' });
            }
            const club = await this.clubService.getClubBySlug(slug as string);
            res.json(club);
        } catch (error: any) {
            res.status(404).json({ error: error.message });
        }
    }

    getAllClubs = async (req: Request, res: Response) => {
        try {
            const clubs = await this.clubService.getAllClubs();
            res.json(clubs);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    updateClub = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'ID de club inválido' });
            }
            const {
                slug,
                name,
                address,
                contactInfo,
                phone,
                logoUrl,
                instagramUrl,
                facebookUrl,
                websiteUrl,
                description
            } = req.body;

            const club = await this.clubService.updateClub(id, {
                slug,
                name,
                address,
                contactInfo,
                phone: phone === '' ? null : phone,
                logoUrl: logoUrl === '' ? null : logoUrl,
                instagramUrl: instagramUrl === '' ? null : instagramUrl,
                facebookUrl: facebookUrl === '' ? null : facebookUrl,
                websiteUrl: websiteUrl === '' ? null : websiteUrl,
                description: description === '' ? null : description
            });
            res.json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    createCourt = async (req: Request, res: Response) => {
        try {
            const { clubId, name, surface, activityIds } = req.body;
            const court = await this.clubService.registerCourt(clubId, name, surface, activityIds);
            res.status(201).json(court);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    getClubClientsList = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        
        // 👇 LLAMAMOS AL MÉTODO NUEVO DEL SERVICIO
        const clients = await this.clubService.getClientsList(slug as string);
        
        res.json(clients);
    } catch (error: any) {
        console.error("Error obteniendo clientes:", error);
        res.status(500).json({ error: 'Error interno al obtener clientes' });
    }
}
}

