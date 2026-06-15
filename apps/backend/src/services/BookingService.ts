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
import { BookingParticipantStatus, BookingStatus, ChargeMode, Prisma, RefundReasonType } from '@prisma/client';
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
import { normalizeEmail } from '../utils/magicLink';
import { recordUserClientLinkAuditTx } from './UserClientLinkAudit';
import { ClubPaymentIntegrationService } from './ClubPaymentIntegrationService';
import { MercadoPagoService } from './MercadoPagoService';
import { mercadoPagoConfig } from '../utils/mercadoPagoConfig';
import { featureFlags } from '../config/featureFlags';
import { PaymentService } from './PaymentService';
import { PersonService } from './PersonService';
import { BookingHistoryService } from './BookingHistoryService';
import { BookingCustomerWhatsappNotificationService } from './BookingCustomerWhatsappNotificationService';
import { BookingStaffWhatsappNotificationService } from './BookingStaffWhatsappNotificationService';
import { AppError, ErrorCodes, badRequest, conflict, forbidden, notFound } from '../errors';

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
    ownerUserSelection?: {
        userId: number;
        personKey: string;
        searchQuery: string;
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
    ownerUserSelection?: {
        userId: number;
        personKey: string;
        searchQuery: string;
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

export type PlayerBookingDto = {
    id: string;
    publicCode: string;
    club: {
        id: string;
        name: string;
        slug: string;
        timeZone: string;
    };
    court: {
        name: string;
    };
    activity: {
        name: string;
    } | null;
    startDateTime: string;
    endDateTime: string;
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    myRole: 'OWNER' | 'PARTICIPANT';
    paymentSummary: {
        status: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'PAID';
        label: string;
    };
    capabilities: {
        canView: true;
        canCancelBooking: boolean;
        canLeaveBooking: boolean;
        canPay: false;
        canInvitePlayers: boolean;
    };
};

export type PlayerBookingParticipantDto = {
    id: string;
    displayName: string;
    status: 'INVITED' | 'JOINED' | 'DECLINED' | 'LEFT' | 'REMOVED';
    role: 'ORGANIZER' | 'PARTICIPANT';
    isMe: boolean;
    invitedEmail?: string | null;
    canManage: boolean;
};

export type AdminBookingParticipantDto = {
    id: string;
    bookingId: number;
    clientId: string | null;
    userId: number | null;
    displayName: string;
    email?: string | null;
    phone?: string | null;
    status: 'INVITED' | 'JOINED' | 'DECLINED' | 'LEFT' | 'REMOVED';
    role: 'ORGANIZER' | 'PARTICIPANT';
    invitedEmail?: string | null;
    invitedName?: string | null;
};

export type PlayerBookingInvitationDto = {
    id: string;
    bookingId: string;
    bookingPublicCode: string;
    club: {
        name: string;
        slug: string;
        timeZone: string;
    };
    court: {
        name: string;
    };
    startDateTime: string;
    endDateTime: string;
    invitedName?: string | null;
    invitedEmail?: string | null;
    status: 'INVITED';
};

export type PlayerBookingCheckoutDto = {
    booking: {
        id: string;
        publicCode: string;
        clubName: string;
        courtName: string;
        startDateTime: string;
        endDateTime: string;
        status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
        myRole: 'OWNER' | 'PARTICIPANT';
    };
    account: {
        id: string;
        status: 'OPEN' | 'CLOSED';
        total: number;
        paid: number;
        pending: number;
        currency: 'ARS';
        items: Array<{
            label: string;
            quantity: number;
            unitPrice: number;
            total: number;
            type: 'COURT' | 'PRODUCT' | 'SERVICE' | 'OTHER';
        }>;
    } | null;
    paymentSummary: {
        status: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'PAID' | 'BLOCKED';
        label: string;
    };
    checkout: {
        enabled: boolean;
        reason:
            | 'PROVIDER_NOT_CONFIGURED'
            | 'BOOKING_NOT_PAYABLE'
            | 'NO_PENDING_BALANCE'
            | 'ACCOUNT_MISSING'
            | 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED'
            | 'BOOKING_HAS_REFUNDS'
            | 'UNKNOWN'
            | null;
        futureProvider: 'MERCADO_PAGO' | null;
    };
};

export type PlayerBookingCheckoutStartDto = {
    attemptId: string;
    initPoint: string;
    provider: 'MERCADO_PAGO';
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
    private readonly bookingHistoryService = new BookingHistoryService();
    private readonly outboxService = new OutboxService();
    private readonly accountingService = new AccountingService();
    private readonly accountService = new AccountService();
    private readonly projectionService = new ProjectionService();
    private readonly clubPaymentIntegrationService = new ClubPaymentIntegrationService();
    private readonly mercadoPagoService = new MercadoPagoService();
    private readonly paymentService = new PaymentService();
    private readonly personService = new PersonService();
    private readonly bookingDomainService = new BookingDomainService();
    private readonly refundService = new RefundService();
    private readonly discountService = new DiscountService();
    private readonly bookingCustomerWhatsappNotificationService = new BookingCustomerWhatsappNotificationService();
    private readonly bookingStaffWhatsappNotificationService = new BookingStaffWhatsappNotificationService();

    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository,
        private cashRepository: CashRepository,
        private productRepository: ProductRepository
    ) {}

    private bookingNotFound(message = 'Reserva no encontrada') {
        return notFound(message, ErrorCodes.BOOKING_NOT_FOUND);
    }

    private bookingInvalidStatus(message: string) {
        return conflict(message, ErrorCodes.BOOKING_INVALID_STATUS);
    }

    private bookingSlotUnavailable(message: string) {
        return conflict(message, ErrorCodes.BOOKING_SLOT_UNAVAILABLE);
    }

    private bookingOverlap(message: string, overlaps?: unknown[]) {
        return conflict(message, ErrorCodes.BOOKING_OVERLAP, Array.isArray(overlaps) ? { overlaps } : undefined);
    }

    private async findClassSessionOverlap(params: {
        clubId: number;
        courtId: number;
        startDateTime: Date;
        endDateTime: Date;
    }) {
        return prisma.classSession.findFirst({
            where: {
                clubId: params.clubId,
                courtId: params.courtId,
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
                startsAt: { lt: params.endDateTime },
                endsAt: { gt: params.startDateTime }
            },
            include: {
                court: { select: { name: true } },
                activityType: { select: { name: true } },
                teacher: { select: { displayName: true } }
            }
        });
    }

    private courtNotFound(message = 'Cancha no encontrada') {
        return notFound(message, ErrorCodes.COURT_NOT_FOUND);
    }

    private activityNotFound(message = 'Actividad no encontrada') {
        return notFound(message, ErrorCodes.ACTIVITY_NOT_FOUND);
    }

    private clientNotFound(message = 'Cliente no encontrado') {
        return notFound(message, ErrorCodes.CLIENT_NOT_FOUND);
    }

    private invalidInput(message: string, meta?: Record<string, unknown>) {
        return badRequest(message, ErrorCodes.INVALID_INPUT, meta);
    }

    private parseOwnerUserSelection(selection: CreateBookingOptions['ownerUserSelection'] | CreateFixedBookingOptions['ownerUserSelection']) {
        const safeUserId = Number(selection?.userId || 0);
        const personKey = String(selection?.personKey || '').trim();
        const searchQuery = String(selection?.searchQuery || '').trim();
        if (!Number.isInteger(safeUserId) || safeUserId <= 0) return null;
        if (!personKey || searchQuery.length < 2) return null;
        return {
            userId: safeUserId,
            personKey,
            searchQuery
        };
    }

    private clubConfigInvalid(message: string) {
        return badRequest(message, ErrorCodes.CLUB_CONFIG_INVALID);
    }

    private clientPossibleDuplicate(details: Record<string, unknown>) {
        return conflict(
            'Se detectaron datos que podrían corresponder a más de un cliente. Revisá y seleccioná el cliente correcto.',
            ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
            details
        );
    }

    private bookingForbidden(message = 'No tenés permiso para ver o gestionar esta reserva.') {
        return forbidden(message, ErrorCodes.BOOKING_FORBIDDEN);
    }

    private bookingCancellationNotAllowed(message: string) {
        return conflict(message, ErrorCodes.BOOKING_CANCELLATION_NOT_ALLOWED);
    }

    private bookingHasPayments(message = 'Esta reserva tiene pagos registrados. Contactá al club para cancelarla.') {
        return conflict(message, ErrorCodes.BOOKING_HAS_PAYMENTS);
    }

    private bookingParticipantNotFound(message = 'No encontramos ese participante.') {
        return notFound(message, ErrorCodes.BOOKING_PARTICIPANT_NOT_FOUND);
    }

    private bookingParticipantAlreadyExists(message = 'Ese jugador ya está invitado o participa de esta reserva.') {
        return conflict(message, ErrorCodes.BOOKING_PARTICIPANT_ALREADY_EXISTS);
    }

    private bookingParticipantForbidden(message = 'No tenés permiso para gestionar participantes en esta reserva.') {
        return forbidden(message, ErrorCodes.BOOKING_PARTICIPANT_FORBIDDEN);
    }

    private bookingInvitationNotFound(message = 'No encontramos esa invitación.') {
        return notFound(message, ErrorCodes.BOOKING_INVITATION_NOT_FOUND);
    }

    private bookingInvitationExpired(message = 'La invitación ya no está disponible.') {
        return conflict(message, ErrorCodes.BOOKING_INVITATION_EXPIRED);
    }

    private bookingInvitationInvalid(message = 'La invitación no es válida.') {
        return conflict(message, ErrorCodes.BOOKING_INVITATION_INVALID);
    }

    private bookingInvitationAlreadyAccepted(message = 'Esa invitación ya fue aceptada.') {
        return conflict(message, ErrorCodes.BOOKING_INVITATION_ALREADY_ACCEPTED);
    }

    private bookingInvitationAlreadyDeclined(message = 'Esa invitación ya fue rechazada.') {
        return conflict(message, ErrorCodes.BOOKING_INVITATION_ALREADY_DECLINED);
    }

    private bookingInvitationEmailMismatch(message = 'Esta invitación corresponde a otro email.') {
        return forbidden(message, ErrorCodes.BOOKING_INVITATION_EMAIL_MISMATCH);
    }

    private bookingCannotInviteParticipants(message = 'No se pueden invitar participantes en esta reserva.') {
        return conflict(message, ErrorCodes.BOOKING_CANNOT_INVITE_PARTICIPANTS);
    }

    private bookingCannotLeave(message = 'No podés salirte de esta reserva desde acá.') {
        return conflict(message, ErrorCodes.BOOKING_CANNOT_LEAVE);
    }

    private isExplicitBookingOwner(booking: {
        userId?: number | null;
        client?: { userId?: number | null } | null;
        participants?: Array<{
            userId?: number | null;
            role?: string | null;
            status?: string | null;
        }> | null;
    }, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) return false;
        if (Number(booking.userId || 0) === Number(userId)) return true;
        if (Number(booking.client?.userId || 0) === Number(userId)) return true;
        return Array.isArray(booking.participants)
            ? booking.participants.some((participant) =>
                Number(participant?.userId || 0) === Number(userId) && this.isOrganizerParticipant(participant)
            )
            : false;
    }

    private isBookingParticipantJoined(booking: {
        participants?: Array<{ userId?: number | null; status?: BookingParticipantStatus | string | null }> | null;
    }, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) return false;
        return Array.isArray(booking.participants)
            ? booking.participants.some((participant) =>
                Number(participant?.userId || 0) === Number(userId) &&
                !this.isOrganizerParticipant(participant) &&
                String(participant?.status || '') === 'JOINED'
            )
            : false;
    }

    private canInviteParticipantsForPlayerBooking(booking: {
        status: BookingStatus | string;
        startDateTime: Date | string;
        userId?: number | null;
        client?: { userId?: number | null } | null;
    }, userId: number, now = new Date()) {
        if (!this.isExplicitBookingOwner(booking, userId)) return false;
        if (!(booking.status === 'PENDING' || booking.status === 'CONFIRMED')) return false;
        return new Date(booking.startDateTime).getTime() > now.getTime();
    }

    private canLeavePlayerBooking(booking: {
        status: BookingStatus | string;
        startDateTime: Date | string;
    }, now = new Date()) {
        if (!(booking.status === 'PENDING' || booking.status === 'CONFIRMED')) return false;
        return new Date(booking.startDateTime).getTime() > now.getTime();
    }

    private resolvePlayerPaymentSummary(input: {
        totalAmount: number;
        paidAmount: number;
    }): PlayerBookingDto['paymentSummary'] {
        const total = Number(Math.max(0, input.totalAmount || 0).toFixed(2));
        const paid = Number(Math.max(0, input.paidAmount || 0).toFixed(2));
        const remaining = Number(Math.max(0, total - paid).toFixed(2));

        if (total <= 0.009) {
            return {
                status: 'NOT_REQUIRED',
                label: 'Sin pagos requeridos por ahora.'
            };
        }

        if (paid <= 0.009) {
            return {
                status: 'PENDING',
                label: 'Pago pendiente con el club.'
            };
        }

        if (remaining <= 0.009) {
            return {
                status: 'PAID',
                label: 'Pago registrado.'
            };
        }

        return {
            status: 'PARTIAL',
            label: 'Pago parcial registrado.'
        };
    }

    private resolvePlayerCheckoutPaymentSummary(input: {
        totalAmount: number;
        paidAmount: number;
        accountMissing?: boolean;
        blockedByRefunds?: boolean;
    }): PlayerBookingCheckoutDto['paymentSummary'] {
        if (input.accountMissing) {
            return {
                status: 'BLOCKED',
                label: 'Todavía no hay una cuenta publicada para esta reserva.'
            };
        }

        if (input.blockedByRefunds) {
            return {
                status: 'BLOCKED',
                label: 'Esta reserva tiene devoluciones o ajustes que debe revisar el club.'
            };
        }

        return this.resolvePlayerPaymentSummary(input);
    }

    private mapPublicAccountItemType(type: string): 'COURT' | 'PRODUCT' | 'SERVICE' | 'OTHER' {
        const normalized = String(type || '').toUpperCase();
        if (normalized === 'BOOKING') return 'COURT';
        if (normalized === 'PRODUCT') return 'PRODUCT';
        if (normalized === 'SERVICE') return 'SERVICE';
        return 'OTHER';
    }

    private resolveParticipantDisplayName(input: {
        displayName?: string | null;
        invitedName?: string | null;
        invitedEmail?: string | null;
        user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
    }) {
        const snapshotName = String(input.displayName || '').trim();
        if (snapshotName) return snapshotName;
        const fullName = [String(input.user?.firstName || '').trim(), String(input.user?.lastName || '').trim()]
            .filter(Boolean)
            .join(' ')
            .trim();
        if (fullName) return fullName;
        const invitedName = String(input.invitedName || '').trim();
        if (invitedName) return invitedName;
        const email = String(input.user?.email || input.invitedEmail || '').trim();
        if (email) return email;
        return 'Jugador invitado';
    }

    private isOrganizerParticipant(input: {
        role?: string | null;
        status?: string | null;
    } | null | undefined) {
        if (!input) return false;
        if (String(input.role || '').trim() !== 'ORGANIZER') return false;
        return String(input.status || '').trim() !== 'REMOVED';
    }

    private buildOrganizerParticipantSnapshot(input: {
        client: {
            id: string;
            name?: string | null;
            email?: string | null;
            phone?: string | null;
        };
        user?: {
            id?: number | null;
            firstName?: string | null;
            lastName?: string | null;
            email?: string | null;
            phoneNumber?: string | null;
        } | null;
        userId?: number | null;
    }) {
        const userFullName = [
            String(input.user?.firstName || '').trim(),
            String(input.user?.lastName || '').trim()
        ].filter(Boolean).join(' ').trim();
        const parsedUserId = Number(input.userId ?? input.user?.id ?? 0);
        const normalizedUserId = Number.isInteger(parsedUserId) && parsedUserId > 0
            ? parsedUserId
            : null;

        return {
            clientId: String(input.client.id),
            userId: normalizedUserId,
            displayName:
                String(input.client.name || '').trim()
                || userFullName
                || String(input.user?.email || '').trim()
                || 'Titular',
            email:
                String(input.client.email || '').trim()
                || String(input.user?.email || '').trim()
                || null,
            phone:
                String(input.client.phone || '').trim()
                || String(input.user?.phoneNumber || '').trim()
                || null
        };
    }

    private buildManagedParticipantSnapshot(input: {
        client: {
            id: string;
            name?: string | null;
            email?: string | null;
            phone?: string | null;
        };
        user?: {
            id?: number | null;
            firstName?: string | null;
            lastName?: string | null;
            email?: string | null;
            phoneNumber?: string | null;
        } | null;
        userId?: number | null;
        role: 'ORGANIZER' | 'PARTICIPANT';
    }) {
        const base = this.buildOrganizerParticipantSnapshot({
            client: input.client,
            user: input.user,
            userId: input.userId
        });
        return {
            ...base,
            role: input.role,
        } as const;
    }

    private mapAdminBookingParticipantDto(input: {
        id: string;
        bookingId: number;
        clientId?: string | null;
        userId?: number | null;
        displayName?: string | null;
        email?: string | null;
        phone?: string | null;
        invitedEmail?: string | null;
        invitedName?: string | null;
        status: BookingParticipantStatus | string;
        role: string;
        user?: {
            firstName?: string | null;
            lastName?: string | null;
            email?: string | null;
        } | null;
    }): AdminBookingParticipantDto {
        return {
            id: String(input.id),
            bookingId: Number(input.bookingId),
            clientId: input.clientId ? String(input.clientId) : null,
            userId: Number.isInteger(Number(input.userId || 0)) && Number(input.userId) > 0 ? Number(input.userId) : null,
            displayName: this.resolveParticipantDisplayName(input),
            email: input.email ?? input.user?.email ?? null,
            phone: input.phone ?? null,
            status: String(input.status || '').trim() === 'REMOVED'
                ? 'REMOVED'
                : String(input.status || '').trim() === 'DECLINED'
                    ? 'DECLINED'
                    : String(input.status || '').trim() === 'LEFT'
                        ? 'LEFT'
                        : String(input.status || '').trim() === 'JOINED'
                            ? 'JOINED'
                            : 'INVITED',
            role: String(input.role || '').trim() === 'ORGANIZER' ? 'ORGANIZER' : 'PARTICIPANT',
            invitedEmail: input.invitedEmail ?? null,
            invitedName: input.invitedName ?? null,
        };
    }

    private async ensureOrganizerParticipantTx(
        tx: Prisma.TransactionClient,
        input: {
            bookingId: number;
            client: {
                id: string;
                name?: string | null;
                email?: string | null;
                phone?: string | null;
            };
            user?: {
                id?: number | null;
                firstName?: string | null;
                lastName?: string | null;
                email?: string | null;
                phoneNumber?: string | null;
            } | null;
            userId?: number | null;
        }
    ) {
        const organizerData = this.buildOrganizerParticipantSnapshot(input);
        const existingOrganizer = await tx.bookingParticipant.findFirst({
            where: {
                bookingId: input.bookingId,
                role: 'ORGANIZER'
            },
            orderBy: { createdAt: 'asc' }
        });

        const conflictingParticipant = organizerData.userId
            ? await tx.bookingParticipant.findFirst({
                where: {
                    bookingId: input.bookingId,
                    userId: organizerData.userId,
                    NOT: existingOrganizer ? { id: existingOrganizer.id } : undefined
                },
                select: {
                    id: true,
                    role: true,
                    status: true
                }
            })
            : null;

        const safeOrganizerUserId = conflictingParticipant ? null : organizerData.userId;
        const baseData = {
            clientId: organizerData.clientId,
            userId: safeOrganizerUserId,
            displayName: organizerData.displayName,
            email: organizerData.email,
            phone: organizerData.phone,
            invitedName: null,
            invitedEmail: null,
            status: 'JOINED' as BookingParticipantStatus,
            role: 'ORGANIZER' as const,
            acceptedAt: new Date(),
            declinedAt: null,
            leftAt: null,
            removedAt: null
        };

        if (existingOrganizer) {
            return tx.bookingParticipant.update({
                where: { id: existingOrganizer.id },
                data: baseData
            });
        }

        return tx.bookingParticipant.create({
            data: {
                bookingId: input.bookingId,
                ...baseData
            }
        });
    }

    private async appendBookingHistoryEntryTx(
        tx: Prisma.TransactionClient,
        input: {
            bookingId: number;
            clubId: number;
            action: string;
            category: 'BOOKING' | 'PARTICIPANT' | 'PAYMENT' | 'CONSUMPTION' | 'BILLING';
            source: string;
            summary: string;
            actorUserId?: number | null;
            actorLabel?: string | null;
            detail?: Prisma.InputJsonValue | null;
            previousState?: Prisma.InputJsonValue | null;
            nextState?: Prisma.InputJsonValue | null;
            bookingParticipantId?: string | null;
            paymentId?: string | null;
            accountId?: string | null;
            metadata?: Prisma.InputJsonValue | null;
            idempotencyKey?: string | null;
            occurredAt?: Date | null;
        }
    ) {
        return this.bookingHistoryService.appendBookingHistoryEntryTx(tx, {
            bookingId: input.bookingId,
            clubId: input.clubId,
            action: input.action,
            category: input.category,
            source: input.source,
            summary: input.summary,
            actorUserId: input.actorUserId ?? null,
            actorLabel: input.actorLabel ?? null,
            detail: input.detail ?? null,
            previousState: input.previousState ?? null,
            nextState: input.nextState ?? null,
            bookingParticipantId: input.bookingParticipantId ?? null,
            paymentId: input.paymentId ?? null,
            accountId: input.accountId ?? null,
            metadata: input.metadata ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            occurredAt: input.occurredAt ?? null,
        });
    }

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
            throw this.bookingNotFound();
        }
        if (booking.status === 'CANCELLED') {
            throw this.bookingInvalidStatus('No se puede mover una reserva cancelada');
        }
        if (booking.status === 'COMPLETED') {
            throw this.bookingInvalidStatus('No se puede reprogramar una reserva completada.');
        }
        if (new Date(input.startDateTime).getTime() < Date.now()) {
            throw this.invalidInput('No se pueden reservar turnos en el pasado.');
        }

        const targetCourt = await prisma.court.findFirst({
            where: { id: input.courtId, clubId: input.clubId },
            include: { activityType: true }
        });
        if (!targetCourt) {
            throw this.courtNotFound('Cancha destino inválida');
        }

        const durationFromRange = booking.endDateTime && booking.startDateTime
            ? Math.round((new Date(booking.endDateTime).getTime() - new Date(booking.startDateTime).getTime()) / 60000)
            : 0;
        const duration = Number(input.durationMinutes || durationFromRange || booking.activity?.defaultDurationMinutes || 60);
        const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 60;
        const endDateTime = new Date(input.startDateTime.getTime() + safeDuration * 60000);

        const classOverlap = await this.findClassSessionOverlap({
            clubId: input.clubId,
            courtId: input.courtId,
            startDateTime: input.startDateTime,
            endDateTime
        });
        if (classOverlap) {
            throw this.bookingSlotUnavailable('La cancha ya tiene una clase en ese horario.');
        }

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

                await this.appendBookingHistoryEntryTx(tx, {
                    bookingId: input.bookingId,
                    clubId: input.clubId,
                    action: 'BOOKING_RESCHEDULED',
                    category: 'BOOKING',
                    source: 'ADMIN',
                    summary: 'Reserva reprogramada',
                    actorUserId: input.actorUserId ?? null,
                    previousState: {
                        courtId: booking.courtId,
                        activityId: booking.activityId,
                        startDateTime: booking.startDateTime?.toISOString?.() || null,
                        endDateTime: booking.endDateTime?.toISOString?.() || null,
                    },
                    nextState: {
                        courtId: targetCourt.id,
                        activityId: Number(targetCourt.activityTypeId || booking.activityId),
                        startDateTime: input.startDateTime?.toISOString?.() || null,
                        endDateTime: endDateTime?.toISOString?.() || null,
                    },
                    detail: {
                        previousCourtId: booking.courtId,
                        courtId: targetCourt.id,
                        previousActivityId: booking.activityId,
                        activityId: Number(targetCourt.activityTypeId || booking.activityId),
                    },
                });

                return persisted;
            });
            return updated;
        } catch (error: unknown) {
            if (this.isOverlapConstraintError(error)) {
                throw this.bookingOverlap('El nuevo horario se superpone con otra reserva.');
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
            throw this.invalidInput('Debe enviar al menos una asignación.');
        }

        const seenIds = new Set<string>();
        for (const assignment of input.assignments) {
            if (!assignment.id || !assignment.participantRef) {
                throw this.invalidInput('Asignación inválida: id y participantRef son obligatorios.');
            }
            if (seenIds.has(assignment.id)) {
                throw this.invalidInput('Asignación inválida: hay ids duplicados.');
            }
            seenIds.add(assignment.id);
            if (Number(assignment.assignedAmount) < 0) {
                throw this.invalidInput('Asignación inválida: assignedAmount no puede ser negativo.');
            }
        }

        const chargeableAssignments = input.assignments.filter((assignment) => assignment.isChargeable);
        if (input.chargeMode === 'INDIVIDUAL') {
            const responsible = String(input.chargeResponsibleRef || '').trim();
            if (!responsible) {
                throw this.invalidInput('En modo INDIVIDUAL falta chargeResponsibleRef.');
            }
            if (chargeableAssignments.length !== 1) {
                throw this.invalidInput('En modo INDIVIDUAL debe existir exactamente una asignación cobrable.');
            }
            if (chargeableAssignments[0].participantRef !== responsible) {
                throw this.invalidInput('En modo INDIVIDUAL la asignación cobrable debe coincidir con chargeResponsibleRef.');
            }
        } else {
            if (chargeableAssignments.length === 0) {
                throw this.invalidInput('En modo SHARED debe existir al menos una asignación cobrable.');
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
            throw this.invalidInput('La suma de asignaciones cobrables no coincide con el monto cobrable actual de la reserva.');
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
            throw this.bookingNotFound();
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
                throw this.bookingNotFound();
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
            const previousMetadata = (previousConfig as any)?.metadata as Record<string, unknown> | undefined;
            const bootstrapInitializer = String(previousMetadata?.initializedBy || '').trim().toUpperCase();
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
            const suppressVisibleBillingBootstrapHistory =
                bootstrapInitializer === 'BOOKING_CREATED' ||
                bootstrapInitializer === 'AUTO_INITIALIZE_ON_READ';

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

            if (!suppressVisibleBillingBootstrapHistory && billingConfigChanged) {
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
                await this.appendBookingHistoryEntryTx(tx, {
                    bookingId: booking.id,
                    clubId: input.clubId,
                    action: 'BOOKING_BILLING_CONFIG_UPDATED',
                    category: 'BILLING',
                    source: 'ADMIN',
                    summary: 'Configuración de cobro actualizada',
                    actorUserId: input.actorUserId || null,
                    previousState: {
                        chargeMode: previousConfig.chargeMode,
                        chargeResponsibleRef: previousConfig.chargeResponsibleRef || null,
                    },
                    nextState: {
                        chargeMode: input.chargeMode,
                        chargeResponsibleRef: effectiveChargeResponsibleRef || null,
                    },
                    detail: {
                        addedParticipantsCount: addedParticipantRefs.length,
                        removedParticipantsCount: removedParticipantRefs.length,
                    },
                });
            }
            if (!suppressVisibleBillingBootstrapHistory && notesChanged) {
                await this.eventService.bookingNotesUpdated(input.clubId, {
                    bookingId: booking.id,
                    actorUserId: input.actorUserId || null,
                    previousNotes: previousNotes || '',
                    notes: nextNotes || '',
                }, tx as any);
                await this.appendBookingHistoryEntryTx(tx, {
                    bookingId: booking.id,
                    clubId: input.clubId,
                    action: 'BOOKING_NOTES_UPDATED',
                    category: 'BOOKING',
                    source: 'ADMIN',
                    summary: 'Notas actualizadas',
                    actorUserId: input.actorUserId || null,
                    previousState: { notes: previousNotes || '' },
                    nextState: { notes: nextNotes || '' },
                    detail: {
                        hadPreviousNotes: Boolean(previousNotes),
                        hasNotes: Boolean(nextNotes),
                    },
                });
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
            throw this.clubConfigInvalid('Configuración de club incompleta: faltan ClubSettings');
        }

        const timeZone = String(settings.timeZone || '').trim();
        if (!timeZone) {
            throw this.clubConfigInvalid('Configuración de club inválida: timeZone es obligatorio');
        }

        if (!Array.isArray(settings.openingDays) || settings.openingDays.length === 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: openingDays es obligatorio');
        }

        const closureDates = Array.isArray(settings.closureDates)
            ? settings.closureDates
                .map((date: unknown) => String(date || '').trim())
                .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
            : [];

        const bookingSimpleAdvanceDaysUser = Number(settings.bookingSimpleAdvanceDaysUser);
        const bookingSimpleAdvanceDaysAdmin = Number(settings.bookingSimpleAdvanceDaysAdmin);
        if (!Number.isFinite(bookingSimpleAdvanceDaysUser) || bookingSimpleAdvanceDaysUser < 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: bookingSimpleAdvanceDaysUser es obligatorio y debe ser >= 0');
        }
        if (!Number.isFinite(bookingSimpleAdvanceDaysAdmin) || bookingSimpleAdvanceDaysAdmin < 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: bookingSimpleAdvanceDaysAdmin es obligatorio y debe ser >= 0');
        }

        const professorDurationOverrideEnabled = settings.professorDurationOverrideEnabled;
        const professorDurationOverrideMinutes = Number(settings.professorDurationOverrideMinutes);
        if (typeof professorDurationOverrideEnabled !== 'boolean') {
            throw this.clubConfigInvalid('Configuración de club inválida: professorDurationOverrideEnabled es obligatorio');
        }
        if (!Number.isFinite(professorDurationOverrideMinutes) || professorDurationOverrideMinutes <= 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: professorDurationOverrideMinutes es obligatorio y debe ser > 0');
        }

        const allowManualConfirmationOverride = settings.allowManualConfirmationOverride;
        if (typeof allowManualConfirmationOverride !== 'boolean') {
            throw this.clubConfigInvalid('Configuración de club inválida: allowManualConfirmationOverride es obligatorio');
        }

        const bookingConfirmationMode = settings.bookingConfirmationMode;
        if (
            bookingConfirmationMode !== 'AUTOMATIC' &&
            bookingConfirmationMode !== 'MANUAL' &&
            bookingConfirmationMode !== 'DEPOSIT_REQUIRED'
        ) {
            throw this.clubConfigInvalid('Configuración de club inválida: bookingConfirmationMode es obligatorio');
        }

        const lightsEnabled = settings.lightsEnabled;
        if (typeof lightsEnabled !== 'boolean') {
            throw this.clubConfigInvalid('Configuración de club inválida: lightsEnabled es obligatorio');
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
                throw this.clubConfigInvalid('Configuración de club inválida: lightsExtraAmount es obligatorio cuando lightsEnabled=true');
            }
            if (!normalizedLightsFromHour || !/^\d{2}:\d{2}$/.test(String(normalizedLightsFromHour))) {
                throw this.clubConfigInvalid('Configuración de club inválida: lightsFromHour debe tener formato HH:MM cuando lightsEnabled=true');
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
            throw this.clubConfigInvalid('Configuración de club inválida: fixedBookingSettingsByActivity es obligatorio');
        }

        const byActivity = raw as Record<string, any>;
        const activityKey = this.normalizeActivityKey(activity?.name);
        const selected = activityKey ? byActivity[activityKey] : undefined;

        if (!selected || typeof selected !== 'object') {
            throw this.clubConfigInvalid(`Configuración de club inválida: faltan reglas de turnos fijos para la actividad ${activity?.name || 'desconocida'}`);
        }

        const daysAhead = Number(selected.fixedBookingDaysAhead);
        const generationFrequencyDays = Number(selected.fixedBookingGenerationFrequencyDays);
        if (!Number.isFinite(daysAhead) || daysAhead <= 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: fixedBookingDaysAhead debe ser > 0');
        }
        if (!Number.isFinite(generationFrequencyDays) || generationFrequencyDays <= 0) {
            throw this.clubConfigInvalid('Configuración de club inválida: fixedBookingGenerationFrequencyDays debe ser > 0');
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
            throw this.invalidInput('La duración del turno debe ser mayor a 0');
        }
    }

    private assertValidRange(startDateTime: Date, endDateTime: Date) {
        if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
            throw this.invalidInput('Fecha/hora inválida para la reserva');
        }
        if (startDateTime.getTime() >= endDateTime.getTime()) {
            throw this.invalidInput('La fecha/hora de inicio debe ser menor a la de fin');
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

    private normalizeClientEmail(email: string | null | undefined) {
        const normalized = normalizeEmail(String(email || ''));
        return normalized || null;
    }

    private maskEmailForLog(email: string | null | undefined) {
        const normalized = this.normalizeClientEmail(email);
        if (!normalized) return null;
        const [localPart = '', domainPart = ''] = normalized.split('@');
        if (!domainPart) return normalized.slice(0, 2) + '***';
        const safeLocal = localPart.length <= 2
            ? `${localPart.slice(0, 1)}***`
            : `${localPart.slice(0, 2)}***`;
        return `${safeLocal}@${domainPart}`;
    }

    private maskPhoneForLog(phone: string | null | undefined) {
        const normalized = this.normalizePhone(phone);
        if (!normalized) return null;
        const digits = String(normalized).replace(/\D/g, '');
        if (digits.length <= 4) return `***${digits}`;
        return `***${digits.slice(-4)}`;
    }

    private summarizeClientIdentityForLog(input: {
        userId?: number | null;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
    }) {
        const safeUserId = Number(input.userId || 0);
        const safeDni = this.normalizeDni(input.dni);
        return {
            userId: safeUserId > 0 ? safeUserId : null,
            phone: this.maskPhoneForLog(input.phone),
            email: this.maskEmailForLog(input.email),
            dniSuffix: safeDni ? safeDni.slice(-4) : null
        };
    }

    private logClientResolution(event: string, input: {
        clubId: number;
        userId?: number | null;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
    }, extra?: Record<string, unknown>) {
        console.info('[CLIENT_RESOLUTION]', {
            event,
            clubId: Number(input.clubId),
            ...this.summarizeClientIdentityForLog(input),
            ...(extra || {})
        });
    }

    private buildClientResolutionLockKey(input: {
        clubId: number;
        userId?: number | null;
        phone?: string | null;
        email?: string | null;
        dni?: string | null;
    }) {
        const parts = [`club:${Number(input.clubId)}`];
        const safeUserId = Number(input.userId || 0);
        const safePhone = this.normalizePhone(input.phone);
        const safeEmail = this.normalizeClientEmail(input.email);
        const safeDni = this.normalizeDni(input.dni);
        if (safeUserId > 0) parts.push(`user:${safeUserId}`);
        if (safeDni) parts.push(`dni:${safeDni}`);
        if (safeEmail) parts.push(`email:${safeEmail}`);
        if (safePhone) parts.push(`phone:${safePhone}`);
        return parts.length > 1 ? parts.join('|') : null;
    }

    private async acquireClientResolutionLockTx(
        tx: Prisma.TransactionClient,
        input: {
            clubId: number;
            userId?: number | null;
            phone?: string | null;
            email?: string | null;
            dni?: string | null;
        }
    ) {
        const lockKey = this.buildClientResolutionLockKey(input);
        if (!lockKey) return;
        if (typeof (tx as any)?.$executeRaw !== 'function') return;
        await (tx as any).$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pique_client_resolution'), hashtext(${lockKey}))`;
    }

    private async findCanonicalClientByStrongIdentityTx(
        txLike: { client: any },
        input: {
            clubId: number;
            phone?: string | null;
            email?: string | null;
            dni?: string | null;
        }
    ) {
        const safePhone = this.normalizePhone(input.phone);
        const safeEmail = this.normalizeClientEmail(input.email);
        const safeDni = this.normalizeDni(input.dni);
        const candidatesById = new Map<string, { row: any; reasons: Set<'DNI' | 'PHONE' | 'EMAIL'> }>();

        const registerRows = (rows: any[], reason: 'DNI' | 'PHONE' | 'EMAIL') => {
            for (const row of Array.isArray(rows) ? rows : []) {
                const id = String(row?.id || '').trim();
                if (!id) continue;
                const existing = candidatesById.get(id);
                if (existing) {
                    existing.reasons.add(reason);
                    continue;
                }
                candidatesById.set(id, { row, reasons: new Set([reason]) });
            }
        };

        if (safeDni) {
            const rows = await txLike.client.findMany({
                where: { clubId: input.clubId, dni: safeDni },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            });
            registerRows(rows, 'DNI');
        }

        if (safeEmail) {
            const rows = await txLike.client.findMany({
                where: { clubId: input.clubId, email: safeEmail },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            });
            registerRows(rows, 'EMAIL');
        }

        if (safePhone) {
            const phoneVariants = getPhoneIdentityVariants(safePhone);
            const rows = await txLike.client.findMany({
                where: { clubId: input.clubId, phone: { in: phoneVariants } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
            });
            registerRows(rows, 'PHONE');
        }

        const matches = Array.from(candidatesById.values())
            .map((entry) => ({
                ...entry.row,
                matchedBy: Array.from(entry.reasons.values()).sort() as Array<'DNI' | 'PHONE' | 'EMAIL'>
            }))
            .sort((left, right) => {
                const leftHasUser = Number(left?.userId || 0) > 0 ? 1 : 0;
                const rightHasUser = Number(right?.userId || 0) > 0 ? 1 : 0;
                if (leftHasUser !== rightHasUser) return rightHasUser - leftHasUser;
                const leftCreatedAt = left?.createdAt ? new Date(left.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
                const rightCreatedAt = right?.createdAt ? new Date(right.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
                if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
                return String(left?.id || '').localeCompare(String(right?.id || ''));
            });

        return {
            canonical: matches[0] || null,
            matches
        };
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

        const strongMatch = await this.findCanonicalClientByStrongIdentityTx(tx as any, {
            clubId: input.clubId,
            dni: input.clientDni,
            email: input.clientEmail,
            phone: input.clientPhone
        });
        if (strongMatch.canonical?.id) return String(strongMatch.canonical.id);

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
        if (!court) throw this.courtNotFound();

        const activity = await this.activityRepo.findById(input.activityId);
        if (!activity) throw this.activityNotFound('Actividad no existe');
        if (activity.clubId !== (court as any).club.id) {
            throw forbidden('La actividad no pertenece al club de la cancha', ErrorCodes.ACTIVITY_OUT_OF_CLUB);
        }

        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = clubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, input.startDateTime, clubTimeZone);
        if (resolvedSchedule.isClosed) {
            throw this.bookingSlotUnavailable('La actividad está cerrada para la fecha solicitada');
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
                throw this.bookingSlotUnavailable('Duración no permitida por el club');
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
                throw this.bookingSlotUnavailable('Horario no permitido por el club');
            }
        }

        const endDateTime = new Date(input.startDateTime.getTime() + effectiveDuration * 60000);
        this.assertValidRange(input.startDateTime, endDateTime);

        // Mantener coherencia con createBooking: si el club está cerrado ese día, la cotización debe bloquear.
        if (!this.isClubOpenOnLocalDate(clubConfig, input.startDateTime, clubTimeZone)) {
            throw this.bookingSlotUnavailable('El club está cerrado ese día');
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
                throw this.bookingSlotUnavailable('La reserva excede el horario de apertura del club');
            }
        }

        const basePrice = await this.pricingService.calculateCourtPrice(input.courtId, input.startDateTime);
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            throw this.clubConfigInvalid('Precio de cancha no configurado.');
        }

        const referenceDuration = this.resolvePriceReferenceDuration(activity, allowedDurations, effectiveDuration);
        let listPrice = this.calculateDurationAdjustedPrice(Number(basePrice), effectiveDuration, referenceDuration);
        if (clubConfig && clubConfig.lightsEnabled && clubConfig.lightsExtraAmount && clubConfig.lightsFromHour) {
            const [lh, lm] = String(clubConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
            if (Number.isNaN(lh) || Number.isNaN(lm)) {
                throw this.clubConfigInvalid('Configuración de club inválida: lightsFromHour debe tener formato HH:MM');
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
        forceCreateNew?: boolean;
    }) {
        const safeName = String(input.name ?? '').trim();
        if (!safeName) {
            throw this.invalidInput('El nombre del cliente es obligatorio');
        }

        const safePhone = this.normalizePhone(input.phone);
        const safeDni = this.normalizeDni(input.dni);
        const safeEmail = this.normalizeClientEmail(input.email);
        const safeUserId = Number.isInteger(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null;

        if (!safeUserId) {
            // Fase 1.2: email es opcional en alta rápida admin.
            // Solo phone es obligatorio para garantizar contactabilidad mínima.
            if (!safePhone) {
                throw this.invalidInput('El teléfono es obligatorio para crear un nuevo cliente.');
            }
        }

        await this.acquireClientResolutionLockTx(tx, {
            clubId: input.clubId,
            userId: safeUserId,
            phone: safePhone,
            email: safeEmail,
            dni: safeDni
        });

        if (safeUserId) {
            const existingByUser = await tx.client.findFirst({
                where: { clubId: input.clubId, userId: safeUserId }
            });
            if (existingByUser) {
                this.logClientResolution('reuse_already_linked_client', {
                    clubId: input.clubId,
                    userId: safeUserId,
                    phone: safePhone,
                    email: safeEmail,
                    dni: safeDni
                }, {
                    clientId: String(existingByUser.id)
                });
                await recordUserClientLinkAuditTx(tx, {
                    clubId: input.clubId,
                    userId: safeUserId,
                    clientId: String(existingByUser.id),
                    reason: 'ALREADY_LINKED',
                    source: 'BOOKING'
                });
                return existingByUser;
            }
        }

        const strongMatches = await this.findCanonicalClientByStrongIdentityTx(tx as any, {
            clubId: input.clubId,
            dni: safeDni,
            email: safeEmail,
            phone: safePhone
        });

        if (strongMatches.canonical && !input.forceCreateNew) {
            if (strongMatches.matches.length > 1) {
                const matchedSignals = Array.isArray((strongMatches.canonical as any).matchedBy)
                    ? (strongMatches.canonical as any).matchedBy.filter((value: unknown) => typeof value === 'string')
                    : [];
                throw this.clientPossibleDuplicate({
                    userId: safeUserId,
                    reasonType: matchedSignals.length === 1 ? matchedSignals[0] : 'MULTI_SIGNAL_CONFLICT',
                    primaryClientId: String(strongMatches.canonical.id),
                    candidateClientIds: strongMatches.matches.map((match) => String(match.id)),
                    candidates: strongMatches.matches.map((match) => ({
                        id: String(match.id),
                        name: String(match.name || '').trim() || 'Cliente sin nombre',
                        phone: match.phone || null,
                        email: match.email || null,
                        dni: match.dni || null,
                        userId: Number(match.userId || 0) > 0 ? Number(match.userId) : null
                    })),
                    signals: matchedSignals
                });
            }

            const matchedBy = Array.isArray((strongMatches.canonical as any).matchedBy)
                ? (strongMatches.canonical as any).matchedBy
                : [];
            this.logClientResolution('reuse_existing_client_by_strong_identity', {
                clubId: input.clubId,
                userId: safeUserId,
                phone: safePhone,
                email: safeEmail,
                dni: safeDni
            }, {
                clientId: String(strongMatches.canonical.id),
                matchedBy,
                duplicateClientCount: strongMatches.matches.length
            });
            return strongMatches.canonical;
        }

        this.logClientResolution('create_new_client', {
            clubId: input.clubId,
            userId: safeUserId,
            phone: safePhone,
            email: safeEmail,
            dni: safeDni
        }, {
            forced: Boolean(input.forceCreateNew)
        });

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

    private filterOutboxMessages(messages: any[], predicate: (message: any) => boolean) {
        return messages.filter((message) => !predicate(message));
    }

    private isLegacyCustomerWhatsappOutboxMessage(message: any, dedupePrefix: string) {
        return (
            message?.type === OUTBOX_TYPES.WHATSAPP_SEND &&
            typeof message?.dedupeKey === 'string' &&
            message.dedupeKey.startsWith(dedupePrefix)
        );
    }

    private isLegacyClubStaffWhatsappOutboxMessage(message: any, dedupePrefix: string) {
        return (
            message?.type === OUTBOX_TYPES.WHATSAPP_SEND &&
            typeof message?.dedupeKey === 'string' &&
            message.dedupeKey.startsWith(dedupePrefix)
        );
    }

    private filterBookingWhatsappOutboxMessages(params: {
        messages: any[];
        customerLegacyDedupePrefix?: string;
        staffLegacyDedupePrefix?: string;
        customerEventsV2Enabled: boolean;
        staffEventsV2Enabled: boolean;
    }) {
        return this.filterOutboxMessages(params.messages, (message) => {
            if (
                params.customerEventsV2Enabled &&
                params.customerLegacyDedupePrefix &&
                this.isLegacyCustomerWhatsappOutboxMessage(message, params.customerLegacyDedupePrefix)
            ) {
                return true;
            }

            if (
                params.staffEventsV2Enabled &&
                params.staffLegacyDedupePrefix &&
                this.isLegacyClubStaffWhatsappOutboxMessage(message, params.staffLegacyDedupePrefix)
            ) {
                return true;
            }

            return false;
        });
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
        const requestedOwnerUserSelection = this.parseOwnerUserSelection(options?.ownerUserSelection);
        let explicitOwnerUser: User | null = null;
        // requestedClientDraftEmail eliminado (Fase 1.2): email ya no es obligatorio en alta rápida admin.

        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw this.clientNotFound('Usuario no encontrado');
        } else if (requestedOwnerUserSelection) {
            explicitOwnerUser = await this.userRepo.findById(requestedOwnerUserSelection.userId);
            if (!explicitOwnerUser) throw this.clientNotFound('Usuario no encontrado');
        } else {
            if (!requestedClientId && requestedClientDraftName.length < 2) {
                throw this.invalidInput('Debes seleccionar un cliente o cargar un alta rápida válida.');
            }
            // Fase 1.2: email es opcional. Solo phone es obligatorio.
            if (!requestedClientId && !requestedClientDraftPhone) {
                throw this.invalidInput('El teléfono es obligatorio para el alta rápida de cliente.');
            }
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw this.courtNotFound();
        if (court.isUnderMaintenance) throw this.bookingSlotUnavailable('Cancha en mantenimiento');

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw this.activityNotFound('Actividad no existe');
        if (activity.clubId !== (court as any).club.id) {
            throw forbidden('La actividad no pertenece al club de la cancha', ErrorCodes.ACTIVITY_OUT_OF_CLUB);
        }
        const bookingClubId = (court as any).club.id;
        const bookingOwnerUser = explicitOwnerUser || user;
        const isProfessorClient = await this.resolveClientProfessorStatus({
            clubId: bookingClubId,
            clientId: options?.clientId ?? null,
            userId: bookingOwnerUser?.id ?? null,
            clientEmail: options?.clientDraft?.email ?? bookingOwnerUser?.email ?? undefined,
            clientPhone: options?.clientDraft?.phone ?? bookingOwnerUser?.phoneNumber ?? undefined,
            clientDni: options?.clientDraft?.dni ?? undefined
        });
        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = (clubConfig && clubConfig.timeZone) ? clubConfig.timeZone : 'America/Argentina/Buenos_Aires';
        const resolvedSchedule = await this.resolveActivityScheduleForDate(activity, startDateTime, clubTimeZone);
        if (resolvedSchedule.isClosed) {
            throw this.bookingSlotUnavailable('La actividad está cerrada para la fecha seleccionada');
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
            throw this.clubConfigInvalid('El club requiere una seña pero no tiene bookingDepositPercent válido');
        }
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        this.assertValidDuration(effectiveDuration);
        // Regla operativa explícita: permitir duración especial profesor aunque no esté en scheduleDurations
        if (!allowedDurations.includes(effectiveDuration)) {
            if (!(canProfessorDurationOverride && effectiveDuration === professorOverrideMinutes)) {
                throw this.bookingSlotUnavailable('Duración no permitida por el club');
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
                throw this.bookingSlotUnavailable('Horario no permitido por el club');
            }
        }

        // Verificar días de apertura del club (en la zona horaria del club)
        if (!this.isClubOpenOnLocalDate(clubConfig, startDateTime, clubTimeZone)) {
            throw this.bookingSlotUnavailable('El club está cerrado ese día');
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
                throw this.invalidInput(`Límite de anticipación excedido para ${actorLabel}: máximo ${safeMaxAdvanceDays} días`);
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
                    throw this.bookingSlotUnavailable('La reserva excede el horario de apertura del club');
                }
            }
        } catch (err) {
            throw err;
        }

    // Calcular precio base dinámico por reglas horarias y extra por luces según configuración del club
        const BASE_PRICE = await this.pricingService.calculateCourtPrice(courtId, startDateTime);
        if (!Number.isFinite(BASE_PRICE) || BASE_PRICE <= 0) {
            throw this.clubConfigInvalid('Precio de cancha no configurado.');
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
            const classOverlap = await this.findClassSessionOverlap({
                clubId: bookingClubId,
                courtId: courtId,
                startDateTime,
                endDateTime
            });
            if (classOverlap) {
                throw this.bookingSlotUnavailable('La cancha ya tiene una clase en ese horario.');
            }

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
                const overlaps = overlapping.map((item: any) => ({
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
                throw this.bookingOverlap('El horario se superpone con reservas existentes.', overlaps);
            }

            let saved: any;
            try {
                let resolvedClient: any = null;
                let resolvedBookingUserId: number | null = bookingOwnerUser?.id ?? null;

                if (requestedClientId) {
                    resolvedClient = await tx.client.findFirst({
                        where: {
                            id: requestedClientId,
                            clubId: bookingClubId
                        }
                    });
                    if (!resolvedClient) {
                        throw this.clientNotFound('Cliente no encontrado para el club seleccionado');
                    }
                    if (!resolvedBookingUserId) {
                        const linkedClientUserId = Number(resolvedClient.userId || 0);
                        if (Number.isInteger(linkedClientUserId) && linkedClientUserId > 0) {
                            resolvedBookingUserId = linkedClientUserId;
                        }
                    }
                }

                if (!resolvedClient && requestedOwnerUserSelection) {
                    await this.personService.validateSearchSelection(bookingClubId, {
                        query: requestedOwnerUserSelection.searchQuery,
                        personKey: requestedOwnerUserSelection.personKey,
                        userId: requestedOwnerUserSelection.userId,
                        allowedKinds: ['linked', 'systemUser']
                    });

                    resolvedClient = await this.personService.ensureClientForUser(
                        bookingClubId,
                        requestedOwnerUserSelection.userId,
                        {
                            actorUserId: Number(options?.actorUserId || 0) || null,
                            source: 'ADMIN_SELECTED_USER',
                            tx,
                        }
                    );
                    resolvedBookingUserId = requestedOwnerUserSelection.userId;
                }

                if (!resolvedClient) {
                    let dniForClient: string | null = options?.clientDraft?.dni ?? null;
                    if (!dniForClient && bookingOwnerUser?.id) {
                        const dbUser = await tx.user.findUnique({
                            where: { id: Number(bookingOwnerUser.id) },
                            select: { dni: true }
                        });
                        dniForClient = dbUser?.dni || null;
                    }

                    const draftName = String(options?.clientDraft?.name || '').trim()
                        || `${bookingOwnerUser?.firstName || ''} ${bookingOwnerUser?.lastName || ''}`.trim()
                        || bookingOwnerUser?.firstName
                        || 'Cliente';

                    resolvedClient = await this.resolveOrCreateClient(tx, {
                        clubId: bookingClubId,
                        userId: bookingOwnerUser?.id ?? null,
                        name: draftName,
                        phone: options?.clientDraft?.phone ?? bookingOwnerUser?.phoneNumber ?? null,
                        email: options?.clientDraft?.email ?? bookingOwnerUser?.email ?? null,
                        dni: dniForClient,
                        forceCreateNew: options?.clientDraft?.duplicateResolution === 'CREATE_NEW'
                    });
                }

                if (!resolvedClient?.id) {
                    throw this.clientNotFound('No se pudo resolver un cliente para la reserva');
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
                        userId: resolvedBookingUserId,
                        clientId: resolvedClient.id,
                        courtId: courtId,
                        activityId: activityId,
                        clubId: bookingClubId
                    },
                    include: { user: true, client: true, court: { include: { club: true } }, activity: true }
                });

                await this.ensureOrganizerParticipantTx(tx, {
                    bookingId: saved.id,
                    client: {
                        id: String(resolvedClient.id),
                        name: resolvedClient.name ?? null,
                        email: resolvedClient.email ?? null,
                        phone: resolvedClient.phone ?? null
                    },
                    user: resolvedBookingUserId && bookingOwnerUser && Number(bookingOwnerUser.id) === Number(resolvedBookingUserId)
                        ? {
                            id: Number(bookingOwnerUser.id),
                            firstName: bookingOwnerUser.firstName ?? null,
                            lastName: bookingOwnerUser.lastName ?? null,
                            email: bookingOwnerUser.email ?? null,
                            phoneNumber: bookingOwnerUser.phoneNumber ?? null
                        }
                        : null,
                    userId: resolvedBookingUserId
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
                    userId: resolvedBookingUserId,
                    courtId,
                    activityId,
                    amount: Number(saved.price || 0)
                }, tx);
                await this.appendBookingHistoryEntryTx(tx, {
                    bookingId: saved.id,
                    clubId: bookingClubId,
                    action: 'BOOKING_CREATED',
                    category: 'BOOKING',
                    source: 'ADMIN',
                    summary: 'Reserva creada',
                    actorUserId: Number(options?.actorUserId || user?.id || 0) || null,
                    nextState: {
                        status: String(saved.status || initialStatus || 'PENDING'),
                        clientId: saved.clientId,
                        userId: resolvedBookingUserId,
                        courtId,
                        activityId,
                        amount: Number(saved.price || 0),
                        startDateTime: saved.startDateTime?.toISOString?.() || null,
                        endDateTime: saved.endDateTime?.toISOString?.() || null,
                    },
                    detail: {
                        amount: Number(saved.price || 0),
                        clientId: saved.clientId,
                        userId: resolvedBookingUserId,
                    },
                    idempotencyKey: `booking:${saved.id}:created`,
                    occurredAt: saved.createdAt ?? new Date(),
                });
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
                    || bookingOwnerUser?.firstName
                    || 'Jugador'
                );
                const clientPhone = resolvedClient?.phone || bookingOwnerUser?.phoneNumber || null;
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

                const customerEventsV2Enabled = featureFlags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2;
                const staffEventsV2Enabled = featureFlags.ENABLE_WHATSAPP_STAFF_EVENTS_V2;
                const messagesToEnqueue = this.filterBookingWhatsappOutboxMessages({
                    messages: outboxMessages,
                    customerLegacyDedupePrefix: `booking-created:${saved.id}:client:`,
                    staffLegacyDedupePrefix: `booking-created:${saved.id}:club:`,
                    customerEventsV2Enabled,
                    staffEventsV2Enabled
                });

                await this.outboxService.enqueueMany(messagesToEnqueue, tx);
                if (customerEventsV2Enabled) {
                    await this.bookingCustomerWhatsappNotificationService.enqueueBookingCreated({
                        bookingId: saved.id,
                        clubId: bookingClubId,
                        clubName: (court as any)?.club?.name || 'el complejo',
                        clubPhone,
                        courtName: court.name,
                        clientName,
                        clientPhone,
                        startDateTime,
                        timeZone,
                        amount: Number(saved.price || 0)
                    }, tx);
                }
                if (staffEventsV2Enabled) {
                    await this.bookingStaffWhatsappNotificationService.enqueueBookingCreated({
                        bookingId: saved.id,
                        clubId: bookingClubId,
                        clubName: (court as any)?.club?.name || 'el complejo',
                        clubPhone,
                        courtName: court.name,
                        clientName,
                        clientPhone,
                        startDateTime,
                        timeZone,
                        amount: Number(saved.price || 0)
                    }, tx);
                }
            } catch (error) {
                if (this.isOverlapConstraintError(error)) {
                    throw this.bookingSlotUnavailable('No se pudo confirmar la disponibilidad del horario. Reintentá.');
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
            userId: Number(options?.actorUserId || bookingOwnerUser?.id || 0) || null,
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
        if (!court) throw this.courtNotFound();

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw this.activityNotFound();

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
        const existingClasses = await prisma.classSession.findMany({
            where: {
                clubId: Number((court as any)?.club?.id || 0),
                courtId: courtId,
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
                startsAt: { lt: endUtc },
                endsAt: { gt: startUtc }
            },
            select: { startsAt: true, endsAt: true }
        });
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        if (!allowedDurations.includes(effectiveDuration)) {
            throw this.bookingSlotUnavailable('Duración no permitida por el club');
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
                }) || existingClasses.some((classSession) => {
                    return TimeHelper.isOverlappingDates(
                        slotStartDate,
                        slotEndDate,
                        classSession.startsAt,
                        classSession.endsAt
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
            throw this.bookingNotFound('La reserva no existe.');
        }
        if (!skipAccessValidation) {
            if (clubId != null) {
                if (booking.court.club.id !== clubId) {
                    throw forbidden('No tenés acceso a esta reserva.');
                }
            } else {
                if (!booking.user || booking.user.id !== cancelledByUserId) {
                    throw forbidden('No tenés acceso a esta reserva.');
                }
            }
        }
        if (!isAutoCancel && !isBookingTransitionAllowed(booking.status as any, 'CANCELLED')) {
            throw this.bookingInvalidStatus('Solo se pueden cancelar reservas pendientes o confirmadas');
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
                throw this.bookingNotFound('La reserva no existe.');
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
                throw this.bookingInvalidStatus('Solo se pueden cancelar reservas pendientes o confirmadas');
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
                throw this.invalidInput('Para cancelar una reserva con pagos, debes devolver al menos una parte del monto pagado.');
            }
            if (!shouldExecuteRefundNow && targetRefundAmount + 0.009 < paidAmount) {
                throw this.invalidInput('No se permite cancelar con devolución parcial pendiente. Ejecutá la devolución parcial ahora o devolvé el total.');
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
                    throw conflict('No se pudo cubrir el monto de devolución solicitado', ErrorCodes.PAYMENT_OVERPAY);
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
            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId: booking.court.club.id,
                action: 'BOOKING_CANCELLED',
                category: 'BOOKING',
                source: isAutoCancel ? 'SYSTEM' : 'ADMIN',
                summary: 'Reserva cancelada',
                actorUserId: cancelledByUserId ?? null,
                previousState: { status: currentBooking.status },
                nextState: { status: 'CANCELLED' },
                detail: {
                    reason,
                    triggeredBy: options?.triggeredBy ?? (isAutoCancel ? 'SYSTEM' : clubId != null ? 'ADMIN' : 'USER'),
                    refundedAmount: refundedAmount,
                },
            });

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

            const customerEventsV2Enabled = featureFlags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2;
            const staffEventsV2Enabled = featureFlags.ENABLE_WHATSAPP_STAFF_EVENTS_V2;
            const messagesToEnqueue = this.filterBookingWhatsappOutboxMessages({
                messages: outboxMessages,
                customerLegacyDedupePrefix: `booking-cancelled:${bookingId}:client:`,
                staffLegacyDedupePrefix: `booking-cancelled:${bookingId}:club:`,
                customerEventsV2Enabled,
                staffEventsV2Enabled
            });

            await this.outboxService.enqueueMany(messagesToEnqueue, tx);
            if (customerEventsV2Enabled) {
                await this.bookingCustomerWhatsappNotificationService.enqueueBookingCancelled({
                    bookingId,
                    clubId: booking.court.club.id,
                    clubName: booking.court.club.name,
                    clubPhone,
                    courtName: booking.court.name,
                    clientName,
                    clientPhone,
                    startDateTime: currentBooking.startDateTime,
                    timeZone,
                    reason
                }, tx);
            }
            if (staffEventsV2Enabled) {
                await this.bookingStaffWhatsappNotificationService.enqueueBookingCancelled({
                    bookingId,
                    clubId: booking.court.club.id,
                    clubName: booking.court.club.name,
                    clubPhone,
                    courtName: booking.court.name,
                    clientName,
                    clientPhone,
                    startDateTime: currentBooking.startDateTime,
                    timeZone,
                    reason
                }, tx);
            }
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
        newClientId?: string | null;
        newClientDraft?: {
            name: string;
            phone?: string | null;
            email?: string | null;
            dni?: string | null;
            duplicateResolution?: 'CREATE_NEW' | null;
        } | null;
        ownerUserSelection?: {
            userId: number;
            personKey: string;
            searchQuery: string;
        } | null;
        actorUserId: number;
        clubId: number;
        reason?: string | null;
    }) {
        const {
            bookingId,
            actorUserId,
            clubId,
            reason,
            newClientDraft,
            ownerUserSelection,
        } = params;
        const newClientId = String(params.newClientId || '').trim();
        const parsedOwnerUserSelection = this.parseOwnerUserSelection(ownerUserSelection);
        const requestedClientDraftName = String(newClientDraft?.name || '').trim();
        const requestedClientDraftPhone = this.normalizePhone(newClientDraft?.phone);

        if (!newClientId && !parsedOwnerUserSelection && requestedClientDraftName.length < 2) {
            throw this.invalidInput('Seleccioná una persona o cargá un nuevo titular válido.');
        }
        if (!newClientId && !parsedOwnerUserSelection && !requestedClientDraftPhone) {
            throw this.invalidInput('El teléfono es obligatorio para cargar un nuevo titular.');
        }

        return prisma.$transaction(async (tx) => {
            // 1. Cargar la reserva y validar que pertenece al club
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                select: { id: true, clubId: true, clientId: true, userId: true, status: true }
            });
            if (!booking) {
                throw this.bookingNotFound('Reserva no encontrada o no pertenece al club');
            }

            const oldClientId = booking.clientId;
            if (!['PENDING', 'CONFIRMED'].includes(String(booking.status || ''))) {
                throw this.bookingInvalidStatus('No se puede cambiar el titular en el estado actual de la reserva.');
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
                throw conflict(
                    'No se puede cambiar el titular: la reserva ya tiene pagos/devoluciones registrados o la cuenta está cerrada.',
                    ErrorCodes.BOOKING_TITULAR_CHANGE_BLOCKED
                );
            }

            let nextClient: { id: string; name: string; userId?: number | null; email?: string | null; phone?: string | null } | null = null;
            let nextBookingUserId: number | null = null;
            let nextBookingUserSnapshot: {
                id: number;
                firstName?: string | null;
                lastName?: string | null;
                email?: string | null;
                phoneNumber?: string | null;
            } | null = null;

            if (newClientId) {
                nextClient = await tx.client.findFirst({
                    where: { id: newClientId, clubId },
                    select: { id: true, name: true, userId: true, email: true, phone: true }
                });
                if (!nextClient) {
                    throw this.clientNotFound('El cliente seleccionado no existe en este club');
                }
                const linkedClientUserId = Number(nextClient.userId || 0);
                if (Number.isInteger(linkedClientUserId) && linkedClientUserId > 0) {
                    nextBookingUserId = linkedClientUserId;
                    nextBookingUserSnapshot = await tx.user.findUnique({
                        where: { id: linkedClientUserId },
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phoneNumber: true
                        }
                    });
                }
            } else if (parsedOwnerUserSelection) {
                await this.personService.validateSearchSelection(clubId, {
                    query: parsedOwnerUserSelection.searchQuery,
                    personKey: parsedOwnerUserSelection.personKey,
                    userId: parsedOwnerUserSelection.userId,
                    allowedKinds: ['linked', 'systemUser']
                });

                const ensuredClient = await this.personService.ensureClientForUser(
                    clubId,
                    parsedOwnerUserSelection.userId,
                    {
                        actorUserId,
                        source: 'ADMIN_SELECTED_USER',
                        tx,
                    }
                );
                nextClient = {
                    id: String(ensuredClient.id),
                    name: String(ensuredClient.name || '').trim() || 'Cliente',
                    userId: Number.isInteger(Number(ensuredClient.userId)) ? Number(ensuredClient.userId) : null,
                    email: ensuredClient.email ?? null,
                    phone: ensuredClient.phone ?? null
                };
                nextBookingUserId = parsedOwnerUserSelection.userId;
                nextBookingUserSnapshot = await tx.user.findUnique({
                    where: { id: parsedOwnerUserSelection.userId },
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phoneNumber: true
                    }
                });
            } else {
                const resolvedClient = await this.resolveOrCreateClient(tx, {
                    clubId,
                    userId: null,
                    name: requestedClientDraftName,
                    phone: requestedClientDraftPhone,
                    email: newClientDraft?.email ?? null,
                    dni: newClientDraft?.dni ?? null,
                    forceCreateNew: newClientDraft?.duplicateResolution === 'CREATE_NEW'
                });
                nextClient = {
                    id: String(resolvedClient.id),
                    name: String(resolvedClient.name || '').trim() || 'Cliente',
                    userId: Number.isInteger(Number(resolvedClient.userId)) ? Number(resolvedClient.userId) : null,
                    email: resolvedClient.email ?? null,
                    phone: resolvedClient.phone ?? null
                };
            }

            if (!nextClient) {
                throw this.clientNotFound('No se pudo resolver el nuevo titular');
            }

            if (oldClientId === nextClient.id && Number(booking.userId || 0) === Number(nextBookingUserId || 0)) {
                throw badRequest('El nuevo titular es el mismo que el actual', ErrorCodes.INVALID_INPUT);
            }

            // 4. Cambiar el titular
            const updated = await tx.booking.update({
                where: { id: bookingId },
                data: { clientId: nextClient.id, userId: nextBookingUserId },
                select: {
                    id: true,
                    clientId: true,
                    userId: true,
                    client: { select: { id: true, name: true } }
                }
            });

            await this.ensureOrganizerParticipantTx(tx, {
                bookingId,
                client: {
                    id: nextClient.id,
                    name: nextClient.name,
                    email: nextClient.email ?? null,
                    phone: nextClient.phone ?? null
                },
                user: nextBookingUserSnapshot,
                userId: nextBookingUserId
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
            const newBookingClientRef = `booking-client:${nextClient.id}`;
            const oldClientRef = `client:${oldClientId}`;
            const newClientRef = `client:${nextClient.id}`;

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
                            ? String(nextClient.name || (participant as any)?.name || '').trim()
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
                newClientId: nextClient.id,
                oldClientRef: oldBookingClientRef,
                newClientRef: newBookingClientRef,
                oldClientName: null,
                newClientName: nextClient.name,
                actorUserId,
                reason: reason ?? null,
                source: 'MANUAL'
            }, tx as any);
            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_OWNER_CHANGED',
                category: 'BOOKING',
                source: 'ADMIN',
                summary: 'Titular cambiado',
                actorUserId,
                previousState: {
                    clientId: oldClientId,
                    userId: booking.userId ?? null,
                },
                nextState: {
                    clientId: nextClient.id,
                    userId: nextBookingUserId,
                },
                detail: {
                    oldClientId,
                    newClientId: nextClient.id,
                    newClientName: nextClient.name,
                    reason: reason ?? null,
                },
            });

            // 5. Auditoría
            await this.auditLogService.create({
                clubId,
                userId: actorUserId,
                entity: 'Booking',
                entityId: String(bookingId),
                action: 'BOOKING_CLIENT_CHANGED',
                payload: {
                    oldClientId,
                    newClientId: nextClient.id,
                    newUserId: nextBookingUserId,
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
                throw this.bookingNotFound();
            }
            if (!isBookingTransitionAllowed(booking.status as any, 'CONFIRMED')) {
                throw this.bookingInvalidStatus('Solo se puede confirmar una reserva pendiente');
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
            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_CONFIRMED',
                category: 'BOOKING',
                source: 'ADMIN',
                summary: 'Reserva confirmada',
                actorUserId,
                previousState: { status: booking.status },
                nextState: { status: nextStatus },
                detail: {
                    previousStatus: booking.status,
                    status: nextStatus,
                    source: 'MANUAL',
                },
                metadata: {
                    kind: 'STATUS_TRANSITION',
                },
            });
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
            if (!booking) throw this.bookingNotFound();
            if (!isBookingTransitionAllowed(booking.status as any, 'COMPLETED')) {
                throw this.bookingInvalidStatus('Solo se puede completar una reserva confirmada');
            }
            if (booking.endDateTime.getTime() > Date.now()) {
                throw this.bookingInvalidStatus('No se puede completar una reserva antes de su horario de finalización');
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
            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_COMPLETED',
                category: 'BOOKING',
                source: 'ADMIN',
                summary: 'Reserva finalizada',
                actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null,
                previousState: { status: booking.status },
                nextState: { status: 'COMPLETED' },
                detail: {
                    previousStatus: booking.status,
                    status: 'COMPLETED',
                },
                metadata: {
                    kind: 'STATUS_TRANSITION',
                },
            });
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
                throw forbidden('No tenés permiso para ver el historial de otro usuario.');
            }

            let requestedUserContext: { clubId: number } | null = null;
            try {
                requestedUserContext = await getUserClubContext(requestedUserId, requestUser.clubId);
            } catch {
                requestedUserContext = null;
            }

            if (!requestedUserContext || requestedUserContext.clubId !== requestUser.clubId) {
                throw forbidden('No tenés permiso para ver el historial de otro usuario.');
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

    async getPlayerBookings(userId: number): Promise<PlayerBookingDto[]> {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const bookings = await prisma.booking.findMany({
            where: {
                OR: [
                    { userId },
                    { client: { userId } },
                    { participants: { some: { userId, status: 'JOINED' } } }
                ]
            },
            include: {
                court: { include: { club: { include: { settings: true } } } },
                activity: true,
                client: {
                    select: {
                        id: true,
                        userId: true
                    }
                },
                participants: {
                    select: {
                        id: true,
                        userId: true,
                        status: true,
                        role: true
                    }
                }
            },
            orderBy: { startDateTime: 'desc' }
        });

        const visibleBookings = bookings.filter((booking) =>
            this.isExplicitBookingOwner(booking, userId) || this.isBookingParticipantJoined(booking, userId)
        );
        const bookingIds = visibleBookings.map((booking) => Number(booking.id)).filter((id) => Number.isInteger(id) && id > 0);

        const accounts = bookingIds.length > 0
            ? await prisma.account.findMany({
                where: {
                    sourceType: 'BOOKING',
                    sourceId: { in: bookingIds.map((id) => String(id)) }
                },
                select: {
                    id: true,
                    sourceId: true,
                    totalAmount: true
                }
            })
            : [];

        const paymentSummaryByBookingId = new Map<number, { totalAmount: number; paidAmount: number }>();
        for (const account of accounts) {
            const bookingId = Number(account.sourceId || 0);
            if (!Number.isInteger(bookingId) || bookingId <= 0) continue;
            const paidAmount = await this.accountService.calculateNetPaidAmount(account.id);
            paymentSummaryByBookingId.set(bookingId, {
                totalAmount: Number(account.totalAmount || 0),
                paidAmount
            });
        }

        const now = new Date();

        return visibleBookings.map((booking) => {
            const startDateTime = new Date(booking.startDateTime);
            const paymentData = paymentSummaryByBookingId.get(Number(booking.id)) ?? {
                totalAmount: 0,
                paidAmount: 0
            };
            const isOwner = this.isExplicitBookingOwner(booking, userId);
            const isParticipant = !isOwner && this.isBookingParticipantJoined(booking, userId);
            const hasRegisteredPayments = paymentData.paidAmount > 0.009;
            const canCancelBooking =
                isOwner &&
                (booking.status === 'PENDING' || booking.status === 'CONFIRMED') &&
                startDateTime.getTime() > now.getTime() &&
                !hasRegisteredPayments;
            const canInvitePlayers = isOwner && this.canInviteParticipantsForPlayerBooking(booking, userId, now);
            const canLeaveBooking = isParticipant && this.canLeavePlayerBooking(booking, now);

            return {
                id: String(booking.id),
                publicCode: String(booking.displayCode || `RES-${booking.id}`),
                club: {
                    id: String(booking.court.club.id),
                    name: String(booking.court.club.name || 'Club'),
                    slug: String(booking.court.club.slug || ''),
                    timeZone: String(booking.court.club.settings?.timeZone || 'America/Argentina/Buenos_Aires')
                },
                court: {
                    name: String(booking.court.name || 'Cancha')
                },
                activity: booking.activity
                    ? { name: String(booking.activity.name || 'Actividad') }
                    : null,
                startDateTime: new Date(booking.startDateTime).toISOString(),
                endDateTime: new Date(booking.endDateTime).toISOString(),
                status: booking.status,
                myRole: isOwner ? 'OWNER' : 'PARTICIPANT',
                paymentSummary: this.resolvePlayerPaymentSummary(paymentData),
                capabilities: {
                    canView: true,
                    canCancelBooking,
                    canLeaveBooking,
                    canPay: false,
                    canInvitePlayers
                }
            } satisfies PlayerBookingDto;
        });
    }

    async getPlayerBookingCheckout(bookingId: number, userId: number): Promise<PlayerBookingCheckoutDto> {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                court: {
                    include: {
                        club: true
                    }
                },
                client: {
                    select: {
                        userId: true
                    }
                },
                participants: {
                    select: {
                        userId: true,
                        status: true,
                        role: true
                    }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        const isOwner = this.isExplicitBookingOwner(booking, userId);
        const isParticipant = !isOwner && this.isBookingParticipantJoined(booking, userId);
        if (!isOwner && !isParticipant) {
            throw this.bookingForbidden('No tenés permiso para ver el estado de pago de esta reserva.');
        }

        const account = await prisma.account.findFirst({
            where: {
                clubId: booking.clubId,
                sourceType: 'BOOKING',
                sourceId: String(bookingId)
            },
            include: {
                items: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        id: true,
                        description: true,
                        quantity: true,
                        unitPrice: true,
                        total: true,
                        type: true
                    }
                },
                refunds: {
                    select: {
                        id: true,
                        status: true,
                        amount: true
                    }
                }
            }
        });

        const now = new Date();
        const bookingStarted = new Date(booking.startDateTime).getTime() <= now.getTime();
        const bookingNotPayable = booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || bookingStarted;

        if (!account) {
            return {
                booking: {
                    id: String(booking.id),
                    publicCode: String(booking.displayCode || `RES-${booking.id}`),
                    clubName: String(booking.court.club.name || 'Club'),
                    courtName: String(booking.court.name || 'Cancha'),
                    startDateTime: new Date(booking.startDateTime).toISOString(),
                    endDateTime: new Date(booking.endDateTime).toISOString(),
                    status: booking.status,
                    myRole: isOwner ? 'OWNER' : 'PARTICIPANT'
                },
                account: null,
                paymentSummary: this.resolvePlayerCheckoutPaymentSummary({
                    totalAmount: 0,
                    paidAmount: 0,
                    accountMissing: true
                }),
                checkout: {
                    enabled: false,
                    reason: 'ACCOUNT_MISSING',
                    futureProvider: null
                }
            };
        }

        const paid = await this.accountService.calculateNetPaidAmount(account.id);
        const total = Number(Number(account.totalAmount || 0).toFixed(2));
        const pending = Number(Math.max(0, total - paid).toFixed(2));
        const hasRelevantRefunds = account.refunds.some((refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELLED');

        const integrationStatus = await this.clubPaymentIntegrationService.getMercadoPagoIntegrationStatusForClub(booking.clubId);
        let checkoutEnabled = false;
        let checkoutReason: PlayerBookingCheckoutDto['checkout']['reason'] = 'UNKNOWN';
        let futureProvider: PlayerBookingCheckoutDto['checkout']['futureProvider'] = null;

        if (hasRelevantRefunds) {
            checkoutReason = 'BOOKING_HAS_REFUNDS';
        } else if (bookingNotPayable) {
            checkoutReason = 'BOOKING_NOT_PAYABLE';
        } else if (isParticipant) {
            checkoutReason = 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED';
        } else if (pending <= 0.009) {
            checkoutReason = 'NO_PENDING_BALANCE';
        } else if (!integrationStatus.connected) {
            checkoutReason = 'PROVIDER_NOT_CONFIGURED';
            futureProvider = 'MERCADO_PAGO';
        } else {
            futureProvider = 'MERCADO_PAGO';
            checkoutEnabled = true;
            checkoutReason = null;
        }

        return {
            booking: {
                id: String(booking.id),
                publicCode: String(booking.displayCode || `RES-${booking.id}`),
                clubName: String(booking.court.club.name || 'Club'),
                courtName: String(booking.court.name || 'Cancha'),
                startDateTime: new Date(booking.startDateTime).toISOString(),
                endDateTime: new Date(booking.endDateTime).toISOString(),
                status: booking.status,
                myRole: isOwner ? 'OWNER' : 'PARTICIPANT'
            },
            account: {
                id: account.id,
                status: account.status,
                total,
                paid: Number(paid.toFixed(2)),
                pending,
                currency: 'ARS',
                items: account.items.map((item) => ({
                    label: String(item.description || 'Concepto'),
                    quantity: Number(item.quantity || 1),
                    unitPrice: Number(Number(item.unitPrice || 0).toFixed(2)),
                    total: Number(Number(item.total || 0).toFixed(2)),
                    type: this.mapPublicAccountItemType(item.type)
                }))
            },
            paymentSummary: this.resolvePlayerCheckoutPaymentSummary({
                totalAmount: total,
                paidAmount: paid,
                blockedByRefunds: hasRelevantRefunds
            }),
            checkout: {
                enabled: checkoutEnabled,
                reason: checkoutReason,
                futureProvider
            }
        };
    }

    async createPlayerMercadoPagoCheckoutAttempt(bookingId: number, userId: number): Promise<PlayerBookingCheckoutStartDto> {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                court: {
                    include: {
                        club: true
                    }
                },
                client: {
                    select: {
                        userId: true,
                        name: true,
                        email: true
                    }
                },
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                },
                participants: {
                    select: {
                        userId: true,
                        status: true,
                        role: true
                    }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        const isOwner = this.isExplicitBookingOwner(booking, userId);
        const isParticipant = !isOwner && this.isBookingParticipantJoined(booking, userId);
        if (!isOwner) {
            if (isParticipant) {
                throw forbidden(
                    'Por ahora el pago online está disponible solo para el titular de la reserva.',
                    ErrorCodes.CHECKOUT_FORBIDDEN
                );
            }
            throw this.bookingForbidden('No tenés permiso para iniciar el pago de esta reserva.');
        }

        const account = await prisma.account.findFirst({
            where: {
                clubId: booking.clubId,
                sourceType: 'BOOKING',
                sourceId: String(bookingId)
            },
            include: {
                refunds: {
                    select: {
                        id: true,
                        status: true
                    }
                }
            }
        });

        if (!account) {
            throw notFound('No encontramos una cuenta publicada para esta reserva.', ErrorCodes.CHECKOUT_ACCOUNT_NOT_FOUND);
        }

        const now = new Date();
        if (
            booking.status === 'CANCELLED' ||
            booking.status === 'COMPLETED' ||
            new Date(booking.startDateTime).getTime() <= now.getTime()
        ) {
            throw conflict('Esta reserva ya no está disponible para pago online.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
        }

        const hasRelevantRefunds = account.refunds.some((refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELLED');
        if (hasRelevantRefunds) {
            throw conflict(
                'Esta reserva tiene devoluciones o ajustes que debe revisar el club.',
                ErrorCodes.CHECKOUT_NOT_AVAILABLE
            );
        }

        const accessToken = await this.clubPaymentIntegrationService.getMercadoPagoAccessTokenForClub(booking.clubId);
        if (!accessToken) {
            throw conflict(
                'El club todavía no tiene un proveedor de pago online configurado.',
                ErrorCodes.CHECKOUT_PROVIDER_NOT_CONFIGURED
            );
        }

        return prisma.$transaction(async (tx) => {
            const lockedAccounts = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT "id"
                FROM "Account"
                WHERE "id" = ${account.id}
                FOR UPDATE
            `;

            if (lockedAccounts.length === 0) {
                throw notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND);
            }

            const freshAccount = await tx.account.findUnique({
                where: { id: account.id },
                include: {
                    items: {
                        orderBy: { createdAt: 'asc' }
                    },
                    refunds: {
                        select: {
                            id: true,
                            status: true
                        }
                    }
                }
            });

            if (!freshAccount) {
                throw notFound('Cuenta no encontrada.', ErrorCodes.ACCOUNT_NOT_FOUND);
            }
            if (freshAccount.status !== 'OPEN') {
                throw conflict('La cuenta de esta reserva ya está cerrada.', ErrorCodes.ACCOUNT_CLOSED);
            }

            const paid = await this.accountService.calculateNetPaidAmountTx(tx, freshAccount.id);
            const total = Number(Number(freshAccount.totalAmount || 0).toFixed(2));
            const pending = Number(Math.max(0, total - paid).toFixed(2));
            if (pending <= 0.009) {
                throw conflict('Esta reserva no tiene saldo pendiente por ahora.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);
            }

            if (freshAccount.refunds.some((refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELLED')) {
                throw conflict(
                    'Esta reserva tiene devoluciones o ajustes que debe revisar el club.',
                    ErrorCodes.CHECKOUT_NOT_AVAILABLE
                );
            }

            const existingAttempt = await tx.onlinePaymentAttempt.findFirst({
                where: {
                    clubId: booking.clubId,
                    bookingId,
                    provider: 'MERCADO_PAGO',
                    status: { in: ['CREATED', 'PENDING'] }
                },
                orderBy: { createdAt: 'desc' }
            });

            if (existingAttempt && Number(existingAttempt.amount || 0).toFixed(2) === pending.toFixed(2) && existingAttempt.initPoint) {
                return {
                    attemptId: existingAttempt.id,
                    initPoint: String(existingAttempt.initPoint),
                    provider: 'MERCADO_PAGO'
                };
            }

            if (existingAttempt && Math.abs(Number(existingAttempt.amount || 0) - pending) > 0.009) {
                await tx.onlinePaymentAttempt.update({
                    where: { id: existingAttempt.id },
                    data: {
                        status: 'ERROR',
                        failureReason: 'CHECKOUT_AMOUNT_CHANGED'
                    }
                });
            }

            const idempotencyKey = `booking:${bookingId}:user:${userId}:pending:${pending.toFixed(2)}`;
            const attempt = await tx.onlinePaymentAttempt.create({
                data: {
                    clubId: booking.clubId,
                    bookingId,
                    accountId: freshAccount.id,
                    userId,
                    integrationId: (
                        await tx.clubPaymentIntegration.findUnique({
                            where: {
                                clubId_provider: {
                                    clubId: booking.clubId,
                                    provider: 'MERCADO_PAGO'
                                }
                            },
                            select: { id: true }
                        })
                    )?.id ?? null,
                    provider: 'MERCADO_PAGO',
                    status: 'CREATED',
                    amount: pending,
                    currency: 'ARS',
                    idempotencyKey,
                    externalReference: `booking-checkout:${bookingId}:attempt:${generateDisplayCode('CHK')}`
                }
            });

            const ownerFirstName = String(booking.user?.firstName || '').trim();
            const ownerLastName = String(booking.user?.lastName || '').trim();
            const payerEmail = String(booking.user?.email || booking.client?.email || '').trim() || null;
            const preferenceTitle = `Reserva de cancha - ${booking.court.club.name}`;
            const preferenceDescription = `${booking.court.name} · ${booking.court.club.name}`;
            const publicBase = mercadoPagoConfig.frontendUrl || 'http://localhost:3001';
            const backendBase = mercadoPagoConfig.appBaseUrl || 'http://localhost:3000';
            const buildBookingsReturnUrl = (checkoutStatus: 'success' | 'pending' | 'failure') => {
                const url = new URL('/bookings', publicBase);
                url.searchParams.set('booking', String(booking.id));
                url.searchParams.set('checkoutStatus', checkoutStatus);
                return url.toString();
            };
            const webhookUrl = new URL('/api/webhooks/mercadopago', backendBase);
            webhookUrl.searchParams.set('clubId', String(booking.clubId));
            webhookUrl.searchParams.set('attemptId', attempt.id);

            const preference = await this.mercadoPagoService.createPreference({
                accessToken,
                title: preferenceTitle,
                description: preferenceDescription,
                quantity: 1,
                unitPrice: pending,
                payer: payerEmail
                    ? {
                        name: ownerFirstName || booking.client?.name || 'Jugador',
                        surname: ownerLastName || undefined,
                        email: payerEmail
                    }
                    : undefined,
                externalReference: attempt.id,
                notificationUrl: webhookUrl.toString(),
                successUrl: buildBookingsReturnUrl('success'),
                pendingUrl: buildBookingsReturnUrl('pending'),
                failureUrl: buildBookingsReturnUrl('failure'),
                metadata: {
                    attemptId: attempt.id,
                    bookingId: booking.id,
                    accountId: freshAccount.id,
                    clubId: booking.clubId
                }
            });

            const initPoint = String(preference.init_point || preference.sandbox_init_point || '').trim();
            if (!initPoint) {
                throw conflict('Mercado Pago no devolvió una URL válida para iniciar el pago.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
            }

            await tx.onlinePaymentAttempt.update({
                where: { id: attempt.id },
                data: {
                    status: 'PENDING',
                    providerPreferenceId: String(preference.id || '').trim() || null,
                    initPoint,
                    rawProviderData: preference as Prisma.InputJsonValue
                }
            });

            await tx.auditLog.create({
                data: {
                    clubId: booking.clubId,
                    userId,
                    entity: 'ONLINE_PAYMENT_ATTEMPT',
                    entityId: attempt.id,
                    action: 'CHECKOUT_ATTEMPT_CREATED',
                    payload: {
                        provider: 'MERCADO_PAGO',
                        bookingId: booking.id,
                        accountId: freshAccount.id,
                        amount: pending
                    }
                }
            });

            return {
                attemptId: attempt.id,
                initPoint,
                provider: 'MERCADO_PAGO'
            };
        });
    }

    async cancelPlayerBooking(bookingId: number, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                client: {
                    select: {
                        id: true,
                        userId: true
                    }
                },
                participants: {
                    select: {
                        userId: true,
                        status: true,
                        role: true
                    }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        if (!this.isExplicitBookingOwner(booking, userId)) {
            throw this.bookingForbidden('No tenés permiso para cancelar esta reserva.');
        }

        if (booking.status === 'COMPLETED') {
            throw this.bookingInvalidStatus('No se puede cancelar una reserva completada.');
        }

        if (booking.status === 'CANCELLED') {
            throw this.bookingInvalidStatus('La reserva ya está cancelada.');
        }

        const now = new Date();
        if (new Date(booking.startDateTime).getTime() <= now.getTime()) {
            throw this.bookingCancellationNotAllowed('La reserva ya comenzó o quedó en el pasado.');
        }

        const account = await prisma.account.findFirst({
            where: {
                sourceType: 'BOOKING',
                sourceId: String(bookingId),
                clubId: booking.clubId
            },
            select: { id: true }
        });

        if (account) {
            const netPaid = await this.accountService.calculateNetPaidAmount(account.id);
            if (netPaid > 0.009) {
                throw this.bookingHasPayments();
            }
        }

        return this.cancelBooking(bookingId, userId, undefined, {
            skipAccessValidation: true,
            reason: 'MANUAL',
            triggeredBy: 'USER'
        });
    }

    async getPlayerBookingParticipants(bookingId: number, userId: number): Promise<PlayerBookingParticipantDto[]> {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                client: {
                    select: { userId: true }
                },
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        const isOwner = this.isExplicitBookingOwner(booking, userId);
        const isParticipant = this.isBookingParticipantJoined(booking, userId);
        if (!isOwner && !isParticipant) {
            throw this.bookingForbidden('No tenés permiso para ver esta reserva.');
        }

        const visibleParticipants = booking.participants.filter((participant) => {
            if (this.isOrganizerParticipant(participant)) return false;
            if (isOwner) return participant.status !== 'REMOVED';
            return participant.status === 'JOINED';
        });

        return visibleParticipants.map((participant) => ({
            id: participant.id,
            displayName: this.resolveParticipantDisplayName(participant),
            status: participant.status,
            role: String(participant.role || '') === 'ORGANIZER' ? 'ORGANIZER' : 'PARTICIPANT',
            isMe: Number(participant.userId || 0) === Number(userId),
            invitedEmail: isOwner ? (participant.invitedEmail ?? participant.email ?? null) : null,
            canManage: isOwner && participant.status !== 'REMOVED' && String(participant.role || '') !== 'ORGANIZER'
        }));
    }

    async getAdminBookingParticipants(bookingId: number, clubId: number): Promise<AdminBookingParticipantDto[]> {
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            throw this.invalidInput('Reserva inválida.');
        }
        if (!Number.isInteger(clubId) || clubId <= 0) {
            throw this.invalidInput('Club inválido.');
        }

        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: { id: true }
        });
        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        const participants = await prisma.bookingParticipant.findMany({
            where: {
                bookingId,
                status: { not: 'REMOVED' }
            },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                    }
                }
            },
            orderBy: [
                { role: 'asc' },
                { createdAt: 'asc' }
            ]
        });

        return participants.map((participant) => this.mapAdminBookingParticipantDto({
            ...participant,
            bookingId
        }));
    }

    async getAdminBookingHistory(bookingId: number, clubId: number) {
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            throw this.invalidInput('Reserva inválida.');
        }
        if (!Number.isInteger(clubId) || clubId <= 0) {
            throw this.invalidInput('Club inválido.');
        }

        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: { id: true }
        });
        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        return this.bookingHistoryService.listByBooking({ bookingId, clubId, take: 500 });
    }

    async addAdminBookingParticipant(input: {
        bookingId: number;
        clubId: number;
        actorUserId?: number | null;
        personSelection:
            | { kind: 'clubClient'; clientId: string }
            | { kind: 'linked' | 'systemUser'; userId: number; personKey: string; searchQuery: string }
            | { kind: 'newClient'; name: string; phone?: string | null; email?: string | null; dni?: string | null; forceCreateNew?: boolean };
    }): Promise<AdminBookingParticipantDto> {
        const bookingId = Number(input.bookingId || 0);
        const clubId = Number(input.clubId || 0);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            throw this.invalidInput('Reserva inválida.');
        }
        if (!Number.isInteger(clubId) || clubId <= 0) {
            throw this.invalidInput('Club inválido.');
        }

        const selection = input.personSelection;
        if (!selection || typeof selection !== 'object') {
            throw this.invalidInput('Seleccioná una persona válida.');
        }

        return prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                select: {
                    id: true,
                    clubId: true,
                    clientId: true,
                    userId: true,
                    status: true
                }
            });
            if (!booking) {
                throw this.bookingNotFound('La reserva no existe.');
            }
            if (String(booking.status || '') === 'CANCELLED') {
                throw this.bookingInvalidStatus('No se pueden agregar participantes a una reserva cancelada.');
            }

            let resolvedClient: {
                id: string;
                name?: string | null;
                userId?: number | null;
                email?: string | null;
                phone?: string | null;
            } | null = null;
            let resolvedUserId: number | null = null;
            let resolvedUserSnapshot: {
                id: number;
                firstName?: string | null;
                lastName?: string | null;
                email?: string | null;
                phoneNumber?: string | null;
            } | null = null;

            if (selection.kind === 'clubClient') {
                const selectedClientId = String(selection.clientId || '').trim();
                if (!selectedClientId) {
                    throw this.invalidInput('Seleccioná un cliente válido.');
                }
                resolvedClient = await tx.client.findFirst({
                    where: { id: selectedClientId, clubId },
                    select: { id: true, name: true, userId: true, email: true, phone: true }
                });
                if (!resolvedClient) {
                    throw this.clientNotFound('El cliente seleccionado no existe en este club');
                }
                const linkedUserId = Number(resolvedClient.userId || 0);
                if (Number.isInteger(linkedUserId) && linkedUserId > 0) {
                    resolvedUserId = linkedUserId;
                    resolvedUserSnapshot = await tx.user.findUnique({
                        where: { id: linkedUserId },
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phoneNumber: true
                        }
                    });
                }
            } else if (selection.kind === 'linked' || selection.kind === 'systemUser') {
                await this.personService.validateSearchSelection(clubId, {
                    query: selection.searchQuery,
                    personKey: selection.personKey,
                    userId: selection.userId,
                    allowedKinds: ['linked', 'systemUser']
                });

                const ensuredClient = await this.personService.ensureClientForUser(
                    clubId,
                    Number(selection.userId),
                    {
                        actorUserId: Number(input.actorUserId || 0) || null,
                        source: 'ADMIN_SELECTED_USER',
                        tx,
                    }
                );
                resolvedClient = {
                    id: String(ensuredClient.id),
                    name: ensuredClient.name ?? null,
                    userId: Number.isInteger(Number(ensuredClient.userId)) ? Number(ensuredClient.userId) : null,
                    email: ensuredClient.email ?? null,
                    phone: ensuredClient.phone ?? null
                };
                resolvedUserId = Number(selection.userId);
                resolvedUserSnapshot = await tx.user.findUnique({
                    where: { id: resolvedUserId },
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phoneNumber: true
                    }
                });
            } else if (selection.kind === 'newClient') {
                const draftName = String(selection.name || '').trim();
                const draftPhone = this.normalizePhone(selection.phone ?? null);
                if (draftName.length < 2) {
                    throw this.invalidInput('Ingresá un nombre válido para el participante.');
                }
                if (!draftPhone) {
                    throw this.invalidInput('El teléfono es obligatorio para crear un participante nuevo.');
                }
                const createdClient = await this.resolveOrCreateClient(tx, {
                    clubId,
                    userId: null,
                    name: draftName,
                    phone: draftPhone,
                    email: selection.email ?? null,
                    dni: selection.dni ?? null,
                    forceCreateNew: Boolean(selection.forceCreateNew)
                });
                resolvedClient = {
                    id: String(createdClient.id),
                    name: createdClient.name ?? null,
                    userId: Number.isInteger(Number(createdClient.userId)) ? Number(createdClient.userId) : null,
                    email: createdClient.email ?? null,
                    phone: createdClient.phone ?? null
                };
                resolvedUserId = null;
                resolvedUserSnapshot = null;
            } else {
                throw this.invalidInput('Seleccioná una persona válida.');
            }

            if (!resolvedClient?.id) {
                throw this.clientNotFound('No se pudo resolver la persona seleccionada.');
            }

            if (String(booking.clientId || '') === String(resolvedClient.id)) {
                throw this.bookingParticipantAlreadyExists('Esa persona ya es el titular de la reserva.');
            }
            if (
                resolvedUserId &&
                Number.isInteger(Number(booking.userId || 0)) &&
                Number(booking.userId) === Number(resolvedUserId)
            ) {
                throw this.bookingParticipantAlreadyExists('Esa persona ya es el titular de la reserva.');
            }

            const activeParticipant = await tx.bookingParticipant.findFirst({
                where: {
                    bookingId,
                    status: { not: 'REMOVED' },
                    OR: [
                        { clientId: resolvedClient.id },
                        ...(resolvedUserId ? [{ userId: resolvedUserId }] : [])
                    ]
                },
                select: { id: true }
            });
            if (activeParticipant) {
                throw this.bookingParticipantAlreadyExists('Esa persona ya está agregada en esta reserva.');
            }

            const archivedParticipant = await tx.bookingParticipant.findFirst({
                where: {
                    bookingId,
                    OR: [
                        { clientId: resolvedClient.id },
                        ...(resolvedUserId ? [{ userId: resolvedUserId }] : [])
                    ]
                },
                orderBy: { createdAt: 'asc' }
            });

            const snapshot = this.buildManagedParticipantSnapshot({
                client: {
                    id: resolvedClient.id,
                    name: resolvedClient.name ?? null,
                    email: resolvedClient.email ?? null,
                    phone: resolvedClient.phone ?? null,
                },
                user: resolvedUserSnapshot,
                userId: resolvedUserId,
                role: 'PARTICIPANT'
            });

            const data = {
                clientId: snapshot.clientId,
                userId: resolvedUserId,
                displayName: snapshot.displayName,
                email: snapshot.email,
                phone: snapshot.phone,
                invitedName: null,
                invitedEmail: null,
                invitedByUserId: Number(input.actorUserId || 0) || null,
                status: 'JOINED' as BookingParticipantStatus,
                role: 'PARTICIPANT' as const,
                acceptedAt: new Date(),
                declinedAt: null,
                leftAt: null,
                removedAt: null
            };

            const participant = archivedParticipant
                ? await tx.bookingParticipant.update({
                    where: { id: archivedParticipant.id },
                    data
                })
                : await tx.bookingParticipant.create({
                    data: {
                        bookingId,
                        ...data
                    }
                });

            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_PARTICIPANT_ADDED',
                category: 'PARTICIPANT',
                source: 'ADMIN',
                summary: 'Participante agregado',
                actorUserId: Number(input.actorUserId || 0) || null,
                bookingParticipantId: participant.id,
                detail: {
                    clientId: resolvedClient.id,
                    userId: resolvedUserId,
                    displayName: snapshot.displayName,
                    email: snapshot.email,
                    phone: snapshot.phone,
                    restoredArchivedParticipant: Boolean(archivedParticipant),
                },
                nextState: {
                    status: 'JOINED',
                    role: 'PARTICIPANT',
                    clientId: resolvedClient.id,
                    userId: resolvedUserId,
                },
            });

            await tx.auditLog.create({
                data: {
                    clubId,
                    userId: Number(input.actorUserId || 0) || null,
                    entity: 'BookingParticipant',
                    entityId: participant.id,
                    action: 'BOOKING_PARTICIPANT_ADDED_BY_ADMIN',
                    payload: {
                        bookingId,
                        clientId: resolvedClient.id,
                        userId: resolvedUserId
                    }
                }
            });

            return this.mapAdminBookingParticipantDto({
                ...participant,
                bookingId,
                user: resolvedUserSnapshot
            });
        });
    }

    async removeAdminBookingParticipant(input: {
        bookingId: number;
        participantId: string;
        clubId: number;
        actorUserId?: number | null;
    }) {
        const bookingId = Number(input.bookingId || 0);
        const clubId = Number(input.clubId || 0);
        const participantId = String(input.participantId || '').trim();
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
            throw this.invalidInput('Reserva inválida.');
        }
        if (!participantId) {
            throw this.invalidInput('Seleccioná un participante válido.');
        }
        if (!Number.isInteger(clubId) || clubId <= 0) {
            throw this.invalidInput('Club inválido.');
        }

        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: { id: true, clubId: true }
        });
        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        const participant = await prisma.bookingParticipant.findFirst({
            where: {
                id: participantId,
                bookingId
            }
        });
        if (!participant) {
            throw this.bookingParticipantNotFound();
        }
        if (String(participant.role || '') === 'ORGANIZER') {
            throw this.bookingParticipantForbidden('No se puede remover al titular de la reserva desde participantes.');
        }
        if (participant.status === 'REMOVED') {
            throw this.bookingParticipantNotFound('Ese participante ya no está activo en la reserva.');
        }

        await prisma.$transaction(async (tx) => {
            await tx.bookingParticipant.update({
                where: { id: participant.id },
                data: {
                    status: 'REMOVED',
                    removedAt: new Date()
                }
            });

            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_PARTICIPANT_REMOVED',
                category: 'PARTICIPANT',
                source: 'ADMIN',
                summary: 'Participante eliminado',
                actorUserId: Number(input.actorUserId || 0) || null,
                bookingParticipantId: participant.id,
                detail: {
                    clientId: participant.clientId ?? null,
                    userId: participant.userId ?? null,
                    displayName: participant.displayName ?? participant.invitedName ?? null,
                    previousStatus: participant.status,
                },
                previousState: {
                    status: participant.status,
                    role: participant.role,
                    clientId: participant.clientId ?? null,
                    userId: participant.userId ?? null,
                },
                nextState: {
                    status: 'REMOVED',
                },
            });

            await tx.auditLog.create({
                data: {
                    clubId,
                    userId: Number(input.actorUserId || 0) || null,
                    entity: 'BookingParticipant',
                    entityId: participant.id,
                    action: 'BOOKING_PARTICIPANT_REMOVED_BY_ADMIN',
                    payload: {
                        bookingId,
                        previousStatus: participant.status
                    }
                }
            });
        });

        return { success: true };
    }

    async invitePlayerBookingParticipant(input: {
        bookingId: number;
        ownerUserId: number;
        invitedEmail: string;
        invitedName?: string | null;
    }): Promise<PlayerBookingParticipantDto> {
        if (!Number.isInteger(input.ownerUserId) || input.ownerUserId <= 0) {
            throw this.bookingForbidden();
        }

        const invitedEmail = normalizeEmail(input.invitedEmail);
        const invitedName = String(input.invitedName || '').trim() || null;
        if (!invitedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
            throw new AppError({
                statusCode: 400,
                code: ErrorCodes.INVALID_INPUT,
                message: 'Revisá los campos marcados.',
                fieldErrors: {
                    email: 'Ingresá un email válido.'
                }
            });
        }

        const booking = await prisma.booking.findUnique({
            where: { id: input.bookingId },
            include: {
                client: {
                    select: { userId: true }
                },
                participants: {
                    select: {
                        id: true,
                        userId: true,
                        invitedEmail: true,
                        status: true,
                        role: true
                    }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        if (!this.canInviteParticipantsForPlayerBooking(booking, input.ownerUserId)) {
            throw this.bookingCannotInviteParticipants();
        }

        const ownerUser = await prisma.user.findUnique({
            where: { id: input.ownerUserId },
            select: { email: true }
        });
        if (normalizeEmail(String(ownerUser?.email || '')) === invitedEmail) {
            throw this.bookingParticipantAlreadyExists('No hace falta invitar al titular de la reserva.');
        }

        const duplicated = booking.participants.find((participant) => {
            const sameEmail = normalizeEmail(String(participant.invitedEmail || '')) === invitedEmail;
            const activeStatus = participant.status === 'INVITED' || participant.status === 'JOINED';
            return sameEmail && activeStatus;
        });
        if (duplicated) {
            throw this.bookingParticipantAlreadyExists();
        }

        const created = await prisma.$transaction(async (tx) => {
            const participant = await tx.bookingParticipant.create({
                data: {
                    bookingId: booking.id,
                    clientId: null,
                    displayName: invitedName,
                    email: invitedEmail,
                    phone: null,
                    invitedEmail,
                    invitedName,
                    invitedByUserId: input.ownerUserId,
                    status: 'INVITED',
                    role: 'PARTICIPANT'
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    }
                }
            });

            await this.appendBookingHistoryEntryTx(tx, {
                bookingId: booking.id,
                clubId: booking.clubId,
                action: 'BOOKING_PARTICIPANT_ADDED',
                category: 'PARTICIPANT',
                source: 'PLAYER',
                summary: 'Participante agregado',
                actorUserId: input.ownerUserId,
                bookingParticipantId: participant.id,
                detail: {
                    invitedEmail,
                    invitedName,
                    status: 'INVITED',
                    role: 'PARTICIPANT',
                },
                nextState: {
                    status: 'INVITED',
                    role: 'PARTICIPANT',
                    invitedEmail,
                    invitedName,
                },
            });

            await tx.auditLog.create({
                data: {
                    clubId: booking.clubId,
                    userId: input.ownerUserId,
                    entity: 'BookingParticipant',
                    entityId: participant.id,
                    action: 'BOOKING_PARTICIPANT_INVITED',
                    payload: {
                        bookingId: booking.id,
                        invitedEmail,
                        invitedName
                    }
                }
            });

            return participant;
        });

        return {
            id: created.id,
            displayName: this.resolveParticipantDisplayName(created),
            status: created.status,
            role: 'PARTICIPANT',
            isMe: false,
            invitedEmail: created.invitedEmail ?? null,
            canManage: true
        };
    }

    async removePlayerBookingParticipant(input: {
        bookingId: number;
        participantId: string;
        ownerUserId: number;
    }) {
        if (!Number.isInteger(input.ownerUserId) || input.ownerUserId <= 0) {
            throw this.bookingForbidden();
        }

        const booking = await prisma.booking.findUnique({
            where: { id: input.bookingId },
            include: {
                client: {
                    select: { userId: true }
                },
                participants: {
                    select: {
                        userId: true,
                        status: true,
                        role: true
                    }
                }
            }
        });

        if (!booking) {
            throw this.bookingNotFound('La reserva no existe.');
        }

        if (!this.canInviteParticipantsForPlayerBooking(booking, input.ownerUserId)) {
            throw this.bookingCannotInviteParticipants();
        }

        const participant = await prisma.bookingParticipant.findFirst({
            where: {
                id: input.participantId,
                bookingId: input.bookingId
            }
        });

        if (!participant) {
            throw this.bookingParticipantNotFound();
        }

        if (String(participant.role || '') === 'ORGANIZER') {
            throw this.bookingParticipantForbidden('No se puede remover al titular de la reserva desde participantes.');
        }

        if (participant.status === 'REMOVED') {
            throw this.bookingParticipantNotFound('Ese participante ya no está activo en la reserva.');
        }

        await prisma.$transaction(async (tx) => {
            await tx.bookingParticipant.update({
                where: { id: participant.id },
                data: {
                    status: 'REMOVED',
                    removedAt: new Date()
                }
            });

            await this.appendBookingHistoryEntryTx(tx, {
                bookingId: booking.id,
                clubId: booking.clubId,
                action: 'BOOKING_PARTICIPANT_REMOVED',
                category: 'PARTICIPANT',
                source: 'PLAYER',
                summary: 'Participante eliminado',
                actorUserId: input.ownerUserId,
                bookingParticipantId: participant.id,
                detail: {
                    invitedEmail: participant.invitedEmail ?? null,
                    displayName: participant.displayName ?? participant.invitedName ?? null,
                    previousStatus: participant.status,
                },
                previousState: {
                    status: participant.status,
                    role: participant.role,
                    userId: participant.userId ?? null,
                },
                nextState: {
                    status: 'REMOVED',
                },
            });

            await tx.auditLog.create({
                data: {
                    clubId: booking.clubId,
                    userId: input.ownerUserId,
                    entity: 'BookingParticipant',
                    entityId: participant.id,
                    action: 'BOOKING_PARTICIPANT_REMOVED',
                    payload: {
                        bookingId: booking.id,
                        previousStatus: participant.status
                    }
                }
            });
        });

        return { success: true };
    }

    async getMyBookingInvitations(userId: number): Promise<PlayerBookingInvitationDto[]> {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });
        const email = normalizeEmail(String(user?.email || ''));
        if (!email) return [];

        const invitations = await prisma.bookingParticipant.findMany({
            where: {
                userId: null,
                invitedEmail: email,
                status: 'INVITED',
                booking: {
                    status: { in: ['PENDING', 'CONFIRMED'] },
                    startDateTime: { gt: new Date() }
                }
            },
            include: {
                booking: {
                    include: {
                        court: {
                            include: {
                                club: {
                                    include: {
                                        settings: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                booking: {
                    startDateTime: 'asc'
                }
            }
        });

        return invitations.map((invitation) => ({
            id: invitation.id,
            bookingId: String(invitation.bookingId),
            bookingPublicCode: String(invitation.booking.displayCode || `RES-${invitation.booking.id}`),
            club: {
                name: String(invitation.booking.court.club.name || 'Club'),
                slug: String(invitation.booking.court.club.slug || ''),
                timeZone: String(invitation.booking.court.club.settings?.timeZone || 'America/Argentina/Buenos_Aires')
            },
            court: {
                name: String(invitation.booking.court.name || 'Cancha')
            },
            startDateTime: new Date(invitation.booking.startDateTime).toISOString(),
            endDateTime: new Date(invitation.booking.endDateTime).toISOString(),
            invitedName: invitation.invitedName ?? null,
            invitedEmail: invitation.invitedEmail ?? null,
            status: 'INVITED'
        }));
    }

    async acceptBookingInvitation(invitationId: string, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });
        const userEmail = normalizeEmail(String(user?.email || ''));
        if (!userEmail) {
            throw this.bookingInvitationEmailMismatch();
        }

        const invitation = await prisma.bookingParticipant.findUnique({
            where: { id: invitationId },
            include: {
                booking: {
                    include: {
                        client: {
                            select: { userId: true }
                        }
                    }
                }
            }
        });

        if (!invitation) {
            throw this.bookingInvitationNotFound();
        }

        if (invitation.status === 'JOINED') {
            throw this.bookingInvitationAlreadyAccepted();
        }
        if (invitation.status === 'DECLINED') {
            throw this.bookingInvitationAlreadyDeclined();
        }
        if (invitation.status === 'LEFT' || invitation.status === 'REMOVED') {
            throw this.bookingInvitationInvalid();
        }
        if (invitation.status !== 'INVITED') {
            throw this.bookingInvitationInvalid();
        }

        if (normalizeEmail(String(invitation.invitedEmail || '')) !== userEmail) {
            throw this.bookingInvitationEmailMismatch();
        }

        if (!(invitation.booking.status === 'PENDING' || invitation.booking.status === 'CONFIRMED')) {
            throw this.bookingInvalidStatus('La reserva ya no admite participantes.');
        }
        if (new Date(invitation.booking.startDateTime).getTime() <= Date.now()) {
            throw this.bookingInvitationExpired('La invitación ya venció porque la reserva ya comenzó o pasó.');
        }

        const alreadyJoined = await prisma.bookingParticipant.findFirst({
            where: {
                bookingId: invitation.bookingId,
                userId,
                status: 'JOINED',
                NOT: { id: invitation.id }
            },
            select: { id: true }
        });
        if (alreadyJoined) {
            throw this.bookingParticipantAlreadyExists('Ya formás parte de esta reserva.');
        }

        const updated = await prisma.$transaction(async (tx) => {
            const participant = await tx.bookingParticipant.update({
                where: { id: invitation.id },
                data: {
                    userId,
                    displayName: invitation.invitedName ?? null,
                    email: invitation.invitedEmail ?? null,
                    status: 'JOINED',
                    acceptedAt: new Date(),
                    declinedAt: null,
                    leftAt: null,
                    removedAt: null
                }
            });

            await tx.auditLog.create({
                data: {
                    clubId: invitation.booking.clubId,
                    userId,
                    entity: 'BookingParticipant',
                    entityId: invitation.id,
                    action: 'BOOKING_PARTICIPANT_ACCEPTED',
                    payload: {
                        bookingId: invitation.bookingId
                    }
                }
            });

            return participant;
        });

        return updated;
    }

    async declineBookingInvitation(invitationId: string, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });
        const userEmail = normalizeEmail(String(user?.email || ''));
        if (!userEmail) {
            throw this.bookingInvitationEmailMismatch();
        }

        const invitation = await prisma.bookingParticipant.findUnique({
            where: { id: invitationId },
            include: {
                booking: {
                    select: {
                        id: true,
                        clubId: true,
                        status: true,
                        startDateTime: true
                    }
                }
            }
        });

        if (!invitation) {
            throw this.bookingInvitationNotFound();
        }

        if (invitation.status === 'JOINED') {
            throw this.bookingInvitationAlreadyAccepted();
        }
        if (invitation.status === 'DECLINED') {
            throw this.bookingInvitationAlreadyDeclined();
        }
        if (invitation.status === 'LEFT' || invitation.status === 'REMOVED') {
            throw this.bookingInvitationInvalid();
        }
        if (normalizeEmail(String(invitation.invitedEmail || '')) !== userEmail) {
            throw this.bookingInvitationEmailMismatch();
        }

        await prisma.$transaction(async (tx) => {
            await tx.bookingParticipant.update({
                where: { id: invitation.id },
                data: {
                    status: 'DECLINED',
                    declinedAt: new Date()
                }
            });

            await tx.auditLog.create({
                data: {
                    clubId: invitation.booking.clubId,
                    userId,
                    entity: 'BookingParticipant',
                    entityId: invitation.id,
                    action: 'BOOKING_PARTICIPANT_DECLINED',
                    payload: {
                        bookingId: invitation.booking.id
                    }
                }
            });
        });

        return { success: true };
    }

    async leavePlayerBooking(bookingId: number, userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw this.bookingForbidden();
        }

        const participant = await prisma.bookingParticipant.findFirst({
            where: {
                bookingId,
                userId,
                status: 'JOINED'
            },
            include: {
                booking: {
                    select: {
                        id: true,
                        clubId: true,
                        status: true,
                        startDateTime: true
                    }
                }
            }
        });

        if (!participant) {
            throw this.bookingCannotLeave('No formás parte activa de esta reserva.');
        }

        if (!this.canLeavePlayerBooking(participant.booking)) {
            throw this.bookingCannotLeave('Ya no podés salirte de esta reserva desde acá.');
        }

        await prisma.$transaction(async (tx) => {
            await tx.bookingParticipant.update({
                where: { id: participant.id },
                data: {
                    status: 'LEFT',
                    leftAt: new Date()
                }
            });

            await tx.auditLog.create({
                data: {
                    clubId: participant.booking.clubId,
                    userId,
                    entity: 'BookingParticipant',
                    entityId: participant.id,
                    action: 'BOOKING_PARTICIPANT_LEFT',
                    payload: {
                        bookingId: participant.booking.id
                    }
                }
            });
        });

        return { success: true };
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
            throw this.bookingNotFound();
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
        client: true,
        participants: {
            include: {
                client: true,
                user: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        }
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
        const resolveScheduleParticipantName = (participant: any) => {
            const displayName = String(participant?.displayName || '').trim();
            if (displayName) return displayName;
            const invitedName = String(participant?.invitedName || '').trim();
            if (invitedName) return invitedName;
            const clientName = String(participant?.client?.name || '').trim();
            if (clientName) return clientName;
            const userFirstName = String(participant?.user?.firstName || '').trim();
            const userLastName = String(participant?.user?.lastName || '').trim();
            const userName = `${userFirstName} ${userLastName}`.trim();
            if (userName) return userName;
            return '';
        };
        const resolveScheduleParticipantRef = (participant: any) => {
            const role = String(participant?.role || '').trim().toUpperCase();
            const clientId = String(participant?.clientId || participant?.client?.id || '').trim();
            if (clientId) {
                return role === 'ORGANIZER'
                    ? `booking-client:${clientId}`
                    : `participant-client:${clientId}`;
            }
            const userId = Number(participant?.userId || participant?.user?.id || 0);
            if (Number.isFinite(userId) && userId > 0) {
                return role === 'ORGANIZER'
                    ? `booking-user:${userId}`
                    : `participant-user:${userId}`;
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
            const realScheduleParticipants = Array.isArray((booking as any).participants)
                ? (booking as any).participants
                    .filter((participant: any) => {
                        const status = String(participant?.status || '').trim().toUpperCase();
                        return status !== 'REMOVED' && status !== 'LEFT' && status !== 'DECLINED';
                    })
                    .map((participant: any) => ({
                        ref: resolveScheduleParticipantRef(participant),
                        name: resolveScheduleParticipantName(participant),
                        isOwner: String(participant?.role || '').trim().toUpperCase() === 'ORGANIZER'
                    }))
                    .filter((participant: { ref: string; name: string; isOwner: boolean }) =>
                        Boolean(participant.ref || participant.name)
                    )
                : [];
            const hoverParticipants = (() => {
                if (realScheduleParticipants.length > 0) {
                    return realScheduleParticipants;
                }

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
        const classSessions = await prisma.classSession.findMany({
            where: {
                startsAt: { lt: endUtc },
                endsAt: { gt: startUtc },
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
                ...(clubId ? { clubId } : {})
            },
            select: { courtId: true, startsAt: true, endsAt: true }
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
        if (!activity) throw this.activityNotFound();

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
                throw this.bookingSlotUnavailable('Duración no permitida por el club');
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
                }) || classSessions.some((classSession) => {
                    if (classSession.courtId !== court.id) return false;
                    return slotDateTime < classSession.endsAt && slotEndDateTime > classSession.startsAt;
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
        const requestedOwnerUserSelection = this.parseOwnerUserSelection(options?.ownerUserSelection);
        const requestedUserId = Number.isInteger(Number(options?.userId)) && Number(options?.userId) > 0
            ? Number(options?.userId)
            : null;
        const effectiveRequestedUserId = requestedOwnerUserSelection?.userId ?? requestedUserId;
        const requestedClientId = String(options?.clientId || '').trim();
        const requestedClientDraftName = String(options?.clientDraft?.name || '').trim();
        const requestedClientDraftPhone = this.normalizePhone(options?.clientDraft?.phone);
        // requestedClientDraftEmail eliminado (Fase 1.2): email ya no es obligatorio en alta rápida admin.

        if (!requestedClientId && !effectiveRequestedUserId && requestedClientDraftName.length < 2) {
            throw this.invalidInput('Debes seleccionar un cliente o cargar un alta rápida válida.');
        }
        // Fase 1.2: email es opcional. Solo phone es obligatorio.
        if (!requestedClientId && !effectiveRequestedUserId && !requestedClientDraftPhone) {
            throw this.invalidInput('El teléfono es obligatorio para el alta rápida de cliente.');
        }

        let user: User | null = null;
        if (effectiveRequestedUserId) {
            user = await this.userRepo.findById(effectiveRequestedUserId);
            if (!user) throw this.clientNotFound('Usuario no encontrado');
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw this.courtNotFound();

        const courtClubId = (court as any)?.club?.id;
        if (options?.clubId && courtClubId !== options.clubId) {
            throw forbidden('No tenés acceso a esta cancha.');
        }

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw this.activityNotFound();
        if ((activity.clubId ?? null) !== ((court as any)?.club?.id ?? null)) {
            throw forbidden('La actividad no pertenece al club de la cancha', ErrorCodes.ACTIVITY_OUT_OF_CLUB);
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
            throw this.invalidInput('Horario inválido para turno fijo: start debe ser menor a end');
        }
        const dayOfWeek = localStart.getDay();

        if (!this.isClubOpenOnLocalDate(clubConfigForFixed, startDateTime, clubTimeZone)) {
            throw this.bookingSlotUnavailable('El club está cerrado ese día');
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
            } else if (!effectiveRequestedUserId && requestedClientDraftName.length < 2) {
                throw this.clientNotFound('Cliente no encontrado para el club seleccionado');
            }
        }

        if (!resolvedFixedClient) {
            const resolvedClient = await prisma.$transaction(async (tx) => {
                if (requestedOwnerUserSelection) {
                    await this.personService.validateSearchSelection(fixedClubId, {
                        query: requestedOwnerUserSelection.searchQuery,
                        personKey: requestedOwnerUserSelection.personKey,
                        userId: requestedOwnerUserSelection.userId,
                        allowedKinds: ['linked', 'systemUser']
                    });

                    return this.personService.ensureClientForUser(
                        fixedClubId,
                        requestedOwnerUserSelection.userId,
                        {
                            actorUserId: Number(options?.actorUserId || 0) || null,
                            source: 'ADMIN_SELECTED_USER',
                            tx,
                        }
                    );
                }

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
            throw this.clientNotFound('No se pudo resolver un cliente para el turno fijo');
        }
        if (!this.normalizePhone(resolvedFixedClient.phone || null)) {
            throw this.invalidInput('El cliente del turno fijo debe tener teléfono válido.');
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
                        requestedOwnerUserSelection ? null : (resolvedFixedClient?.userId ? Number(resolvedFixedClient.userId) : null),
                        courtId,
                        currentStart,
                        activityId,
                        duration,
                        true,
                        {
                            skipAccountCreation: true,
                            skipAdvanceLimit: true,
                            actorUserId: options?.actorUserId ?? null,
                            clientId: requestedOwnerUserSelection ? null : fixedClientId,
                            ownerUserSelection: requestedOwnerUserSelection || null
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
            throw this.bookingNotFound('Turno fijo no encontrado');
        }
        if (Number(fixedBooking.court?.club?.id || 0) !== Number(input.clubId)) {
            throw forbidden('No tenés acceso a este turno fijo.');
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
                throw this.invalidInput('Debes indicar la ocurrencia a cancelar.');
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
                throw this.bookingNotFound('La ocurrencia seleccionada no pertenece a la serie.');
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
            throw this.bookingNotFound('La ocurrencia seleccionada no pertenece a la serie.');
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
            throw this.bookingNotFound('Turno fijo no encontrado');
        }
        if (Number(fixedBooking.court?.club?.id || 0) !== Number(input.clubId)) {
            throw forbidden('No tenés acceso a este turno fijo.');
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
        const mapClassOverlap = (params: {
            requestedStartDateTime: Date;
            requestedEndDateTime: Date;
            conflict: any;
            candidateBookingId?: number;
        }) => ({
            bookingId: Number(params.candidateBookingId || 0) || undefined,
            requestedStartDateTime: params.requestedStartDateTime,
            requestedEndDateTime: params.requestedEndDateTime,
            reason: 'CLASS_SESSION_OVERLAP',
            conflictingClassSessionId: String(params.conflict?.id || ''),
            conflictingStartDateTime: params.conflict?.startsAt,
            conflictingEndDateTime: params.conflict?.endsAt,
            conflictingCourtName: params.conflict?.court?.name || '',
            conflictingActivityName: params.conflict?.activityType?.name || '',
            conflictingTeacherName: params.conflict?.teacher?.displayName || ''
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
                throw this.invalidInput('Debes indicar la ocurrencia a editar.');
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
                throw this.bookingNotFound('La ocurrencia seleccionada no pertenece a la serie.');
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
                throw this.bookingNotFound();
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
                throw this.courtNotFound('Cancha destino inválida');
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
                throw this.bookingOverlap('El nuevo horario se superpone con otra reserva.', overlaps);
            }

            const classConflict = await this.findClassSessionOverlap({
                clubId: input.clubId,
                courtId: input.courtId,
                startDateTime: new Date(input.startDateTime),
                endDateTime: requestedEndDateTime
            });
            if (classConflict) {
                const overlaps = [
                    mapClassOverlap({
                        requestedStartDateTime: new Date(input.startDateTime),
                        requestedEndDateTime,
                        conflict: classConflict,
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
                throw this.bookingSlotUnavailable('La cancha ya tiene una clase en ese horario.');
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
            throw this.courtNotFound('Cancha destino inválida');
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
            throw this.bookingNotFound('La ocurrencia seleccionada no pertenece a la serie.');
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

            const classConflict = await this.findClassSessionOverlap({
                clubId: input.clubId,
                courtId: Number(targetCourt.id),
                startDateTime: nextStart,
                endDateTime: nextEnd
            });
            if (classConflict) {
                overlaps.push(
                    mapClassOverlap({
                        requestedStartDateTime: nextStart,
                        requestedEndDateTime: nextEnd,
                        conflict: classConflict,
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
            throw this.bookingNotFound('Reserva no encontrada para el club indicado');
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
        if (!booking || !product) throw notFound('Datos no encontrados', ErrorCodes.NOT_FOUND);
        if (booking.status === 'CANCELLED') throw this.bookingInvalidStatus('No se pueden agregar consumos a una reserva cancelada');
        if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
            throw this.bookingInvalidStatus('Solo se pueden agregar consumos a reservas confirmadas o finalizadas');
        }

        const normalizedQty = Math.floor(Number(quantity));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw this.invalidInput('Cantidad inválida');

        const result = await prisma.$transaction(async (tx) => {
            const txProduct = await tx.product.findFirst({
                where: { id: productId, clubId },
                select: { id: true, name: true, price: true, stock: true, category: true }
            });
            if (!txProduct) throw notFound('Producto no encontrado', ErrorCodes.PRODUCT_NOT_FOUND);
            if (Number(txProduct.stock) < normalizedQty) throw conflict('No hay stock suficiente para completar la venta.', ErrorCodes.STOCK_INSUFFICIENT);

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
            if (account.status !== 'OPEN') throw conflict('No se pueden agregar consumos a una cuenta cerrada', ErrorCodes.ACCOUNT_CLOSED);

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
            await this.appendBookingHistoryEntryTx(tx, {
                bookingId,
                clubId,
                action: 'BOOKING_CONSUMPTION_ADDED',
                category: 'CONSUMPTION',
                source: 'BOOKING_CONSUMPTION',
                summary: 'Consumo agregado',
                actorUserId: options?.actorUserId ?? null,
                accountId: account.id,
                detail: {
                    accountItemId: createdItem.id,
                    productId: txProduct.id,
                    productName: txProduct.name,
                    quantity: normalizedQty,
                    unitPrice: Number(createdItem.unitPrice || 0),
                    totalAmount: Number(createdItem.total || 0),
                },
            });

            const stockUpdate = await tx.product.updateMany({
                where: { id: productId, clubId, stock: { gte: normalizedQty } },
                data: { stock: { decrement: normalizedQty } }
            });
            if (stockUpdate.count !== 1) throw conflict('No hay stock suficiente para completar la venta.', ErrorCodes.STOCK_INSUFFICIENT);

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
        if (!booking || !product) throw notFound('Datos no encontrados', ErrorCodes.NOT_FOUND);
        if (booking.status === 'CANCELLED') throw this.bookingInvalidStatus('Reserva cancelada');
        if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
            throw this.bookingInvalidStatus('Solo se pueden cotizar consumos para reservas confirmadas o finalizadas');
        }

        const normalizedQty = Math.floor(Number(quantity));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) throw this.invalidInput('Cantidad inválida');

        const quote = await prisma.$transaction(async (tx) => {
            const txProduct = await tx.product.findFirst({
                where: { id: productId, clubId },
                select: { id: true, name: true, price: true, category: true }
            });
            if (!txProduct) throw notFound('Producto no encontrado', ErrorCodes.PRODUCT_NOT_FOUND);

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
            if (!item) throw notFound('Item no encontrado', ErrorCodes.NOT_FOUND);
            if (item.account.clubId !== clubId) {
                throw forbidden('No tenés acceso a este consumo.');
            }
            if (item.account.status !== 'OPEN') {
                throw conflict('Solo se pueden eliminar consumos de cuentas abiertas', ErrorCodes.ACCOUNT_CLOSED);
            }
            if (item.type === 'BOOKING') {
                throw conflict('El concepto de cancha no se puede eliminar desde consumos', ErrorCodes.BOOKING_INVALID_STATUS);
            }

            const allocated = await tx.paymentAllocation.aggregate({
                where: { accountItemId: item.id },
                _sum: { amount: true }
            });
            const allocatedAmount = Number(allocated._sum.amount || 0);
            if (allocatedAmount > 0.009) {
                throw conflict('No se puede eliminar el consumo porque tiene pagos asociados', ErrorCodes.CONFLICT);
            }

            const itemTotal = Number(item.total || 0);
            const currentTotal = Number(item.account.totalAmount || 0);
            const paidAmount = await this.accountService.calculateNetPaidAmountTx(tx, item.accountId);
            const nextTotal = Number((currentTotal - itemTotal).toFixed(2));

            if (paidAmount > nextTotal + 0.009) {
                throw conflict('No se puede eliminar el consumo porque dejaría la cuenta sobrepagada', ErrorCodes.PAYMENT_OVERPAY);
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
            if (bookingIdFromAccount) {
                await this.appendBookingHistoryEntryTx(tx, {
                    bookingId: bookingIdFromAccount,
                    clubId,
                    action: 'BOOKING_CONSUMPTION_REMOVED',
                    category: 'CONSUMPTION',
                    source: 'BOOKING_CONSUMPTION',
                    summary: 'Consumo eliminado',
                    accountId: item.accountId,
                    detail: {
                        accountItemId: item.id,
                        productId: item.productId ?? null,
                        productName: item.description || null,
                        quantity: Number(item.quantity || 0),
                        unitPrice: Number(item.unitPrice || 0),
                        totalAmount: Number(item.total || 0),
                    },
                });
            }

            const deleted = await tx.accountItem.delete({ where: { id: itemId } });
            await this.projectionService.refreshAccountSummary(item.accountId, tx);
            return deleted;
        });
    }

}
