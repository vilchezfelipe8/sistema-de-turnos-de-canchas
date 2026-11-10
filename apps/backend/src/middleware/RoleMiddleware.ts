import { Request, Response, NextFunction } from 'express';
import { sendAuthError } from '../utils/authError';
import { prismaRead } from '../prisma';
import { isPiqueTeamUser } from '../config/piqueTeam';

type AnyRole = string;

const expandAcceptedTenantRoles = (roles: AnyRole[]) => {
    const accepted = new Set<string>();
    for (const role of roles) {
        accepted.add(role);
        if (role === 'ADMIN') {
            accepted.add('OWNER');
        }
    }
    return accepted;
};

const expandAcceptedGlobalRoles = (roles: AnyRole[]) => {
    return new Set(roles.map((role) => String(role)));
};

const ensureAuthenticated = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
        sendAuthError(res, 401, 'AUTH_MISSING', 'Acceso denegado. Falta autenticación.');
        return null;
    }
    return user;
};

export const requireClubMembership = (req: Request, res: Response, next: NextFunction) => {
    const user = ensureAuthenticated(req, res);
    if (!user) return;

    const clubId = Number((req as any).clubId || 0);
    const membershipRole = String((req as any).membershipRole || '').trim();
    if (!Number.isInteger(clubId) || clubId <= 0 || !membershipRole) {
        return sendAuthError(
            res,
            403,
            'AUTH_FORBIDDEN',
            'No tienes membresía activa en el club seleccionado.'
        );
    }

    return next();
};

export const requireTenantRole = (role: string | string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = ensureAuthenticated(req, res);
        if (!user) return;

        const requestedRoles = Array.isArray(role) ? role : [role];
        const acceptedRoles = expandAcceptedTenantRoles(requestedRoles);
        const membershipRole = String((req as any).membershipRole || '').trim();

        if (!membershipRole) {
            return sendAuthError(
                res,
                403,
                'AUTH_FORBIDDEN',
                'No tienes membresía activa en el club seleccionado.'
            );
        }

        if (acceptedRoles.has(membershipRole)) {
            return next();
        }

        return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'Permisos insuficientes.');
    };
};

export const requireGlobalRole = (role: string | string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = ensureAuthenticated(req, res);
        if (!user) return;

        const requestedRoles = Array.isArray(role) ? role : [role];
        const acceptedRoles = expandAcceptedGlobalRoles(requestedRoles);
        const userRole = String(user.role || '').trim();

        if (acceptedRoles.has(userRole)) {
            return next();
        }

        return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'Permisos insuficientes.');
    };
};

/**
 * Herramientas de plataforma (ven datos de todos los clubes): solo equipo de Pique.
 * Rol global ADMIN + email en PIQUE_TEAM_EMAILS. Un dueño de club no alcanza.
 */
export const requirePiqueTeam = async (req: Request, res: Response, next: NextFunction) => {
    const user = ensureAuthenticated(req, res);
    if (!user) return;
    try {
        const userId = Number(user.userId ?? user.id);
        const record = Number.isInteger(userId) && userId > 0
            ? await prismaRead.user.findUnique({ where: { id: userId }, select: { role: true, email: true } })
            : null;
        if (isPiqueTeamUser(record)) return next();
    } catch {
        // Ante la duda, cerrado.
    }
    return sendAuthError(res, 403, 'AUTH_FORBIDDEN', 'Permisos insuficientes.');
};

/**
 * Alias temporal de compatibilidad.
 * Mantiene el contrato existente pero ahora valida contra rol de membresía tenant.
 */
export const requireRole = requireTenantRole;
