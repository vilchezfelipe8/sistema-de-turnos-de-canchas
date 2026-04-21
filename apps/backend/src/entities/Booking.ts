import { User } from './User';
import { Court } from './Court';
import { ActivityType } from './ActivityType';
import { BookingStatus } from './Enums';

export type BookingClient = {
    id: string;
    name: string;
    dni?: string | null;
    phone?: string | null;
    email?: string | null;
};

export class Booking {
    id: number;
    displayCode?: string | null;
    startDateTime: Date;
    endDateTime: Date;
    listPrice: number;
    price: number;
    createdAt: Date;
    status: BookingStatus;
    cancelledBy?: number;
    cancelledAt?: Date;

    user?: User | null;
    court: Court;
    activity: ActivityType;
    clientId: string;
    client?: BookingClient | null;

    constructor(
        id: number,
        startDateTime: Date,
        endDateTime: Date,
        price: number,
        user: User | null,
        court: Court,
        activity: ActivityType,
        status: BookingStatus,
        clientId: string,
        public fixedBookingId?: number | null,
        client?: BookingClient | null
    ) {
        this.id = id;
        this.startDateTime = startDateTime;
        this.endDateTime = endDateTime;
        this.listPrice = price;
        this.price = price;
        this.user = user || null;
        this.court = court;
        this.activity = activity;
        this.status = status;
        this.createdAt = new Date();
        this.clientId = clientId;
        this.client = client ?? null;
    }
}
