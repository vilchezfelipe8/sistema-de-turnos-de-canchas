import { ClubRepository } from '../repositories/ClubRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Club } from '../entities/Club';
import type { ClubOperationalStatus, FixedBookingSettingsByActivity } from '../entities/Club';
import { Court } from '../entities/Court';
import { Prisma } from '@prisma/client';
import { normalizeEmail } from '../utils/magicLink';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { ErrorCodes, badRequest, conflict, forbidden, notFound } from '../errors';
import { PersonService, type PersonSearchResult } from './PersonService';

// 👇 1. USAMOS TUS IMPORTS CORRECTOS
import { prisma } from '../prisma'; 

export class ClubService {
    private readonly personService = new PersonService();

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
        closureDates?: string[] | null,
        openingDays?: number[] | null,
        clubOperationalStatus: ClubOperationalStatus = 'OPEN',
        temporaryClosureStartDate?: string | null,
        temporaryClosureEndDate?: string | null
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
            closureDates,
            openingDays,
            clubOperationalStatus,
            temporaryClosureStartDate,
            temporaryClosureEndDate
        );
    }

    async getClubById(id: number): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);
        return club;
    }

    async getClubBySlug(slug: string): Promise<Club> {
        const club = await this.clubRepo.findClubBySlug(slug);
        if (!club) throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);
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
            closureDates?: string[] | null;
            openingDays?: number[] | null;
            clubOperationalStatus?: ClubOperationalStatus;
            temporaryClosureStartDate?: string | null;
            temporaryClosureEndDate?: string | null;
        }
    ): Promise<Club> {
        const club = await this.clubRepo.findClubById(id);
        if (!club) throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);
        return await this.clubRepo.updateClub(id, data);
    }

    async registerCourt(clubId: number, name: string, surface: string, activityTypeId: number | number[]) {
        const club = await this.clubRepo.findClubById(clubId);
        if (!club) throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);

        const normalizedActivityTypeId = Array.isArray(activityTypeId)
            ? Number(activityTypeId[0])
            : Number(activityTypeId);
        if (!Number.isInteger(normalizedActivityTypeId) || normalizedActivityTypeId <= 0) {
            throw badRequest('Actividad inválida', ErrorCodes.INVALID_INPUT);
        }

        const activity = await this.activityRepo.findById(normalizedActivityTypeId);
        if (!activity) throw notFound('Actividad no encontrada', ErrorCodes.ACTIVITY_NOT_FOUND);
        if (activity.clubId && Number(activity.clubId) !== Number(clubId)) {
            throw forbidden('La actividad no pertenece a este club', ErrorCodes.ACTIVITY_OUT_OF_CLUB);
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

        return this.dedupeClientSearchRows(clients).map((client) => ({
            id: client.id,
            name: client.name,
            phone: client.phone || '',
            email: client.email || '',
            dni: client.dni || '',
            isProfessor: Boolean(client.isProfessor)
        }));
    }

    async searchParticipants(clubId: number, query?: string) {
        const search = String(query || '').trim();
        if (!search) return [];
        const rows = await this.personService.searchPeople(clubId, search);
        return rows
            .filter((row) => row.kind !== 'newClientSuggestion')
            .map((row) => ({
                id: row.kind === 'systemUser' ? `user-${row.userId}` : `client-${row.clientId}`,
                name: row.displayName,
                phone: String(row.phone || '').trim(),
                email: String(row.email || '').trim(),
                dni: String(row.dni || '').trim(),
                isProfessor: false,
                sourceType: row.kind === 'systemUser' ? ('systemUser' as const) : ('clubClient' as const),
                userId: row.userId ?? null
            }))
            .slice(0, 8);
    }

    async searchPeople(clubId: number, query?: string): Promise<PersonSearchResult[]> {
        return this.personService.searchPeople(clubId, query);
    }

    private dedupeClientSearchRows(rows: any[]) {
        const seenIds = new Set<string>();
        const deduped: any[] = [];

        for (const row of Array.isArray(rows) ? rows : []) {
            const id = String(row?.id || '').trim();
            if (!id) continue;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            deduped.push(row);
        }

        return deduped;
    }

    private buildClientCreateLockKey(input: {
        clubId: number;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
    }) {
        const fragments = [
            `club:${Number(input.clubId || 0)}`,
            normalizeEmail(String(input.email || '')) ? `email:${normalizeEmail(String(input.email || ''))}` : null,
            String(input.phone || '').trim() ? `phone:${String(input.phone).trim()}` : null,
            String(input.dni || '').trim() ? `dni:${String(input.dni).trim()}` : null,
        ].filter(Boolean);
        return fragments.join('|') || `club:${Number(input.clubId || 0)}|anonymous`;
    }

    private async acquireClientCreateLockTx(
        tx: Prisma.TransactionClient,
        input: {
            clubId: number;
            phone?: string | null;
            email?: string | null;
            dni?: string | null;
        }
    ) {
        const key = this.buildClientCreateLockKey(input);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    private async findDuplicateClientCandidatesTx(
        tx: Prisma.TransactionClient,
        input: {
            clubId: number;
            phone?: string | null;
            email?: string | null;
            dni?: string | null;
        }
    ) {
        const phone = String(input.phone || '').trim();
        const email = normalizeEmail(String(input.email || ''));
        const dni = String(input.dni || '').trim();
        const phoneVariants = phone ? getPhoneIdentityVariants(phone) : [];
        const or: Prisma.ClientWhereInput[] = [];
        if (dni) or.push({ dni });
        if (email) or.push({ email });
        if (phoneVariants.length > 0) or.push({ phone: { in: phoneVariants } });
        if (or.length === 0) {
            return {
                matches: [] as Array<{
                    id: string;
                    name: string;
                    phone: string | null;
                    email: string | null;
                    dni: string | null;
                    userId: number | null;
                    matchedBy: string[];
                }>,
                signals: [] as string[]
            };
        }

        const rows = await tx.client.findMany({
            where: {
                clubId: Number(input.clubId),
                OR: or
            },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                dni: true,
                userId: true,
                createdAt: true
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });

        const matches = rows.map((row) => {
            const matchedBy: string[] = [];
            if (dni && String(row.dni || '').trim() === dni) matchedBy.push('DNI');
            if (email && normalizeEmail(String(row.email || '')) === email) matchedBy.push('EMAIL');
            if (
                phone &&
                String(row.phone || '').trim() &&
                getPhoneIdentityVariants(String(row.phone || '').trim()).some((variant) => phoneVariants.includes(variant))
            ) {
                matchedBy.push('PHONE');
            }
            return {
                id: String(row.id),
                name: String(row.name || '').trim() || 'Cliente sin nombre',
                phone: row.phone || null,
                email: row.email || null,
                dni: row.dni || null,
                userId: Number(row.userId || 0) > 0 ? Number(row.userId) : null,
                matchedBy
            };
        });

        const signals = Array.from(
            new Set(
                matches
                    .flatMap((row) => row.matchedBy)
                    .filter((value) => value === 'DNI' || value === 'EMAIL' || value === 'PHONE')
            )
        );

        return { matches, signals };
    }

    async createClient(clubId: number, input: {
        name: string;
        phone?: string | null;
        dni?: string | null;
        email?: string | null;
        isProfessor?: boolean;
        forceCreateNew?: boolean;
    }) {
        const club = await prisma.club.findUnique({
            where: { id: clubId },
            select: { country: true }
        });
        const normalizedName = String(input.name || '').trim();
        const normalizedPhone = normalizeIdentityPhone(
            { phone: input.phone ?? null },
            { defaultCountryIso2: String(club?.country || '').trim() || null }
        );
        const normalizedDni = String(input.dni || '').replace(/\D/g, '');
        const normalizedEmail = String(input.email || '').trim().toLowerCase();

        if (normalizedName.length < 2) throw badRequest('Nombre inválido', ErrorCodes.INVALID_INPUT);
        if (!normalizedPhone) throw badRequest('El teléfono es obligatorio', ErrorCodes.INVALID_INPUT);
        // Fase 1.2: email es opcional en CRUD admin.
        if (normalizedDni && normalizedDni.length < 6) throw badRequest('DNI inválido', ErrorCodes.INVALID_INPUT);

        try {
            return await prisma.$transaction(async (tx) => {
                await this.acquireClientCreateLockTx(tx, {
                    clubId,
                    phone: normalizedPhone,
                    email: normalizedEmail,
                    dni: normalizedDni
                });

                const duplicates = await this.findDuplicateClientCandidatesTx(tx, {
                    clubId,
                    phone: normalizedPhone,
                    email: normalizedEmail,
                    dni: normalizedDni
                });

                if (duplicates.matches.length > 0 && !input.forceCreateNew) {
                    throw conflict(
                        'Ya existen clientes con datos similares. Revisá antes de crear uno nuevo.',
                        ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
                        {
                            primaryClientId: duplicates.matches[0]?.id || null,
                            candidateClientIds: duplicates.matches.map((row) => row.id),
                            candidates: duplicates.matches.map((row) => ({
                                id: row.id,
                                name: row.name,
                                phone: row.phone,
                                email: row.email,
                                dni: row.dni,
                                userId: row.userId
                            })),
                            signals: duplicates.signals,
                            reasonType: duplicates.signals.length === 1 ? duplicates.signals[0] : 'MULTI_SIGNAL_CONFLICT'
                        }
                    );
                }

                return tx.client.create({
                    data: {
                        clubId,
                        name: normalizedName,
                        phone: normalizedPhone,
                        dni: normalizedDni || null,
                        email: normalizedEmail || null,
                        isProfessor: Boolean(input.isProfessor)
                    }
                });
            });
        } catch (error: any) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw conflict('Ya existe un cliente con ese DNI, teléfono o email', ErrorCodes.CONFLICT);
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
        if (!existing) throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);
        const club = await prisma.club.findUnique({
            where: { id: clubId },
            select: { country: true }
        });

        const normalizedName = String(input.name || '').trim();
        const normalizedPhone = normalizeIdentityPhone(
            { phone: input.phone ?? null },
            { defaultCountryIso2: String(club?.country || '').trim() || null }
        );
        const normalizedDni = String(input.dni || '').replace(/\D/g, '');
        const normalizedEmail = String(input.email || '').trim().toLowerCase();

        if (normalizedName.length < 2) throw badRequest('Nombre inválido', ErrorCodes.INVALID_INPUT);
        if (!normalizedPhone) throw badRequest('El teléfono es obligatorio', ErrorCodes.INVALID_INPUT);
        // Fase 1.2: email es opcional en CRUD admin.
        if (normalizedDni && normalizedDni.length < 6) throw badRequest('DNI inválido', ErrorCodes.INVALID_INPUT);

        try {
            return await prisma.client.update({
                where: { id: clientId },
                data: {
                    name: normalizedName,
                    phone: normalizedPhone,
                    dni: normalizedDni || null,
                    email: normalizedEmail || null,
                    isProfessor: Boolean(input.isProfessor)
                }
            });
        } catch (error: any) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw conflict('Ya existe un cliente con ese DNI, teléfono o email', ErrorCodes.CONFLICT);
            }
            throw error;
        }
    }

    async deleteClient(clubId: number, clientId: string) {
        const existing = await prisma.client.findFirst({ where: { id: clientId, clubId } });
        if (!existing) throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);

        const hasLinkedBookings = await prisma.booking.count({ where: { clubId, clientId } });
        if (hasLinkedBookings > 0) {
            throw conflict('No se puede eliminar: el cliente tiene reservas asociadas', ErrorCodes.CONFLICT);
        }

        await prisma.client.delete({ where: { id: clientId } });
    }
}
