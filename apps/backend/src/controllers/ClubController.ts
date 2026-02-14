import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';

export class ClubController {
    constructor(private clubService: ClubService) {}

    createClub = async (req: Request, res: Response) => {
        try {
            const { slug, name, addressLine, city, province, country, contact, phone, logoUrl, clubImageUrl, instagramUrl, facebookUrl, websiteUrl, description,
                lightsEnabled, lightsExtraAmount, lightsFromHour, professorDiscountEnabled, professorDiscountPercent } = req.body;
            if (!slug) {
                return res.status(400).json({ error: 'El slug es requerido' });
            }
            const club = await this.clubService.createClub(
                slug,
                name, 
                addressLine,
                city,
                province,
                country,
                contact,
                phone,
                logoUrl,
                clubImageUrl,
                instagramUrl,
                facebookUrl,
                websiteUrl,
                description,
                Boolean(lightsEnabled),
                lightsExtraAmount !== undefined && lightsExtraAmount !== null ? Number(lightsExtraAmount) : null,
                lightsFromHour || null,
                Boolean(professorDiscountEnabled),
                professorDiscountPercent !== undefined && professorDiscountPercent !== null ? Number(professorDiscountPercent) : null
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
                addressLine,
                city,
                province,
                country,
                contactInfo,
                phone,
                logoUrl,
                clubImageUrl,
                instagramUrl,
                facebookUrl,
                websiteUrl,
                description,
                lightsEnabled,
                lightsExtraAmount,
                lightsFromHour,
                professorDiscountEnabled,
                professorDiscountPercent
            } = req.body;

            const club = await this.clubService.updateClub(id, {
                slug,
                name,
                addressLine,
                city,
                province,
                country,
                contactInfo,
                phone: phone === '' ? null : phone,
                logoUrl: logoUrl === '' ? null : logoUrl,
                clubImageUrl: clubImageUrl === '' ? null : clubImageUrl,
                instagramUrl: instagramUrl === '' ? null : instagramUrl,
                facebookUrl: facebookUrl === '' ? null : facebookUrl,
                websiteUrl: websiteUrl === '' ? null : websiteUrl,
                description: description === '' ? null : description,
                lightsEnabled: typeof lightsEnabled === 'boolean' ? lightsEnabled : undefined,
                lightsExtraAmount: lightsExtraAmount === '' || lightsExtraAmount === undefined ? null : Number(lightsExtraAmount),
                lightsFromHour: lightsFromHour === '' ? null : lightsFromHour,
                professorDiscountEnabled: typeof professorDiscountEnabled === 'boolean' ? professorDiscountEnabled : undefined,
                professorDiscountPercent: professorDiscountPercent === '' || professorDiscountPercent === undefined ? null : Number(professorDiscountPercent)
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
        // 1. Obtenemos el ID del club (gracias al middleware verifyClubAccess)
        // Si TypeScript se queja de req.club, podés usar (req as any).club
        const club = (req as any).club;
        
        if (!club) {
            return res.status(404).json({ message: 'Club no encontrado' });
        }

        // 2. Obtenemos lo que escribiste en el buscador
        const query = (req.query.q as string || '').toLowerCase();

        // 3. Pedimos TODOS los clientes al servicio
        // Usamos clubService, que es lo que tenés disponible en el controller
        const allClients = await this.clubService.getClients(club.id);

        // 4. FILTRAMOS NOSOTROS (Acá arreglamos que no traiga todo)
        if (!query) {
            // Si no escribió nada, devolvemos vacío o los primeros 10
            return res.json([]); 
        }

        const filtered = allClients.filter((c: any) => {
            const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
            const phone = c.phoneNumber || c.phone || '';
            const dni = c.dni || '';
            
            // Si el nombre, telefono o dni contiene lo que escribiste... ¡Adentro!
            return fullName.includes(query) || phone.includes(query) || dni.includes(query);
        });

        res.json(filtered);

    } catch (error: any) {
        console.error("Error buscando clientes:", error);
        res.status(500).json({ error: error.message });
    }
};
}

