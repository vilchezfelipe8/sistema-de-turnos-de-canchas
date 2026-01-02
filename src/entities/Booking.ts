import { User } from './User';
import { Court } from './Court';
import { ActivityType } from './ActivityType';
import { BookingStatus } from './Enums';

export class Booking {
    // Declaración de tipos
    id: number;
    date: Date;
    startTime: string; // "14:00"
    endTime: string;
    price: number;
    createdAt: Date;
    status: BookingStatus; // Usamos el Enum como tipo
    
    // Relaciones
    user: User;
    court: Court;
    activity: ActivityType;

    constructor(
        id: number,
        date: Date,
        startTime: string,
        endTime: string,
        price: number,
        user: User,
        court: Court,
        activity: ActivityType,
        status: BookingStatus
    ) {
        this.id = id;
        this.date = date;
        this.startTime = startTime;
        this.endTime = endTime;
        this.price = price;
        this.user = user;
        this.court = court;
        this.activity = activity;
        this.status = status;
        this.createdAt = new Date();
    }
}

