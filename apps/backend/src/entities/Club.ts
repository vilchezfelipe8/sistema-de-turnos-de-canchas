import { Court } from './Court';

export class Club {
    public courts: Court[] = [];

    constructor(
        public id: number,
        public slug: string,
        public name: string,
        public address: string,
        public contactInfo: string,
        public phone?: string,
        public logoUrl?: string,
        public instagramUrl?: string,
        public facebookUrl?: string,
        public websiteUrl?: string,
        public description?: string,
        public createdAt?: Date,
        public updatedAt?: Date
    ) {}
}

