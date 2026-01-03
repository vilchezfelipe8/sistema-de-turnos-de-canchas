import { Court } from './Court';

export class Club {
    public courts: Court[] = [];

    constructor(
        public id: number,
        public name: string,
        public address: string,
        public contactInfo: string
    ) {}
}

