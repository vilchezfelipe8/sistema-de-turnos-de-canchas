import { MembershipRole } from '@prisma/client';
import { prisma } from '../prisma';

export type UserClubContext = {
    clubId: number;
    role: MembershipRole;
};

export const getUserClubContext = async (userId: number, preferredClubId?: number): Promise<UserClubContext> => {
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('userId inválido');
    }

    if (preferredClubId != null) {
        const scopedMembership = await prisma.membership.findUnique({
            where: {
                userId_clubId: {
                    userId,
                    clubId: preferredClubId
                }
            },
            select: {
                clubId: true,
                role: true
            }
        });

        if (scopedMembership) {
            return { clubId: scopedMembership.clubId, role: scopedMembership.role };
        }
    }

    const memberships = await prisma.membership.findMany({
        where: { userId },
        select: { clubId: true, role: true }
    });

    if (memberships.length === 1) {
        return memberships[0];
    }

    if (memberships.length > 1) {
        throw new Error('Debe seleccionar un club activo');
    }

    throw new Error('No se pudo resolver el club del usuario');
};
