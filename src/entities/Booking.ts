import { User } from './User';
import { Court } from './Court';
import { ActivityType } from './ActivityType';
import { BookingStatus } from './Enums';

export class Booking {
    id: number;
    startDateTime: Date;
    endDateTime: Date;
    price: number;
    createdAt: Date;
    status: BookingStatus;
    cancelledBy?: number;
    cancelledAt?: Date;

    // Relaciones
    user: User;
    court: Court;
    activity: ActivityType;

    constructor(
        id: number,
        startDateTime: Date,
        endDateTime: Date,
        price: number,
        user: User,
        court: Court,
        activity: ActivityType,
        status: BookingStatus
    ) {
        this.id = id;
        this.startDateTime = startDateTime;
        this.endDateTime = endDateTime;
        this.price = price;
        this.user = user;
        this.court = court;
        this.activity = activity;
        this.status = status;
        this.createdAt = new Date();
    }
}

