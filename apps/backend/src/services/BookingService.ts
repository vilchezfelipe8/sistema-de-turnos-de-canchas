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
import { PrismaClient, PaymentStatus, BookingStatus } from '@prisma/client';
import { CashRepository } from '../repositories/CashRepository';
import { ProductRepository } from '../repositories/ProductRepository';

export class BookingService {

    private prisma = new PrismaClient();

    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository,
        private cashRepository: CashRepository,
        private productRepository: ProductRepository
    ) {}

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
        isProfessorOverride: boolean = false
    ): Promise<Booking> {
        let user: User | null = null;
        if (userId) {
        user = await this.userRepo.findById(userId);
        if (!user) throw new Error("Usuario no encontrado");
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

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");

        const endDateTime = new Date(startDateTime.getTime() + activity.defaultDurationMinutes * 60000);

    // Calcular precio base y extra por luces según configuración del club
        const BASE_PRICE = Number((court as any)?.price ?? 0);
        if (!Number.isFinite(BASE_PRICE) || BASE_PRICE <= 0) {
            throw new Error('Precio de cancha no configurado.');
        }
        const clubConfig = court.club as any;
        const isProfessor = Boolean(user?.isProfessor) || Boolean(isProfessorOverride);
        let finalPrice = BASE_PRICE;

        if (isProfessor && clubConfig?.professorDiscountEnabled) {
            const discountPercent = Number(clubConfig?.professorDiscountPercent ?? 0);
            if (Number.isFinite(discountPercent) && discountPercent > 0) {
                const clamped = Math.min(Math.max(discountPercent, 0), 100);
                finalPrice = BASE_PRICE * (1 - clamped / 100);
            }
        }
        if (clubConfig && clubConfig.lightsEnabled && clubConfig.lightsExtraAmount && clubConfig.lightsFromHour) {
            try {
                const [lh, lm] = String(clubConfig.lightsFromHour).split(':').map((n: string) => parseInt(n, 10));
                if (!Number.isNaN(lh) && !Number.isNaN(lm)) {
                    const bookingHour = startDateTime.getHours();
                    const bookingMinutes = startDateTime.getMinutes();
                    const bookingTotalMinutes = bookingHour * 60 + bookingMinutes;
                    const lightsTotalMinutes = lh * 60 + lm;
                    if (bookingTotalMinutes >= lightsTotalMinutes) {
                        finalPrice += Number(clubConfig.lightsExtraAmount);
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

            const saved = await tx.booking.create({
                data: {
                    startDateTime,
                    endDateTime,
                    price: finalPrice,
                    status: BookingStatus.PENDING,
                    // userId puede ser null para invitado
                    userId: user ? user.id : undefined,
                    guestIdentifier: guestIdentifier,
                    guestName: guestName,
                    guestEmail: guestEmail,
                    guestPhone: guestPhone,
                    guestDni: guestDni,
                    courtId: courtId,
                    activityId: activityId
                },
                include: { user: true, court: { include: { club: true } }, activity: true }
            });

            return saved;
        });

        return this.bookingRepo.mapToEntity(created);
    }

    async getAvailableSlots(courtId: number, date: Date, activityId: number): Promise<string[]> {
        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no encontrada");

        const { startUtc: startOfDay, endUtc: endOfDay } = TimeHelper.getUtcRangeForLocalDate(date);

        const existingBookings = await this.bookingRepo.findByCourtAndDateRange(courtId, startOfDay, endOfDay);

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        const now = new Date();
        const upcomingSlots = possibleSlots.filter((slotTime) => {
            try {
                const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);
                return slotDateTime.getTime() > now.getTime();
            } catch {
                return false;
            }
        });

        const duration = activity.defaultDurationMinutes; 

        const freeSlots = possibleSlots.filter(slotStart => {
            const slotEnd = TimeHelper.addMinutes(slotStart, duration);

            const slotStartDate = TimeHelper.localSlotToUtc(date, slotStart);
            const slotEndDate = TimeHelper.localSlotToUtc(date, slotEnd);

            const isOccupied = existingBookings.some(booking => {
                if (booking.status === "CANCELLED") return false; 

                return TimeHelper.isOverlappingDates(
                    slotStartDate, 
                    slotEndDate, 
                    booking.startDateTime, 
                    booking.endDateTime
                );
            });

            return !isOccupied;
        });

        return freeSlots;
    }

   async cancelBooking(bookingId: number, cancelledByUserId: number, clubId?: number) {
        // 1. Buscamos la reserva
        const booking = await this.bookingRepo.findById(bookingId);
        
        if (!booking) {
            throw new Error("La reserva no existe.");
        }
        
        // Si hay clubId, verificar que la reserva pertenece al club
        if (clubId && booking.court.club.id !== clubId) {
            throw new Error("No tienes acceso a esta reserva");
        }

        // 👇 CORRECCIÓN DEFINITIVA DE CAJA 👇
        // Buscamos cuánto pagó REALMENTE el cliente por esta reserva en el registro de caja
        const bookingWithPayments = await this.prisma.booking.findUnique({
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
        
        const updated = await this.bookingRepo.findById(bookingId);
        return updated;
    }
    
    async confirmBooking(bookingId: number, userId: number, paymentMethod: string = 'CASH') {
    
    // 1. Buscamos la reserva
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new Error("La reserva no existe.");

    const paymentStatus = paymentMethod === 'DEBT' 
    ? PaymentStatus.DEBT
    : PaymentStatus.PAID;

    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { 
            status: BookingStatus.CONFIRMED, // La cancha está ocupada
            paymentStatus: paymentStatus,    // <--- ACÁ SE GENERA LA DEUDA O EL PAGO
            // Opcional: Si tenés una columna para guardar el método en la reserva:
            // paymentMethod: paymentMethod 
        },
        include: { user: true, court: { include: { club: true } }, activity: true }
    });

    // 4. Lógica de CAJA (Solo entra plata si NO es deuda)
    if (paymentMethod !== 'DEBT') {
        try {
            const price = Number(updated.price || 0);
            if (price > 0) {
                await this.cashRepository.create({
                    date: new Date(),
                    type: 'INCOME',
                    amount: price,
                    description: `Cobro Turno #${updated.id} - ${updated.court.name}`,
                    method: paymentMethod, 
                    bookingId: updated.id
                });
            }
        } catch (error) {
            console.error("⚠️ Error caja:", error);
        }
    } else {
        // Log para control
        console.log(`📝 Deuda registrada al cliente ${updated.guestName} por Reserva #${updated.id}`);
    }

    return this.bookingRepo.mapToEntity(updated);
}

    async getUserHistory(userId: number) {
        const bookings = await prisma.booking.findMany({
            where: { userId },
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
        // Obtener canchas activas (no en mantenimiento)
        let allCourts;
        if (clubId) {
            allCourts = await prisma.court.findMany({
                where: { clubId, isUnderMaintenance: false },
                include: { club: true, activities: true }
            });
        } else {
            allCourts = await this.courtRepo.findAll();
        }
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        // 2. Buscamos directo con Prisma para incluir los PRODUCTOS
       const bookings = await prisma.booking.findMany({
    where: {
        startDateTime: {
            gte: startOfDay,
            lte: endOfDay
        },
        // Si hay clubId, filtramos por ese club
        ...(clubId ? { court: { clubId: clubId } } : {}),
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

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        const schedule = [];

        for (const court of activeCourts) {
            for (const slotTime of possibleSlots) {
                const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);

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

                schedule.push({
                    courtId: court.id,
                    courtName: court.name,
                    slotTime: slotTime,
                    startDateTime: slotDateTime.toISOString(),
                    isAvailable: !booking,
                    booking: booking || null
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

    async getAllAvailableSlots(date: Date, activityId: number): Promise<string[]> {
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);
        const bookings = await this.bookingRepo.findAllByDate(date);

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        const availableSlots = possibleSlots.filter(slotTime => {
            const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);
            const hasAvailableCourt = activeCourts.some(court => {
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
            return hasAvailableCourt;
        });

        return availableSlots;
    }

    async getAvailableSlotsWithCourts(date: Date, activityId: number, clubId?: number): Promise<Array<{
        slotTime: string;
        availableCourts: Array<{
            id: number;
            name: string;
            price?: number | null;
        }>;
    }>> {
        const allCourts = await this.courtRepo.findAll(clubId);
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);
        const bookings = await this.bookingRepo.findAllByDate(date);
        const activity = await this.activityRepo.findById(activityId);
        
        if (!activity) throw new Error("Actividad no encontrada");

        const activityCourts = activeCourts.filter((court: any) =>
            Array.isArray(court.activities) && court.activities.some((act: any) => act.id === activityId)
        );

        if (activityCourts.length === 0) {
            return [];
        }

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        const now = new Date();
        const upcomingSlots = possibleSlots.filter((slotTime: string) => {
            try {
                const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);
                return slotDateTime.getTime() > now.getTime();
            } catch {
                return false;
            }
        });

        const slotsWithCourts = upcomingSlots.map((slotTime: string) => {
            const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);
            const durationMinutes = activity.defaultDurationMinutes;
            const slotEndDateTime = new Date(slotDateTime.getTime() + durationMinutes * 60000);

            const availableCourts = activityCourts.filter(court => {
                const overlappingBooking = bookings.find(b => {
                    if (b.court.id !== court.id) return false;
                    if (b.status === "CANCELLED") return false; 
                    
                    return TimeHelper.isOverlappingDates(
                        slotDateTime,
                        slotEndDateTime,
                        b.startDateTime,
                        b.endDateTime
                    );
                });
                
                return !overlappingBooking;
            }).map(court => ({
                id: court.id,
                name: court.name,
                price: (court as any).price ?? null
            }));

                const courtsWithAvailability = activityCourts.map(court => {
                 const isBusy = bookings.some(b => 
                    b.court.id === court.id && 
                    b.status !== "CANCELLED" &&
                    TimeHelper.isOverlappingDates(slotDateTime, slotEndDateTime, b.startDateTime, b.endDateTime)
                 );
                 return {
                    id: court.id,
                    name: court.name,
                          price: (court as any).price ?? null,
                    isAvailable: !isBusy
                 };
            });

            return {
                slotTime,
                availableCourts,
                courts: courtsWithAvailability
            };
        }).filter((slot: { availableCourts: Array<unknown> }) => slot.availableCourts.length > 0); 

        return slotsWithCourts;
    }

    async createFixedBooking(
        userId: number | null,
        courtId: number,
        activityId: number,
        startDateTime: Date,
        weeksToGenerate: number = 24,
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
        const duration = activity ? activity.defaultDurationMinutes : 60; 

        const startTime = `${startDateTime.getHours().toString().padStart(2, '0')}:${startDateTime.getMinutes().toString().padStart(2, '0')}`;
        const endTime = `${new Date(startDateTime.getTime() + duration * 60000).getHours().toString().padStart(2, '0')}:${new Date(startDateTime.getTime() + duration * 60000).getMinutes().toString().padStart(2, '0')}`;
        const dayOfWeek = startDateTime.getDay();

        // 👇 CORRECCIÓN 1: FILTRAR SOLO LOS ACTIVOS (NO CANCELADOS)
        const existingFixed = await prisma.fixedBooking.findMany({
            where: {
                courtId,
                dayOfWeek,
                status: { not: 'CANCELLED' } // Importante: Ignora los dados de baja
            }
        });

        const overlapsFixed = existingFixed.some((fixed) =>
            TimeHelper.isOverlapping(startTime, endTime, fixed.startTime, fixed.endTime)
        );

        if (overlapsFixed) {
            throw new Error("Ya existe un turno fijo en ese horario para esta cancha.");
        }

        // 2. Preparar fechas límites
        const firstStart = new Date(startDateTime);
        const lastStart = new Date(firstStart);
        lastStart.setDate(firstStart.getDate() + (weeksToGenerate * 7));
        const lastEnd = new Date(lastStart.getTime() + duration * 60000);

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
                    startDate: firstStart,
                    dayOfWeek,
                    startTime,
                    endTime,
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
            for (let i = 0; i < weeksToGenerate; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * 7));
                
                const currentEnd = new Date(currentStart.getTime() + duration * 60000);

                const hasConflict = existingBookings.some((existing: any) => {
                    return (existing.startDateTime < currentEnd && existing.endDateTime > currentStart);
                });

                if (!hasConflict) {
                    const basePrice = Number((court as any)?.price ?? 0);
                    if (!Number.isFinite(basePrice) || basePrice <= 0) {
                        throw new Error('Precio de cancha no configurado.');
                    }
                    const clubConfig = (court as any)?.club;
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
                        status: 'CONFIRMED',
                        ...(userId ? { userId } : {}),
                        ...(guestName ? { guestName } : {}),
                        ...(safePhone ? { guestPhone: safePhone } : {}), // Guardar teléfono en cada reserva hija
                        ...(guestDni ? { guestDni } : {}), // Guardar DNI en cada reserva hija
                        courtId,
                        activityId,
                        fixedBookingId: fixedBooking.id
                    });
                }
            }

            // D. Guardar hijos
            if (bookingsToCreate.length > 0) {
                await Promise.all(bookingsToCreate.map((data) => tx.booking.create({ data })));
            }

            return { 
                fixedBookingId: fixedBooking.id, 
                generatedCount: bookingsToCreate.length,
                msg: `Se crearon ${bookingsToCreate.length} turnos confirmados.`
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
                ...(clubId ? {
                    court: {
                        clubId: clubId
                    }
                } : {})
            },
            data: {
                status: 'CANCELLED'
            }
        });
        
        return { message: "Turno fijo cancelado de hoy en adelante" };
    }

    // 👇 AGREGÁ ESTO PARA VER QUÉ CONSUMIERON
    async getBookingItems(bookingId: number) {
        return await this.prisma.bookingItem.findMany({
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
        return await this.prisma.$transaction(async (tx) => {
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
    const booking = await this.prisma.booking.findUnique({
        where: { id },
        include: { court: true } // Necesitamos esto para el clubId
    });

    if (!booking) throw new Error("Reserva no encontrada");

    // 2. LÓGICA DE CAJA AUTOMÁTICA 💰
    // Si el nuevo estado es PAGADO y antes NO lo era... ¡Cobramos la cancha!
    if (status === 'PAID' && booking.paymentStatus !== 'PAID') {
        
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
    return this.prisma.booking.update({
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
        court: {
            clubId: clubId
        },
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
        court: {
            clubId: clubId
        },
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
        include: { cashMovements: true, items: true } 
    });

    if (!booking) throw new Error("Reserva no encontrada");

    // 2. DIAGNÓSTICO: Ver qué trae la base de datos
    const dbPrice = Number(booking.price);

    // 3. Calcular Pagos (Sumamos solo movimientos positivos tipo INCOME)
    const totalPaid = booking.cashMovements
        .filter(m => m.type === 'INCOME') // Aseguramos no restar devoluciones si las hubiera
        .reduce((acc, mov) => acc + Number(mov.amount), 0);
    
    // 4. Calcular Items
    const itemsTotal = booking.items.reduce((acc, item) => acc + (Number(item.price) * item.quantity), 0);

    // 5. Calcular GRAN TOTAL
    // IMPORTANTE: Asumimos que booking.price es SOLO la cancha.
    const grandTotal = dbPrice + itemsTotal; 

    // 6. Calcular DEUDA REAL
    let debtAmount = grandTotal - totalPaid;


    
    if (debtAmount <= 0) {
        console.log("Error: La deuda es 0 o negativa.");
        throw new Error("Esta reserva ya figura como pagada.");
    }

    // 7. Guardar Movimiento
    
    const movement = await prisma.cashMovement.create({
        data: {
            amount: debtAmount,
            type: 'INCOME',
            description: `Saldo final reserva #${booking.id} (Cancha + Consumos)`, 
            method: paymentMethod,
            bookingId: booking.id,
            date: new Date()
        }
    });

    // 8. Actualizar Reserva a PAGADO
    await prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: 'PAID' } // No tocamos el campo 'paid' porque no existe
    });

    return movement;
}


async getClubDebtors(clubId: number) {
    // 1. Traemos TODAS las reservas del club (incluyendo CANCELLED para conservar historial)
    const bookings = await prisma.booking.findMany({
      where: {
        court: { clubId: clubId }
      },
      include: {
        user: true, 
        items: {
            include: {
                product: true // 👈 ESTO TRAE EL NOMBRE (Coca, Gatorade, etc.)
            }
        },
        cashMovements: true, // Esto es vital para que veas los pagos anteriores
        court: true
      }
    });

    // 2. Mapa para agrupar clientes
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
          // Datos básicos del cliente
          id: booking.userId || parseInt(uniqueKey.replace(/\D/g, '').substring(0, 8)) || Date.now(),
          name: displayName || "Sin Nombre",
          phone: displayPhone, 
          email: displayEmail,
          dni: displayDni,
          
          // Contadores
          totalDebt: 0,
          totalBookings: 0, 
          bookings: [], // Lista de reservas con deuda (compatibilidad hacia el front actual)
          history: []   // Historial completo de reservas (incluye CANCELLED, PAID, etc.)
        });
      }

      const client = clientsMap.get(uniqueKey);
      client.totalBookings++; // Sumamos al historial (aunque no deba nada)

      // --- CÁLCULOS DE DINERO ---
      const courtPrice = Number(booking.price);
      const itemsPrice = booking.items.reduce((acc, item) => acc + (Number(item.price) * item.quantity), 0);
      const total = courtPrice + itemsPrice;
      const paid = booking.cashMovements.reduce((acc, mov) => acc + Number(mov.amount), 0);
      const debt = total - paid;
      
      // Verificamos si es una deuda real (DEBT/PARTIAL y > 0)
      const isDebtStatus = ['DEBT', 'PARTIAL'].includes(booking.paymentStatus);
      const hasPendingDebt = isDebtStatus && debt > 0;

      const fechaObj = new Date(booking.startDateTime);
      const bookingView = {
        ...booking, // 👈 Manda cashMovements, items, etc.

        // Sobreescribimos/Agregamos los campos calculados que necesita el frontend visualmente
        date: fechaObj.toISOString().split('T')[0],
        time: fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        
        courtName: booking.court.name, // Helper visual
        
        // Valores calculados
        price: total,       // Total original (Cancha + Items)
        amount: debt,       // Lo que falta pagar (Deuda)
        paid: paid          // Lo que ya se pagó
      };

      // Siempre agregamos al historial completo
      client.history.push(bookingView);

      // Si hay deuda, también lo agregamos a la lista de "A pagar"
      if (hasPendingDebt) {
          client.totalDebt += debt;
          client.bookings.push(bookingView);
      }
    }

    return Array.from(clientsMap.values());
}

}