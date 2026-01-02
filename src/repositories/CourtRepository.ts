import { prisma } from '../prisma';

export class CourtRepository {

    // Buscar una cancha por su ID
    // Este método es el que usa tu Servicio para verificar que la cancha existe antes de reservar
    async findById(id: number) {
        const court = await prisma.court.findUnique({
            where: { id: id }
        });
        return court;
    }

    // Obtener todas las canchas (útil para listados)
    async findAll() {
        const courts = await prisma.court.findMany();
        return courts;
    }
}