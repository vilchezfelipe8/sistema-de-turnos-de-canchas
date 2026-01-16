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

export class BookingService {
    constructor(
        private bookingRepo: BookingRepository,
        private courtRepo: CourtRepository,
        private userRepo: UserRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    async createBooking(userId: number | null, guestIdentifier: string | undefined, courtId: number, startDateTime: Date, activityId: number): Promise<Booking> {
        let user: User | null = null;
        if (userId) {
            user = await this.userRepo.findById(userId);
            if (!user) throw new Error("Usuario no encontrado");
        } else {
            // Si no hay userId, requerimos guestIdentifier
            if (!guestIdentifier) throw new Error("Debe proveer guestIdentifier para reservas como invitado.");
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
                throw new Error(`El turno ${startDateTime.toISOString()} ya está ocupado.`);
            }

            const saved = await tx.booking.create({
                data: {
                    startDateTime,
                    endDateTime,
                    price: 1500,
                    status: BookingStatus.PENDING,
                    // userId puede ser null para invitado
                    userId: user ? user.id : undefined,
                    guestIdentifier: guestIdentifier,
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

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    // --- AGREGAR ESTOS LOGS ---
    console.log("---------------- DEBUG DISPONIBILIDAD ----------------");
    console.log("📅 Buscando para fecha (UTC):", startOfDay.toISOString());
    
    const existingBookings = await this.bookingRepo.findByCourtAndDateRange(courtId, startOfDay, endOfDay);
    
    
    console.log(`🔎 Encontradas ${existingBookings.length} reservas en total.`);
    existingBookings.forEach(b => {
        console.log(`   - ID: ${b.id} | Start: ${b.startDateTime.toISOString()} | Status: ${b.status}`);
    });
    console.log("------------------------------------------------------");
    // --------------------------    


    const possibleSlots = [
        "08:00", 
        "09:30", 
        "11:00", 
        "12:30", 
        "14:00", 
        "15:30", 
        // "17:00" -> SALTADO (Descanso de 17:00 a 17:30) ☕
        "17:30", 
        "19:00", 
        "20:30",
        "22:00"
    ];

    const duration = activity.defaultDurationMinutes; 

    const freeSlots = possibleSlots.filter(slotStart => {
        const slotEnd = TimeHelper.addMinutes(slotStart, duration);

        const [sh, sm] = slotStart.split(':').map(Number);
        const [eh, em] = slotEnd.split(':').map(Number);

        const slotStartDate = new Date(Date.UTC(year, month, day, sh, sm, 0));
        const slotEndDate = new Date(Date.UTC(year, month, day, eh, em, 0));

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

    async cancelBooking(bookingId: number, cancelledByUserId: number) {
        const booking = await this.bookingRepo.findById(bookingId);
        if (!booking) {
            throw new Error("La reserva no existe.");
        }
        await this.bookingRepo.delete(bookingId, cancelledByUserId);
        const updated = await this.bookingRepo.findById(bookingId);
        return updated;
    }

    async getUserHistory(userId: number) {
    const bookings = await this.bookingRepo.findByUserId(userId);
    const now = new Date();

    for (const booking of bookings) {
        const durationMinutes = 90; 
        
        const endTime = new Date(booking.startDateTime.getTime() + (durationMinutes * 60000));

        if (booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' && endTime < now) {
            
            // Actualizar en BD
            await prisma.booking.update({
                where: { id: booking.id },
                data: { status: BookingStatus.COMPLETED }
            });

            // Actualizar en memoria para que el usuario lo vea bien ya mismo
            booking.status = BookingStatus.COMPLETED;
        }
    }

    return bookings;
}

    async getDaySchedule(date: Date) {
        // Obtener todas las canchas activas (no en mantenimiento)
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        // Obtener todas las bookings del día
        const bookings = await this.bookingRepo.findAllByDate(date);

        // Slots posibles del día
        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // Crear grilla completa
        const schedule = [];

        console.log('Creando grilla para', activeCourts.length, 'canchas activas');

        for (const court of activeCourts) {
            for (const slotTime of possibleSlots) {
                // Parsear el slot time - crear fecha en UTC
                const [hours, minutes] = slotTime.split(':').map(Number);
                const slotDateTime = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

                // Buscar si hay una booking para esta cancha y hora
                // Comparar en UTC para evitar problemas de zona horaria
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
                    
                    if (courtMatch) {
                        console.log(`Cancha ${court.id} - Booking UTC: ${new Date(bookingUTCTime).toISOString()}, Slot UTC: ${slotDateTime.toISOString()}`);
                        console.log(`Time match: ${timeMatch}`);
                    }
                    
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

        // Ordenar por hora (slotTime) primero, luego por nombre de cancha
        schedule.sort((a, b) => {
            // Primero comparar por slotTime
            if (a.slotTime < b.slotTime) return -1;
            if (a.slotTime > b.slotTime) return 1;
            // Si son iguales, comparar por courtName
            if (a.courtName < b.courtName) return -1;
            if (a.courtName > b.courtName) return 1;
            return 0;
        });

        return schedule;
    }

    async getAllAvailableSlots(date: Date, activityId: number): Promise<string[]> {
        // Obtener todas las canchas activas
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);

        // Obtener todas las bookings del día
        const bookings = await this.bookingRepo.findAllByDate(date);

        // Slots posibles del día
        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // Encontrar slots donde al menos una cancha está disponible
        const availableSlots = possibleSlots.filter(slotTime => {
            // Parsear el slot time - crear fecha en UTC
            const [hours, minutes] = slotTime.split(':').map(Number);
            const slotDateTime = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0));

            // Verificar si al menos una cancha está disponible en este slot
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
                return !booking; // Disponible si no hay booking
            });

            return hasAvailableCourt;
        });

        return availableSlots;
    }

    async getAvailableSlotsWithCourts(date: Date, activityId: number): Promise<Array<{
        slotTime: string;
        availableCourts: Array<{
            id: number;
            name: string;
        }>;
    }>> {
        // 1. Logs para ver qué está pasando realmente (Detector de Mentiras)
        console.log("---------------- GRID DEBUG ----------------");
        console.log("📅 Fecha solicitada (UTC):", date.toISOString());
        
        // Obtener canchas y actividad
        const allCourts = await this.courtRepo.findAll();
        const activeCourts = allCourts.filter(court => !court.isUnderMaintenance);
        const bookings = await this.bookingRepo.findAllByDate(date);
        const activity = await this.activityRepo.findById(activityId);
        
        if (!activity) throw new Error("Actividad no encontrada");

        console.log(`🔎 Encontradas ${bookings.length} reservas para filtrar en la grilla.`);

        const possibleSlots = [
            "08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:30", "19:00", "20:30", "22:00"
        ];

        // 🔥 CORRECCIÓN CLAVE: Usamos getUTC para evitar el error de "día anterior"
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();

        const slotsWithCourts = possibleSlots.map(slotTime => {
            const [hours, minutes] = slotTime.split(':').map(Number);
            
            // Construimos la fecha del slot usando SOLO partes UTC
            const slotDateTime = new Date(Date.UTC(year, month, day, hours, minutes, 0));
            const durationMinutes = activity.defaultDurationMinutes;
            const slotEndDateTime = new Date(slotDateTime.getTime() + durationMinutes * 60000);

            // Filtrar canchas disponibles
            const availableCourts = activeCourts.filter(court => {
                const overlappingBooking = bookings.find(b => {
                    // Mismo ID de cancha
                    if (b.court.id !== court.id) return false;
                    
                    // Ignorar cancelados
                    if (b.status === "CANCELLED") return false; 
                    
                    // Aquí NO ignoramos COMPLETED porque si recien reservaste, 
                    // la fecha puede estar en el pasado inmediato y ser válida.

                    return TimeHelper.isOverlappingDates(
                        slotDateTime,
                        slotEndDateTime,
                        b.startDateTime,
                        b.endDateTime
                    );
                });
                
                // Si encontramos superposición, la cancha NO está disponible
                return !overlappingBooking;
            }).map(court => ({
                id: court.id,
                name: court.name
            }));

            // Lógica extra para devolver "courts" completos (si tu front lo usa)
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
        }).filter(slot => slot.availableCourts.length > 0); // Opcional: Filtra si no hay canchas

        console.log("--------------------------------------------");
        return slotsWithCourts;
    }

    async createFixedBooking(userId: number, courtId: number, activityId: number, startDateTime: Date, weeksToGenerate: number = 24) {

        // 1. Validaciones básicas
        const user = await this.userRepo.findById(userId);
        if (!user) throw new Error("Usuario no encontrado");

        const court = await this.courtRepo.findById(courtId);
        if (!court) throw new Error("Cancha no encontrada");

        // IMPORTANTE: Asegúrate de que el ID de actividad exista (el que vimos antes)
        const activity = await this.activityRepo.findById(activityId);
        // Si no tienes actividad, usamos una duración default de 60 mins para que no falle
        const duration = activity ? activity.defaultDurationMinutes : 60; 

        // 2. Preparar fechas límites para la consulta masiva
        const firstStart = new Date(startDateTime);
        const lastStart = new Date(firstStart);
        lastStart.setDate(firstStart.getDate() + (weeksToGenerate * 7)); // Fecha de la última semana
        const lastEnd = new Date(lastStart.getTime() + duration * 60000); // Límite final absoluto

        // 👇 INICIO DE LA TRANSACCIÓN
        return await prisma.$transaction(async (tx: any) => {
            
            // A. Crear el "Padre" (Turno Fijo)
            const fixedBooking = await tx.fixedBooking.create({
                data: {
                    userId,
                    courtId,
                    activityId,
                    startDate: firstStart,
                    dayOfWeek: firstStart.getDay(),
                    startTime: `${firstStart.getHours().toString().padStart(2, '0')}:${firstStart.getMinutes().toString().padStart(2, '0')}`,
                    endTime: `${new Date(firstStart.getTime() + duration * 60000).getHours().toString().padStart(2, '0')}:${new Date(firstStart.getTime() + duration * 60000).getMinutes().toString().padStart(2, '0')}`
                }
            });

            // B. OPTIMIZACIÓN: Traer TODOS los conflictos de una sola vez 🚀
            // En lugar de preguntar 24 veces, preguntamos 1 vez por todo el rango de fechas
            const existingBookings = await tx.booking.findMany({
                where: {
                    courtId,
                    status: { not: 'CANCELLED' },
                    startDateTime: { gte: firstStart }, // Desde el principio
                    endDateTime: { lte: lastEnd }       // Hasta el final de los 6 meses
                }
            });

            const bookingsToCreate = [];

            // C. Procesar en MEMORIA (Ultra rápido) ⚡
            for (let i = 0; i < weeksToGenerate; i++) {
                const currentStart = new Date(startDateTime);
                currentStart.setDate(startDateTime.getDate() + (i * 7));
                
                const currentEnd = new Date(currentStart.getTime() + duration * 60000);

                // Verificamos conflicto usando el array que ya trajimos (sin ir a la BD)
                const hasConflict = existingBookings.some((existing: any) => {
                    return (existing.startDateTime < currentEnd && existing.endDateTime > currentStart);
                });

                if (!hasConflict) {
                    bookingsToCreate.push({
                        startDateTime: currentStart,
                        endDateTime: currentEnd,
                        price: 1500, // O activity.price
                        status: 'CONFIRMED',
                        userId,
                        courtId,
                        activityId,
                        fixedBookingId: fixedBooking.id
                    });
                }
            }

            // D. Guardar todo junto en paralelo 
            // Usamos Promise.all para disparar todas las creaciones juntas
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
            timeout: 20000 // Mantenemos el timeout por seguridad
        });
    }
    async cancelFixedBooking(fixedBookingId: number) {
    const today = new Date();
    
    // Actualizamos todas las reservas futuras vinculadas a ese ID a "CANCELLED"
    // O directamente las borramos (deleteMany) si prefieres limpiar la grilla.
    
    await prisma.booking.updateMany({
        where: {
            fixedBookingId: fixedBookingId,
            startDateTime: { gte: today }, // Solo las futuras
            status: { not: 'CANCELLED' }
        },
        data: {
            status: 'CANCELLED'
        }
    });
    
    // Opcional: Marcar el FixedBooking como inactivo si le agregas un campo 'isActive'
    return { message: "Turno fijo cancelado de hoy en adelante" };
}
}

