import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';
import { z } from 'zod';

export class ClubController {
    constructor(private clubService: ClubService) {}

    createClub = async (req: Request, res: Response) => {
        try {
            const createClubSchema = z.object({
                slug: z.string().min(1),
                name: z.string().min(1),
                addressLine: z.string().min(1),
                city: z.string().min(1),
                province: z.string().min(1),
                country: z.string().min(1),
                contact: z.string().min(1),
                phone: z.string().optional().nullable(),
                logoUrl: z.string().optional().nullable(),
                clubImageUrl: z.string().optional().nullable(),
                instagramUrl: z.string().optional().nullable(),
                facebookUrl: z.string().optional().nullable(),
                websiteUrl: z.string().optional().nullable(),
                description: z.string().optional().nullable(),
                lightsEnabled: z.boolean().optional(),
                lightsExtraAmount: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                lightsFromHour: z.string().optional().nullable(),
                professorDiscountEnabled: z.boolean().optional(),
                professorDiscountPercent: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                scheduleMode: z.string().optional().nullable(),
                scheduleOpenTime: z.string().optional().nullable(),
                scheduleCloseTime: z.string().optional().nullable(),
                scheduleIntervalMinutes: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
                scheduleDurations: z.array(z.number()).optional().nullable(),
                scheduleFixedSlots: z.array(z.string()).optional().nullable()
            });
            const parsed = createClubSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const { slug, name, addressLine, city, province, country, contact, phone, logoUrl, clubImageUrl, instagramUrl, facebookUrl, websiteUrl, description,
                lightsEnabled, lightsExtraAmount, lightsFromHour, professorDiscountEnabled, professorDiscountPercent,
                scheduleMode, scheduleOpenTime, scheduleCloseTime, scheduleIntervalMinutes, scheduleDurations, scheduleFixedSlots } = parsed.data;
            const club = await this.clubService.createClub(
                slug,
                name,
                addressLine,
                city,
                province,
                country,
                contact,
                phone ?? undefined,
                logoUrl ?? undefined,
                clubImageUrl ?? undefined,
                instagramUrl ?? undefined,
                facebookUrl ?? undefined,
                websiteUrl ?? undefined,
                description ?? undefined,
                Boolean(lightsEnabled),
                lightsExtraAmount ?? null,
                lightsFromHour ?? null,
                Boolean(professorDiscountEnabled),
                professorDiscountPercent ?? null,
                scheduleMode ?? undefined,
                scheduleOpenTime ?? null,
                scheduleCloseTime ?? null,
                scheduleIntervalMinutes ?? null,
                Array.isArray(scheduleDurations) ? scheduleDurations : null,
                Array.isArray(scheduleFixedSlots) ? scheduleFixedSlots : null
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
            const idSchema = z.preprocess((v) => Number(v), z.number().int().positive());
            const idParsed = idSchema.safeParse(req.params.id);
            if (!idParsed.success) {
                return res.status(400).json({ error: 'ID de club inválido' });
            }
            const id = idParsed.data;
            const updateClubSchema = z.object({
                slug: z.string().optional(),
                name: z.string().optional(),
                addressLine: z.string().optional(),
                city: z.string().optional(),
                province: z.string().optional(),
                country: z.string().optional(),
                contactInfo: z.string().optional(),
                phone: z.string().optional().nullable(),
                logoUrl: z.string().optional().nullable(),
                clubImageUrl: z.string().optional().nullable(),
                instagramUrl: z.string().optional().nullable(),
                facebookUrl: z.string().optional().nullable(),
                websiteUrl: z.string().optional().nullable(),
                description: z.string().optional().nullable(),
                lightsEnabled: z.boolean().optional(),
                lightsExtraAmount: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                lightsFromHour: z.string().optional().nullable(),
                professorDiscountEnabled: z.boolean().optional(),
                professorDiscountPercent: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                scheduleMode: z.string().optional(),
                scheduleOpenTime: z.string().optional().nullable(),
                scheduleCloseTime: z.string().optional().nullable(),
                scheduleIntervalMinutes: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v))),
                scheduleDurations: z.array(z.number()).optional(),
                scheduleFixedSlots: z.array(z.string()).optional()
            });
            const parsed = updateClubSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
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
                professorDiscountPercent,
                scheduleMode,
                scheduleOpenTime,
                scheduleCloseTime,
                scheduleIntervalMinutes,
                scheduleDurations,
                scheduleFixedSlots
            } = parsed.data;

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
                lightsExtraAmount: lightsExtraAmount ?? null,
                lightsFromHour: (lightsFromHour === '' || lightsFromHour == null) ? null : lightsFromHour,
                professorDiscountEnabled: typeof professorDiscountEnabled === 'boolean' ? professorDiscountEnabled : undefined,
                professorDiscountPercent: professorDiscountPercent ?? null,
                scheduleMode: scheduleMode || undefined,
                scheduleOpenTime: (scheduleOpenTime === '' || scheduleOpenTime == null) ? null : scheduleOpenTime,
                scheduleCloseTime: (scheduleCloseTime === '' || scheduleCloseTime == null) ? null : scheduleCloseTime,
                scheduleIntervalMinutes: scheduleIntervalMinutes ?? null,
                scheduleDurations: Array.isArray(scheduleDurations) ? scheduleDurations : undefined,
                scheduleFixedSlots: Array.isArray(scheduleFixedSlots) ? scheduleFixedSlots : undefined
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

