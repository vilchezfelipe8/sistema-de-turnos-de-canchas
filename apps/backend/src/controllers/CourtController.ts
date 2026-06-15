import { Request, Response } from 'express';
import { sendAppError } from '../errors';
import { validationError, zodValidationAppError } from '../errors';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma';
import { z } from 'zod';
import { sendAuthError } from '../utils/authError';

export class CourtController {
    private courtRepo: CourtRepository;

    constructor() {
        this.courtRepo = new CourtRepository();
    }

    createCourt = async (req: Request, res: Response) => {
        try {
            const createCourtSchema = z.object({
                name: z.string().min(1),
                isIndoor: z.boolean().optional(),
                surface: z.string().optional(),
                activityTypeId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
            });
            const parsed = createCourtSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }
            const { name, isIndoor, surface, activityTypeId } = parsed.data;
            const clubId = (req as any).clubId;
            if (!clubId) {
                return sendAppError(res, validationError('Revisá los campos marcados.', { general: 'No se pudo determinar el club.' }));
            }
            const data: any = {
                name,
                clubId,
                isIndoor: isIndoor ?? false,
                surface: surface ?? 'Sintético'
            };
            if (activityTypeId != null) {
                const activityType = await prisma.activityType.findFirst({
                    where: { id: activityTypeId, clubId: Number(clubId) }
                });
                if (!activityType) {
                    return sendAppError(res, validationError('Revisá los campos marcados.', { activityTypeId: 'La actividad no pertenece al club actual.' }));
                }
                data.activityTypeId = activityTypeId;
            }

            const newCourt = await prisma.court.create({
                data,
                include: { club: true, activityType: true } as any
            });

            res.status(201).json(newCourt);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo crear la cancha');
        }
    }

    updateCourt = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({ id: z.preprocess((v) => Number(v), z.number().int().positive()) });
            const bodySchema = z.object({
                isUnderMaintenance: z.boolean().optional(),
                name: z.string().optional(),
                activityTypeId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                price: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? undefined : Number(v)))
            });
            const paramsParsed = paramsSchema.safeParse(req.params);
            const bodyParsed = bodySchema.safeParse(req.body);
            if (!paramsParsed.success) {
                return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
            }
            if (!bodyParsed.success) {
                return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));
            }
            const { id } = paramsParsed.data;
            const { isUnderMaintenance, name, activityTypeId, price } = bodyParsed.data;
            const clubId = (req as any).clubId;

            if (clubId) {
                const court = await prisma.court.findUnique({
                    where: { id: Number(id) }
                });
                if (!court) {
                    return res.status(404).json({ error: "Cancha no encontrada" });
                }
                if (court.clubId !== clubId) {
                    return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta cancha');
                }
            }

            const data: any = {
                isUnderMaintenance: isUnderMaintenance,
                name: name
            };
            if (activityTypeId) {
                const activityType = await prisma.activityType.findFirst({
                    where: { id: Number(activityTypeId), clubId: Number(clubId) }
                });
                if (!activityType) {
                    return sendAppError(res, validationError('Revisá los campos marcados.', { activityTypeId: 'La actividad no pertenece al club actual.' }));
                }
                data.activityTypeId = Number(activityTypeId);
            }
            if (price !== undefined && price !== null && Number.isFinite(Number(price))) data.price = Number(price);

            const updatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data,
                include: { club: true, activityType: true } as any
            });

            res.json(updatedCourt);
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo actualizar la cancha.');
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
                    return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta cancha');
                }
            }

            const suspendedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: true
                },
                include: { club: true, activityType: true } as any
            });

            res.json({ message: "Cancha suspendida exitosamente", court: suspendedCourt });
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo suspender la cancha.');
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
                    return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta cancha');
                }
            }

            const reactivatedCourt = await prisma.court.update({
                where: { id: Number(id) },
                data: {
                    isUnderMaintenance: false
                },
                include: { club: true, activityType: true }
            });

            res.json({ message: "Cancha reactivada exitosamente", court: reactivatedCourt });
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo reactivar la cancha.');
        }
    }

    deleteCourt = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({ id: z.preprocess((v) => Number(v), z.number().int().positive()) });
            const paramsParsed = paramsSchema.safeParse(req.params);
            if (!paramsParsed.success) {
                return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
            }

            const id = paramsParsed.data.id;
            const clubId = (req as any).clubId as number | undefined;

            const court = await prisma.court.findUnique({ where: { id } });
            if (!court) {
                return res.status(404).json({ error: 'Cancha no encontrada' });
            }

            if (clubId && court.clubId !== clubId) {
                return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'No tienes acceso a esta cancha');
            }

            const deleted = await this.courtRepo.deleteCourt(id);
            return res.json({ success: true, court: deleted });
        } catch (error: any) {
            return sendAppError(res, error, 'No se pudo eliminar la cancha');
        }
    }
}
