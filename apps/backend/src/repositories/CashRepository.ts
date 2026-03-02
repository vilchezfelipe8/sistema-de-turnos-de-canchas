import { prisma } from '../prisma'; // Ajusta la ruta a tu cliente prisma

export class CashRepository {
    async create(data: any) {
        // 1. Desestructuramos para sacar los IDs
        const { bookingId, clubId, ...rest } = data;

        // 2. Armamos el objeto de Prisma limpio
        const prismaData = {
            ...rest, 
            
            // Si viene bookingId, conectamos la reserva
            ...(bookingId ? { booking: { connect: { id: Number(bookingId) } } } : {}),
            
            // Si viene clubId, conectamos el club
            ...(clubId ? { club: { connect: { id: Number(clubId) } } } : {})
        };

        // 3. Guardamos usando los datos dinámicos
        return prisma.cashMovement.create({
            data: prismaData
        });
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