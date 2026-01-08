import { prisma } from '../prisma';

export class CourtRepository {

    async findById(id: number) {
        const court = await prisma.court.findUnique({
            where: { id: id }
        });
        return court;
    }

    async findAll() {
        const courts = await prisma.court.findMany();
        return courts;
    }

    async deleteCourt(id: number) {
    return await prisma.court.update({
        where: { id },
        data: { isUnderMaintenance: true } // Solo la ocultamos
    });
}
}