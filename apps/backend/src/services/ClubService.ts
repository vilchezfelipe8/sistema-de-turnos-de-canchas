import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
import { Court } from '../entities/Court';

export class ClubService {
    constructor(
        private clubRepo: ClubRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    async createClub(
        slug: string,
        name: string, 
        address: string, 
        contact: string,
        phone?: string,
        logoUrl?: string,
        instagramUrl?: string,
        facebookUrl?: string,
        websiteUrl?: string,
        description?: string
    ) {
        return await this.clubRepo.createClub(
            slug,
            name, 
            address, 
            contact,
            phone,
            logoUrl,
            instagramUrl,
            facebookUrl,
            websiteUrl,
            description
        );
    }

    async getClubById(id: number): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw new Error("Club no encontrado");
        return club;
    }

    async getClubBySlug(slug: string): Promise<Club> {
        const club = await this.clubRepo.findClubBySlug(slug);
        if (!club) throw new Error("Club no encontrado");
        return club;
    }

    async getAllClubs(): Promise<Club[]> {
        return await this.clubRepo.findAllClubs();
    }

    async updateClub(
        id: number,
        data: {
            slug?: string;
            name?: string;
            address?: string;
            contactInfo?: string;
            phone?: string | null;
            logoUrl?: string | null;
            instagramUrl?: string | null;
            facebookUrl?: string | null;
            websiteUrl?: string | null;
            description?: string | null;
        }
    ): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw new Error("Club no encontrado");
        return await this.clubRepo.updateClub(id, data);
    }

    async registerCourt(clubId: number, name: string, surface: string, activityIds: number[]) {
        const club = await this.clubRepo.findClubById(clubId);
        if (!club) throw new Error("Club no encontrado");

        const court = new Court(0, name, false, surface, club);

        for (const actId of activityIds) {
            const activity = await this.activityRepo.findById(actId);
            if (activity) {
                court.supportedActivities.push(activity);
            }
        }

        return await this.clubRepo.saveCourt(court);
    }
}

