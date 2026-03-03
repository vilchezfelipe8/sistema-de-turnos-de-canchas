import { Request, Response } from 'express';
import { CashService } from '../services/CashService';
import { prisma } from '../prisma';
import { z } from 'zod';
import { ProductService } from '../services/ProductService';

export class CashController {
    private cashService: CashService;
    private productService: ProductService;

    constructor(cashService: CashService) {
        this.cashService = cashService;
        this.productService = new ProductService();
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

            const products = await this.productService.getProductsByClub(clubId);

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
                method: z.enum(['CASH', 'TRANSFER', 'DEBT']).optional(),
                userId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
                guestName: z.string().trim().optional(),
                guestPhone: z.string().trim().optional(),
                guestDni: z.string().trim().optional()
            });
            const parsed = productSaleSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const clubId = (req as any).clubId;
            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });
            const { productId, quantity: qty, method, userId, guestName, guestPhone, guestDni } = parsed.data;

            if (method === 'DEBT' && !userId && !guestDni && !guestPhone && !guestName) {
                return res.status(400).json({ error: 'Debes vincular un cliente para dejar la venta en cuenta' });
            }

            if (userId) {
                const user = await prisma.user.findFirst({ where: { id: userId, clubId } });
                if (!user) {
                    return res.status(400).json({ error: 'El cliente seleccionado no pertenece al club' });
                }
            }

            const product = await prisma.product.findFirst({
                where: { id: Number(productId), clubId, isActive: true }
            });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            const amount = Number(product.price) * qty;

            const movement = await prisma.$transaction(async (tx) => {
                await this.productService.consumeStock(clubId, product.id, qty, tx);

                return tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount,
                        description: `${qty}x ${product.name}`,
                        method: method ?? 'CASH',
                        clubId,
                        user: userId ? { connect: { id: userId } } : undefined,
                        guestName: guestName || null,
                        guestPhone: guestPhone || null,
                        guestDni: guestDni || null,
                        isSettled: method === 'DEBT' ? false : true
                    }
                } as any);
            });

            res.json(movement);
        } catch (error) {
            console.error('❌ Error en createProductSale:', error);
            res.status(500).json({ error: 'Error al registrar la venta' });
        }
    }

    // POST /api/cash/sale-debt/pay: cobrar una deuda de venta extra
    paySaleDebt = async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                movementId: z.preprocess((v) => Number(v), z.number().int().positive()),
                paymentMethod: z.enum(['CASH', 'TRANSFER'])
            });
            const parsed = schema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const clubId = (req as any).clubId;
            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });

            const { movementId, paymentMethod } = parsed.data;

            const debtMovement = await prisma.cashMovement.findFirst({
                where: {
                    id: movementId,
                    clubId,
                    method: 'DEBT',
                    isSettled: false,
                    type: 'INCOME'
                }
            } as any);

            if (!debtMovement) {
                return res.status(404).json({ error: 'No se encontró una deuda pendiente para ese movimiento' });
            }

            const result = await prisma.$transaction(async (tx) => {
                const settled = await tx.cashMovement.update({
                    where: { id: debtMovement.id },
                    data: { isSettled: true }
                } as any);

                const payment = await tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount: Number(debtMovement.amount),
                        description: `Cobro deuda venta #${debtMovement.id}`,
                        method: paymentMethod,
                        clubId,
                        user: (debtMovement as any).userId ? { connect: { id: (debtMovement as any).userId } } : undefined,
                        guestName: (debtMovement as any).guestName ?? null,
                        guestPhone: (debtMovement as any).guestPhone ?? null,
                        guestDni: (debtMovement as any).guestDni ?? null,
                        isSettled: true
                    }
                } as any);

                return { settled, payment };
            });

            res.json(result);
        } catch (error) {
            console.error('❌ Error en paySaleDebt:', error);
            res.status(500).json({ error: 'Error al cobrar deuda de venta' });
        }
    }
}