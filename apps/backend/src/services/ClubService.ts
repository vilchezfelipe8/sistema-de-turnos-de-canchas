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
        lightsEnabled: boolean = false,
        lightsExtraAmount?: number | null,
        lightsFromHour?: string | null,
        professorDiscountEnabled: boolean = false,
        professorDiscountPercent?: number | null,
        scheduleMode?: string,
        scheduleOpenTime?: string | null,
        scheduleCloseTime?: string | null,
        scheduleIntervalMinutes?: number | null,
        scheduleDurations?: number[] | null,
        scheduleFixedSlots?: string[] | null,
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
            lightsEnabled,
            lightsExtraAmount,
            lightsFromHour,
            professorDiscountEnabled,
            professorDiscountPercent,
            scheduleMode,
            scheduleOpenTime,
            scheduleCloseTime,
            scheduleIntervalMinutes,
            scheduleDurations,
            scheduleFixedSlots,
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
            lightsEnabled?: boolean;
            lightsExtraAmount?: number | null;
            lightsFromHour?: string | null;
            professorDiscountEnabled?: boolean;
            professorDiscountPercent?: number | null;
            scheduleMode?: string;
            scheduleOpenTime?: string | null;
            scheduleCloseTime?: string | null;
            scheduleIntervalMinutes?: number | null;
            scheduleDurations?: number[] | null;
            scheduleFixedSlots?: string[] | null;
            fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
            openingDays?: number[] | null;
        }
    ): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw new Error("Club no encontrado");
        return await this.clubRepo.updateClub(id, data);
    }

    async registerCourt(clubId: number, name: string, surface: string, activityIds: number[]) {
        const club = await this.clubRepo.findClubById(clubId);
        if (!club) throw new Error("Club no encontrado");

    const court = new Court(0, name, false, surface, club, false, null);

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
    const bookings: any[] = await prisma.booking.findMany({
        where: {
            court: { clubId: clubId },
        },
        select: {
            guestName: true,
            guestPhone: true,
            guestDni: true,
            user: {
                select: {
                    firstName: true,
                    lastName: true,
                    phoneNumber: true,
                    isProfessor: true,
                    dni: true 
                }
            }
        },
        orderBy: { startDateTime: 'desc' }
    } as any);

    const uniqueClients = new Map();

    bookings.forEach(b => {
        // Lógica para decidir si es User o Guest
        const name = b.user ? `${b.user.firstName} ${b.user.lastName}` : b.guestName;
        const phone = b.user ? b.user.phoneNumber : b.guestPhone;
        
        // 👉 2. PRIORIZAMOS EL DNI DEL USUARIO, Y SI NO HAY, USAMOS EL DEL INVITADO
        const dni = b.user?.dni || b.guestDni; 

        if (name) {
            // Usamos DNI como clave única si existe, sino el nombre
            const key = dni ? `dni_${dni}` : `name_${name.toLowerCase().trim()}`;

            if (!uniqueClients.has(key)) {
                uniqueClients.set(key, {
                    // Mapeamos para que el Frontend lo entienda
                    firstName: name, 
                    lastName: '', 
                    phoneNumber: phone, 
                    dni: dni, // ¡Ahora sí viaja el correcto!
                    isProfessor: b.user?.isProfessor ?? false
                });
            }
        }
    });

    return Array.from(uniqueClients.values());
}
}