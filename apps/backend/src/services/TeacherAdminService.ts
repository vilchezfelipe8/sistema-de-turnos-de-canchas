import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, forbidden, notFound } from '../errors';

type TeacherInput = {
  clientId?: string | null;
  userId?: number | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  isInternal?: boolean;
  isActive?: boolean;
  specialties?: string[] | null;
  notes?: string | null;
};

type TeacherSummary = {
  id: string;
  clubId: number;
  clientId: string | null;
  userId: number | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  isInternal: boolean;
  isActive: boolean;
  specialties: string[];
  notes: string | null;
  client: { id: string; name: string } | null;
  user: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

const normalizeOptionalString = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeSpecialties = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0)
    )
  );
};

export class TeacherAdminService {
  private async assertUserBelongsToClub(clubId: number, userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw notFound('Usuario no encontrado.', ErrorCodes.USER_NOT_FOUND);
    }

    const [membership, linkedClient] = await Promise.all([
      prisma.membership.findUnique({
        where: {
          userId_clubId: {
            userId: Number(userId),
            clubId: Number(clubId),
          },
        },
        select: { userId: true },
      }),
      prisma.client.findFirst({
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

    return {
      userId: Number(user.id),
      linkedClientId: linkedClient?.id ? String(linkedClient.id) : null,
    };
  }

  private mapTeacher(row: any): TeacherSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      clientId: row.clientId ? String(row.clientId) : null,
      userId: Number.isFinite(Number(row.userId)) ? Number(row.userId) : null,
      displayName: String(row.displayName || '').trim(),
      email: normalizeOptionalString(row.email),
      phone: normalizeOptionalString(row.phone),
      isInternal: Boolean(row.isInternal),
      isActive: Boolean(row.isActive),
      specialties: normalizeSpecialties(row.specialtiesJson),
      notes: normalizeOptionalString(row.notes),
      client: row.client
        ? {
            id: String(row.client.id),
            name: String(row.client.name || '').trim(),
          }
        : null,
      user: row.user
        ? {
            id: Number(row.user.id),
            email: String(row.user.email || '').trim(),
            firstName: normalizeOptionalString(row.user.firstName),
            lastName: normalizeOptionalString(row.user.lastName),
          }
        : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private async validateReferences(clubId: number, input: { clientId?: string | null; userId?: number | null }, teacherId?: string) {
    const safeClientId = normalizeOptionalString(input.clientId);
    const safeUserId = Number(input.userId || 0) > 0 ? Number(input.userId) : null;

    let client: { id: string; clubId: number; userId: number | null } | null = null;
    if (safeClientId) {
      client = await prisma.client.findFirst({
        where: { id: safeClientId, clubId },
        select: { id: true, clubId: true, userId: true },
      });
      if (!client) {
        throw notFound('Cliente no encontrado para este club.', ErrorCodes.CLIENT_NOT_FOUND);
      }
      const teacherByClient = await prisma.teacher.findFirst({
        where: {
          clubId,
          clientId: safeClientId,
          ...(teacherId ? { id: { not: teacherId } } : {}),
        },
        select: { id: true },
      });
      if (teacherByClient?.id) {
        throw conflict('Ese cliente ya está vinculado a otro profesor.', ErrorCodes.CONFLICT);
      }
    }

    let user: { userId: number; linkedClientId: string | null } | null = null;
    if (safeUserId) {
      user = await this.assertUserBelongsToClub(clubId, safeUserId);
      const teacherByUser = await prisma.teacher.findFirst({
        where: {
          clubId,
          userId: safeUserId,
          ...(teacherId ? { id: { not: teacherId } } : {}),
        },
        select: { id: true },
      });
      if (teacherByUser?.id) {
        throw conflict('Ese usuario ya está vinculado a otro profesor.', ErrorCodes.CONFLICT);
      }
    }

    if (client?.userId && safeUserId && Number(client.userId) !== safeUserId) {
      throw conflict(
        'El cliente seleccionado ya está vinculado a otro usuario. Revisá la identidad elegida.',
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    if (safeClientId && user?.linkedClientId && user.linkedClientId !== safeClientId) {
      throw conflict(
        'El usuario seleccionado ya está vinculado a otro cliente del club. Revisá la identidad elegida.',
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    return {
      clientId: safeClientId,
      userId: safeUserId,
    };
  }

  async listByClub(clubId: number, includeInactive = true) {
    const rows = await prisma.teacher.findMany({
      where: {
        clubId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        client: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapTeacher(row));
  }

  async getById(clubId: number, teacherId: string) {
    const row = await prisma.teacher.findFirst({
      where: { id: teacherId, clubId },
      include: {
        client: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    if (!row) {
      throw notFound('Profesor no encontrado.', ErrorCodes.TEACHER_NOT_FOUND);
    }

    return this.mapTeacher(row);
  }

  async create(clubId: number, input: TeacherInput) {
    const displayName = String(input.displayName || '').trim();
    if (!displayName) {
      throw badRequest('Nombre de profesor inválido.', ErrorCodes.INVALID_INPUT);
    }

    const refs = await this.validateReferences(clubId, {
      clientId: input.clientId,
      userId: input.userId,
    });

    const created = await prisma.teacher.create({
      data: {
        clubId,
        clientId: refs.clientId,
        userId: refs.userId,
        displayName,
        email: normalizeOptionalString(input.email),
        phone: normalizeOptionalString(input.phone),
        isInternal: Boolean(input.isInternal),
        isActive: input.isActive === undefined ? true : Boolean(input.isActive),
        specialtiesJson: normalizeSpecialties(input.specialties),
        notes: normalizeOptionalString(input.notes),
      },
      include: {
        client: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapTeacher(created);
  }

  async update(clubId: number, teacherId: string, input: Partial<TeacherInput>) {
    const existing = await prisma.teacher.findFirst({
      where: { id: teacherId, clubId },
      select: { id: true, clientId: true, userId: true },
    });

    if (!existing) {
      throw notFound('Profesor no encontrado.', ErrorCodes.TEACHER_NOT_FOUND);
    }

    const nextData: Record<string, unknown> = {};

    if (input.clientId !== undefined || input.userId !== undefined) {
      const refs = await this.validateReferences(
        clubId,
        {
          clientId: input.clientId !== undefined ? input.clientId : existing.clientId,
          userId: input.userId !== undefined ? input.userId : existing.userId,
        },
        teacherId
      );
      nextData.clientId = refs.clientId;
      nextData.userId = refs.userId;
    }

    if (input.displayName !== undefined) {
      const displayName = String(input.displayName || '').trim();
      if (!displayName) {
        throw badRequest('Nombre de profesor inválido.', ErrorCodes.INVALID_INPUT);
      }
      nextData.displayName = displayName;
    }

    if (input.email !== undefined) nextData.email = normalizeOptionalString(input.email);
    if (input.phone !== undefined) nextData.phone = normalizeOptionalString(input.phone);
    if (input.notes !== undefined) nextData.notes = normalizeOptionalString(input.notes);
    if (input.isInternal !== undefined) nextData.isInternal = Boolean(input.isInternal);
    if (input.isActive !== undefined) nextData.isActive = Boolean(input.isActive);
    if (input.specialties !== undefined) nextData.specialtiesJson = normalizeSpecialties(input.specialties);

    const updated = await prisma.teacher.update({
      where: { id: teacherId },
      data: nextData,
      include: {
        client: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapTeacher(updated);
  }

  async setActive(clubId: number, teacherId: string, isActive: boolean) {
    return this.update(clubId, teacherId, { isActive });
  }
}
