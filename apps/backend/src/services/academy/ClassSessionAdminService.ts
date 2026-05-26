import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import {
  normalizeOptionalString,
  parseDateTimeOrThrow,
  parseMoneyOrThrow,
} from './academyAdminUtils';

type ClassSessionInput = {
  teacherId: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  classType: 'INDIVIDUAL' | 'GROUP';
  activityTypeId?: number | null;
  courtId?: number | null;
  startsAt: string | Date;
  endsAt: string | Date;
  durationMinutes: number;
  capacity: number;
  pricePerStudent?: number | string | null;
  status?: 'DRAFT' | 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  level?: string | null;
  description?: string | null;
  requiresApproval?: boolean;
  requiresPaymentToEnroll?: boolean;
  metadata?: unknown;
};

type ClassSessionSummary = {
  id: string;
  clubId: number;
  teacherId: string;
  visibility: string;
  classType: string;
  activityTypeId: number | null;
  courtId: number | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  capacity: number;
  pricePerStudent: number | null;
  status: string;
  level: string | null;
  description: string | null;
  requiresApproval: boolean;
  requiresPaymentToEnroll: boolean;
  createdByUserId: number;
  metadata: unknown;
  teacher: { id: string; displayName: string; isActive: boolean } | null;
  court: { id: number; name: string } | null;
  activityType: { id: number; name: string } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export class ClassSessionAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private mapRow(row: any): ClassSessionSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      teacherId: String(row.teacherId),
      visibility: String(row.visibility),
      classType: String(row.classType),
      activityTypeId: Number.isFinite(Number(row.activityTypeId)) ? Number(row.activityTypeId) : null,
      courtId: Number.isFinite(Number(row.courtId)) ? Number(row.courtId) : null,
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
      durationMinutes: Number(row.durationMinutes),
      capacity: Number(row.capacity),
      pricePerStudent: row.pricePerStudent == null ? null : Number(row.pricePerStudent),
      status: String(row.status),
      level: normalizeOptionalString(row.level),
      description: normalizeOptionalString(row.description),
      requiresApproval: Boolean(row.requiresApproval),
      requiresPaymentToEnroll: Boolean(row.requiresPaymentToEnroll),
      createdByUserId: Number(row.createdByUserId),
      metadata: row.metadataJson ?? null,
      teacher: row.teacher
        ? {
            id: String(row.teacher.id),
            displayName: String(row.teacher.displayName || '').trim(),
            isActive: Boolean(row.teacher.isActive),
          }
        : null,
      court: row.court
        ? {
            id: Number(row.court.id),
            name: String(row.court.name || '').trim(),
          }
        : null,
      activityType: row.activityType
        ? {
            id: Number(row.activityType.id),
            name: String(row.activityType.name || '').trim(),
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

  private async validateInput(
    clubId: number,
    actorUserId: number,
    input: ClassSessionInput,
    classSessionId?: string
  ) {
    const teacherId = String(input.teacherId || '').trim();
    if (!teacherId) {
      throw badRequest('Profesor inválido.', ErrorCodes.INVALID_INPUT);
    }

    const startsAt = parseDateTimeOrThrow(input.startsAt, 'Fecha de inicio');
    const endsAt = parseDateTimeOrThrow(input.endsAt, 'Fecha de fin');
    if (startsAt >= endsAt) {
      throw badRequest('La clase debe terminar después de empezar.', ErrorCodes.INVALID_DATE_TIME);
    }

    const durationMinutes = Number(input.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw badRequest('Duración inválida.', ErrorCodes.INVALID_INPUT);
    }

    const realDurationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);
    if (realDurationMinutes !== durationMinutes) {
      throw badRequest('La duración no coincide con el rango horario.', ErrorCodes.INVALID_INPUT);
    }

    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw badRequest('Capacidad inválida.', ErrorCodes.INVALID_INPUT);
    }

    if (input.classType === 'INDIVIDUAL' && capacity !== 1) {
      throw badRequest('Las clases individuales deben tener capacidad 1.', ErrorCodes.INVALID_INPUT);
    }
    if (input.classType === 'GROUP' && capacity < 2) {
      throw badRequest('Las clases grupales deben tener capacidad mayor a 1.', ErrorCodes.INVALID_INPUT);
    }

    await Promise.all([
      this.validation.assertTeacherBelongsToClub(clubId, teacherId),
      this.validation.assertUserBelongsToClub(clubId, actorUserId),
      input.courtId ? this.validation.assertCourtBelongsToClub(clubId, Number(input.courtId)) : Promise.resolve(null),
      input.activityTypeId
        ? this.validation.assertActivityBelongsToClub(clubId, Number(input.activityTypeId))
        : Promise.resolve(null),
    ]);

    // Validamos solapamientos de cancha con turnos y clases activas.

    const status = input.status ?? 'SCHEDULED';
    const blockingStatuses = new Set(['SCHEDULED', 'CONFIRMED']);

    if (blockingStatuses.has(status) && input.courtId) {
      const courtId = Number(input.courtId);
      const bookingOverlap = await prisma.booking.findFirst({
        where: {
          clubId,
          courtId,
          status: { not: 'CANCELLED' },
          startDateTime: { lt: endsAt },
          endDateTime: { gt: startsAt },
        },
        select: { id: true },
      });

      if (bookingOverlap) {
        throw conflict('La cancha ya tiene un turno reservado en ese horario.', ErrorCodes.CLASS_SESSION_OVERLAP);
      }

      const classOverlap = await prisma.classSession.findFirst({
        where: {
          clubId,
          courtId,
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          ...(classSessionId ? { id: { not: String(classSessionId) } } : {}),
        },
        select: { id: true },
      });

      if (classOverlap) {
        throw conflict('La cancha ya tiene una clase en ese horario.', ErrorCodes.CLASS_SESSION_OVERLAP);
      }
    }

    return {
      teacherId,
      visibility: input.visibility,
      classType: input.classType,
      activityTypeId: input.activityTypeId ? Number(input.activityTypeId) : null,
      courtId: input.courtId ? Number(input.courtId) : null,
      startsAt,
      endsAt,
      durationMinutes,
      capacity,
      pricePerStudent: parseMoneyOrThrow(input.pricePerStudent, 'Precio por alumno'),
      status,
      level: normalizeOptionalString(input.level),
      description: normalizeOptionalString(input.description),
      requiresApproval: Boolean(input.requiresApproval),
      requiresPaymentToEnroll: Boolean(input.requiresPaymentToEnroll),
      metadataJson:
        input.metadata === undefined
          ? undefined
          : input.metadata === null
            ? Prisma.JsonNull
            : (input.metadata as Prisma.InputJsonValue),
      createdByUserId: Number(actorUserId),
    };
  }

  async listByClub(clubId: number) {
    const rows = await prisma.classSession.findMany({
      where: { clubId },
      include: {
        teacher: { select: { id: true, displayName: true, isActive: true } },
        court: { select: { id: true, name: true } },
        activityType: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.mapRow(row));
  }

  async getById(clubId: number, classSessionId: string) {
    const row = await prisma.classSession.findFirst({
      where: { id: String(classSessionId), clubId },
      include: {
        teacher: { select: { id: true, displayName: true, isActive: true } },
        court: { select: { id: true, name: true } },
        activityType: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    if (!row) {
      throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    }
    return this.mapRow(row);
  }

  async create(clubId: number, actorUserId: number, input: ClassSessionInput) {
    const data = await this.validateInput(clubId, actorUserId, input);
    const created = await prisma.classSession.create({
      data: {
        clubId,
        ...data,
      },
      include: {
        teacher: { select: { id: true, displayName: true, isActive: true } },
        court: { select: { id: true, name: true } },
        activityType: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return this.mapRow(created);
  }

  async update(clubId: number, classSessionId: string, actorUserId: number, input: Partial<ClassSessionInput>) {
    const existing = await prisma.classSession.findFirst({
      where: { id: String(classSessionId), clubId },
      select: {
        id: true,
        teacherId: true,
        visibility: true,
        classType: true,
        activityTypeId: true,
        courtId: true,
        startsAt: true,
        endsAt: true,
        durationMinutes: true,
        capacity: true,
        pricePerStudent: true,
        status: true,
        level: true,
        description: true,
        requiresApproval: true,
        requiresPaymentToEnroll: true,
        metadataJson: true,
      },
    });
    if (!existing) {
      throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    }

    const data = await this.validateInput(clubId, actorUserId, {
      teacherId: input.teacherId ?? existing.teacherId,
      visibility: (input.visibility ?? existing.visibility) as 'PUBLIC' | 'PRIVATE',
      classType: (input.classType ?? existing.classType) as 'INDIVIDUAL' | 'GROUP',
      activityTypeId: input.activityTypeId === undefined ? existing.activityTypeId : input.activityTypeId,
      courtId: input.courtId === undefined ? existing.courtId : input.courtId,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
      durationMinutes: input.durationMinutes ?? existing.durationMinutes,
      capacity: input.capacity ?? existing.capacity,
      pricePerStudent:
        input.pricePerStudent === undefined
          ? existing.pricePerStudent == null
            ? null
            : Number(existing.pricePerStudent)
          : input.pricePerStudent,
      status: (input.status ?? existing.status) as any,
      level: input.level === undefined ? existing.level : input.level,
      description: input.description === undefined ? existing.description : input.description,
      requiresApproval: input.requiresApproval ?? existing.requiresApproval,
      requiresPaymentToEnroll: input.requiresPaymentToEnroll ?? existing.requiresPaymentToEnroll,
      metadata: input.metadata === undefined ? existing.metadataJson : input.metadata,
    }, classSessionId);

    const { createdByUserId: _createdByUserId, ...updateData } = data;
    const updated = await prisma.classSession.update({
      where: { id: String(classSessionId) },
      data: updateData,
      include: {
        teacher: { select: { id: true, displayName: true, isActive: true } },
        court: { select: { id: true, name: true } },
        activityType: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return this.mapRow(updated);
  }

  async setStatus(clubId: number, classSessionId: string, status: ClassSessionInput['status']) {
    const existing = await prisma.classSession.findFirst({
      where: { id: String(classSessionId), clubId },
      select: { id: true },
    });
    if (!existing) {
      throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    }

    const updated = await prisma.classSession.update({
      where: { id: String(classSessionId) },
      data: {
        status: status as any,
      },
      include: {
        teacher: { select: { id: true, displayName: true, isActive: true } },
        court: { select: { id: true, name: true } },
        activityType: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return this.mapRow(updated);
  }
}
