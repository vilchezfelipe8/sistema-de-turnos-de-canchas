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
import { PaymentStatus, BookingStatus } from '@prisma/client';
import { CashRepository } from '../repositories/CashRepository';
import { ProductRepository } from '../repositories/ProductRepository';
import { buildSlotsFromSchedule, normalizeSchedule } from '../utils/ActivityScheduleHelper';
import { getUserClubContext } from '../utils/getUserClubContext';
import { PricingService } from './PricingService';
import { EventService } from './EventService';
import { AuditLogService } from './AuditLogService';
import { NotificationService } from './NotificationService';

export class BookingService {
    private readonly pricingService = new PricingService();
    private readonly eventService = new EventService();
    private readonly auditLogService = new AuditLogService();
    private readonly notificationService = new NotificationService();

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

        // Fallback de compatibilidad para actividades FIXED sin slots configurados.
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
        const lightsFromMinutes = settings?.lightsFromHour;
        const normalizedLightsFromHour = Number.isFinite(Number(lightsFromMinutes))
            ? this.fromMinutes(Number(lightsFromMinutes))
            : club?.lightsFromHour ?? null;

        return {
            ...club,
            timeZone: settings?.timeZone ?? club?.timeZone ?? 'America/Argentina/Buenos_Aires',
            openingDays: Array.isArray(settings?.openingDays)
                ? settings.openingDays
                : (Array.isArray(club?.openingDays) ? club.openingDays : null),
            lightsEnabled: settings?.lightsEnabled ?? club?.lightsEnabled ?? false,
            lightsExtraAmount: settings?.lightsExtraAmount ?? club?.lightsExtraAmount ?? null,
            lightsFromHour: normalizedLightsFromHour,
            professorDiscountEnabled: settings?.professorDiscountEnabled ?? club?.professorDiscountEnabled ?? false,
            professorDiscountPercent: settings?.professorDiscountPercent ?? club?.professorDiscountPercent ?? null,
            fixedBookingSettingsByActivity: club?.fixedBookingSettingsByActivity ?? null
        };
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
            knownError?.code === 'P2004' &&
            (
                message.includes('booking_no_overlap_per_court') ||
                dbMessage.includes('booking_no_overlap_per_court') ||
                message.toLowerCase().includes('exclusion constraint') ||
                dbMessage.toLowerCase().includes('exclusion constraint')
            )
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

    private calculateBookingFinancials(booking: {
        price: unknown;
        items: Array<{ price: unknown; quantity: number }>;
        cashMovements: Array<{ type: string; amount: unknown; method?: string | null }>;
    }) {
        const courtPrice = Number(booking.price || 0);
        const itemsTotal = booking.items.reduce(
            (sum, item) => sum + Number(item.price) * Number(item.quantity),
            0
        );
        const totalPaid = booking.cashMovements
            .filter((movement) => movement.type === 'INCOME' && movement.method !== 'DEBT')
            .reduce((sum, movement) => sum + Number(movement.amount), 0);
        const total = courtPrice + itemsTotal;
        const remaining = Math.max(0, total - totalPaid);
        return { courtPrice, itemsTotal, totalPaid, total, remaining };
    }

    async getBookingFinancialSummary(bookingId: number) {
        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                items: true,
                cashMovements: true
            }
        });

        if (!booking) {
            throw new Error('Reserva no encontrada');
        }

        const courtTotal = Number(booking.price || 0);
        const itemsTotal = booking.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
        const total = courtTotal + itemsTotal;

        const totalPaid = booking.cashMovements
            .filter((movement) => movement.type === 'INCOME' && movement.method !== 'DEBT')
            .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

        const itemsPaid = booking.items
            .filter((item) => item.paymentMethod && item.paymentMethod !== 'DEBT')
            .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

        const itemsDebt = Math.max(0, itemsTotal - itemsPaid);
        const paidAvailableForCourt = Math.max(0, totalPaid - itemsPaid);
        const courtPaid = Math.min(courtTotal, paidAvailableForCourt);

        const courtDebtRegistered = booking.cashMovements
            .filter((movement) => {
                if (movement.type !== 'INCOME') return false;
                if (movement.method !== 'DEBT') return false;
                if (movement.isSettled !== false) return false;
                const description = String(movement.description || '').toLowerCase();
                return description.startsWith('deuda cancha reserva #');
            })
            .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

        const courtDebt = Math.max(0, courtTotal - courtPaid - courtDebtRegistered);
        const remaining = Math.max(0, total - totalPaid);

        const courtPayments = booking.cashMovements
            .filter((movement) => {
                if (movement.type !== 'INCOME') return false;
                if (movement.method === 'DEBT') return false;
                const description = String(movement.description || '');
                return !description.startsWith('Venta Extra:');
            })
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map((movement) => ({
                id: movement.id,
                amount: Number(movement.amount || 0),
                method: movement.method,
                description: movement.description,
                date: movement.date
            }));

        let paymentStatus: PaymentStatus = PaymentStatus.DEBT;
        if (remaining <= 0.01) paymentStatus = PaymentStatus.PAID;
        else if (totalPaid > 0.01) paymentStatus = PaymentStatus.PARTIAL;

        return {
            bookingId,
            courtTotal,
            courtPaid,
            courtDebt,
            itemsTotal,
            itemsPaid,
            itemsDebt,
            total,
            totalPaid,
            remaining,
            paymentStatus,
            courtPayments
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
        allowGuestWithoutContact = false,
        isProfessorOverride: boolean = false,
        durationMinutes?: number
    ): Promise<Booking> {
        let user: User | null = null;
        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else {
            if (allowGuestWithoutContact) {
                if (!guestIdentifier) {
                    guestIdentifier = `admin_${Date.now()}`;
                }
            } else {
                // --- VALIDACIONES ESTRICTAS PARA INVITADOS/ADMIN ---

                // 1. Nombre obligatorio
                if (!guestName || guestName.trim().length < 2) {
                    throw new Error("El nombre es obligatorio para reservas como invitado.");
                }

                // 2. DNI obligatorio (Vital para tu lista de deudores)
                if (!guestDni || guestDni.trim().length < 6) {
                    throw new Error("El DNI es obligatorio para identificar al cliente.");
                }

                // 3. Teléfono obligatorio (Vital para contacto y agrupación)
                if (!guestPhone || guestPhone.trim().length < 7) {
                    throw new Error("El número de teléfono es obligatorio.");
                }

                // 4. Aseguramos el guestIdentifier (usamos el DNI si no hay uno)
                if (!guestIdentifier) {
                    guestIdentifier = guestDni;
                }
            }
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");
        const clubConfig = this.resolveClubConfig((court as any)?.club);
        const activitySchedule = this.resolveActivitySchedule(activity);
        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? allowedDurations[0] ?? activity.defaultDurationMinutes;
        this.assertValidDuration(effectiveDuration);
        // Permitir override para profesores: si se indica isProfessorOverride y se solicita 60, permitir aunque no esté en allowedDurations
        if (!allowedDurations.includes(effectiveDuration)) {
            if (!(isProfessorOverride && effectiveDuration === 60)) {
                throw new Error("Duración no permitida por el club");
            }
        }

                // Determinar slotTime en la zona horaria del club
                const clubTimeZone = (clubConfig && clubConfig.timeZone) ? clubConfig.timeZone : 'America/Argentina/Buenos_Aires';
                const localForSlot = TimeHelper.utcToLocal(startDateTime, clubTimeZone);
                const slotTime = `${String(localForSlot.getHours()).padStart(2, '0')}:${String(localForSlot.getMinutes()).padStart(2, '0')}`;
        const possibleSlots = this.resolveScheduleSlots(activity, effectiveDuration) as Array<{ slotTime: string; dayOffset: number }>;
        const possibleSlotTimes = possibleSlots.map(s => s.slotTime);
        if (!possibleSlotTimes.includes(slotTime)) {
            throw new Error("Horario no permitido por el club");
        }

        // Verificar días de apertura del club (en la zona horaria del club)
        if (!this.isClubOpenOnLocalDate(clubConfig, startDateTime, clubTimeZone)) {
            throw new Error('El club está cerrado ese día');
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
        const isProfessor = Boolean(user?.isProfessor) || Boolean(isProfessorOverride);
        let finalPrice = BASE_PRICE;

        if (isProfessor && clubPricingConfig?.professorDiscountEnabled) {
            const discountPercent = Number(clubPricingConfig?.professorDiscountPercent ?? 0);
            if (Number.isFinite(discountPercent) && discountPercent > 0) {
                const clamped = Math.min(Math.max(discountPercent, 0), 100);
                finalPrice = BASE_PRICE * (1 - clamped / 100);
            }
        }
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
                include: { user: true, court: { include: { club: true } }, activity: true }
            });

            if (overlapping.length > 0) {
                throw new Error(`El turno ${startDateTime.toISOString()} ya está confirmado.`);
            }

            let saved;
            try {
                saved = await tx.booking.create({
                    data: {
                        startDateTime,
                        endDateTime,
                        price: finalPrice,
                        status: BookingStatus.PENDING,
                        userId: user ? user.id : undefined,
                        guestIdentifier: guestIdentifier,
                        guestName: guestName,
                        guestEmail: guestEmail,
                        guestPhone: guestPhone,
                        guestDni: guestDni,
                        courtId: courtId,
                        activityId: activityId,
                        clubId: (court as any).club.id
                    },
                    include: { user: true, court: { include: { club: true } }, activity: true }
                });
            } catch (error) {
                if (this.isOverlapConstraintError(error)) {
                    throw new Error('El turno seleccionado ya fue reservado por otro usuario');
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

        await this.eventService.bookingCreated((court as any).club.id, {
            bookingId: created.id,
            clubId: (court as any).club.id,
            userId: user?.id ?? null,
            courtId,
            activityId,
            amount: Number(created.price || 0)
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
                amount: Number(created.price || 0)
            }
        });

        if (user?.id) {
            await this.notificationService.createNotification(
                user.id,
                (court as any).club.id,
                'Reserva creada',
                `Reserva #${created.id} creada para ${court.name}.`
            );
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
                startDateTime: {
                    gte: startUtc,
                    lte: endUtc
                },
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

    async cancelBooking(bookingId: number, cancelledByUserId: number, clubId?: number) {
        const booking = await this.bookingRepo.findById(bookingId);
        if (!booking) {
            throw new Error("La reserva no existe.");
        }
        if (clubId != null) {
            if (booking.court.club.id !== clubId) {
                throw new Error("No tienes acceso a esta reserva");
            }
        } else {
            if (!booking.user || booking.user.id !== cancelledByUserId) {
                throw new Error("No tienes acceso a esta reserva");
            }
        }

        // 👇 CORRECCIÓN DEFINITIVA DE CAJA 👇
        // Buscamos cuánto pagó REALMENTE el cliente por esta reserva en el registro de caja
        const bookingWithPayments = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { cashMovements: true }
        });

        if (bookingWithPayments) {
            // Sumamos todos los ingresos (INCOME) asociados a esta reserva
            const totalPaid = bookingWithPayments.cashMovements
                .filter(m => m.type === 'INCOME')
                .reduce((sum, m) => sum + Number(m.amount), 0);

            // Solo registramos una salida de caja si el cliente REALMENTE había pagado algo
            if (totalPaid > 0) {
                try {
                    await this.cashRepository.create({
                        date: new Date(),
                        type: 'EXPENSE', // 🔴 Registramos un GASTO (Salida/Devolución)
                        amount: totalPaid, // 👈 Devolvemos EXACTAMENTE lo que puso (Seña o Total)
                        description: `Anulación Reserva #${bookingId} (${booking.court.name})`,
                        method: 'CASH', // Asumimos devolución en efectivo por defecto
                        bookingId: bookingId
                    });
                    console.log(`📉 Caja ajustada: -$${totalPaid} por cancelación de reserva #${bookingId}`);
                } catch (error) {
                    console.error("⚠️ Error al registrar devolución en caja:", error);
                    // No detenemos la cancelación, solo avisamos.
                }
            } else {
                console.log(`ℹ️ Reserva #${bookingId} cancelada. No se tocó la caja porque no había pagos previos.`);
            }
        }

        // 2. Ahora sí, procedemos a cancelar (Soft Delete o cambio de estado)
        await this.bookingRepo.delete(bookingId, cancelledByUserId);

        console.info('[BOOKING] Reserva cancelada', {
            bookingId,
            cancelledByUserId,
            clubId: booking.court.club.id
        });

        await this.eventService.bookingCancelled(booking.court.club.id, {
            bookingId,
            userId: booking.user?.id ?? null,
            cancelledByUserId,
            clubId: booking.court.club.id
        });

        await this.auditLogService.create({
            clubId: booking.court.club.id,
            userId: cancelledByUserId,
            entity: 'Booking',
            entityId: String(bookingId),
            action: 'BOOKING_CANCEL',
            payload: {
                cancelledByUserId,
                courtId: booking.court.id,
                activityId: booking.activity.id
            }
        });

        if (booking.user?.id) {
            await this.notificationService.createNotification(
                booking.user.id,
                booking.court.club.id,
                'Reserva cancelada',
                `Reserva #${bookingId} cancelada correctamente.`
            );
        }
        
        const updated = await this.bookingRepo.findById(bookingId);
        return updated;
    }
    
    async confirmBooking(bookingId: number, userId: number, paymentMethod: string = 'CASH', clubId?: number) {
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new Error("La reserva no existe.");

    if (clubId != null && booking.court.club.id !== clubId) {
        throw new Error("No tienes acceso a esta reserva");
    }

    // No permitir confirmar reservas canceladas o ya finalizadas
    if (booking.status === BookingStatus.CANCELLED) {
        throw new Error("No se puede confirmar una reserva cancelada.");
    }
    if (booking.status === BookingStatus.COMPLETED) {
        throw new Error("No se puede confirmar una reserva que ya finalizó.");
    }

    const paymentStatus = paymentMethod === 'DEBT' 
    ? PaymentStatus.DEBT
    : PaymentStatus.PAID;

    const bookingClubId = booking.court?.club?.id;
    if (!bookingClubId) {
        throw new Error('No se pudo determinar el club de la reserva para registrar el movimiento');
    }

    const updated = await prisma.$transaction(async (tx) => {
        const updatedBooking = await tx.booking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CONFIRMED,
                paymentStatus: paymentStatus,
            },
            include: { user: true, court: { include: { club: true } }, activity: true }
        });

        if (paymentMethod !== 'DEBT') {
            const price = Number(updatedBooking.price || 0);
            if (price > 0) {
                await tx.cashMovement.create({
                    data: {
                        date: new Date(),
                        type: 'INCOME',
                        amount: price,
                        description: `Cobro cancha reserva #${updatedBooking.id}`,
                        method: paymentMethod,
                        bookingId: updatedBooking.id,
                        clubId: bookingClubId,
                        userId: updatedBooking.userId ?? undefined,
                        guestName: updatedBooking.guestName ?? undefined,
                        guestPhone: updatedBooking.guestPhone ?? undefined,
                        guestDni: updatedBooking.guestDni ?? undefined,
                        isSettled: true,
                    }
                });
            }
        } else {
            console.log(`📝 Deuda registrada al cliente ${updatedBooking.guestName} por Reserva #${updatedBooking.id}`);
        }

        return updatedBooking;
    });

    const paidAmount = Number(updated.price || 0);
    if (paymentMethod !== 'DEBT' && paidAmount > 0) {
        await this.eventService.paymentReceived(bookingClubId, {
            bookingId: updated.id,
            userId: updated.user?.id ?? null,
            amount: paidAmount,
            method: paymentMethod,
            clubId: bookingClubId
        });
    }

    await this.auditLogService.create({
        clubId: bookingClubId,
        userId,
        entity: 'Payment',
        entityId: String(updated.id),
        action: 'PAYMENT_CREATE',
        payload: {
            bookingId: updated.id,
            method: paymentMethod,
            amount: paidAmount,
            paymentStatus
        }
    });

    if (updated.user?.id && paymentMethod !== 'DEBT' && paidAmount > 0) {
        await this.notificationService.createNotification(
            updated.user.id,
            bookingClubId,
            'Pago recibido',
            `Pago registrado para la reserva #${updated.id}.`
        );
    }

    return this.bookingRepo.mapToEntity(updated);
}

    async getUserHistory(
        requestedUserId: number,
        requestUser: { userId: number; role: string; clubId: number | null }
    ) {
        if (requestedUserId !== requestUser.userId) {
            if (requestUser.role !== 'ADMIN' || requestUser.clubId == null) {
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
                activity: true,
                items: { include: { product: true } }
            },
            orderBy: { startDateTime: 'desc' }
        });
        return bookings;
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
        startDateTime: {
            gte: startUtc,
            lte: endUtc
        },
        ...(clubId ? { clubId } : {}),
        status: { not: 'CANCELLED' }
    },
    include: {
        court: true,
        user: true, 
        
        // 👇 AQUÍ ESTÁ LA CLAVE: Traemos los items y sus productos
        items: { 
            include: {
                product: true
            }
        }
    }
});

        const schedule = [];

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

                    const booking = bookings.find(b => {
                    const courtMatch = b.court.id === court.id;
                    const localDate = TimeHelper.utcToLocal(b.startDateTime, timeZone);
                    const bookingLocalTimeStr = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;
                    const timeMatch = bookingLocalTimeStr === slotObj.slotTime;
                    return courtMatch && timeMatch;
                });

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
                    booking: booking
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

    async getAllAvailableSlots(date: Date, activityId: number, durationMinutes?: number): Promise<string[]> {
        const firstClub = await prisma.club.findFirst({ select: { timeZone: true } });
        const timeZone = firstClub?.timeZone ?? 'America/Argentina/Buenos_Aires';
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => {
            if (court.isUnderMaintenance) return false;
            const clubCfg = this.resolveClubConfig((court as any)?.club);
            const clubTZ = clubCfg.timeZone ?? timeZone;
            return this.isClubOpenOnLocalDate(clubCfg, date, clubTZ);
        });
        const bookings = await this.bookingRepo.findAllByDate(date, timeZone);

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");
        const activitySchedule = this.resolveActivitySchedule(activity);

        const activeActivityCourts = activeCourts.filter((court: any) => Number(court.activityTypeId) === Number(activityId));

        const allowedDurations = activitySchedule.durations;
        const effectiveDuration = durationMinutes ?? activity.defaultDurationMinutes;
        if (!allowedDurations.includes(effectiveDuration)) {
            throw new Error("Duración no permitida por el club");
        }

        const possibleSlots = this.resolveScheduleSlots(activity, effectiveDuration) as Array<{ slotTime: string; dayOffset: number }>;

        const anchors = [
            (() => { const d = new Date(date); d.setDate(d.getDate() - 1); return d; })(),
            new Date(date)
        ];

        const seen = new Set<string>();
        const result: string[] = [];

        for (const anchor of anchors) {
            for (const slotObj of possibleSlots) {
                const slotDateCandidate = new Date(anchor);
                slotDateCandidate.setDate(slotDateCandidate.getDate() + (slotObj.dayOffset || 0));
                if (
                    slotDateCandidate.getFullYear() !== date.getFullYear() ||
                    slotDateCandidate.getMonth() !== date.getMonth() ||
                    slotDateCandidate.getDate() !== date.getDate()
                ) continue;

                const slotDateTime = TimeHelper.localSlotToUtc(slotDateCandidate, slotObj.slotTime, timeZone);

                const hasAvailableCourt = activeActivityCourts.some(court => {
                    const booking = bookings.find(b => {
                        const courtMatch = b.court.id === court.id;
                        const bookingUTCTime = Date.UTC(
                            b.startDateTime.getUTCFullYear(),
                            b.startDateTime.getUTCMonth(),
                            b.startDateTime.getUTCDate(),
                            b.startDateTime.getUTCHours(),
                            b.startDateTime.getUTCMinutes()
                        );
                        const slotUTCTime = slotDateTime.getTime();
                        const timeMatch = bookingUTCTime === slotUTCTime;
                        return courtMatch && timeMatch;
                    });
                    return !booking;
                });

                if (hasAvailableCourt && !seen.has(slotObj.slotTime)) {
                    seen.add(slotObj.slotTime);
                    result.push(slotObj.slotTime);
                }
            }
        }

        return result;
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
                startDateTime: {
                    gte: startUtc,
                    lte: endUtc
                },
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
        clubId?: number
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
        const duration = isProfessorOverride ? 60 : (activity ? activity.defaultDurationMinutes : 60);
        this.assertValidDuration(duration);
        const clubConfigForFixed = this.resolveClubConfig((court as any)?.club);
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

        return await prisma.$transaction(async (tx: any) => {
            
            // A. Crear el "Padre" (Turno Fijo)
            const fixedBooking = await tx.fixedBooking.create({
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
                    status: 'ACTIVE' // Asegurar estado activo al crear
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

            const bookingsToCreate = [];

            // C. Procesar en memoria
            for (let i = 0; i < totalOccurrences; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * generationFrequencyDays));
                
                const currentEnd = new Date(currentStart.getTime() + duration * 60000);
                this.assertValidRange(currentStart, currentEnd);

                const hasConflict = existingBookings.some((existing: any) => {
                    return (existing.startDateTime < currentEnd && existing.endDateTime > currentStart);
                });

                if (!hasConflict) {
                    const basePrice = Number((court as any)?.price ?? 0);
                    if (!Number.isFinite(basePrice) || basePrice <= 0) {
                        throw new Error('Precio de cancha no configurado.');
                    }
                    const clubConfig = this.resolveClubConfig((court as any)?.club);
                    const isProfessor = Boolean(user?.isProfessor) || Boolean(isProfessorOverride);
                    let fixedPrice = basePrice;
                    if (isProfessor && clubConfig?.professorDiscountEnabled) {
                        const discountPercent = Number(clubConfig?.professorDiscountPercent ?? 0);
                        if (Number.isFinite(discountPercent) && discountPercent > 0) {
                            const clamped = Math.min(Math.max(discountPercent, 0), 100);
                            fixedPrice = basePrice * (1 - clamped / 100);
                        }
                    }
                    bookingsToCreate.push({
                        startDateTime: currentStart,
                        endDateTime: currentEnd,
                        price: fixedPrice,
                        status: 'PENDING',
                        ...(userId ? { userId } : {}),
                        ...(guestName ? { guestName } : {}),
                        ...(safePhone ? { guestPhone: safePhone } : {}), // Guardar teléfono en cada reserva hija
                        ...(guestDni ? { guestDni } : {}), // Guardar DNI en cada reserva hija
                        courtId,
                        activityId,
                        clubId: (court as any).club.id,
                        fixedBookingId: fixedBooking.id
                    });
                }
            }

            // D. Guardar hijos
            if (bookingsToCreate.length > 0) {
                try {
                    await Promise.all(bookingsToCreate.map((data) => tx.booking.create({ data })));
                } catch (error) {
                    if (this.isOverlapConstraintError(error)) {
                        throw new Error('Se detectó superposición de turnos durante la generación automática');
                    }
                    throw error;
                }
            }

            console.info('[FIXED_BOOKING] Generación completada', {
                fixedBookingId: fixedBooking.id,
                generatedCount: bookingsToCreate.length,
                courtId,
                activityId,
                clubId: (court as any).club.id
            });

            return { 
                fixedBookingId: fixedBooking.id, 
                generatedCount: bookingsToCreate.length,
                msg: `Se crearon ${bookingsToCreate.length} turnos pendientes.`
            };

        }, {
            maxWait: 5000,
            timeout: 20000 
        });
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

    // 👇 AGREGÁ ESTO PARA VER QUÉ CONSUMIERON
    async getBookingItems(bookingId: number) {
        return await prisma.bookingItem.findMany({
            where: { bookingId },
            include: { product: true }
        });
    }

   // En BookingService.ts -> addItemToBooking

// 👇 Agregamos el parámetro con un valor por defecto
async addItemToBooking(bookingId: number, productId: number, quantity: number, paymentMethod: string = 'CASH') {
    
    // 1. Buscamos reserva y producto
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { court: { include: { club: true } } }
    });
    const product = await prisma.product.findUnique({ where: { id: productId } });

    if (!booking || !product) throw new Error("Datos no encontrados");

    // 2. Creamos el Item (Siempre se crea)
    const item = await prisma.bookingItem.create({
        data: {
            bookingId,
            productId,
            quantity,
            price: Number(product.price),
        }
    });

    // 3. 👇 DECISIÓN FINAL DE CAJA 👇
    console.log(`🛒 Agregando Item. Método ordenado: ${paymentMethod}`);

    if (paymentMethod === 'DEBT') {
        // A. SI ES DEUDA: NO HACEMOS NADA EN LA CAJA.
        // Al crearse el item (paso 2) y no entrar plata, la deuda aumenta sola.
        console.log("📝 Fiado. No entra plata.");
    } 
    else {
        // B. SI ES CASH (O CUALQUIER OTRO): COBRAMOS.
        await this.cashRepository.create({
            date: new Date(),
            type: 'INCOME',
            amount: Number(product.price) * quantity,
            description: `Venta Extra: ${quantity}x ${product.name} (Reserva #${bookingId})`,
            method: 'CASH', 
            bookingId: booking.id,
            clubId: booking.court.clubId
        });
    }

    return item;
}

    // 👇 (OPCIONAL) PARA BORRAR SI TE EQUIVOCASTE (Devuelve el stock)
    async removeItemFromBooking(itemId: number) {
        return await prisma.$transaction(async (tx) => {
            const item = await tx.bookingItem.findUnique({ where: { id: itemId } });
            if (!item) throw new Error("Item no encontrado");

            // Devolvemos el stock
            await tx.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } }
            });

            // Borramos el item
            return await tx.bookingItem.delete({ where: { id: itemId } });
        });
    }


async updatePaymentStatus(id: number, status: 'PAID' | 'DEBT' | 'PARTIAL') {
    // 1. Buscamos la reserva ACTUAL (antes del cambio) para saber precio y club
    const booking = await prisma.booking.findUnique({
        where: { id },
        include: { court: true } // Necesitamos esto para el clubId
    });

    if (!booking) throw new Error("Reserva no encontrada");

    // No permitir modificar el pago de reservas canceladas
    if (booking.status === 'CANCELLED') {
        throw new Error("No se puede modificar el pago de una reserva cancelada");
    }

    // 2. LÓGICA DE CAJA AUTOMÁTICA 💰
    // Si el nuevo estado es PAGADO y antes NO lo era... ¡Cobramos la cancha!
    if (status === 'PAID' && booking.paymentStatus !== 'PAID' && booking.status !== 'COMPLETED') {
        
        console.log(`💰 Cobrando Alquiler de Cancha automáticamente: $${booking.price}`);

        await this.cashRepository.create({
            date: new Date(),
            type: 'INCOME',
            amount: Number(booking.price), // El precio del alquiler base
            description: `Alquiler Cancha: ${booking.court.name} (Reserva #${booking.id})`,
            method: 'CASH', // Asumimos efectivo al cerrar por caja
            bookingId: booking.id,
            clubId: booking.court.clubId
        });
    }

    // 3. Finalmente actualizamos el estado en la base de datos
    return prisma.booking.update({
        where: { id },
        data: { paymentStatus: status }
    });
}

    // En BookingService.ts

async getClientStats(clubId: number, userId: number) {
    // 1. Buscamos SOLO los turnos que realmente generan deuda (DEBT o PARTIAL)
    // EXCLUIMOS 'PENDING' para que las reservas web no sumen deuda automáticamente.
    const debtBookings = await prisma.booking.findMany({
      where: {
                clubId,
        userId,
        paymentStatus: {
          in: ['DEBT', 'PARTIAL'] // 👈 CLAVE: Solo estos estados suman deuda
        },
        status: { not: 'CANCELLED' }
      },
      include: {
        items: true,
        cashMovements: true // Necesitamos ver si hubo señas
      }
    });

    // 2. Calculamos la deuda real
    let totalDebt = 0;

    for (const booking of debtBookings) {
      // Precio cancha
      const courtPrice = Number(booking.price);
      
      // Precio productos/items extras
      const itemsPrice = booking.items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
      
      // Total que debería haber pagado
      const grandTotal = courtPrice + itemsPrice;

      // Total que YA pagó (señas o pagos parciales)
      const totalPaid = booking.cashMovements.reduce((sum, mov) => sum + Number(mov.amount), 0);

      // La deuda es la diferencia
      totalDebt += (grandTotal - totalPaid);
    }

    // 3. Contamos partidos jugados (Histórico)
    const totalBookings = await prisma.booking.count({
      where: {
                clubId,
        userId,
        status: 'COMPLETED'
      }
    });

    return {
      totalBookings,
      totalDebt: totalDebt > 0 ? totalDebt : 0 // Devolvemos 0 si no hay deuda
    };
}

    // apps/backend/src/services/BookingService.ts

async payBookingDebt(bookingId: number, paymentMethod: string) {

    // 1. Buscamos la reserva
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { cashMovements: true, items: true, court: { include: { club: true } } } 
    });

    if (!booking) throw new Error("Reserva no encontrada");

    // No permitir cobrar deuda de reservas canceladas
    if (booking.status === 'CANCELLED') {
        throw new Error("No se puede cobrar la deuda de una reserva cancelada");
    }

    const dbPrice = Number(booking.price);
    const itemsTotal = booking.items.reduce((acc, item) => acc + (Number(item.price) * item.quantity), 0);
    const grandTotal = dbPrice + itemsTotal;

    // Deuda en cuenta = deuda de cancha registrada (movimientos DEBT pendientes)
    // + ítems marcados como DEBT.
    const courtDebtInAccount = booking.cashMovements
        .filter((movement) => movement.type === 'INCOME' && movement.method === 'DEBT' && movement.isSettled === false)
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

    const itemsDebtInAccount = booking.items
        .filter((item) => item.paymentMethod === 'DEBT')
        .reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

    const debtAmount = courtDebtInAccount + itemsDebtInAccount;

    if (debtAmount <= 0.01) {
        throw new Error('No hay deuda en cuenta pendiente para esta reserva.');
    }

    const totalPaidBefore = booking.cashMovements
        .filter((movement) => movement.type === 'INCOME' && movement.method !== 'DEBT')
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

    const totalPaidAfter = totalPaidBefore + debtAmount;
    const remainingAfter = Math.max(0, grandTotal - totalPaidAfter);

    let nextPaymentStatus: PaymentStatus = PaymentStatus.DEBT;
    if (remainingAfter <= 0.01) nextPaymentStatus = PaymentStatus.PAID;
    else if (totalPaidAfter > 0.01) nextPaymentStatus = PaymentStatus.PARTIAL;

    // 7. Guardar Movimiento
    
    // Determinar clubId para no violar la FK; si no existe, lanzar error
    const clubIdForMovement = booking.court?.club?.id ?? null;
    if (!clubIdForMovement) {
        throw new Error('No se pudo determinar el club asociado a la reserva (clubId faltante)');
    }

    const normalizedPaymentMethod = paymentMethod === 'TRANSFER' ? 'TRANSFER' : 'CASH';

    const movement = await prisma.$transaction(async (tx) => {
        const createdMovement = await tx.cashMovement.create({
            data: {
                amount: debtAmount,
                type: 'INCOME',
                description: `Cobro deuda en cuenta reserva #${booking.id}`,
                method: normalizedPaymentMethod,
                bookingId: booking.id,
                clubId: clubIdForMovement,
                date: new Date()
            }
        });

        // Si había ítems marcados en DEBT, al saldar deuda quedan cobrados con el método elegido.
        await tx.bookingItem.updateMany({
            where: {
                bookingId: booking.id,
                paymentMethod: 'DEBT'
            },
            data: {
                paymentMethod: normalizedPaymentMethod
            }
        });

        // Si había movimientos de deuda de cancha/otros pendientes, quedan saldados.
        await tx.cashMovement.updateMany({
            where: {
                bookingId: booking.id,
                type: 'INCOME',
                method: 'DEBT',
                isSettled: false
            } as any,
            data: {
                isSettled: true
            }
        });

        // Recalculamos estado final según lo efectivamente pagado.
        await tx.booking.update({
            where: { id: bookingId },
            data: { paymentStatus: nextPaymentStatus }
        });

        return createdMovement;
    });

    return movement;
}

async registerSplitPayment(
    bookingId: number,
    userId: number,
    payments: Array<{ method: 'CASH' | 'TRANSFER' | 'DEBT'; amount: number }>,
    clubId?: number
) {
    if (!Array.isArray(payments) || payments.length === 0) {
        throw new Error('Debe enviar al menos un pago');
    }

    return prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
                court: { include: { club: true } },
                items: true,
                cashMovements: true
            }
        });

        if (!booking) throw new Error('Reserva no encontrada');
        if (clubId != null && booking.court.club.id !== clubId) {
            throw new Error('No tienes acceso a esta reserva');
        }
        if (booking.status === BookingStatus.CANCELLED) {
            throw new Error('No se puede cobrar una reserva cancelada');
        }
        if (booking.status === BookingStatus.COMPLETED) {
            throw new Error('No se puede modificar el cobro de una reserva finalizada');
        }

        const normalizedPayments = payments.map((payment) => ({
            method: payment.method,
            amount: Number(payment.amount)
        }));

        if (normalizedPayments.some((payment) => !Number.isFinite(payment.amount) || payment.amount <= 0)) {
            throw new Error('Todos los montos deben ser mayores a 0');
        }

        const { total, totalPaid, remaining } = this.calculateBookingFinancials(booking);
        const totalRequested = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);

        if (Math.abs(totalRequested - remaining) > 0.01) {
            throw new Error('La suma de pagos debe ser exactamente igual a la deuda pendiente');
        }

        const paidNow = normalizedPayments
            .filter((payment) => payment.method !== 'DEBT')
            .reduce((sum, payment) => sum + payment.amount, 0);

        for (const payment of normalizedPayments) {
            if (payment.method === 'DEBT') continue;

            await tx.cashMovement.create({
                data: {
                    date: new Date(),
                    type: 'INCOME',
                    amount: payment.amount,
                    description: `Cobro parcial Reserva #${booking.id} - ${booking.court.name}`,
                    method: payment.method,
                    bookingId: booking.id,
                    clubId: booking.court.club.id
                }
            });
        }

        const totalPaidAfter = totalPaid + paidNow;
        const remainingAfter = Math.max(0, total - totalPaidAfter);
        let nextPaymentStatus: PaymentStatus = PaymentStatus.DEBT;
        if (remainingAfter <= 0.01) nextPaymentStatus = PaymentStatus.PAID;
        else if (totalPaidAfter > 0) nextPaymentStatus = PaymentStatus.PARTIAL;

        const updated = await tx.booking.update({
            where: { id: booking.id },
            data: {
                status: booking.status === BookingStatus.PENDING ? BookingStatus.CONFIRMED : booking.status,
                paymentStatus: nextPaymentStatus
            }
        });

        return {
            booking: updated,
            summary: {
                total,
                paidBefore: totalPaid,
                paidNow,
                paidAfter: totalPaidAfter,
                remaining: remainingAfter
            }
        };
    });
}

async registerPartialPayment(
    bookingId: number,
    userId: number,
    amount: number,
    method: 'CASH' | 'TRANSFER',
    clubId?: number
) {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('El monto del pago parcial debe ser mayor a 0');
    }

    return prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
                court: { include: { club: true } },
                items: true,
                cashMovements: true
            }
        });

        if (!booking) throw new Error('Reserva no encontrada');
        if (clubId != null && booking.court.club.id !== clubId) {
            throw new Error('No tienes acceso a esta reserva');
        }
        if (booking.status === BookingStatus.CANCELLED) {
            throw new Error('No se puede cobrar una reserva cancelada');
        }
        if (booking.status === BookingStatus.COMPLETED) {
            throw new Error('No se puede modificar el cobro de una reserva finalizada');
        }

        const { total, totalPaid, remaining } = this.calculateBookingFinancials(booking);
        if (amount > remaining + 0.01) {
            throw new Error('El pago parcial supera la deuda pendiente');
        }

        await tx.cashMovement.create({
            data: {
                date: new Date(),
                type: 'INCOME',
                amount,
                description: `Cobro parcial Reserva #${booking.id} - ${booking.court.name}`,
                method,
                bookingId: booking.id,
                clubId: booking.court.club.id
            }
        });

        const totalPaidAfter = totalPaid + amount;
        const remainingAfter = Math.max(0, total - totalPaidAfter);
        let nextPaymentStatus: PaymentStatus = PaymentStatus.DEBT;
        if (remainingAfter <= 0.01) nextPaymentStatus = PaymentStatus.PAID;
        else if (totalPaidAfter > 0) nextPaymentStatus = PaymentStatus.PARTIAL;

        const updated = await tx.booking.update({
            where: { id: booking.id },
            data: {
                status: booking.status === BookingStatus.PENDING ? BookingStatus.CONFIRMED : booking.status,
                paymentStatus: nextPaymentStatus
            }
        });

        return {
            booking: updated,
            summary: {
                total,
                paidBefore: totalPaid,
                paidNow: amount,
                paidAfter: totalPaidAfter,
                remaining: remainingAfter,
                registeredBy: userId
            }
        };
    });
}

async registerCourtDebtPortion(
    bookingId: number,
    userId: number,
    amount: number,
    clubId?: number
) {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('El monto de deuda debe ser mayor a 0');
    }

    return prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
            where: { id: bookingId },
            include: {
                court: { include: { club: true } },
                items: true,
                cashMovements: true
            }
        });

        if (!booking) throw new Error('Reserva no encontrada');
        if (clubId != null && booking.court.club.id !== clubId) {
            throw new Error('No tienes acceso a esta reserva');
        }
        if (booking.status === BookingStatus.CANCELLED) {
            throw new Error('No se puede registrar deuda en una reserva cancelada');
        }
        if (booking.status === BookingStatus.COMPLETED) {
            throw new Error('No se puede modificar el cobro de una reserva finalizada');
        }

        const totalPaid = booking.cashMovements
            .filter((movement) => movement.type === 'INCOME' && movement.method !== 'DEBT')
            .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

        const itemsPaid = booking.items
            .filter((item) => {
                const paymentMethod = (item as unknown as { paymentMethod?: string | null }).paymentMethod;
                return Boolean(paymentMethod && paymentMethod !== 'DEBT');
            })
            .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

        const paidAvailableForCourt = Math.max(0, totalPaid - itemsPaid);
        const courtTotal = Number(booking.price || 0);
        const courtPaid = Math.min(courtTotal, paidAvailableForCourt);

        const existingCourtDebtRegistered = booking.cashMovements
            .filter((movement) => {
                if (movement.type !== 'INCOME') return false;
                if (movement.method !== 'DEBT') return false;
                if (movement.isSettled !== false) return false;
                const description = String(movement.description || '').toLowerCase();
                return description.startsWith('deuda cancha reserva #');
            })
            .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

        const maxCourtDebtRegisterable = Math.max(0, courtTotal - courtPaid - existingCourtDebtRegistered);
        if (amount > maxCourtDebtRegisterable + 0.01) {
            throw new Error('La deuda parcial de cancha supera el saldo disponible para dejar en cuenta');
        }

        await tx.cashMovement.create({
            data: {
                date: new Date(),
                type: 'INCOME',
                amount,
                description: `Deuda cancha reserva #${booking.id}`,
                method: 'DEBT',
                bookingId: booking.id,
                clubId: booking.court.club.id,
                userId: booking.userId ?? undefined,
                guestName: booking.guestName ?? undefined,
                guestPhone: booking.guestPhone ?? undefined,
                guestDni: booking.guestDni ?? undefined,
                isSettled: false
            }
        });

        const updated = await tx.booking.update({
            where: { id: booking.id },
            data: {
                status: booking.status === BookingStatus.PENDING ? BookingStatus.CONFIRMED : booking.status,
                paymentStatus: PaymentStatus.DEBT
            }
        });

        return {
            booking: updated,
            summary: {
                courtDebtRegisteredBefore: existingCourtDebtRegistered,
                courtDebtRegisteredNow: amount,
                courtDebtRegisteredAfter: existingCourtDebtRegistered + amount,
                registeredBy: userId
            }
        };
    });
}


async getClubDebtors(clubId: number) {
        const clubConfig = await prisma.club.findUnique({ where: { id: clubId }, include: { settings: true } });
        const defaultTimeZone = this.resolveClubConfig(clubConfig)?.timeZone ?? 'America/Argentina/Buenos_Aires';

    // 1. Prisma SELECT - Solo pedimos los datos que el Frontend necesita, ni un byte más.
    const bookings = await prisma.booking.findMany({
      where: {
                clubId
      },
      select: {
        id: true,
        userId: true,
        guestName: true,
        guestPhone: true,
        guestDni: true,
        guestEmail: true,
        price: true,
        status: true,
        paymentStatus: true,
        startDateTime: true,
                createdAt: true,
        user: {
          select: { firstName: true, lastName: true, phoneNumber: true, email: true, dni: true}
        },
        items: {
          // Acá mantenemos la corrección del producto
                    select: { price: true, quantity: true, paymentMethod: true, product: { select: { name: true } } }
        },
        cashMovements: {
                    select: { amount: true, type: true, method: true, description: true, isSettled: true }
        },
        court: {
          // 🌎 ACÁ VOLVEMOS A PEDIR EL TIMEZONE DEL CLUB
          select: { 
            name: true, 
            club: { 
              select: { timeZone: true } 
            } 
          } 
        }
      }
    });

        const extraSales: any[] = await prisma.cashMovement.findMany({
            where: {
                clubId,
                bookingId: null,
                type: 'INCOME',
                OR: [
                    { userId: { not: null } },
                    { guestDni: { not: null } },
                    { guestPhone: { not: null } },
                    { guestName: { not: null } }
                ]
            },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, dni: true }
                }
            },
            orderBy: { date: 'desc' }
        } as any);

    const clientsMap = new Map();

    for (const booking of bookings) {
      
      // --- LÓGICA DE AGRUPACIÓN (DNI > Teléfono > Nombre) ---
      let uniqueKey = "";
      let displayName = "";
      let displayPhone = "";
      let displayEmail = "";
      let displayDni = "";

      if (booking.userId && booking.user) {
        uniqueKey = `USER_${booking.userId}`;
        displayName = `${booking.user.firstName || ''} ${booking.user.lastName || ''}`.trim();
        displayPhone = booking.user.phoneNumber || "";
        displayEmail = booking.user.email || "";
        displayDni = booking.user.dni || "";
      } else {
        const guestDni = booking.guestDni?.trim();
        const guestPhone = booking.guestPhone?.trim();
        const guestName = booking.guestName?.trim();

        if (guestDni) uniqueKey = `GUEST_DNI_${guestDni}`;
        else if (guestPhone) uniqueKey = `GUEST_PHONE_${guestPhone}`;
        else if (guestName) uniqueKey = `GUEST_NAME_${guestName.toLowerCase()}`;
        else uniqueKey = `ANON_${booking.id}`;

        displayName = guestName || "Invitado";
        displayPhone = guestPhone || "";
        displayEmail = booking.guestEmail || "";
        displayDni = guestDni || "";
      }

      // --- INICIALIZAR EN EL MAPA ---
            if (!clientsMap.has(uniqueKey)) {
                clientsMap.set(uniqueKey, {
                    id: booking.userId || parseInt(uniqueKey.replace(/\D/g, '').substring(0, 8)) || Date.now(),
                    name: displayName || "Sin Nombre",
                    phone: displayPhone, 
                    email: displayEmail,
                    dni: displayDni,
                    // Añadimos `user` y `guestDni` para compatibilidad con el frontend
                    user: booking.user ? {
                        id: booking.userId,
                        firstName: booking.user.firstName,
                        lastName: booking.user.lastName,
                        phoneNumber: booking.user.phoneNumber,
                        email: booking.user.email,
                        dni: booking.user.dni
                    } : undefined,
                    guestDni: booking.guestDni || undefined,
                    totalDebt: 0,
                    totalBookings: 0, 
                    bookings: [], 
                    history: []   
                });
            }

      const client = clientsMap.get(uniqueKey);
      client.totalBookings++;

      // --- CÁLCULOS DE DINERO ---
      const courtPrice = Number(booking.price || 0);
      const itemsPrice = booking.items.reduce((acc, item) => acc + (Number(item.price) * item.quantity), 0);
      const total = courtPrice + itemsPrice;
            const paid = booking.cashMovements
                .filter((mov) => mov.type === 'INCOME' && mov.method !== 'DEBT')
                .reduce((acc, mov) => acc + Number(mov.amount), 0);

            const courtDebtInAccount = booking.cashMovements
                .filter((mov) => {
                    if (mov.type !== 'INCOME') return false;
                    if (mov.method !== 'DEBT') return false;
                    const description = String(mov.description || '').toLowerCase();
                    return description.startsWith('deuda cancha reserva #') && mov.isSettled === false;
                })
                .reduce((acc, mov) => acc + Number(mov.amount || 0), 0);

            const itemsDebtInAccount = booking.items
                .filter((item) => item.paymentMethod === 'DEBT')
                .reduce((acc, item) => acc + (Number(item.price) * item.quantity), 0);

            const debt = courtDebtInAccount + itemsDebtInAccount;
            const hasPendingDebt = debt > 0.01;

      // Usamos el TimeZone por defecto ya que no existe en la DB
      // 🌎 Lógica internacional lista para escalar
    const clubTimeZone = (booking.court as any)?.club?.timeZone ?? defaultTimeZone;
      const localStart = TimeHelper.utcToLocal(booking.startDateTime, clubTimeZone);
      const dateStr = `${localStart.getFullYear()}-${String(localStart.getMonth() + 1).padStart(2, '0')}-${String(localStart.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(localStart.getHours()).padStart(2, '0')}:${String(localStart.getMinutes()).padStart(2, '0')}`;

      // Armamos un objeto chiquito y perfecto
      const leanBookingView = {
        id: booking.id,
                sourceType: 'BOOKING',
                bookingId: booking.id,
        createdAt: booking.createdAt.toISOString(),
        date: dateStr,
        time: timeStr,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        courtName: booking.court.name,
        price: total,
        amount: debt,
        courtDebtInAccount,
        itemsDebtInAccount,
        paid: paid,
        items: booking.items.map(i => ({
            name: i.product?.name || 'Producto sin nombre', // 👈 Ajustado acá
            price: Number(i.price),
            quantity: i.quantity,
            paymentMethod: i.paymentMethod ?? null
        }))
      };

      // Guardamos la versión mini en el historial
      client.history.push(leanBookingView);

      if (hasPendingDebt) {
          client.totalDebt += debt;
          client.bookings.push(leanBookingView);
      }
    }

        for (const movement of extraSales) {
            const normalizedSaleDescription = String(movement.description || '')
                .replace(/^venta\s*:\s*/i, '')
                .trim() || 'Venta registrada en caja';

            let uniqueKey = "";
            let displayName = "";
            let displayPhone = "";
            let displayEmail = "";
            let displayDni = "";

            if (movement.userId && movement.user) {
                uniqueKey = `USER_${movement.userId}`;
                displayName = `${movement.user.firstName || ''} ${movement.user.lastName || ''}`.trim();
                displayPhone = movement.user.phoneNumber || "";
                displayEmail = movement.user.email || "";
                displayDni = movement.user.dni || "";
            } else {
                const guestDni = movement.guestDni?.trim();
                const guestPhone = movement.guestPhone?.trim();
                const guestName = movement.guestName?.trim();

                if (guestDni) uniqueKey = `GUEST_DNI_${guestDni}`;
                else if (guestPhone) uniqueKey = `GUEST_PHONE_${guestPhone}`;
                else if (guestName) uniqueKey = `GUEST_NAME_${guestName.toLowerCase()}`;
                else uniqueKey = `ANON_SALE_${movement.id}`;

                displayName = guestName || "Invitado";
                displayPhone = guestPhone || "";
                displayEmail = "";
                displayDni = guestDni || "";
            }

            if (!clientsMap.has(uniqueKey)) {
                clientsMap.set(uniqueKey, {
                    id: movement.userId || parseInt(uniqueKey.replace(/\D/g, '').substring(0, 8)) || Date.now(),
                    name: displayName || "Sin Nombre",
                    phone: displayPhone,
                    email: displayEmail,
                    dni: displayDni,
                    user: movement.user ? {
                        id: movement.user.id,
                        firstName: movement.user.firstName,
                        lastName: movement.user.lastName,
                        phoneNumber: movement.user.phoneNumber,
                        email: movement.user.email,
                        dni: movement.user.dni
                    } : undefined,
                    guestDni: movement.guestDni || undefined,
                    totalDebt: 0,
                    totalBookings: 0,
                    bookings: [],
                    history: []
                });
            }

            const client = clientsMap.get(uniqueKey);

            const localDate = TimeHelper.utcToLocal(movement.date, defaultTimeZone);
            const dateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;
            const timeStr = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;

            const saleView = {
                id: movement.id,
                sourceType: 'SALE',
                movementId: movement.id,
                createdAt: movement.date instanceof Date ? movement.date.toISOString() : new Date(movement.date).toISOString(),
                date: dateStr,
                time: timeStr,
                status: movement.isSettled ? 'COMPLETED' : 'PENDING',
                paymentStatus: movement.isSettled ? 'PAID' : 'DEBT',
                price: Number(movement.amount || 0),
                amount: movement.isSettled ? 0 : Number(movement.amount || 0),
                paid: movement.isSettled ? Number(movement.amount || 0) : 0,
                description: normalizedSaleDescription,
                items: []
            };

            client.history.push(saleView);

            if (movement.method === 'DEBT' && !movement.isSettled) {
                client.totalDebt += Number(movement.amount || 0);
                client.bookings.push(saleView);
            }
        }

        for (const client of clientsMap.values()) {
            const sortByCreatedAtDesc = (a: any, b: any) => {
                const aTime = new Date(a?.createdAt || 0).getTime();
                const bTime = new Date(b?.createdAt || 0).getTime();
                if (aTime !== bTime) return bTime - aTime;
                return Number(b?.id || 0) - Number(a?.id || 0);
            };

            client.history.sort(sortByCreatedAtDesc);
            client.bookings.sort(sortByCreatedAtDesc);
        }

    return Array.from(clientsMap.values()).sort((a: any, b: any) => {
        const debtA = Number(a?.totalDebt || 0);
        const debtB = Number(b?.totalDebt || 0);
        const isDebtorA = debtA > 0.01;
        const isDebtorB = debtB > 0.01;

        if (isDebtorA !== isDebtorB) {
            return isDebtorA ? -1 : 1;
        }

        if (isDebtorA && isDebtorB && debtA !== debtB) {
            return debtB - debtA;
        }

        return String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' });
    });
}

}