import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString } from './academyAdminUtils';

type CreateClassEnrollmentInput = {
  studentClientId: string;
  studentUserId?: number | null;
  billingResponsibleClientId?: string | null;
  enrollmentStatus?: 'ENROLLED' | 'WAITLISTED';
  notes?: string | null;
};

type UpdateClassEnrollmentInput = {
  studentUserId?: number | null;
  billingResponsibleClientId?: string | null;
  notes?: string | null;
};

type ClassEnrollmentSummary = {
  id: string;
  clubId: number;
  classSessionId: string;
  studentClientId: string;
  studentUserId: number | null;
  billingResponsibleClientId: string | null;
  snapshotName: string;
  snapshotEmail: string | null;
  snapshotPhone: string | null;
  priceAtEnrollment: number;
  paidAmount: number;
  enrollmentStatus: string;
  attendanceStatus: string;
  paymentStatus: string;
  cancelledAt: string | null;
  attendedAt: string | null;
  notes: string | null;
  createdByUserId: number;
  studentClient: { id: string; name: string } | null;
  studentUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  billingResponsibleClient: { id: string; name: string } | null;
  createdByUser: { id: number; email: string; firstName: string | null; lastName: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export class ClassEnrollmentAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private mapRow(row: any): ClassEnrollmentSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      classSessionId: String(row.classSessionId),
      studentClientId: String(row.studentClientId),
      studentUserId: Number.isFinite(Number(row.studentUserId)) ? Number(row.studentUserId) : null,
      billingResponsibleClientId: row.billingResponsibleClientId ? String(row.billingResponsibleClientId) : null,
      snapshotName: String(row.snapshotName || '').trim(),
      snapshotEmail: normalizeOptionalString(row.snapshotEmail),
      snapshotPhone: normalizeOptionalString(row.snapshotPhone),
      priceAtEnrollment: Number(row.priceAtEnrollment || 0),
      paidAmount: Number(row.paidAmount || 0),
      enrollmentStatus: String(row.enrollmentStatus),
      attendanceStatus: String(row.attendanceStatus),
      paymentStatus: String(row.paymentStatus),
      cancelledAt: row.cancelledAt ? new Date(row.cancelledAt).toISOString() : null,
      attendedAt: row.attendedAt ? new Date(row.attendedAt).toISOString() : null,
      notes: normalizeOptionalString(row.notes),
      createdByUserId: Number(row.createdByUserId),
      studentClient: row.studentClient
        ? { id: String(row.studentClient.id), name: String(row.studentClient.name || '').trim() }
        : null,
      studentUser: row.studentUser
        ? {
            id: Number(row.studentUser.id),
            email: String(row.studentUser.email || '').trim(),
            firstName: normalizeOptionalString(row.studentUser.firstName),
            lastName: normalizeOptionalString(row.studentUser.lastName),
          }
        : null,
      billingResponsibleClient: row.billingResponsibleClient
        ? {
            id: String(row.billingResponsibleClient.id),
            name: String(row.billingResponsibleClient.name || '').trim(),
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

  private async validateStudentIdentity(
    clubId: number,
    studentClientId: string,
    studentUserId?: number | null
  ) {
    const client = await this.validation.assertClientBelongsToClub(clubId, studentClientId);
    let user:
      | {
          id: number;
          email: string;
          firstName: string | null;
          lastName: string | null;
          linkedClientId: string | null;
        }
      | null = null;

    const safeUserId = Number(studentUserId || 0) > 0 ? Number(studentUserId) : null;
    if (safeUserId) {
      user = await this.validation.assertUserBelongsToClub(clubId, safeUserId);
    }

    if (client.userId && safeUserId && Number(client.userId) !== safeUserId) {
      throw conflict(
        'El alumno seleccionado ya está vinculado a otro usuario. Revisá la identidad elegida.',
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    if (safeUserId && user?.linkedClientId && user.linkedClientId !== client.id) {
      throw conflict(
        'El usuario seleccionado ya está vinculado a otro cliente del club. Revisá la identidad elegida.',
        ErrorCodes.CLIENT_LINK_CONFLICT
      );
    }

    return {
      client,
      user,
      safeUserId,
    };
  }

  private async assertEnrollmentCapacity(
    clubId: number,
    classSessionId: string,
    targetStatus: 'ENROLLED' | 'WAITLISTED' | 'CANCELLED',
    currentEnrollmentId?: string
  ) {
    if (targetStatus !== 'ENROLLED') return;

    const classSession = await this.validation.assertClassSessionBelongsToClub(clubId, classSessionId);
    const activeCount = await prisma.classEnrollment.count({
      where: {
        classSessionId: String(classSessionId),
        enrollmentStatus: 'ENROLLED',
        ...(currentEnrollmentId ? { id: { not: String(currentEnrollmentId) } } : {}),
      },
    });

    if (classSession.classType === 'INDIVIDUAL' && activeCount >= 1) {
      throw conflict(
        'La clase individual ya tiene un alumno activo.',
        ErrorCodes.CLASS_SESSION_CAPACITY_EXCEEDED
      );
    }

    if (classSession.classType === 'GROUP' && activeCount >= Number(classSession.capacity)) {
      throw conflict(
        'La clase ya alcanzó su capacidad.',
        ErrorCodes.CLASS_SESSION_CAPACITY_EXCEEDED
      );
    }
  }

  async listByClassSession(clubId: number, classSessionId: string) {
    await this.validation.assertClassSessionBelongsToClub(clubId, classSessionId);

    const rows = await prisma.classEnrollment.findMany({
      where: {
        clubId,
        classSessionId: String(classSessionId),
      },
      include: {
        studentClient: { select: { id: true, name: true } },
        studentUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        billingResponsibleClient: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ enrollmentStatus: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.mapRow(row));
  }

  async create(clubId: number, classSessionId: string, actorUserId: number, input: CreateClassEnrollmentInput) {
    const classSession = await this.validation.assertClassSessionBelongsToClub(clubId, classSessionId);
    if (classSession.status === 'CANCELLED' || classSession.status === 'COMPLETED') {
      throw badRequest('No se pueden agregar alumnos a una clase cerrada.', ErrorCodes.INVALID_INPUT);
    }

    await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const safeStudentClientId = String(input.studentClientId || '').trim();
    if (!safeStudentClientId) {
      throw badRequest('Alumno inválido.', ErrorCodes.INVALID_INPUT);
    }

    const { client, safeUserId } = await this.validateStudentIdentity(clubId, safeStudentClientId, input.studentUserId);

    const enrollmentStatus = input.enrollmentStatus ?? 'ENROLLED';
    await this.assertEnrollmentCapacity(clubId, classSessionId, enrollmentStatus);

    const existingEnrollment = await prisma.classEnrollment.findFirst({
      where: {
        classSessionId: String(classSessionId),
        studentClientId: safeStudentClientId,
        enrollmentStatus: {
          not: 'CANCELLED',
        },
      },
      select: { id: true },
    });
    if (existingEnrollment?.id) {
      throw conflict(
        'Ese alumno ya tiene una inscripción activa en esta clase.',
        ErrorCodes.CLASS_SESSION_ENROLLMENT_CONFLICT
      );
    }

    let billingResponsibleClientId: string | null = null;
    if (input.billingResponsibleClientId) {
      const responsible = await this.validation.assertClientBelongsToClub(
        clubId,
        String(input.billingResponsibleClientId)
      );
      billingResponsibleClientId = responsible.id;
    }

    let created;
    try {
      created = await prisma.classEnrollment.create({
        data: {
          clubId,
          classSessionId: String(classSessionId),
          studentClientId: client.id,
          studentUserId: safeUserId,
          billingResponsibleClientId,
          snapshotName: client.name,
          snapshotEmail: client.email,
          snapshotPhone: client.phone,
          priceAtEnrollment: classSession.pricePerStudent ? classSession.pricePerStudent : 0,
          paidAmount: 0,
          enrollmentStatus: enrollmentStatus as any,
          attendanceStatus: 'PENDING',
          paymentStatus: 'UNPAID',
          notes: normalizeOptionalString(input.notes),
          createdByUserId: Number(actorUserId),
        },
        include: {
          studentClient: { select: { id: true, name: true } },
          studentUser: { select: { id: true, email: true, firstName: true, lastName: true } },
          billingResponsibleClient: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw conflict(
          'Ese alumno ya tiene una inscripción activa en esta clase.',
          ErrorCodes.CLASS_SESSION_ENROLLMENT_CONFLICT
        );
      }
      throw error;
    }

    return this.mapRow(created);
  }

  async update(clubId: number, classSessionId: string, enrollmentId: string, input: UpdateClassEnrollmentInput) {
    const existing = await prisma.classEnrollment.findFirst({
      where: {
        id: String(enrollmentId),
        classSessionId: String(classSessionId),
        clubId,
      },
      select: {
        id: true,
        studentClientId: true,
        studentUserId: true,
        billingResponsibleClientId: true,
        notes: true,
      },
    });
    if (!existing) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }

    const { safeUserId } = await this.validateStudentIdentity(
      clubId,
      existing.studentClientId,
      input.studentUserId === undefined ? existing.studentUserId : input.studentUserId
    );

    let billingResponsibleClientId: string | null =
      input.billingResponsibleClientId === undefined
        ? existing.billingResponsibleClientId
          ? String(existing.billingResponsibleClientId)
          : null
        : null;

    if (input.billingResponsibleClientId) {
      const responsible = await this.validation.assertClientBelongsToClub(
        clubId,
        String(input.billingResponsibleClientId)
      );
      billingResponsibleClientId = responsible.id;
    }

    const updated = await prisma.classEnrollment.update({
      where: { id: String(enrollmentId) },
      data: {
        studentUserId: safeUserId,
        billingResponsibleClientId,
        notes: input.notes === undefined ? existing.notes : normalizeOptionalString(input.notes),
      },
      include: {
        studentClient: { select: { id: true, name: true } },
        studentUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        billingResponsibleClient: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapRow(updated);
  }

  async cancel(clubId: number, classSessionId: string, enrollmentId: string, isLate = false) {
    const existing = await prisma.classEnrollment.findFirst({
      where: {
        id: String(enrollmentId),
        classSessionId: String(classSessionId),
        clubId,
      },
      select: { id: true },
    });
    if (!existing) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }

    const updated = await prisma.classEnrollment.update({
      where: { id: String(enrollmentId) },
      data: {
        enrollmentStatus: 'CANCELLED',
        attendanceStatus: isLate ? 'CANCELLED_LATE' : 'CANCELLED_ON_TIME',
        cancelledAt: new Date(),
      },
      include: {
        studentClient: { select: { id: true, name: true } },
        studentUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        billingResponsibleClient: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return this.mapRow(updated);
  }

  async setAttendanceStatus(
    clubId: number,
    classSessionId: string,
    enrollmentId: string,
    attendanceStatus: 'PENDING' | 'ATTENDED' | 'ABSENT' | 'NO_SHOW'
  ) {
    const existing = await prisma.classEnrollment.findFirst({
      where: {
        id: String(enrollmentId),
        classSessionId: String(classSessionId),
        clubId,
      },
      select: { id: true, enrollmentStatus: true },
    });
    if (!existing) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }
    if (existing.enrollmentStatus === 'CANCELLED') {
      throw badRequest(
        'No se puede tomar asistencia sobre una inscripción cancelada.',
        ErrorCodes.INVALID_INPUT
      );
    }

    const updated = await prisma.classEnrollment.update({
      where: { id: String(enrollmentId) },
      data: {
        attendanceStatus: attendanceStatus as any,
        attendedAt: attendanceStatus === 'ATTENDED' ? new Date() : null,
      },
      include: {
        studentClient: { select: { id: true, name: true } },
        studentUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        billingResponsibleClient: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    return this.mapRow(updated);
  }
}
