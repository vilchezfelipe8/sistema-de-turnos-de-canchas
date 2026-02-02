import { PrismaClient } from '@prisma/client';

export class ProductService {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = new PrismaClient();
    }

    // 1. Obtener todos los productos de un club
    async getProductsByClub(clubId: number) {
        return await this.prisma.product.findMany({
            where: { clubId },
            orderBy: { name: 'asc' }
        });
    }

    // 2. Crear un producto nuevo
    async createProduct(clubId: number, data: { name: string; price: number; stock: number; category?: string }) {
        return await this.prisma.product.create({
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
        return await this.prisma.product.update({
            where: { id },
            data
        });
    }

    // 4. Borrar producto
    async deleteProduct(id: number) {
        return await this.prisma.product.delete({
            where: { id }
        });
    }
}