import { Request, Response } from 'express';
import { CashService } from '../services/CashService';
import { prisma } from '../prisma';
import { z } from 'zod';

export class CashController {
    private cashService: CashService;

    constructor(cashService: CashService) {
        this.cashService = cashService;
    }

    // Usamos arrow functions para no perder el 'this'
    getSummary = async (req: Request, res: Response) => {
        try {
            const clubId = (req as any).clubId;
            const summary = await this.cashService.getDailySummary(clubId);
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener caja' });
        }
    }

    createMovement = async (req: Request, res: Response) => {
        try {
            const createMovementSchema = z.object({
                amount: z.union([z.number(), z.string()]).transform((v) => (typeof v === 'string' ? parseFloat(v) : v)).pipe(z.number().finite()),
                description: z.string().min(1),
                type: z.enum(['INCOME', 'EXPENSE']),
                method: z.enum(['CASH', 'TRANSFER'])
            });
            const parsed = createMovementSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const clubId = (req as any).clubId;
            const cleanData = {
                amount: parsed.data.amount,
                description: parsed.data.description,
                type: parsed.data.type,
                method: parsed.data.method,
                date: new Date(),
                clubId
            };
            const movement = await this.cashService.addMovement(cleanData);
            res.json(movement);
        } catch (error) {
            console.error("❌ Error en createMovement:", error);
            res.status(500).json({ error: 'Error al crear movimiento' });
        }
    }

    // GET /api/cash/products: lista productos del club del admin
    getProducts = async (req: Request, res: Response) => {
        try {
            const clubId = (req as any).clubId;
            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });

            const products = await prisma.product.findMany({
                where: { clubId },
                orderBy: { name: 'asc' }
            });

            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener productos' });
        }
    }

    // POST /api/cash/product-sale: registrar venta de producto sin reserva
    createProductSale = async (req: Request, res: Response) => {
        try {
            const productSaleSchema = z.object({
                productId: z.preprocess((v) => Number(v), z.number().int().positive()),
                quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
                method: z.enum(['CASH', 'TRANSFER']).optional()
            });
            const parsed = productSaleSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const clubId = (req as any).clubId;
            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });
            const { productId, quantity: qty, method } = parsed.data;

            const product = await prisma.product.findFirst({
                where: { id: Number(productId), clubId }
            });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
            if (product.stock < qty) return res.status(400).json({ error: 'No hay suficiente stock' });

            const amount = Number(product.price) * qty;

            const movement = await prisma.$transaction(async (tx) => {
                await tx.product.update({
                    where: { id: product.id },
                    data: { stock: { decrement: qty } }
                });

                return tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount,
                        description: `Venta: ${qty}x ${product.name}`,
                        method: method ?? 'CASH',
                        clubId
                    }
                });
            });

            res.json(movement);
        } catch (error) {
            console.error('❌ Error en createProductSale:', error);
            res.status(500).json({ error: 'Error al registrar la venta' });
        }
    }
}