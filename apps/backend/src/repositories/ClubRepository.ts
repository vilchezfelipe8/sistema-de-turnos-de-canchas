import { prisma } from '../prisma';
import { Club } from '../entities/Club';
import { Court } from '../entities/Court';
import { ActivityType } from '../entities/ActivityType';

export class ClubRepository {

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
        professorDiscountPercent?: number | null
    ): Promise<Club> {
        const location = await this.ensureLocation(city, province, country);
        const data: any = {
            slug,
            name,
            addressLine,
            city,
            province,
            country,
            locationId: location.id,
            contactInfo: contact,
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
            professorDiscountPercent
        };

        const saved = await prisma.club.create({ data });
        return this.mapToClub(saved);
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
        const club = this.mapToClub(saved.club);
        
    const newCourt = new Court(saved.id, saved.name, saved.isIndoor, saved.surface, club, saved.isUnderMaintenance, null);
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
        const club = this.mapToClub(found.club);
        
    const court = new Court(found.id, found.name, found.isIndoor, found.surface, club, found.isUnderMaintenance, null);
        court.supportedActivities = activities;
        return court;
    }

    // Método extra necesario para que compile el servicio
    async saveClub(club: Club): Promise<Club> {
        return this.createClub(
            club.slug,
            club.name, 
            club.addressLine,
            club.city,
            club.province,
            club.country,
            club.contactInfo,
            club.phone,
            club.logoUrl,
            club.clubImageUrl,
            club.instagramUrl,
            club.facebookUrl,
            club.websiteUrl,
            club.description,
            club.lightsEnabled,
            club.lightsExtraAmount ?? null,
            club.lightsFromHour ?? null,
            club.professorDiscountEnabled ?? false,
            club.professorDiscountPercent ?? null
        );
    }
    
    async findAllClubs(): Promise<Club[]> {
        const all = await prisma.club.findMany();
        return all.map(c => this.mapToClub(c));
    }

    async findClubById(id: number): Promise<Club | undefined> {
        const found = await prisma.club.findUnique({
            where: { id }
        });
        if (!found) return undefined;
        return this.mapToClub(found);
    }

    async findClubBySlug(slug: string): Promise<Club | undefined> {
        const found = await prisma.club.findUnique({
            where: { slug }
        });
        if (!found) return undefined;
        return this.mapToClub(found);
    }

    async updateClub(id: number, data: {
        slug?: string;
        name?: string;
        addressLine?: string;
        city?: string;
        province?: string;
        country?: string;
        locationId?: number | null;
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
    }): Promise<Club> {
        if (data.city && data.province && data.country) {
            const location = await this.ensureLocation(data.city, data.province, data.country);
            data.locationId = location.id;
        }
        const updated = await prisma.club.update({
            where: { id },
            data: data as any
        });
        return this.mapToClub(updated);
    }

    private mapToClub(dbClub: any): Club {
        return new Club(
            dbClub.id,
            dbClub.slug,
            dbClub.name,
            dbClub.addressLine,
            dbClub.city,
            dbClub.province,
            dbClub.country,
            dbClub.contactInfo,
            dbClub.phone || undefined,
            dbClub.logoUrl || undefined,
            dbClub.clubImageUrl || undefined,
            dbClub.instagramUrl || undefined,
            dbClub.facebookUrl || undefined,
            dbClub.websiteUrl || undefined,
            dbClub.description || undefined,
            dbClub.lightsEnabled ?? false,
            dbClub.lightsExtraAmount ?? null,
            dbClub.lightsFromHour ?? null,
            dbClub.professorDiscountEnabled ?? false,
            dbClub.professorDiscountPercent ?? null,
            dbClub.createdAt,
            dbClub.updatedAt
        );
    }

    private async ensureLocation(city: string, province: string, country: string) {
        return await prisma.location.upsert({
            where: {
                city_province_country: { city, province, country }
            },
            update: {},
            create: { city, province, country }
        });
    }
    async findBySlug(slug: string) {
        return await prisma.club.findUnique({
            where: { slug }
        });
    }
}

