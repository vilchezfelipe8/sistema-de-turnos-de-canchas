import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ClubMemberStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';
import { normalizeDni } from '../utils/dni';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { normalizeEmail } from '../utils/magicLink';
import { TimeHelper } from '../utils/TimeHelper';

type TxClient = Prisma.TransactionClient;
type DbClient = TxClient | typeof prisma;

export type MemberSummary = {
  id: string;
  status: ClubMemberStatus;
  categoryId: string;
  categoryName: string;
  memberNumber: string | null;
  validUntil: string | null;
  // Socio vigente hoy según RN-01
  isCurrent: boolean;
};

export type MemberAccountProvisionResult =
  | { status: 'CREATED'; userId: number }
  | { status: 'LINKED_EXISTING'; userId: number }
  | { status: 'ALREADY_LINKED'; userId: number }
  | { status: 'SKIPPED_NO_DNI' }
  | { status: 'CONFLICT'; detail: string; userId?: number };

const toDateOnly = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateOnly = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

// Clave YYYY-MM-DD de la fecha local del club para comparar con columnas @db.Date.
export const localDateKey = (date: Date, timeZone: string) => {
  const local = TimeHelper.utcToLocal(date, timeZone);
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${local.getFullYear()}-${mm}-${dd}`;
};

// RN-01: socio vigente = ACTIVE, categoría activa y "al día hasta" vacío o >= fecha de referencia.
export function isMemberCurrent(
  member: { status: ClubMemberStatus; validUntil: Date | null; category: { isActive: boolean } },
  atLocalDateKey: string
) {
  if (member.status !== 'ACTIVE') return false;
  if (!member.category.isActive) return false;
  const validUntil = formatDateOnly(member.validUntil);
  return !validUntil || validUntil >= atLocalDateKey;
}

const splitName = (fullName: string) => {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || 'Socio', lastName: '-' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
};

const isUniqueViolation = (error: unknown, field?: string) => {
  const e = error as Prisma.PrismaClientKnownRequestError;
  if (!e || e.code !== 'P2002') return false;
  if (!field) return true;
  const target = (e.meta as any)?.target;
  return Array.isArray(target) ? target.includes(field) : String(target || '').includes(field);
};

export class MemberService {
  async isMembersEnabled(clubId: number, db: DbClient = prisma) {
    const settings = await db.clubSettings.findUnique({ where: { clubId }, select: { membersEnabled: true } });
    return Boolean(settings?.membersEnabled);
  }

  async assertMembersEnabled(clubId: number, db: DbClient = prisma) {
    if (!(await this.isMembersEnabled(clubId, db))) {
      throw conflict('El módulo de socios no está habilitado para este club.', ErrorCodes.MEMBERS_MODULE_DISABLED);
    }
  }

  async setMembersEnabled(clubId: number, enabled: boolean, actorUserId: number | null) {
    await prisma.clubSettings.upsert({
      where: { clubId },
      update: { membersEnabled: enabled },
      create: { clubId, membersEnabled: enabled }
    });
    await this.audit(prisma, clubId, actorUserId, 'CLUB_SETTINGS', String(clubId), 'MEMBERS_MODULE_TOGGLED', { enabled });
    return { membersEnabled: enabled };
  }

  private async audit(
    db: DbClient,
    clubId: number,
    userId: number | null,
    entity: string,
    entityId: string,
    action: string,
    payload: Record<string, unknown>
  ) {
    await db.auditLog.create({
      data: { clubId, userId: userId ?? null, entity, entityId, action, payload: payload as Prisma.InputJsonValue }
    });
  }

  // ---------- Categorías ----------

  async listCategories(clubId: number) {
    const rows = await prisma.memberCategory.findMany({
      where: { clubId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } }
    });
    return rows.map(({ _count, ...row }) => ({ ...row, activeMembersCount: _count.members }));
  }

  async createCategory(input: {
    clubId: number;
    actorUserId: number | null;
    code: string;
    name: string;
    description?: string | null;
    sortOrder?: number;
  }) {
    await this.assertMembersEnabled(input.clubId);
    const code = String(input.code || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!code) throw badRequest('El código de la categoría es obligatorio.', ErrorCodes.INVALID_INPUT);
    try {
      const created = await prisma.memberCategory.create({
        data: {
          clubId: input.clubId,
          code,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder ?? 0
        }
      });
      await this.audit(prisma, input.clubId, input.actorUserId, 'MEMBER_CATEGORY', created.id, 'MEMBER_CATEGORY_CREATED', { code, name: created.name });
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('Ya existe una categoría con ese código.', ErrorCodes.INVALID_INPUT);
      }
      throw error;
    }
  }

  async updateCategory(input: {
    clubId: number;
    actorUserId: number | null;
    categoryId: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    const current = await prisma.memberCategory.findFirst({ where: { id: input.categoryId, clubId: input.clubId } });
    if (!current) throw notFound('Categoría no encontrada.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);

    // RN-15: no se desactiva una categoría con socios activos; primero hay que reasignarlos.
    if (input.isActive === false && current.isActive) {
      const activeMembers = await prisma.clubMember.count({ where: { categoryId: current.id, status: 'ACTIVE' } });
      if (activeMembers > 0) {
        throw conflict(
          `La categoría tiene ${activeMembers} socio(s) activo(s). Reasignalos antes de desactivarla.`,
          ErrorCodes.MEMBER_CATEGORY_IN_USE,
          { activeMembers }
        );
      }
    }

    const updated = await prisma.memberCategory.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });
    await this.audit(prisma, input.clubId, input.actorUserId, 'MEMBER_CATEGORY', current.id, 'MEMBER_CATEGORY_UPDATED', {
      name: input.name,
      isActive: input.isActive
    });
    return updated;
  }

  // ---------- Padrón ----------

  private toSummary(
    member: {
      id: string;
      status: ClubMemberStatus;
      categoryId: string;
      memberNumber: string | null;
      validUntil: Date | null;
      category: { name: string; isActive: boolean };
    },
    todayKey: string
  ): MemberSummary {
    return {
      id: member.id,
      status: member.status,
      categoryId: member.categoryId,
      categoryName: member.category.name,
      memberNumber: member.memberNumber,
      validUntil: formatDateOnly(member.validUntil),
      isCurrent: isMemberCurrent(member, todayKey)
    };
  }

  private async clubTimeZone(clubId: number, db: DbClient = prisma) {
    const settings = await db.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
    return settings?.timeZone || 'America/Argentina/Buenos_Aires';
  }

  // Resumen de socio por cliente, para mostrar el badge en listados (Clientes, Agenda, Caja).
  async getMemberSummariesForClients(clubId: number, clientIds: string[]): Promise<Map<string, MemberSummary>> {
    const ids = Array.from(new Set(clientIds.filter(Boolean)));
    const result = new Map<string, MemberSummary>();
    if (!ids.length) return result;
    if (!(await this.isMembersEnabled(clubId))) return result;

    const todayKey = localDateKey(new Date(), await this.clubTimeZone(clubId));
    const members = await prisma.clubMember.findMany({
      where: { clubId, clientId: { in: ids } },
      include: { category: { select: { name: true, isActive: true } } }
    });
    for (const member of members) {
      result.set(member.clientId, this.toSummary(member, todayKey));
    }
    return result;
  }

  // Categoría vigente del cliente para una fecha (RN-01). null = no socio.
  async resolveActiveMemberCategoryTx(
    db: DbClient,
    input: { clubId: number; clientId: string | null | undefined; atDateTime: Date; timeZone: string }
  ): Promise<string | null> {
    if (!input.clientId) return null;
    if (!(await this.isMembersEnabled(input.clubId, db))) return null;
    const member = await db.clubMember.findUnique({
      where: { clientId: input.clientId },
      include: { category: { select: { isActive: true } } }
    });
    if (!member || member.clubId !== input.clubId) return null;
    return isMemberCurrent(member, localDateKey(input.atDateTime, input.timeZone)) ? member.categoryId : null;
  }

  async listMembers(input: {
    clubId: number;
    status?: ClubMemberStatus;
    categoryId?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Math.floor(input.page || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(input.pageSize || 50)));
    const q = String(input.q || '').trim();
    const qDigits = q.replace(/\D/g, '');

    const where: Prisma.ClubMemberWhereInput = {
      clubId: input.clubId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(q
        ? {
            OR: [
              { memberNumber: { contains: q, mode: 'insensitive' } },
              { client: { name: { contains: q, mode: 'insensitive' } } },
              ...(qDigits.length >= 3 ? [{ client: { dni: { contains: qDigits } } }] : [])
            ]
          }
        : {})
    };

    const todayKey = localDateKey(new Date(), await this.clubTimeZone(input.clubId));
    const [total, rows] = await Promise.all([
      prisma.clubMember.count({ where }),
      prisma.clubMember.findMany({
        where,
        orderBy: [{ client: { name: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { name: true, isActive: true } },
          client: {
            select: {
              id: true,
              name: true,
              dni: true,
              phone: true,
              email: true,
              user: { select: { id: true, accountStatus: true } }
            }
          }
        }
      })
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        ...this.toSummary(row, todayKey),
        joinedAt: formatDateOnly(row.joinedAt),
        leftAt: formatDateOnly(row.leftAt),
        statusReason: row.statusReason,
        notes: row.notes,
        client: {
          id: row.client.id,
          name: row.client.name,
          dni: row.client.dni,
          phone: row.client.phone,
          email: row.client.email
        },
        appAccount: row.client.user
          ? { userId: row.client.user.id, status: row.client.user.accountStatus }
          : null
      }))
    };
  }

  async getClientMember(clubId: number, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, clubId },
      select: { id: true, userId: true, user: { select: { id: true, accountStatus: true } } }
    });
    if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);

    const member = await prisma.clubMember.findUnique({
      where: { clientId },
      include: { category: { select: { name: true, isActive: true } } }
    });
    const todayKey = localDateKey(new Date(), await this.clubTimeZone(clubId));
    return {
      membersEnabled: await this.isMembersEnabled(clubId),
      member: member
        ? {
            ...this.toSummary(member, todayKey),
            joinedAt: formatDateOnly(member.joinedAt),
            leftAt: formatDateOnly(member.leftAt),
            statusReason: member.statusReason,
            notes: member.notes
          }
        : null,
      appAccount: client.user ? { userId: client.user.id, status: client.user.accountStatus } : null
    };
  }

  private async assertCategory(db: DbClient, clubId: number, categoryId: string) {
    const category = await db.memberCategory.findFirst({ where: { id: categoryId, clubId } });
    if (!category) throw notFound('Categoría no encontrada.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);
    if (!category.isActive) throw conflict('La categoría está desactivada.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);
    return category;
  }

  // Alta de socio sobre una ficha existente. Si el cliente tiene DNI, se le prepara la cuenta de la app.
  async createMember(input: {
    clubId: number;
    actorUserId: number | null;
    clientId: string;
    categoryId: string;
    memberNumber?: string | null;
    joinedAt?: string | null;
    validUntil?: string | null;
    notes?: string | null;
    provisionAppAccount?: boolean;
  }) {
    await this.assertMembersEnabled(input.clubId);

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, clubId: input.clubId } });
      if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);
      await this.assertCategory(tx, input.clubId, input.categoryId);

      const existing = await tx.clubMember.findUnique({ where: { clientId: client.id } });
      if (existing) {
        throw conflict('El cliente ya figura en el padrón. Reactivalo o editalo.', ErrorCodes.MEMBER_ALREADY_EXISTS, {
          memberId: existing.id
        });
      }

      const joinedAt = toDateOnly(input.joinedAt) ?? toDateOnly(localDateKey(new Date(), await this.clubTimeZone(input.clubId, tx)))!;
      let member;
      try {
        member = await tx.clubMember.create({
          data: {
            clubId: input.clubId,
            clientId: client.id,
            categoryId: input.categoryId,
            memberNumber: input.memberNumber?.trim() || null,
            joinedAt,
            validUntil: toDateOnly(input.validUntil),
            notes: input.notes?.trim() || null,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId
          }
        });
      } catch (error) {
        if (isUniqueViolation(error, 'memberNumber')) {
          throw conflict('Ese número de socio ya está en uso.', ErrorCodes.MEMBER_NUMBER_TAKEN);
        }
        throw error;
      }

      await tx.clubMemberHistory.create({
        data: {
          clubMemberId: member.id,
          clubId: input.clubId,
          action: 'CREATED',
          toStatus: member.status,
          toCategoryId: member.categoryId,
          changedByUserId: input.actorUserId
        }
      });
      await this.audit(tx, input.clubId, input.actorUserId, 'CLUB_MEMBER', member.id, 'CLUB_MEMBER_CREATED', {
        clientId: client.id,
        categoryId: member.categoryId,
        memberNumber: member.memberNumber
      });

      const account: MemberAccountProvisionResult =
        input.provisionAppAccount === false
          ? { status: 'SKIPPED_NO_DNI' }
          : await this.provisionMemberAppAccountTx(tx, {
              clubId: input.clubId,
              clientId: client.id,
              actorUserId: input.actorUserId
            });

      return { memberId: member.id, account };
    });

    return { ...(await this.getClientMember(input.clubId, input.clientId)), account: result.account };
  }

  async updateMember(input: {
    clubId: number;
    actorUserId: number | null;
    clientId: string;
    categoryId?: string;
    memberNumber?: string | null;
    joinedAt?: string | null;
    validUntil?: string | null;
    notes?: string | null;
  }) {
    await prisma.$transaction(async (tx) => {
      const member = await tx.clubMember.findFirst({ where: { clientId: input.clientId, clubId: input.clubId } });
      if (!member) throw notFound('El cliente no figura en el padrón.', ErrorCodes.MEMBER_NOT_FOUND);

      const categoryChanged = input.categoryId !== undefined && input.categoryId !== member.categoryId;
      if (categoryChanged) await this.assertCategory(tx, input.clubId, input.categoryId!);

      try {
        await tx.clubMember.update({
          where: { id: member.id },
          data: {
            ...(categoryChanged ? { categoryId: input.categoryId } : {}),
            ...(input.memberNumber !== undefined ? { memberNumber: input.memberNumber?.trim() || null } : {}),
            ...(input.joinedAt !== undefined && toDateOnly(input.joinedAt) ? { joinedAt: toDateOnly(input.joinedAt)! } : {}),
            ...(input.validUntil !== undefined ? { validUntil: toDateOnly(input.validUntil) } : {}),
            ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
            updatedByUserId: input.actorUserId
          }
        });
      } catch (error) {
        if (isUniqueViolation(error, 'memberNumber')) {
          throw conflict('Ese número de socio ya está en uso.', ErrorCodes.MEMBER_NUMBER_TAKEN);
        }
        throw error;
      }

      await tx.clubMemberHistory.create({
        data: {
          clubMemberId: member.id,
          clubId: input.clubId,
          action: categoryChanged ? 'CATEGORY_CHANGED' : 'UPDATED',
          fromCategoryId: categoryChanged ? member.categoryId : null,
          toCategoryId: categoryChanged ? input.categoryId : null,
          changedByUserId: input.actorUserId
        }
      });
      await this.audit(tx, input.clubId, input.actorUserId, 'CLUB_MEMBER', member.id, categoryChanged ? 'CLUB_MEMBER_CATEGORY_CHANGED' : 'CLUB_MEMBER_UPDATED', {
        categoryId: input.categoryId,
        memberNumber: input.memberNumber,
        validUntil: input.validUntil
      });
    });

    return this.getClientMember(input.clubId, input.clientId);
  }

  // Suspender, reactivar o dar de baja. Suspender y dar de baja requieren motivo (RN-09).
  async changeMemberStatus(input: {
    clubId: number;
    actorUserId: number | null;
    clientId: string;
    status: ClubMemberStatus;
    reason?: string | null;
  }) {
    const reason = String(input.reason || '').trim();
    if (input.status !== 'ACTIVE' && reason.length < 3) {
      throw badRequest('Indicá el motivo de la suspensión o la baja.', ErrorCodes.INVALID_INPUT);
    }

    await prisma.$transaction(async (tx) => {
      const member = await tx.clubMember.findFirst({ where: { clientId: input.clientId, clubId: input.clubId } });
      if (!member) throw notFound('El cliente no figura en el padrón.', ErrorCodes.MEMBER_NOT_FOUND);
      if (member.status === input.status) return;

      if (input.status === 'ACTIVE') {
        const category = await tx.memberCategory.findUnique({ where: { id: member.categoryId } });
        if (!category?.isActive) {
          throw conflict('La categoría del socio está desactivada. Asignale otra antes de reactivarlo.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);
        }
      }

      const todayKey = localDateKey(new Date(), await this.clubTimeZone(input.clubId, tx));
      await tx.clubMember.update({
        where: { id: member.id },
        data: {
          status: input.status,
          statusReason: reason || null,
          leftAt: input.status === 'INACTIVE' ? toDateOnly(todayKey) : input.status === 'ACTIVE' ? null : member.leftAt,
          updatedByUserId: input.actorUserId
        }
      });
      await tx.clubMemberHistory.create({
        data: {
          clubMemberId: member.id,
          clubId: input.clubId,
          action: 'STATUS_CHANGED',
          fromStatus: member.status,
          toStatus: input.status,
          reason: reason || null,
          changedByUserId: input.actorUserId
        }
      });
      await this.audit(tx, input.clubId, input.actorUserId, 'CLUB_MEMBER', member.id, 'CLUB_MEMBER_STATUS_CHANGED', {
        from: member.status,
        to: input.status,
        reason: reason || null
      });
    });

    return this.getClientMember(input.clubId, input.clientId);
  }

  async getMemberHistory(clubId: number, clientId: string) {
    const member = await prisma.clubMember.findFirst({ where: { clientId, clubId }, select: { id: true } });
    if (!member) throw notFound('El cliente no figura en el padrón.', ErrorCodes.MEMBER_NOT_FOUND);
    const rows = await prisma.clubMemberHistory.findMany({
      where: { clubMemberId: member.id },
      orderBy: { createdAt: 'desc' }
    });
    const categoryIds = Array.from(new Set(rows.flatMap((row) => [row.fromCategoryId, row.toCategoryId]).filter(Boolean))) as string[];
    const userIds = Array.from(new Set(rows.map((row) => row.changedByUserId).filter(Boolean))) as number[];
    const [categories, users] = await Promise.all([
      prisma.memberCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
    ]);
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      fromCategoryName: row.fromCategoryId ? categoryName.get(row.fromCategoryId) ?? null : null,
      toCategoryName: row.toCategoryId ? categoryName.get(row.toCategoryId) ?? null : null,
      reason: row.reason,
      changedBy: row.changedByUserId ? userName.get(row.changedByUserId) ?? null : null,
      createdAt: row.createdAt.toISOString()
    }));
  }

  // ---------- Cuenta de la app del socio (D3) ----------

  // Deja la ficha del socio vinculada a un User. Crea una cuenta PENDING_ACTIVATION si no existe.
  // Nunca vincula a ciegas una cuenta que el propio usuario creó declarando el DNI: exige que el
  // teléfono también coincida; si no, es conflicto para revisar a mano (E2).
  async provisionMemberAppAccountTx(
    tx: TxClient,
    input: {
      clubId: number;
      clientId: string;
      actorUserId: number | null;
      firstName?: string;
      lastName?: string;
    }
  ): Promise<MemberAccountProvisionResult> {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);
    if (client.userId) return { status: 'ALREADY_LINKED', userId: client.userId };

    const dni = normalizeDni(client.dni);
    if (!dni) return { status: 'SKIPPED_NO_DNI' };

    const phone = normalizeIdentityPhone(client.phone);
    const email = client.email ? normalizeEmail(client.email) : null;
    const existingByDni = await tx.user.findUnique({ where: { dni } });

    const linkUser = async (userId: number) => {
      const alreadyLinkedInClub = await tx.client.findFirst({
        where: { clubId: input.clubId, userId, NOT: { id: client.id } },
        select: { id: true }
      });
      if (alreadyLinkedInClub) {
        return {
          status: 'CONFLICT' as const,
          userId,
          detail: 'La cuenta con ese DNI ya está vinculada a otra ficha del club.'
        };
      }
      await tx.client.update({ where: { id: client.id }, data: { userId } });
      return null;
    };

    if (existingByDni) {
      const createdByAClub = existingByDni.createdByClubId != null;
      const phoneMatches = Boolean(phone) &&
        getPhoneIdentityVariants(existingByDni.phoneNumber).some((variant) => getPhoneIdentityVariants(phone).includes(variant));
      if (!createdByAClub && !phoneMatches) {
        return {
          status: 'CONFLICT',
          userId: existingByDni.id,
          detail: 'Ya existe una cuenta registrada por el usuario con ese DNI y el teléfono no coincide. Revisar antes de vincular.'
        };
      }
      const linkConflict = await linkUser(existingByDni.id);
      if (linkConflict) return linkConflict;
      await this.audit(tx, input.clubId, input.actorUserId, 'CLIENT', client.id, 'MEMBER_APP_ACCOUNT_LINKED', { userId: existingByDni.id });
      return { status: 'LINKED_EXISTING', userId: existingByDni.id };
    }

    if (email) {
      const existingByEmail = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existingByEmail) {
        return {
          status: 'CONFLICT',
          userId: existingByEmail.id,
          detail: 'Ya existe una cuenta con ese email y otro DNI. Revisar antes de vincular.'
        };
      }
    }

    const names = input.firstName && input.lastName
      ? { firstName: input.firstName, lastName: input.lastName }
      : splitName(client.name);
    // Contraseña aleatoria inutilizable hasta que el socio active la cuenta con su código.
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const user = await tx.user.create({
      data: {
        firstName: names.firstName,
        lastName: names.lastName,
        email,
        dni,
        phoneNumber: phone || '',
        password: unusablePassword,
        role: 'MEMBER',
        accountStatus: 'PENDING_ACTIVATION',
        createdByClubId: input.clubId
      }
    });
    await tx.client.update({ where: { id: client.id }, data: { userId: user.id, dni } });
    await this.audit(tx, input.clubId, input.actorUserId, 'CLIENT', client.id, 'MEMBER_APP_ACCOUNT_CREATED', { userId: user.id });
    return { status: 'CREATED', userId: user.id };
  }

  async provisionMemberAppAccount(input: { clubId: number; clientId: string; actorUserId: number | null }) {
    await this.assertMembersEnabled(input.clubId);
    const member = await prisma.clubMember.findFirst({ where: { clientId: input.clientId, clubId: input.clubId } });
    if (!member) throw notFound('El cliente no figura en el padrón.', ErrorCodes.MEMBER_NOT_FOUND);
    return prisma.$transaction((tx) => this.provisionMemberAppAccountTx(tx, input));
  }
}
