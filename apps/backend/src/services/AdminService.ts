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

    async toggleCourtMaintenance(courtId: number, status: boolean) {
        const court = await this.clubRepo.findCourtById(courtId);
        if (!court) throw new Error("Cancha no encontrada");
        court.isUnderMaintenance = status;
        return court;
    }

    async updateActivityPrice(activityId: number, newPrice: number) {
        const activity = await this.activityRepo.findById(activityId);
        if(!activity) throw new Error("Actividad no encontrada");
        return activity;
    }

    async getAllBookingsForGrid(date: Date) {
        const all = await this.bookingRepo.findAll();
        return all.filter(b => b.startDateTime.getTime() === date.getTime());
    }

    async getDailyRevenueReport(date: Date): Promise<number> {
        const bookings = await this.bookingRepo.findAll();
        const bookingsDelDia = bookings.filter(b => 
            b.startDateTime.getTime() === date.getTime() && 
            b.status === BookingStatus.COMPLETED
        );
        const total = bookingsDelDia.reduce((sum, booking) => sum + booking.price, 0);
        return total;
    }

    async getMostPopularHours() {
    const bookings = await this.bookingRepo.findAll();
    const conteo: Record<string, number> = {};

    bookings.forEach(b => {
        const hours = b.startDateTime.getHours().toString().padStart(2, '0');
        const minutes = b.startDateTime.getMinutes().toString().padStart(2, '0');
        
        const timeKey = `${hours}:${minutes}`;

        if (conteo[timeKey]) {
            conteo[timeKey]++;
        } else {
            conteo[timeKey] = 1;
        }
    });

    return conteo;
}
}

