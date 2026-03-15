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
import { BookingStatus, Prisma, RefundReasonType } from '@prisma/client';
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
    professorOverrideReason?: string;
    actorUserId?: number | null;
};

type BookingPriceQuoteInput = {
    userId?: number | null;
    courtId: number;
    activityId: number;
    startDateTime: Date;
    durationMinutes?: number;
    guestEmail?: string;
    guestPhone?: string;
    guestDni?: string;
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
        const lightsFromHourRaw = settings?.lightsFromHour;
        const normalizedLightsFromHour =
            typeof lightsFromHourRaw === 'string'
                ? lightsFromHourRaw
                : Number.isFinite(Number(lightsFromHourRaw))
                    ? this.fromMinutes(Number(lightsFromHourRaw))
                    : null;

        return {
            ...club,
            timeZone: settings?.timeZone ?? 'America/Argentina/Buenos_Aires',
            openingDays: Array.isArray(settings?.openingDays) ? settings.openingDays : null,
            lightsEnabled: settings?.lightsEnabled ?? false,
            lightsExtraAmount: settings?.lightsExtraAmount ?? null,
            lightsFromHour: normalizedLightsFromHour,
            // Regla operativa explícita separada del descuento económico
            professorDurationOverrideEnabled: settings?.professorDurationOverrideEnabled ?? true,
            professorDurationOverrideMinutes: Number.isFinite(Number(settings?.professorDurationOverrideMinutes))
                ? Math.max(1, Math.floor(Number(settings?.professorDurationOverrideMinutes)))
                : 60,
            fixedBookingSettingsByActivity: settings?.fixedBookingSettingsByActivity ?? null,
            bookingConfirmationMode: settings?.bookingConfirmationMode ?? 'MANUAL',
            bookingDepositPercent: settings?.bookingDepositPercent != null ? Number(settings.bookingDepositPercent) : null,
            allowManualConfirmationOverride: settings?.allowManualConfirmationOverride ?? true,
            bookingSimpleAdvanceDaysUser: Number.isFinite(Number(settings?.bookingSimpleAdvanceDaysUser))
                ? Math.max(0, Math.floor(Number(settings?.bookingSimpleAdvanceDaysUser)))
                : 30,
            bookingSimpleAdvanceDaysAdmin: Number.isFinite(Number(settings?.bookingSimpleAdvanceDaysAdmin))
                ? Math.max(0, Math.floor(Number(settings?.bookingSimpleAdvanceDaysAdmin)))
                : 30,
            allowAdminSkipSimpleAdvanceLimit: settings?.allowAdminSkipSimpleAdvanceLimit ?? false
        };
    }

    private getLocalDayStart(date: Date, timeZone: string) {
        const local = TimeHelper.utcToLocal(date, timeZone);
        return new Date(local.getFullYear(), local.getMonth(), local.getDate());
    }

    private resolveFixedBookingConfig(clubConfig: any, activity: ActivityType | null | undefined) {
        const fallback = {
            fixedBookingDaysAhead: 24 * 7,
            fixedBookingGenerationFrequencyDays: 7
        };

        const raw = clubConfig?.fixedBookingSettingsByActivity;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return fallback;
        }

        const byActivity = raw as Record<string, any>;
        const activityKey = this.normalizeActivityKey(activity?.name);
        const selected = activityKey ? byActivity[activityKey] : undefined;

        if (!selected || typeof selected !== 'object') {
            return fallback;
        }

        const daysAhead = Number(selected.fixedBookingDaysAhead);
        const generationFrequencyDays = Number(selected.fixedBookingGenerationFrequencyDays);

        return {
            fixedBookingDaysAhead: Number.isFinite(daysAhead) && daysAhead > 0 ? Math.floor(daysAhead) : fallback.fixedBookingDaysAhead,
            fixedBookingGenerationFrequencyDays: Number.isFinite(generationFrequencyDays) && generationFrequencyDays > 0 ? Math.floor(generationFrequencyDays) : fallback.fixedBookingGenerationFrequencyDays
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

    private isUniqueSlotConstraintError(error: unknown) {
        return (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
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
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return null;

        if (digits.startsWith('549') && digits.length >= 12) {
            return digits;
        }

        if (digits.startsWith('54') && digits.length >= 12) {
            return `549${digits.slice(2)}`;
        }

        if (digits.length === 10) {
            return `549${digits}`;
        }

        if (digits.startsWith('0') && digits.length === 11) {
            return `549${digits.slice(1)}`;
        }

        return digits.length >= 8 ? digits : null;
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
            userId?: number | null;
            guestEmail?: string;
            guestPhone?: string;
            guestDni?: string;
        }
    ) {
        const safeUserId = Number(input.userId || 0);
        if (safeUserId > 0) {
            const byUser = await tx.client.findFirst({
                where: { clubId: input.clubId, userId: safeUserId },
                select: { id: true }
            });
            if (byUser?.id) return byUser.id;
        }

        const safeDni = this.normalizeDni(input.guestDni);
        if (safeDni) {
            const byDni = await tx.client.findFirst({
                where: { clubId: input.clubId, dni: safeDni },
                select: { id: true }
            });
            if (byDni?.id) return byDni.id;
        }

        const safePhone = this.normalizePhone(input.guestPhone);
        if (safePhone) {
            const byPhone = await tx.client.findFirst({
                where: { clubId: input.clubId, phone: safePhone },
                select: { id: true }
            });
            if (byPhone?.id) return byPhone.id;
        }

        const safeEmail = String(input.guestEmail || '').trim().toLowerCase();
        if (safeEmail) {
            const byEmail = await tx.client.findFirst({
                where: { clubId: input.clubId, email: safeEmail },
                select: { id: true }
            });
            if (byEmail?.id) return byEmail.id;
        }

        return null;
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
        const activitySchedule = this.resolveActivitySchedule(activity);
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = input.durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        this.assertValidDuration(effectiveDuration);
        if (!allowedDurations.includes(effectiveDuration)) {
            throw new Error('Duración no permitida por el club');
        }

        const endDateTime = new Date(input.startDateTime.getTime() + effectiveDuration * 60000);
        this.assertValidRange(input.startDateTime, endDateTime);

        const basePrice = await this.pricingService.calculateCourtPrice(input.courtId, input.startDateTime);
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            throw new Error('Precio de cancha no configurado.');
        }

        let listPrice = Number(basePrice);
        const clubTimeZone = clubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
        if (clubConfig && clubConfig.lightsEnabled && clubConfig.lightsExtraAmount && clubConfig.lightsFromHour) {
            try {
                const [lh, lm] = String(clubConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
                if (!Number.isNaN(lh) && !Number.isNaN(lm)) {
                    const localStart = TimeHelper.utcToLocal(input.startDateTime, clubTimeZone);
                    const bookingTotalMinutes = localStart.getHours() * 60 + localStart.getMinutes();
                    const lightsTotalMinutes = lh * 60 + lm;
                    if (bookingTotalMinutes >= lightsTotalMinutes) {
                        listPrice += Number(clubConfig.lightsExtraAmount);
                    }
                }
            } catch {
                // noop: ante error de parseo devolvemos precio base sin extra.
            }
        }

        const quote = await prisma.$transaction(async (tx) => {
            const clientId = await this.resolveClientIdForDiscountTx(tx, {
                clubId: (court as any).club.id,
                userId: input.userId,
                guestEmail: input.guestEmail,
                guestPhone: input.guestPhone,
                guestDni: input.guestDni
            });

            const discountDraft = input.applyDiscount === false
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
    }) {
        const safeName = String(input.name ?? '').trim();
        if (!safeName) {
            throw new Error('El nombre del cliente es obligatorio');
        }

        const safePhone = this.normalizePhone(input.phone);
        const safeDni = this.normalizeDni(input.dni);
        const safeEmail = String(input.email ?? '').trim().toLowerCase();
        const safeUserId = Number.isInteger(Number(input.userId)) && Number(input.userId) > 0 ? Number(input.userId) : null;

        if (safeUserId) {
            const existingByUser = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    userId: safeUserId
                }
            });

            if (existingByUser) {
                return tx.client.update({
                    where: { id: existingByUser.id },
                    data: {
                        name: safeName,
                        phone: safePhone || existingByUser.phone || null,
                        email: safeEmail || existingByUser.email || null,
                        dni: safeDni || existingByUser.dni || null,
                        userId: safeUserId
                    }
                });
            }
        }

        if (safeDni) {
            const existingByDni = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    dni: safeDni
                }
            });

            if (existingByDni) {
                return tx.client.update({
                    where: { id: existingByDni.id },
                    data: {
                        name: safeName,
                        phone: safePhone || existingByDni.phone || null,
                        email: safeEmail || existingByDni.email || null,
                        dni: safeDni,
                        userId: safeUserId || existingByDni.userId || null
                    }
                });
            }
        }

        if (safePhone) {
            const existingByPhone = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    phone: safePhone
                }
            });

            if (existingByPhone) {
                return tx.client.update({
                    where: { id: existingByPhone.id },
                    data: {
                        name: safeName,
                        email: safeEmail || existingByPhone.email || null,
                        dni: safeDni || existingByPhone.dni || null,
                        userId: safeUserId || existingByPhone.userId || null
                    }
                });
            }
        }

        if (safeEmail) {
            const existingByEmail = await tx.client.findFirst({
                where: {
                    clubId: input.clubId,
                    email: safeEmail
                }
            });

            if (existingByEmail) {
                return tx.client.update({
                    where: { id: existingByEmail.id },
                    data: {
                        name: safeName,
                        phone: safePhone || existingByEmail.phone || null,
                        dni: safeDni || existingByEmail.dni || null,
                        userId: safeUserId || existingByEmail.userId || null
                    }
                });
            }
        }

        return tx.client.create({
            data: {
                clubId: input.clubId,
                name: safeName,
                phone: safePhone || null,
                email: safeEmail || null,
                dni: safeDni || null,
                userId: safeUserId
            }
        });
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
            clientId?: string | null;
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
                        clientId: params.clientId ?? null,
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
        notificationUserId?: number | null;
        startDateTime: Date;
        timeZone: string;
        amount: number;
        suppressClubNotification?: boolean;
    }) {
        const cleanClientPhone = this.normalizePhone(params.clientPhone);
        const cleanClubPhone = this.normalizePhone(params.clubPhone);
        const { date, time } = this.formatBookingDateTime(params.startDateTime, params.timeZone);

        const clientMessage = `
🎾 *¡Reserva Registrada en ${params.clubName}!* 🎾

Hola *${params.clientName}*, tu turno ha sido agendado a través de TuCancha.

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
        const notificationMessage = `Tu reserva #${params.bookingId} fue registrada correctamente.`;

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
            params.notificationUserId
                ? {
                    clubId: params.clubId,
                    type: OUTBOX_TYPES.NOTIFICATION_CREATE,
                    aggregateType: 'BOOKING',
                    aggregateId: String(params.bookingId),
                    dedupeKey: `booking-created:${params.bookingId}:notification:${params.notificationUserId}`,
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
        const cleanClientPhone = this.normalizePhone(params.clientPhone);
        const cleanClubPhone = this.normalizePhone(params.clubPhone);
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
            autoCancelStatusLabel = 'Configuracion incompleta';
        } else if (autoCancelEligibleNow) {
            autoCancelStatusLabel = 'Lista para cancelación automática ahora';
        } else {
            autoCancelStatusLabel = 'Se cancelara automaticamente al llegar la hora';
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
            }
        };
    }

    async createBooking(
        userId: number | null,
        guestIdentifier: string | undefined,
        guestName: string | undefined,
        guestEmail: string | undefined,
        guestPhone: string | undefined,
        guestDni: string | undefined,
        courtId: number,
        startDateTime: Date,
        activityId: number,
        isProfessorOverride: boolean = false,
        durationMinutes?: number,
        createdByAdmin = false,
        options?: CreateBookingOptions
    ): Promise<Booking> {
        let user: User | null = null;
        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else {
            // --- VALIDACIONES ESTRICTAS PARA INVITADOS/ADMIN ---
            if (!guestName || guestName.trim().length < 2) {
                throw new Error("El nombre es obligatorio para reservas como invitado.");
            }

            if (!guestDni || guestDni.trim().length < 6) {
                throw new Error("El DNI es obligatorio para identificar al cliente.");
            }

            if (!guestPhone || guestPhone.trim().length < 7) {
                throw new Error("El número de teléfono es obligatorio.");
            }

            if (!guestIdentifier) {
                guestIdentifier = guestDni;
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
        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const activitySchedule = this.resolveActivitySchedule(activity);
        const professorOverrideMinutes = Number(clubConfig?.professorDurationOverrideMinutes ?? 60);
        const canProfessorDurationOverride =
            Boolean(isProfessorOverride) &&
            Boolean(clubConfig?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        if (isProfessorOverride && !canProfessorDurationOverride) {
            throw new Error('PROFESSOR_DURATION_OVERRIDE_DISABLED');
        }
        const professorOverrideReason = String(options?.professorOverrideReason || '').trim();
        if (isProfessorOverride && !professorOverrideReason) {
            throw new Error('PROFESSOR_OVERRIDE_REASON_REQUIRED');
        }
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
                const clubTimeZone = (clubConfig && clubConfig.timeZone) ? clubConfig.timeZone : 'America/Argentina/Buenos_Aires';
                const localForSlot = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
                const slotTime = `${String(localForSlot.getHours()).padStart(2, '0')}:${String(localForSlot.getMinutes()).padStart(2, '0')}`;
        const possibleSlots = this.resolveScheduleSlots(activity, effectiveDuration) as Array<{ slotTime: string; dayOffset: number }>;
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
            const openStr = activitySchedule.mode === 'RANGE' ? activitySchedule.openTime : null;
            const closeStr = activitySchedule.mode === 'RANGE' ? activitySchedule.closeTime : null;
            if (openStr && closeStr) {
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
        let finalPrice = BASE_PRICE;
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

        const bookingClubId = (court as any).club.id;

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
                include: { user: true, court: { include: { club: true } }, activity: true }
            });

            if (overlapping.length > 0) {
                throw new Error(`El turno ${startDateTime.toISOString()} ya está confirmado.`);
            }

            let saved;
            try {
                const resolvedClient = await this.resolveOrCreateClient(tx, {
                    clubId: bookingClubId,
                    userId: user?.id ?? null,
                    name: guestName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.firstName || 'Cliente',
                    phone: guestPhone || user?.phoneNumber || null,
                    email: guestEmail || user?.email || null,
                    dni: guestDni || null
                });

                saved = await tx.booking.create({
                    data: {
                        startDateTime,
                        endDateTime,
                        listPrice: finalPrice,
                        price: finalPrice,
                        status: resolveInitialBookingStatus(
                            (clubConfig?.bookingConfirmationMode ?? 'MANUAL') as 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED'
                        ),
                        userId: user ? user.id : null,
                        clientId: resolvedClient.id,
                        guestIdentifier: guestIdentifier,
                        courtId: courtId,
                        activityId: activityId,
                        clubId: bookingClubId
                    },
                    include: { user: true, court: { include: { club: true } }, activity: true }
                });

                // Estrategia lazy: para turnos simples no abrimos cuenta al crear.
                // Solo se crea al confirmar, agregar consumos o registrar pagos.
                if (options?.skipAccountCreation === false) {
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
                        include: { user: true, court: { include: { club: true } }, activity: true }
                    });
                    if (refreshed) {
                        saved = refreshed;
                    }
                }

                await this.eventService.bookingCreated(bookingClubId, {
                    bookingId: saved.id,
                    clubId: bookingClubId,
                    userId: user?.id ?? null,
                    courtId,
                    activityId,
                    amount: Number(saved.price || 0)
                }, tx);

                const clientName = guestName || user?.firstName || 'Jugador';
                const clientPhone = guestPhone || user?.phoneNumber || null;
                const clubPhone = (court as any)?.club?.phone ?? null;
                const timeZone = clubConfig?.timeZone ?? 'America/Argentina/Buenos_Aires';
                const outboxMessages = this.buildBookingCreatedOutboxMessages({
                    bookingId: saved.id,
                    clubId: bookingClubId,
                    clubName: (court as any)?.club?.name || 'el complejo',
                    clubPhone,
                    courtName: court.name,
                    clientName,
                    clientPhone,
                    notificationUserId: user?.id ?? null,
                    startDateTime,
                    timeZone,
                    amount: Number(saved.price || 0),
                    suppressClubNotification: createdByAdmin
                });

                await this.outboxService.enqueueMany(outboxMessages, tx);
            } catch (error) {
                if (this.isUniqueSlotConstraintError(error)) {
                    throw new Error('SLOT_ALREADY_BOOKED');
                }
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
                professorOverrideApplied: Boolean(isProfessorOverride),
                professorOverrideReason: professorOverrideReason || null,
                professorDurationOverrideMinutes: canProfessorDurationOverride ? professorOverrideMinutes : null
            }
        });

        if (isProfessorOverride) {
            await this.auditLogService.create({
                clubId: (court as any).club.id,
                userId: options?.actorUserId ?? user?.id ?? null,
                entity: 'Booking',
                entityId: String(created.id),
                action: 'BOOKING_PROFESSOR_OVERRIDE',
                payload: {
                    reason: professorOverrideReason,
                    requestedDurationMinutes: effectiveDuration,
                    overrideMinutes: professorOverrideMinutes,
                    overrideEnabledInClub: Boolean(clubConfig?.professorDurationOverrideEnabled)
                }
            });
        }

        return this.bookingRepo.mapToEntity(created);
    }

    async getAvailableSlots(courtId: number, date: Date, activityId: number, durationMinutes?: number): Promise<string[]> {
        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");
        const activitySchedule = this.resolveActivitySchedule(activity);

        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const clubTimeZone = clubConfig.timeZone ?? 'America/Argentina/Buenos_Aires';

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

        const possibleSlots = this.resolveScheduleSlots(activity, effectiveDuration) as Array<{ slotTime: string; dayOffset: number }>;

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

    async confirmBooking(bookingId: number, actorUserId: number, clubId: number) {
        const updatedStatus = await prisma.$transaction(async (tx) => {
            const status = await this.bookingDomainService.confirmBookingManuallyTx(tx, { bookingId, clubId });
            const booking = await tx.booking.findFirst({
                where: { id: bookingId, clubId },
                select: { id: true, clubId: true, price: true, activityId: true, clientId: true }
            });
            if (booking) {
                await this.ensureBookingAccountWithChargeTx(tx, {
                    bookingId: booking.id,
                    clubId: booking.clubId,
                    bookingPrice: Number(booking.price || 0),
                    activityTypeId: booking.activityId,
                    clientId: booking.clientId,
                    actorUserId
                });
            }
            return status;
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

            const updatedBooking = await tx.booking.update({
                where: { id: bookingId },
                data: { status: 'COMPLETED' }
            });

            const account = await tx.account.findFirst({
                where: { sourceType: 'BOOKING', sourceId: String(bookingId), clubId },
                select: { id: true }
            });
            if (account) {
                // Mantener la cuenta abierta tras finalizar la reserva permite
                // seguir cargando consumos post-cancha (ej. bar) hasta cierre manual.
                await this.projectionService.refreshAccountSummary(account.id, tx);
            }

            return updatedBooking;
        });

        await this.auditLogService.create({
            clubId,
            userId: actorUserId,
            entity: 'Booking',
            entityId: String(bookingId),
            action: 'BOOKING_COMPLETE',
            payload: { status: completed.status }
        });

        return this.getBookingById(bookingId, clubId);
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
                userId: requestedUserId,
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
        user: true,
        client: true
    }
});

        const bookingIds = bookings.map((booking) => booking.id);
        const sourceIds = bookingIds.map((id) => String(id));

        const [accounts, clubsWithSettings, paymentAgg, refundAgg] = await Promise.all([
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
                : Promise.resolve([])
        ]);

        const accountByBookingId = new Map<number, { id: string; clubId: number }>();
        for (const account of accounts) {
            const parsedBookingId = Number(account.sourceId);
            if (Number.isInteger(parsedBookingId)) {
                accountByBookingId.set(parsedBookingId, { id: account.id, clubId: account.clubId });
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
            const paidAmount = accountRef
                ? Math.max(0, Number((paymentByAccountId.get(accountRef.id) || 0) - (refundByAccountId.get(accountRef.id) || 0)))
                : 0;
            const clubSettings = clubSettingsByClubId.get(booking.clubId) || { mode: 'MANUAL' as const, depositPercent: null };
            const confirmationContext = this.buildBookingConfirmationContext({
                status: booking.status,
                mode: clubSettings.mode,
                bookingBaseAmount: Number(booking.price || 0),
                depositPercent: clubSettings.depositPercent,
                paidAmount
            });

            bookingWithContextById.set(booking.id, {
                ...booking,
                confirmationContext: {
                    paidAmount: Number(paidAmount.toFixed(2)),
                    ...confirmationContext
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

        for (const court of activeCourts) {
            const courtActivity = this.mapActivityType((court as any).activityType);
            if (!courtActivity) continue;
            const courtSchedule = this.resolveActivitySchedule(courtActivity);
            const courtDuration = courtSchedule.durations[0] ?? courtActivity.defaultDurationMinutes;
            const possibleSlots = this.resolveScheduleSlots(courtActivity, courtDuration);

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

    async getAvailableSlotsWithCourts(date: Date, activityId: number, clubId?: number, durationMinutes?: number): Promise<Array<{
        slotTime: string;
        availableCourts: Array<{
            id: number;
            name: string;
            price?: number | null;
        }>;
    }>> {
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
            return [];
        }

        const activity = this.mapActivityType((activityCourts[0] as any).activityType)
            ?? await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");

        // Si el club (si se indicó) está cerrado ese día, no devolvemos horarios
        if (clubId && !this.isClubOpenOnLocalDate(normalizedClubConfig, date, timeZone)) {
            return [];
        }

        const activitySchedule = this.resolveActivitySchedule(activity);
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        if (!allowedDurations.includes(effectiveDuration)) {
            throw new Error("Duración no permitida por el club");
        }

        const possibleSlots = this.resolveScheduleSlots(activity, effectiveDuration) as Array<{ slotTime: string; dayOffset: number }>;

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
            const courtsWithStatus = activityCourts.map(court => {
                const isBusy = bookings.some(b => {
                    if (b.court.id !== court.id || b.status === "CANCELLED") return false;
                    
                    const bStart = b.startDateTime.getTime();
                    const bEnd = b.endDateTime.getTime();
                    const sStart = slotDateTime.getTime();
                    const sEnd = slotEndDateTime.getTime();

                    // Si se solapan, la cancha está ocupada
                    return sStart < bEnd && sEnd > bStart;
                });

                return {
                    id: court.id,
                    name: court.name,
                    price: (court as any).price ?? null,
                    isAvailable: !isBusy
                };
            });

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

        return slotsWithCourts;
    }

    async createFixedBooking(
        userId: number | null,
        courtId: number,
        activityId: number,
        startDateTime: Date,
        weeksToGenerate?: number,
        guestName?: string,
        guestPhone?: string | number, // Agregado para recibir el dato del front
        guestDni?: string,
        isProfessorOverride: boolean = false,
        clubId?: number,
        professorOverrideReason?: string,
        actorUserId?: number | null
    ) {
        const safePhone = guestPhone ? String(guestPhone) : undefined;

        // 1. Validaciones básicas
        let user: User | null = null;
        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else if (!guestName) {
            throw new Error("Debe proveer un nombre para reservas fijas como invitado.");
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        
        const courtClubId = (court as any)?.club?.id;
        if (clubId && courtClubId !== clubId) {
            throw new Error("No tienes acceso a esta cancha");
        }

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");
        // Validar que la actividad pertenezca al mismo club que la cancha
        if ((activity.clubId ?? null) !== ((court as any)?.club?.id ?? null)) {
            throw new Error("ACTIVITY_CLUB_MISMATCH");
        }
        const clubConfigForFixed = this.resolveClubConfig((court as any)?.club);
        const professorOverrideMinutes = Number(clubConfigForFixed?.professorDurationOverrideMinutes ?? 60);
        const canProfessorDurationOverride =
            Boolean(isProfessorOverride) &&
            Boolean(clubConfigForFixed?.professorDurationOverrideEnabled) &&
            Number.isFinite(professorOverrideMinutes) &&
            professorOverrideMinutes > 0;
        if (isProfessorOverride && !canProfessorDurationOverride) {
            throw new Error('PROFESSOR_DURATION_OVERRIDE_DISABLED');
        }
        const normalizedProfessorOverrideReason = String(professorOverrideReason || '').trim();
        if (isProfessorOverride && !normalizedProfessorOverrideReason) {
            throw new Error('PROFESSOR_OVERRIDE_REASON_REQUIRED');
        }
        const duration = canProfessorDurationOverride ? professorOverrideMinutes : (activity ? activity.defaultDurationMinutes : 60);
        this.assertValidDuration(duration);
        const fixedConfig = this.resolveFixedBookingConfig(clubConfigForFixed, activity ?? null);

        const explicitWeeks = Number(weeksToGenerate);
        const hasExplicitWeeks = Number.isFinite(explicitWeeks) && explicitWeeks > 0;
        const generationFrequencyDays = Math.max(1, fixedConfig.fixedBookingGenerationFrequencyDays);
        const totalOccurrences = hasExplicitWeeks
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

        // Verificar días de apertura del club antes de crear turnos fijos
        if (!this.isClubOpenOnLocalDate(clubConfigForFixed, startDateTime, clubTimeZone)) {
            throw new Error('El club está cerrado ese día');
        }

        // 👇 CORRECCIÓN 1: FILTRAR SOLO LOS ACTIVOS (NO CANCELADOS)
        const existingFixed = await prisma.fixedBooking.findMany({
            where: {
                courtId,
                dayOfWeek,
                status: { not: 'CANCELLED' } // Importante: Ignora los dados de baja
            }
        });

        const overlapsFixed = existingFixed.some((fixed) => {
            const fixedStart = Number((fixed as any).startTimeMinutes);
            const fixedEnd = Number((fixed as any).endTimeMinutes);
            if (!Number.isFinite(fixedStart) || !Number.isFinite(fixedEnd)) return false;
            return startTimeMinutes < fixedEnd && endTimeMinutes > fixedStart;
        });

        if (overlapsFixed) {
            throw new Error("Ya existe un turno fijo en ese horario para esta cancha.");
        }

        // 2. Preparar fechas límites
        const firstStart = new Date(startDateTime);
        const lastStart = new Date(firstStart);
        lastStart.setDate(firstStart.getDate() + ((totalOccurrences - 1) * generationFrequencyDays));
        const lastEnd = new Date(lastStart.getTime() + duration * 60000);

        console.info('[FIXED_BOOKING] Inicio de generación', {
            courtId,
            activityId,
            clubId: (court as any)?.club?.id,
            firstStart: firstStart.toISOString(),
            totalOccurrences,
            generationFrequencyDays
        });
        // ATÓMICO: crear FixedBooking y bookings hijas en una sola transacción
        let fixedBooking: any;
        let generatedCount = 0;
        await prisma.$transaction(async (tx) => {
            // A. Crear el "Padre" (Turno Fijo)
            fixedBooking = await tx.fixedBooking.create({
                data: {
                    ...(userId ? { userId } : {}),
                    ...(guestName ? { guestName } : {}),
                    ...(safePhone ? { guestPhone: safePhone } : {}),
                    ...(guestDni ? { guestDni } : {}),

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

            // B. Conflictos existentes
            const existingBookings = await tx.booking.findMany({
                where: {
                    courtId,
                    status: { not: 'CANCELLED' },
                    startDateTime: { gte: firstStart },
                    endDateTime: { lte: lastEnd }
                }
            });

            // C. Generar hijas usando la misma lógica central de createBooking
            for (let i = 0; i < totalOccurrences; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * generationFrequencyDays));

                const currentEnd = new Date(currentStart.getTime() + duration * 60000);
                this.assertValidRange(currentStart, currentEnd);

                const hasConflict = existingBookings.some((existing: any) => {
                    return existing.startDateTime < currentEnd && existing.endDateTime > currentStart;
                });

                if (hasConflict) {
                    continue;
                }

                try {
                    const createdBooking = await this.createBooking(
                        userId,
                        guestDni,
                        guestName,
                        undefined,
                        safePhone,
                        guestDni,
                        courtId,
                        currentStart,
                        activityId,
                        isProfessorOverride,
                        duration,
                        true,
                        {
                            skipAccountCreation: true,
                            skipAdvanceLimit: true,
                            professorOverrideReason: normalizedProfessorOverrideReason,
                            actorUserId: actorUserId ?? null
                        }
                    );

                    await tx.booking.update({
                        where: { id: createdBooking.id },
                        data: { fixedBookingId: fixedBooking.id }
                    });

                    generatedCount += 1;
                } catch (error) {
                    if (this.isOverlapConstraintError(error) || String((error as Error)?.message || '').includes('ya fue reservado')) {
                        continue;
                    }
                    throw error;
                }
            }
        });

        console.info('[FIXED_BOOKING] Generación completada', {
            fixedBookingId: fixedBooking.id,
            generatedCount,
            courtId,
            activityId,
            clubId: (court as any).club.id
        });

        if (isProfessorOverride) {
            await this.auditLogService.create({
                clubId: (court as any).club.id,
                userId: actorUserId ?? user?.id ?? null,
                entity: 'FixedBooking',
                entityId: String(fixedBooking.id),
                action: 'FIXED_BOOKING_PROFESSOR_OVERRIDE',
                payload: {
                    reason: normalizedProfessorOverrideReason,
                    overrideMinutes: professorOverrideMinutes,
                    generatedCount
                }
            });
        }

        return {
            fixedBookingId: fixedBooking.id,
            generatedCount,
            msg: `Se crearon ${generatedCount} turnos pendientes.`
        };
    }

    async cancelFixedBooking(fixedBookingId: number, clubId?: number) {
        // Si hay clubId, verificar que el turno fijo pertenece al club
        if (clubId) {
            const fixedBooking = await prisma.fixedBooking.findUnique({
                where: { id: fixedBookingId },
                include: { court: { include: { club: true } } }
            });
            if (!fixedBooking) {
                throw new Error("Turno fijo no encontrado");
            }
            if (fixedBooking.court.club.id !== clubId) {
                throw new Error("No tienes acceso a este turno fijo");
            }
        }
        
        const today = new Date();
        
        // 👇 CORRECCIÓN 3: MARCAR EL PADRE COMO CANCELADO
        // Esto evita que "createFixedBooking" detecte conflicto en el futuro
        await prisma.fixedBooking.update({
            where: { id: fixedBookingId },
            data: { status: 'CANCELLED' }
        });

        // Actualizamos todas las reservas futuras vinculadas a ese ID a "CANCELLED"
        await prisma.booking.updateMany({
            where: {
                fixedBookingId: fixedBookingId,
                startDateTime: { gte: today }, // Solo las futuras
                status: { not: 'CANCELLED' },
                ...(clubId ? { clubId } : {})
            },
            data: {
                status: 'CANCELLED'
            }
        });

        console.info('[FIXED_BOOKING] Turno fijo cancelado', {
            fixedBookingId,
            clubId: clubId ?? null
        });
        
        return { message: "Turno fijo cancelado de hoy en adelante" };
    }

    async getBookingItems(bookingId: number, clubId: number) {
        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, clubId },
            select: { id: true }
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

        if (!account) return [];

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
                    clientId: booking.clientId ?? null,
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

            const deleted = await tx.accountItem.delete({ where: { id: itemId } });
            await this.projectionService.refreshAccountSummary(item.accountId, tx);
            return deleted;
        });
    }

}
