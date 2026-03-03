import { prisma } from '../prisma'; // Ajusta la ruta a tu cliente prisma

export class CashRepository {
    async create(data: any) {
        // 1. Desestructuramos para sacar los IDs y dejar los datos limpios en 'rest'
        const { bookingId, clubId, userId, ...rest } = data;

        // 2. Armamos el objeto de Prisma limpio
        const prismaData: any = {
            ...rest,
            ...(bookingId ? { booking: { connect: { id: Number(bookingId) } } } : {}),
            ...(clubId ? { club: { connect: { id: Number(clubId) } } } : {}),
            ...(userId ? { user: { connect: { id: Number(userId) } } } : {})
        };

        // 3. Guardamos usando los datos dinámicos
        return prisma.cashMovement.create({ data: prismaData });
    }

    async findAllByDateRange(startDate: Date, endDate: Date, clubId?: number) {
        return prisma.cashMovement.findMany({
            where: {
                date: {
                    gte: startDate,
                    lte: endDate
                },
                ...(clubId ? { clubId } : {})
            },
            orderBy: { date: 'desc' }
        });
    }
}