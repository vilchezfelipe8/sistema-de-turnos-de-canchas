import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString, parseDateTimeOrThrow } from './academyAdminUtils';
import { getDerivedPaymentStatus } from '../../domain/bookingDomain';
import { AccountService } from '../AccountService';
import { mapAccountDto } from '../../dto/financialDto';

type ClassPassClassTypeValue = 'INDIVIDUAL' | 'GROUP';
type ClassPassStatusValue = 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'CANCELLED';

type CreateClassPassInput = {
  ownerClientId: string;
  ownerUserId?: number | null;
  beneficiaryClientId: string;
  beneficiaryUserId?: number | null;
  packageName: string;
  priceAtPurchase?: number | null;
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
  priceAtPurchase: number | null;
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
  financial: {
    accountId: string | null;
    accountStatus: 'OPEN' | 'CLOSED' | null;
    state: 'NO_ACCOUNT' | 'PENDING' | 'PARTIAL' | 'PAID';
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' | null;
    totalAmount: number | null;
    paidAmount: number | null;
    remainingAmount: number | null;
    blockedReason: string | null;
  };
};

type ClassPassAccountPayload = {
  classPassId: string;
  account: ReturnType<typeof mapAccountDto> | null;
  summary: {
    accountId: string;
    itemsTotal: number;
    paymentsTotal: number;
    remaining: number;
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    isBalanced: boolean;
    status: 'OPEN' | 'CLOSED';
  } | null;
  financialStatus: 'NO_ACCOUNT' | 'PENDING' | 'PARTIAL' | 'PAID';
  blockedReason: string | null;
};

export class ClassPassAdminService {
  private readonly validation = new AcademyAdminValidationService();
  private readonly accountService = new AccountService();

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

  private parseOptionalMoney(value: number | null | undefined) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw badRequest('El precio del pack debe ser mayor a 0.', ErrorCodes.INVALID_INPUT);
    }
    return Number(parsed.toFixed(2));
  }

  private buildAccountBlockedReason(row: {
    status: string;
    priceAtPurchase?: number | null;
  }) {
    if (String(row.status) === 'CANCELLED') return 'No se puede abrir cuenta para un pack cancelado.';
    const priceAtPurchase = Number(row.priceAtPurchase || 0);
    if (!Number.isFinite(priceAtPurchase) || priceAtPurchase <= 0) {
      return 'Cargá un precio mayor a 0 para abrir la cuenta del pack.';
    }
    return null;
  }

  private mapFinancial(row: {
    id: string;
    status: string;
    priceAtPurchase?: number | null;
  }, account?: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    totalAmount: any;
    paidAmount: any;
  } | null) {
    if (!account) {
      return {
        accountId: null,
        accountStatus: null,
        state: 'NO_ACCOUNT' as const,
        paymentStatus: null,
        totalAmount: null,
        paidAmount: null,
        remainingAmount: null,
        blockedReason: this.buildAccountBlockedReason(row),
      };
    }

    const totalAmount = Number(account.totalAmount || 0);
    const paidAmount = Number(account.paidAmount || 0);
    const remainingAmount = Number(Math.max(0, totalAmount - paidAmount).toFixed(2));
    const paymentStatus = getDerivedPaymentStatus(totalAmount, paidAmount);
    const state: 'PENDING' | 'PARTIAL' | 'PAID' =
      paymentStatus === 'PAID'
        ? 'PAID'
        : paymentStatus === 'PARTIAL'
          ? 'PARTIAL'
          : 'PENDING';

    return {
      accountId: String(account.id),
      accountStatus: account.status,
      state,
      paymentStatus,
      totalAmount,
      paidAmount,
      remainingAmount,
      blockedReason: null,
    };
  }

  private mapRow(row: any, accountByPassId?: Map<string, any>): ClassPassSummary {
    const passId = String(row.id);
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
      priceAtPurchase: row.priceAtPurchase == null ? null : Number(row.priceAtPurchase),
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
      financial: this.mapFinancial(
        {
          id: passId,
          status: String(row.status || ''),
          priceAtPurchase: row.priceAtPurchase == null ? null : Number(row.priceAtPurchase),
        },
        accountByPassId?.get(passId) || null
      ),
    };
  }

  private async loadAccountByPassId(clubId: number, classPassIds: string[]) {
    const safeIds = Array.from(new Set(classPassIds.map((value) => String(value || '').trim()).filter(Boolean)));
    if (!safeIds.length) return new Map<string, any>();

    const rows = await prisma.account.findMany({
      where: {
        clubId,
        sourceType: 'CLASS_PASS',
        sourceId: { in: safeIds },
      },
      select: {
        id: true,
        sourceId: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
      },
    });

    return new Map(rows.map((row) => [String(row.sourceId), row]));
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

  private parsePackageName(value: string | null | undefined) {
    const packageName = String(value || '').trim();
    if (!packageName) {
      throw badRequest('Elegí un nombre para el pack.', ErrorCodes.INVALID_INPUT);
    }
    return packageName;
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

    const accountByPassId = await this.loadAccountByPassId(
      clubId,
      rows.map((row) => String(row.id))
    );
    const items = rows.map((row) => this.mapRow(row, accountByPassId));
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
    const accountByPassId = await this.loadAccountByPassId(clubId, [String(classPassId)]);
    return this.mapRow(row, accountByPassId);
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
    const packageName = this.parsePackageName(input.packageName);
    const priceAtPurchase = this.parseOptionalMoney(input.priceAtPurchase);
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
        packageName,
        priceAtPurchase: priceAtPurchase == null ? null : priceAtPurchase,
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

    const accountByPassId = await this.loadAccountByPassId(clubId, [String(created.id)]);
    return this.mapRow(created, accountByPassId);
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
            : this.parsePackageName(input.packageName),
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

    const accountByPassId = await this.loadAccountByPassId(clubId, [String(updated.id)]);
    return this.mapRow(updated, accountByPassId);
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
      const accountByPassId = await this.loadAccountByPassId(clubId, [String(updated.id)]);
      return this.mapRow(updated, accountByPassId);
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
    const accountByPassId = await this.loadAccountByPassId(clubId, [String(updated.id)]);
    return this.mapRow(updated, accountByPassId);
  }

  async getAccount(clubId: number, classPassId: string): Promise<ClassPassAccountPayload> {
    const classPass = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId },
      select: {
        id: true,
        status: true,
        priceAtPurchase: true,
      },
    });
    if (!classPass) {
      throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }

    const account = await prisma.account.findFirst({
      where: {
        clubId,
        sourceType: 'CLASS_PASS',
        sourceId: String(classPass.id),
      },
    });

    if (!account) {
      return {
        classPassId: String(classPass.id),
        account: null,
        summary: null,
        financialStatus: 'NO_ACCOUNT',
        blockedReason: this.buildAccountBlockedReason({
          status: String(classPass.status || ''),
          priceAtPurchase: classPass.priceAtPurchase == null ? null : Number(classPass.priceAtPurchase),
        }),
      };
    }

    const summary = await this.accountService.getAccountSummary(clubId, account.id);
    const financial = this.mapFinancial(
      {
        id: String(classPass.id),
        status: String(classPass.status || ''),
        priceAtPurchase: classPass.priceAtPurchase == null ? null : Number(classPass.priceAtPurchase),
      },
      {
        id: String(account.id),
        status: account.status,
        totalAmount: account.totalAmount,
        paidAmount: account.paidAmount,
      }
    );

    return {
      classPassId: String(classPass.id),
      account: mapAccountDto(account),
      summary: {
        accountId: summary.accountId,
        itemsTotal: Number(summary.itemsTotal || 0),
        paymentsTotal: Number(summary.paymentsTotal || 0),
        remaining: Number(summary.remaining || 0),
        paymentStatus: summary.paymentStatus,
        isBalanced: Boolean(summary.isBalanced),
        status: summary.status,
      },
      financialStatus: financial.state,
      blockedReason: null,
    };
  }

  async openAccount(clubId: number, classPassId: string): Promise<ClassPassAccountPayload> {
    const classPass = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId },
      select: {
        id: true,
        status: true,
        ownerClientId: true,
        priceAtPurchase: true,
      },
    });
    if (!classPass) {
      throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }

    await this.validation.assertClientBelongsToClub(clubId, String(classPass.ownerClientId));

    await this.accountService.openAccount({
      clubId,
      sourceType: 'CLASS_PASS',
      sourceId: String(classPass.id),
    });

    return this.getAccount(clubId, String(classPass.id));
  }
}
