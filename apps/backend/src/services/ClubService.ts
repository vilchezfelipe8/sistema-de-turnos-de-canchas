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
        addressLine: string,
        city: string,
        province: string,
        country: string,
        contact: string,
        phone?: string,
        logoUrl?: string,
        instagramUrl?: string,
        facebookUrl?: string,
        websiteUrl?: string,
        description?: string,
        lightsEnabled: boolean = false,
        lightsExtraAmount?: number | null,
        lightsFromHour?: string | null
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
            instagramUrl,
            facebookUrl,
            websiteUrl,
            description,
            lightsEnabled,
            lightsExtraAmount,
            lightsFromHour
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
            instagramUrl?: string | null;
            facebookUrl?: string | null;
            websiteUrl?: string | null;
            description?: string | null;
            lightsEnabled?: boolean;
            lightsExtraAmount?: number | null;
            lightsFromHour?: string | null;
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
    async getClients(clubId: number) {
    
    // Buscamos todas las reservas de ese club (incluyendo CANCELLED para mantener historial)
    const bookings = await prisma.booking.findMany({
        where: {
            court: { clubId: clubId }, // Usamos el ID directo
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
                    // ✅ Perfecto borrar dni de acá si User no lo tiene en tu schema
                }
            }
        },
        orderBy: { startDateTime: 'desc' }
    });

    const uniqueClients = new Map();

    bookings.forEach(b => {
        // Lógica para decidir si es User o Guest
        const name = b.user ? `${b.user.firstName} ${b.user.lastName}` : b.guestName;
        const phone = b.user ? b.user.phoneNumber : b.guestPhone;
        
        // El DNI lo sacamos del guestDni (el de la reserva)
        const dni = b.guestDni; 

        if (name) {
            // Usamos DNI como clave única si existe, sino el nombre
            const key = dni ? `dni_${dni}` : `name_${name.toLowerCase().trim()}`;

            if (!uniqueClients.has(key)) {
                uniqueClients.set(key, {
                    // Mapeamos para que el Frontend lo entienda
                    firstName: name, // El front se encarga de separar nombre/apellido si viene junto
                    lastName: '', 
                    phoneNumber: phone, // Importante: usar 'phoneNumber' para que coincida con tu front
                    dni: dni
                });
            }
        }
    });

    return Array.from(uniqueClients.values());
}
}