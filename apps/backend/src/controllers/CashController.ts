import { Request, Response } from 'express';
import { CashService } from '../services/CashService';
import { prisma } from '../prisma';

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
            const { amount, description, type, method } = req.body;
            const clubId = (req as any).clubId;

            const numericAmount = parseFloat(amount);

            if (isNaN(numericAmount)) {
                return res.status(400).json({ error: "El monto debe ser un número válido" });
            }

            // 👇 2. ARMAMOS EL OBJETO LIMPIO
            const cleanData = {
                amount: numericAmount, 
                description: description,
                type: type,   // 'INCOME' o 'EXPENSE'
                method: method, // 'CASH' o 'TRANSFER'
                date: new Date(), // Aseguramos que tenga fecha
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
            const clubId = (req as any).clubId;
            const { productId, quantity, method } = req.body;

            if (!clubId) return res.status(400).json({ error: 'No se pudo determinar el club' });
            const qty = Number(quantity);
            if (!productId || !Number.isFinite(qty) || qty <= 0) {
                return res.status(400).json({ error: 'Producto o cantidad inválida' });
            }

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
                        method: method || 'CASH',
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