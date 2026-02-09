import { BookingRepository } from '../repositories/BookingRepository';
import { ClubRepository } from '../repositories/ClubRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { Booking } from '../entities/Booking';
import { BookingStatus } from '../entities/Enums';
import { TimeHelper } from '../utils/TimeHelper';
import { CourtRepository } from '../repositories/CourtRepository';
import { prisma } from '../prisma';
import { User } from '../entities/User';
import { Club } from '../entities/Club';
import { Court as CourtEntity } from '../entities/Court';
import { ActivityType } from '../entities/ActivityType';
import { PrismaClient } from '@prisma/client';
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
        allowGuestWithoutContact = false
    ): Promise<Booking> {
        let user: User | null = null;
        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else {
            // Si no hay userId, requerimos guestIdentifier salvo excepción administrativa
            if (!guestIdentifier && !allowGuestWithoutContact) {
                throw new Error("Debe proveer guestIdentifier para reservas como invitado.");
            }
            if (!guestName) throw new Error("Debe proveer un nombre para reservas como invitado.");
            if (!allowGuestWithoutContact && !guestEmail && !guestPhone) {
                throw new Error("Debe proveer un email o teléfono para reservas como invitado.");
            }
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        if (court.isUnderMaintenance) throw new Error("Cancha en mantenimiento");

        const activity = await this.activityRepo.findById(activityId);
        if (!activity) throw new Error("Actividad no existe");

        const endDateTime = new Date(startDateTime.getTime() + activity.defaultDurationMinutes * 60000);

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
                    price: 28000,
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

    if (booking.status === BookingStatus.CONFIRMED) {
        try {
            const price = 28000;

            if (price > 0) {
                await this.cashRepository.create({
                    date: new Date(),
                    type: 'EXPENSE', // 🔴 Registramos un GASTO (Salida)
                    amount: price,
                    description: `Anulación Reserva #${bookingId} (${booking.court.name})`,
                    method: 'CASH', // Asumimos devolución en efectivo por defecto
                    bookingId: bookingId
                });
                console.log(`📉 Caja ajustada: -$${price} por cancelación de reserva #${bookingId}`);
            }
        } catch (error) {
            console.error("⚠️ Error al registrar devolución en caja:", error);
            // No detenemos la cancelación, solo avisamos.
        }
    }

    // 2. Ahora sí, procedemos a cancelar (Soft Delete o cambio de estado)
    await this.bookingRepo.delete(bookingId, cancelledByUserId);
    
    const updated = await this.bookingRepo.findById(bookingId);
    return updated;
}
    async confirmBooking(bookingId: number, userId: number, paymentMethod: string = 'CASH') { 
    
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new Error("La reserva no existe.");
    // ... validaciones ...

    // 1. Actualizamos estado
    const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CONFIRMED },
        include: { user: true, court: { include: { club: true } }, activity: true }
    });

    // 2. Registramos en CAJA con el método elegido
    if (paymentMethod !== 'DEBT') { 
        try {
            const price = 28000;
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
        console.log("📝 Reserva confirmada como 'En Cuenta' (No ingresa dinero a caja).");
    }

    return this.bookingRepo.mapToEntity(updated);
}

    async getUserHistory(userId: number) {
        const bookings = await this.bookingRepo.findByUserId(userId);
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
        }>;
    }>> {
        const allCourts = await this.courtRepo.findAll(clubId);
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);
        const bookings = await this.bookingRepo.findAllByDate(date);
        const activity = await this.activityRepo.findById(activityId);
        
        if (!activity) throw new Error("Actividad no encontrada");

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        const slotsWithCourts = possibleSlots.map(slotTime => {
            const slotDateTime = TimeHelper.localSlotToUtc(date, slotTime);
            const durationMinutes = activity.defaultDurationMinutes;
            const slotEndDateTime = new Date(slotDateTime.getTime() + durationMinutes * 60000);

            const availableCourts = activeCourts.filter(court => {
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
                name: court.name
            }));

            const courtsWithAvailability = activeCourts.map(court => {
                 const isBusy = bookings.some(b => 
                    b.court.id === court.id && 
                    b.status !== "CANCELLED" &&
                    TimeHelper.isOverlappingDates(slotDateTime, slotEndDateTime, b.startDateTime, b.endDateTime)
                 );
                 return {
                    id: court.id,
                    name: court.name,
                    isAvailable: !isBusy
                 };
            });

            return {
                slotTime,
                availableCourts,
                courts: courtsWithAvailability
            };
        }).filter(slot => slot.availableCourts.length > 0); 

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
        clubId?: number
    ) {
        const safePhone = guestPhone ? String(guestPhone) : undefined;

        // 1. Validaciones básicas
        if (userId) {
            const user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else if (!guestName) {
            throw new Error("Debe proveer un nombre para reservas fijas como invitado.");
        }

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        
        if (clubId && court.club.id !== clubId) {
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
                    bookingsToCreate.push({
                        startDateTime: currentStart,
                        endDateTime: currentEnd,
                        price: 28000, 
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

   async addItemToBooking(bookingId: number, productId: number, quantity: number, paymentMethod: string = 'CASH') {
    // 👆 Agregué paymentMethod como opcional (por defecto CASH) para futuro uso

    return await this.prisma.$transaction(async (tx) => {
        // 1. Buscamos el producto
        const product = await tx.product.findUnique({ where: { id: productId } });
        
        if (!product) throw new Error("Producto no encontrado");
        if (product.stock < quantity) throw new Error(`Stock insuficiente. Quedan ${product.stock}`);

        const unitPrice = Number(product.price);
        const totalPrice = unitPrice * quantity;

        // 2. Creamos el Item en la Reserva
        const item = await tx.bookingItem.create({
            data: {
                bookingId,
                productId,
                quantity,
                price: unitPrice 
            }
        });

        // 3. Descontamos Stock
        await tx.product.update({
            where: { id: productId },
            data: { stock: product.stock - quantity }
        });

        // 4. 👇 ¡LA MAGIA DE LA CAJA! (Todo dentro de la misma transacción)
        await tx.cashMovement.create({
            data: {
                date: new Date(),
                type: 'INCOME',   // Es un Ingreso
                amount: totalPrice,
                description: `Venta Extra: ${quantity}x ${product.name} (Turno #${bookingId})`,
                method: paymentMethod, // 'CASH', 'TRANSFER', etc.
                bookingId: bookingId
            }
        });

        return item;
    });
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

    async updatePaymentStatus(id: number, status: 'PAID' | 'DEBT') {
    return this.prisma.booking.update({
        where: { id },
        data: { paymentStatus: status }
    });
    }

    async getClientStats(clubId?: number) {
        const where: any = { status: { not: 'CANCELLED' } };
        if (clubId != null) {
            where.court = { clubId };
        }
        const bookings = await this.prisma.booking.findMany({
            where,
            include: {
                user: true,
                court: true,
                items: { include: { product: true } }
            },
            orderBy: { startDateTime: 'desc' }
        });

        // 2. Agrupamos por persona
        const clientsMap: any = {};

        // Función auxiliar para convertir "fELiPe" en "Felipe" (Capitalizar)
        const capitalize = (str: string) => {
        if (!str) return '';
        return str.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
    };

    for (const booking of bookings) {
        // 1. Detectamos el nombre base para mostrar
        const rawName = booking.user 
            ? `${booking.user.firstName} ${booking.user.lastName}` 
            : (booking.guestName || 'Cliente Sin Nombre');

        // 2. 👇 NUEVA LÓGICA DE IDENTIFICACIÓN (KEY)
        let clientKey = '';
        let dniDisplay = booking.guestDni || '-'; // Para mostrar en la tabla luego

        if (booking.userId) {
            // A: Es Usuario Registrado (Usamos su ID y su DNI si lo tuviera en perfil)
            clientKey = `u_${booking.userId}`;
        } else if (booking.guestDni) {
            // B: Es Invitado pero TIENE DNI (Usamos el DNI como clave única)
            clientKey = `d_${booking.guestDni}`;
        } else {
            // C: LEGACY (Reservas viejas sin DNI). Usamos nombre normalizado.
            // Esto evita que desaparezcan los datos viejos.
            const cleanName = rawName.trim().toLowerCase();
            clientKey = `n_${cleanName}`;
        }

        // 3. Inicializamos si no existe
        if (!clientsMap[clientKey]) {
            clientsMap[clientKey] = {
                id: clientKey,
                name: capitalize(rawName),
                dni: dniDisplay, // 👈 Guardamos el DNI para enviarlo al front
                phone: booking.user ? booking.user.phoneNumber : booking.guestPhone,
                totalBookings: 0,
                totalDebt: 0,
                lastVisit: booking.startDateTime,
                bookings: []
            };
        }

            const client = clientsMap[clientKey];

            // ... (El resto de la lógica de precios y push sigue IGUAL) ...
            
            const courtPrice = Number(booking.price) || 0; 
            const itemsTotal = booking.items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
            const bookingTotal = courtPrice + itemsTotal;

            client.totalBookings += 1;

            if (booking.paymentStatus === 'DEBT') {
                client.totalDebt += bookingTotal;
            }
            
            client.bookings.push({
                id: booking.id,
                date: booking.startDateTime,
                total: bookingTotal,
                courtName: booking.courtId,
                paymentStatus: booking.paymentStatus,
                items: booking.items
            });

            if (new Date(booking.startDateTime) > new Date(client.lastVisit)) {
                client.lastVisit = booking.startDateTime;
            }
        }

        return Object.values(clientsMap).sort((a: any, b: any) => {
            if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt; 
            return b.totalBookings - a.totalBookings; 
        });
    }
}