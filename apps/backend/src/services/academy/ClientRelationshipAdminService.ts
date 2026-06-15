import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString } from './academyAdminUtils';

type ClientRelationshipTypeValue =
  | 'PARENT'
  | 'GUARDIAN'
  | 'CHILD'
  | 'PAYER'
  | 'FAMILY_MEMBER'
  | 'EMERGENCY_CONTACT'
  | 'OTHER';

type ClientRelationshipInput = {
  fromClientId: string;
  toClientId: string;
  relationshipType: ClientRelationshipTypeValue;
  canPayFor?: boolean;
  canManageEnrollments?: boolean;
  canViewSchedule?: boolean;
  canCancelClass?: boolean;
  canViewPayments?: boolean;
  notes?: string | null;
};

type ClientRelationshipSummary = {
  id: string;
  clubId: number;
  fromClientId: string;
  toClientId: string;
  relationshipType: string;
  canPayFor: boolean;
  canManageEnrollments: boolean;
  canViewSchedule: boolean;
  canCancelClass: boolean;
  canViewPayments: boolean;
  notes: string | null;
  fromClient: { id: string; name: string } | null;
  toClient: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export class ClientRelationshipAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private mapRow(row: any): ClientRelationshipSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      fromClientId: String(row.fromClientId),
      toClientId: String(row.toClientId),
      relationshipType: String(row.relationshipType),
      canPayFor: Boolean(row.canPayFor),
      canManageEnrollments: Boolean(row.canManageEnrollments),
      canViewSchedule: Boolean(row.canViewSchedule),
      canCancelClass: Boolean(row.canCancelClass),
      canViewPayments: Boolean(row.canViewPayments),
      notes: normalizeOptionalString(row.notes),
      fromClient: row.fromClient
        ? { id: String(row.fromClient.id), name: String(row.fromClient.name || '').trim() }
        : null,
      toClient: row.toClient
        ? { id: String(row.toClient.id), name: String(row.toClient.name || '').trim() }
        : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private async assertNoExactDuplicate(
    clubId: number,
    fromClientId: string,
    toClientId: string,
    relationshipType: ClientRelationshipTypeValue,
    relationshipId?: string
  ) {
    const existing = await prisma.clientRelationship.findFirst({
      where: {
        clubId,
        fromClientId,
        toClientId,
        relationshipType: relationshipType as any,
        ...(relationshipId ? { id: { not: relationshipId } } : {}),
      },
      select: { id: true },
    });
    if (existing?.id) {
      throw conflict('Esa relación ya existe para este club.', ErrorCodes.CONFLICT);
    }
  }

  private async validateInput(clubId: number, input: ClientRelationshipInput, relationshipId?: string) {
    const fromClientId = String(input.fromClientId || '').trim();
    const toClientId = String(input.toClientId || '').trim();
    if (!fromClientId || !toClientId) {
      throw badRequest('Revisá los clientes seleccionados.', ErrorCodes.INVALID_INPUT);
    }
    if (fromClientId === toClientId) {
      throw badRequest('La relación debe conectar dos clientes distintos.', ErrorCodes.INVALID_INPUT);
    }

    await Promise.all([
      this.validation.assertClientBelongsToClub(clubId, fromClientId),
      this.validation.assertClientBelongsToClub(clubId, toClientId),
      this.assertNoExactDuplicate(clubId, fromClientId, toClientId, input.relationshipType, relationshipId),
    ]);

    return {
      fromClientId,
      toClientId,
      relationshipType: input.relationshipType,
      canPayFor: Boolean(input.canPayFor),
      canManageEnrollments: Boolean(input.canManageEnrollments),
      canViewSchedule: Boolean(input.canViewSchedule),
      canCancelClass: Boolean(input.canCancelClass),
      canViewPayments: Boolean(input.canViewPayments),
      notes: normalizeOptionalString(input.notes),
    };
  }

  async listByClub(clubId: number, clientId?: string) {
    const safeClientId = normalizeOptionalString(clientId);
    if (safeClientId) {
      await this.validation.assertClientBelongsToClub(clubId, safeClientId);
    }

    const rows = await prisma.clientRelationship.findMany({
      where: {
        clubId,
        ...(safeClientId
          ? {
              OR: [{ fromClientId: safeClientId }, { toClientId: safeClientId }],
            }
          : {}),
      },
      include: {
        fromClient: { select: { id: true, name: true } },
        toClient: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapRow(row));
  }

  async create(clubId: number, input: ClientRelationshipInput) {
    const data = await this.validateInput(clubId, input);
    const created = await prisma.clientRelationship.create({
      data: {
        clubId,
        ...data,
      },
      include: {
        fromClient: { select: { id: true, name: true } },
        toClient: { select: { id: true, name: true } },
      },
    });
    return this.mapRow(created);
  }

  async update(clubId: number, relationshipId: string, input: Partial<ClientRelationshipInput>) {
    const existing = await prisma.clientRelationship.findFirst({
      where: { id: String(relationshipId), clubId },
      select: {
        id: true,
        fromClientId: true,
        toClientId: true,
        relationshipType: true,
        canPayFor: true,
        canManageEnrollments: true,
        canViewSchedule: true,
        canCancelClass: true,
        canViewPayments: true,
        notes: true,
      },
    });
    if (!existing) {
      throw notFound('Relación no encontrada.', ErrorCodes.CLIENT_RELATIONSHIP_NOT_FOUND);
    }

    const data = await this.validateInput(
      clubId,
      {
        fromClientId: input.fromClientId ?? existing.fromClientId,
        toClientId: input.toClientId ?? existing.toClientId,
        relationshipType: input.relationshipType ?? existing.relationshipType,
        canPayFor: input.canPayFor ?? existing.canPayFor,
        canManageEnrollments: input.canManageEnrollments ?? existing.canManageEnrollments,
        canViewSchedule: input.canViewSchedule ?? existing.canViewSchedule,
        canCancelClass: input.canCancelClass ?? existing.canCancelClass,
        canViewPayments: input.canViewPayments ?? existing.canViewPayments,
        notes: input.notes === undefined ? existing.notes : input.notes,
      },
      relationshipId
    );

    const updated = await prisma.clientRelationship.update({
      where: { id: String(relationshipId) },
      data,
      include: {
        fromClient: { select: { id: true, name: true } },
        toClient: { select: { id: true, name: true } },
      },
    });

    return this.mapRow(updated);
  }

  async remove(clubId: number, relationshipId: string) {
    const existing = await prisma.clientRelationship.findFirst({
      where: { id: String(relationshipId), clubId },
      select: { id: true },
    });
    if (!existing) {
      throw notFound('Relación no encontrada.', ErrorCodes.CLIENT_RELATIONSHIP_NOT_FOUND);
    }

    await prisma.clientRelationship.delete({
      where: { id: String(relationshipId) },
    });

    return { ok: true };
  }
}
