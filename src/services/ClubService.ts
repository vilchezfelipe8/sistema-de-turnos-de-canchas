import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
import { Court } from '../entities/Court';

export class ClubService {
    constructor(
        private clubRepo: ClubRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    // Crea un club nuevo
    async createClub(name: string, address: string, contact: string) {
        const club = new Club(0, name, address, contact);
        return await this.clubRepo.saveClub(club);
    }

    // Crea una cancha y le asigna actividades permitidas (ej: Tenis, Padel)
    async registerCourt(clubId: number, name: string, surface: string, activityIds: number[]) {
        const clubs = await this.clubRepo.findAllClubs();
        const club = clubs.find(c => c.id === clubId);
        
        if (!club) throw new Error("Club no encontrado");

        const court = new Court(0, name, false, surface, club);
        
        // Buscamos las actividades y se las agregamos a la cancha
        for (const actId of activityIds) {
            const activity = await this.activityRepo.findById(actId);
            if (activity) {
                court.supportedActivities.push(activity);
            }
        }

        return await this.clubRepo.saveCourt(court);
    }
}