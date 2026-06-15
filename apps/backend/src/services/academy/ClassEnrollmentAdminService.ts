import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString } from './academyAdminUtils';
import { getDerivedPaymentStatus } from '../../domain/bookingDomain';
import { AccountService } from '../AccountService';
import { mapAccountDto } from '../../dto/financialDto';

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

type ClassEnrollmentAccountPayload = {
  classEnrollmentId: string;
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

export class ClassEnrollmentAdminService {
  private readonly validation = new AcademyAdminValidationService();
  private readonly accountService = new AccountService();

  private buildAccountBlockedReason(row: {
    enrollmentStatus: string;
    classSessionStatus?: string | null;
    paymentStatus: string;
    priceAtEnrollment?: number | null;
    paidAmount?: number | null;
  }) {
    if (String(row.enrollmentStatus) === 'CANCELLED') {
      return 'No se puede abrir cuenta para una inscripción cancelada.';
    }
    if (row.classSessionStatus && String(row.classSessionStatus) === 'CANCELLED') {
      return 'No se puede abrir cuenta para una clase cancelada.';
    }
    if (String(row.paymentStatus) === 'COVERED_BY_CREDIT') {
      return 'La inscripción ya está cubierta por crédito.';
    }
    if (String(row.paymentStatus) === 'REFUNDED') {
      return 'La inscripción está reembolsada y requiere revisión manual.';
    }
    if (String(row.paymentStatus) === 'PAID') {
      return 'La inscripción ya figura como pagada.';
    }
    const paidAmount = Number(row.paidAmount || 0);
    if (String(row.paymentStatus) === 'PARTIAL' || paidAmount > 0.009) {
      return 'La inscripción ya tiene pagos parciales o movimientos previos sin cuenta trazable. Revisá el caso manualmente.';
    }
    const priceAtEnrollment = Number(row.priceAtEnrollment || 0);
    if (!Number.isFinite(priceAtEnrollment) || priceAtEnrollment <= 0) {
      return 'Cargá un precio mayor a 0 para abrir la cuenta de esta clase.';
    }
    return null;
  }

  private mapAccountFinancial(
    row: {
      enrollmentStatus: string;
      classSessionStatus?: string | null;
      paymentStatus: string;
      priceAtEnrollment?: number | null;
      paidAmount?: number | null;
    },
    account?: {
      id: string;
      status: 'OPEN' | 'CLOSED';
      totalAmount: Prisma.Decimal | number;
      paidAmount: Prisma.Decimal | number;
    } | null
  ) {
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
      paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'PARTIAL' ? 'PARTIAL' : 'PENDING';

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
        attendedAt: null,
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
    attendanceStatus:
      | 'PENDING'
      | 'ATTENDED'
      | 'ABSENT'
      | 'NO_SHOW'
      | 'CANCELLED_ON_TIME'
      | 'CANCELLED_LATE',
    attendedAt?: string | null
  ) {
    const existing = await prisma.classEnrollment.findFirst({
      where: {
        id: String(enrollmentId),
        classSessionId: String(classSessionId),
        clubId,
      },
      select: { id: true, enrollmentStatus: true, attendedAt: true },
    });
    if (!existing) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }

    const cancelledAttendanceStatuses = new Set(['CANCELLED_ON_TIME', 'CANCELLED_LATE']);
    const isCancelledEnrollment = existing.enrollmentStatus === 'CANCELLED';
    const isCancelledAttendance = cancelledAttendanceStatuses.has(attendanceStatus);

    if (isCancelledEnrollment && !isCancelledAttendance) {
      throw badRequest(
        'Las inscripciones canceladas solo admiten estados de cancelación de asistencia.',
        ErrorCodes.INVALID_INPUT
      );
    }

    if (!isCancelledEnrollment && isCancelledAttendance) {
      throw badRequest(
        'Usá la cancelación de la inscripción para marcar cancelación a tiempo o tardía.',
        ErrorCodes.INVALID_INPUT
      );
    }

    const resolvedAttendedAt =
      attendanceStatus === 'ATTENDED'
        ? attendedAt
          ? new Date(attendedAt)
          : existing.attendedAt || new Date()
        : null;

    const updated = await prisma.classEnrollment.update({
      where: { id: String(enrollmentId) },
      data: {
        attendanceStatus: attendanceStatus as any,
        attendedAt: resolvedAttendedAt,
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

  async getAccount(clubId: number, enrollmentId: string): Promise<ClassEnrollmentAccountPayload> {
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { id: String(enrollmentId), clubId },
      select: {
        id: true,
        enrollmentStatus: true,
        paymentStatus: true,
        priceAtEnrollment: true,
        paidAmount: true,
        classSession: {
          select: {
            status: true,
          }
        }
      }
    });
    if (!enrollment) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }

    const account = await prisma.account.findFirst({
      where: {
        clubId,
        sourceType: 'CLASS_ENROLLMENT',
        sourceId: String(enrollment.id),
      },
    });

    if (!account) {
      return {
        classEnrollmentId: String(enrollment.id),
        account: null,
        summary: null,
        financialStatus: 'NO_ACCOUNT',
        blockedReason: this.buildAccountBlockedReason({
          enrollmentStatus: String(enrollment.enrollmentStatus || ''),
          classSessionStatus: String(enrollment.classSession?.status || ''),
          paymentStatus: String(enrollment.paymentStatus || ''),
          priceAtEnrollment: Number(enrollment.priceAtEnrollment || 0),
          paidAmount: Number(enrollment.paidAmount || 0),
        }),
      };
    }

    const summary = await this.accountService.getAccountSummary(clubId, account.id);
    const financial = this.mapAccountFinancial(
      {
        enrollmentStatus: String(enrollment.enrollmentStatus || ''),
        classSessionStatus: String(enrollment.classSession?.status || ''),
        paymentStatus: String(enrollment.paymentStatus || ''),
        priceAtEnrollment: Number(enrollment.priceAtEnrollment || 0),
        paidAmount: Number(enrollment.paidAmount || 0),
      },
      {
        id: String(account.id),
        status: account.status,
        totalAmount: account.totalAmount,
        paidAmount: account.paidAmount,
      }
    );

    return {
      classEnrollmentId: String(enrollment.id),
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

  async openAccount(clubId: number, enrollmentId: string): Promise<ClassEnrollmentAccountPayload> {
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { id: String(enrollmentId), clubId },
      select: {
        id: true,
        classSessionId: true,
        studentClientId: true,
        billingResponsibleClientId: true,
      },
    });
    if (!enrollment) {
      throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }

    await Promise.all([
      this.validation.assertClassSessionBelongsToClub(clubId, String(enrollment.classSessionId)),
      this.validation.assertClientBelongsToClub(clubId, String(enrollment.studentClientId)),
      enrollment.billingResponsibleClientId
        ? this.validation.assertClientBelongsToClub(clubId, String(enrollment.billingResponsibleClientId))
        : Promise.resolve(null),
    ]);

    await this.accountService.openAccount({
      clubId,
      sourceType: 'CLASS_ENROLLMENT',
      sourceId: String(enrollment.id),
    });

    return this.getAccount(clubId, String(enrollment.id));
  }
}
