import { BookingRepository } from '../repositories/BookingRepository';
import { ClubRepository } from '../repositories/ClubRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Booking } from '../entities/Booking';
//import { BookingStatus } from '../entities/Enums';
import { TimeHelper } from '../utils/TimeHelper';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma';
import { User } from '../entities/User';
import { Club } from '../entities/Club';
import { Court as CourtEntity } from '../entities/Court';
import { ActivityType } from '../entities/ActivityType';
import { BookingStatus, ChargeMode, Prisma, RefundReasonType } from '@prisma/client';
import { CashRepository } from '../repositories/CashRepository';
import { ProductRepository } from '../repositories/ProductRepository';
import { buildSlotsFromSchedule, normalizeSchedule } from '../utils/ActivityScheduleHelper';
import { getUserClubContext } from '../utils/getUserClubContext';
import { PricingService } from './PricingService';
import { EventService } from './EventService';
import { AuditLogService } from './AuditLogService';
import { AccountingService } from './AccountingService';
import { AccountService } from './AccountService';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';
import { ProjectionService } from './ProjectionService';
import { BookingDomainService } from './BookingDomainService';
import { getDepositRequiredAmount, isBookingTransitionAllowed, resolveInitialBookingStatus } from '../domain/bookingDomain';
import { RefundService } from './RefundService';
import { DiscountService } from './DiscountService';
import { generateDisplayCode } from '../utils/displayCode';
import { getPhoneIdentityVariants, normalizeIdentityPhone, toDialablePhoneNumber } from '../utils/phone';
import { recordUserClientLinkAuditTx } from './UserClientLinkAudit';

type CancelBookingReason = 'MANUAL' | 'AUTO_CANCEL_UNCONFIRMED';
type CancelBookingOptions = {
    reason?: CancelBookingReason;
    triggeredBy?: 'USER' | 'ADMIN' | 'SYSTEM';
    skipAccessValidation?: boolean;
    now?: Date;
    refund?: {
        amount?: number;
        executeNow?: boolean;
        reasonType?: RefundReasonType;
        executionNotes?: string;
    };
};
type CreateBookingOptions = {
    skipAccountCreation?: boolean;
    skipAdvanceLimit?: boolean;
    applyDiscount?: boolean;
    actorUserId?: number | null;
    clientId?: string | null;
    clientDraft?: {
        name: string;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
        /** Caso C: el admin confirmó crear un cliente nuevo aunque coincida con un existente */
        duplicateResolution?: 'CREATE_NEW' | null;
    } | null;
};

type CreateFixedBookingOptions = {
    userId?: number | null;
    clientId?: string | null;
    clientDraft?: {
        name: string;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
        /** Caso C: el admin confirmó crear un cliente nuevo aunque coincida con un existente */
        duplicateResolution?: 'CREATE_NEW' | null;
    } | null;
    clubId?: number;
    actorUserId?: number | null;
    allowOverlappingSeries?: boolean;
    durationMinutes?: number;
    weeksToGenerate?: number;
    everyDays?: number;
    repetitions?: number;
    previewConflictsOnly?: boolean;
};

type BookingPriceQuoteInput = {
    userId?: number | null;
    allowAdminBenefits?: boolean;
    clientId?: string | null;
    courtId: number;
    activityId: number;
    startDateTime: Date;
    durationMinutes?: number;
    clientEmail?: string;
    clientPhone?: string;
    clientDni?: string;
    applyDiscount?: boolean;
};

type BookingPriceQuote = {
    listPrice: number;
    finalPrice: number;
    discountAmount: number;
    hasDiscount: boolean;
    appliedPolicies: Array<{
        policyId: string;
        policyName: string;
        discountAmount: number;
    }>;
};

export type BookingBillingParticipantRef = string;

export type BookingBillingAssignmentDTO = {
    id: string;
    participantRef: BookingBillingParticipantRef;
    isChargeable: boolean;
    assignedAmount: number;
    participantLinkState?: 'ACTIVE' | 'ARCHIVED_REFERENCE';
};

export type BookingBillingConfigDTO = {
    bookingId: number;
    clubId: number;
    chargeMode: 'INDIVIDUAL' | 'SHARED';
    chargeResponsibleRef?: BookingBillingParticipantRef;
    assignments: BookingBillingAssignmentDTO[];
    metadata: {
        schemaVersion: 1;
        source: 'DEFAULTED' | 'PERSISTED';
    };
    updatedAt: string;
};

type UpsertBookingBillingConfigInput = {
    bookingId: number;
    clubId: number;
    actorUserId?: number | null;
    chargeMode: 'INDIVIDUAL' | 'SHARED';
    chargeResponsibleRef?: string | null;
    assignments: BookingBillingAssignmentDTO[];
    metadata?: Record<string, unknown> | null;
};

type PersistedBillingAssignmentsJson = {
    schemaVersion: 1;
    assignments: BookingBillingAssignmentDTO[];
};

export class BookingService {
    private readonly pricingService = new PricingService();
    private readonly eventService = new EventService();
    private readonly auditLogService = new AuditLogService();
    private readonly outboxService = new OutboxService();
    private readonly accountingService = new AccountingService();
    private readonly accountService = new AccountService();
    private readonly projectionService = new ProjectionService();
    private readonly bookingDomainService = new BookingDomainService();
    private readonly refundService = new RefundService();
    private readonly discountService = new DiscountService();

    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository,
        private cashRepository: CashRepository,
        private productRepository: ProductRepository
    ) {}

    async resolveClubIdForUser(userId: number, preferredClubId?: number) {
        const context = await getUserClubContext(userId, preferredClubId);
        return context.clubId;
    }

    async rescheduleBooking(input: {
        bookingId: number;
        clubId: number;
        courtId: number;
        startDateTime: Date;
        durationMinutes?: number;
        actorUserId?: number | null;
    }) {
        const booking = await prisma.booking.findFirst({
            where: { id: input.bookingId, clubId: input.clubId },
            include: { activity: true }
        });
        if (!booking) {
            throw new Error('Reserva no encontrada');
        }
        if (booking.status === 'CANCELLED') {
            throw new Error('No se puede mover una reserva cancelada');
        }
        if (booking.status === 'COMPLETED') {
            throw new Error('No se puede reprogramar una reserva completada.');
        }
        if (new Date(input.startDateTime).getTime() < Date.now()) {
            throw new Error('No se pueden reservar turnos en el pasado.');
        }

        const targetCourt = await prisma.court.findFirst({
            where: { id: input.courtId, clubId: input.clubId },
            include: { activityType: true }
        });
        if (!targetCourt) {
            throw new Error('Cancha destino inválida');
        }

        const durationFromRange = booking.endDateTime && booking.startDateTime
            ? Math.round((new Date(booking.endDateTime).getTime() - new Date(booking.startDateTime).getTime()) / 60000)
            : 0;
        const duration = Number(input.durationMinutes || durationFromRange || booking.activity?.defaultDurationMinutes || 60);
        const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 60;
        const endDateTime = new Date(input.startDateTime.getTime() + safeDuration * 60000);

        try {
            const updated = await prisma.$transaction(async (tx) => {
                const persisted = await tx.booking.update({
                    where: { id: input.bookingId },
                    data: {
                        courtId: targetCourt.id,
                        activityId: Number(targetCourt.activityTypeId || booking.activityId),
                        startDateTime: input.startDateTime,
                        endDateTime
                    },
                    include: {
                        user: true,
                        client: true,
                        court: { include: { club: { include: { settings: true } } } },
                        activity: true
                    }
                });

                await this.eventService.bookingRescheduled(input.clubId, {
                    bookingId: input.bookingId,
                    actorUserId: input.actorUserId ?? null,
                    previousCourtId: booking.courtId,
                    previousActivityId: booking.activityId,
                    previousStartDateTime: booking.startDateTime?.toISOString?.() || null,
                    previousEndDateTime: booking.endDateTime?.toISOString?.() || null,
                    courtId: targetCourt.id,
                    activityId: Number(targetCourt.activityTypeId || booking.activityId),
                    startDateTime: input.startDateTime?.toISOString?.() || null,
                    endDateTime: endDateTime?.toISOString?.() || null,
                }, tx as any);

                return persisted;
            });
            return updated;
        } catch (error: unknown) {
            if (this.isOverlapConstraintError(error)) {
                const e: any = new Error('El nuevo horario se superpone con otra reserva.');
                e.code = 'BOOKING_OVERLAP';
                throw e;
            }
            throw error;
        }
    }

    private roundCurrency(value: unknown) {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return 0;
        return Number(Math.max(0, numeric).toFixed(2));
    }

    private resolveBookingResponsibleRef(booking: { clientId?: string | null; userId?: number | null }) {
        if (booking.clientId) return `booking-client:${String(booking.clientId)}`;
        if (booking.userId && Number.isFinite(Number(booking.userId))) return `booking-user:${Number(booking.userId)}`;
        return 'guest:booking-responsible';
    }

    // Algunos flujos del frontend pueden alternar aliases del titular
    // (ej. booking-client:* <-> guest:owner) sin cambios reales de participantes.
    // Normalizamos para evitar eventos falsos de "agregado/eliminado".
    private normalizeParticipantRefForDiff(
        participantRef: string | null | undefined,
        booking: { clientId?: string | null; userId?: number | null }
    ) {
        const rawRef = String(participantRef || '').trim();
        if (!rawRef) return '';

        const lowered = rawRef.toLowerCase();
        if (lowered.startsWith('guest:owner') || lowered.startsWith('guest:booking-responsible')) {
            return 'booking:responsible';
        }

        // Los refs "booking-client:*" y "booking-user:*" representan al titular de la reserva.
        // No deben disparar diffs de participante por cambios de alias/formato.
        if (lowered.startsWith('booking-client:') || lowered.startsWith('booking-user:')) {
            return 'booking:responsible';
        }

        const bookingClientId = String(booking.clientId || '').trim();
        const bookingClientIdNormalized = bookingClientId.toLowerCase();
        const bookingClientAlias = bookingClientIdNormalized ? `client-${bookingClientIdNormalized}` : '';
        if (bookingClientId && lowered.startsWith('booking-client:')) {
            const refClientId = rawRef.slice('booking-client:'.length).trim();
            if (refClientId === bookingClientId) return 'booking:responsible';
        }
        // Algunos flujos del front persisten cliente como "client:client-<id>".
        // Si coincide con el cliente de la reserva, es el mismo titular.
        if (bookingClientId && lowered.startsWith('client:')) {
            const refClientToken = lowered.slice('client:'.length).trim();
            if (
                refClientToken === bookingClientIdNormalized ||
                refClientToken === bookingClientAlias ||
                refClientToken.endsWith(`-${bookingClientIdNormalized}`)
            ) {
                return 'booking:responsible';
            }
        }

        const bookingUserId = Number(booking.userId || 0);
        if (Number.isFinite(bookingUserId) && bookingUserId > 0 && lowered.startsWith('booking-user:')) {
            const refUserId = Number(rawRef.slice('booking-user:'.length).trim());
            if (Number.isFinite(refUserId) && refUserId === bookingUserId) return 'booking:responsible';
        }

        const defaultResponsibleRef = this.resolveBookingResponsibleRef(booking);
        if (rawRef === defaultResponsibleRef) {
            return 'booking:responsible';
        }

        return rawRef;
    }

    private normalizeBillingAssignments(raw: unknown): BookingBillingAssignmentDTO[] {
        const payload = (raw || {}) as Partial<PersistedBillingAssignmentsJson>;
        const items = Array.isArray(payload.assignments) ? payload.assignments : [];
        const map = new Map<string, BookingBillingAssignmentDTO>();

        for (const item of items) {
            const assignment = item as Partial<BookingBillingAssignmentDTO>;
            const id = String(assignment?.id || '').trim();
            const participantRef = String(assignment?.participantRef || '').trim();
            if (!id || !participantRef) continue;
            map.set(id, {
                id,
                participantRef,
                isChargeable: Boolean(assignment?.isChargeable),
                assignedAmount: this.roundCurrency(assignment?.assignedAmount),
                participantLinkState:
                    assignment?.participantLinkState === 'ARCHIVED_REFERENCE'
                        ? 'ARCHIVED_REFERENCE'
                        : 'ACTIVE',
            });
        }

        return Array.from(map.values());
    }

    private collectActiveParticipantRefs(assignments: BookingBillingAssignmentDTO[]): string[] {
        const refs = new Set<string>();
        for (const assignment of assignments) {
            const participantRef = String(assignment?.participantRef || '').trim();
            if (!participantRef) continue;
            const isArchivedReference = assignment?.participantLinkState === 'ARCHIVED_REFERENCE';
            if (isArchivedReference) continue;
            refs.add(participantRef);
        }
        return Array.from(refs.values());
    }

    private normalizeAssignmentsForComparison(assignments: BookingBillingAssignmentDTO[]) {
        return [...(assignments || [])]
            .map((assignment) => ({
                participantRef: String(assignment?.participantRef || '').trim(),
                isChargeable: Boolean(assignment?.isChargeable),
                assignedAmount: this.roundCurrency(assignment?.assignedAmount),
                participantLinkState:
                    assignment?.participantLinkState === 'ARCHIVED_REFERENCE'
                        ? 'ARCHIVED_REFERENCE'
                        : 'ACTIVE',
            }))
            .sort((left, right) => {
                const byRef = left.participantRef.localeCompare(right.participantRef);
                if (byRef !== 0) return byRef;
                if (left.isChargeable !== right.isChargeable) return left.isChargeable ? -1 : 1;
                const byAmount = left.assignedAmount - right.assignedAmount;
                if (Math.abs(byAmount) > 0.009) return byAmount;
                return left.participantLinkState.localeCompare(right.participantLinkState);
            });
    }

    private extractSidebarNotesFromMetadata(metadata: Record<string, unknown> | null | undefined) {
        if (!metadata || typeof metadata !== 'object') return '';
        if (typeof metadata.sidebarNotes === 'string') return metadata.sidebarNotes.trim();
        const sidebar = metadata.sidebar;
        if (sidebar && typeof sidebar === 'object') {
            const notes = (sidebar as Record<string, unknown>).notes;
            if (typeof notes === 'string') return notes.trim();
        }
        return '';
    }

    private validateBillingConfig(input: {
        chargeMode: 'INDIVIDUAL' | 'SHARED';
        chargeResponsibleRef?: string | null;
        assignments: BookingBillingAssignmentDTO[];
        chargeableTotal: number;
    }) {
        if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
            throw new Error('Debe enviar al menos una asignación.');
        }

        const seenIds = new Set<string>();
        for (const assignment of input.assignments) {
            if (!assignment.id || !assignment.participantRef) {
                throw new Error('Asignación inválida: id y participantRef son obligatorios.');
            }
            if (seenIds.has(assignment.id)) {
                throw new Error('Asignación inválida: hay ids duplicados.');
            }
            seenIds.add(assignment.id);
            if (Number(assignment.assignedAmount) < 0) {
                throw new Error('Asignación inválida: assignedAmount no puede ser negativo.');
            }
        }

        const chargeableAssignments = input.assignments.filter((assignment) => assignment.isChargeable);
        if (input.chargeMode === 'INDIVIDUAL') {
            const responsible = String(input.chargeResponsibleRef || '').trim();
            if (!responsible) {
                throw new Error('En modo INDIVIDUAL falta chargeResponsibleRef.');
            }
            if (chargeableAssignments.length !== 1) {
                throw new Error('En modo INDIVIDUAL debe existir exactamente una asignación cobrable.');
            }
            if (chargeableAssignments[0].participantRef !== responsible) {
                throw new Error('En modo INDIVIDUAL la asignación cobrable debe coincidir con chargeResponsibleRef.');
            }
        } else {
            if (chargeableAssignments.length === 0) {
                throw new Error('En modo SHARED debe existir al menos una asignación cobrable.');
            }
        }

        const sumAssigned = this.roundCurrency(
            input.assignments.reduce((sum, assignment) => {
                if (!assignment.isChargeable) return sum;
                return sum + Number(assignment.assignedAmount || 0);
            }, 0)
        );
        const expected = this.roundCurrency(input.chargeableTotal);
        if (Math.abs(sumAssigned - expected) > 0.01) {
            throw new Error('La suma de asignaciones cobrables no coincide con el monto cobrable actual de la reserva.');
        }
    }

    private buildDefaultBillingConfig(booking: {
        id: number;
        clubId: number;
        clientId?: string | null;
        userId?: number | null;
        price?: unknown;
        createdAt?: Date | null;
        updatedAt?: Date | null;
    }): BookingBillingConfigDTO {
        const responsibleRef = this.resolveBookingResponsibleRef(booking);
        const amount = this.roundCurrency(booking.price);
        return {
            bookingId: booking.id,
            clubId: booking.clubId,
            chargeMode: 'INDIVIDUAL',
            chargeResponsibleRef: responsibleRef,
            assignments: [
                {
                    id: 'asg-booking-responsible',
                    participantRef: responsibleRef,
                    isChargeable: true,
                    assignedAmount: amount,
                    participantLinkState: 'ACTIVE',
                },
            ],
            metadata: {
                schemaVersion: 1,
                source: 'DEFAULTED',
            },
            updatedAt: (booking.updatedAt || booking.createdAt || new Date()).toISOString(),
        };
    }

    async getBookingBillingConfig(bookingId: number, clubId: number): Promise<BookingBillingConfigDTO> {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: {
                id: true,
                clubId: true,
                clientId: true,
                userId: true,
                price: true,
                createdAt: true,
                startDateTime: true,
                endDateTime: true,
            },
        });
        if (!booking) {
            throw new Error('Reserva no encontrada');
        }

        const persisted = await prisma.bookingBillingConfig.findUnique({
            where: { bookingId: booking.id },
            select: {
                bookingId: true,
                clubId: true,
                chargeMode: true,
                chargeResponsibleRef: true,
                assignmentsJson: true,
                metadataJson: true,
                updatedAt: true,
            },
        });

        if (!persisted) {
            const summary = await prisma.$transaction((tx) =>
                this.bookingDomainService.getBookingFinancialSummaryTx(tx as any, booking.id, clubId)
            );
            const bookingResponsibleRef = this.resolveBookingResponsibleRef({
                clientId: booking.clientId,
                userId: booking.userId
            });
            const initializedAssignments: PersistedBillingAssignmentsJson = {
                schemaVersion: 1,
                assignments: [
                    {
                        id: 'asg-booking-responsible',
                        participantRef: bookingResponsibleRef,
                        isChargeable: true,
                        assignedAmount: this.roundCurrency(summary?.total ?? booking.price),
                        participantLinkState: 'ACTIVE'
                    }
                ]
            };
            const initializedMetadata = {
                schemaVersion: 1 as const,
                source: 'PERSISTED' as const,
                initializedBy: 'AUTO_INITIALIZE_ON_READ'
            };

            const initialized = await prisma.bookingBillingConfig.upsert({
                where: { bookingId: booking.id },
                create: {
                    bookingId: booking.id,
                    clubId,
                    chargeMode: ChargeMode.INDIVIDUAL,
                    chargeResponsibleRef: bookingResponsibleRef,
                    assignmentsJson: initializedAssignments as unknown as Prisma.InputJsonValue,
                    metadataJson: initializedMetadata as unknown as Prisma.InputJsonValue,
                    createdByUserId: null,
                    updatedByUserId: null
                },
                update: {
                    chargeMode: ChargeMode.INDIVIDUAL,
                    chargeResponsibleRef: bookingResponsibleRef,
                    assignmentsJson: initializedAssignments as unknown as Prisma.InputJsonValue,
                    metadataJson: initializedMetadata as unknown as Prisma.InputJsonValue,
                    updatedByUserId: null
                },
                select: {
                    bookingId: true,
                    clubId: true,
                    chargeMode: true,
                    chargeResponsibleRef: true,
                    assignmentsJson: true,
                    metadataJson: true,
                    updatedAt: true
                }
            });

            return {
                bookingId: initialized.bookingId,
                clubId: initialized.clubId,
                chargeMode: String(initialized.chargeMode) === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
                chargeResponsibleRef: initialized.chargeResponsibleRef || undefined,
                assignments: this.normalizeBillingAssignments(initialized.assignmentsJson),
                metadata: {
                    schemaVersion: 1,
                    source: 'PERSISTED',
                    ...((initialized.metadataJson || {}) as Record<string, unknown>)
                } as BookingBillingConfigDTO['metadata'],
                updatedAt: initialized.updatedAt.toISOString()
            };
        }

        const assignments = this.normalizeBillingAssignments(persisted.assignmentsJson);
        const metadata = (persisted.metadataJson || {}) as Record<string, unknown>;

        return {
            bookingId: persisted.bookingId,
            clubId: persisted.clubId,
            chargeMode: String(persisted.chargeMode) === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
            chargeResponsibleRef: persisted.chargeResponsibleRef || undefined,
            assignments,
            metadata: {
                schemaVersion: 1,
                source: 'PERSISTED',
                ...(metadata || {}),
            } as BookingBillingConfigDTO['metadata'],
            updatedAt: persisted.updatedAt.toISOString(),
        };
    }

    async upsertBookingBillingConfig(input: UpsertBookingBillingConfigInput): Promise<BookingBillingConfigDTO> {
        return prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findFirst({
                where: { id: input.bookingId, clubId: input.clubId },
                select: {
                    id: true,
                    clubId: true,
                    status: true,
                    clientId: true,
                    userId: true,
                    price: true,
                    createdAt: true,
                },
            });
            if (!booking) {
                throw new Error('Reserva no encontrada');
            }

            const summary = await this.bookingDomainService.getBookingFinancialSummaryTx(tx as any, booking.id, input.clubId);
            const chargeableTotal = Number(summary?.total || booking.price || 0);
            const defaultResponsibleRef = this.resolveBookingResponsibleRef({
                clientId: booking.clientId,
                userId: booking.userId
            });
            let normalizedAssignments = this.normalizeBillingAssignments({
                schemaVersion: 1,
                assignments: input.assignments || [],
            } satisfies PersistedBillingAssignmentsJson);
            const currentConfig = await tx.bookingBillingConfig.findUnique({
                where: { bookingId: booking.id },
                select: {
                    assignmentsJson: true,
                    metadataJson: true,
                    chargeMode: true,
                    chargeResponsibleRef: true,
                },
            });
            const previousConfig = currentConfig
                ? {
                    chargeMode: String(currentConfig.chargeMode) === 'SHARED' ? 'SHARED' as const : 'INDIVIDUAL' as const,
                    chargeResponsibleRef: currentConfig.chargeResponsibleRef || undefined,
                    assignments: this.normalizeBillingAssignments(currentConfig.assignmentsJson),
                    metadata: ((currentConfig.metadataJson || {}) as Record<string, unknown>),
                }
                : this.buildDefaultBillingConfig(booking);
            const previousAssignments = previousConfig.assignments;
            const effectiveChargeResponsibleRef = (() => {
                const explicit = String(input.chargeResponsibleRef || '').trim();
                if (explicit) return explicit;
                if (input.chargeMode !== 'INDIVIDUAL') return undefined;
                if (defaultResponsibleRef) return defaultResponsibleRef;
                const chargeableAssignments = normalizedAssignments.filter((assignment) => assignment.isChargeable);
                if (chargeableAssignments.length !== 1) return undefined;
                const inferred = String(chargeableAssignments[0]?.participantRef || '').trim();
                return inferred || undefined;
            })();
            if (input.chargeMode === 'INDIVIDUAL' && effectiveChargeResponsibleRef) {
                const normalizedTotalAmount = this.roundCurrency(chargeableTotal);
                const hasResponsibleAssignment = normalizedAssignments.some(
                    (assignment) => assignment.participantRef === effectiveChargeResponsibleRef
                );
                normalizedAssignments = normalizedAssignments.map((assignment) => {
                    const isResponsibleAssignment = assignment.participantRef === effectiveChargeResponsibleRef;
                    return {
                        ...assignment,
                        isChargeable: isResponsibleAssignment,
                        assignedAmount: isResponsibleAssignment ? normalizedTotalAmount : 0,
                    };
                });
                if (!hasResponsibleAssignment) {
                    const responsibleToken =
                        String(effectiveChargeResponsibleRef)
                            .replace(/[^a-zA-Z0-9]+/g, '-')
                            .replace(/^-+|-+$/g, '')
                            .slice(0, 32) || 'booking-responsible';
                    normalizedAssignments.push({
                        id: `asg-${responsibleToken}`,
                        participantRef: effectiveChargeResponsibleRef,
                        isChargeable: true,
                        assignedAmount: normalizedTotalAmount,
                        participantLinkState: 'ACTIVE',
                    });
                }
            }
            if (input.chargeMode === 'SHARED') {
                const normalizedTotalAmount = this.roundCurrency(chargeableTotal);
                const activeIndexes = normalizedAssignments
                    .map((assignment, index) => ({ assignment, index }))
                    .filter(({ assignment }) => assignment.participantLinkState !== 'ARCHIVED_REFERENCE')
                    .map(({ index }) => index);

                let chargeableIndexes = normalizedAssignments
                    .map((assignment, index) => ({ assignment, index }))
                    .filter(({ assignment }) => assignment.isChargeable)
                    .map(({ index }) => index);

                if (chargeableIndexes.length === 0) {
                    const fallbackIndex = activeIndexes[0] ?? 0;
                    if (normalizedAssignments[fallbackIndex]) {
                        normalizedAssignments[fallbackIndex] = {
                            ...normalizedAssignments[fallbackIndex],
                            isChargeable: true,
                        };
                        chargeableIndexes = [fallbackIndex];
                    }
                }

                normalizedAssignments = normalizedAssignments.map((assignment, index) => {
                    if (!chargeableIndexes.includes(index)) {
                        return {
                            ...assignment,
                            isChargeable: false,
                            assignedAmount: 0,
                        };
                    }
                    return {
                        ...assignment,
                        isChargeable: true,
                        assignedAmount: this.roundCurrency(assignment.assignedAmount),
                    };
                });

                if (chargeableIndexes.length === 1) {
                    const targetIndex = chargeableIndexes[0];
                    normalizedAssignments[targetIndex] = {
                        ...normalizedAssignments[targetIndex],
                        isChargeable: true,
                        assignedAmount: normalizedTotalAmount,
                    };
                } else if (chargeableIndexes.length > 1) {
                    const currentSum = this.roundCurrency(
                        chargeableIndexes.reduce(
                            (sum, index) => sum + Number(normalizedAssignments[index]?.assignedAmount || 0),
                            0
                        )
                    );

                    if (currentSum <= 0.009) {
                        const evenAmount = this.roundCurrency(normalizedTotalAmount / chargeableIndexes.length);
                        normalizedAssignments = normalizedAssignments.map((assignment, index) => {
                            if (!chargeableIndexes.includes(index)) return assignment;
                            return {
                                ...assignment,
                                assignedAmount: evenAmount,
                            };
                        });
                    } else {
                        normalizedAssignments = normalizedAssignments.map((assignment, index) => {
                            if (!chargeableIndexes.includes(index)) return assignment;
                            const proportionalAmount = this.roundCurrency(
                                (Number(assignment.assignedAmount || 0) / currentSum) * normalizedTotalAmount
                            );
                            return {
                                ...assignment,
                                assignedAmount: proportionalAmount,
                            };
                        });
                    }

                    const adjustedSum = this.roundCurrency(
                        chargeableIndexes.reduce(
                            (sum, index) => sum + Number(normalizedAssignments[index]?.assignedAmount || 0),
                            0
                        )
                    );
                    const delta = this.roundCurrency(normalizedTotalAmount - adjustedSum);
                    if (Math.abs(delta) > 0.009) {
                        const firstIndex = chargeableIndexes[0];
                        normalizedAssignments[firstIndex] = {
                            ...normalizedAssignments[firstIndex],
                            assignedAmount: this.roundCurrency(
                                Math.max(0, Number(normalizedAssignments[firstIndex]?.assignedAmount || 0) + delta)
                            ),
                        };
                    }
                }
            }
            {
                const normalizedTotalAmount = this.roundCurrency(chargeableTotal);
                const chargeableIndexes = normalizedAssignments
                    .map((assignment, index) => ({ assignment, index }))
                    .filter(({ assignment }) => assignment.isChargeable)
                    .map(({ index }) => index);

                if (chargeableIndexes.length > 0) {
                    const currentSum = this.roundCurrency(
                        chargeableIndexes.reduce(
                            (sum, index) => sum + Number(normalizedAssignments[index]?.assignedAmount || 0),
                            0
                        )
                    );
                    let delta = this.roundCurrency(normalizedTotalAmount - currentSum);

                    if (Math.abs(delta) > 0.009) {
                        if (delta > 0) {
                            const firstIndex = chargeableIndexes[0];
                            normalizedAssignments[firstIndex] = {
                                ...normalizedAssignments[firstIndex],
                                assignedAmount: this.roundCurrency(
                                    Number(normalizedAssignments[firstIndex]?.assignedAmount || 0) + delta
                                ),
                            };
                        } else {
                            let remainingToDiscount = Math.abs(delta);
                            for (const index of chargeableIndexes) {
                                if (remainingToDiscount <= 0.009) break;
                                const currentAmount = this.roundCurrency(normalizedAssignments[index]?.assignedAmount);
                                if (currentAmount <= 0.009) continue;
                                const discount = this.roundCurrency(Math.min(currentAmount, remainingToDiscount));
                                normalizedAssignments[index] = {
                                    ...normalizedAssignments[index],
                                    assignedAmount: this.roundCurrency(currentAmount - discount),
                                };
                                remainingToDiscount = this.roundCurrency(remainingToDiscount - discount);
                            }
                            if (remainingToDiscount > 0.009) {
                                const firstIndex = chargeableIndexes[0];
                                normalizedAssignments[firstIndex] = {
                                    ...normalizedAssignments[firstIndex],
                                    assignedAmount: this.roundCurrency(
                                        Number(normalizedAssignments[firstIndex]?.assignedAmount || 0) + remainingToDiscount
                                    ),
                                };
                            }
                        }
                    }
                }
            }

            const previousActiveRefs = new Set(
                this.collectActiveParticipantRefs(previousAssignments).map((ref) =>
                    this.normalizeParticipantRefForDiff(ref, {
                        clientId: booking.clientId,
                        userId: booking.userId
                    })
                )
            );
            const nextActiveRefs = new Set(
                this.collectActiveParticipantRefs(normalizedAssignments).map((ref) =>
                    this.normalizeParticipantRefForDiff(ref, {
                        clientId: booking.clientId,
                        userId: booking.userId
                    })
                )
            );
            const addedParticipantRefs = Array.from(nextActiveRefs.values()).filter((ref) => !previousActiveRefs.has(ref));
            const removedParticipantRefs = Array.from(previousActiveRefs.values()).filter((ref) => !nextActiveRefs.has(ref));
            if (booking.status === 'COMPLETED' && (addedParticipantRefs.length > 0 || removedParticipantRefs.length > 0)) {
                const lockedParticipantsError: any = new Error(
                    'No se pueden modificar participantes en una reserva completada.'
                );
                lockedParticipantsError.code = 'BOOKING_COMPLETED_PARTICIPANTS_LOCKED';
                throw lockedParticipantsError;
            }

            const previousAssignmentsComparable = this.normalizeAssignmentsForComparison(previousAssignments);
            const nextAssignmentsComparable = this.normalizeAssignmentsForComparison(normalizedAssignments);
            const previousChargeableComparable = previousAssignmentsComparable
                .filter((assignment) => assignment.isChargeable)
                .map((assignment) => ({
                    ...assignment,
                    participantRef: this.normalizeParticipantRefForDiff(assignment.participantRef, {
                        clientId: booking.clientId,
                        userId: booking.userId
                    })
                }))
                .sort((left, right) => left.participantRef.localeCompare(right.participantRef));
            const nextChargeableComparable = nextAssignmentsComparable
                .filter((assignment) => assignment.isChargeable)
                .map((assignment) => ({
                    ...assignment,
                    participantRef: this.normalizeParticipantRefForDiff(assignment.participantRef, {
                        clientId: booking.clientId,
                        userId: booking.userId
                    })
                }))
                .sort((left, right) => left.participantRef.localeCompare(right.participantRef));
            const chargeModeChanged = previousConfig.chargeMode !== input.chargeMode;
            const previousChargeResponsibleComparable = this.normalizeParticipantRefForDiff(previousConfig.chargeResponsibleRef, {
                clientId: booking.clientId,
                userId: booking.userId
            });
            const nextChargeResponsibleComparable = this.normalizeParticipantRefForDiff(effectiveChargeResponsibleRef, {
                clientId: booking.clientId,
                userId: booking.userId
            });
            const chargeResponsibleChanged =
                previousChargeResponsibleComparable !== nextChargeResponsibleComparable;
            const chargeRulesChanged =
                JSON.stringify(previousChargeableComparable) !== JSON.stringify(nextChargeableComparable);
            const billingConfigChanged =
                chargeModeChanged ||
                chargeResponsibleChanged ||
                chargeRulesChanged;
            if (billingConfigChanged) {
                const bookingAccount = await tx.account.findFirst({
                    where: {
                        clubId: input.clubId,
                        sourceType: 'BOOKING',
                        sourceId: String(booking.id),
                    },
                    select: {
                        id: true,
                        payments: {
                            select: { id: true },
                            take: 1,
                        },
                    },
                });
                const hasRegisteredPayments = Boolean(bookingAccount?.payments?.length);
                if (hasRegisteredPayments) {
                    const lockedError: any = new Error(
                        'No se puede cambiar la asignación de cobro porque la reserva ya tiene pagos registrados.'
                    );
                    lockedError.code = 'BILLING_CONFIG_LOCKED_BY_PAYMENTS';
                    throw lockedError;
                }
            }
            const previousNotes = this.extractSidebarNotesFromMetadata(previousConfig.metadata as Record<string, unknown>);
            const nextNotes = this.extractSidebarNotesFromMetadata((input.metadata || {}) as Record<string, unknown>);
            const notesChanged = previousNotes !== nextNotes;

            this.validateBillingConfig({
                chargeMode: input.chargeMode,
                chargeResponsibleRef: effectiveChargeResponsibleRef,
                assignments: normalizedAssignments,
                chargeableTotal,
            });

            const assignmentsPayload: PersistedBillingAssignmentsJson = {
                schemaVersion: 1,
                assignments: normalizedAssignments,
            };
            const metadataPayload = {
                schemaVersion: 1 as const,
                source: 'PERSISTED' as const,
                ...(input.metadata || {}),
            };

            const persisted = await tx.bookingBillingConfig.upsert({
                where: { bookingId: booking.id },
                create: {
                    bookingId: booking.id,
                    clubId: input.clubId,
                    chargeMode: input.chargeMode === 'SHARED' ? ChargeMode.SHARED : ChargeMode.INDIVIDUAL,
                    chargeResponsibleRef: effectiveChargeResponsibleRef || null,
                    assignmentsJson: assignmentsPayload as unknown as Prisma.InputJsonValue,
                    metadataJson: metadataPayload as unknown as Prisma.InputJsonValue,
                    createdByUserId: input.actorUserId || null,
                    updatedByUserId: input.actorUserId || null,
                },
                update: {
                    chargeMode: input.chargeMode === 'SHARED' ? ChargeMode.SHARED : ChargeMode.INDIVIDUAL,
                    chargeResponsibleRef: effectiveChargeResponsibleRef || null,
                    assignmentsJson: assignmentsPayload as unknown as Prisma.InputJsonValue,
                    metadataJson: metadataPayload as unknown as Prisma.InputJsonValue,
                    updatedByUserId: input.actorUserId || null,
                },
                select: {
                    bookingId: true,
                    clubId: true,
                    chargeMode: true,
                    chargeResponsibleRef: true,
                    assignmentsJson: true,
                    metadataJson: true,
                    updatedAt: true,
                },
            });

            if (addedParticipantRefs.length > 0) {
                await this.eventService.bookingParticipantAdded(input.clubId, {
                    bookingId: booking.id,
                    addedParticipantRefs,
                    addedParticipantsCount: addedParticipantRefs.length,
                    actorUserId: input.actorUserId || null,
                    chargeMode: input.chargeMode,
                }, tx as any);
            }
            if (removedParticipantRefs.length > 0) {
                await this.eventService.bookingParticipantRemoved(input.clubId, {
                    bookingId: booking.id,
                    removedParticipantRefs,
                    removedParticipantsCount: removedParticipantRefs.length,
                    actorUserId: input.actorUserId || null,
                    chargeMode: input.chargeMode,
                }, tx as any);
            }
            if (billingConfigChanged) {
                const stableResponsibleForEvent =
                    String(previousConfig.chargeResponsibleRef || '').trim() ||
                    String(effectiveChargeResponsibleRef || '').trim() ||
                    null;
                await this.eventService.bookingBillingConfigUpdated(input.clubId, {
                    bookingId: booking.id,
                    actorUserId: input.actorUserId || null,
                    previousChargeMode: previousConfig.chargeMode,
                    chargeMode: input.chargeMode,
                    previousChargeResponsibleRef: chargeResponsibleChanged
                        ? (previousConfig.chargeResponsibleRef || null)
                        : stableResponsibleForEvent,
                    chargeResponsibleRef: chargeResponsibleChanged
                        ? (effectiveChargeResponsibleRef || null)
                        : stableResponsibleForEvent,
                    addedParticipantsCount: addedParticipantRefs.length,
                    removedParticipantsCount: removedParticipantRefs.length,
                }, tx as any);
            }
            if (notesChanged) {
                await this.eventService.bookingNotesUpdated(input.clubId, {
                    bookingId: booking.id,
                    actorUserId: input.actorUserId || null,
                    previousNotes: previousNotes || '',
                    notes: nextNotes || '',
                }, tx as any);
            }

            return {
                bookingId: persisted.bookingId,
                clubId: persisted.clubId,
                chargeMode: String(persisted.chargeMode) === 'SHARED' ? 'SHARED' : 'INDIVIDUAL',
                chargeResponsibleRef: persisted.chargeResponsibleRef || undefined,
                assignments: this.normalizeBillingAssignments(persisted.assignmentsJson),
                metadata: {
                    schemaVersion: 1,
                    source: 'PERSISTED',
                    ...((persisted.metadataJson || {}) as Record<string, unknown>),
                },
                updatedAt: persisted.updatedAt.toISOString(),
            };
        });
    }

    private defaultFixedSlots = [
        "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
    ];

    private toMinutes(time: string | null | undefined) {
        if (!time) return null;
        const [hh, mm] = String(time).split(':').map((n) => Number(n));
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
        return hh * 60 + mm;
    }

    private fromMinutes(total: number) {
        const hh = Math.floor(total / 60);
        const mm = total % 60;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    private normalizeDurations(raw: any, fallback: number) {
        const parsed = Array.isArray(raw)
            ? raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
            : [];
        return parsed.length > 0 ? parsed : [fallback];
    }

    private resolveActivitySchedule(activity: ActivityType | null | undefined) {
        const normalized = normalizeSchedule(
            {
                scheduleMode: activity?.scheduleMode,
                scheduleOpenTime: activity?.scheduleOpenTime,
                scheduleCloseTime: activity?.scheduleCloseTime,
                scheduleIntervalMinutes: activity?.scheduleIntervalMinutes,
                scheduleWindows: activity?.scheduleWindows,
                scheduleDurations: activity?.scheduleDurations,
                scheduleFixedSlots: activity?.scheduleFixedSlots
            },
            activity?.defaultDurationMinutes ?? 90
        );

        // Completa slots por defecto si la actividad FIXED no trae slots configurados.
        if (normalized.mode === 'FIXED' && normalized.fixedSlots.length === 0) {
            const fallbackDuration = normalized.durations[0] ?? activity?.defaultDurationMinutes ?? 90;
            normalized.fixedSlots = this.defaultFixedSlots.map((start) => ({ start, duration: fallbackDuration }));
        }

        return normalized;
    }

    private async resolveActivityScheduleForDate(activity: ActivityType, date: Date, timeZone: string) {
        const baseSchedule = this.resolveActivitySchedule(activity);
        const localDateKey = this.formatLocalDateKey(date, timeZone);
        const prismaAny = prisma as any;

        const exception = await prismaAny.activityScheduleException?.findUnique?.({
            where: {
                activityTypeId_localDate: {
                    activityTypeId: activity.id,
                    localDate: new Date(`${localDateKey}T00:00:00.000Z`)
                }
            }
        });

        if (!exception) {
            return { isClosed: false, schedule: baseSchedule };
        }

        if (Boolean(exception.isClosed)) {
            return { isClosed: true, schedule: baseSchedule };
        }

        const normalizedException = normalizeSchedule(
            {
                scheduleMode: exception.scheduleMode,
                scheduleOpenTime: exception.scheduleOpenTime,
                scheduleCloseTime: exception.scheduleCloseTime,
                scheduleIntervalMinutes: exception.scheduleIntervalMinutes,
                scheduleWindows: exception.scheduleWindows,
                scheduleDurations: exception.scheduleDurations,
                scheduleFixedSlots: exception.scheduleFixedSlots
            },
            activity.defaultDurationMinutes
        );

        return { isClosed: false, schedule: normalizedException };
    }

    private normalizeActivityKey(name: string | null | undefined) {
        if (!name) return '';
        return name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase();
    }

    private resolveClubConfig(club: any) {
        const settings = club?.settings ?? null;
        if (!settings) {
            throw new Error('Configuración de club incompleta: faltan ClubSettings');
        }

        const timeZone = String(settings.timeZone || '').trim();
        if (!timeZone) {
            throw new Error('Configuración de club inválida: timeZone es obligatorio');
        }

        if (!Array.isArray(settings.openingDays) || settings.openingDays.length === 0) {
            throw new Error('Configuración de club inválida: openingDays es obligatorio');
        }

        const closureDates = Array.isArray(settings.closureDates)
            ? settings.closureDates
                .map((date: unknown) => String(date || '').trim())
                .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
            : [];

        const bookingSimpleAdvanceDaysUser = Number(settings.bookingSimpleAdvanceDaysUser);
        const bookingSimpleAdvanceDaysAdmin = Number(settings.bookingSimpleAdvanceDaysAdmin);
        if (!Number.isFinite(bookingSimpleAdvanceDaysUser) || bookingSimpleAdvanceDaysUser < 0) {
            throw new Error('Configuración de club inválida: bookingSimpleAdvanceDaysUser es obligatorio y debe ser >= 0');
        }
        if (!Number.isFinite(bookingSimpleAdvanceDaysAdmin) || bookingSimpleAdvanceDaysAdmin < 0) {
            throw new Error('Configuración de club inválida: bookingSimpleAdvanceDaysAdmin es obligatorio y debe ser >= 0');
        }

        const professorDurationOverrideEnabled = settings.professorDurationOverrideEnabled;
        const professorDurationOverrideMinutes = Number(settings.professorDurationOverrideMinutes);
        if (typeof professorDurationOverrideEnabled !== 'boolean') {
            throw new Error('Configuración de club inválida: professorDurationOverrideEnabled es obligatorio');
        }
        if (!Number.isFinite(professorDurationOverrideMinutes) || professorDurationOverrideMinutes <= 0) {
            throw new Error('Configuración de club inválida: professorDurationOverrideMinutes es obligatorio y debe ser > 0');
        }

        const allowManualConfirmationOverride = settings.allowManualConfirmationOverride;
        if (typeof allowManualConfirmationOverride !== 'boolean') {
            throw new Error('Configuración de club inválida: allowManualConfirmationOverride es obligatorio');
        }

        const bookingConfirmationMode = settings.bookingConfirmationMode;
        if (
            bookingConfirmationMode !== 'AUTOMATIC' &&
            bookingConfirmationMode !== 'MANUAL' &&
            bookingConfirmationMode !== 'DEPOSIT_REQUIRED'
        ) {
            throw new Error('Configuración de club inválida: bookingConfirmationMode es obligatorio');
        }

        const lightsEnabled = settings.lightsEnabled;
        if (typeof lightsEnabled !== 'boolean') {
            throw new Error('Configuración de club inválida: lightsEnabled es obligatorio');
        }

        const lightsFromHourRaw = settings?.lightsFromHour;
        const normalizedLightsFromHour =
            typeof lightsFromHourRaw === 'string'
                ? lightsFromHourRaw
                : (lightsFromHourRaw !== null && lightsFromHourRaw !== undefined && Number.isFinite(Number(lightsFromHourRaw)))
                    ? this.fromMinutes(Number(lightsFromHourRaw))
                    : null;

        const lightsExtraAmount = settings?.lightsExtraAmount != null ? Number(settings.lightsExtraAmount) : null;
        if (lightsEnabled) {
            if (!Number.isFinite(lightsExtraAmount) || Number(lightsExtraAmount) <= 0) {
                throw new Error('Configuración de club inválida: lightsExtraAmount es obligatorio cuando lightsEnabled=true');
            }
            if (!normalizedLightsFromHour || !/^\d{2}:\d{2}$/.test(String(normalizedLightsFromHour))) {
                throw new Error('Configuración de club inválida: lightsFromHour debe tener formato HH:MM cuando lightsEnabled=true');
            }
        }

        return {
            ...club,
            timeZone,
            openingDays: settings.openingDays,
            closureDates,
            clubOperationalStatus:
                settings?.clubOperationalStatus === 'TEMPORARY_CLOSED' || settings?.clubOperationalStatus === 'PERMANENTLY_CLOSED'
                    ? settings.clubOperationalStatus
                    : 'OPEN',
            temporaryClosureStartDate:
                settings?.temporaryClosureStartDate ? this.formatLocalDateKey(new Date(settings.temporaryClosureStartDate), 'UTC') : null,
            temporaryClosureEndDate:
                settings?.temporaryClosureEndDate ? this.formatLocalDateKey(new Date(settings.temporaryClosureEndDate), 'UTC') : null,
            lightsEnabled,
            lightsExtraAmount,
            lightsFromHour: normalizedLightsFromHour,
            // Regla operativa explícita separada del descuento económico
            professorDurationOverrideEnabled,
            professorDurationOverrideMinutes: Math.max(1, Math.floor(professorDurationOverrideMinutes)),
            fixedBookingSettingsByActivity: settings?.fixedBookingSettingsByActivity ?? null,
            bookingConfirmationMode,
            bookingDepositPercent: settings?.bookingDepositPercent != null ? Number(settings.bookingDepositPercent) : null,
            allowManualConfirmationOverride,
            bookingSimpleAdvanceDaysUser: Math.max(0, Math.floor(bookingSimpleAdvanceDaysUser)),
            bookingSimpleAdvanceDaysAdmin: Math.max(0, Math.floor(bookingSimpleAdvanceDaysAdmin)),
            allowAdminSkipSimpleAdvanceLimit: Boolean(settings?.allowAdminSkipSimpleAdvanceLimit)
        };
    }

    private formatLocalDateKey(date: Date, timeZone: string) {
        const localDate = TimeHelper.utcToLocal(date, timeZone);
        const yyyy = localDate.getFullYear();
        const mm = String(localDate.getMonth() + 1).padStart(2, '0');
        const dd = String(localDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    private getLocalDayStart(date: Date, timeZone: string) {
        const local = TimeHelper.utcToLocal(date, timeZone);
        return new Date(local.getFullYear(), local.getMonth(), local.getDate());
    }

    private resolveFixedBookingConfig(clubConfig: any, activity: ActivityType | null | undefined) {
        const raw = clubConfig?.fixedBookingSettingsByActivity;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('Configuración de club inválida: fixedBookingSettingsByActivity es obligatorio');
        }

        const byActivity = raw as Record<string, any>;
        const activityKey = this.normalizeActivityKey(activity?.name);
        const selected = activityKey ? byActivity[activityKey] : undefined;

        if (!selected || typeof selected !== 'object') {
            throw new Error(`Configuración de club inválida: faltan reglas de turnos fijos para la actividad ${activity?.name || 'desconocida'}`);
        }

        const daysAhead = Number(selected.fixedBookingDaysAhead);
        const generationFrequencyDays = Number(selected.fixedBookingGenerationFrequencyDays);
        if (!Number.isFinite(daysAhead) || daysAhead <= 0) {
            throw new Error('Configuración de club inválida: fixedBookingDaysAhead debe ser > 0');
        }
        if (!Number.isFinite(generationFrequencyDays) || generationFrequencyDays <= 0) {
            throw new Error('Configuración de club inválida: fixedBookingGenerationFrequencyDays debe ser > 0');
        }

        return {
            fixedBookingDaysAhead: Math.floor(daysAhead),
            fixedBookingGenerationFrequencyDays: Math.floor(generationFrequencyDays)
        };
    }

    private buildBookingConfirmationContext(params: {
        status: string;
        mode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
        bookingBaseAmount: number;
        depositPercent: number | null;
        paidAmount: number;
    }) {
        const requiredToConfirm = Number(getDepositRequiredAmount({
            mode: params.mode,
            bookingBaseAmount: Number(params.bookingBaseAmount || 0),
            depositPercent: params.depositPercent
        }).toFixed(2));
        const paidAmount = Number(Math.max(0, params.paidAmount || 0).toFixed(2));
        const remainingToConfirm = Number(Math.max(0, requiredToConfirm - paidAmount).toFixed(2));
        const isPendingByInsufficientPayment =
            params.status === 'PENDING' &&
            params.mode === 'DEPOSIT_REQUIRED' &&
            paidAmount > 0.009 &&
            remainingToConfirm > 0.009;

        return {
            requiredToConfirm,
            remainingToConfirm,
            isPendingByInsufficientPayment
        };
    }

    private isClubOpenOnLocalDate(clubConfig: any, date: Date, timeZone: string) {
        const localDateKey = this.formatLocalDateKey(date, timeZone);
        if (clubConfig?.clubOperationalStatus === 'PERMANENTLY_CLOSED') {
            return false;
        }

        if (
            clubConfig?.clubOperationalStatus === 'TEMPORARY_CLOSED' &&
            typeof clubConfig?.temporaryClosureStartDate === 'string' &&
            typeof clubConfig?.temporaryClosureEndDate === 'string' &&
            localDateKey >= clubConfig.temporaryClosureStartDate &&
            localDateKey <= clubConfig.temporaryClosureEndDate
        ) {
            return false;
        }

        if (Array.isArray(clubConfig?.closureDates) && clubConfig.closureDates.includes(localDateKey)) {
            return false;
        }

        if (!clubConfig || !Array.isArray(clubConfig.openingDays) || clubConfig.openingDays.length === 0) return true;
        try {
            // Construir la medianoche local para la fecha dada y obtener el día de la semana en la zona del club
            const slotMidUtc = TimeHelper.localSlotToUtc(date, '00:00', timeZone);
            const localMid = TimeHelper.utcToLocal(slotMidUtc, timeZone);
            const day = localMid.getDay();
            return Array.isArray(clubConfig.openingDays) ? clubConfig.openingDays.includes(day) : true;
        } catch {
            return true;
        }
    }

    private resolveScheduleSlots(activity: ActivityType, durationMinutes: number) {
        return buildSlotsFromSchedule(
            {
                scheduleMode: activity.scheduleMode,
                scheduleOpenTime: activity.scheduleOpenTime,
                scheduleCloseTime: activity.scheduleCloseTime,
                scheduleIntervalMinutes: activity.scheduleIntervalMinutes,
                scheduleWindows: activity.scheduleWindows,
                scheduleDurations: activity.scheduleDurations,
                scheduleFixedSlots: activity.scheduleFixedSlots
            },
            activity.defaultDurationMinutes,
            durationMinutes
        );
    }

    private assertValidDuration(durationMinutes: number) {
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
            throw new Error('La duración del turno debe ser mayor a 0');
        }
    }

    private assertValidRange(startDateTime: Date, endDateTime: Date) {
        if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
            throw new Error('Fecha/hora inválida para la reserva');
        }
        if (startDateTime.getTime() >= endDateTime.getTime()) {
            throw new Error('La fecha/hora de inicio debe ser menor a la de fin');
        }
    }

    private calculateDurationAdjustedPrice(
        basePrice: number,
        effectiveDurationMinutes: number,
        referenceDurationMinutes: number
    ) {
        const safeBase = Number(basePrice || 0);
        const safeEffective = Number(effectiveDurationMinutes || 0);
        const safeReference = Number(referenceDurationMinutes || 0);

        if (!Number.isFinite(safeBase) || safeBase <= 0) return 0;
        if (!Number.isFinite(safeEffective) || safeEffective <= 0) return Number(safeBase.toFixed(2));
        if (!Number.isFinite(safeReference) || safeReference <= 0) return Number(safeBase.toFixed(2));

        const proportional = safeBase * (safeEffective / safeReference);
        return Number(proportional.toFixed(2));
    }

    private resolvePriceReferenceDuration(
        activity: ActivityType,
        allowedDurations: number[],
        effectiveDuration: number
    ) {
        const activityKey = this.normalizeActivityKey(activity?.name);
        if (activityKey === 'FUTBOL' || activityKey === 'TENIS') {
            return 60;
        }

        const defaultDuration = Number(activity?.defaultDurationMinutes);
        if (Number.isFinite(defaultDuration) && defaultDuration > 0) {
            return defaultDuration;
        }

        const firstAllowed = Number(allowedDurations?.[0]);
        if (Number.isFinite(firstAllowed) && firstAllowed > 0) {
            return firstAllowed;
        }

        return effectiveDuration;
    }

    private isOverlapConstraintError(error: unknown) {
        const knownError = error as { code?: string; message?: string; meta?: { database_error?: string } };
        const message = String(knownError?.message || '');
        const dbMessage = String(knownError?.meta?.database_error || '');

        return (
            (knownError?.code === 'P2004' &&
                (
                    message.includes('booking_no_overlap_per_court') ||
                    dbMessage.includes('booking_no_overlap_per_court') ||
                    message.toLowerCase().includes('exclusion constraint') ||
                    dbMessage.toLowerCase().includes('exclusion constraint')
                )) ||
            message.includes('booking_no_overlap_per_court') ||
            dbMessage.includes('booking_no_overlap_per_court')
        );
    }

    private mapActivityType(activity: any): ActivityType | null {
        if (!activity) return null;

        return new ActivityType(
            activity.id,
            activity.name,
            activity.description,
            activity.defaultDurationMinutes,
            activity.clubId,
            activity.scheduleMode,
            activity.scheduleOpenTime,
            activity.scheduleCloseTime,
            activity.scheduleIntervalMinutes,
            Array.isArray((activity as any).scheduleWindows) ? (activity as any).scheduleWindows : null,
            Array.isArray(activity.scheduleDurations) ? activity.scheduleDurations : null,
            Array.isArray(activity.scheduleFixedSlots) ? activity.scheduleFixedSlots : null
        );
    }

    private calculateBookingFinancials(account: {
        items: Array<{ total: unknown; type: string }>;
        payments: Array<{ amount: unknown }>;
    }) {
        const courtPrice = account.items
            .filter((item) => item.type === 'BOOKING')
            .reduce((sum, item) => sum + Number(item.total || 0), 0);
        const itemsTotal = account.items
            .filter((item) => item.type !== 'BOOKING')
            .reduce((sum, item) => sum + Number(item.total || 0), 0);
        const totalPaid = account.payments
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const total = courtPrice + itemsTotal;
        const remaining = Math.max(0, total - totalPaid);
        return { courtPrice, itemsTotal, totalPaid, total, remaining };
    }

    private normalizePhone(phone: string | null | undefined) {
        return normalizeIdentityPhone(phone);
    }

    private normalizeDni(dni: string | null | undefined) {
        if (!dni) return null;
        const normalized = String(dni).replace(/\D/g, '');
        return normalized.length >= 6 ? normalized : null;
    }

    private async resolveClientIdForDiscountTx(
        tx: Prisma.TransactionClient,
        input: {
            clubId: number;
            clientId?: string | null;
            userId?: number | null;
            clientEmail?: string;
            clientPhone?: string;
            clientDni?: string;
        }
    ) {
        const safeClientId = String(input.clientId || '').trim();
        if (safeClientId) {
            const byId = await tx.client.findFirst({
                where: { id: safeClientId, clubId: input.clubId },
                select: { id: true }
            });
            if (byId?.id) return byId.id;
        }

        const safeUserId = Number(input.userId || 0);
        if (safeUserId > 0) {
            const byUser = await tx.client.findFirst({
                where: { clubId: input.clubId, userId: safeUserId },
                select: { id: true }
            });
            if (byUser?.id) return byUser.id;
        }

        const safeDni = this.normalizeDni(input.clientDni);
        if (safeDni) {
            const byDni = await tx.client.findFirst({
                where: { clubId: input.clubId, dni: safeDni },
                select: { id: true }
            });
            if (byDni?.id) return byDni.id;
        }

        const safePhone = this.normalizePhone(input.clientPhone);
        if (safePhone) {
            const phoneVariants = getPhoneIdentityVariants(safePhone);
            const byPhone = await tx.client.findFirst({
                where: { clubId: input.clubId, phone: { in: phoneVariants } },
                select: { id: true }
            });
            if (byPhone?.id) return byPhone.id;
        }

        const safeEmail = String(input.clientEmail || '').trim().toLowerCase();
        if (safeEmail) {
            const byEmail = await tx.client.findFirst({
                where: { clubId: input.clubId, email: safeEmail },
                select: { id: true }
            });
            if (byEmail?.id) return byEmail.id;
        }

        return null;
    }

    private async resolveClientProfessorStatus(input: {
        clubId: number;
        clientId?: string | null;
        userId?: number | null;
        clientEmail?: string;
        clientPhone?: string;
        clientDni?: string;
    }) {
        const safeClientId = String(input.clientId || '').trim();
        if (safeClientId) {
            const byId = await prisma.client.findFirst({
                where: { id: safeClientId, clubId: input.clubId },
                select: { isProfessor: true }
            });
            if (byId) return Boolean(byId.isProfessor);
        }

        const safeUserId = Number(input.userId || 0);
        if (safeUserId > 0) {
            const byUser = await prisma.client.findFirst({
                where: { clubId: input.clubId, userId: safeUserId },
                select: { isProfessor: true }
            });
            return Boolean(byUser?.isProfessor);
        }

        const safeDni = this.normalizeDni(input.clientDni);
        if (safeDni) {
            const byDni = await prisma.client.findFirst({
                where: { clubId: input.clubId, dni: safeDni },
                select: { isProfessor: true }
            });
            if (byDni) return Boolean(byDni.isProfessor);
        }

        const safePhone = this.normalizePhone(input.clientPhone);
        if (safePhone) {
            const phoneVariants = getPhoneIdentityVariants(safePhone);
            const byPhone = await prisma.client.findFirst({
                where: { clubId: input.clubId, phone: { in: phoneVariants } },
                select: { isProfessor: true }
            });
            if (byPhone) return Boolean(byPhone.isProfessor);
        }

        const safeEmail = String(input.clientEmail || '').trim().toLowerCase();
        if (safeEmail) {
            const byEmail = await prisma.client.findFirst({
                where: { clubId: input.clubId, email: safeEmail },
                select: { isProfessor: true }
            });
            if (byEmail) return Boolean(byEmail.isProfessor);
        }

        return false;
    }

    async quoteBookingPrice(input: BookingPriceQuoteInput): Promise<BookingPriceQuote> {
        const court = await this.courtRepo.findById(input.courtId);
        if (!court) throw new Error('Cancha no encontrada');

        const activity = await this.activityRepo.findById(input.activityId);
        if (!activity) throw new Error('Actividad no existe');
        if (activity.clubId !== (court as any).club.id) {
            throw new Error('La actividad no pertenece al club de la cancha');
        }

        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = clubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, input.startDateTime, clubTimeZone);
        if (resolvedSchedule.isClosed) {
            throw new Error('La actividad está cerrada para la fecha solicitada');
        }
        const activitySchedule = resolvedSchedule.schedule;
        const canUseAdminBenefits = Boolean(input.allowAdminBenefits);
        const isProfessorClient = canUseAdminBenefits
            ? await this.resolveClientProfessorStatus({
                clubId: (court as any).club.id,
                clientId: input.clientId ?? null,
                userId: input.userId ?? null,
                clientEmail: input.clientEmail,
                clientPhone: input.clientPhone,
                clientDni: input.clientDni
            })
            : false;
        const professorOverrideMinutes = Number(clubConfig?.professorDurationOverrideMinutes ?? 60);
        const canProfessorDurationOverride =
            Boolean(isProfessorClient) &&
            Boolean(clubConfig?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = input.durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        this.assertValidDuration(effectiveDuration);
        if (!allowedDurations.includes(effectiveDuration)) {
            if (!(canProfessorDurationOverride && effectiveDuration === professorOverrideMinutes)) {
                throw new Error('Duración no permitida por el club');
            }
        }

        // Validar que el slot solicitado exista en la grilla operativa del club para ese día.
        const localForSlot = TimeHelper.utcToLocal(input.startDateTime, clubTimeZone);
        const slotTime = `${String(localForSlot.getHours()).padStart(2, '0')}:${String(localForSlot.getMinutes()).padStart(2, '0')}`;
        const possibleSlots = buildSlotsFromSchedule(
            {
                scheduleMode: activitySchedule.mode,
                scheduleOpenTime: activitySchedule.openTime,
                scheduleCloseTime: activitySchedule.closeTime,
                scheduleIntervalMinutes: activitySchedule.intervalMinutes,
                scheduleWindows: activitySchedule.rangeWindows,
                scheduleDurations: activitySchedule.durations,
                scheduleFixedSlots: activitySchedule.fixedSlots
            },
            activity.defaultDurationMinutes,
            effectiveDuration
        ) as Array<{ slotTime: string; dayOffset: number }>;
        const hasExactSlot = possibleSlots.some((slot) => slot.slotTime === slotTime);
        if (!hasExactSlot) {
            const canUseProfessorFixedSlotFallback =
                canProfessorDurationOverride &&
                effectiveDuration === professorOverrideMinutes &&
                activitySchedule.mode === 'FIXED' &&
                Array.isArray(activitySchedule.fixedSlots) &&
                activitySchedule.fixedSlots.some((slot: any) => String(slot?.start) === slotTime);

            if (!canUseProfessorFixedSlotFallback) {
                throw new Error('Horario no permitido por el club');
            }
        }

        const endDateTime = new Date(input.startDateTime.getTime() + effectiveDuration * 60000);
        this.assertValidRange(input.startDateTime, endDateTime);

        // Mantener coherencia con createBooking: si el club está cerrado ese día, la cotización debe bloquear.
        if (!this.isClubOpenOnLocalDate(clubConfig, input.startDateTime, clubTimeZone)) {
            throw new Error('El club está cerrado ese día');
        }

        // Si el modo es rango continuo (sin ventanas partidas), validar que la reserva no exceda apertura/cierre.
        const hasSplitWindows = activitySchedule.mode === 'RANGE' && Array.isArray(activitySchedule.rangeWindows) && activitySchedule.rangeWindows.length > 0;
        const openStr = activitySchedule.mode === 'RANGE' ? activitySchedule.openTime : null;
        const closeStr = activitySchedule.mode === 'RANGE' ? activitySchedule.closeTime : null;
        if (!hasSplitWindows && openStr && closeStr) {
            const localStart = TimeHelper.utcToLocal(input.startDateTime, clubTimeZone);
            const localEnd = TimeHelper.utcToLocal(endDateTime, clubTimeZone);
            const startMinutes = localStart.getHours() * 60 + localStart.getMinutes();
            const endMinutes = localEnd.getHours() * 60 + localEnd.getMinutes();
            const openMinutes = this.toMinutes(openStr)!;
            let closeMinutes = this.toMinutes(closeStr)!;
            if (closeMinutes <= openMinutes) closeMinutes += 24 * 60;
            const startNorm = startMinutes < openMinutes ? startMinutes + 24 * 60 : startMinutes;
            const endNorm = endMinutes < openMinutes ? endMinutes + 24 * 60 : endMinutes;
            if (startNorm < openMinutes || endNorm > closeMinutes) {
                throw new Error('La reserva excede el horario de apertura del club');
            }
        }

        const basePrice = await this.pricingService.calculateCourtPrice(input.courtId, input.startDateTime);
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            throw new Error('Precio de cancha no configurado.');
        }

        const referenceDuration = this.resolvePriceReferenceDuration(activity, allowedDurations, effectiveDuration);
        let listPrice = this.calculateDurationAdjustedPrice(Number(basePrice), effectiveDuration, referenceDuration);
        if (clubConfig && clubConfig.lightsEnabled && clubConfig.lightsExtraAmount && clubConfig.lightsFromHour) {
            const [lh, lm] = String(clubConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
            if (Number.isNaN(lh) || Number.isNaN(lm)) {
                throw new Error('Configuración de club inválida: lightsFromHour debe tener formato HH:MM');
            }
            const localStart = TimeHelper.utcToLocal(input.startDateTime, clubTimeZone);
            const bookingTotalMinutes = localStart.getHours() * 60 + localStart.getMinutes();
            const lightsTotalMinutes = lh * 60 + lm;
            if (bookingTotalMinutes >= lightsTotalMinutes) {
                listPrice += Number(clubConfig.lightsExtraAmount);
            }
        }

        const quote = await prisma.$transaction(async (tx) => {
            const clientId = await this.resolveClientIdForDiscountTx(tx, {
                clubId: (court as any).club.id,
                clientId: input.clientId ?? null,
                userId: input.userId,
                clientEmail: input.clientEmail,
                clientPhone: input.clientPhone,
                clientDni: input.clientDni
            });

            const discountDraft = (!canUseAdminBenefits || input.applyDiscount === false)
                ? { total: Number(listPrice.toFixed(2)), snapshots: [] as Array<{ policyId: string; discountAmount: number }> }
                : await this.discountService.computeDraftDiscountTx(tx, {
                    clubId: (court as any).club.id,
                    clientId,
                    itemType: 'BOOKING',
                    quantity: 1,
                    unitPrice: Number(listPrice.toFixed(2)),
                    activityTypeId: input.activityId
                });

            const policyIds = Array.from(new Set(discountDraft.snapshots.map((snapshot) => snapshot.policyId)));
            const policies = policyIds.length
                ? await tx.discountPolicy.findMany({
                    where: { id: { in: policyIds } },
                    select: { id: true, name: true }
                })
                : [];
            const policyNameById = new Map(policies.map((policy) => [policy.id, policy.name]));

            const finalPrice = Number(Number(discountDraft.total || listPrice).toFixed(2));
            const normalizedListPrice = Number(Number(listPrice).toFixed(2));
            const discountAmount = Number(Math.max(0, normalizedListPrice - finalPrice).toFixed(2));

            return {
                listPrice: normalizedListPrice,
                finalPrice,
                discountAmount,
                hasDiscount: discountAmount > 0.009,
                appliedPolicies: discountDraft.snapshots.map((snapshot) => ({
                    policyId: snapshot.policyId,
                    policyName: policyNameById.get(snapshot.policyId) || 'Política sin nombre',
                    discountAmount: Number(snapshot.discountAmount || 0)
                }))
            } as BookingPriceQuote;
        });

        return quote;
    }

    private async resolveOrCreateClient(
        tx: Prisma.TransactionClient,
        input: {
        clubId: number;
        userId?: number | null;
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
        /**
         * Caso C — el humano confirmó crear un nuevo cliente aunque coincida con existentes.
         * Con este flag en true, los candidatos encontrados NO bloquean la creación.
         * Sin este flag (default), cualquier candidato lanza CLIENT_POSSIBLE_DUPLICATE.
         */
        forceCreateNew?: boolean;
    }) {
        const safeName = String(input.name ?? '').trim();
        if (!safeName) {
            throw new Error('El nombre del cliente es obligatorio');
        }

        const safePhone = this.normalizePhone(input.phone);
        const safeDni = this.normalizeDni(input.dni);
        const safeEmail = String(input.email ?? '').trim().toLowerCase();
        const safeUserId = Number.isInteger(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null;

        if (!safeUserId) {
            // Fase 1.2: email es opcional en alta rápida admin.
            // Solo phone es obligatorio para garantizar contactabilidad mínima.
            if (!safePhone) {
                throw new Error('El teléfono es obligatorio para crear un nuevo cliente.');
            }
        }

        if (safeUserId) {
            // Logged-in user path: fully self-contained, never falls through to
            // the anonymous multi-candidate logic below (which can throw CLIENT_POSSIBLE_DUPLICATE).

            // Step 1: already linked to this user in this club?
            const existingByUser = await tx.client.findFirst({
                where: { clubId: input.clubId, userId: safeUserId }
            });
            if (existingByUser) {
                await recordUserClientLinkAuditTx(tx, {
                    clubId: input.clubId,
                    userId: safeUserId,
                    clientId: String(existingByUser.id),
                    reason: 'ALREADY_LINKED',
                    source: 'BOOKING'
                });
                return existingByUser;
            }

            // Step 2 (EXACT_EMAIL_MATCH) deliberately removed.
            // Auto-linking an existing client to a user by email coincidence is
            // not allowed. A manual PATCH /admin/bookings/:id/client endpoint
            // must be used to change the titular explicitly (Commit 3).

            // Step 3: no existing linked client found.
            // MVP policy: bookings must never create automatic User<->Client links.
            // We create an operational client record without userId linkage.
            const created = await tx.client.create({
                data: {
                    clubId: input.clubId,
                    name: safeName,
                    phone: safePhone || null,
                    email: safeEmail || null,
                    dni: safeDni || null,
                    userId: null
                }
            });
            return created;
        }

        let existingByDni: any = null;
        if (safeDni) {
            existingByDni = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    dni: safeDni
                }
            });
        }

        let existingByPhone: any = null;
        if (safePhone) {
            const phoneVariants = getPhoneIdentityVariants(safePhone);
            existingByPhone = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    phone: { in: phoneVariants }
                }
            });
        }

        let existingByEmail: any = null;
        if (safeEmail) {
            existingByEmail = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    email: safeEmail
                }
            });
        }

        const candidateIds = Array.from(
            new Set(
                [existingByDni?.id, existingByPhone?.id, existingByEmail?.id]
                    .filter((value): value is string => Boolean(value))
            )
        );
        if (candidateIds.length > 1) {
            const candidateMap = new Map<string, { id: string; name: string; phone?: string | null; email?: string | null }>();
            const pushCandidate = (row: any) => {
                const id = String(row?.id || '').trim();
                if (!id || candidateMap.has(id)) return;
                candidateMap.set(id, {
                    id,
                    name: String(row?.name || '').trim() || 'Cliente sin nombre',
                    phone: row?.phone ?? null,
                    email: row?.email ?? null
                });
            };
            pushCandidate(existingByDni);
            pushCandidate(existingByPhone);
            pushCandidate(existingByEmail);
            const conflictError: any = new Error('CLIENT_POSSIBLE_DUPLICATE');
            conflictError.code = 'CLIENT_POSSIBLE_DUPLICATE';
            const reasonSignals = new Set<string>();
            if (existingByDni?.id) reasonSignals.add('DNI');
            if (existingByPhone?.id) reasonSignals.add('PHONE');
            if (existingByEmail?.id) reasonSignals.add('EMAIL');
            conflictError.details = {
                clubId: input.clubId,
                userId: safeUserId,
                candidateClientIds: candidateIds,
                reasonType: reasonSignals.size === 1 ? Array.from(reasonSignals)[0] : 'MULTI_SIGNAL_CONFLICT',
                signals: {
                    dni: safeDni || null,
                    phone: safePhone || null,
                    email: safeEmail || null
                },
                candidates: Array.from(candidateMap.values())
            };
            throw conflictError;
        }

        // Si hay exactamente un candidato, cargarlo para incluirlo en el error.
        const existingByIdentity = candidateIds.length === 1
            ? await tx.client.findUnique({ where: { id: candidateIds[0] } })
            : null;

        // Caso B — candidato único encontrado: la decisión es humana, no automática.
        // Lanzamos CLIENT_POSSIBLE_DUPLICATE igual que para múltiples candidatos.
        // La UI debe elegir: usar ese cliente, cancelar, o crear uno nuevo igualmente.
        //
        // Caso C — si forceCreateNew está activo, el humano ya confirmó crear nuevo.
        // En ese caso saltamos el error y creamos directamente.
        if (existingByIdentity && !input.forceCreateNew) {
            const reasonSignals = new Set<string>();
            if (existingByDni?.id) reasonSignals.add('DNI');
            if (existingByPhone?.id) reasonSignals.add('PHONE');
            if (existingByEmail?.id) reasonSignals.add('EMAIL');
            const conflictError: any = new Error('CLIENT_POSSIBLE_DUPLICATE');
            conflictError.code = 'CLIENT_POSSIBLE_DUPLICATE';
            conflictError.details = {
                clubId: input.clubId,
                candidateClientIds: [existingByIdentity.id],
                reasonType: reasonSignals.size === 1 ? Array.from(reasonSignals)[0] : 'IDENTITY_MATCH_REQUIRES_SELECTION',
                signals: {
                    dni: safeDni || null,
                    phone: safePhone || null,
                    email: safeEmail || null
                },
                candidates: [
                    {
                        id: String(existingByIdentity.id),
                        name: String(existingByIdentity.name || '').trim() || 'Cliente sin nombre',
                        phone: existingByIdentity.phone ?? null,
                        email: existingByIdentity.email ?? null
                    }
                ]
            };
            throw conflictError;
        }

        // Sin candidatos, o forceCreateNew confirmado: crear nuevo cliente.
        // Nunca se setea Client.userId aquí (solo en el path safeUserId arriba,
        // para usuarios logueados sin cliente previo).
        const created = await tx.client.create({
            data: {
                clubId: input.clubId,
                name: safeName,
                phone: safePhone || null,
                email: safeEmail || null,
                dni: safeDni || null
            }
        });
        return created;
    }

    private formatBookingDateTime(date: Date, timeZone: string) {
        const localDate = TimeHelper.utcToLocal(date, timeZone);
        const day = String(localDate.getDate()).padStart(2, '0');
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const year = localDate.getFullYear();
        const hours = String(localDate.getHours()).padStart(2, '0');
        const minutes = String(localDate.getMinutes()).padStart(2, '0');

        return {
            date: `${day}/${month}/${year}`,
            time: `${hours}:${minutes}`
        };
    }

    private async ensureBookingAccountWithChargeTx(
        tx: Prisma.TransactionClient,
        params: {
            bookingId: number;
            clubId: number;
            bookingPrice: number;
            activityTypeId?: number | null;
            clientId: string;
            applyDiscount?: boolean;
            actorUserId?: number | null;
        }
    ) {
        let account = await tx.account.findFirst({
            where: {
                clubId: params.clubId,
                sourceType: 'BOOKING',
                sourceId: String(params.bookingId)
            }
        });

        if (!account) {
            account = await tx.account.create({
                data: {
                    displayCode: generateDisplayCode('CTA'),
                    clubId: params.clubId,
                    sourceType: 'BOOKING',
                    sourceId: String(params.bookingId),
                    status: 'OPEN',
                    totalAmount: 0,
                    paidAmount: 0
                }
            });
        }

        const bookingCharge = Number(params.bookingPrice || 0);
        if (bookingCharge > 0) {
            const existingBookingItem = await tx.accountItem.findFirst({
                where: {
                    accountId: account.id,
                    type: 'BOOKING'
                },
                select: { id: true }
            });

            if (!existingBookingItem) {
                const discountDraft = params.applyDiscount === false
                    ? {
                        unitPrice: Number(bookingCharge.toFixed(2)),
                        total: Number(bookingCharge.toFixed(2)),
                        snapshots: []
                    }
                    : await this.discountService.computeDraftDiscountTx(tx, {
                        clubId: params.clubId,
                        clientId: params.clientId,
                        itemType: 'BOOKING',
                        quantity: 1,
                        unitPrice: bookingCharge,
                        activityTypeId: params.activityTypeId ?? null
                    });

                const bookingItem = await tx.accountItem.create({
                    data: {
                        accountId: account.id,
                        type: 'BOOKING',
                        description: 'Reserva cancha',
                        quantity: 1,
                        unitPrice: discountDraft.unitPrice,
                        total: discountDraft.total
                    }
                });

                await tx.account.update({
                    where: { id: account.id },
                    data: {
                        totalAmount: { increment: discountDraft.total }
                    }
                });

                await this.accountingService.createAccountItemTransaction(tx, {
                    clubId: params.clubId,
                    type: 'ACCOUNT_ITEM',
                    referenceType: 'BOOKING',
                    referenceId: String(params.bookingId),
                    accountId: account.id,
                    accountItemId: bookingItem.id,
                    amount: discountDraft.total,
                    revenueAccount: 'BOOKING_REVENUE',
                    description: `Reserva cancha #${params.bookingId}`
                });

                if (discountDraft.snapshots.length) {
                    await this.discountService.persistAppliedDiscountsTx(tx, {
                        clubId: params.clubId,
                        accountItemId: bookingItem.id,
                        appliedByUserId: params.actorUserId ?? null,
                        snapshots: discountDraft.snapshots
                    });
                }

                if (Math.abs(Number(discountDraft.total || 0) - bookingCharge) > 0.009) {
                    await tx.booking.update({
                        where: { id: params.bookingId },
                        data: { price: discountDraft.total }
                    });
                }
            }
        }

        await this.projectionService.refreshAccountSummary(account.id, tx);
        return account;
    }

    private buildBookingCreatedOutboxMessages(params: {
        bookingId: number;
        courtName: string;
        clubId: number;
        clubName: string;
        clubPhone?: string | null;
        clientName: string;
        clientPhone?: string | null;
        notificationUserIds?: number[];
        startDateTime: Date;
        timeZone: string;
        amount: number;
        suppressClubNotification?: boolean;
    }) {
        const cleanClientPhone = toDialablePhoneNumber(params.clientPhone);
        const cleanClubPhone = toDialablePhoneNumber(params.clubPhone);
        const { date, time } = this.formatBookingDateTime(params.startDateTime, params.timeZone);

        const clientMessage = `
🎾 *¡Reserva Registrada en ${params.clubName}!* 🎾

Hola *${params.clientName}*, tu turno ha sido agendado a través de Pique.

📅 *Fecha:* ${date}
⏰ *Hora:* ${time}
📍 *Cancha:* ${params.courtName}
💰 *Monto del turno:* $${params.amount || 0}

⚠️ *INFORMACIÓN IMPORTANTE:*
Para confirmar tu asistencia, coordinar el pago de la seña o por cualquier consulta, por favor comunicate directamente con la administración del club:
📱 *WhatsApp del Club:* ${cleanClubPhone ? `https://wa.me/${cleanClubPhone}` : 'No disponible'}

¡Gracias por usar nuestro sistema!
        `.trim();

        const clubMessage = `
🔔 *¡Nueva Reserva!* 🔔

Ingresó un nuevo turno web en *${params.clubName}*.

👤 *Cliente:* ${params.clientName}
📞 *Tel:* ${cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${date}
⏰ *Hora:* ${time}
📍 *Cancha:* ${params.courtName}
💰 *Monto:* $${params.amount || 0}
        `.trim();

        const notificationTitle = 'Reserva creada';
        const notificationMessage = `Se registró la reserva #${params.bookingId} (${params.clientName} · ${params.courtName} · ${date} ${time}).`;
        const notificationUserIds = Array.from(
            new Set(
                (params.notificationUserIds || [])
                    .map((id) => Number(id))
                    .filter((id: number) => Number.isInteger(id) && id > 0)
            )
        );

        return [
            cleanClientPhone
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.WHATSAPP_SEND,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-created:${params.bookingId}:client:${cleanClientPhone}`,
                    payload: { phone: cleanClientPhone, message: clientMessage }
                }
                : null,
            cleanClubPhone && !params.suppressClubNotification
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.WHATSAPP_SEND,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-created:${params.bookingId}:club:${cleanClubPhone}`,
                    payload: { phone: cleanClubPhone, message: clubMessage }
                }
                : null,
            ...notificationUserIds.map((userId) => ({
                clubId: params.clubId,
                type: OUTBOX_TYPES.NOTIFICATION_CREATE,
                aggregateType: 'BOOKING',
                aggregateId: String(params.bookingId),
                dedupeKey: `booking-created:${params.bookingId}:notification:${userId}`,
                payload: {
                    userId,
                    clubId: params.clubId,
                    title: notificationTitle,
                    message: notificationMessage
                }
            }))
        ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    }

    private buildBookingCancelledOutboxMessages(params: {
        bookingId: number;
        courtName: string;
        clubId: number;
        clubName: string;
        clubPhone?: string | null;
        clientName: string;
        clientPhone?: string | null;
        notificationUserId?: number | null;
        startDateTime: Date;
        timeZone: string;
        reason?: CancelBookingReason;
    }) {
        const cleanClientPhone = toDialablePhoneNumber(params.clientPhone);
        const cleanClubPhone = toDialablePhoneNumber(params.clubPhone);
        const { date, time } = this.formatBookingDateTime(params.startDateTime, params.timeZone);
        const isAutoCancel = params.reason === 'AUTO_CANCEL_UNCONFIRMED';

        const clientMessage = `
❌ *Reserva Cancelada en ${params.clubName}* ❌

Hola *${params.clientName}*, te confirmamos que tu turno ha sido anulado${isAutoCancel ? ' automáticamente por falta de confirmación' : ' a través del sistema'}.

📅 *Fecha:* ${date}
⏰ *Hora:* ${time}
📍 *Cancha:* ${params.courtName}

⚠️ *Aviso:* Si tenías una seña abonada, por favor comunicate con la administración para gestionar tu cuenta:
📱 *WhatsApp del Club:* ${cleanClubPhone ? `https://wa.me/${cleanClubPhone}` : 'No disponible'}

¡Te esperamos la próxima!
        `.trim();

        const clubMessage = `
⚠️ *¡Turno Cancelado!* ⚠️

${isAutoCancel ? 'El sistema canceló automáticamente una reserva pendiente en' : 'Un cliente canceló su reserva en'} *${params.clubName}*.

👤 *Cliente:* ${params.clientName}
📞 *Tel:* ${cleanClientPhone ? `wa.me/${cleanClientPhone}` : 'No registrado'}
📅 *Fecha:* ${date}
⏰ *Hora:* ${time}
📍 *Cancha:* ${params.courtName}

ℹ️ *La cancha ya se encuentra disponible para nuevas reservas en la grilla.*
        `.trim();

        const notificationTitle = 'Reserva cancelada';
        const notificationMessage = isAutoCancel
            ? `La reserva #${params.bookingId} fue cancelada automáticamente por falta de confirmación.`
            : `La reserva #${params.bookingId} fue cancelada correctamente.`;

        return [
            cleanClientPhone
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.WHATSAPP_SEND,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-cancelled:${params.bookingId}:client:${cleanClientPhone}`,
                    payload: { phone: cleanClientPhone, message: clientMessage }
                }
                : null,
            cleanClubPhone
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.WHATSAPP_SEND,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-cancelled:${params.bookingId}:club:${cleanClubPhone}`,
                    payload: { phone: cleanClubPhone, message: clubMessage }
                }
                : null,
            params.notificationUserId
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.NOTIFICATION_CREATE,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-cancelled:${params.bookingId}:notification:${params.notificationUserId}`,
                    payload: {
                        userId: params.notificationUserId,
                        clubId: params.clubId,
                        title: notificationTitle,
                        message: notificationMessage
                    }
                }
                : null
        ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    }

    async getBookingFinancialSummary(bookingId: number, clubId: number) {
        const summary = await prisma.$transaction((tx) => this.bookingDomainService.getBookingFinancialSummaryTx(tx, bookingId, clubId));
        const courtTotal = summary.account.items
            .filter((item) => item.type === 'BOOKING')
            .reduce((sum, item) => sum + Number(item.total || 0), 0);
        const itemsTotal = summary.account.items
            .filter((item) => item.type !== 'BOOKING')
            .reduce((sum, item) => sum + Number(item.total || 0), 0);

        const autoCancelEnabled = summary.confirmationSettings.autoCancelPendingBookingsEnabled;
        const autoCancelMinutesBefore = summary.confirmationSettings.autoCancelPendingBookingsMinutesBefore;
        const autoCancelOnlyIfUnpaid = summary.confirmationSettings.autoCancelPendingBookingsOnlyIfUnpaid;
        const autoCancelAt = autoCancelEnabled && Number.isFinite(Number(autoCancelMinutesBefore)) && Number(autoCancelMinutesBefore) > 0
            ? new Date(summary.booking.startDateTime.getTime() - Number(autoCancelMinutesBefore) * 60_000)
            : null;
        const autoCancelBlockedByPayment = Boolean(
            autoCancelEnabled &&
            autoCancelOnlyIfUnpaid &&
            summary.paid > 0.009
        );
        const autoCancelEligibleNow = Boolean(
            autoCancelEnabled &&
            summary.booking.status === 'PENDING' &&
            autoCancelAt &&
            !autoCancelBlockedByPayment &&
            Date.now() >= autoCancelAt.getTime()
        );

        let autoCancelStatusLabel = 'No aplica';
        if (!autoCancelEnabled) {
            autoCancelStatusLabel = 'Cancelación automática desactivada';
        } else if (summary.booking.status !== 'PENDING') {
            autoCancelStatusLabel = 'No aplica por estado';
        } else if (autoCancelBlockedByPayment) {
            autoCancelStatusLabel = 'No se cancelara automaticamente porque tiene pagos';
        } else if (!autoCancelAt) {
            autoCancelStatusLabel = 'Configuración incompleta';
        } else if (autoCancelEligibleNow) {
            autoCancelStatusLabel = 'Lista para cancelación automática ahora';
        } else {
            autoCancelStatusLabel = 'Se cancelara automaticamente al llegar la hora';
        }

        let lightsEnabled = false;
        let lightsApplies = false;
        let lightsFromHour: string | null = null;
        let lightsExtraAmount = 0;
        let courtBaseAmount = Number(courtTotal || 0);

        const clubWithSettings = await prisma.club.findUnique({
            where: { id: summary.booking.clubId },
            include: { settings: true }
        });
        const settings = clubWithSettings?.settings;
        if (settings) {
            lightsEnabled = Boolean(settings.lightsEnabled);
            lightsFromHour = settings.lightsFromHour ? String(settings.lightsFromHour) : null;
            const configuredLightsExtra = settings.lightsExtraAmount == null ? null : Number(settings.lightsExtraAmount);
            const clubTimeZone = String(settings.timeZone || 'America/Argentina/Buenos_Aires');
            const localStart = TimeHelper.utcToLocal(summary.booking.startDateTime, clubTimeZone);

            if (
                lightsEnabled &&
                Number.isFinite(Number(configuredLightsExtra)) &&
                Number(configuredLightsExtra) > 0 &&
                lightsFromHour &&
                /^\d{2}:\d{2}$/.test(lightsFromHour)
            ) {
                const [lh, lm] = lightsFromHour.split(':').map((n) => Number.parseInt(n, 10));
                if (!Number.isNaN(lh) && !Number.isNaN(lm)) {
                    const bookingTotalMinutes = localStart.getHours() * 60 + localStart.getMinutes();
                    const lightsTotalMinutes = lh * 60 + lm;
                    if (bookingTotalMinutes >= lightsTotalMinutes) {
                        lightsApplies = true;
                        lightsExtraAmount = Number(Number(configuredLightsExtra).toFixed(2));
                    }
                }
            }
        }

        if (lightsExtraAmount > 0.009) {
            courtBaseAmount = Number(Math.max(0, Number(courtTotal || 0) - lightsExtraAmount).toFixed(2));
        }

        return {
            courtTotal,
            itemsTotal,
            total: summary.total,
            paid: summary.paid,
            remaining: summary.remaining,
            depositRequiredAmount: summary.depositRequiredAmount,
            depositCovered: summary.depositCovered,
            paymentStatus: summary.paymentStatus,
            confirmationMode: summary.confirmationSettings.bookingConfirmationMode,
            requiredToConfirm: summary.depositRequiredAmount,
            remainingToConfirm: Number(Math.max(0, summary.depositRequiredAmount - summary.paid).toFixed(2)),
            isPendingByInsufficientPayment:
                summary.booking.status === 'PENDING' &&
                summary.confirmationSettings.bookingConfirmationMode === 'DEPOSIT_REQUIRED' &&
                summary.paid > 0.009 &&
                summary.paid + 0.009 < summary.depositRequiredAmount,
            autoCancelStatus: {
                enabled: autoCancelEnabled,
                minutesBefore: autoCancelMinutesBefore,
                onlyIfUnpaid: autoCancelOnlyIfUnpaid,
                blockedByPayment: autoCancelBlockedByPayment,
                eligibleNow: autoCancelEligibleNow,
                autoCancelAt: autoCancelAt ? autoCancelAt.toISOString() : null,
                label: autoCancelStatusLabel
            },
            pricingBreakdown: {
                courtBaseAmount,
                lightsExtraAmount,
                lightsEnabled,
                lightsApplies,
                lightsFromHour
            }
        };
    }

    async createBooking(
        userId: number | null,
        courtId: number,
        startDateTime: Date,
        activityId: number,
        durationMinutes?: number,
        createdByAdmin = false,
        options?: CreateBookingOptions
    ): Promise<Booking> {
        let user: User | null = null;
        const requestedClientId = String(options?.clientId || '').trim();
        const requestedClientDraftName = String(options?.clientDraft?.name || '').trim();
        const requestedClientDraftPhone = this.normalizePhone(options?.clientDraft?.phone);
        // requestedClientDraftEmail eliminado (Fase 1.2): email ya no es obligatorio en alta rápida admin.

        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else {
            if (!requestedClientId && requestedClientDraftName.length < 2) {
                throw new Error("Debes seleccionar un cliente o cargar un alta rápida válida.");
            }
            // Fase 1.2: email es opcional. Solo phone es obligatorio.
            if (!requestedClientId && !requestedClientDraftPhone) {
                throw new Error("El teléfono es obligatorio para el alta rápida de cliente.");
            }
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");
        if (activity.clubId !== (court as any).club.id) {
            throw new Error('La actividad no pertenece al club de la cancha');
        }
        const bookingClubId = (court as any).club.id;
        const isProfessorClient = await this.resolveClientProfessorStatus({
            clubId: bookingClubId,
            clientId: options?.clientId ?? null,
            userId: user?.id ?? null,
            clientEmail: options?.clientDraft?.email ?? user?.email ?? undefined,
            clientPhone: options?.clientDraft?.phone ?? user?.phoneNumber ?? undefined,
            clientDni: options?.clientDraft?.dni ?? undefined
        });
        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = (clubConfig && clubConfig.timeZone) ? clubConfig.timeZone : 'America/Argentina/Buenos_Aires';
        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, startDateTime, clubTimeZone);
        if (resolvedSchedule.isClosed) {
            throw new Error('La actividad está cerrada para la fecha seleccionada');
        }
        const activitySchedule = resolvedSchedule.schedule;
        const professorOverrideMinutes = Number(clubConfig?.professorDurationOverrideMinutes ?? 60);
        const canProfessorDurationOverride =
            createdByAdmin &&
            Boolean(isProfessorClient) &&
            Boolean(clubConfig?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        if (
            clubConfig?.bookingConfirmationMode === 'DEPOSIT_REQUIRED' &&
            (!Number.isFinite(Number(clubConfig?.bookingDepositPercent)) || Number(clubConfig?.bookingDepositPercent) <= 0)
        ) {
            throw new Error('El club requiere una seña pero no tiene bookingDepositPercent válido');
        }
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        this.assertValidDuration(effectiveDuration);
        // Regla operativa explícita: permitir duración especial profesor aunque no esté en scheduleDurations
        if (!allowedDurations.includes(effectiveDuration)) {
            if (!(canProfessorDurationOverride && effectiveDuration === professorOverrideMinutes)) {
                throw new Error("Duración no permitida por el club");
            }
        }

        // Determinar slotTime en la zona horaria del club
        const localForSlot = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
        const slotTime = `${String(localForSlot.getHours()).padStart(2, '0')}:${String(localForSlot.getMinutes()).padStart(2, '0')}`;
        const possibleSlots = buildSlotsFromSchedule(
            {
                scheduleMode: activitySchedule.mode,
                scheduleOpenTime: activitySchedule.openTime,
                scheduleCloseTime: activitySchedule.closeTime,
                scheduleIntervalMinutes: activitySchedule.intervalMinutes,
                scheduleWindows: activitySchedule.rangeWindows,
                scheduleDurations: activitySchedule.durations,
                scheduleFixedSlots: activitySchedule.fixedSlots
            },
            activity.defaultDurationMinutes,
            effectiveDuration
        ) as Array<{ slotTime: string; dayOffset: number }>;
        const possibleSlotTimes = possibleSlots.map(s => s.slotTime);
        const hasExactSlot = possibleSlotTimes.includes(slotTime);

        if (!hasExactSlot) {
            const canUseProfessorFixedSlotFallback =
                canProfessorDurationOverride &&
                effectiveDuration === professorOverrideMinutes &&
                activitySchedule.mode === 'FIXED' &&
                Array.isArray(activitySchedule.fixedSlots) &&
                activitySchedule.fixedSlots.some((slot: any) => String(slot?.start) === slotTime);

            if (!canUseProfessorFixedSlotFallback) {
                throw new Error("Horario no permitido por el club");
            }
        }

        // Verificar días de apertura del club (en la zona horaria del club)
        if (!this.isClubOpenOnLocalDate(clubConfig, startDateTime, clubTimeZone)) {
            throw new Error('El club está cerrado ese día');
        }

        // Política de anticipación para reservas simples.
        const skipAdvanceLimitByConfig = createdByAdmin && Boolean(clubConfig?.allowAdminSkipSimpleAdvanceLimit);
        if (!options?.skipAdvanceLimit && !skipAdvanceLimitByConfig) {
            const maxAdvanceDays = createdByAdmin
                ? Number(clubConfig?.bookingSimpleAdvanceDaysAdmin ?? 30)
                : Number(clubConfig?.bookingSimpleAdvanceDaysUser ?? 30);
            const safeMaxAdvanceDays = Number.isFinite(maxAdvanceDays) ? Math.max(0, Math.floor(maxAdvanceDays)) : 30;

            const todayLocalStart = this.getLocalDayStart(new Date(), clubTimeZone);
            const bookingLocalStart = this.getLocalDayStart(startDateTime, clubTimeZone);
            const diffDays = Math.floor((bookingLocalStart.getTime() - todayLocalStart.getTime()) / (24 * 60 * 60 * 1000));

            if (diffDays > safeMaxAdvanceDays) {
                const actorLabel = createdByAdmin ? 'administradores' : 'usuarios';
                throw new Error(`Límite de anticipación excedido para ${actorLabel}: máximo ${safeMaxAdvanceDays} días`);
            }
        }

        const endDateTime = new Date(startDateTime.getTime() + effectiveDuration * 60000);
        this.assertValidRange(startDateTime, endDateTime);

        // Validar que la reserva quede dentro del horario de apertura/cierre si el club lo define
        try {
            const hasSplitWindows = activitySchedule.mode === 'RANGE' && Array.isArray(activitySchedule.rangeWindows) && activitySchedule.rangeWindows.length > 0;
            const openStr = activitySchedule.mode === 'RANGE' ? activitySchedule.openTime : null;
            const closeStr = activitySchedule.mode === 'RANGE' ? activitySchedule.closeTime : null;
            if (!hasSplitWindows && openStr && closeStr) {
                const localStart = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
                const localEnd = TimeHelper.utcToLocal(endDateTime, clubTimeZone);
                const startMinutes = localStart.getHours() * 60 + localStart.getMinutes();
                const endMinutes = localEnd.getHours() * 60 + localEnd.getMinutes();
                const openMinutes = this.toMinutes(openStr)!;
                let closeMinutes = this.toMinutes(closeStr)!;
                if (closeMinutes <= openMinutes) closeMinutes += 24 * 60;
                const startNorm = startMinutes < openMinutes ? startMinutes + 24 * 60 : startMinutes;
                const endNorm = endMinutes < openMinutes ? endMinutes + 24 * 60 : endMinutes;
                if (startNorm < openMinutes || endNorm > closeMinutes) {
                    throw new Error('La reserva excede el horario de apertura del club');
                }
            }
        } catch (err) {
            throw err;
        }

    // Calcular precio base dinámico por reglas horarias y extra por luces según configuración del club
        const BASE_PRICE = await this.pricingService.calculateCourtPrice(courtId, startDateTime);
        if (!Number.isFinite(BASE_PRICE) || BASE_PRICE <= 0) {
            throw new Error('Precio de cancha no configurado.');
        }
        const clubPricingConfig = this.resolveClubConfig((court as any)?.club);
        const referenceDuration = this.resolvePriceReferenceDuration(activity, allowedDurations, effectiveDuration);
        let finalPrice = this.calculateDurationAdjustedPrice(BASE_PRICE, effectiveDuration, referenceDuration);
        // El descuento económico no se calcula acá: se unifica en DiscountPolicy sobre AccountItem.
        if (clubPricingConfig && clubPricingConfig.lightsEnabled && clubPricingConfig.lightsExtraAmount && clubPricingConfig.lightsFromHour) {
                try {
                    const [lh, lm] = String(clubPricingConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
                    if (!Number.isNaN(lh) && !Number.isNaN(lm)) {
                            const localStart = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
                            const bookingHour = localStart.getHours();
                            const bookingMinutes = localStart.getMinutes();
                        const bookingTotalMinutes = bookingHour * 60 + bookingMinutes;
                        const lightsTotalMinutes = lh * 60 + lm;
                        if (bookingTotalMinutes >= lightsTotalMinutes) {
                            finalPrice += Number(clubPricingConfig.lightsExtraAmount);
                        }
                    }
                } catch {
                // Si algo falla en el parseo, seguimos cobrando solo el precio base
            }
        }

        const created = await prisma.$transaction(async (tx: any) => {
            const overlapping = await tx.booking.findMany({
                where: {
                    courtId: courtId,
                    AND: [
                        { startDateTime: { lt: endDateTime } },
                        { endDateTime: { gt: startDateTime } }
                    ],
                    NOT: { status: BookingStatus.CANCELLED }
                },
                include: { user: true, client: true, court: { include: { club: true } }, activity: true }
            });

            if (overlapping.length > 0) {
                const error: any = new Error('El horario se superpone con reservas existentes.');
                error.code = 'BOOKING_OVERLAP';
                error.overlaps = overlapping.map((item: any) => ({
                    bookingId: item.id,
                    startDateTime: item.startDateTime,
                    endDateTime: item.endDateTime,
                    status: item.status,
                    courtName: item?.court?.name || '',
                    activityName: item?.activity?.name || '',
                    clientName: item?.client?.name
                        || `${item?.user?.firstName || ''} ${item?.user?.lastName || ''}`.trim()
                        || 'Cliente'
                }));
                throw error;
            }

            let saved;
            try {
                let resolvedClient: any = null;

                if (requestedClientId) {
                    resolvedClient = await tx.client.findFirst({
                        where: {
                            id: requestedClientId,
                            clubId: bookingClubId
                        }
                    });
                    if (!resolvedClient) {
                        throw new Error('Cliente no encontrado para el club seleccionado');
                    }
                }

                if (!resolvedClient) {
                    let dniForClient: string | null = options?.clientDraft?.dni ?? null;
                    if (!dniForClient && user?.id) {
                        const dbUser = await tx.user.findUnique({
                            where: { id: Number(user.id) },
                            select: { dni: true }
                        });
                        dniForClient = dbUser?.dni || null;
                    }

                    const draftName = String(options?.clientDraft?.name || '').trim()
                        || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
                        || user?.firstName
                        || 'Cliente';

                    resolvedClient = await this.resolveOrCreateClient(tx, {
                        clubId: bookingClubId,
                        userId: user?.id ?? null,
                        name: draftName,
                        phone: options?.clientDraft?.phone ?? user?.phoneNumber ?? null,
                        email: options?.clientDraft?.email ?? user?.email ?? null,
                        dni: dniForClient,
                        forceCreateNew: options?.clientDraft?.duplicateResolution === 'CREATE_NEW'
                    });
                }

                if (!resolvedClient?.id) {
                    throw new Error('No se pudo resolver un cliente para la reserva');
                }

                const initialStatus = resolveInitialBookingStatus(
                    (clubConfig?.bookingConfirmationMode ?? 'MANUAL') as 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED'
                );

                saved = await tx.booking.create({
                    data: {
                        displayCode: generateDisplayCode('RES'),
                        startDateTime,
                        endDateTime,
                        listPrice: finalPrice,
                        price: finalPrice,
                        status: initialStatus,
                        userId: user ? user.id : null,
                        clientId: resolvedClient.id,
                        courtId: courtId,
                        activityId: activityId,
                        clubId: bookingClubId
                    },
                    include: { user: true, client: true, court: { include: { club: true } }, activity: true }
                });

                // Estrategia lazy: para turnos simples no abrimos cuenta al crear.
                // Solo se crea al confirmar, agregar consumos o registrar pagos.
                if (initialStatus === 'CONFIRMED' || options?.skipAccountCreation === false) {
                    await this.ensureBookingAccountWithChargeTx(tx, {
                        bookingId: saved.id,
                        clubId: bookingClubId,
                        bookingPrice: Number(saved.price || 0),
                        activityTypeId: saved.activityId,
                        clientId: saved.clientId,
                        applyDiscount: options?.applyDiscount,
                        actorUserId: user?.id ?? null
                    });
                    const refreshed = await tx.booking.findUnique({
                        where: { id: saved.id },
                        include: { user: true, client: true, court: { include: { club: true } }, activity: true }
                    });
                    if (refreshed) {
                        saved = refreshed;
                    }
                }
                const bookingResponsibleRef = this.resolveBookingResponsibleRef({
                    clientId: saved.clientId,
                    userId: saved.userId
                });
                const initialBillingAssignments: PersistedBillingAssignmentsJson = {
                    schemaVersion: 1,
                    assignments: [
                        {
                            id: 'asg-booking-responsible',
                            participantRef: bookingResponsibleRef,
                            isChargeable: true,
                            assignedAmount: this.roundCurrency(saved.price),
                            participantLinkState: 'ACTIVE'
                        }
                    ]
                };
                const initialBillingMetadata = {
                    schemaVersion: 1 as const,
                    source: 'PERSISTED' as const,
                    initializedBy: 'BOOKING_CREATED'
                };
                await tx.bookingBillingConfig.upsert({
                    where: { bookingId: saved.id },
                    create: {
                        bookingId: saved.id,
                        clubId: bookingClubId,
                        chargeMode: ChargeMode.INDIVIDUAL,
                        chargeResponsibleRef: bookingResponsibleRef,
                        assignmentsJson: initialBillingAssignments as unknown as Prisma.InputJsonValue,
                        metadataJson: initialBillingMetadata as unknown as Prisma.InputJsonValue,
                        createdByUserId: Number(options?.actorUserId || user?.id || 0) || null,
                        updatedByUserId: Number(options?.actorUserId || user?.id || 0) || null
                    },
                    update: {
                        chargeMode: ChargeMode.INDIVIDUAL,
                        chargeResponsibleRef: bookingResponsibleRef,
                        assignmentsJson: initialBillingAssignments as unknown as Prisma.InputJsonValue,
                        metadataJson: initialBillingMetadata as unknown as Prisma.InputJsonValue,
                        updatedByUserId: Number(options?.actorUserId || user?.id || 0) || null
                    }
                });

                await this.eventService.bookingCreated(bookingClubId, {
                    bookingId: saved.id,
                    clubId: bookingClubId,
                    userId: user?.id ?? null,
                    courtId,
                    activityId,
                    amount: Number(saved.price || 0)
                }, tx);
                await this.eventService.bookingParticipantAdded(bookingClubId, {
                    bookingId: saved.id,
                    addedParticipantRefs: [bookingResponsibleRef],
                    addedParticipantsCount: 1,
                    actorUserId: Number(options?.actorUserId || user?.id || 0) || null,
                    participantRole: 'BOOKING_RESPONSIBLE',
                    source: 'BOOKING_CREATED'
                }, tx);

                const clientName = String(
                    resolvedClient?.name
                    || user?.firstName
                    || 'Jugador'
                );
                const clientPhone = resolvedClient?.phone || user?.phoneNumber || null;
                const clubPhone = (court as any)?.club?.phone ?? null;
                const timeZone = clubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
                const adminMemberships = await tx.membership.findMany({
                    where: {
                        clubId: bookingClubId,
                        role: { in: ['OWNER', 'ADMIN'] }
                    },
                    select: { userId: true }
                });
                const notificationUserIds: number[] = Array.from(
                    new Set(
                        (adminMemberships || [])
                            .map((membership: { userId: number }) => Number(membership.userId))
                            .filter((id: number) => Number.isInteger(id) && id > 0)
                    )
                );
                const outboxMessages = this.buildBookingCreatedOutboxMessages({
                    bookingId: saved.id,
                    clubId: bookingClubId,
                    clubName: (court as any)?.club?.name || 'el complejo',
                    clubPhone,
                    courtName: court.name,
                    clientName,
                    clientPhone,
                    notificationUserIds,
                    startDateTime,
                    timeZone,
                    amount: Number(saved.price || 0),
                    suppressClubNotification: createdByAdmin
                });

                await this.outboxService.enqueueMany(outboxMessages, tx);
            } catch (error) {
                if (this.isOverlapConstraintError(error)) {
                    throw new Error('SLOT_ALREADY_BOOKED');
                }
                throw error;
            }

            return saved;
        });

        console.info('[BOOKING] Reserva creada', {
            bookingId: created.id,
            courtId,
            activityId,
            clubId: (court as any).club.id,
            startDateTime: created.startDateTime.toISOString(),
            endDateTime: created.endDateTime.toISOString()
        });

        await this.auditLogService.create({
            clubId: (court as any).club.id,
            userId: user?.id ?? null,
            entity: 'Booking',
            entityId: String(created.id),
            action: 'BOOKING_CREATE',
            payload: {
                courtId,
                activityId,
                startDateTime: created.startDateTime,
                endDateTime: created.endDateTime,
                amount: Number(created.price || 0),
                professorOverrideApplied: canProfessorDurationOverride,
                professorFromClient: Boolean(isProfessorClient),
                professorDurationOverrideMinutes: canProfessorDurationOverride ? professorOverrideMinutes : null
            }
        });

        return this.bookingRepo.mapToEntity(created);
    }

    async getAvailableSlots(courtId: number, date: Date, activityId: number, durationMinutes?: number): Promise<string[]> {
        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");

        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = clubConfig.timeZone ?? 'America/Argentina/Buenos_Aires';

        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, date, clubTimeZone);
        if (resolvedSchedule.isClosed) {
            return [];
        }
        const activitySchedule = resolvedSchedule.schedule;

        // Si el club está cerrado ese día, retornamos vacío
        if (!this.isClubOpenOnLocalDate(clubConfig, date, clubTimeZone)) {
            return [];
        }
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, clubTimeZone);

        const existingBookings = await prisma.booking.findMany({
            where: {
                courtId: courtId,
                startDateTime: { lt: endUtc },
                endDateTime: { gt: startUtc },
                status: { not: 'CANCELLED' }
            }
        });
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        if (!allowedDurations.includes(effectiveDuration)) {
            throw new Error("Duración no permitida por el club");
        }

        const possibleSlots = buildSlotsFromSchedule(
            {
                scheduleMode: activitySchedule.mode,
                scheduleOpenTime: activitySchedule.openTime,
                scheduleCloseTime: activitySchedule.closeTime,
                scheduleIntervalMinutes: activitySchedule.intervalMinutes,
                scheduleWindows: activitySchedule.rangeWindows,
                scheduleDurations: activitySchedule.durations,
                scheduleFixedSlots: activitySchedule.fixedSlots
            },
            activity.defaultDurationMinutes,
            effectiveDuration
        ) as Array<{ slotTime: string; dayOffset: number }>;

        const anchors = [
            (() => { const d = new Date(date); d.setDate(d.getDate() - 1); return d; })(),
            new Date(date)
        ];

        const now = new Date();
        const duration = effectiveDuration;
        const seen = new Set<string>();
        const freeSlotsResult: string[] = [];

        for (const anchor of anchors) {
            for (const slotObj of possibleSlots) {
                const slotDateCandidate = new Date(anchor);
                slotDateCandidate.setDate(slotDateCandidate.getDate() + (slotObj.dayOffset || 0));
                if (
                    slotDateCandidate.getFullYear() !== date.getFullYear() ||
                    slotDateCandidate.getMonth() !== date.getMonth() ||
                    slotDateCandidate.getDate() !== date.getDate()
                ) continue;

                let slotStartDate: Date;
                try {
                    slotStartDate = TimeHelper.localSlotToUtc(slotDateCandidate, slotObj.slotTime, clubTimeZone);
                } catch {
                    continue;
                }
                if (slotStartDate.getTime() <= now.getTime()) continue;

                const slotEndDate = new Date(slotStartDate.getTime() + duration * 60000);

                const isOccupied = existingBookings.some(booking => {
                    if (booking.status === "CANCELLED") return false;
                    return TimeHelper.isOverlappingDates(
                        slotStartDate,
                        slotEndDate,
                        booking.startDateTime,
                        booking.endDateTime
                    );
                });

                if (!isOccupied && !seen.has(slotObj.slotTime)) {
                    seen.add(slotObj.slotTime);
                    freeSlotsResult.push(slotObj.slotTime);
                }
            }
        }

        return freeSlotsResult;
    }

    async cancelBooking(bookingId: number, cancelledByUserId: number | null, clubId?: number, options?: CancelBookingOptions) {
        const reason = options?.reason ?? 'MANUAL';
        const now = options?.now ?? new Date();
        const skipAccessValidation = options?.skipAccessValidation ?? false;
        const isAutoCancel = reason === 'AUTO_CANCEL_UNCONFIRMED';

        const booking = await this.bookingRepo.findById(bookingId);
        if (!booking) {
            throw new Error("La reserva no existe.");
        }
        if (!skipAccessValidation) {
            if (clubId != null) {
                if (booking.court.club.id !== clubId) {
                    throw new Error("No tienes acceso a esta reserva");
                }
            } else {
                if (!booking.user || booking.user.id !== cancelledByUserId) {
                    throw new Error("No tienes acceso a esta reserva");
                }
            }
        }
        if (!isAutoCancel && !isBookingTransitionAllowed(booking.status as any, 'CANCELLED')) {
            throw new Error('Solo se pueden cancelar reservas pendientes o confirmadas');
        }

        let wasCancelled = false;
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw<Array<{ id: number }>>`
              SELECT "id"
              FROM "Booking"
              WHERE "id" = ${bookingId}
              FOR UPDATE
            `;

            const currentBooking = await tx.booking.findUnique({
                where: { id: bookingId },
                include: {
                    user: true,
                    client: true,
                    court: { include: { club: { include: { settings: true } } } },
                    activity: true
                }
            });
            if (!currentBooking) {
                throw new Error('La reserva no existe.');
            }

            if (isAutoCancel) {
                if (currentBooking.status !== 'PENDING') return;

                const settings = currentBooking.court.club.settings;
                const autoCancelEnabled = settings?.autoCancelPendingBookingsEnabled ?? false;
                const cancelMinutes = settings?.autoCancelPendingBookingsMinutesBefore == null
                    ? null
                    : Number(settings.autoCancelPendingBookingsMinutesBefore);
                const onlyIfUnpaid = settings?.autoCancelPendingBookingsOnlyIfUnpaid ?? true;

                if (!autoCancelEnabled || !Number.isFinite(cancelMinutes) || Number(cancelMinutes) <= 0) return;
                const cancelAt = new Date(currentBooking.startDateTime.getTime() - Number(cancelMinutes) * 60_000);
                if (now.getTime() < cancelAt.getTime()) return;

                if (onlyIfUnpaid) {
                    const account = await tx.account.findFirst({
                        where: {
                            sourceType: 'BOOKING',
                            sourceId: String(bookingId),
                            clubId: currentBooking.court.club.id
                        },
                        select: { id: true }
                    });
                    if (account) {
                        const netPaid = await this.accountService.calculateNetPaidAmountTx(tx, account.id);
                        if (netPaid > 0.009) return;
                    }
                }
            } else if (!isBookingTransitionAllowed(currentBooking.status as any, 'CANCELLED')) {
                throw new Error('Solo se pueden cancelar reservas pendientes o confirmadas');
            }

            const account = await tx.account.findFirst({
                where: {
                    sourceType: 'BOOKING',
                    sourceId: String(bookingId),
                    clubId: booking.court.club.id
                },
                select: { id: true, totalAmount: true }
            });
            if (currentBooking.status === 'CONFIRMED' && !account) {
                throw new Error(
                    `Inconsistencia de integridad: la reserva ${bookingId} está CONFIRMED pero no tiene Account BOOKING y no puede cancelarse`
                );
            }
            const totalAmount = account ? Number(account.totalAmount || 0) : 0;
            const paidAmount = account ? await this.accountService.calculateNetPaidAmountTx(tx, account.id) : 0;

            await tx.booking.update({
                where: { id: bookingId },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                    ...(cancelledByUserId ? { cancelledBy: cancelledByUserId } : {})
                    ,
                    ...(isAutoCancel ? {
                        autoCancelledAt: now,
                        autoCancelReason: reason
                    } : {})
                }
            });

            const requestedRefundAmount = Number(options?.refund?.amount ?? paidAmount);
            const shouldExecuteRefundNow = options?.refund?.executeNow ?? true;
            const targetRefundAmount = Number.isFinite(requestedRefundAmount)
                ? Number(Math.max(0, Math.min(paidAmount, requestedRefundAmount)).toFixed(2))
                : Number(paidAmount.toFixed(2));

            if (paidAmount > 0.009 && targetRefundAmount <= 0.009) {
                throw new Error('Para cancelar una reserva con pagos, debes devolver al menos una parte del monto pagado.');
            }
            if (!shouldExecuteRefundNow && targetRefundAmount + 0.009 < paidAmount) {
                throw new Error('No se permite cancelar con devolucion parcial pendiente. Ejecuta la devolucion parcial ahora o devuelve el total.');
            }

            let refundedAmount = 0;
            let netPaidAfterRefund = paidAmount;
            if (paidAmount > 0.009 && account) {
                const refunds = await this.refundService.refundBookingPaymentsTx(tx, {
                    bookingId: booking.id,
                    clubId: booking.court.club.id,
                    reason: `Cancelacion reserva #${booking.id}`,
                    reasonType: options?.refund?.reasonType,
                    executionNotes: options?.refund?.executionNotes,
                    createdByUserId: cancelledByUserId ?? undefined,
                    amount: targetRefundAmount,
                    executeNow: shouldExecuteRefundNow
                });
                refundedAmount = Number(refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));

                if (refundedAmount + 0.009 < targetRefundAmount) {
                    throw new Error('No se pudo cubrir el monto de devolucion solicitado');
                }

                const reconciliation = await this.accountService.reconcilePaidAmountTx(tx, account.id, {
                    updateStatus: false,
                    reopenIfRemaining: false
                });
                netPaidAfterRefund = reconciliation.netPaid;
            }

            const retainedAmount = shouldExecuteRefundNow
                ? Number(Math.max(0, netPaidAfterRefund).toFixed(2))
                : Number(Math.max(0, paidAmount - refundedAmount).toFixed(2));
            const reversalAmount = Number(Math.max(0, totalAmount - retainedAmount).toFixed(2));

            if (account && reversalAmount > 0.009) {
                const adjustmentItem = await tx.accountItem.create({
                    data: {
                        accountId: account.id,
                        type: 'ADJUSTMENT',
                        description: `Cancelacion reserva #${booking.id}`,
                        quantity: 1,
                        unitPrice: new Prisma.Decimal(-reversalAmount),
                        total: new Prisma.Decimal(-reversalAmount)
                    }
                });

                await tx.account.update({
                    where: { id: account.id },
                    data: {
                        totalAmount: new Prisma.Decimal(retainedAmount),
                        paidAmount: new Prisma.Decimal(retainedAmount)
                    }
                });

                await this.accountingService.reverseAccountItemTransaction(tx, {
                    clubId: booking.court.club.id,
                    type: 'ADJUSTMENT',
                    referenceType: 'ACCOUNT_ITEM',
                    referenceId: adjustmentItem.id,
                    accountId: account.id,
                    accountItemId: adjustmentItem.id,
                    amount: reversalAmount,
                    revenueAccount: 'ADJUSTMENTS',
                    description: `Anulacion obligacion reserva #${booking.id}`,
                    createdByUserId: cancelledByUserId ?? null
                });
            } else if (account) {
                await tx.account.update({
                    where: { id: account.id },
                    data: {
                        totalAmount: new Prisma.Decimal(retainedAmount),
                        paidAmount: new Prisma.Decimal(retainedAmount)
                    }
                });
            }

            if (account) {
                await tx.account.update({
                    where: { id: account.id },
                    data: {
                        status: 'CLOSED',
                        closedAt: new Date()
                    }
                });
            }

            await this.eventService.bookingCancelled(booking.court.club.id, {
                bookingId,
                userId: currentBooking.user?.id ?? null,
                cancelledByUserId: cancelledByUserId ?? null,
                clubId: booking.court.club.id
            }, tx);

            const clubPhone = (booking.court.club as any)?.phone ?? null;
            const clientPhone =
                currentBooking.user?.phoneNumber ||
                currentBooking.client?.phone ||
                null;

            const clientName =
                currentBooking.user?.firstName ||
                currentBooking.client?.name ||
                'Jugador';
            const timeZone = (booking.court.club as any)?.timeZone || 'America/Argentina/Buenos_Aires';
            const outboxMessages = this.buildBookingCancelledOutboxMessages({
                bookingId,
                clubId: booking.court.club.id,
                clubName: booking.court.club.name,
                clubPhone,
                courtName: booking.court.name,
                clientName,
                clientPhone,
                notificationUserId: currentBooking.user?.id ?? null,
                startDateTime: currentBooking.startDateTime,
                timeZone,
                reason
            });

            await this.outboxService.enqueueMany(outboxMessages, tx);
            if (account) {
                await this.projectionService.refreshAccountSummary(account.id, tx);
            }
            wasCancelled = true;
        });

        if (!wasCancelled && isAutoCancel) {
            return this.bookingRepo.findById(bookingId);
        }

        console.info('[BOOKING] Reserva cancelada', {
            bookingId,
            cancelledByUserId,
            clubId: booking.court.club.id,
            reason
        });

        await this.auditLogService.create({
            clubId: booking.court.club.id,
            userId: cancelledByUserId ?? null,
            entity: 'Booking',
            entityId: String(bookingId),
            action: isAutoCancel ? 'BOOKING_AUTO_CANCEL' : 'BOOKING_CANCEL',
            payload: {
                cancelledByUserId,
                courtId: booking.court.id,
                activityId: booking.activity.id,
                reason
            }
        });
        
        const updated = await this.bookingRepo.findById(bookingId);
        return updated;
    }

    // Commit 3 — Titular canónico: cambio explícito de cliente en una reserva.
    // Solo OWNER/ADMIN. El nuevo clientId debe pertenecer al mismo club.
    // Bloqueado si la cuenta tiene pagos o devoluciones registrados.
    async changeBookingClient(params: {
        bookingId: number;
        newClientId: string;
        actorUserId: number;
        clubId: number;
        reason?: string | null;
    }) {
        const { bookingId, newClientId, actorUserId, clubId, reason } = params;

        return prisma.$transaction(async (tx) => {
            // 1. Cargar la reserva y validar que pertenece al club
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                select: { id: true, clubId: true, clientId: true, status: true }
            });
            if (!booking) {
                throw new Error('Reserva no encontrada o no pertenece al club');
            }

            const oldClientId = booking.clientId;

            if (oldClientId === newClientId) {
                throw new Error('El nuevo titular es el mismo que el actual');
            }
            if (!['PENDING', 'CONFIRMED'].includes(String(booking.status || ''))) {
                throw new Error('No se puede cambiar el titular en el estado actual de la reserva.');
            }

            // 2. Validar que el nuevo cliente pertenece al mismo club
            const newClient = await tx.client.findFirst({
                where: { id: newClientId, clubId },
                select: { id: true, name: true }
            });
            if (!newClient) {
                throw new Error('El cliente seleccionado no existe en este club');
            }

            // 3. Bloquear si la cuenta tiene pagos o devoluciones
            const account = await tx.account.findFirst({
                where: {
                    clubId,
                    sourceType: 'BOOKING',
                    sourceId: String(bookingId)
                },
                select: {
                    id: true,
                    status: true,
                    _count: { select: { payments: true, refunds: true } }
                }
            });
            const isClosedAccount = String(account?.status || '') === 'CLOSED';
            const hasPayments = (account?._count?.payments ?? 0) > 0;
            const hasRefunds = (account?._count?.refunds ?? 0) > 0;
            if (hasPayments || hasRefunds || isClosedAccount) {
                throw new Error(
                    'No se puede cambiar el titular: la reserva ya tiene pagos/devoluciones registrados o la cuenta está cerrada.'
                );
            }

            // 4. Cambiar el titular
            const updated = await tx.booking.update({
                where: { id: bookingId },
                data: { clientId: newClientId },
                select: {
                    id: true,
                    clientId: true,
                    client: { select: { id: true, name: true } }
                }
            });

            // 4.1 Sincronizar billing config para evitar inconsistencias
            // (hover/drawer mostrando titular anterior por metadata/refs legacy).
            const billingConfig = await tx.bookingBillingConfig.findUnique({
                where: { bookingId },
                select: {
                    id: true,
                    chargeResponsibleRef: true,
                    assignmentsJson: true,
                    metadataJson: true
                }
            });

            const oldBookingClientRef = `booking-client:${oldClientId}`;
            const newBookingClientRef = `booking-client:${newClientId}`;
            const oldClientRef = `client:${oldClientId}`;
            const newClientRef = `client:${newClientId}`;

            const replaceRef = (input: unknown): string => {
                const raw = String(input || '').trim();
                if (!raw) return raw;
                if (raw === oldBookingClientRef) return newBookingClientRef;
                if (raw === oldClientRef) return newClientRef;
                return raw;
            };

            if (billingConfig) {
                const rawAssignments = Array.isArray(billingConfig.assignmentsJson)
                    ? (billingConfig.assignmentsJson as Array<Record<string, unknown>>)
                    : [];

                const nextAssignments = rawAssignments.map((assignment) => ({
                    ...assignment,
                    participantRef: replaceRef((assignment as any)?.participantRef)
                }));

                const rawMetadata =
                    billingConfig.metadataJson && typeof billingConfig.metadataJson === 'object'
                        ? ({ ...(billingConfig.metadataJson as Record<string, unknown>) } as Record<string, unknown>)
                        : {};

                const rawSidebarParticipants = Array.isArray(rawMetadata.sidebarParticipants)
                    ? (rawMetadata.sidebarParticipants as Array<Record<string, unknown>>)
                    : [];

                const nextSidebarParticipants = rawSidebarParticipants.map((participant) => {
                    const nextRef = replaceRef((participant as any)?.ref);
                    const isOwner = Boolean((participant as any)?.isOwner);
                    const normalizedRef = String(nextRef || '').trim();
                    const shouldRenameOwner =
                        isOwner &&
                        (normalizedRef === newBookingClientRef || normalizedRef === newClientRef);
                    return {
                        ...participant,
                        ref: nextRef,
                        name: shouldRenameOwner
                            ? String(newClient.name || (participant as any)?.name || '').trim()
                            : (participant as any)?.name
                    };
                });

                const sidebarBlock =
                    rawMetadata.sidebar && typeof rawMetadata.sidebar === 'object'
                        ? ({ ...(rawMetadata.sidebar as Record<string, unknown>) } as Record<string, unknown>)
                        : {};
                sidebarBlock.participants = nextSidebarParticipants;

                rawMetadata.sidebarParticipants = nextSidebarParticipants;
                rawMetadata.sidebar = sidebarBlock;

                await tx.bookingBillingConfig.update({
                    where: { id: billingConfig.id },
                    data: {
                        chargeResponsibleRef: replaceRef(billingConfig.chargeResponsibleRef),
                        assignmentsJson: nextAssignments as unknown as Prisma.InputJsonValue,
                        metadataJson: rawMetadata as unknown as Prisma.InputJsonValue
                    }
                });
            }

            await this.eventService.bookingClientChanged(clubId, {
                bookingId,
                oldClientId,
                newClientId,
                oldClientRef: oldBookingClientRef,
                newClientRef: newBookingClientRef,
                oldClientName: null,
                newClientName: newClient.name,
                actorUserId,
                reason: reason ?? null,
                source: 'MANUAL'
            }, tx as any);

            // 5. Auditoría
            await this.auditLogService.create({
                clubId,
                userId: actorUserId,
                entity: 'Booking',
                entityId: String(bookingId),
                action: 'BOOKING_CLIENT_CHANGED',
                payload: {
                    oldClientId,
                    newClientId,
                    actorUserId,
                    reason: reason ?? null
                }
            });

            return updated;
        });
    }

    async confirmBooking(bookingId: number, actorUserId: number, clubId: number) {
        const updatedStatus = await prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                select: { id: true, clubId: true, price: true, activityId: true, clientId: true, status: true }
            });
            if (!booking) {
                throw new Error('Reserva no encontrada');
            }
            if (!isBookingTransitionAllowed(booking.status as any, 'CONFIRMED')) {
                throw new Error('Solo se puede confirmar una reserva pendiente');
            }

            await this.ensureBookingAccountWithChargeTx(tx, {
                bookingId: booking.id,
                clubId: booking.clubId,
                bookingPrice: Number(booking.price || 0),
                activityTypeId: booking.activityId,
                clientId: booking.clientId,
                actorUserId
            });

            const nextStatus = await this.bookingDomainService.confirmBookingManuallyTx(tx, { bookingId, clubId });
            await this.eventService.bookingConfirmed(clubId, {
                bookingId,
                actorUserId,
                source: 'MANUAL',
                previousStatus: booking.status,
                status: nextStatus
            }, tx as any);
            return nextStatus;
        });

        await this.auditLogService.create({
            clubId,
            userId: actorUserId,
            entity: 'Booking',
            entityId: String(bookingId),
            action: 'BOOKING_CONFIRM',
            payload: { status: updatedStatus }
        });

        return this.getBookingById(bookingId, clubId);
    }

    async completeBooking(bookingId: number, actorUserId: number, clubId: number) {
        const completed = await prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                include: { court: true, activity: true }
            });
            if (!booking) throw new Error('Reserva no encontrada');
            if (!isBookingTransitionAllowed(booking.status as any, 'COMPLETED')) {
                throw new Error('Solo se puede completar una reserva confirmada');
            }
            if (booking.endDateTime.getTime() > Date.now()) {
                throw new Error('No se puede completar una reserva antes de su horario de finalización');
            }

            const account = await tx.account.findFirst({
                where: { sourceType: 'BOOKING', sourceId: String(bookingId), clubId },
                select: { id: true }
            });
            if (!account) {
                throw new Error(
                    `Inconsistencia de integridad: la reserva ${bookingId} no tiene Account BOOKING y no puede completarse`
                );
            }

            const updatedBooking = await tx.booking.update({
                where: { id: bookingId },
                data: { status: 'COMPLETED' }
            });
            await this.eventService.bookingCompleted(clubId, {
                bookingId,
                actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
                previousStatus: booking.status,
                status: 'COMPLETED'
            }, tx as any);
            // Mantener la cuenta abierta tras finalizar la reserva permite
            // seguir cargando consumos post-cancha (ej. bar) hasta cierre manual.
            await this.projectionService.refreshAccountSummary(account.id, tx);

            return updatedBooking;
        });

        await this.auditLogService.create({
            clubId,
            userId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
            entity: 'Booking',
            entityId: String(bookingId),
            action: 'BOOKING_COMPLETE',
            payload: { status: completed.status }
        });

        return this.getBookingById(bookingId, clubId);
    }

    async completeExpiredConfirmedBookings(now: Date = new Date(), actorUserId: number = 0) {
        const candidates = await prisma.booking.findMany({
            where: {
                status: 'CONFIRMED',
                endDateTime: { lte: now }
            },
            select: { id: true, clubId: true }
        });

        let completed = 0;
        const failed: Array<{ bookingId: number; clubId: number; error: string }> = [];

        for (const candidate of candidates) {
            try {
                await this.completeBooking(candidate.id, actorUserId, candidate.clubId);
                completed += 1;
            } catch (error: any) {
                const message = String(error?.message || 'Error desconocido al completar reserva');
                failed.push({
                    bookingId: candidate.id,
                    clubId: candidate.clubId,
                    error: message
                });
                console.error('[BOOKING_SCHEDULER] No se pudo completar reserva confirmada', {
                    bookingId: candidate.id,
                    clubId: candidate.clubId,
                    error: message
                });
            }
        }

        return {
            candidates: candidates.length,
            completed,
            failed
        };
    }
    
    async getUserHistory(
        requestedUserId: number,
        requestUser: { userId: number; role: string; clubId: number | null },
        page: number = 0,
        take: number = 50
    ) {
        if (requestedUserId !== requestUser.userId) {
            if ((requestUser.role !== 'ADMIN' && requestUser.role !== 'OWNER') || requestUser.clubId == null) {
                throw new Error("No tienes permiso para ver el historial de otro usuario");
            }

            let requestedUserContext: { clubId: number } | null = null;
            try {
                requestedUserContext = await getUserClubContext(requestedUserId, requestUser.clubId);
            } catch {
                requestedUserContext = null;
            }

            if (!requestedUserContext || requestedUserContext.clubId !== requestUser.clubId) {
                throw new Error("No tienes permiso para ver el historial de otro usuario");
            }
        }
        const bookings = await prisma.booking.findMany({
            where: {
                OR: [
                    { userId: requestedUserId },
                    { client: { userId: requestedUserId } }
                ],
                ...(requestUser.clubId ? { clubId: requestUser.clubId } : {})
            },
            include: {
                court: { include: { club: true } },
                activity: true
            },
            orderBy: { startDateTime: 'desc' },
            skip: page * take,
            take
        });
        return bookings;
    }

    async getBookingById(bookingId: number, clubId: number) {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            include: {
                court: { include: { club: true } },
                activity: true,
                user: true,
                client: true
            }
        });
        if (!booking) {
            throw new Error('Reserva no encontrada');
        }
        return this.bookingRepo.mapToEntity(booking as any);
    }

    async getDaySchedule(date: Date, clubId?: number) {
        let allCourts;
        if (clubId) {
            allCourts = await prisma.court.findMany({
                where: { clubId, isUnderMaintenance: false },
                include: { club: { include: { settings: true } }, activityType: true }
            });
        } else {
            allCourts = await this.courtRepo.findAll();
        }
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        const clubConfig = clubId ? await prisma.club.findUnique({ where: { id: clubId }, include: { settings: true } }) : null;
        const normalizedClubConfig = this.resolveClubConfig(clubConfig);
        const timeZone = normalizedClubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, timeZone);

        const bookings = await prisma.booking.findMany({
    where: {
        startDateTime: { lt: endUtc },
        endDateTime: { gt: startUtc },
        ...(clubId ? { clubId } : {}),
        status: { not: 'CANCELLED' }
    },
    include: {
        court: true,
        activity: true,
        user: true,
        client: true
    }
});

        const bookingIds = bookings.map((booking) => booking.id);
        const sourceIds = bookingIds.map((id) => String(id));
        const resolveSidebarParticipantsFromMetadata = (metadataJson: unknown) => {
            if (!metadataJson || typeof metadataJson !== 'object') return [] as Array<{ ref: string; name: string; isOwner: boolean }>;
            const metadataRecord = metadataJson as Record<string, unknown>;
            const sidebarBlock =
                metadataRecord.sidebar && typeof metadataRecord.sidebar === 'object'
                    ? (metadataRecord.sidebar as Record<string, unknown>)
                    : null;
            const rawParticipants = Array.isArray(metadataRecord.sidebarParticipants)
                ? metadataRecord.sidebarParticipants
                : (Array.isArray(sidebarBlock?.participants) ? sidebarBlock?.participants : []);
            return rawParticipants
                .map((rawParticipant) => {
                    if (!rawParticipant || typeof rawParticipant !== 'object') return null;
                    const participantRecord = rawParticipant as Record<string, unknown>;
                    return {
                        ref: String(participantRecord.ref || participantRecord.entityRef || '').trim(),
                        name: String(participantRecord.name || '').trim(),
                        isOwner: Boolean(participantRecord.isOwner)
                    };
                })
                .filter((participant): participant is { ref: string; name: string; isOwner: boolean } => Boolean(participant));
        };
        const resolveParticipantRefsFromAssignments = (assignmentsJson: unknown) => {
            if (!Array.isArray(assignmentsJson)) return [] as string[];
            const refs: string[] = [];
            for (const assignment of assignmentsJson) {
                if (!assignment || typeof assignment !== 'object') continue;
                const assignmentRecord = assignment as Record<string, unknown>;
                const ref = String(assignmentRecord.participantRef || '').trim();
                if (!ref || refs.includes(ref)) continue;
                refs.push(ref);
            }
            return refs;
        };
        const isOwnerLikeRef = (participantRef: string) => {
            const normalized = String(participantRef || '').trim().toLowerCase();
            if (!normalized) return false;
            return (
                normalized.startsWith('guest:owner') ||
                normalized.startsWith('guest:booking-responsible') ||
                normalized.startsWith('booking-client:') ||
                normalized.startsWith('booking-user:')
            );
        };
        const resolveParticipantNameByRef = (metadataJson: unknown, participantRef: string | null | undefined) => {
            const targetRef = String(participantRef || '').trim();
            if (!targetRef) return '';
            const participants = resolveSidebarParticipantsFromMetadata(metadataJson);
            const exact = participants.find((participant) => participant.ref === targetRef && participant.name);
            if (exact?.name) return exact.name;
            if (isOwnerLikeRef(targetRef)) {
                const owner = participants.find(
                    (participant) => participant.name && isOwnerLikeRef(String(participant.ref || ''))
                );
                if (owner?.name) return owner.name;
            }
            return '';
        };

        const [accounts, clubsWithSettings, paymentAgg, bookingPayments, refundAgg, billingConfigs, accountItemTotals] = await Promise.all([
            sourceIds.length > 0
                ? prisma.account.findMany({
                    where: {
                        sourceType: 'BOOKING',
                        sourceId: { in: sourceIds },
                        ...(clubId ? { clubId } : {})
                    },
                    select: {
                        id: true,
                        sourceId: true,
                        clubId: true
                    }
                })
                : Promise.resolve([]),
            prisma.club.findMany({
                where: {
                    id: { in: Array.from(new Set(bookings.map((booking) => booking.clubId))) }
                },
                select: {
                    id: true,
                    settings: {
                        select: {
                            bookingConfirmationMode: true,
                            bookingDepositPercent: true
                        }
                    }
                }
            }),
            sourceIds.length > 0
                ? prisma.payment.groupBy({
                    by: ['accountId'],
                    where: {
                        account: {
                            sourceType: 'BOOKING',
                            sourceId: { in: sourceIds },
                            ...(clubId ? { clubId } : {})
                        }
                    },
                    _sum: { amount: true }
                })
                : Promise.resolve([]),
            sourceIds.length > 0
                ? prisma.payment.findMany({
                    where: {
                        account: {
                            sourceType: 'BOOKING',
                            sourceId: { in: sourceIds },
                            ...(clubId ? { clubId } : {})
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        accountId: true,
                        amount: true,
                        createdAt: true,
                        payerParticipantRef: true,
                        payerParticipantName: true,
                        coveredParticipantRef: true,
                        coveredParticipantName: true
                    }
                })
                : Promise.resolve([]),
            sourceIds.length > 0
                ? prisma.refund.groupBy({
                    by: ['accountId'],
                    where: {
                        status: 'EXECUTED',
                        account: {
                            sourceType: 'BOOKING',
                            sourceId: { in: sourceIds },
                            ...(clubId ? { clubId } : {})
                        }
                    },
                    _sum: { amount: true }
                })
                : Promise.resolve([]),
            bookingIds.length > 0
                ? prisma.bookingBillingConfig.findMany({
                    where: {
                        bookingId: { in: bookingIds },
                        ...(clubId ? { clubId } : {})
                    },
                    select: {
                        bookingId: true,
                        chargeMode: true,
                        chargeResponsibleRef: true,
                        metadataJson: true,
                        assignmentsJson: true
                    }
                })
                : Promise.resolve([]),
            // Suma de todos los ítems de cada cuenta (cancha + consumos + servicios)
            sourceIds.length > 0
                ? prisma.accountItem.groupBy({
                    by: ['accountId'],
                    where: {
                        account: {
                            sourceType: 'BOOKING',
                            sourceId: { in: sourceIds },
                            ...(clubId ? { clubId } : {})
                        }
                    },
                    _sum: { total: true }
                })
                : Promise.resolve([])
        ]);

        // Mapa accountId → suma real de ítems (cancha + consumos + servicios)
        const itemTotalByAccountId = new Map<string, number>();
        for (const row of accountItemTotals) {
            itemTotalByAccountId.set(row.accountId, Number(row._sum.total || 0));
        }

        const accountByBookingId = new Map<number, { id: string; clubId: number }>();
        for (const account of accounts) {
            const parsedBookingId = Number(account.sourceId);
            if (Number.isInteger(parsedBookingId)) {
                accountByBookingId.set(parsedBookingId, { id: account.id, clubId: account.clubId });
            }
        }
        const billingConfigByBookingId = new Map<number, {
            chargeMode: ChargeMode;
            chargeResponsibleRef: string | null;
            metadataJson: unknown;
            assignmentsJson: unknown;
        }>();
        for (const config of billingConfigs) {
            billingConfigByBookingId.set(config.bookingId, {
                chargeMode: config.chargeMode,
                chargeResponsibleRef: config.chargeResponsibleRef || null,
                metadataJson: config.metadataJson ?? null,
                assignmentsJson: config.assignmentsJson ?? null
            });
        }

        const latestPaymentByAccountId = new Map<string, {
            payerParticipantRef: string | null;
            payerParticipantName: string | null;
            coveredParticipantRef: string | null;
            coveredParticipantName: string | null;
            createdAt: Date;
        }>();
        const payerTotalsByAccountId = new Map<string, Map<string, {
            ref: string | null;
            name: string | null;
            amount: number;
        }>>();
        const coveredTotalsByAccountId = new Map<string, Map<string, {
            ref: string | null;
            name: string | null;
            amount: number;
        }>>();
        for (const payment of bookingPayments) {
            const accountId = String(payment.accountId || '').trim();
            const payerParticipantRef = String(payment.payerParticipantRef || '').trim();
            const payerParticipantName = String(payment.payerParticipantName || '').trim();
            const coveredParticipantRef = String(payment.coveredParticipantRef || '').trim();
            const coveredParticipantName = String(payment.coveredParticipantName || '').trim();
            const paymentAmount = Number(payment.amount || 0);
            if (!accountId) continue;

            if (Number.isFinite(paymentAmount) && paymentAmount > 0.009) {
                const payerKey = payerParticipantRef
                    ? `ref:${payerParticipantRef.toLowerCase()}`
                    : payerParticipantName
                        ? `name:${payerParticipantName.toLowerCase()}`
                        : '';
                if (payerKey) {
                    let payerMap = payerTotalsByAccountId.get(accountId);
                    if (!payerMap) {
                        payerMap = new Map();
                        payerTotalsByAccountId.set(accountId, payerMap);
                    }
                    const previous = payerMap.get(payerKey);
                    const previousAmount = Number(previous?.amount || 0);
                    payerMap.set(payerKey, {
                        ref: payerParticipantRef || previous?.ref || null,
                        name: payerParticipantName || previous?.name || null,
                        amount: Number((previousAmount + paymentAmount).toFixed(2))
                    });
                }

                const effectiveCoveredRef = coveredParticipantRef || payerParticipantRef;
                const effectiveCoveredName = coveredParticipantName || payerParticipantName;
                const coveredKey = effectiveCoveredRef
                    ? `ref:${effectiveCoveredRef.toLowerCase()}`
                    : effectiveCoveredName
                        ? `name:${effectiveCoveredName.toLowerCase()}`
                        : '';
                if (coveredKey) {
                    let coveredMap = coveredTotalsByAccountId.get(accountId);
                    if (!coveredMap) {
                        coveredMap = new Map();
                        coveredTotalsByAccountId.set(accountId, coveredMap);
                    }
                    const previous = coveredMap.get(coveredKey);
                    const previousAmount = Number(previous?.amount || 0);
                    coveredMap.set(coveredKey, {
                        ref: effectiveCoveredRef || previous?.ref || null,
                        name: effectiveCoveredName || previous?.name || null,
                        amount: Number((previousAmount + paymentAmount).toFixed(2))
                    });
                }
            }

            if (!latestPaymentByAccountId.has(accountId)) {
                latestPaymentByAccountId.set(accountId, {
                    payerParticipantRef: payerParticipantRef || null,
                    payerParticipantName: payerParticipantName || null,
                    coveredParticipantRef: coveredParticipantRef || payerParticipantRef || null,
                    coveredParticipantName: coveredParticipantName || payerParticipantName || null,
                    createdAt: payment.createdAt
                });
            }
        }

        const paymentByAccountId = new Map<string, number>();
        for (const row of paymentAgg) {
            paymentByAccountId.set(row.accountId, Number(row._sum.amount || 0));
        }

        const refundByAccountId = new Map<string, number>();
        for (const row of refundAgg) {
            refundByAccountId.set(row.accountId, Number(row._sum.amount || 0));
        }

        const clubSettingsByClubId = new Map<number, { mode: 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED'; depositPercent: number | null }>();
        for (const club of clubsWithSettings) {
            clubSettingsByClubId.set(club.id, {
                mode: (club.settings?.bookingConfirmationMode ?? 'MANUAL') as 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED',
                depositPercent: club.settings?.bookingDepositPercent == null ? null : Number(club.settings.bookingDepositPercent)
            });
        }

        const bookingWithContextById = new Map<number, any>();
        for (const booking of bookings) {
            const accountRef = accountByBookingId.get(booking.id);
            const bookingStatus = String(booking.status || '').toUpperCase();
            if (!accountRef && (bookingStatus === 'CONFIRMED' || bookingStatus === 'COMPLETED')) {
                throw new Error(
                    `Inconsistencia de integridad: la reserva ${booking.id} está ${bookingStatus} pero no tiene Account BOOKING`
                );
            }
            const paidAmount = accountRef
                ? Math.max(0, Number((paymentByAccountId.get(accountRef.id) || 0) - (refundByAccountId.get(accountRef.id) || 0)))
                : 0;
            const roundedPaidAmount = Number(paidAmount.toFixed(2));
            // Usar suma real de ítems de la cuenta (cancha + consumos + servicios).
            // Si aún no hay ítems creados (turno pendiente sin account), usar booking.price como fallback.
            const itemsTotal = accountRef ? (itemTotalByAccountId.get(accountRef.id) ?? null) : null;
            const roundedTotalAmount = Number((itemsTotal !== null ? itemsTotal : Number(booking.price || 0)).toFixed(2));
            const roundedRemainingAmount = Number(Math.max(0, roundedTotalAmount - roundedPaidAmount).toFixed(2));
            const hoverPaymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' =
                roundedRemainingAmount <= 0.009
                    ? 'PAID'
                    : roundedPaidAmount > 0.009
                        ? 'PARTIAL'
                        : 'UNPAID';

            const clubSettings = clubSettingsByClubId.get(booking.clubId) || { mode: 'MANUAL' as const, depositPercent: null };
            const confirmationContext = this.buildBookingConfirmationContext({
                status: booking.status,
                mode: clubSettings.mode,
                bookingBaseAmount: Number(booking.price || 0),
                depositPercent: clubSettings.depositPercent,
                paidAmount
            });
            const billingConfig = billingConfigByBookingId.get(booking.id);
            const chargeResponsibleRef = String(billingConfig?.chargeResponsibleRef || '').trim();
            const chargeResponsibleName = resolveParticipantNameByRef(
                billingConfig?.metadataJson,
                chargeResponsibleRef
            );
            const latestPayment = accountRef ? latestPaymentByAccountId.get(accountRef.id) : undefined;
            const latestPayerRef = String(latestPayment?.payerParticipantRef || '').trim();
            const latestPayerNameRaw = String(latestPayment?.payerParticipantName || '').trim();
            const latestPayerName = latestPayerNameRaw || resolveParticipantNameByRef(
                billingConfig?.metadataJson,
                latestPayerRef
            );
            const latestCoveredRef = String(latestPayment?.coveredParticipantRef || '').trim();
            const latestCoveredNameRaw = String(latestPayment?.coveredParticipantName || '').trim();
            const latestCoveredName = latestCoveredNameRaw || resolveParticipantNameByRef(
                billingConfig?.metadataJson,
                latestCoveredRef
            );
            const payerParticipants = accountRef
                ? Array.from(payerTotalsByAccountId.get(accountRef.id)?.values() || [])
                    .map((payer) => ({
                        ref: String(payer.ref || '').trim() || null,
                        name: String(payer.name || '').trim() || null,
                        amount: Number(Number(payer.amount || 0).toFixed(2))
                    }))
                    .filter((payer) =>
                        Number.isFinite(payer.amount) &&
                        payer.amount > 0.009 &&
                        (Boolean(payer.ref) || Boolean(payer.name))
                    )
                : [];
            const coveredParticipants = accountRef
                ? Array.from(coveredTotalsByAccountId.get(accountRef.id)?.values() || [])
                    .map((covered) => ({
                        ref: String(covered.ref || '').trim() || null,
                        name: String(covered.name || '').trim() || null,
                        amount: Number(Number(covered.amount || 0).toFixed(2))
                    }))
                    .filter((covered) =>
                        Number.isFinite(covered.amount) &&
                        covered.amount > 0.009 &&
                        (Boolean(covered.ref) || Boolean(covered.name))
                    )
                : [];
            const sidebarParticipants = resolveSidebarParticipantsFromMetadata(billingConfig?.metadataJson);
            const assignmentRefs = resolveParticipantRefsFromAssignments(billingConfig?.assignmentsJson);
            const hoverParticipants = (() => {
                if (sidebarParticipants.length > 0) {
                    return sidebarParticipants.map((participant) => ({
                        ref: String(participant.ref || '').trim(),
                        name: String(participant.name || '').trim(),
                        isOwner: Boolean(participant.isOwner) || isOwnerLikeRef(String(participant.ref || ''))
                    }));
                }

                if (assignmentRefs.length > 0) {
                    return assignmentRefs.map((ref) => ({
                        ref,
                        name:
                            (ref === chargeResponsibleRef && chargeResponsibleName
                                ? chargeResponsibleName
                                : ref === latestPayerRef && latestPayerName
                                    ? latestPayerName
                                    : ''),
                        isOwner: isOwnerLikeRef(ref) || ref === chargeResponsibleRef
                    }));
                }

                return [{
                    ref: chargeResponsibleRef || '',
                    name: chargeResponsibleName || latestPayerName || String(booking.client?.name || '').trim(),
                    isOwner: true
                }];
            })();

            bookingWithContextById.set(booking.id, {
                ...booking,
                confirmationContext: {
                    paidAmount: roundedPaidAmount,
                    ...confirmationContext
                },
                hoverPayment: {
                    status: hoverPaymentStatus,
                    totalAmount: roundedTotalAmount,
                    paidAmount: roundedPaidAmount,
                    remainingAmount: roundedRemainingAmount,
                    chargeMode: String(billingConfig?.chargeMode || ChargeMode.INDIVIDUAL),
                    chargeResponsibleRef: chargeResponsibleRef || null,
                    chargeResponsibleName: chargeResponsibleName || null,
                    latestPayerRef: latestPayerRef || null,
                    latestPayerName: latestPayerName || null,
                    latestCoveredRef: latestCoveredRef || null,
                    latestCoveredName: latestCoveredName || null,
                    participants: hoverParticipants,
                    payerParticipants: payerParticipants,
                    coveredParticipants: coveredParticipants
                }
            });
        }

        const schedule = [];

        const bookingByCourtAndTime = new Map<string, any>();
        for (const booking of bookings) {
            const localDate = TimeHelper.utcToLocal(booking.startDateTime, timeZone);
            const bookingLocalTimeStr = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;
            bookingByCourtAndTime.set(`${booking.court.id}:${bookingLocalTimeStr}`, bookingWithContextById.get(booking.id) || booking);
        }

        // Consider slots coming from anchor = date and anchor = date - 1
        const anchors = [
            (() => { const d = new Date(date); d.setDate(d.getDate() - 1); return d; })(),
            new Date(date)
        ];

        const scheduleByActivityId = new Map<number, { isClosed: boolean; schedule: any }>();

        for (const court of activeCourts) {
            const courtActivity = this.mapActivityType((court as any).activityType);
            if (!courtActivity) continue;
            let resolvedSchedule = scheduleByActivityId.get(courtActivity.id);
            if (!resolvedSchedule) {
                resolvedSchedule = await this.resolveActivityScheduleForDate(courtActivity, date, timeZone);
                scheduleByActivityId.set(courtActivity.id, resolvedSchedule);
            }
            if (resolvedSchedule.isClosed) continue;

            const courtSchedule = resolvedSchedule.schedule;
            const courtDuration = courtSchedule.durations[0] ?? courtActivity.defaultDurationMinutes;
            const possibleSlots = buildSlotsFromSchedule(
                {
                    scheduleMode: courtSchedule.mode,
                    scheduleOpenTime: courtSchedule.openTime,
                    scheduleCloseTime: courtSchedule.closeTime,
                    scheduleIntervalMinutes: courtSchedule.intervalMinutes,
                    scheduleWindows: courtSchedule.rangeWindows,
                    scheduleDurations: courtSchedule.durations,
                    scheduleFixedSlots: courtSchedule.fixedSlots
                },
                courtActivity.defaultDurationMinutes,
                courtDuration
            );

            const seen = new Set<string>();
            for (const anchor of anchors) {
                for (const slotObj of possibleSlots as Array<{ slotTime: string; dayOffset: number }>) {
                    const slotDateCandidate = new Date(anchor);
                    slotDateCandidate.setDate(slotDateCandidate.getDate() + (slotObj.dayOffset || 0));
                    if (
                        slotDateCandidate.getFullYear() !== date.getFullYear() ||
                        slotDateCandidate.getMonth() !== date.getMonth() ||
                        slotDateCandidate.getDate() !== date.getDate()
                    ) continue;

                    const slotDateTime = TimeHelper.localSlotToUtc(slotDateCandidate, slotObj.slotTime, timeZone);

                    const booking = bookingByCourtAndTime.get(`${court.id}:${slotObj.slotTime}`) || null;

                    const key = `${slotObj.slotTime}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    schedule.push({
                        courtId: court.id,
                        courtName: court.name,
                        slotTime: slotObj.slotTime,
                        startDateTime: slotDateTime.toISOString(),
                        isAvailable: !booking,
                        booking: booking || null
                    });
                }
            }
        }

        for (const booking of bookings) {
            // Buscamos si esta reserva ya está en nuestra lista de 'schedule'
            const isAlreadyInSchedule = schedule.some(s => s.booking && s.booking.id === booking.id);
            
            if (!isAlreadyInSchedule) {
            const localDate = TimeHelper.utcToLocal(booking.startDateTime, timeZone);
            const slotTimeStr = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;

                schedule.push({
                    courtId: booking.court.id,
                    courtName: booking.court.name,
                    slotTime: slotTimeStr,
                    startDateTime: booking.startDateTime.toISOString(),
                    isAvailable: false, // Como es un turno huérfano, obvio que no está disponible
                    booking: bookingWithContextById.get(booking.id) || booking
                });
            }
        }

        schedule.sort((a, b) => {
            if (a.slotTime < b.slotTime) return -1;
            if (a.slotTime > b.slotTime) return 1;
            if (a.courtName < b.courtName) return -1;
            if (a.courtName > b.courtName) return 1;
            return 0;
        });

        return schedule;
    }

    async getAvailableSlotsWithCourts(
        date: Date,
        activityId: number,
        clubId?: number,
        durationMinutes?: number,
        identity?: {
            clientId?: string | null;
            userId?: number | null;
            clientEmail?: string;
            clientPhone?: string;
            clientDni?: string;
        }
    ): Promise<{
        slotsWithCourts: Array<{
            slotTime: string;
            availableCourts: Array<{
                id: number;
                name: string;
                price?: number | null;
            }>;
        }>;
        professorOverrideAvailable: boolean;
        professorDurationOverrideMinutes: number | null;
    }> {
        const allCourts = await this.courtRepo.findAll(clubId);
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);
        const activityCourts = activeCourts.filter((court: any) => Number(court.activityTypeId) === Number(activityId));

        const clubConfig = clubId ? await prisma.club.findUnique({ where: { id: clubId }, include: { settings: true } }) : null;
        const normalizedClubConfig = this.resolveClubConfig(clubConfig);
        const timeZone = normalizedClubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const { startUtc, endUtc } = TimeHelper.getUtcRangeForLocalDate(date, timeZone);

        const bookings = await prisma.booking.findMany({
            where: {
                startDateTime: { lt: endUtc },
                endDateTime: { gt: startUtc },
                status: { not: 'CANCELLED' },
                ...(clubId ? { clubId } : {})
            },
            include: { court: true }
        });

        if (activityCourts.length === 0) {
            return {
                slotsWithCourts: [],
                professorOverrideAvailable: false,
                professorDurationOverrideMinutes: null
            };
        }

        const activity = this.mapActivityType((activityCourts[0] as any).activityType)
            ?? await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");

        // Si el club (si se indicó) está cerrado ese día, no devolvemos horarios
        if (clubId && !this.isClubOpenOnLocalDate(normalizedClubConfig, date, timeZone)) {
            return {
                slotsWithCourts: [],
                professorOverrideAvailable: false,
                professorDurationOverrideMinutes: null
            };
        }

        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, date, timeZone);
        if (resolvedSchedule.isClosed) {
            return {
                slotsWithCourts: [],
                professorOverrideAvailable: false,
                professorDurationOverrideMinutes: null
            };
        }
        const activitySchedule = resolvedSchedule.schedule;
        const professorOverrideMinutes = Number(normalizedClubConfig?.professorDurationOverrideMinutes ?? 60);
        const resolveProfessorForClubId = Number(clubId ?? (activityCourts[0] as any)?.club?.id);
        const isProfessorClient = Number.isFinite(resolveProfessorForClubId) && resolveProfessorForClubId > 0
            ? await this.resolveClientProfessorStatus({
                clubId: resolveProfessorForClubId,
                clientId: identity?.clientId ?? null,
                userId: identity?.userId ?? null,
                clientEmail: identity?.clientEmail,
                clientPhone: identity?.clientPhone,
                clientDni: identity?.clientDni
            })
            : false;
        const canProfessorDurationOverride =
            Boolean(isProfessorClient) &&
            Boolean(normalizedClubConfig?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        const referenceDuration = this.resolvePriceReferenceDuration(activity, allowedDurations, effectiveDuration);
        if (!allowedDurations.includes(effectiveDuration)) {
            if (!(canProfessorDurationOverride && effectiveDuration === professorOverrideMinutes)) {
                throw new Error("Duración no permitida por el club");
            }
        }

        let possibleSlots = buildSlotsFromSchedule(
            {
                scheduleMode: activitySchedule.mode,
                scheduleOpenTime: activitySchedule.openTime,
                scheduleCloseTime: activitySchedule.closeTime,
                scheduleIntervalMinutes: activitySchedule.intervalMinutes,
                scheduleWindows: activitySchedule.rangeWindows,
                scheduleDurations: activitySchedule.durations,
                scheduleFixedSlots: activitySchedule.fixedSlots
            },
            activity.defaultDurationMinutes,
            effectiveDuration
        ) as Array<{ slotTime: string; dayOffset: number }>;
        // Regla operativa explícita: en horarios fijos, si aplica override de profesor,
        // habilitar los mismos inicios fijos aunque la duración no exista en scheduleFixedSlots.duration.
        if (
            possibleSlots.length === 0 &&
            canProfessorDurationOverride &&
            effectiveDuration === professorOverrideMinutes &&
            activitySchedule.mode === 'FIXED' &&
            Array.isArray(activitySchedule.fixedSlots)
        ) {
            const seenStarts = new Set<string>();
            possibleSlots = activitySchedule.fixedSlots
                .map((slot: any) => String(slot?.start || '').trim())
                .filter((start: string) => /^\d{2}:\d{2}$/.test(start))
                .filter((start: string) => {
                    if (seenStarts.has(start)) return false;
                    seenStarts.add(start);
                    return true;
                })
                .map((start: string) => ({ slotTime: start, dayOffset: 0 }));
        }

        const now = new Date();

        const anchors = [
            (() => { const d = new Date(date); d.setDate(d.getDate() - 1); return d; })(),
            new Date(date)
        ];

        const slotsMap = new Map<string, { slotTime: string; slotDateTime: Date }>();

        for (const anchor of anchors) {
            for (const slotObj of possibleSlots) {
                const slotDateCandidate = new Date(anchor);
                slotDateCandidate.setDate(slotDateCandidate.getDate() + (slotObj.dayOffset || 0));
                if (
                    slotDateCandidate.getFullYear() !== date.getFullYear() ||
                    slotDateCandidate.getMonth() !== date.getMonth() ||
                    slotDateCandidate.getDate() !== date.getDate()
                ) continue;

                try {
                    const slotDateTime = TimeHelper.localSlotToUtc(slotDateCandidate, slotObj.slotTime, timeZone);
                    if (slotDateTime.getTime() <= now.getTime()) continue;
                    if (!slotsMap.has(slotObj.slotTime)) {
                        slotsMap.set(slotObj.slotTime, { slotTime: slotObj.slotTime, slotDateTime });
                    }
                } catch {
                    // noop
                }
            }
        }

        const slotsWithCourts: Array<any> = [];

        for (const { slotTime, slotDateTime } of slotsMap.values()) {
            const slotEndDateTime = new Date(slotDateTime.getTime() + effectiveDuration * 60000);

            // 1. Mapeamos TODAS las canchas calculando su disponibilidad real por milisegundos
            const courtsWithStatus = await Promise.all(activityCourts.map(async (court) => {
                const isBusy = bookings.some(b => {
                    if (b.court.id !== court.id || b.status === "CANCELLED") return false;
                    
                    const bStart = b.startDateTime.getTime();
                    const bEnd = b.endDateTime.getTime();
                    const sStart = slotDateTime.getTime();
                    const sEnd = slotEndDateTime.getTime();

                    // Si se solapan, la cancha está ocupada
                    return sStart < bEnd && sEnd > bStart;
                });

                let calculatedPrice = Number((court as any).price ?? 0);
                let calculatedBase = Number((court as any).price ?? 0);
                let lightsExtraApplied = 0;

                try {
                    const basePrice = await this.pricingService.calculateCourtPrice(court.id, slotDateTime);
                    if (Number.isFinite(Number(basePrice)) && Number(basePrice) > 0) {
                        calculatedBase = this.calculateDurationAdjustedPrice(
                            Number(basePrice),
                            effectiveDuration,
                            referenceDuration
                        );
                        calculatedPrice = calculatedBase;
                        if (
                            normalizedClubConfig &&
                            normalizedClubConfig.lightsEnabled &&
                            normalizedClubConfig.lightsExtraAmount &&
                            normalizedClubConfig.lightsFromHour
                        ) {
                            const [lh, lm] = String(normalizedClubConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
                            if (!Number.isNaN(lh) && !Number.isNaN(lm)) {
                                const localStart = TimeHelper.utcToLocal(slotDateTime, timeZone);
                                const bookingTotalMinutes = localStart.getHours() * 60 + localStart.getMinutes();
                                const lightsTotalMinutes = lh * 60 + lm;
                                if (bookingTotalMinutes >= lightsTotalMinutes) {
                                    lightsExtraApplied = Number(normalizedClubConfig.lightsExtraAmount || 0);
                                    calculatedPrice += lightsExtraApplied;
                                }
                            }
                        }
                    }
                } catch {
                    // fallback al precio de cancha configurado
                }

                return {
                    id: court.id,
                    name: court.name,
                    price: Number.isFinite(Number(calculatedPrice)) ? Number(Number(calculatedPrice).toFixed(2)) : null,
                    basePrice: Number.isFinite(Number(calculatedBase)) ? Number(Number(calculatedBase).toFixed(2)) : null,
                    lightsExtraApplied: Number.isFinite(Number(lightsExtraApplied)) ? Number(Number(lightsExtraApplied).toFixed(2)) : 0,
                    isAvailable: !isBusy
                };
            }));

            // 2. Filtramos para la lista de "disponibles" solo las que NO están ocupadas
            const availableOnly = courtsWithStatus
                .filter(c => c.isAvailable)
                .map(({ isAvailable, ...rest }) => rest); // Quitamos el flag para el frontend

            // 3. SOLO agregamos el horario al schedule si realmente hay canchas libres
            if (availableOnly.length > 0) {
                slotsWithCourts.push({ 
                    slotTime, 
                    availableCourts: availableOnly, 
                    courts: courtsWithStatus 
                });
            }
        }

        return {
            slotsWithCourts,
            professorOverrideAvailable: Boolean(canProfessorDurationOverride),
            professorDurationOverrideMinutes: canProfessorDurationOverride ? professorOverrideMinutes : null
        };
    }

    async createFixedBooking(
        courtId: number,
        activityId: number,
        startDateTime: Date,
        options?: CreateFixedBookingOptions
    ) {
        const requestedUserId = Number.isInteger(Number(options?.userId)) && Number(options?.userId) > 0
            ? Number(options?.userId)
            : null;
        const requestedClientId = String(options?.clientId || '').trim();
        const requestedClientDraftName = String(options?.clientDraft?.name || '').trim();
        const requestedClientDraftPhone = this.normalizePhone(options?.clientDraft?.phone);
        // requestedClientDraftEmail eliminado (Fase 1.2): email ya no es obligatorio en alta rápida admin.

        if (!requestedClientId && !requestedUserId && requestedClientDraftName.length < 2) {
            throw new Error('Debes seleccionar un cliente o cargar un alta rápida válida.');
        }
        // Fase 1.2: email es opcional. Solo phone es obligatorio.
        if (!requestedClientId && !requestedUserId && !requestedClientDraftPhone) {
            throw new Error('El teléfono es obligatorio para el alta rápida de cliente.');
        }

        let user: User | null = null;
        if (requestedUserId) {
            user = await this.userRepo.findById(requestedUserId);
            if (!user) throw new Error('Usuario no encontrado');
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        const courtClubId = (court as any)?.club?.id;
        if (options?.clubId && courtClubId !== options.clubId) {
            throw new Error("No tienes acceso a esta cancha");
        }

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");
        if ((activity.clubId ?? null) !== ((court as any)?.club?.id ?? null)) {
            throw new Error("ACTIVITY_CLUB_MISMATCH");
        }

        const fixedClubId = (court as any)?.club?.id;
        const isProfessorClient = await this.resolveClientProfessorStatus({
            clubId: fixedClubId,
            clientId: requestedClientId || null,
            userId: user?.id ?? null,
            clientEmail: options?.clientDraft?.email ?? undefined,
            clientPhone: options?.clientDraft?.phone ?? user?.phoneNumber ?? undefined,
            clientDni: options?.clientDraft?.dni ?? undefined
        });
        const clubConfigForFixed = this.resolveClubConfig((court as any)?.club);
        const professorOverrideMinutes = Number(clubConfigForFixed?.professorDurationOverrideMinutes ?? 60);
        const canProfessorDurationOverride =
            Boolean(isProfessorClient) &&
            Boolean(clubConfigForFixed?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        const requestedDuration = Number(options?.durationMinutes);
        const hasRequestedDuration = Number.isFinite(requestedDuration) && requestedDuration > 0;
        const duration = hasRequestedDuration
            ? Math.floor(requestedDuration)
            : (canProfessorDurationOverride ? professorOverrideMinutes : (activity ? activity.defaultDurationMinutes : 60));
        this.assertValidDuration(duration);
        const fixedConfig = this.resolveFixedBookingConfig(clubConfigForFixed, activity ?? null);

        const explicitWeeks = Number(options?.weeksToGenerate);
        const explicitEveryDays = Number(options?.everyDays);
        const explicitRepetitions = Number(options?.repetitions);
        const hasExplicitWeeks = Number.isFinite(explicitWeeks) && explicitWeeks > 0;
        const hasExplicitEveryDays = Number.isFinite(explicitEveryDays) && explicitEveryDays > 0;
        const hasExplicitRepetitions = Number.isFinite(explicitRepetitions) && explicitRepetitions > 0;
        const generationFrequencyDays = hasExplicitEveryDays
            ? Math.max(1, Math.floor(explicitEveryDays))
            : Math.max(1, fixedConfig.fixedBookingGenerationFrequencyDays);
        const totalOccurrences = hasExplicitRepetitions
            ? Math.max(1, Math.floor(explicitRepetitions))
            : hasExplicitWeeks
                ? Math.max(1, Math.ceil((explicitWeeks * 7) / generationFrequencyDays))
                : Math.max(1, Math.ceil(fixedConfig.fixedBookingDaysAhead / generationFrequencyDays));

        const clubTimeZone = clubConfigForFixed.timeZone ?? 'America/Argentina/Buenos_Aires';
        const localStart = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
        const localEnd = TimeHelper.utcToLocal(new Date(startDateTime.getTime() + duration * 60000), clubTimeZone);
        const startTime = `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}`;
        const endTime = `${String(localEnd.getHours()).padStart(2, '0')}:${String(localEnd.getMinutes()).padStart(2, '0')}`;
        const startTimeMinutes = TimeHelper.timeToMinutes(startTime);
        const endTimeMinutes = TimeHelper.timeToMinutes(endTime);
        if (startTimeMinutes >= endTimeMinutes) {
            throw new Error('Horario inválido para turno fijo: start debe ser menor a end');
        }
        const dayOfWeek = localStart.getDay();

        if (!this.isClubOpenOnLocalDate(clubConfigForFixed, startDateTime, clubTimeZone)) {
            throw new Error('El club está cerrado ese día');
        }

        // Importante: no bloquear por "plantillas" de turnos fijos.
        // La validación de superposición se hace únicamente contra ocurrencias reales (bookings).

        const firstStart = new Date(startDateTime);
        const lastStart = new Date(firstStart);
        lastStart.setDate(firstStart.getDate() + ((totalOccurrences - 1) * generationFrequencyDays));
        const lastEnd = new Date(lastStart.getTime() + duration * 60000);
        const previewConflictsOnly = Boolean(options?.previewConflictsOnly);

        if (previewConflictsOnly) {
            const existingBookings = await prisma.booking.findMany({
                where: {
                    courtId,
                    status: { not: 'CANCELLED' },
                    startDateTime: { lt: lastEnd },
                    endDateTime: { gt: firstStart }
                },
                include: {
                    user: true,
                    client: true,
                    court: true,
                    activity: true
                }
            });

            const skippedOccurrences: Array<{
                requestedStartDateTime: Date;
                requestedEndDateTime: Date;
                reason: string;
                conflictingBookingId?: number;
                conflictingStartDateTime?: Date;
                conflictingEndDateTime?: Date;
                conflictingClientName?: string;
                conflictingCourtName?: string;
                conflictingActivityName?: string;
                conflictingStatus?: string;
            }> = [];
            let generatedCount = 0;

            for (let i = 0; i < totalOccurrences; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * generationFrequencyDays));
                const currentEnd = new Date(currentStart.getTime() + duration * 60000);
                this.assertValidRange(currentStart, currentEnd);

                const conflictingBooking = existingBookings.find((existing: any) => {
                    return existing.startDateTime < currentEnd && existing.endDateTime > currentStart;
                });
                if (conflictingBooking) {
                    skippedOccurrences.push({
                        requestedStartDateTime: currentStart,
                        requestedEndDateTime: currentEnd,
                        reason: 'BOOKING_OVERLAP',
                        conflictingBookingId: Number(conflictingBooking?.id),
                        conflictingStartDateTime: conflictingBooking?.startDateTime,
                        conflictingEndDateTime: conflictingBooking?.endDateTime,
                        conflictingClientName: conflictingBooking?.client?.name
                            || `${conflictingBooking?.user?.firstName || ''} ${conflictingBooking?.user?.lastName || ''}`.trim()
                            || 'Cliente',
                        conflictingCourtName: conflictingBooking?.court?.name || '',
                        conflictingActivityName: conflictingBooking?.activity?.name || '',
                        conflictingStatus: conflictingBooking?.status || ''
                    });
                    continue;
                }
                generatedCount += 1;
            }

            return {
                preview: true,
                generatedCount,
                skippedOccurrences,
                totalOccurrences,
                msg: `Previsualización: ${generatedCount} ocurrencia(s) disponibles y ${skippedOccurrences.length} superposición(es).`
            };
        }

        let resolvedFixedClient: { id: string; userId: number | null; phone?: string | null } | null = null;
        if (requestedClientId) {
            const existingClient = await prisma.client.findFirst({
                where: {
                    id: requestedClientId,
                    clubId: fixedClubId
                },
                select: {
                    id: true,
                    userId: true,
                    phone: true
                }
            });
            if (existingClient) {
                resolvedFixedClient = {
                    id: String(existingClient.id),
                    userId: Number.isInteger(Number(existingClient.userId)) ? Number(existingClient.userId) : null,
                    phone: existingClient.phone ?? null
                };
            } else if (!requestedUserId && requestedClientDraftName.length < 2) {
                throw new Error('Cliente no encontrado para el club seleccionado');
            }
        }

        if (!resolvedFixedClient) {
            const draftName = requestedClientDraftName
                || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
                || user?.firstName
                || 'Cliente';
            const draftPhone = options?.clientDraft?.phone ?? user?.phoneNumber ?? null;
            const draftEmail = options?.clientDraft?.email ?? user?.email ?? null;
            let draftDni = options?.clientDraft?.dni ?? null;
            if (!draftDni && user?.id) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: Number(user.id) },
                    select: { dni: true }
                });
                draftDni = dbUser?.dni || null;
            }

            const resolvedClient = await prisma.$transaction(async (tx) => {
                return this.resolveOrCreateClient(tx, {
                    clubId: fixedClubId,
                    userId: user?.id ?? null,
                    name: draftName,
                    phone: draftPhone,
                    email: draftEmail,
                    dni: draftDni,
                    forceCreateNew: options?.clientDraft?.duplicateResolution === 'CREATE_NEW'
                });
            });

            resolvedFixedClient = {
                id: String(resolvedClient.id),
                userId: Number.isInteger(Number(resolvedClient.userId)) ? Number(resolvedClient.userId) : null,
                phone: resolvedClient.phone ?? null
            };
        }

        if (!resolvedFixedClient?.id) {
            throw new Error('No se pudo resolver un cliente para el turno fijo');
        }
        if (!this.normalizePhone(resolvedFixedClient.phone || null)) {
            throw new Error('El cliente del turno fijo debe tener teléfono válido.');
        }

        console.info('[FIXED_BOOKING] Inicio de generación', {
            courtId,
            activityId,
            clubId: (court as any)?.club?.id,
            firstStart: firstStart.toISOString(),
            totalOccurrences,
            generationFrequencyDays
        });

        let fixedBooking: any;
        let generatedCount = 0;
        let fixedClientId: string = '';
        const createdOccurrences: Array<{
            bookingId: number;
            startDateTime: Date;
            endDateTime: Date;
            status: string;
            courtName: string;
            activityName: string;
        }> = [];
        const skippedOccurrences: Array<{
            requestedStartDateTime: Date;
            requestedEndDateTime: Date;
            reason: string;
            conflictingBookingId?: number;
            conflictingStartDateTime?: Date;
            conflictingEndDateTime?: Date;
            conflictingClientName?: string;
            conflictingCourtName?: string;
            conflictingActivityName?: string;
            conflictingStatus?: string;
        }> = [];

        await prisma.$transaction(async (tx) => {
            fixedClientId = String(resolvedFixedClient?.id || '');
            fixedBooking = await tx.fixedBooking.create({
                data: {
                    clientId: fixedClientId,
                    ...(resolvedFixedClient?.userId ? { userId: Number(resolvedFixedClient.userId) } : {}),
                    courtId,
                    activityId,
                    clubId: (court as any).club.id,
                    startDate: firstStart,
                    dayOfWeek,
                    startTimeMinutes,
                    endTimeMinutes,
                    status: 'ACTIVE'
                }
            });

            const existingBookings = await tx.booking.findMany({
                where: {
                    courtId,
                    status: { not: 'CANCELLED' },
                    startDateTime: { lt: lastEnd },
                    endDateTime: { gt: firstStart }
                },
                include: {
                    user: true,
                    client: true,
                    court: true,
                    activity: true
                }
            });

            for (let i = 0; i < totalOccurrences; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * generationFrequencyDays));

                const currentEnd = new Date(currentStart.getTime() + duration * 60000);
                this.assertValidRange(currentStart, currentEnd);

                const conflictingBooking = existingBookings.find((existing: any) => {
                    return existing.startDateTime < currentEnd && existing.endDateTime > currentStart;
                });
                const hasConflict = Boolean(conflictingBooking);

                if (hasConflict) {
                    skippedOccurrences.push({
                        requestedStartDateTime: currentStart,
                        requestedEndDateTime: currentEnd,
                        reason: 'BOOKING_OVERLAP',
                        conflictingBookingId: Number(conflictingBooking?.id),
                        conflictingStartDateTime: conflictingBooking?.startDateTime,
                        conflictingEndDateTime: conflictingBooking?.endDateTime,
                        conflictingClientName: conflictingBooking?.client?.name
                            || `${conflictingBooking?.user?.firstName || ''} ${conflictingBooking?.user?.lastName || ''}`.trim()
                            || 'Cliente',
                        conflictingCourtName: conflictingBooking?.court?.name || '',
                        conflictingActivityName: conflictingBooking?.activity?.name || '',
                        conflictingStatus: conflictingBooking?.status || ''
                    });
                    continue;
                }

                try {
                    const createdBooking = await this.createBooking(
                        resolvedFixedClient?.userId ? Number(resolvedFixedClient.userId) : null,
                        courtId,
                        currentStart,
                        activityId,
                        duration,
                        true,
                        {
                            skipAccountCreation: true,
                            skipAdvanceLimit: true,
                            actorUserId: options?.actorUserId ?? null,
                            clientId: fixedClientId
                        }
                    );

                    await tx.booking.update({
                        where: { id: createdBooking.id },
                        data: { fixedBookingId: fixedBooking.id }
                    });

                    createdOccurrences.push({
                        bookingId: createdBooking.id,
                        startDateTime: createdBooking.startDateTime,
                        endDateTime: createdBooking.endDateTime,
                        status: String(createdBooking.status || 'PENDING'),
                        courtName: String(createdBooking?.court?.name || court.name || ''),
                        activityName: String(createdBooking?.activity?.name || activity?.name || '')
                    });
                    generatedCount += 1;
                } catch (error) {
                    if (
                        this.isOverlapConstraintError(error)
                        || String((error as Error)?.message || '').includes('ya fue reservado')
                        || String((error as Error)?.message || '').includes('SLOT_ALREADY_BOOKED')
                    ) {
                        skippedOccurrences.push({
                            requestedStartDateTime: currentStart,
                            requestedEndDateTime: currentEnd,
                            reason: 'BOOKING_OVERLAP'
                        });
                        continue;
                    }
                    throw error;
                }
            }

            if (generatedCount === 0) {
                const noOccurrencesError: any = new Error('No se pudo crear ningún turno fijo porque todos los horarios se superponen.');
                noOccurrencesError.code = 'FIXED_BOOKING_NO_OCCURRENCES';
                noOccurrencesError.overlaps = skippedOccurrences;
                throw noOccurrencesError;
            }
        });

        console.info('[FIXED_BOOKING] Generación completada', {
            fixedBookingId: fixedBooking.id,
            generatedCount,
            courtId,
            activityId,
            clientId: fixedClientId,
            clubId: (court as any).club.id
        });

        return {
            fixedBookingId: fixedBooking.id,
            clientId: fixedClientId,
            generatedCount,
            createdOccurrences,
            skippedOccurrences,
            msg: `Se crearon ${generatedCount} turnos pendientes.`
        };
    }

    async cancelFixedBooking(input: {
        fixedBookingId: number;
        clubId: number;
        scope: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
        occurrenceBookingId?: number;
        previewOnly?: boolean;
        actorUserId?: number | null;
    }) {
        const fixedBooking = await prisma.fixedBooking.findFirst({
            where: { id: input.fixedBookingId },
            include: { court: { include: { club: true } } }
        });
        if (!fixedBooking) {
            throw new Error('Turno fijo no encontrado');
        }
        if (Number(fixedBooking.court?.club?.id || 0) !== Number(input.clubId)) {
            throw new Error('No tienes acceso a este turno fijo');
        }

        const now = new Date();
        const scope = input.scope || 'ALL_OCCURRENCES';
        const previewOnly = Boolean(input.previewOnly);
        const skipped: Array<{ bookingId: number; reason: string; status?: string; startDateTime?: Date }> = [];
        const mapApplicableCancelItem = (item: any) => ({
            bookingId: Number(item?.id || 0) || undefined,
            startDateTime: item?.startDateTime || null,
            endDateTime: item?.endDateTime || null,
            courtName: String(item?.court?.name || ''),
            activityName: String(item?.activity?.name || '')
        });

        if (scope === 'THIS_OCCURRENCE') {
            const occurrenceBookingId = Number(input.occurrenceBookingId || 0);
            if (!Number.isFinite(occurrenceBookingId) || occurrenceBookingId <= 0) {
                throw new Error('Debes indicar la ocurrencia a cancelar.');
            }

            const occurrence = await prisma.booking.findFirst({
                where: {
                    id: occurrenceBookingId,
                    fixedBookingId: input.fixedBookingId,
                    clubId: input.clubId
                },
                select: {
                    id: true,
                    status: true,
                    startDateTime: true,
                    endDateTime: true,
                    court: { select: { name: true } },
                    activity: { select: { name: true } }
                }
            });
            if (!occurrence) {
                throw new Error('La ocurrencia seleccionada no pertenece a la serie.');
            }

            const isPast = new Date(occurrence.startDateTime).getTime() < now.getTime();
            const isCompleted = String(occurrence.status || '').toUpperCase() === 'COMPLETED';
            const isCancelled = String(occurrence.status || '').toUpperCase() === 'CANCELLED';
            const canCancel = !isPast && !isCompleted && !isCancelled;

            if (!canCancel) {
                skipped.push({
                    bookingId: Number(occurrence.id),
                    reason: isCancelled
                        ? 'Ya estaba cancelada.'
                        : isCompleted
                            ? 'No se puede cancelar una reserva completada.'
                            : 'No se pueden cancelar ocurrencias pasadas.',
                    status: String(occurrence.status || ''),
                    startDateTime: occurrence.startDateTime
                });
            }

            if (!previewOnly && canCancel) {
                await prisma.booking.update({
                    where: { id: Number(occurrence.id) },
                    data: { status: 'CANCELLED' }
                });
            }

            const applicableItems = canCancel ? [mapApplicableCancelItem(occurrence)] : [];

            return {
                preview: previewOnly,
                scope,
                totalCandidates: 1,
                cancelledCount: canCancel ? 1 : 0,
                skippedCount: skipped.length,
                skipped,
                applicableItems,
                cancelledItems: previewOnly ? [] : applicableItems
            };
        }

        const occurrenceBookingId = Number(input.occurrenceBookingId || 0);
        const occurrence = Number.isFinite(occurrenceBookingId) && occurrenceBookingId > 0
            ? await prisma.booking.findFirst({
                where: {
                    id: occurrenceBookingId,
                    fixedBookingId: input.fixedBookingId,
                    clubId: input.clubId
                },
                select: { id: true, startDateTime: true }
            })
            : null;
        if (scope === 'NEXT_OCCURRENCES' && !occurrence) {
            throw new Error('La ocurrencia seleccionada no pertenece a la serie.');
        }

        const pivotDate = scope === 'NEXT_OCCURRENCES'
            ? new Date(occurrence!.startDateTime)
            : now;

        const candidates = await prisma.booking.findMany({
            where: {
                fixedBookingId: input.fixedBookingId,
                clubId: input.clubId,
                status: { not: 'CANCELLED' },
                startDateTime: { gte: pivotDate }
            },
            select: {
                id: true,
                status: true,
                startDateTime: true,
                endDateTime: true,
                court: { select: { name: true } },
                activity: { select: { name: true } }
            },
            orderBy: { startDateTime: 'asc' }
        });

        if (candidates.length === 0) {
            return {
                preview: previewOnly,
                scope,
                totalCandidates: 0,
                cancelledCount: 0,
                skippedCount: 0,
                skipped: [] as Array<{ bookingId: number; reason: string; status?: string; startDateTime?: Date }>,
                applicableItems: [] as Array<Record<string, unknown>>,
                cancelledItems: [] as Array<Record<string, unknown>>
            };
        }

        const cancellableIds: number[] = [];
        const applicableItems: Array<Record<string, unknown>> = [];
        for (const candidate of candidates) {
            const isCompleted = String(candidate.status || '').toUpperCase() === 'COMPLETED';
            if (isCompleted) {
                skipped.push({
                    bookingId: Number(candidate.id),
                    reason: 'No se puede cancelar una reserva completada.',
                    status: String(candidate.status || ''),
                    startDateTime: candidate.startDateTime
                });
                continue;
            }
            cancellableIds.push(Number(candidate.id));
            applicableItems.push(mapApplicableCancelItem(candidate));
        }

        if (!previewOnly && cancellableIds.length > 0) {
            await prisma.booking.updateMany({
                where: { id: { in: cancellableIds } },
                data: { status: 'CANCELLED' }
            });
            await prisma.fixedBooking.update({
                where: { id: input.fixedBookingId },
                data: { status: 'CANCELLED' }
            });
        }

        return {
            preview: previewOnly,
            scope,
            totalCandidates: candidates.length,
            cancelledCount: cancellableIds.length,
            skippedCount: skipped.length,
            skipped,
            applicableItems,
            cancelledItems: previewOnly ? [] : applicableItems
        };
    }

    async rescheduleFixedBooking(input: {
        fixedBookingId: number;
        clubId: number;
        scope: 'THIS_OCCURRENCE' | 'NEXT_OCCURRENCES' | 'ALL_OCCURRENCES';
        occurrenceBookingId?: number;
        courtId: number;
        startDateTime: Date;
        durationMinutes?: number;
        previewOnly?: boolean;
        actorUserId?: number | null;
    }) {
        const fixedBooking = await prisma.fixedBooking.findFirst({
            where: { id: input.fixedBookingId },
            include: {
                court: {
                    include: {
                        club: {
                            include: { settings: true }
                        }
                    }
                },
                activity: true
            }
        });
        if (!fixedBooking) {
            throw new Error('Turno fijo no encontrado');
        }
        if (Number(fixedBooking.court?.club?.id || 0) !== Number(input.clubId)) {
            throw new Error('No tienes acceso a este turno fijo');
        }

        const previewOnly = Boolean(input.previewOnly);
        const resolveRequestedEnd = (startDate: Date, sourceDuration?: number, fallbackDuration?: number) => {
            const resolvedDuration = Number(sourceDuration);
            const safeDuration =
                Number.isFinite(resolvedDuration) && resolvedDuration > 0
                    ? Math.floor(resolvedDuration)
                    : Math.max(15, Number(fallbackDuration || 60));
            return new Date(startDate.getTime() + safeDuration * 60000);
        };
        const mapOverlap = (params: {
            requestedStartDateTime: Date;
            requestedEndDateTime: Date;
            conflict: any;
            candidateBookingId?: number;
        }) => ({
            bookingId: Number(params.candidateBookingId || 0) || undefined,
            requestedStartDateTime: params.requestedStartDateTime,
            requestedEndDateTime: params.requestedEndDateTime,
            reason: 'BOOKING_OVERLAP',
            conflictingBookingId: Number(params.conflict?.id || 0) || undefined,
            conflictingStartDateTime: params.conflict?.startDateTime,
            conflictingEndDateTime: params.conflict?.endDateTime,
            conflictingClientName: params.conflict?.client?.name
                || `${params.conflict?.user?.firstName || ''} ${params.conflict?.user?.lastName || ''}`.trim()
                || 'Cliente',
            conflictingCourtName: params.conflict?.court?.name || '',
            conflictingActivityName: params.conflict?.activity?.name || '',
            conflictingStatus: params.conflict?.status || ''
        });
        const mapApplicableRescheduleItem = (params: {
            bookingId?: number;
            startDateTime: Date;
            endDateTime: Date;
            courtName?: string;
            activityName?: string;
        }) => ({
            bookingId: Number(params.bookingId || 0) || undefined,
            startDateTime: params.startDateTime,
            endDateTime: params.endDateTime,
            courtName: String(params.courtName || ''),
            activityName: String(params.activityName || '')
        });

        if (input.scope === 'THIS_OCCURRENCE') {
            const occurrenceBookingId = Number(input.occurrenceBookingId || 0);
            if (!Number.isFinite(occurrenceBookingId) || occurrenceBookingId <= 0) {
                throw new Error('Debes indicar la ocurrencia a editar.');
            }
            const occurrence = await prisma.booking.findFirst({
                where: {
                    id: occurrenceBookingId,
                    fixedBookingId: input.fixedBookingId,
                    clubId: input.clubId
                },
                select: { id: true }
            });
            if (!occurrence) {
                throw new Error('La ocurrencia seleccionada no pertenece a la serie.');
            }

            const currentBooking = await prisma.booking.findFirst({
                where: {
                    id: occurrenceBookingId,
                    clubId: input.clubId
                },
                select: {
                    id: true,
                    startDateTime: true,
                    endDateTime: true
                }
            });
            if (!currentBooking) {
                throw new Error('Reserva no encontrada');
            }
            const targetCourtForOccurrence = await prisma.court.findFirst({
                where: { id: input.courtId, clubId: input.clubId },
                select: {
                    id: true,
                    name: true,
                    activityType: { select: { name: true } }
                }
            });
            if (!targetCourtForOccurrence) {
                throw new Error('Cancha destino inválida');
            }
            const currentDurationMinutes = Math.max(
                15,
                Math.round(
                    (new Date(currentBooking.endDateTime).getTime() - new Date(currentBooking.startDateTime).getTime()) / 60000
                )
            );
            const requestedEndDateTime = resolveRequestedEnd(
                new Date(input.startDateTime),
                input.durationMinutes,
                currentDurationMinutes
            );
            const conflict = await prisma.booking.findFirst({
                where: {
                    clubId: input.clubId,
                    courtId: input.courtId,
                    id: { not: occurrenceBookingId },
                    status: { not: 'CANCELLED' },
                    startDateTime: { lt: requestedEndDateTime },
                    endDateTime: { gt: input.startDateTime }
                },
                include: {
                    user: true,
                    client: true,
                    court: true,
                    activity: true
                }
            });
            if (conflict) {
                const overlaps = [
                    mapOverlap({
                        requestedStartDateTime: new Date(input.startDateTime),
                        requestedEndDateTime,
                        conflict,
                        candidateBookingId: occurrenceBookingId
                    })
                ];
                if (previewOnly) {
                    return {
                        preview: true,
                        scope: input.scope,
                        totalCandidates: 1,
                        willUpdateCount: 0,
                        skippedCount: 1,
                        overlaps,
                        failedCount: 0,
                        failures: [] as Array<{ bookingId: number; reason: string }>
                    };
                }
                const overlapError: any = new Error('El nuevo horario se superpone con otra reserva.');
                overlapError.code = 'BOOKING_OVERLAP';
                overlapError.overlaps = overlaps;
                throw overlapError;
            }

            if (previewOnly) {
                const applicableItems = [
                    mapApplicableRescheduleItem({
                        bookingId: occurrenceBookingId,
                        startDateTime: new Date(input.startDateTime),
                        endDateTime: requestedEndDateTime,
                        courtName: targetCourtForOccurrence.name,
                        activityName: String(targetCourtForOccurrence?.activityType?.name || '')
                    })
                ];
                return {
                    preview: true,
                    scope: input.scope,
                    totalCandidates: 1,
                    willUpdateCount: 1,
                    skippedCount: 0,
                    overlaps: [] as Array<Record<string, unknown>>,
                    failedCount: 0,
                    failures: [] as Array<{ bookingId: number; reason: string }>,
                    applicableItems,
                    updatedItems: [] as Array<Record<string, unknown>>
                };
            }

            const booking = await this.rescheduleBooking({
                bookingId: occurrenceBookingId,
                clubId: input.clubId,
                courtId: input.courtId,
                startDateTime: input.startDateTime,
                durationMinutes: input.durationMinutes,
                actorUserId: input.actorUserId ?? null
            });
            const updatedItems = [
                mapApplicableRescheduleItem({
                    bookingId: occurrenceBookingId,
                    startDateTime: new Date(input.startDateTime),
                    endDateTime: requestedEndDateTime,
                    courtName: targetCourtForOccurrence.name,
                    activityName: String(targetCourtForOccurrence?.activityType?.name || '')
                })
            ];
            return {
                preview: false,
                scope: input.scope,
                totalCandidates: 1,
                willUpdateCount: 1,
                updatedCount: 1,
                skippedCount: 0,
                failedCount: 0,
                failures: [] as Array<{ bookingId: number; reason: string }>,
                overlaps: [] as Array<Record<string, unknown>>,
                applicableItems: updatedItems,
                updatedItems,
                booking
            };
        }

        const targetCourt = await prisma.court.findFirst({
            where: { id: input.courtId, clubId: input.clubId },
            select: {
                id: true,
                name: true,
                activityTypeId: true,
                activityType: { select: { name: true } }
            }
        });
        if (!targetCourt) {
            throw new Error('Cancha destino inválida');
        }

        const occurrenceBookingId = Number(input.occurrenceBookingId || 0);
        const occurrence = Number.isFinite(occurrenceBookingId) && occurrenceBookingId > 0
            ? await prisma.booking.findFirst({
                where: {
                    id: occurrenceBookingId,
                    fixedBookingId: input.fixedBookingId,
                    clubId: input.clubId
                },
                select: { id: true, startDateTime: true }
            })
            : null;
        if (input.scope === 'NEXT_OCCURRENCES' && !occurrence) {
            throw new Error('La ocurrencia seleccionada no pertenece a la serie.');
        }

        const now = new Date();
        const pivotDate = input.scope === 'NEXT_OCCURRENCES'
            ? new Date(occurrence!.startDateTime)
            : now;

        const candidates = await prisma.booking.findMany({
            where: {
                fixedBookingId: input.fixedBookingId,
                clubId: input.clubId,
                status: { not: 'CANCELLED' },
                startDateTime: { gte: pivotDate }
            },
            select: {
                id: true,
                startDateTime: true,
                endDateTime: true,
                status: true
            },
            orderBy: { startDateTime: 'asc' }
        });

        if (candidates.length === 0) {
            return {
                preview: previewOnly,
                scope: input.scope,
                totalCandidates: 0,
                willUpdateCount: 0,
                updatedCount: 0,
                skippedCount: 0,
                failedCount: 0,
                failures: [] as Array<{ bookingId: number; reason: string }>,
                overlaps: [] as Array<Record<string, unknown>>,
                applicableItems: [] as Array<Record<string, unknown>>,
                updatedItems: [] as Array<Record<string, unknown>>
            };
        }

        const inferFrequencyDays = (items: Array<{ startDateTime: Date }>) => {
            const diffs: number[] = [];
            for (let i = 1; i < items.length; i += 1) {
                const previousStart = new Date(items[i - 1].startDateTime).getTime();
                const currentStart = new Date(items[i].startDateTime).getTime();
                const diffMs = currentStart - previousStart;
                if (diffMs <= 0) continue;
                const diffDays = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));
                diffs.push(diffDays);
            }
            return diffs.length > 0 ? diffs[0] : 7;
        };
        const frequencyDays = inferFrequencyDays(candidates);

        let updatedCount = 0;
        const failures: Array<{ bookingId: number; reason: string }> = [];
        const overlaps: Array<Record<string, unknown>> = [];
        const applicableItems: Array<Record<string, unknown>> = [];
        const updatedItems: Array<Record<string, unknown>> = [];

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const nextStart = new Date(input.startDateTime);
            nextStart.setDate(input.startDateTime.getDate() + (index * frequencyDays));
            const nextEnd = resolveRequestedEnd(
                nextStart,
                input.durationMinutes,
                Math.round((new Date(candidate.endDateTime).getTime() - new Date(candidate.startDateTime).getTime()) / 60000)
            );

            const conflict = await prisma.booking.findFirst({
                where: {
                    clubId: input.clubId,
                    courtId: Number(targetCourt.id),
                    id: { not: Number(candidate.id) },
                    status: { not: 'CANCELLED' },
                    startDateTime: { lt: nextEnd },
                    endDateTime: { gt: nextStart }
                },
                include: {
                    user: true,
                    client: true,
                    court: true,
                    activity: true
                }
            });
            if (conflict) {
                overlaps.push(
                    mapOverlap({
                        requestedStartDateTime: nextStart,
                        requestedEndDateTime: nextEnd,
                        conflict,
                        candidateBookingId: Number(candidate.id)
                    })
                );
                continue;
            }

            if (previewOnly) {
                updatedCount += 1;
                applicableItems.push(
                    mapApplicableRescheduleItem({
                        bookingId: Number(candidate.id),
                        startDateTime: nextStart,
                        endDateTime: nextEnd,
                        courtName: targetCourt.name,
                        activityName: String(targetCourt?.activityType?.name || '')
                    })
                );
                continue;
            }

            try {
                await this.rescheduleBooking({
                    bookingId: candidate.id,
                    clubId: input.clubId,
                    courtId: Number(targetCourt.id),
                    startDateTime: nextStart,
                    durationMinutes: input.durationMinutes,
                    actorUserId: input.actorUserId ?? null
                });
                updatedCount += 1;
                const mapped = mapApplicableRescheduleItem({
                    bookingId: Number(candidate.id),
                    startDateTime: nextStart,
                    endDateTime: nextEnd,
                    courtName: targetCourt.name,
                    activityName: String(targetCourt?.activityType?.name || '')
                });
                applicableItems.push(mapped);
                updatedItems.push(mapped);
            } catch (error: any) {
                failures.push({
                    bookingId: candidate.id,
                    reason: String(error?.message || 'No se pudo reprogramar')
                });
            }
        }

        if (previewOnly) {
            return {
                preview: true,
                scope: input.scope,
                totalCandidates: candidates.length,
                willUpdateCount: updatedCount,
                skippedCount: overlaps.length,
                failedCount: failures.length,
                overlaps,
                failures,
                applicableItems,
                updatedItems: [] as Array<Record<string, unknown>>
            };
        }

        const resolvedDuration = Number(input.durationMinutes);
        const currentDuration = Math.max(
            15,
            Math.round(
                (new Date(candidates[0].endDateTime).getTime() - new Date(candidates[0].startDateTime).getTime()) / 60000
            )
        );
        const safeDuration = Number.isFinite(resolvedDuration) && resolvedDuration > 0
            ? Math.floor(resolvedDuration)
            : currentDuration;
        const clubConfig = this.resolveClubConfig((fixedBooking.court as any)?.club);
        const clubTimeZone = clubConfig.timeZone ?? 'America/Argentina/Buenos_Aires';
        const localStart = TimeHelper.utcToLocal(input.startDateTime, clubTimeZone);
        const localEnd = TimeHelper.utcToLocal(new Date(input.startDateTime.getTime() + safeDuration * 60000), clubTimeZone);
        const startTimeMinutes = (localStart.getHours() * 60) + localStart.getMinutes();
        const endTimeMinutes = (localEnd.getHours() * 60) + localEnd.getMinutes();

        if (updatedCount > 0) {
            await prisma.fixedBooking.update({
                where: { id: input.fixedBookingId },
                data: {
                    courtId: Number(targetCourt.id),
                    activityId: Number(targetCourt.activityTypeId || fixedBooking.activityId),
                    startDate: input.startDateTime,
                    dayOfWeek: localStart.getDay(),
                    startTimeMinutes,
                    endTimeMinutes
                }
            });
        }

        return {
            preview: false,
            scope: input.scope,
            totalCandidates: candidates.length,
            willUpdateCount: updatedCount,
            updatedCount,
            skippedCount: overlaps.length,
            failedCount: failures.length,
            failures,
            overlaps,
            applicableItems,
            updatedItems
        };
    }

    async getBookingItems(bookingId: number, clubId: number) {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: { id: true, status: true }
        });
        if (!booking) {
            throw new Error('Reserva no encontrada para el club indicado');
        }

        const account = await prisma.account.findFirst({
            where: { clubId, sourceType: 'BOOKING', sourceId: String(bookingId) },
            include: {
                items: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        discounts: {
                            include: {
                                policy: { select: { id: true, name: true } }
                            }
                        }
                    }
                }
            }
        });

        if (!account) {
            const status = String(booking.status || '').toUpperCase();
            if (status === 'CONFIRMED' || status === 'COMPLETED') {
                throw new Error(
                    `Inconsistencia de integridad: la reserva ${bookingId} está ${status} pero no tiene Account BOOKING`
                );
            }
            return [];
        }

        const itemIds = account.items.map((item) => item.id);
        const paidByItem = new Map<string, number>();
        if (itemIds.length > 0) {
            const allocations = await prisma.paymentAllocation.groupBy({
                by: ['accountItemId'],
                where: {
                    accountId: account.id,
                    accountItemId: { in: itemIds }
                },
                _sum: { amount: true }
            });
            for (const row of allocations) {
                paidByItem.set(row.accountItemId, Number(row._sum.amount || 0));
            }
        }

        return account.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            price: Number(item.unitPrice || 0),
            totalPrice: Number(item.total || 0),
            description: item.description,
            type: item.type,
            paidAmount: Number((paidByItem.get(item.id) || 0).toFixed(2)),
            remainingAmount: Number(Math.max(0, Number(item.total || 0) - (paidByItem.get(item.id) || 0)).toFixed(2)),
            discounts: Array.isArray((item as any).discounts)
                ? (item as any).discounts.map((discount: any) => ({
                    id: discount.id,
                    policyId: discount.policyId,
                    policyName: discount.policy?.name ?? null,
                    scope: discount.scope,
                    amountType: discount.amountType,
                    amountValue: Number(discount.amountValue || 0),
                    baseAmount: Number(discount.baseAmount || 0),
                    discountAmount: Number(discount.discountAmount || 0),
                    finalAmount: Number(discount.finalAmount || 0)
                }))
                : []
        }));
    }

    async addItemToBooking(
        bookingId: number,
        productId: number,
        quantity: number,
        clubId: number,
        _paymentMethod: string = 'CASH',
        options?: { applyDiscount?: boolean; actorUserId?: number | null }
    ) {
        const booking = await prisma.booking.findFirst({ where: { id: bookingId, clubId } });
        const product = await prisma.product.findFirst({ where: { id: productId, clubId } });
        if (!booking || !product) throw new Error('Datos no encontrados');
        if (booking.status === 'CANCELLED') throw new Error('No se pueden agregar consumos a una reserva cancelada');
        if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
            throw new Error('Solo se pueden agregar consumos a reservas confirmadas o finalizadas');
        }

        const normalizedQty = Math.floor(Number(quantity));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw new Error('Cantidad inválida');

        const result = await prisma.$transaction(async (tx) => {
            const txProduct = await tx.product.findFirst({
                where: { id: productId, clubId },
                select: { id: true, name: true, price: true, stock: true, category: true }
            });
            if (!txProduct) throw new Error('Producto no encontrado');
            if (Number(txProduct.stock) < normalizedQty) throw new Error('Stock insuficiente');

            let account = await tx.account.findFirst({
                where: { clubId, sourceType: 'BOOKING', sourceId: String(bookingId) }
            });

            if (!account) {
                account = await this.ensureBookingAccountWithChargeTx(tx, {
                    bookingId,
                    clubId,
                    bookingPrice: Number(booking.price || 0),
                    activityTypeId: booking.activityId,
                    clientId: booking.clientId,
                    actorUserId: options?.actorUserId ?? null
                });
            }
            if (account.status !== 'OPEN') throw new Error('No se pueden agregar consumos a una cuenta cerrada');

            const discountDraft = options?.applyDiscount === false
                ? {
                    unitPrice: Number(Number(txProduct.price || 0).toFixed(2)),
                    total: Number((Number(txProduct.price || 0) * normalizedQty).toFixed(2)),
                    snapshots: []
                }
                : await this.discountService.computeDraftDiscountTx(tx, {
                    clubId,
                    clientId: booking.clientId,
                    itemType: 'PRODUCT',
                    quantity: normalizedQty,
                    unitPrice: Number(txProduct.price || 0),
                    productId: txProduct.id,
                    productCategory: txProduct.category
                });

            const createdItem = await tx.accountItem.create({
                data: {
                    accountId: account.id,
                    type: 'PRODUCT',
                    productId: txProduct.id,
                    description: txProduct.name,
                    quantity: normalizedQty,
                    unitPrice: discountDraft.unitPrice,
                    total: discountDraft.total
                }
            });

            await tx.account.update({
                where: { id: account.id },
                data: {
                    totalAmount: { increment: discountDraft.total }
                }
            });

            await this.accountingService.createAccountItemTransaction(tx, {
                clubId,
                type: 'ACCOUNT_ITEM',
                referenceType: 'ACCOUNT_ITEM',
                referenceId: createdItem.id,
                accountId: account.id,
                accountItemId: createdItem.id,
                amount: discountDraft.total,
                revenueAccount: 'BAR_REVENUE',
                description: txProduct.name
            });

            if (discountDraft.snapshots.length) {
                await this.discountService.persistAppliedDiscountsTx(tx, {
                    clubId,
                    accountItemId: createdItem.id,
                    appliedByUserId: options?.actorUserId ?? null,
                    snapshots: discountDraft.snapshots
                });
            }

            await this.eventService.productSold(clubId, {
                bookingId,
                accountId: account.id,
                accountItemId: createdItem.id,
                productId: txProduct.id,
                productName: txProduct.name,
                quantity: normalizedQty,
                unitPrice: Number(createdItem.unitPrice || 0),
                totalAmount: Number(createdItem.total || 0),
                actorUserId: options?.actorUserId ?? null,
                source: 'BOOKING_CONSUMPTION'
            }, tx as any);

            const stockUpdate = await tx.product.updateMany({
                where: { id: productId, clubId, stock: { gte: normalizedQty } },
                data: { stock: { decrement: normalizedQty } }
            });
            if (stockUpdate.count !== 1) throw new Error('Stock insuficiente');

            await this.projectionService.refreshAccountSummary(account.id, tx);

            return createdItem;
        });

        return {
            id: result.id,
            quantity: result.quantity,
            price: Number(result.unitPrice || 0),
            totalPrice: Number(result.total || 0),
            description: result.description
        };
    }

    async quoteItemForBooking(
        bookingId: number,
        productId: number,
        quantity: number,
        clubId: number,
        options?: { applyDiscount?: boolean }
    ) {
        const booking = await prisma.booking.findFirst({ where: { id: bookingId, clubId } });
        const product = await prisma.product.findFirst({ where: { id: productId, clubId } });
        if (!booking || !product) throw new Error('Datos no encontrados');
        if (booking.status === 'CANCELLED') throw new Error('Reserva cancelada');
        if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
            throw new Error('Solo se pueden cotizar consumos para reservas confirmadas o finalizadas');
        }

        const normalizedQty = Math.floor(Number(quantity));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw new Error('Cantidad inválida');

        const quote = await prisma.$transaction(async (tx) => {
            const txProduct = await tx.product.findFirst({
                where: { id: productId, clubId },
                select: { id: true, name: true, price: true, category: true }
            });
            if (!txProduct) throw new Error('Producto no encontrado');

            const unitListPrice = Number(Number(txProduct.price || 0).toFixed(2));
            const discountDraft = options?.applyDiscount === false
                ? { unitPrice: unitListPrice, total: Number((unitListPrice * normalizedQty).toFixed(2)), snapshots: [] }
                : await this.discountService.computeDraftDiscountTx(tx, {
                    clubId,
                    clientId: booking.clientId,
                    itemType: 'PRODUCT',
                    quantity: normalizedQty,
                    unitPrice: unitListPrice,
                    productId: txProduct.id,
                    productCategory: txProduct.category
                });

            const policyIds = Array.from(new Set((discountDraft.snapshots || []).map((snapshot: any) => snapshot.policyId)));
            const policies = policyIds.length
                ? await tx.discountPolicy.findMany({ where: { id: { in: policyIds } }, select: { id: true, name: true } })
                : [];
            const policyNameById = new Map(policies.map((policy) => [policy.id, policy.name]));

            const finalTotal = Number(Number(discountDraft.total || unitListPrice * normalizedQty).toFixed(2));
            const listTotal = Number((unitListPrice * normalizedQty).toFixed(2));
            const discountAmount = Number(Math.max(0, listTotal - finalTotal).toFixed(2));

            return {
                productId: txProduct.id,
                productName: txProduct.name,
                quantity: normalizedQty,
                listUnitPrice: unitListPrice,
                finalUnitPrice: Number(Number(discountDraft.unitPrice || unitListPrice).toFixed(2)),
                listTotal,
                finalTotal,
                discountAmount,
                hasDiscount: discountAmount > 0.009,
                appliedPolicies: (discountDraft.snapshots || []).map((snapshot: any) => ({
                    policyId: snapshot.policyId,
                    policyName: policyNameById.get(snapshot.policyId) || 'Política sin nombre',
                    discountAmount: Number(snapshot.discountAmount || 0)
                }))
            };
        });

        return quote;
    }

    async removeItemFromBooking(itemId: string, clubId: number) {
        return prisma.$transaction(async (tx) => {
            const item = await tx.accountItem.findUnique({
                where: { id: itemId },
                include: {
                    account: true
                }
            });
            if (!item) throw new Error('Item no encontrado');
            if (item.account.clubId !== clubId) {
                throw new Error('No tienes acceso a este consumo');
            }
            if (item.account.status !== 'OPEN') {
                throw new Error('Solo se pueden eliminar consumos de cuentas abiertas');
            }
            if (item.type === 'BOOKING') {
                throw new Error('El concepto de cancha no se puede eliminar desde consumos');
            }

            const allocated = await tx.paymentAllocation.aggregate({
                where: { accountItemId: item.id },
                _sum: { amount: true }
            });
            const allocatedAmount = Number(allocated._sum.amount || 0);
            if (allocatedAmount > 0.009) {
                throw new Error('No se puede eliminar el consumo porque tiene pagos asociados');
            }

            const itemTotal = Number(item.total || 0);
            const currentTotal = Number(item.account.totalAmount || 0);
            const paidAmount = await this.accountService.calculateNetPaidAmountTx(tx, item.accountId);
            const nextTotal = Number((currentTotal - itemTotal).toFixed(2));

            if (paidAmount > nextTotal + 0.009) {
                throw new Error('No se puede eliminar el consumo porque dejaría la cuenta sobrepagada');
            }

            await tx.account.update({
                where: { id: item.accountId },
                data: {
                    totalAmount: { decrement: item.total }
                }
            });

            if (item.productId) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: { increment: item.quantity }
                    }
                });
            }

            await this.accountingService.reverseAccountItemTransaction(tx, {
                clubId,
                type: 'ACCOUNT_ITEM',
                referenceType: 'ACCOUNT_ITEM',
                referenceId: item.id,
                accountId: item.accountId,
                accountItemId: item.id,
                amount: itemTotal,
                revenueAccount: 'BAR_REVENUE',
                description: `Reversión consumo ${item.description}`
            });

            const bookingIdFromAccount = (() => {
                const sourceType = String(item.account?.sourceType || '').toUpperCase();
                const sourceIdRaw = String(item.account?.sourceId || '').trim();
                if (sourceType !== 'BOOKING') return null;
                const parsed = Number(sourceIdRaw);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
            })();

            await this.eventService.productRemoved(clubId, {
                bookingId: bookingIdFromAccount,
                accountId: item.accountId,
                accountItemId: item.id,
                productId: item.productId ?? null,
                productName: item.description || null,
                quantity: Number(item.quantity || 0),
                unitPrice: Number(item.unitPrice || 0),
                totalAmount: Number(item.total || 0),
                actorUserId: null,
                source: 'BOOKING_CONSUMPTION'
            }, tx as any);

            const deleted = await tx.accountItem.delete({ where: { id: itemId } });
            await this.projectionService.refreshAccountSummary(item.accountId, tx);
            return deleted;
        });
    }

}
