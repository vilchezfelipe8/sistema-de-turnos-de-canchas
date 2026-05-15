import { Request, Response } from 'express';
import { badRequest, ErrorCodes, sendAppError, validationError, zodValidationAppError } from '../errors';
import { z } from 'zod';
import { ProductService } from '../services/ProductService';
import { ClubRepository } from '../repositories/ClubRepository';
import { sanitizeString } from '../utils/sanitize';

export class ProductController {
    private productService: ProductService;
    private clubRepository: ClubRepository;

    constructor() {
        this.productService = new ProductService();
        this.clubRepository = new ClubRepository();
    }

    private resolveClubSlug(slug: unknown) {
        const value = String(slug || '').trim();
        if (!value) {
            throw validationError('Revisá los campos marcados.', { slug: 'Club inválido.' });
        }
        return value;
    }

    // GET /api/clubs/:slug/products
    getAll = async (req: Request, res: Response) => {
        try {
            const club = await this.clubRepository.findBySlug(this.resolveClubSlug(req.params.slug));
            if (!club) throw badRequest('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);

            const products = await this.productService.getProductsByClub(club.id);
            res.json(products);
        } catch (error) {
            return sendAppError(res, error, 'Error al obtener productos');
        }
    }

    // POST /api/clubs/:slug/products
    create = async (req: Request, res: Response) => {
        try {
            const bodySchema = z.object({
                name: z.string().trim().min(2, 'Cargá un nombre válido.'),
                price: z.preprocess((v) => Number(v), z.number().positive('Cargá un precio válido.')),
                stock: z.preprocess((v) => (v === undefined || v === null || v === '' ? 0 : Number(v)), z.number().min(0, 'Cargá un stock válido.')),
                category: z.string().trim().max(100).optional().nullable(),
                isCombo: z.boolean().optional(),
                components: z.array(z.object({
                    componentProductId: z.preprocess((v) => Number(v), z.number().int().positive()),
                    quantity: z.preprocess((v) => Number(v), z.number().positive())
                })).optional()
            });
            const parsed = bodySchema.safeParse(req.body);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }

            const club = await this.clubRepository.findBySlug(this.resolveClubSlug(req.params.slug));
            if (!club) throw badRequest('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);

            const newProduct = await this.productService.createProduct(club.id, {
                name: sanitizeString(parsed.data.name, 200),
                price: parsed.data.price,
                stock: parsed.data.stock,
                category: parsed.data.category ? sanitizeString(String(parsed.data.category), 100) : undefined,
                isCombo: Boolean(parsed.data.isCombo),
                components: Array.isArray(parsed.data.components) ? parsed.data.components : []
            });
            res.status(201).json(newProduct);
        } catch (error) {
            return sendAppError(res, error, 'Error al crear producto');
        }
    }

    // PUT /api/clubs/:slug/products/:id
    update = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const bodySchema = z.object({
                name: z.string().trim().min(2, 'Cargá un nombre válido.').optional(),
                price: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().positive('Cargá un precio válido.').optional()),
                stock: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().min(0, 'Cargá un stock válido.').optional()),
                category: z.string().trim().max(100).optional().nullable(),
                isCombo: z.boolean().optional(),
                components: z.array(z.object({
                    componentProductId: z.preprocess((v) => Number(v), z.number().int().positive()),
                    quantity: z.preprocess((v) => Number(v), z.number().positive())
                })).optional()
            });
            const parsedParams = paramsSchema.safeParse(req.params);
            const parsedBody = bodySchema.safeParse(req.body);
            if (!parsedParams.success) {
                return sendAppError(res, zodValidationAppError(parsedParams.error, 'Revisá los campos marcados.'));
            }
            if (!parsedBody.success) {
                return sendAppError(res, zodValidationAppError(parsedBody.error, 'Revisá los campos marcados.'));
            }

            const data = parsedBody.data;
            const club = await this.clubRepository.findBySlug(this.resolveClubSlug(req.params.slug));
            if (!club) throw badRequest('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);

            const updateData: any = {
                ...data,
                price: data.price !== undefined ? Number(data.price) : undefined,
                stock: data.stock !== undefined ? Number(data.stock) : undefined,
                isCombo: data.isCombo !== undefined ? Boolean(data.isCombo) : undefined,
                components: Array.isArray(data.components) ? data.components : undefined
            };
            if (data.name != null) updateData.name = sanitizeString(String(data.name), 200);
            if (data.category != null) updateData.category = sanitizeString(String(data.category), 100);

            const updatedProduct = await this.productService.updateProductByClub(parsedParams.data.id, club.id, updateData);
            if (!updatedProduct) throw badRequest('Producto no encontrado.', ErrorCodes.PRODUCT_NOT_FOUND);
            res.json(updatedProduct);
        } catch (error) {
            return sendAppError(res, error, 'Error al actualizar producto');
        }
    }

    // DELETE /api/clubs/:slug/products/:id
    delete = async (req: Request, res: Response) => {
        try {
            const paramsSchema = z.object({
                id: z.preprocess((v) => Number(v), z.number().int().positive())
            });
            const parsed = paramsSchema.safeParse(req.params);
            if (!parsed.success) {
                return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
            }
            const club = await this.clubRepository.findBySlug(this.resolveClubSlug(req.params.slug));
            if (!club) throw badRequest('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);

            const deleted = await this.productService.deleteProductByClub(parsed.data.id, club.id);
            if (!deleted) throw badRequest('Producto no encontrado.', ErrorCodes.PRODUCT_NOT_FOUND);

            res.json({ message: 'Producto eliminado' });
        } catch (error) {
            return sendAppError(res, error, 'Error al eliminar producto');
        }
    }
}
