import { MembershipRole } from '@prisma/client';
import { AppError, ErrorCodes, forbidden, notFound, validationError } from '../errors';
import { prisma } from '../prisma';
import { AuditLogService } from './AuditLogService';
import { normalizeEmail } from '../utils/magicLink';

type ManageMembershipInput = {
  clubId: number;
  actorUserId: number;
};

type InviteMemberInput = ManageMembershipInput & {
  email: string;
  role: MembershipRole;
};

type UpdateRoleInput = ManageMembershipInput & {
  membershipId: string;
  role: MembershipRole;
};

type RemoveMemberInput = ManageMembershipInput & {
  membershipId: string;
};

const STAFF_MANAGED_ROLES = new Set<MembershipRole>(['STAFF']);
const OWNER_MANAGED_ROLES = new Set<MembershipRole>(['OWNER', 'ADMIN', 'STAFF']);
const OWNER_ASSIGNABLE_ROLES = new Set<MembershipRole>(['OWNER', 'ADMIN', 'STAFF']);
const ADMIN_ASSIGNABLE_ROLES = new Set<MembershipRole>(['STAFF']);
const LISTED_ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const;
const MANAGED_ROLES = new Set<MembershipRole>(['OWNER', 'ADMIN', 'STAFF']);

const ensurePositiveInt = (value: number, fallback: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw validationError('Revisá los campos marcados.', {
      general: fallback
    });
  }
};

const membershipRoleValidationError = () =>
  new AppError({
    statusCode: 400,
    code: ErrorCodes.MEMBERSHIP_ROLE_INVALID,
    message: 'Revisá los campos marcados.',
    fieldErrors: {
      role: 'Seleccioná un rol válido para el staff del club.'
    }
  });

const buildMembershipResponse = (membership: any) => ({
  id: String(membership.id),
  clubId: Number(membership.clubId),
  userId: Number(membership.userId),
  role: String(membership.role),
  createdAt: membership.createdAt,
  status: 'ACTIVE' as const,
  user: membership.user
    ? {
        id: Number(membership.user.id),
        email: String(membership.user.email || ''),
        firstName: String(membership.user.firstName || ''),
        lastName: String(membership.user.lastName || '')
      }
    : null
});

export class MembershipAdminService {
  private readonly auditLogService = new AuditLogService();

  private ensureManagedRole(role: MembershipRole) {
    if (!MANAGED_ROLES.has(role)) {
      throw membershipRoleValidationError();
    }
  }

  private async getActorMembershipTx(tx: any, clubId: number, actorUserId: number) {
    const membership = await tx.membership.findUnique({
      where: {
        userId_clubId: {
          userId: actorUserId,
          clubId
        }
      },
      select: {
        id: true,
        userId: true,
        clubId: true,
        role: true
      }
    });

    if (!membership) {
      throw forbidden('No tenés permisos para gestionar miembros de este club.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      throw forbidden('No tenés permisos para gestionar miembros de este club.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    return membership;
  }

  private ensureActorCanAssign(actorRole: MembershipRole, nextRole: MembershipRole) {
    if (actorRole === 'OWNER') {
      if (OWNER_ASSIGNABLE_ROLES.has(nextRole)) return;
      throw forbidden('No tenés permisos para asignar ese rol.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    if (actorRole === 'ADMIN') {
      if (ADMIN_ASSIGNABLE_ROLES.has(nextRole)) return;
      throw forbidden('Solo el owner puede asignar ese rol.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    throw forbidden('No tenés permisos para gestionar miembros de este club.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
  }

  private ensureActorCanManageTarget(actorRole: MembershipRole, targetRole: MembershipRole) {
    if (actorRole === 'OWNER') {
      if (OWNER_MANAGED_ROLES.has(targetRole)) return;
      throw forbidden('No tenés permisos para gestionar esta membresía.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    if (actorRole === 'ADMIN') {
      if (STAFF_MANAGED_ROLES.has(targetRole)) return;
      throw forbidden('Solo el owner puede gestionar este rol.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
    }

    throw forbidden('No tenés permisos para gestionar miembros de este club.', ErrorCodes.MEMBERSHIP_FORBIDDEN);
  }

  private async ensureNotLastOwnerTx(tx: any, clubId: number, membershipId: string) {
    const ownerCount = await tx.membership.count({
      where: {
        clubId,
        role: 'OWNER'
      }
    });

    if (ownerCount <= 1) {
      throw new AppError({
        statusCode: 409,
        code: ErrorCodes.MEMBERSHIP_LAST_OWNER,
        message: 'No podés dejar al club sin owner.'
      });
    }

    return membershipId;
  }

  async listMembers(input: ManageMembershipInput) {
    ensurePositiveInt(input.clubId, 'Club inválido.');
    ensurePositiveInt(input.actorUserId, 'Usuario inválido.');

    return prisma.$transaction(async (tx) => {
      await this.getActorMembershipTx(tx, input.clubId, input.actorUserId);

      const memberships = await tx.membership.findMany({
        where: {
          clubId: input.clubId,
          role: { in: [...LISTED_ROLES] }
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }]
      });

      return memberships.map(buildMembershipResponse);
    });
  }

  async inviteMember(input: InviteMemberInput) {
    ensurePositiveInt(input.clubId, 'Club inválido.');
    ensurePositiveInt(input.actorUserId, 'Usuario inválido.');
    this.ensureManagedRole(input.role);
    const email = normalizeEmail(input.email);
    if (!email) {
      throw validationError('Revisá los campos marcados.', {
        email: 'Ingresá un email válido.'
      });
    }

    return prisma.$transaction(async (tx) => {
      const actorMembership = await this.getActorMembershipTx(tx, input.clubId, input.actorUserId);
      this.ensureActorCanAssign(actorMembership.role, input.role);

      const user = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });

      if (!user) {
        throw new AppError({
          statusCode: 404,
          code: ErrorCodes.USER_NOT_FOUND,
          message: 'No existe un usuario registrado con ese email.',
          fieldErrors: {
            email: 'El usuario debe registrarse primero para recibir acceso al club.'
          }
        });
      }

      const existingMembership = await tx.membership.findUnique({
        where: {
          userId_clubId: {
            userId: user.id,
            clubId: input.clubId
          }
        }
      });

      if (existingMembership) {
        throw new AppError({
          statusCode: 409,
          code: ErrorCodes.MEMBERSHIP_ALREADY_EXISTS,
          message: 'Ese usuario ya tiene acceso a este club.',
          fieldErrors: {
            email: 'Ese usuario ya tiene acceso a este club.'
          }
        });
      }

      const created = await tx.membership.create({
        data: {
          userId: user.id,
          clubId: input.clubId,
          role: input.role
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      await this.auditLogService.create({
        clubId: input.clubId,
        userId: input.actorUserId,
        entity: 'MEMBERSHIP',
        entityId: String(created.id),
        action: 'MEMBERSHIP_INVITED',
        payload: {
          membershipId: created.id,
          invitedUserId: user.id,
          invitedEmail: user.email,
          role: created.role
        }
      });

      return buildMembershipResponse(created);
    });
  }

  async updateMemberRole(input: UpdateRoleInput) {
    ensurePositiveInt(input.clubId, 'Club inválido.');
    ensurePositiveInt(input.actorUserId, 'Usuario inválido.');
    this.ensureManagedRole(input.role);

    return prisma.$transaction(async (tx) => {
      const actorMembership = await this.getActorMembershipTx(tx, input.clubId, input.actorUserId);
      const membership = await tx.membership.findUnique({
        where: { id: input.membershipId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      if (!membership || Number(membership.clubId) !== input.clubId) {
        throw notFound('Membresía no encontrada.', ErrorCodes.MEMBERSHIP_NOT_FOUND);
      }

      this.ensureActorCanManageTarget(actorMembership.role, membership.role);
      this.ensureActorCanAssign(actorMembership.role, input.role);

      if (membership.role === 'OWNER' && input.role !== 'OWNER') {
        await this.ensureNotLastOwnerTx(tx, input.clubId, membership.id);
      }

      if (String(membership.role) === String(input.role)) {
        return buildMembershipResponse(membership);
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: input.role },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      await this.auditLogService.create({
        clubId: input.clubId,
        userId: input.actorUserId,
        entity: 'MEMBERSHIP',
        entityId: String(updated.id),
        action: 'MEMBERSHIP_ROLE_UPDATED',
        payload: {
          membershipId: updated.id,
          userId: updated.userId,
          fromRole: membership.role,
          toRole: updated.role
        }
      });

      return buildMembershipResponse(updated);
    });
  }

  async removeMember(input: RemoveMemberInput) {
    ensurePositiveInt(input.clubId, 'Club inválido.');
    ensurePositiveInt(input.actorUserId, 'Usuario inválido.');

    return prisma.$transaction(async (tx) => {
      const actorMembership = await this.getActorMembershipTx(tx, input.clubId, input.actorUserId);
      const membership = await tx.membership.findUnique({
        where: { id: input.membershipId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      if (!membership || Number(membership.clubId) !== input.clubId) {
        throw notFound('Membresía no encontrada.', ErrorCodes.MEMBERSHIP_NOT_FOUND);
      }

      this.ensureActorCanManageTarget(actorMembership.role, membership.role);

      if (membership.role === 'OWNER') {
        await this.ensureNotLastOwnerTx(tx, input.clubId, membership.id);
      }

      await tx.membership.delete({
        where: { id: membership.id }
      });

      await this.auditLogService.create({
        clubId: input.clubId,
        userId: input.actorUserId,
        entity: 'MEMBERSHIP',
        entityId: String(membership.id),
        action: 'MEMBERSHIP_REMOVED',
        payload: {
          membershipId: membership.id,
          userId: membership.userId,
          role: membership.role
        }
      });

      return {
        success: true as const,
        membershipId: String(membership.id)
      };
    });
  }
}
