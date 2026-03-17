import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
import type { FixedBookingSettingsByActivity } from '../entities/Club';
import { Court } from '../entities/Court';
import { Prisma } from '@prisma/client';

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
        professorDurationOverrideEnabled: boolean = true,
        professorDurationOverrideMinutes: number = 60,
        fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null,
        bookingConfirmationMode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED' = 'MANUAL',
        bookingDepositPercent?: number | null,
        allowManualConfirmationOverride: boolean = true,
        autoCancelPendingBookingsEnabled: boolean = false,
        autoCancelPendingBookingsMinutesBefore?: number | null,
        autoCancelPendingBookingsOnlyIfUnpaid: boolean = true,
        autoCancelPendingWarningEnabled: boolean = false,
        autoCancelPendingWarningMinutesBefore?: number | null,
        enforceCashShiftCloseWithOpenAccounts: boolean = false,
        bookingSimpleAdvanceDaysUser: number = 30,
        bookingSimpleAdvanceDaysAdmin: number = 30,
        allowAdminSkipSimpleAdvanceLimit: boolean = false,
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
            professorDurationOverrideEnabled,
            professorDurationOverrideMinutes,
            fixedBookingSettingsByActivity,
            bookingConfirmationMode,
            bookingDepositPercent,
            allowManualConfirmationOverride,
            autoCancelPendingBookingsEnabled,
            autoCancelPendingBookingsMinutesBefore,
            autoCancelPendingBookingsOnlyIfUnpaid,
            autoCancelPendingWarningEnabled,
            autoCancelPendingWarningMinutesBefore,
            enforceCashShiftCloseWithOpenAccounts,
            bookingSimpleAdvanceDaysUser,
            bookingSimpleAdvanceDaysAdmin,
            allowAdminSkipSimpleAdvanceLimit,
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
            professorDurationOverrideEnabled?: boolean;
            professorDurationOverrideMinutes?: number;
            fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
            bookingConfirmationMode?: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
            bookingDepositPercent?: number | null;
            allowManualConfirmationOverride?: boolean;
            autoCancelPendingBookingsEnabled?: boolean;
            autoCancelPendingBookingsMinutesBefore?: number | null;
            autoCancelPendingBookingsOnlyIfUnpaid?: boolean;
            autoCancelPendingWarningEnabled?: boolean;
            autoCancelPendingWarningMinutesBefore?: number | null;
            enforceCashShiftCloseWithOpenAccounts?: boolean;
            bookingSimpleAdvanceDaysUser?: number;
            bookingSimpleAdvanceDaysAdmin?: number;
            allowAdminSkipSimpleAdvanceLimit?: boolean;
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

    async getClients(clubId: number, query?: string) {
        const search = (query || '').trim();
        const prismaAny = prisma as any;
        const clients: any[] = await prismaAny.client.findMany({
            where: {
                clubId,
                ...(search
                    ? {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' } },
                            { phone: { contains: search, mode: 'insensitive' } },
                            { dni: { contains: search, mode: 'insensitive' } },
                            { email: { contains: search, mode: 'insensitive' } }
                        ]
                    }
                    : {})
            },
            orderBy: { createdAt: 'desc' }
        });

        return clients.map((client) => ({
            id: client.id,
            firstName: client.name,
            lastName: '',
            phoneNumber: client.phone || '',
            email: client.email || '',
            dni: client.dni || '',
            isProfessor: Boolean(client.isProfessor)
        }));
    }

    async createClient(clubId: number, input: {
        name: string;
        phone?: string | null;
        dni?: string | null;
        email?: string | null;
        isProfessor?: boolean;
    }) {
        const normalizedName = String(input.name || '').trim();
        const normalizedPhone = String(input.phone || '').replace(/\D/g, '');
        const normalizedDni = String(input.dni || '').replace(/\D/g, '');
        const normalizedEmail = String(input.email || '').trim().toLowerCase();

        if (normalizedName.length < 2) throw new Error('Nombre inválido');
        if (normalizedPhone && normalizedPhone.length < 7) throw new Error('Teléfono inválido');
        if (normalizedDni && normalizedDni.length < 6) throw new Error('DNI inválido');

        try {
            return await prisma.client.create({
                data: {
                    clubId,
                    name: normalizedName,
                    phone: normalizedPhone || null,
                    dni: normalizedDni || null,
                    email: normalizedEmail || null,
                    isProfessor: Boolean(input.isProfessor)
                }
            });
        } catch (error: any) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new Error('Ya existe un cliente con ese DNI, teléfono o email');
            }
            throw error;
        }
    }

    async updateClient(clubId: number, clientId: string, input: {
        name: string;
        phone?: string | null;
        dni?: string | null;
        email?: string | null;
        isProfessor?: boolean;
    }) {
        const existing = await prisma.client.findFirst({ where: { id: clientId, clubId } });
        if (!existing) throw new Error('Cliente no encontrado');

        const normalizedName = String(input.name || '').trim();
        const normalizedPhone = String(input.phone || '').replace(/\D/g, '');
        const normalizedDni = String(input.dni || '').replace(/\D/g, '');
        const normalizedEmail = String(input.email || '').trim().toLowerCase();

        if (normalizedName.length < 2) throw new Error('Nombre inválido');
        if (normalizedPhone && normalizedPhone.length < 7) throw new Error('Teléfono inválido');
        if (normalizedDni && normalizedDni.length < 6) throw new Error('DNI inválido');

        try {
            return await prisma.client.update({
                where: { id: clientId },
                data: {
                    name: normalizedName,
                    phone: normalizedPhone || null,
                    dni: normalizedDni || null,
                    email: normalizedEmail || null,
                    isProfessor: Boolean(input.isProfessor)
                }
            });
        } catch (error: any) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new Error('Ya existe un cliente con ese DNI, teléfono o email');
            }
            throw error;
        }
    }

    async deleteClient(clubId: number, clientId: string) {
        const existing = await prisma.client.findFirst({ where: { id: clientId, clubId } });
        if (!existing) throw new Error('Cliente no encontrado');

        const hasLinkedBookings = await prisma.booking.count({ where: { clubId, clientId } });
        if (hasLinkedBookings > 0) {
            throw new Error('No se puede eliminar: el cliente tiene reservas asociadas');
        }

        await prisma.client.delete({ where: { id: clientId } });
    }
}
