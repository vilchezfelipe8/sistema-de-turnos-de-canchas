import { prisma } from '../../prisma';
import { Club } from '../../entities/Club';
import { Court } from '../../entities/Court';
import { ActivityType } from '../../entities/ActivityType';

export class ClubRepository {

    async createClub(name: string, address: string, contact: string): Promise<Club> {
        const saved = await prisma.club.create({
            data: { name, address, contactInfo: contact }
        });
        return new Club(saved.id, saved.name, saved.address, saved.contactInfo);
    }

    async saveCourt(court: Court): Promise<Court> {
        const saved = await prisma.court.create({
            data: {
                name: court.name,
                isIndoor: court.isIndoor,
                surface: court.surface,
                isUnderMaintenance: court.isUnderMaintenance,
                club: { connect: { id: court.club.id } },
                activities: {
                    connect: court.supportedActivities.map(a => ({ id: a.id }))
                }
            },
            include: { club: true, activities: true }
        });

        const activities = saved.activities.map(a => new ActivityType(a.id, a.name, a.description, a.defaultDurationMinutes));
        const club = new Club(saved.club.id, saved.club.name, saved.club.address, saved.club.contactInfo);
        
        const newCourt = new Court(saved.id, saved.name, saved.isIndoor, saved.surface, club, saved.isUnderMaintenance);
        newCourt.supportedActivities = activities;
        
        return newCourt;
    }

    async findCourtById(id: number): Promise<Court | undefined> {
        const found = await prisma.court.findUnique({
            where: { id },
            include: { club: true, activities: true }
        });

        if (!found) return undefined;

        const activities = found.activities.map(a => new ActivityType(a.id, a.name, a.description, a.defaultDurationMinutes));
        const club = new Club(found.club.id, found.club.name, found.club.address, found.club.contactInfo);
        
        const court = new Court(found.id, found.name, found.isIndoor, found.surface, club, found.isUnderMaintenance);
        court.supportedActivities = activities;
        return court;
    }

    // Método extra necesario para que compile el servicio
    async saveClub(club: Club): Promise<Club> {
        return this.createClub(club.name, club.address, club.contactInfo);
    }
    
    async findAllClubs(): Promise<Club[]> {
        const all = await prisma.club.findMany();
        return all.map(c => new Club(c.id, c.name, c.address, c.contactInfo));
    }
}

