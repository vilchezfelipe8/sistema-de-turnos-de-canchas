import { prisma } from '../prisma';

export class ProductService {

    // 1. Obtener todos los productos de un club
    async getProductsByClub(clubId: number) {
        return await prisma.product.findMany({
            where: { clubId },
            orderBy: { name: 'asc' }
        });
    }

    // 2. Crear un producto nuevo
    async createProduct(clubId: number, data: { name: string; price: number; stock: number; category?: string }) {
        return await prisma.product.create({
            data: {
                clubId,
                name: data.name,
                price: data.price,
                stock: data.stock,
                category: data.category
            }
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
        data: { name?: string; price?: number; stock?: number; category?: string }
    ) {
        const product = await prisma.product.findFirst({ where: { id, clubId } });
        if (!product) return null;
        return prisma.product.update({
            where: { id },
            data
        });
    }

    // 4. Borrar producto
    async deleteProduct(id: number) {
        return await prisma.product.delete({
            where: { id }
        });
    }

    async deleteProductByClub(id: number, clubId: number) {
        const product = await prisma.product.findFirst({ where: { id, clubId } });
        if (!product) return null;
        return prisma.product.delete({ where: { id } });
    }
}