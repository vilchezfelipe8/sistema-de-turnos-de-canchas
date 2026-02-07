import { prisma } from '../prisma'; // Asegurate de que la ruta a tu cliente prisma sea correcta

export class ProductRepository {
  
  // 1. Buscar un producto por ID
  // (Este es el que usa tu BookingService para saber el precio)
  async findById(id: number) {
    return prisma.product.findUnique({
      where: { id }
    });
  }

  // 2. Listar todos los productos
  // (Para mostrar en el select de "Agregar Extras")
  async findAll() {
    return prisma.product.findMany({
      orderBy: { name: 'asc' },
    });
  }

  // 3. Crear un nuevo producto
  // (Para tu gestión de stock)
  async create(data: any) {
    return prisma.product.create({
      data
    });
  }

  // 4. Actualizar producto (Precio, Stock, Nombre)
  async update(id: number, data: any) {
    return prisma.product.update({
      where: { id },
      data
    });
  }

  // 5. Restar Stock (Muy útil para cuando confirmás una venta)
  async decreaseStock(id: number, quantity: number) {
    return prisma.product.update({
      where: { id },
      data: {
        stock: {
          decrement: quantity
        }
      }
    });
  }

  // 6. Eliminar producto
  async delete(id: number) {
    return prisma.product.delete({
      where: { id }
    });
  }
}