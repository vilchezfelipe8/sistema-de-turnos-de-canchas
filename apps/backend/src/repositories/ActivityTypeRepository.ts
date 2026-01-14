import { prisma } from '../prisma';
import { ActivityType } from '../entities/ActivityType';

export class ActivityTypeRepository {
    
    async save(activity: ActivityType): Promise<ActivityType> {
        const saved = await prisma.activityType.upsert({
            where: { id: activity.id === 0 ? -1 : activity.id },
            update: {},
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

