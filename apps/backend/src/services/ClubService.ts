import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
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

    // 👇 2. NUEVO MÉTODO AGREGADO (Para el Buscador Inteligente)
    async getClientsList(slug: string) {
        const club = await this.getClubBySlug(slug);
        
        const bookings = await prisma.booking.findMany({
            where: {
                court: { clubId: club.id },
                status: { not: 'CANCELLED' }
            },
            select: {
                guestName: true,
                guestPhone: true,
                guestDni: true,
                user: { 
                    select: {
                        firstName: true,
                        lastName: true,
                        phoneNumber: true
                        // ❌ dni: true  <-- BORRAMOS ESTO PORQUE NO EXISTE EN 'User'
                    }
                }
            },
            orderBy: { startDateTime: 'desc' }
        });

        const uniqueClients = new Map();

        bookings.forEach(b => {
            const name = b.user ? `${b.user.firstName} ${b.user.lastName}` : b.guestName;
            const phone = b.user ? b.user.phoneNumber : b.guestPhone;
            
            // 👇 CAMBIO: Solo buscamos el DNI si es un invitado (guestDni)
            // Si el usuario registrado no tiene campo DNI, entonces es undefined.
            const dni = b.guestDni; 

            if (name) {
                // Si tiene DNI usamos ese, sino usamos el Nombre como clave
                const key = dni ? `dni_${dni}` : `name_${name.toLowerCase().trim()}`;

                if (!uniqueClients.has(key)) {
                    uniqueClients.set(key, {
                        firstName: name,
                        lastName: '', 
                        phone: phone,
                        dni: dni
                    });
                }
            }
        });

        return Array.from(uniqueClients.values());
    }
}