import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
import type { FixedBookingSettingsByActivity } from '../entities/Club';
import { Court } from '../entities/Court';

// 👇 1. USAMOS TUS IMPORTS CORRECTOS
import { prisma } from '../prisma'; 

export class ClubService {
    constructor(
        private clubRepo: ClubRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    async createClub(
        slug: string,
        name: string, 
        addressLine: string,
        city: string,
        province: string,
        country: string,
        contact: string,
        phone?: string,
        logoUrl?: string,
    clubImageUrl?: string,
        instagramUrl?: string,
        facebookUrl?: string,
        websiteUrl?: string,
        description?: string,
        timeZone: string = 'America/Argentina/Buenos_Aires',
        lightsEnabled: boolean = false,
        lightsExtraAmount?: number | null,
        lightsFromHour?: string | null,
        professorDiscountEnabled: boolean = false,
        professorDiscountPercent?: number | null,
        fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null
        ,
        openingDays?: number[] | null
    ) {
        return await this.clubRepo.createClub(
            slug,
            name, 
            addressLine,
            city,
            province,
            country,
            contact,
            phone,
            logoUrl,
            clubImageUrl,
            instagramUrl,
            facebookUrl,
            websiteUrl,
            description,
            timeZone,
            lightsEnabled,
            lightsExtraAmount,
            lightsFromHour,
            professorDiscountEnabled,
            professorDiscountPercent,
            fixedBookingSettingsByActivity
            ,
            openingDays
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
            addressLine?: string;
            city?: string;
            province?: string;
            country?: string;
            contactInfo?: string;
            phone?: string | null;
            logoUrl?: string | null;
            clubImageUrl?: string | null;
            instagramUrl?: string | null;
            facebookUrl?: string | null;
            websiteUrl?: string | null;
            description?: string | null;
            timeZone?: string;
            lightsEnabled?: boolean;
            lightsExtraAmount?: number | null;
            lightsFromHour?: string | null;
            professorDiscountEnabled?: boolean;
            professorDiscountPercent?: number | null;
            fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
            openingDays?: number[] | null;
        }
    ): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw new Error("Club no encontrado");
        return await this.clubRepo.updateClub(id, data);
    }

    async registerCourt(clubId: number, name: string, surface: string, activityTypeId: number | number[]) {
        const club = await this.clubRepo.findClubById(clubId);
        if (!club) throw new Error("Club no encontrado");

        const normalizedActivityTypeId = Array.isArray(activityTypeId)
            ? Number(activityTypeId[0])
            : Number(activityTypeId);
        if (!Number.isInteger(normalizedActivityTypeId) || normalizedActivityTypeId <= 0) {
            throw new Error("Actividad inválida");
        }

        const activity = await this.activityRepo.findById(normalizedActivityTypeId);
        if (!activity) throw new Error("Actividad no encontrada");
        if (activity.clubId && Number(activity.clubId) !== Number(clubId)) {
            throw new Error("La actividad no pertenece a este club");
        }

        const court = new Court(0, name, false, surface, club, false, activity);

        return await this.clubRepo.saveCourt(court);
    }

    async getClients(clubId: number) {
        const prismaAny = prisma as any;
        const clients: any[] = await prismaAny.client.findMany({
            where: { clubId },
            orderBy: { createdAt: 'desc' }
        });

        return clients.map((client) => ({
            id: client.id,
            firstName: client.name,
            lastName: '',
            phoneNumber: client.phone || '',
            email: client.email || '',
            dni: client.dni || '',
            isProfessor: false
        }));
    }
}