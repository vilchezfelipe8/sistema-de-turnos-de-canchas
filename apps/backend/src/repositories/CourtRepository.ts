import { prisma } from '../prisma';

export class CourtRepository {

    async findById(id: number) {
        const court = await prisma.court.findUnique({
            where: { id: id },
            include: { club: true, activities: true }
        });
        return court;
    }

    async findAll(clubId?: number) {
        if (clubId) {
            const courts = await prisma.court.findMany({
                where: { clubId },
                include: { club: true, activities: true }
            });
            return courts;
        }
        const courts = await prisma.court.findMany({
            include: { club: true, activities: true }
        });
        return courts;
    }

    async deleteCourt(id: number) {
    return await prisma.court.update({
        where: { id },
        data: { isUnderMaintenance: true } // Solo la ocultamos
    });
}
}