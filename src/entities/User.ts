import { Role } from './Enums';

export class User {
    constructor(
        public id: number,
        public firstName: string,
        public lastName: string,
        public email: string,
        public phoneNumber: string,
        public role: Role,
        public password?: string
    ) {}
}