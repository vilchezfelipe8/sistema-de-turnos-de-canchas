import { prisma } from '../prisma';

export class CourtRepository {

    async findById(id: number) {
        const include = { club: true, activities: true, activityType: true } as any;
        const court = await prisma.court.findUnique({
            where: { id: id },
            include
        });
        return court;
    }

    async findAll(clubId?: number) {
        if (clubId) {
            const include = { club: true, activities: true, activityType: true } as any;
            const courts = await prisma.court.findMany({
                where: { clubId },
                include
            });
            return courts;
        }
        const include = { club: true, activities: true, activityType: true } as any;
        const courts = await prisma.court.findMany({
            include
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