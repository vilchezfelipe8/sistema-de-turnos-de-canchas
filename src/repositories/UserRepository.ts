import { prisma } from '../prisma';
import { User } from '../entities/User';

export class UserRepository {

    async findById(id: number) {
        const user = await prisma.user.findUnique({
            where: { id: id }
        });
        // Si no encuentra user, retornamos null
        if (!user) return null;

        // Convertimos el Rol con 'as any' para evitar el error de tipos
        return new User(
            user.id, 
            user.firstName, 
            user.lastName, 
            user.email, 
            user.phoneNumber, 
            user.role as any, // <--- FIX 1: 'as any'
            user.password     // <--- FIX 2: Pasamos la password
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
            user.role as any, // <--- FIX 1
            user.password     // <--- FIX 2
        );
    }

    async save(user: User): Promise<User> {
        const saved = await prisma.user.create({
            data: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role, // Aquí Prisma lo acepta bien
                // Si no trae password, ponemos una por defecto para que no explote
                password: user.password || '$2a$10$generico...' 
            }
        });
        
        return new User(
            saved.id, 
            saved.firstName, 
            saved.lastName, 
            saved.email, 
            saved.phoneNumber, 
            saved.role as any, // <--- AQUÍ ESTABA TU ERROR (agregamos 'as any')
            saved.password     // <--- Y pasamos la password al final
        );
    }
}