import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, forbidden, notFound } from '../errors';
import { recordUserClientLinkAuditTx } from './UserClientLinkAudit';

type LinkUserToClientInput = {
  clubId: number;
  clientId: string;
  userId: number;
  actorUserId: number;
};

type UnlinkUserFromClientInput = {
  clubId: number;
  clientId: string;
  actorUserId: number;
};

type MergeClientsInput = {
  clubId: number;
  sourceClientId: string;
  targetClientId: string;
  actorUserId: number;
  incidentId?: string | null;
  resolutionNotes?: string | null;
};

const mergeMarker = (value: string, targetName: string) => {
  const base = String(value || '').trim() || 'Cliente sin nombre';
  const destination = String(targetName || '').trim() || 'cliente destino';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base} [MERGED ${stamp} → ${destination}]`.slice(0, 120);
};

export class ClientIdentityAdminService {
  private async getClientByIdTx(tx: any, clientId: string) {
    const client = await tx.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        phone: true,
        email: true,
        dni: true,
        isProfessor: true,
      },
    });
    if (!client) throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);
    return client;
  }

  private async assertClientInClubTx(tx: any, clubId: number, clientId: string) {
    const client = await this.getClientByIdTx(tx, clientId);
    if (Number(client.clubId) !== Number(clubId)) {
      throw forbidden('El cliente no pertenece a este club.', ErrorCodes.CLIENT_OUT_OF_CLUB);
    }
    return client;
  }

  private async assertUserBelongsToClubTx(tx: any, clubId: number, userId: number) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw notFound('Usuario no encontrado', ErrorCodes.USER_NOT_FOUND);

    const [membership, linkedClient] = await Promise.all([
      tx.membership.findUnique({
        where: {
          userId_clubId: {
            userId: Number(userId),
            clubId: Number(clubId),
          },
        },
        select: { userId: true },
      }),
      tx.client.findFirst({
        where: {
          clubId: Number(clubId),
          userId: Number(userId),
        },
        select: { id: true },
      }),
    ]);

    if (!membership && !linkedClient) {
      throw forbidden('El usuario no pertenece a este club.', ErrorCodes.FORBIDDEN);
    }

    return user;
  }

  async linkUserToClient(input: LinkUserToClientInput) {
    return prisma.$transaction(async (tx) => {
      const client = await this.assertClientInClubTx(tx, input.clubId, input.clientId);
      await this.assertUserBelongsToClubTx(tx, input.clubId, input.userId);

      if (Number(client.userId || 0) === Number(input.userId)) {
        return tx.client.findUnique({ where: { id: client.id } });
      }

      if (client.userId && Number(client.userId) !== Number(input.userId)) {
        throw conflict(
          'El cliente ya está vinculado a otro usuario. Desvinculalo antes de volver a vincular.',
          ErrorCodes.CLIENT_LINK_CONFLICT,
          { linkedUserId: Number(client.userId) }
        );
      }

      const existingClientForUser = await tx.client.findFirst({
        where: {
          clubId: Number(input.clubId),
          userId: Number(input.userId),
          NOT: { id: client.id },
        },
        select: { id: true, name: true },
      });
      if (existingClientForUser?.id) {
        throw conflict(
          'El usuario ya está vinculado a otro cliente del club.',
          ErrorCodes.USER_CLIENT_LINK_EXISTS,
          {
            linkedClientId: existingClientForUser.id,
            linkedClientName: existingClientForUser.name,
          }
        );
      }

      const updated = await tx.client.update({
        where: { id: client.id },
        data: { userId: Number(input.userId) },
      });

      await recordUserClientLinkAuditTx(tx, {
        clubId: Number(input.clubId),
        userId: Number(input.userId),
        clientId: String(client.id),
        reason: 'MANUAL_ADMIN_LINK',
        source: 'CLIENT_PROFILE',
        actorUserId: Number(input.actorUserId),
      });

      return updated;
    });
  }

  async unlinkUserFromClient(input: UnlinkUserFromClientInput) {
    return prisma.$transaction(async (tx) => {
      const client = await this.assertClientInClubTx(tx, input.clubId, input.clientId);
      const linkedUserId = Number(client.userId || 0);
      if (!Number.isInteger(linkedUserId) || linkedUserId <= 0) {
        return tx.client.findUnique({ where: { id: client.id } });
      }

      const updated = await tx.client.update({
        where: { id: client.id },
        data: { userId: null },
      });

      await tx.auditLog.create({
        data: {
          clubId: Number(input.clubId),
          userId: Number(input.actorUserId),
          entity: 'CLIENT',
          entityId: String(client.id),
          action: 'USER_CLIENT_UNLINK',
          payload: {
            unlinkedUserId: linkedUserId,
            source: 'CLIENT_PROFILE',
          },
        },
      });

      return updated;
    });
  }

  async mergeClients(input: MergeClientsInput) {
    return prisma.$transaction(async (tx) => {
      const sourceClientId = String(input.sourceClientId || '').trim();
      const targetClientId = String(input.targetClientId || '').trim();

      if (!sourceClientId || !targetClientId) {
        throw badRequest('Faltan clientes para completar la fusión.', ErrorCodes.INVALID_INPUT);
      }
      if (sourceClientId === targetClientId) {
        throw conflict('No se puede fusionar un cliente consigo mismo.', ErrorCodes.CLIENT_MERGE_SAME_CLIENT);
      }

      const source = await this.assertClientInClubTx(tx, input.clubId, sourceClientId);
      const target = await this.assertClientInClubTx(tx, input.clubId, targetClientId);

      if (source.userId && target.userId && Number(source.userId) !== Number(target.userId)) {
        throw conflict(
          'Ambos clientes están vinculados a usuarios distintos. Desvinculá o resolvé el conflicto antes de fusionar.',
          ErrorCodes.CLIENT_LINK_CONFLICT,
          {
            sourceUserId: Number(source.userId),
            targetUserId: Number(target.userId),
          }
        );
      }

      const [sourceAssignments, targetAssignments] = await Promise.all([
        tx.clientDiscountAssignment.findMany({
          where: { clubId: Number(input.clubId), clientId: source.id },
          select: { policyId: true },
        }),
        tx.clientDiscountAssignment.findMany({
          where: { clubId: Number(input.clubId), clientId: target.id },
          select: { policyId: true },
        }),
      ]);

      const targetPolicyIds = new Set(targetAssignments.map((row: any) => String(row.policyId)));
      const conflictingPolicies = sourceAssignments
        .map((row: any) => String(row.policyId))
        .filter((policyId: string) => targetPolicyIds.has(policyId));

      if (conflictingPolicies.length > 0) {
        throw conflict(
          'Los clientes tienen descuentos asignados incompatibles. Revisalos antes de fusionar.',
          ErrorCodes.CLIENT_MERGE_CONFLICT,
          { conflictingPolicyIds: conflictingPolicies }
        );
      }

      const [bookingResult, fixedBookingResult, accountResult, discountResult, accountItemDiscountResult] =
        await Promise.all([
          tx.booking.updateMany({
            where: { clubId: Number(input.clubId), clientId: source.id },
            data: { clientId: target.id },
          }),
          tx.fixedBooking.updateMany({
            where: { clubId: Number(input.clubId), clientId: source.id },
            data: { clientId: target.id },
          }),
          tx.account.updateMany({
            where: { clubId: Number(input.clubId), clientId: source.id },
            data: { clientId: target.id },
          }),
          tx.clientDiscountAssignment.updateMany({
            where: { clubId: Number(input.clubId), clientId: source.id },
            data: { clientId: target.id },
          }),
          tx.accountItemDiscount.updateMany({
            where: { clubId: Number(input.clubId), clientId: source.id },
            data: { clientId: target.id },
          }),
        ]);

      await Promise.all([
        tx.clientDuplicateIncident.updateMany({
          where: { clubId: Number(input.clubId), primaryClientId: source.id },
          data: { primaryClientId: target.id },
        }),
        tx.clientDuplicateIncident.updateMany({
          where: { clubId: Number(input.clubId), resolvedClientId: source.id },
          data: { resolvedClientId: target.id },
        }),
      ]);

      const targetUserId = target.userId ? Number(target.userId) : null;
      const sourceUserId = source.userId ? Number(source.userId) : null;
      const nextTargetUserId = targetUserId || sourceUserId || null;

      const updatedTarget = await tx.client.update({
        where: { id: target.id },
        data: {
          userId: nextTargetUserId,
          isProfessor: Boolean(target.isProfessor || source.isProfessor),
        },
      });

      const archivedSource = await tx.client.update({
        where: { id: source.id },
        data: {
          name: mergeMarker(source.name, target.name),
          phone: null,
          email: null,
          dni: null,
          userId: null,
        },
      });

      if (input.incidentId) {
        const incident = await tx.clientDuplicateIncident.findFirst({
          where: {
            id: String(input.incidentId),
            clubId: Number(input.clubId),
          },
          select: { id: true, status: true },
        });
        if (incident?.id && String(incident.status) === 'OPEN') {
          await tx.clientDuplicateIncident.update({
            where: { id: incident.id },
            data: {
              status: 'RESOLVED',
              resolutionType: 'MERGE_CLIENTS',
              resolutionNotes: input.resolutionNotes ? String(input.resolutionNotes) : null,
              resolvedClientId: target.id,
              resolvedByUserId: Number(input.actorUserId),
              resolvedAt: new Date(),
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          clubId: Number(input.clubId),
          userId: Number(input.actorUserId),
          entity: 'CLIENT',
          entityId: String(target.id),
          action: 'CLIENTS_MERGED',
          payload: {
            sourceClientId: source.id,
            targetClientId: target.id,
            incidentId: input.incidentId ? String(input.incidentId) : null,
            moved: {
              bookings: Number(bookingResult.count || 0),
              fixedBookings: Number(fixedBookingResult.count || 0),
              accounts: Number(accountResult.count || 0),
              discountAssignments: Number(discountResult.count || 0),
              accountItemDiscounts: Number(accountItemDiscountResult.count || 0),
            },
            sourceUserId,
            targetUserId: nextTargetUserId,
            resolutionNotes: input.resolutionNotes ? String(input.resolutionNotes) : null,
          },
        },
      });

      return {
        sourceClient: archivedSource,
        targetClient: updatedTarget,
        moved: {
          bookings: Number(bookingResult.count || 0),
          fixedBookings: Number(fixedBookingResult.count || 0),
          accounts: Number(accountResult.count || 0),
          discountAssignments: Number(discountResult.count || 0),
          accountItemDiscounts: Number(accountItemDiscountResult.count || 0),
        },
      };
    });
  }
}
