import { prisma } from '../prisma';
import { User } from '../entities/User';
import { Role } from '../entities/Enums';

export class UserRepository {
    async findById(id: number) {
        const user = await prisma.user.findUnique({
            where: { id: id }
        });
        if (!user) return null;

        return new User(
            user.id,
            user.firstName,
            user.lastName,
            user.email,
            user.phoneNumber,
            user.role as Role,
            user.password
        );
    }

    async findByEmail(email: string) {
        const user = await prisma.user.findUnique({
            where: { email: email }
        });
        if (!user) return null;

        return new User(
            user.id,
            user.firstName,
            user.lastName,
            user.email,
            user.phoneNumber,
            user.role as Role,
            user.password
        );
    }

    async save(user: User): Promise<User> {
        const saved = await prisma.user.create({
            data: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role,
                password: user.password || '$2a$10$generico...'
            }
        });

        return new User(
            saved.id,
            saved.firstName,
            saved.lastName,
            saved.email,
            saved.phoneNumber,
            saved.role as Role,
            saved.password
        );
    }
}