import { Prisma, StockMovementType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';

type Tx = Prisma.TransactionClient;

export type RecordStockMovementInput = {
    clubId: number;
    productId: number;
    /** Delta firmado ya aplicado a Product.stock (+ entra, - sale). */
    quantity: number;
    type: StockMovementType;
    groupId?: string | null;
    supplier?: string | null;
    documentNumber?: string | null;
    unitCost?: number | null;
    reason?: string | null;
    accountId?: string | null;
    accountItemId?: string | null;
    createdByUserId?: number | null;
    occurredAt?: Date | null;
};

export type StockEntryInput = {
    supplier?: string | null;
    documentNumber?: string | null;
    notes?: string | null;
    occurredAt?: Date | null;
    items: Array<{ productId: number; quantity: number; unitCost?: number | null }>;
};

export type StockCountInput = {
    notes?: string | null;
    items: Array<{ productId: number; countedQuantity: number }>;
};

export type StockWasteInput = {
    reason?: string | null;
    items: Array<{ productId: number; quantity: number }>;
};

export type StockMovementFilters = {
    productId?: number;
    type?: StockMovementType;
    from?: Date;
    to?: Date;
    limit?: number;
    cursor?: string;
};

const normalizeText = (value: unknown, max: number) => {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, max) : null;
};

/**
 * Historial de inventario. Regla: todo cambio de Product.stock debe pasar por
 * `recordTx` en la misma transacción, DESPUÉS de aplicar el update, para que
 * stockAfter refleje el saldo real (los updates usan guardas `gte` concurrentes).
 */
export class StockMovementService {
    async recordTx(tx: Tx, input: RecordStockMovementInput) {
        const quantity = Math.trunc(Number(input.quantity));
        if (!Number.isFinite(quantity) || quantity === 0) return null;

        const product = await tx.product.findFirst({
            where: { id: input.productId, clubId: input.clubId },
            select: { stock: true }
        });
        if (!product) return null;

        const stockAfter = Number(product.stock || 0);
        return tx.stockMovement.create({
            data: {
                clubId: input.clubId,
                productId: input.productId,
                type: input.type,
                quantity,
                stockBefore: stockAfter - quantity,
                stockAfter,
                groupId: input.groupId ?? null,
                supplier: normalizeText(input.supplier, 160),
                documentNumber: normalizeText(input.documentNumber, 80),
                unitCost: input.unitCost != null && Number.isFinite(Number(input.unitCost))
                    ? new Prisma.Decimal(Number(input.unitCost))
                    : null,
                reason: normalizeText(input.reason, 300),
                accountId: input.accountId ?? null,
                accountItemId: input.accountItemId ?? null,
                createdByUserId: input.createdByUserId ?? null,
                ...(input.occurredAt ? { occurredAt: input.occurredAt } : {})
            }
        });
    }

    private async loadStockableProducts(tx: Tx, clubId: number, productIds: number[]) {
        const unique = Array.from(new Set(productIds));
        const products = await tx.product.findMany({
            where: { id: { in: unique }, clubId },
            select: { id: true, name: true, stock: true, isCombo: true, isActive: true }
        });
        const byId = new Map(products.map((product) => [product.id, product]));
        for (const id of unique) {
            const product = byId.get(id);
            if (!product) throw notFound('Uno de los productos no existe en el club.', ErrorCodes.PRODUCT_NOT_FOUND);
            if (product.isCombo) {
                throw badRequest(`"${product.name}" es un combo: su stock sale de sus componentes.`, ErrorCodes.INVALID_INPUT);
            }
        }
        return byId;
    }

    /** Ingreso de mercadería (remito de proveedor): suma stock a cada producto. */
    async registerEntry(clubId: number, input: StockEntryInput, actorUserId?: number | null) {
        const items = (input.items || []).filter((item) => Number(item.quantity) > 0);
        if (items.length === 0) throw badRequest('Cargá al menos un producto con cantidad.', ErrorCodes.INVALID_INPUT);

        return prisma.$transaction(async (tx) => {
            await this.loadStockableProducts(tx, clubId, items.map((item) => item.productId));
            const groupId = randomUUID();
            const movements = [];
            for (const item of items) {
                const quantity = Math.trunc(Number(item.quantity));
                await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: quantity } } });
                movements.push(await this.recordTx(tx, {
                    clubId,
                    productId: item.productId,
                    quantity,
                    type: 'PURCHASE',
                    groupId,
                    supplier: input.supplier,
                    documentNumber: input.documentNumber,
                    unitCost: item.unitCost ?? null,
                    reason: input.notes,
                    createdByUserId: actorUserId ?? null,
                    occurredAt: input.occurredAt ?? null
                }));
            }
            return { groupId, movements: movements.filter(Boolean) };
        });
    }

    /** Ajuste por conteo físico: deja el stock en lo contado y registra la diferencia. */
    async registerCount(clubId: number, input: StockCountInput, actorUserId?: number | null) {
        const items = (input.items || []).filter((item) => Number.isFinite(Number(item.countedQuantity)));
        if (items.length === 0) throw badRequest('Cargá al menos un producto contado.', ErrorCodes.INVALID_INPUT);
        if (items.some((item) => Number(item.countedQuantity) < 0)) {
            throw badRequest('La cantidad contada no puede ser negativa.', ErrorCodes.INVALID_INPUT);
        }

        return prisma.$transaction(async (tx) => {
            const byId = await this.loadStockableProducts(tx, clubId, items.map((item) => item.productId));
            const groupId = randomUUID();
            const movements = [];
            let unchanged = 0;
            for (const item of items) {
                const counted = Math.trunc(Number(item.countedQuantity));
                const current = Number(byId.get(item.productId)?.stock || 0);
                const delta = counted - current;
                if (delta === 0) {
                    unchanged += 1;
                    continue;
                }
                await tx.product.update({ where: { id: item.productId }, data: { stock: counted } });
                movements.push(await this.recordTx(tx, {
                    clubId,
                    productId: item.productId,
                    quantity: delta,
                    type: 'ADJUSTMENT',
                    groupId,
                    reason: input.notes || 'Conteo físico',
                    createdByUserId: actorUserId ?? null
                }));
            }
            return { groupId, movements: movements.filter(Boolean), unchanged };
        });
    }

    /** Merma: rotura, vencimiento, consumo interno. Resta stock sin venta asociada. */
    async registerWaste(clubId: number, input: StockWasteInput, actorUserId?: number | null) {
        const items = (input.items || []).filter((item) => Number(item.quantity) > 0);
        if (items.length === 0) throw badRequest('Cargá al menos un producto con cantidad.', ErrorCodes.INVALID_INPUT);

        return prisma.$transaction(async (tx) => {
            const byId = await this.loadStockableProducts(tx, clubId, items.map((item) => item.productId));
            const groupId = randomUUID();
            const movements = [];
            for (const item of items) {
                const quantity = Math.trunc(Number(item.quantity));
                const updated = await tx.product.updateMany({
                    where: { id: item.productId, clubId, stock: { gte: quantity } },
                    data: { stock: { decrement: quantity } }
                });
                if (updated.count !== 1) {
                    throw conflict(`No hay stock suficiente de "${byId.get(item.productId)?.name}".`, ErrorCodes.STOCK_INSUFFICIENT);
                }
                movements.push(await this.recordTx(tx, {
                    clubId,
                    productId: item.productId,
                    quantity: -quantity,
                    type: 'WASTE',
                    groupId,
                    reason: input.reason || 'Merma',
                    createdByUserId: actorUserId ?? null
                }));
            }
            return { groupId, movements: movements.filter(Boolean) };
        });
    }

    async listMovements(clubId: number, filters: StockMovementFilters = {}) {
        const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
        const where: Prisma.StockMovementWhereInput = {
            clubId,
            ...(filters.productId ? { productId: filters.productId } : {}),
            ...(filters.type ? { type: filters.type } : {}),
            ...(filters.from || filters.to
                ? { occurredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
                : {})
        };

        const rows = await prisma.stockMovement.findMany({
            where,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
            include: { product: { select: { id: true, name: true, category: true } } }
        });

        const userIds = Array.from(new Set(rows.map((row) => row.createdByUserId).filter((id): id is number => Boolean(id))));
        const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
            : [];
        const userNameById = new Map(users.map((user) => [user.id, `${user.firstName || ''} ${user.lastName || ''}`.trim()]));

        const page = rows.slice(0, limit);
        return {
            items: page.map((row) => ({
                id: row.id,
                type: row.type,
                quantity: row.quantity,
                stockBefore: row.stockBefore,
                stockAfter: row.stockAfter,
                groupId: row.groupId,
                supplier: row.supplier,
                documentNumber: row.documentNumber,
                unitCost: row.unitCost != null ? Number(row.unitCost) : null,
                reason: row.reason,
                accountId: row.accountId,
                occurredAt: row.occurredAt,
                product: row.product,
                createdBy: row.createdByUserId ? { id: row.createdByUserId, name: userNameById.get(row.createdByUserId) || null } : null
            })),
            nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null
        };
    }
}

export const stockMovementService = new StockMovementService();
