import { ClubRepository } from '../repositories/ClubRepository';
import { BookingRepository } from '../repositories/BookingRepository';
import { ActivityTypeRepository } from '../repositories/ActivityTypeRepository';
import { BookingStatus } from '../entities/Enums';

export class AdminService {
    constructor(
        private clubRepo: ClubRepository,
        private bookingRepo: BookingRepository,
        private activityRepo: ActivityTypeRepository
    ) {}

    // REGLA: Poner cancha en Mantenimiento
    async toggleCourtMaintenance(courtId: number, status: boolean) {
        const court = await this.clubRepo.findCourtById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        
        court.isUnderMaintenance = status;
        // Acá deberías guardar en repo si usaras BD real
        return court;
    }

    // REGLA: Modificar precios o duración (Inflación)
    async updateActivityPrice(activityId: number, newPrice: number) { // Nota: Precio está en Booking ahora, pero si estuviera en Activity
        // Suponiendo que ActivityType tuviera precio base
        const activity = await this.activityRepo.findById(activityId);
        if(!activity) throw new Error("Actividad no encontrada");
        // activity.basePrice = newPrice;
        return activity;
    }

    // REGLA: Ver TODAS las reservas (Grilla completa)
    async getAllBookingsForGrid(date: Date) {
        // En realidad aquí filtrarías por fecha global, simplificamos trayendo todo
        const all = await this.bookingRepo.findAll();
        // Filtramos solo las de ese día
        return all.filter(b => b.date.getTime() === date.getTime());
    }

    // REGLA: Reporte de Facturación del Día
    async getDailyRevenueReport(date: Date): Promise<number> {
        const bookings = await this.bookingRepo.findAll();
        
        const bookingsDelDia = bookings.filter(b => 
            b.date.getTime() === date.getTime() && 
            b.status === BookingStatus.COMPLETED // Solo sumamos las jugadas/pagadas
        );

        // Sumar precios
        const total = bookingsDelDia.reduce((sum, booking) => sum + booking.price, 0);
        return total;
    }

    // REGLA: Reporte de Horarios más solicitados
    async getMostPopularHours() {
        const bookings = await this.bookingRepo.findAll();
        const conteo: Record<string, number> = {};

        bookings.forEach(b => {
            if (conteo[b.startTime]) {
                conteo[b.startTime]++;
            } else {
                conteo[b.startTime] = 1;
            }
        });

        // Retorna objeto tipo { "18:00": 5, "19:00": 8 }
        return conteo;
    }
}