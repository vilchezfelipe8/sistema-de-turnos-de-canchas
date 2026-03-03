import { Request, Response } from 'express';
import { CashService } from '../services/CashService';
import { ProductService } from '../services/ProductService';
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
                method: z.enum(['CASH', 'TRANSFER']).optional(),
                userId: z.preprocess((v) => v ? Number(v) : undefined, z.number().int().positive().optional()),
                userPhone: z.string().optional(),
                onAccount: z.boolean().optional()
            });

            const parsed = createMovementSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }

            const clubId = (req as any).clubId;
            const { amount, description, type, method, userId, userPhone, onAccount } = parsed.data;

            // Si se marca dejar en cuenta, usamos method 'ON_ACCOUNT' y actualizamos saldo del usuario cuando exista.
            if (onAccount) {
                try {
                    // Intentamos asociar a un usuario por ID o teléfono
                    let foundUserId: number | null = userId ?? null;
                    if (!foundUserId && userPhone) {
                        const found = await prisma.user.findFirst({ where: { phoneNumber: String(userPhone) } });
                        if (found) foundUserId = found.id;
                    }

                    const movementData: any = {
                        amount,
                        description: description + (userPhone ? ` (Cliente: ${userPhone})` : ''),
                        type,
                        method: 'ON_ACCOUNT',
                        date: new Date(),
                        club: { connect: { id: clubId } }
                    };

                    // Si hay usuario, hacer todo en transacción: actualizar saldo y crear movimiento
                    if (foundUserId) {
                        const result = await prisma.$transaction(async (tx) => {
                            await tx.user.update({ where: { id: foundUserId }, data: { pendingBalance: { increment: Number(amount) } } });
                            return tx.cashMovement.create({ data: { ...movementData, user: { connect: { id: foundUserId } } } });
                        });
                        return res.json(result);
                    }

                    // Si no hay usuario, creamos movimiento con method ON_ACCOUNT y lo devolvemos
                    const movement = await prisma.cashMovement.create({ data: movementData });
                    return res.json(movement);
                } catch (err) {
                    console.error('Error registrando movimiento onAccount:', err);
                    return res.status(500).json({ error: 'Error al registrar movimiento en cuenta' });
                }
            }

            // Si no es onAccount, creamos movimiento normal (pago inmediato)
            const cleanData = {
                amount,
                description,
                type,
                method: method ?? 'CASH',
                date: new Date(),
                clubId,
                userId: userId ?? undefined
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
                method: z.enum(['CASH', 'TRANSFER']).optional(),
                userId: z.preprocess((v) => v ? Number(v) : undefined, z.number().int().positive().optional()),
                userPhone: z.string().optional(),
                onAccount: z.boolean().optional()
            });
            const parsed = productSaleSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: parsed.error.format() });
            }
            const clubId = (req as any).clubId;
            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });
            const { productId, quantity: qty, method } = parsed.data;
            const { userId, userPhone, onAccount } = parsed.data;

            const productService = new ProductService();
            const product = await prisma.product.findFirst({ where: { id: Number(productId), clubId } });
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

            const amount = Number(product.price) * qty;

            // Si es un combo, calcular productos base necesarios
            let requiredMap: Record<number, number> | null = null;
            if (product.isCombo) {
                try {
                    requiredMap = await productService.computeRequiredBaseProducts(product.id, qty);
                } catch (err: any) {
                    console.error('Error computando componentes del combo:', err);
                    return res.status(500).json({ error: 'Error al procesar componentes del combo' });
                }

                // Validar stock para cada producto base
                const reqIds = Object.keys(requiredMap).map((k) => Number(k));
                const baseProducts = await prisma.product.findMany({ where: { id: { in: reqIds } } });
                const insufficient: { id: number; name: string; need: number; stock: number }[] = [];
                for (const bp of baseProducts) {
                    const need = requiredMap[bp.id] || 0;
                    if ((bp.stock ?? 0) < need) insufficient.push({ id: bp.id, name: bp.name, need, stock: bp.stock ?? 0 });
                }
                if (insufficient.length > 0) return res.status(400).json({ error: 'No hay suficiente stock en componentes', details: insufficient });
            } else {
                // Producto simple: validar stock
                if ((product.stock ?? 0) < qty) return res.status(400).json({ error: 'No hay suficiente stock' });
            }

            // Flujo onAccount o venta inmediata: realizar transacción que descuenta stocks y crea movimiento
            if (onAccount) {
                try {
                    let foundUserId: number | null = userId ?? null;
                    if (!foundUserId && userPhone) {
                        const found = await prisma.user.findFirst({ where: { phoneNumber: String(userPhone) } });
                        if (found) foundUserId = found.id;
                    }

                    const movementData: any = {
                        date: new Date(),
                        type: 'INCOME',
                        amount,
                        description: `Venta: ${qty}x ${product.name}` + (userPhone ? ` (Cliente: ${userPhone})` : ''),
                        method: 'ON_ACCOUNT',
                        club: { connect: { id: clubId } }
                    };

                    const result = await prisma.$transaction(async (tx) => {
                        // descontar stocks
                        if (product.isCombo && requiredMap) {
                            for (const [pidStr, need] of Object.entries(requiredMap)) {
                                const pid = Number(pidStr);
                                await tx.product.update({ where: { id: pid }, data: { stock: { decrement: need } } });
                            }
                        } else {
                            await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: qty } } });
                        }

                        if (foundUserId) {
                            await tx.user.update({ where: { id: foundUserId }, data: { pendingBalance: { increment: Number(amount) } } });
                            return tx.cashMovement.create({ data: { ...movementData, user: { connect: { id: foundUserId } } } });
                        }

                        return tx.cashMovement.create({ data: movementData });
                    });

                    return res.json(result);
                } catch (err) {
                    console.error('Error registrando venta onAccount:', err);
                    return res.status(500).json({ error: 'Error al registrar venta en cuenta' });
                }
            }

            // Venta inmediata
            const movement = await prisma.$transaction(async (tx) => {
                if (product.isCombo && requiredMap) {
                    for (const [pidStr, need] of Object.entries(requiredMap)) {
                        const pid = Number(pidStr);
                        await tx.product.update({ where: { id: pid }, data: { stock: { decrement: need } } });
                    }
                } else {
                    await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: qty } } });
                }

                return tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount,
                        description: `Venta: ${qty}x ${product.name}`,
                        method: method ?? 'CASH',
                        club: { connect: { id: clubId } },
                        user: userId ? { connect: { id: Number(userId) } } : undefined
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