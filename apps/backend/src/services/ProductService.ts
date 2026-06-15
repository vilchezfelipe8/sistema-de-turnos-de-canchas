import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';
import { getUserClubContext } from '../utils/getUserClubContext';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';

type ProductComponentInput = {
    componentProductId: number;
    quantity: number;
};

type ProductInput = {
    name: string;
    price: number;
    stock: number;
    category?: string;
    isCombo?: boolean;
    components?: ProductComponentInput[];
};

export class ProductService {
    async resolveClubIdForUser(userId: number, preferredClubId?: number) {
        const context = await getUserClubContext(userId, preferredClubId);
        return context.clubId;
    }

    async getProductsByUserContext(userId: number, preferredClubId?: number) {
        const clubId = await this.resolveClubIdForUser(userId, preferredClubId);
        return this.getProductsByClub(clubId);
    }


    private sanitizeComponents(components: ProductComponentInput[] = []) {
        return components
            .map((component) => ({
                componentProductId: Number(component.componentProductId),
                quantity: Number(component.quantity)
            }))
            .filter((component) => Number.isFinite(component.componentProductId) && component.componentProductId > 0 && Number.isFinite(component.quantity) && component.quantity > 0);
    }

    private async validateComponents(
        tx: Prisma.TransactionClient,
        clubId: number,
        parentProductId: number | null,
        components: ProductComponentInput[]
    ) {
        if (components.length === 0) {
            throw badRequest('Un combo debe tener al menos un componente', ErrorCodes.INVALID_INPUT);
        }

        const seen = new Set<number>();
        for (const component of components) {
            if (parentProductId && component.componentProductId === parentProductId) {
                throw badRequest('Un producto no puede ser componente de sí mismo', ErrorCodes.INVALID_INPUT);
            }
            if (seen.has(component.componentProductId)) {
                throw badRequest('No se puede repetir el mismo producto dentro del combo', ErrorCodes.INVALID_INPUT);
            }
            seen.add(component.componentProductId);
        }

        const componentIds = components.map((component) => component.componentProductId);
        const componentProducts = await tx.product.findMany({
            where: { id: { in: componentIds }, clubId, isActive: true },
            select: { id: true }
        });

        if (componentProducts.length !== componentIds.length) {
            throw conflict('Uno o más componentes no existen, están inactivos o no pertenecen al club', ErrorCodes.PRODUCT_INACTIVE);
        }

        if (!parentProductId) return;

        const edges = await tx.productComponent.findMany({
            where: {
                parentProduct: { clubId },
                componentProduct: { clubId }
            },
            select: { parentProductId: true, componentProductId: true }
        });

        const adjacency = new Map<number, number[]>();
        for (const edge of edges) {
            if (edge.parentProductId === parentProductId) continue;
            if (!adjacency.has(edge.parentProductId)) adjacency.set(edge.parentProductId, []);
            adjacency.get(edge.parentProductId)!.push(edge.componentProductId);
        }

        adjacency.set(parentProductId, components.map((component) => component.componentProductId));

        const canReach = (from: number, target: number, visited: Set<number>): boolean => {
            if (from === target) return true;
            if (visited.has(from)) return false;
            visited.add(from);
            const nextNodes = adjacency.get(from) || [];
            return nextNodes.some((next) => canReach(next, target, visited));
        };

        for (const component of components) {
            if (canReach(component.componentProductId, parentProductId, new Set<number>())) {
                throw conflict('La configuración genera un ciclo entre combos', ErrorCodes.CONFLICT);
            }
        }
    }

    private async getProductsGraph(clubId: number, txClient: Prisma.TransactionClient | typeof prisma = prisma) {
        const rows = await txClient.product.findMany({
            where: { clubId, isActive: true },
            include: {
                components: {
                    include: {
                        componentProduct: {
                            select: { id: true, isActive: true, stock: true, isCombo: true, name: true, price: true }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        return rows;
    }

    private computeAvailableStockMap(products: Array<any>) {
        const byId = new Map<number, any>(products.map((product) => [product.id, product]));
        const memo = new Map<number, number>();

        const dfs = (productId: number, path: Set<number>): number => {
            if (memo.has(productId)) return memo.get(productId)!;
            if (path.has(productId)) return 0;

            const product = byId.get(productId);
            if (!product || !product.isActive) return 0;

            if (!product.isCombo) {
                const stock = Math.max(Number(product.stock || 0), 0);
                memo.set(productId, stock);
                return stock;
            }

            const components = Array.isArray(product.components) ? product.components : [];
            if (components.length === 0) {
                memo.set(productId, 0);
                return 0;
            }

            path.add(productId);
            let maxComboStock = Number.POSITIVE_INFINITY;

            for (const componentRow of components) {
                const qty = Math.max(Number(componentRow.quantity || 0), 0);
                if (qty <= 0) {
                    maxComboStock = 0;
                    break;
                }
                const componentId = Number(componentRow.componentProductId);
                const componentStock = dfs(componentId, path);
                maxComboStock = Math.min(maxComboStock, Math.floor(componentStock / qty));
            }

            path.delete(productId);

            const safeStock = Number.isFinite(maxComboStock) ? Math.max(maxComboStock, 0) : 0;
            memo.set(productId, safeStock);
            return safeStock;
        };

        for (const product of products) dfs(product.id, new Set<number>());
        return memo;
    }

    private explodeToBaseRequirements(
        productId: number,
        quantity: number,
        byId: Map<number, any>,
        requirements: Map<number, number>,
        path: Set<number>
    ) {
        const product = byId.get(productId);
        if (!product) throw notFound('Producto no encontrado', ErrorCodes.PRODUCT_NOT_FOUND);
        if (path.has(productId)) throw conflict('Se detectó un ciclo en la composición de combos', ErrorCodes.CONFLICT);

        if (!product.isCombo) {
            requirements.set(productId, (requirements.get(productId) || 0) + quantity);
            return;
        }

        const components = Array.isArray(product.components) ? product.components : [];
        if (components.length === 0) throw badRequest('El combo no tiene componentes definidos', ErrorCodes.INVALID_INPUT);

        path.add(productId);
        for (const componentRow of components) {
            const componentId = Number(componentRow.componentProductId);
            const componentQty = Number(componentRow.quantity || 0);
            if (!Number.isFinite(componentQty) || componentQty <= 0) {
                throw badRequest('Un componente del combo tiene cantidad inválida', ErrorCodes.INVALID_INPUT);
            }
            this.explodeToBaseRequirements(componentId, quantity * componentQty, byId, requirements, path);
        }
        path.delete(productId);
    }

    // 1. Obtener todos los productos de un club
    async getProductsByClub(clubId: number) {
        const products = await this.getProductsGraph(clubId);
        const availableStockMap = this.computeAvailableStockMap(products);

        return products.map((product) => ({
            ...product,
            stock: availableStockMap.get(product.id) ?? 0,
            baseStock: Number(product.stock || 0),
            components: (product.components || []).map((component: any) => ({
                id: component.id,
                componentProductId: component.componentProductId,
                quantity: component.quantity,
                componentProduct: component.componentProduct
            }))
        }));
    }

    // 2. Crear un producto nuevo
    async createProduct(clubId: number, data: ProductInput) {
        return await prisma.$transaction(async (tx) => {
            const isCombo = Boolean(data.isCombo);
            const components = this.sanitizeComponents(data.components || []);

            if (isCombo) {
                await this.validateComponents(tx, clubId, null, components);
            }

            const created = await tx.product.create({
                data: {
                    clubId,
                    name: data.name,
                    price: data.price,
                    stock: isCombo ? 0 : data.stock,
                    category: data.category,
                    isCombo
                }
            });

            if (isCombo && components.length > 0) {
                await tx.productComponent.createMany({
                    data: components.map((component) => ({
                        parentProductId: created.id,
                        componentProductId: component.componentProductId,
                        quantity: component.quantity
                    }))
                });
            }

            return tx.product.findUnique({
                where: { id: created.id },
                include: {
                    components: {
                        include: {
                            componentProduct: {
                                select: { id: true, name: true, stock: true, isCombo: true }
                            }
                        }
                    }
                }
            });
        });
    }

    // 3. Actualizar stock o precio
    async updateProduct(id: number, data: { name?: string; price?: number; stock?: number; category?: string }) {
        return await prisma.product.update({
            where: { id },
            data
        });
    }

    async updateProductByClub(
        id: number,
        clubId: number,
        data: { name?: string; price?: number; stock?: number; category?: string; isCombo?: boolean; components?: ProductComponentInput[] }
    ) {
        return prisma.$transaction(async (tx) => {
            const product = await tx.product.findFirst({ where: { id, clubId } });
            if (!product) return null;

            const nextIsCombo = typeof data.isCombo === 'boolean' ? data.isCombo : product.isCombo;
            const hasComponentsPayload = Array.isArray(data.components);
            const nextComponents = hasComponentsPayload
                ? this.sanitizeComponents(data.components || [])
                : null;

            if (nextIsCombo && hasComponentsPayload) {
                await this.validateComponents(tx, clubId, id, nextComponents || []);
            }

            await tx.product.update({
                where: { id },
                data: {
                    name: data.name,
                    price: data.price,
                    category: data.category,
                    isCombo: nextIsCombo,
                    stock: nextIsCombo ? 0 : data.stock
                }
            });

            if (!nextIsCombo) {
                await tx.productComponent.deleteMany({ where: { parentProductId: id } });
            } else if (hasComponentsPayload) {
                await tx.productComponent.deleteMany({ where: { parentProductId: id } });
                if ((nextComponents || []).length > 0) {
                    await tx.productComponent.createMany({
                        data: (nextComponents || []).map((component) => ({
                            parentProductId: id,
                            componentProductId: component.componentProductId,
                            quantity: component.quantity
                        }))
                    });
                }
            }

            return tx.product.findUnique({
                where: { id },
                include: {
                    components: {
                        include: {
                            componentProduct: {
                                select: { id: true, name: true, stock: true, isCombo: true }
                            }
                        }
                    }
                }
            });
        });
    }

    async getAvailableStockByProductId(clubId: number, productId: number, txClient: Prisma.TransactionClient | typeof prisma = prisma) {
        const products = await this.getProductsGraph(clubId, txClient);
        const stockMap = this.computeAvailableStockMap(products);
        return stockMap.get(productId) ?? 0;
    }

    async consumeStock(clubId: number, productId: number, quantity: number, txClient: Prisma.TransactionClient) {
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Cantidad inválida', ErrorCodes.INVALID_INPUT);

        const products = await this.getProductsGraph(clubId, txClient);
        const byId = new Map<number, any>(products.map((product) => [product.id, product]));
        const target = byId.get(productId);

        if (!target) throw notFound('Producto no encontrado', ErrorCodes.PRODUCT_NOT_FOUND);
        if (!target.isActive) throw conflict('Producto inactivo', ErrorCodes.PRODUCT_INACTIVE);

        const availableStockMap = this.computeAvailableStockMap(products);
        const available = availableStockMap.get(productId) ?? 0;
        if (available < qty) {
            throw conflict('No hay stock suficiente para completar la venta.', ErrorCodes.STOCK_INSUFFICIENT);
        }

        const requirements = new Map<number, number>();
        this.explodeToBaseRequirements(productId, qty, byId, requirements, new Set<number>());

        for (const [baseProductId, requiredQty] of requirements.entries()) {
            await txClient.product.update({
                where: { id: baseProductId },
                data: { stock: { decrement: requiredQty } }
            });
        }
    }

    // 4. Borrar producto
    async deleteProduct(id: number) {
        return await prisma.product.update({
            where: { id },
            data: { isActive: false }
        });
    }

    async deleteProductByClub(id: number, clubId: number) {
        const product = await prisma.product.findFirst({ where: { id, clubId } });
        if (!product) return null;
        return prisma.product.update({
            where: { id },
            data: { isActive: false }
        });
    }
}