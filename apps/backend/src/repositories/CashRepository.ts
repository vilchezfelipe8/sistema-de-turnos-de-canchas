import { prisma } from '../prisma'; // Ajusta la ruta a tu cliente prisma

export class CashRepository {
    async create(data: any) {
    // 1. Desestructuramos para sacar los IDs y dejar los datos limpios en 'rest'
    const { bookingId, clubId, ...rest } = data;

    // 2. Armamos el objeto de Prisma usando 'connect'
    const prismaData = {
        ...rest, // descripción, monto, fecha, método...

        // Conexión con la Reserva (si existe)
        booking: bookingId ? { connect: { id: Number(bookingId) } } : undefined,

        club: clubId ? { connect: { id: Number(clubId) } } : undefined
    };

    // 3. Guardamos
    return prisma.cashMovement.create({ 
        data: prismaData 
    });
}

    async findAllByDateRange(startDate: Date, endDate: Date) {
        return prisma.cashMovement.findMany({
            where: {
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            orderBy: { date: 'desc' }
        });
    }
}