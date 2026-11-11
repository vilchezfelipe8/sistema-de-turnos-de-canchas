import { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest, ErrorCodes, sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClubRepository } from '../repositories/ClubRepository';
import { StockMovementService } from '../services/StockMovementService';

const STOCK_MOVEMENT_TYPES = ['INITIAL', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE', 'MANUAL_EDIT'] as const;

const positiveInt = z.preprocess((v) => Number(v), z.number().int().positive());
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

const entrySchema = z.object({
    supplier: optionalText(160),
    documentNumber: optionalText(80),
    notes: optionalText(300),
    occurredAt: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
    items: z.array(z.object({
        productId: positiveInt,
        quantity: z.preprocess((v) => Number(v), z.number().int('La cantidad debe ser entera.').positive('Cargá una cantidad mayor a 0.')),
        unitCost: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().min(0).nullable().optional())
    })).min(1, 'Cargá al menos un producto.').max(200)
});

const countSchema = z.object({
    notes: optionalText(300),
    items: z.array(z.object({
        productId: positiveInt,
        countedQuantity: z.preprocess((v) => Number(v), z.number().int('La cantidad debe ser entera.').min(0, 'No puede ser negativa.'))
    })).min(1, 'Cargá al menos un producto contado.').max(500)
});

const wasteSchema = z.object({
    reason: optionalText(300),
    items: z.array(z.object({
        productId: positiveInt,
        quantity: z.preprocess((v) => Number(v), z.number().int('La cantidad debe ser entera.').positive('Cargá una cantidad mayor a 0.'))
    })).min(1, 'Cargá al menos un producto.').max(200)
});

const listSchema = z.object({
    productId: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().positive().optional()),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
    from: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
    to: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
    limit: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).max(200).optional()),
    cursor: z.string().trim().min(1).optional()
});

export class StockController {
    private clubRepository = new ClubRepository();
    private stockMovementService = new StockMovementService();

    private async resolveClubId(req: Request) {
        const slug = String(req.params.slug || '').trim();
        if (!slug) throw validationError('Revisá los campos marcados.', { slug: 'Club inválido.' });
        const club = await this.clubRepository.findBySlug(slug);
        if (!club) throw badRequest('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
        return club.id;
    }

    private actorUserId(req: Request) {
        return Number((req as any).user?.userId || 0) || null;
    }

    // GET /api/clubs/:slug/admin/stock/movements
    list = async (req: Request, res: Response) => {
        try {
            const parsed = listSchema.safeParse(req.query);
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Filtros inválidos.'));
            const clubId = await this.resolveClubId(req);
            res.json(await this.stockMovementService.listMovements(clubId, parsed.data));
        } catch (error) {
            return sendAppError(res, error, 'Error al obtener movimientos de stock');
        }
    };

    // POST /api/clubs/:slug/admin/stock/entries
    createEntry = async (req: Request, res: Response) => {
        try {
            const parsed = entrySchema.safeParse(req.body);
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            const clubId = await this.resolveClubId(req);
            const result = await this.stockMovementService.registerEntry(clubId, parsed.data, this.actorUserId(req));
            res.status(201).json(result);
        } catch (error) {
            return sendAppError(res, error, 'Error al registrar el ingreso');
        }
    };

    // POST /api/clubs/:slug/admin/stock/counts
    createCount = async (req: Request, res: Response) => {
        try {
            const parsed = countSchema.safeParse(req.body);
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            const clubId = await this.resolveClubId(req);
            const result = await this.stockMovementService.registerCount(clubId, parsed.data, this.actorUserId(req));
            res.status(201).json(result);
        } catch (error) {
            return sendAppError(res, error, 'Error al registrar el conteo');
        }
    };

    // POST /api/clubs/:slug/admin/stock/waste
    createWaste = async (req: Request, res: Response) => {
        try {
            const parsed = wasteSchema.safeParse(req.body);
            if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            const clubId = await this.resolveClubId(req);
            const result = await this.stockMovementService.registerWaste(clubId, parsed.data, this.actorUserId(req));
            res.status(201).json(result);
        } catch (error) {
            return sendAppError(res, error, 'Error al registrar la merma');
        }
    };
}
