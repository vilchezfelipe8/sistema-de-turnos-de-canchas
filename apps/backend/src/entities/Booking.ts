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
    user?: User | null;
    court: Court;
    activity: ActivityType;
    guestIdentifier?: string;

    constructor(
        id: number,
        startDateTime: Date,
        endDateTime: Date,
        price: number,
        user: User | null,
        court: Court,
        activity: ActivityType,
        status: BookingStatus,
        guestIdentifier?: string
    ) {
        this.id = id;
        this.startDateTime = startDateTime;
        this.endDateTime = endDateTime;
        this.price = price;
        this.user = user || null;
        this.court = court;
        this.activity = activity;
        this.status = status;
        this.createdAt = new Date();
        if (guestIdentifier) this.guestIdentifier = guestIdentifier;
    }
}

