import { prisma } from '../prisma';
import { ActivityType } from '../entities/ActivityType';

export class ActivityTypeRepository {
    
    async save(activity: ActivityType): Promise<ActivityType> {
        // Usamos 'upsert' para que si ya existe la actividad (ej: Tenis ID 1), no intente crearla de nuevo
        // Esto evita errores cuando reinicias el servidor
        const saved = await prisma.activityType.upsert({
            where: { id: activity.id === 0 ? -1 : activity.id }, // Truco: si es 0, busca ID inexistente para crear
            update: {}, // Si existe, no hacemos nada
            create: {
                name: activity.name,
                description: activity.description,
                defaultDurationMinutes: activity.defaultDurationMinutes
            }
        });

        return new ActivityType(saved.id, saved.name, saved.description, saved.defaultDurationMinutes);
    }

    async findById(id: number): Promise<ActivityType | undefined> {
        const found = await prisma.activityType.findUnique({ where: { id } });
        if (!found) return undefined;
        return new ActivityType(found.id, found.name, found.description, found.defaultDurationMinutes);
    }
}