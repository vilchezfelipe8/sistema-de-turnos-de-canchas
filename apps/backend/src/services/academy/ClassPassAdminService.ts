import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString, parseDateTimeOrThrow } from './academyAdminUtils';

type ClassPassClassTypeValue = 'INDIVIDUAL' | 'GROUP';
type ClassPassStatusValue = 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'CANCELLED';

type CreateClassPassInput = {
  ownerClientId: string;
  ownerUserId?: number | null;
  beneficiaryClientId: string;
  beneficiaryUserId?: number | null;
  packageName: string;
  totalCredits: number;
  expiresAt?: string | Date | null;
  activityTypeId?: number | null;
  classType?: ClassPassClassTypeValue | null;
  teacherId?: string | null;
  transferable?: boolean;
  notes?: string | null;
};

type UpdateClassPassInput = {
  packageName?: string | null;
  expiresAt?: string | Date | null;
  activityTypeId?: number | null;
  classType?: ClassPassClassTypeValue | null;
  teacherId?: string | null;
  transferable?: boolean;
  notes?: string | null;
};

type ClassPassSummary = {
  id: string;
  clubId: number;
  ownerClientId: string;
  ownerUserId: number | null;
  beneficiaryClientId: string;
  beneficiaryUserId: number | null;
  packageName: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  expiresAt: string | null;
  activityTypeId: number | null;
  classType: string | null;
  teacherId: string | null;
  transferable: boolean;
  status: string;
  purchasedAt: string;
  notes: string | null;
  createdByUserId: number;
  ownerClient: { id: string; name: string } | null;
  beneficiaryClient: { id: string; name: string } | null;
  ownerUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  beneficiaryUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  activityType: { id: number; name: string } | null;
  teacher: { id: string; displayName: string; isActive: boolean } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export class ClassPassAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private effectiveStatus(row: { status: string; expiresAt?: Date | string | null; remainingCredits?: number | null }) {
    const remainingCredits = Number(row.remainingCredits ?? 0);
    if (String(row.status) === 'CANCELLED') return 'CANCELLED' as const;
    if (remainingCredits <= 0 || String(row.status) === 'DEPLETED') return 'DEPLETED' as const;
    if (row.expiresAt) {
      const expiresAt = new Date(row.expiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
        return 'EXPIRED' as const;
      }
    }
    return 'ACTIVE' as const;
  }

  private mapRow(row: any): ClassPassSummary {
    const ownerUserId =
      row.ownerUserId === null || row.ownerUserId === undefined ? null : Number(row.ownerUserId);
    const beneficiaryUserId =
      row.beneficiaryUserId === null || row.beneficiaryUserId === undefined ? null : Number(row.beneficiaryUserId);
    const activityTypeId =
      row.activityTypeId === null || row.activityTypeId === undefined ? null : Number(row.activityTypeId);

    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      ownerClientId: String(row.ownerClientId),
      ownerUserId: Number.isFinite(ownerUserId ?? Number.NaN) ? ownerUserId : null,
      beneficiaryClientId: String(row.beneficiaryClientId),
      beneficiaryUserId: Number.isFinite(beneficiaryUserId ?? Number.NaN) ? beneficiaryUserId : null,
      packageName: String(row.packageName || '').trim(),
      totalCredits: Number(row.totalCredits),
      usedCredits: Number(row.usedCredits),
      remainingCredits: Number(row.remainingCredits),
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      activityTypeId: Number.isFinite(activityTypeId ?? Number.NaN) ? activityTypeId : null,
      classType: row.classType ? String(row.classType) : null,
      teacherId: row.teacherId ? String(row.teacherId) : null,
      transferable: Boolean(row.transferable),
      status: this.effectiveStatus(row),
      purchasedAt: new Date(row.purchasedAt).toISOString(),
      notes: normalizeOptionalString(row.notes),
      createdByUserId: Number(row.createdByUserId),
      ownerClient: row.ownerClient
        ? { id: String(row.ownerClient.id), name: String(row.ownerClient.name || '').trim() }
        : null,
      beneficiaryClient: row.beneficiaryClient
        ? { id: String(row.beneficiaryClient.id), name: String(row.beneficiaryClient.name || '').trim() }
        : null,
      ownerUser: row.ownerUser
        ? {
            id: Number(row.ownerUser.id),
            email: String(row.ownerUser.email || '').trim(),
            firstName: normalizeOptionalString(row.ownerUser.firstName),
            lastName: normalizeOptionalString(row.ownerUser.lastName),
          }
        : null,
      beneficiaryUser: row.beneficiaryUser
        ? {
            id: Number(row.beneficiaryUser.id),
            email: String(row.beneficiaryUser.email || '').trim(),
            firstName: normalizeOptionalString(row.beneficiaryUser.firstName),
            lastName: normalizeOptionalString(row.beneficiaryUser.lastName),
          }
        : null,
      activityType: row.activityType
        ? { id: Number(row.activityType.id), name: String(row.activityType.name || '').trim() }
        : null,
      teacher: row.teacher
        ? {
            id: String(row.teacher.id),
            displayName: String(row.teacher.displayName || '').trim(),
            isActive: Boolean(row.teacher.isActive),
          }
        : null,
      createdByUser: row.createdByUser
        ? {
            id: Number(row.createdByUser.id),
            email: String(row.createdByUser.email || '').trim(),
            firstName: normalizeOptionalString(row.createdByUser.firstName),
            lastName: normalizeOptionalString(row.createdByUser.lastName),
          }
        : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private async validateClientUserIdentity(
    clubId: number,
    clientId: string,
    userId: number | null | undefined,
    label: string
  ) {
    const client = await this.validation.assertClientBelongsToClub(clubId, clientId);
    const safeUserId = Number(userId || 0) > 0 ? Number(userId) : null;
    const user = safeUserId ? await this.validation.assertUserBelongsToClub(clubId, safeUserId) : null;

    if (client.userId && safeUserId && Number(client.userId) !== safeUserId) {
      throw conflict(
        `${label} ya está vinculado a otro usuario. Revisá la identidad elegida.`,
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    if (safeUserId && user?.linkedClientId && user.linkedClientId !== client.id) {
      throw conflict(
        `El usuario elegido para ${label.toLowerCase()} ya está vinculado a otro cliente del club.`,
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    return {
      client,
      safeUserId,
    };
  }

  private async validateRestrictions(
    clubId: number,
    activityTypeId?: number | null,
    teacherId?: string | null
  ) {
    await Promise.all([
      activityTypeId
        ? this.validation.assertActivityBelongsToClub(clubId, Number(activityTypeId))
        : Promise.resolve(null),
      teacherId ? this.validation.assertTeacherBelongsToClub(clubId, String(teacherId)) : Promise.resolve(null),
    ]);
  }

  private parseTotalCredits(value: number) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw badRequest('La cantidad total de créditos debe ser mayor a 0.', ErrorCodes.INVALID_INPUT);
    }
    return parsed;
  }

  private parseOptionalExpiry(value: string | Date | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return parseDateTimeOrThrow(value, 'Vencimiento');
  }

  async listByClub(clubId: number, filters?: { beneficiaryClientId?: string; status?: ClassPassStatusValue }) {
    const beneficiaryClientId = normalizeOptionalString(filters?.beneficiaryClientId);
    if (beneficiaryClientId) {
      await this.validation.assertClientBelongsToClub(clubId, beneficiaryClientId);
    }

    const dbStatusFilter =
      filters?.status === 'ACTIVE' || filters?.status === 'CANCELLED' ? filters.status : undefined;

    const rows = await prisma.classPass.findMany({
      where: {
        clubId,
        ...(beneficiaryClientId ? { beneficiaryClientId } : {}),
        ...(dbStatusFilter ? { status: dbStatusFilter as any } : {}),
      },
      include: {
        ownerClient: { select: { id: true, name: true } },
        beneficiaryClient: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        activityType: { select: { id: true, name: true } },
        teacher: { select: { id: true, displayName: true, isActive: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const items = rows.map((row) => this.mapRow(row));
    if (!filters?.status) return items;
    return items.filter((row) => row.status === filters.status);
  }

  async getById(clubId: number, classPassId: string) {
    const row = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId },
      include: {
        ownerClient: { select: { id: true, name: true } },
        beneficiaryClient: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        activityType: { select: { id: true, name: true } },
        teacher: { select: { id: true, displayName: true, isActive: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    if (!row) {
      throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }
    return this.mapRow(row);
  }

  async create(clubId: number, actorUserId: number, input: CreateClassPassInput) {
    await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const ownerClientId = String(input.ownerClientId || '').trim();
    const beneficiaryClientId = String(input.beneficiaryClientId || '').trim();
    if (!ownerClientId || !beneficiaryClientId) {
      throw badRequest('Revisá comprador y beneficiario.', ErrorCodes.INVALID_INPUT);
    }

    const [{ client: ownerClient, safeUserId: ownerUserId }, { client: beneficiaryClient, safeUserId: beneficiaryUserId }] =
      await Promise.all([
        this.validateClientUserIdentity(clubId, ownerClientId, input.ownerUserId, 'El comprador'),
        this.validateClientUserIdentity(clubId, beneficiaryClientId, input.beneficiaryUserId, 'El beneficiario'),
      ]);

    const totalCredits = this.parseTotalCredits(input.totalCredits);
    const expiresAt = this.parseOptionalExpiry(input.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw badRequest('El vencimiento debe estar en el futuro.', ErrorCodes.INVALID_DATE_TIME);
    }

    await this.validateRestrictions(clubId, input.activityTypeId, input.teacherId);

    const created = await prisma.classPass.create({
      data: {
        clubId,
        ownerClientId: ownerClient.id,
        ownerUserId,
        beneficiaryClientId: beneficiaryClient.id,
        beneficiaryUserId,
        packageName: String(input.packageName || '').trim(),
        totalCredits,
        usedCredits: 0,
        remainingCredits: totalCredits,
        expiresAt: expiresAt ?? null,
        activityTypeId: input.activityTypeId ? Number(input.activityTypeId) : null,
        classType: input.classType ?? null,
        teacherId: input.teacherId ? String(input.teacherId).trim() : null,
        transferable: Boolean(input.transferable),
        status: 'ACTIVE',
        notes: normalizeOptionalString(input.notes),
        createdByUserId: Number(actorUserId),
      },
      include: {
        ownerClient: { select: { id: true, name: true } },
        beneficiaryClient: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        activityType: { select: { id: true, name: true } },
        teacher: { select: { id: true, displayName: true, isActive: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapRow(created);
  }

  async update(clubId: number, classPassId: string, input: UpdateClassPassInput) {
    const existing = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId },
      select: {
        id: true,
        packageName: true,
        expiresAt: true,
        activityTypeId: true,
        classType: true,
        teacherId: true,
        transferable: true,
        notes: true,
      },
    });
    if (!existing) {
      throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }

    const expiresAt = this.parseOptionalExpiry(
      input.expiresAt === undefined ? existing.expiresAt : input.expiresAt
    );
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw badRequest('El vencimiento debe estar en el futuro.', ErrorCodes.INVALID_DATE_TIME);
    }

    const activityTypeId =
      input.activityTypeId === undefined
        ? existing.activityTypeId
          ? Number(existing.activityTypeId)
          : null
        : input.activityTypeId
          ? Number(input.activityTypeId)
          : null;

    const teacherId =
      input.teacherId === undefined
        ? existing.teacherId
          ? String(existing.teacherId)
          : null
        : input.teacherId
          ? String(input.teacherId).trim()
          : null;

    await this.validateRestrictions(clubId, activityTypeId, teacherId);

    const updated = await prisma.classPass.update({
      where: { id: String(classPassId) },
      data: {
        packageName:
          input.packageName === undefined
            ? existing.packageName
            : String(input.packageName || '').trim(),
        expiresAt: expiresAt ?? null,
        activityTypeId,
        classType:
          input.classType === undefined
            ? (existing.classType as any)
            : input.classType ?? null,
        teacherId,
        transferable: input.transferable === undefined ? existing.transferable : Boolean(input.transferable),
        notes: input.notes === undefined ? existing.notes : normalizeOptionalString(input.notes),
      },
      include: {
        ownerClient: { select: { id: true, name: true } },
        beneficiaryClient: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        activityType: { select: { id: true, name: true } },
        teacher: { select: { id: true, displayName: true, isActive: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapRow(updated);
  }

  async setStatus(clubId: number, classPassId: string, status: 'ACTIVE' | 'CANCELLED') {
    const existing = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId },
      select: {
        id: true,
        status: true,
        remainingCredits: true,
        expiresAt: true,
      },
    });
    if (!existing) {
      throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }

    const effectiveStatus = this.effectiveStatus(existing);
    if (status === 'CANCELLED') {
      const updated = await prisma.classPass.update({
        where: { id: String(classPassId) },
        data: { status: 'CANCELLED' },
        include: {
          ownerClient: { select: { id: true, name: true } },
          beneficiaryClient: { select: { id: true, name: true } },
          ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
          beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
          activityType: { select: { id: true, name: true } },
          teacher: { select: { id: true, displayName: true, isActive: true } },
          createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      return this.mapRow(updated);
    }

    if (effectiveStatus === 'DEPLETED' || effectiveStatus === 'EXPIRED') {
      throw badRequest(
        'Solo se pueden reactivar packs cancelados que todavía tengan créditos vigentes.',
        ErrorCodes.CLASS_PASS_INVALID_STATUS
      );
    }

    const updated = await prisma.classPass.update({
      where: { id: String(classPassId) },
      data: { status: 'ACTIVE' },
      include: {
        ownerClient: { select: { id: true, name: true } },
        beneficiaryClient: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        beneficiaryUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        activityType: { select: { id: true, name: true } },
        teacher: { select: { id: true, displayName: true, isActive: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return this.mapRow(updated);
  }
}
