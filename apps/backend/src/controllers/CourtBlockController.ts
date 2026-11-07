import { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest, ErrorCodes, sendAppError, zodValidationAppError } from '../errors';
import { CourtBlockService } from '../services/CourtBlockService';

const positiveInt = z.preprocess((v) => Number(v), z.number().int().positive());
const isoDate = z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : new Date(String(v))),
    z.date().refine((d) => !Number.isNaN(d.getTime()), { message: 'Fecha inválida.' })
);
const optionalTitle = z.string().trim().max(120).optional().nullable();

const listSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    courtId: positiveInt.optional()
});

const createSchema = z.object({
    courtId: positiveInt,
    startDateTime: isoDate,
    endDateTime: isoDate,
    title: optionalTitle
});

const updateSchema = z.object({
    courtId: positiveInt.optional(),
    startDateTime: isoDate.optional(),
    endDateTime: isoDate.optional(),
    title: optionalTitle
});

export class CourtBlockController {
    private service = new CourtBlockService();

    private clubId(req: Request) {
        const clubId = Number((req as any).clubId || (req as any).club?.id || 0);
        if (!Number.isFinite(clubId) || clubId <= 0) {
            throw badRequest('No se pudo determinar el club activo.', ErrorCodes.CLUB_NOT_FOUND);
        }
        return clubId;
    }

    private actorUserId(req: Request) {
        return Number((req as any).user?.userId || 0) || null;
    }

    // GET /api/clubs/:slug/admin/court-blocks?date=YYYY-MM-DD | ?from=ISO&to=ISO
    list = async (req: Request, res: Response) => {
        try {
            const parsed = listSchema.safeParse(req.query || {});
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Filtros inválidos.'));
            res.json(await this.service.list(this.clubId(req), parsed.data));
        } catch (error) {
            return sendAppError(res, error, 'Error al obtener bloqueos');
        }
    };

    // POST /api/clubs/:slug/admin/court-blocks
    create = async (req: Request, res: Response) => {
        try {
            const parsed = createSchema.safeParse(req.body || {});
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los datos del bloqueo.'));
            const created = await this.service.create(this.clubId(req), parsed.data, this.actorUserId(req));
            res.status(201).json(created);
        } catch (error) {
            return sendAppError(res, error, 'Error al crear el bloqueo');
        }
    };

    // PATCH /api/clubs/:slug/admin/court-blocks/:id
    update = async (req: Request, res: Response) => {
        try {
            const parsed = updateSchema.safeParse(req.body || {});
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los datos del bloqueo.'));
            const blockId = String(req.params.id || '').trim();
            if (!blockId) return sendAppError(res, badRequest('Bloqueo inválido.', ErrorCodes.INVALID_INPUT));
            res.json(await this.service.update(this.clubId(req), blockId, parsed.data));
        } catch (error) {
            return sendAppError(res, error, 'Error al actualizar el bloqueo');
        }
    };

    // DELETE /api/clubs/:slug/admin/court-blocks/:id
    remove = async (req: Request, res: Response) => {
        try {
            const blockId = String(req.params.id || '').trim();
            if (!blockId) return sendAppError(res, badRequest('Bloqueo inválido.', ErrorCodes.INVALID_INPUT));
            await this.service.remove(this.clubId(req), blockId);
            res.status(204).end();
        } catch (error) {
            return sendAppError(res, error, 'Error al eliminar el bloqueo');
        }
    };
}
