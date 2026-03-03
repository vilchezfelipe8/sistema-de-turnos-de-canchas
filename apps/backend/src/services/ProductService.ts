import { prisma } from '../prisma';

export class ProductService {

    // 1. Obtener todos los productos de un club
    async getProductsByClub(clubId: number) {
        return await prisma.product.findMany({
            where: { clubId, isActive: true },
            orderBy: { name: 'asc' },
            include: {
                components: { include: { component: true } }
            }
        });
    }

    // 2. Crear un producto nuevo (soporta combos con components: [{ componentId, quantity }])
    async createProduct(clubId: number, data: { name: string; price: number; stock: number; category?: string; isCombo?: boolean; components?: { componentId: number; quantity: number }[] }) {
        const created = await prisma.product.create({
            data: {
                clubId,
                name: data.name,
                price: data.price,
                stock: data.stock,
                category: data.category,
                isCombo: !!data.isCombo
            }
        });

        if (data.isCombo && Array.isArray(data.components) && data.components.length > 0) {
            const comps = data.components.map((c) => ({ parentId: created.id, componentId: c.componentId, quantity: c.quantity }));
            await prisma.productComponent.createMany({ data: comps });
        }

        return created;
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
        data: { name?: string; price?: number; stock?: number; category?: string; isCombo?: boolean; components?: { componentId: number; quantity: number }[] }
    ) {
        const product = await prisma.product.findFirst({ where: { id, clubId } });
        if (!product) return null;
        const updateData: any = { ...data };
        // Prevent passing components into product update directly
        delete updateData.components;

        const updated = await prisma.product.update({ where: { id }, data: updateData });

        // If components provided and product is combo, replace existing components
        if (Array.isArray(data.components)) {
            await prisma.$transaction(async (tx) => {
                await tx.productComponent.deleteMany({ where: { parentId: id } });
                if (data.components && data.components.length > 0) {
                    const comps = data.components.map((c) => ({ parentId: id, componentId: c.componentId, quantity: c.quantity }));
                    await tx.productComponent.createMany({ data: comps });
                }
            });
        }

        return updated;
    }

    // Devuelve un mapa productId -> totalQuantity necesaria para producir `qty` unidades del productoId.
    // Maneja combos anidados y detecta ciclos.
    async computeRequiredBaseProducts(productId: number, qty: number) {
        const map = new Map<number, number>();
        const visited = new Set<number>();

        const tx = prisma;

        const recurse = async (pid: number, multiplier: number) => {
            if (visited.has(pid)) throw new Error('Ciclo detectado en componentes de producto');
            visited.add(pid);

            const prod = await tx.product.findUnique({ where: { id: pid }, select: { isCombo: true, components: { select: { componentId: true, quantity: true } } } });
            if (!prod) throw new Error('Producto no encontrado en descomposición');

            if (!prod.isCombo || !prod.components || prod.components.length === 0) {
                map.set(pid, (map.get(pid) || 0) + multiplier);
            } else {
                for (const c of prod.components) {
                    await recurse(c.componentId, multiplier * c.quantity);
                }
            }

            visited.delete(pid);
        };

        await recurse(productId, qty);

        // Convert map to plain object
        const result: Record<number, number> = {};
        for (const [k, v] of map.entries()) result[k] = v;
        return result;
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