import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString } from './academyAdminUtils';

type ClassCreditUsageReasonValue =
  | 'ATTENDANCE'
  | 'LATE_CANCEL'
  | 'NO_SHOW'
  | 'MANUAL_ADJUSTMENT'
  | 'REFUND_REVERSAL';

type CreateClassCreditUsageInput = {
  classEnrollmentId: string;
  creditsUsed: number;
  reason: ClassCreditUsageReasonValue;
  notes?: string | null;
};

type ClassCreditUsageSummary = {
  id: string;
  clubId: number;
  classPassId: string;
  classEnrollmentId: string;
  creditsUsed: number;
  usedAt: string;
  reason: string;
  notes: string | null;
  createdByUserId: number;
  classPass: {
    id: string;
    packageName: string;
    beneficiaryClientId: string;
    remainingCredits: number;
    status: string;
  } | null;
  classEnrollment: {
    id: string;
    studentClientId: string;
    snapshotName: string;
    enrollmentStatus: string;
    paymentStatus: string;
    classSessionId: string;
  } | null;
  createdByUser: {
    id: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export class ClassCreditUsageAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private mapRow(row: any): ClassCreditUsageSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      classPassId: String(row.classPassId),
      classEnrollmentId: String(row.classEnrollmentId),
      creditsUsed: Number(row.creditsUsed),
      usedAt: new Date(row.usedAt).toISOString(),
      reason: String(row.reason),
      notes: normalizeOptionalString(row.notes),
      createdByUserId: Number(row.createdByUserId),
      classPass: row.classPass
        ? {
            id: String(row.classPass.id),
            packageName: String(row.classPass.packageName || '').trim(),
            beneficiaryClientId: String(row.classPass.beneficiaryClientId),
            remainingCredits: Number(row.classPass.remainingCredits),
            status: String(row.classPass.status),
          }
        : null,
      classEnrollment: row.classEnrollment
        ? {
            id: String(row.classEnrollment.id),
            studentClientId: String(row.classEnrollment.studentClientId),
            snapshotName: String(row.classEnrollment.snapshotName || '').trim(),
            enrollmentStatus: String(row.classEnrollment.enrollmentStatus),
            paymentStatus: String(row.classEnrollment.paymentStatus),
            classSessionId: String(row.classEnrollment.classSessionId),
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

  private ensurePositiveCredits(creditsUsed: number) {
    const parsed = Number(creditsUsed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw badRequest('La cantidad de créditos a consumir debe ser mayor a 0.', ErrorCodes.INVALID_INPUT);
    }
    return parsed;
  }

  private effectivePassStatus(row: { status: string; expiresAt?: Date | string | null; remainingCredits: number }) {
    if (String(row.status) === 'CANCELLED') return 'CANCELLED' as const;
    if (Number(row.remainingCredits) <= 0 || String(row.status) === 'DEPLETED') return 'DEPLETED' as const;
    if (row.expiresAt) {
      const expiresAt = new Date(row.expiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
        return 'EXPIRED' as const;
      }
    }
    return 'ACTIVE' as const;
  }

  async listByClassPass(clubId: number, classPassId: string) {
    await this.validation.assertClassPassBelongsToClub(clubId, classPassId);
    const rows = await prisma.classCreditUsage.findMany({
      where: { clubId, classPassId: String(classPassId) },
      include: {
        classPass: { select: { id: true, packageName: true, beneficiaryClientId: true, remainingCredits: true, status: true } },
        classEnrollment: {
          select: {
            id: true,
            studentClientId: true,
            snapshotName: true,
            enrollmentStatus: true,
            paymentStatus: true,
            classSessionId: true,
          },
        },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ usedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.mapRow(row));
  }

  async listByEnrollment(clubId: number, classEnrollmentId: string) {
    await this.validation.assertClassEnrollmentBelongsToClub(clubId, classEnrollmentId);
    const rows = await prisma.classCreditUsage.findMany({
      where: { clubId, classEnrollmentId: String(classEnrollmentId) },
      include: {
        classPass: { select: { id: true, packageName: true, beneficiaryClientId: true, remainingCredits: true, status: true } },
        classEnrollment: {
          select: {
            id: true,
            studentClientId: true,
            snapshotName: true,
            enrollmentStatus: true,
            paymentStatus: true,
            classSessionId: true,
          },
        },
        createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ usedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.mapRow(row));
  }

  async create(clubId: number, classPassId: string, actorUserId: number, input: CreateClassCreditUsageInput) {
    await this.validation.assertUserBelongsToClub(clubId, actorUserId);

    const safeClassPassId = String(classPassId || '').trim();
    if (!safeClassPassId) {
      throw badRequest('Pack inválido.', ErrorCodes.INVALID_INPUT);
    }

    const safeEnrollmentId = String(input.classEnrollmentId || '').trim();
    if (!safeEnrollmentId) {
      throw badRequest('Inscripción inválida.', ErrorCodes.INVALID_INPUT);
    }

    const creditsUsed = this.ensurePositiveCredits(input.creditsUsed);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const [classPass, classEnrollment] = await Promise.all([
          tx.classPass.findFirst({
            where: { id: safeClassPassId, clubId },
            select: {
              id: true,
              clubId: true,
              ownerClientId: true,
              beneficiaryClientId: true,
              activityTypeId: true,
              classType: true,
              teacherId: true,
              totalCredits: true,
              usedCredits: true,
              remainingCredits: true,
              expiresAt: true,
              transferable: true,
              status: true,
            },
          }),
          tx.classEnrollment.findFirst({
            where: { id: safeEnrollmentId, clubId },
            select: {
              id: true,
              clubId: true,
              classSessionId: true,
              studentClientId: true,
              enrollmentStatus: true,
              attendanceStatus: true,
              paymentStatus: true,
              classSession: {
                select: {
                  id: true,
                  teacherId: true,
                  activityTypeId: true,
                  classType: true,
                },
              },
            },
          }),
        ]);

        if (!classPass) {
          throw notFound('Pack de clases no encontrado.', ErrorCodes.CLASS_PASS_NOT_FOUND);
        }

        if (!classEnrollment) {
          throw notFound('Inscripción no encontrada.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
        }

        const effectiveStatus = this.effectivePassStatus({
          status: String(classPass.status),
          expiresAt: classPass.expiresAt,
          remainingCredits: Number(classPass.remainingCredits),
        });
        if (effectiveStatus !== 'ACTIVE') {
          throw badRequest('El pack no está disponible para consumir créditos.', ErrorCodes.CLASS_PASS_INVALID_STATUS);
        }

        if (Number(classPass.totalCredits) !== Number(classPass.usedCredits) + Number(classPass.remainingCredits)) {
          throw badRequest('El pack tiene un saldo inconsistente.', ErrorCodes.INVALID_INPUT);
        }

        if (Number(classPass.remainingCredits) < creditsUsed) {
          throw conflict('El pack no tiene créditos suficientes.', ErrorCodes.CLASS_PASS_INSUFFICIENT_CREDITS);
        }

        if (!classPass.transferable && classEnrollment.studentClientId !== classPass.beneficiaryClientId) {
          throw badRequest(
            'Este pack solo puede usarse para el beneficiario configurado.',
            ErrorCodes.CLASS_PASS_ENROLLMENT_MISMATCH
          );
        }

        if (classPass.activityTypeId && classEnrollment.classSession.activityTypeId !== Number(classPass.activityTypeId)) {
          throw badRequest(
            'El pack no aplica a la actividad de esta clase.',
            ErrorCodes.CLASS_PASS_ENROLLMENT_MISMATCH
          );
        }

        if (classPass.classType && classEnrollment.classSession.classType !== classPass.classType) {
          throw badRequest(
            'El pack no aplica al formato de esta clase.',
            ErrorCodes.CLASS_PASS_ENROLLMENT_MISMATCH
          );
        }

        if (classPass.teacherId && classEnrollment.classSession.teacherId !== classPass.teacherId) {
          throw badRequest(
            'El pack no aplica al profesor de esta clase.',
            ErrorCodes.CLASS_PASS_ENROLLMENT_MISMATCH
          );
        }

        if (
          classEnrollment.enrollmentStatus === 'CANCELLED' &&
          !['LATE_CANCEL', 'NO_SHOW'].includes(String(input.reason))
        ) {
          throw badRequest(
            'Las inscripciones canceladas solo admiten consumo por cancelación tardía o no show.',
            ErrorCodes.INVALID_INPUT
          );
        }

        if (!['UNPAID', 'PARTIAL'].includes(String(classEnrollment.paymentStatus))) {
          throw badRequest(
            'La inscripción ya tiene un estado de pago que no permite cubrirla con crédito.',
            ErrorCodes.INVALID_INPUT
          );
        }

        const classEnrollmentAccount = await tx.account.findFirst({
          where: {
            clubId,
            sourceType: 'CLASS_ENROLLMENT',
            sourceId: safeEnrollmentId,
          },
          select: {
            id: true,
            totalAmount: true,
            paidAmount: true,
          },
        });

        if (classEnrollmentAccount) {
          const paidAmount = Number(classEnrollmentAccount.paidAmount || 0);
          const totalAmount = Number(classEnrollmentAccount.totalAmount || 0);
          if (paidAmount > 0.009 || totalAmount > 0.009) {
            throw conflict(
              'La inscripción ya tiene una cuenta financiera abierta o registrada. Revisá la cuenta antes de cubrirla con crédito.',
              ErrorCodes.CLASS_ENROLLMENT_INVALID_STATUS
            );
          }
        }

        const usage = await tx.classCreditUsage.create({
          data: {
            clubId,
            classPassId: safeClassPassId,
            classEnrollmentId: safeEnrollmentId,
            creditsUsed,
            reason: input.reason as any,
            notes: normalizeOptionalString(input.notes),
            createdByUserId: Number(actorUserId),
          },
        });

        const updatedPass = await tx.classPass.updateMany({
          where: {
            id: safeClassPassId,
            clubId,
            status: 'ACTIVE',
            remainingCredits: { gte: creditsUsed },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          data: {
            usedCredits: { increment: creditsUsed },
            remainingCredits: { decrement: creditsUsed },
          },
        });

        if (updatedPass.count !== 1) {
          throw conflict('El pack ya no tiene créditos disponibles.', ErrorCodes.CLASS_PASS_INSUFFICIENT_CREDITS);
        }

        const refreshedPass = await tx.classPass.findFirstOrThrow({
          where: { id: safeClassPassId, clubId },
          select: { id: true, remainingCredits: true },
        });

        if (Number(refreshedPass.remainingCredits) === 0) {
          await tx.classPass.update({
            where: { id: safeClassPassId },
            data: { status: 'DEPLETED' },
          });
        }

        await tx.classEnrollment.update({
          where: { id: safeEnrollmentId },
          data: {
            paymentStatus: 'COVERED_BY_CREDIT',
          },
        });

        return tx.classCreditUsage.findFirstOrThrow({
          where: { id: usage.id, clubId },
          include: {
            classPass: { select: { id: true, packageName: true, beneficiaryClientId: true, remainingCredits: true, status: true } },
            classEnrollment: {
              select: {
                id: true,
                studentClientId: true,
                snapshotName: true,
                enrollmentStatus: true,
                paymentStatus: true,
                classSessionId: true,
              },
            },
            createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return this.mapRow(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict(
          'Ese pack ya fue consumido para esta inscripción.',
          ErrorCodes.CLASS_CREDIT_USAGE_CONFLICT
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw conflict(
          'El pack cambió mientras intentabas consumirlo. Actualizá e intentá de nuevo.',
          ErrorCodes.CLASS_CREDIT_USAGE_CONFLICT
        );
      }
      throw error;
    }
  }
}
