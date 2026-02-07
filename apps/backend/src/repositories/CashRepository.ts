import { prisma } from '../prisma'; // Ajusta la ruta a tu cliente prisma

export class CashRepository {
    async create(data: any) {
        return prisma.cashMovement.create({ data });
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