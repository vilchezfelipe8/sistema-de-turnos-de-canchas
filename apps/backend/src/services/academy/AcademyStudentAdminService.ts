import { prisma } from '../../prisma';
import { ErrorCodes, notFound } from '../../errors';
import { AcademyAdminValidationService } from './AcademyAdminValidation';
import { normalizeOptionalString } from './academyAdminUtils';

type AcademyLinkedUserSummary = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type AcademyStudentClientSummary = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUser: AcademyLinkedUserSummary | null;
};

type AcademyStudentEnrollmentSummary = {
  id: string;
  classSessionId: string;
  snapshotName: string;
  billingResponsibleClientId: string | null;
  priceAtEnrollment: number;
  paidAmount: number;
  enrollmentStatus: string;
  attendanceStatus: string;
  paymentStatus: string;
  cancelledAt: string | null;
  attendedAt: string | null;
  notes: string | null;
  classSession: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    visibility: string;
    classType: string;
    teacher: { id: string; displayName: string; isActive: boolean } | null;
    activityType: { id: number; name: string } | null;
    court: { id: number; name: string } | null;
  };
  billingResponsibleClient: { id: string; name: string } | null;
};

type AcademyStudentRelationshipSummary = {
  id: string;
  relationshipType: string;
  canPayFor: boolean;
  canManageEnrollments: boolean;
  canViewSchedule: boolean;
  canCancelClass: boolean;
  canViewPayments: boolean;
  notes: string | null;
  fromClient: { id: string; name: string } | null;
  toClient: { id: string; name: string } | null;
};

type AcademyStudentPassSummary = {
  id: string;
  ownerClientId: string;
  beneficiaryClientId: string;
  packageName: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  expiresAt: string | null;
  classType: string | null;
  transferable: boolean;
  status: string;
  purchasedAt: string;
  notes: string | null;
  ownerClient: { id: string; name: string } | null;
  beneficiaryClient: { id: string; name: string } | null;
  activityType: { id: number; name: string } | null;
  teacher: { id: string; displayName: string; isActive: boolean } | null;
  recentUsages: Array<{
    id: string;
    usedAt: string;
    reason: string;
    creditsUsed: number;
    classEnrollmentId: string;
  }>;
};

type AcademyStudentCreditUsageSummary = {
  id: string;
  classPassId: string;
  classEnrollmentId: string;
  creditsUsed: number;
  usedAt: string;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdByUser: AcademyLinkedUserSummary | null;
  classPass: {
    id: string;
    packageName: string;
    beneficiaryClientId: string;
    remainingCredits: number;
    status: string;
  } | null;
  classEnrollment: {
    id: string;
    snapshotName: string;
    enrollmentStatus: string;
    attendanceStatus: string;
    paymentStatus: string;
    classSessionId: string;
    classSession: {
      id: string;
      startsAt: string;
      endsAt: string;
      teacher: { id: string; displayName: string; isActive: boolean } | null;
      activityType: { id: number; name: string } | null;
    } | null;
  } | null;
};

export type AcademyStudentListItem = {
  client: AcademyStudentClientSummary;
  summary: {
    upcomingEnrollmentsCount: number;
    pastEnrollmentsCount: number;
    activePassesCount: number;
    ownedPassesCount: number;
    totalRemainingCredits: number;
    totalCreditUsages: number;
    incomingRelationshipsCount: number;
    outgoingRelationshipsCount: number;
  };
  nextClassAt: string | null;
  lastClassAt: string | null;
};

export type AcademyStudentOverview = {
  client: AcademyStudentClientSummary;
  summary: {
    upcomingEnrollmentsCount: number;
    pastEnrollmentsCount: number;
    activePassesCount: number;
    ownedPassesCount: number;
    totalRemainingCredits: number;
    totalCreditUsages: number;
  };
  billingResponsibles: Array<{ id: string; name: string }>;
  upcomingEnrollments: AcademyStudentEnrollmentSummary[];
  pastEnrollments: AcademyStudentEnrollmentSummary[];
  beneficiaryPasses: AcademyStudentPassSummary[];
  ownedPasses: AcademyStudentPassSummary[];
  creditUsages: AcademyStudentCreditUsageSummary[];
  incomingRelationships: AcademyStudentRelationshipSummary[];
  outgoingRelationships: AcademyStudentRelationshipSummary[];
};

const toIsoOrNull = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export class AcademyStudentAdminService {
  private readonly validation = new AcademyAdminValidationService();

  private effectivePassStatus(row: { status: string; expiresAt?: Date | string | null; remainingCredits?: number | null }) {
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

  private mapLinkedUser(row: any): AcademyLinkedUserSummary | null {
    if (!row) return null;
    return {
      id: Number(row.id),
      email: String(row.email || '').trim(),
      firstName: normalizeOptionalString(row.firstName),
      lastName: normalizeOptionalString(row.lastName),
    };
  }

  private mapClient(row: any): AcademyStudentClientSummary {
    return {
      id: String(row.id),
      clubId: Number(row.clubId),
      userId: Number.isFinite(Number(row.userId)) ? Number(row.userId) : null,
      name: String(row.name || '').trim(),
      email: normalizeOptionalString(row.email),
      phone: normalizeOptionalString(row.phone),
      linkedUser: this.mapLinkedUser(row.user),
    };
  }

  private mapEnrollment(row: any): AcademyStudentEnrollmentSummary {
    return {
      id: String(row.id),
      classSessionId: String(row.classSessionId),
      snapshotName: String(row.snapshotName || '').trim(),
      billingResponsibleClientId: row.billingResponsibleClientId ? String(row.billingResponsibleClientId) : null,
      priceAtEnrollment: Number(row.priceAtEnrollment || 0),
      paidAmount: Number(row.paidAmount || 0),
      enrollmentStatus: String(row.enrollmentStatus),
      attendanceStatus: String(row.attendanceStatus),
      paymentStatus: String(row.paymentStatus),
      cancelledAt: toIsoOrNull(row.cancelledAt),
      attendedAt: toIsoOrNull(row.attendedAt),
      notes: normalizeOptionalString(row.notes),
      classSession: {
        id: String(row.classSession.id),
        startsAt: new Date(row.classSession.startsAt).toISOString(),
        endsAt: new Date(row.classSession.endsAt).toISOString(),
        status: String(row.classSession.status),
        visibility: String(row.classSession.visibility),
        classType: String(row.classSession.classType),
        teacher: row.classSession.teacher
          ? {
              id: String(row.classSession.teacher.id),
              displayName: String(row.classSession.teacher.displayName || '').trim(),
              isActive: Boolean(row.classSession.teacher.isActive),
            }
          : null,
        activityType: row.classSession.activityType
          ? {
              id: Number(row.classSession.activityType.id),
              name: String(row.classSession.activityType.name || '').trim(),
            }
          : null,
        court: row.classSession.court
          ? {
              id: Number(row.classSession.court.id),
              name: String(row.classSession.court.name || '').trim(),
            }
          : null,
      },
      billingResponsibleClient: row.billingResponsibleClient
        ? {
            id: String(row.billingResponsibleClient.id),
            name: String(row.billingResponsibleClient.name || '').trim(),
          }
        : null,
    };
  }

  private mapRelationship(row: any): AcademyStudentRelationshipSummary {
    return {
      id: String(row.id),
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
    };
  }

  private mapPass(row: any): AcademyStudentPassSummary {
    return {
      id: String(row.id),
      ownerClientId: String(row.ownerClientId),
      beneficiaryClientId: String(row.beneficiaryClientId),
      packageName: String(row.packageName || '').trim(),
      totalCredits: Number(row.totalCredits),
      usedCredits: Number(row.usedCredits),
      remainingCredits: Number(row.remainingCredits),
      expiresAt: toIsoOrNull(row.expiresAt),
      classType: row.classType ? String(row.classType) : null,
      transferable: Boolean(row.transferable),
      status: this.effectivePassStatus(row),
      purchasedAt: new Date(row.purchasedAt).toISOString(),
      notes: normalizeOptionalString(row.notes),
      ownerClient: row.ownerClient
        ? { id: String(row.ownerClient.id), name: String(row.ownerClient.name || '').trim() }
        : null,
      beneficiaryClient: row.beneficiaryClient
        ? { id: String(row.beneficiaryClient.id), name: String(row.beneficiaryClient.name || '').trim() }
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
      recentUsages: Array.isArray(row.usages)
        ? row.usages.map((usage: any) => ({
            id: String(usage.id),
            usedAt: new Date(usage.usedAt).toISOString(),
            reason: String(usage.reason),
            creditsUsed: Number(usage.creditsUsed),
            classEnrollmentId: String(usage.classEnrollmentId),
          }))
        : [],
    };
  }

  private mapCreditUsage(row: any): AcademyStudentCreditUsageSummary {
    return {
      id: String(row.id),
      classPassId: String(row.classPassId),
      classEnrollmentId: String(row.classEnrollmentId),
      creditsUsed: Number(row.creditsUsed),
      usedAt: new Date(row.usedAt).toISOString(),
      reason: String(row.reason),
      notes: normalizeOptionalString(row.notes),
      createdAt: new Date(row.createdAt).toISOString(),
      createdByUser: this.mapLinkedUser(row.createdByUser),
      classPass: row.classPass
        ? {
            id: String(row.classPass.id),
            packageName: String(row.classPass.packageName || '').trim(),
            beneficiaryClientId: String(row.classPass.beneficiaryClientId),
            remainingCredits: Number(row.classPass.remainingCredits || 0),
            status: this.effectivePassStatus(row.classPass),
          }
        : null,
      classEnrollment: row.classEnrollment
        ? {
            id: String(row.classEnrollment.id),
            snapshotName: String(row.classEnrollment.snapshotName || '').trim(),
            enrollmentStatus: String(row.classEnrollment.enrollmentStatus),
            attendanceStatus: String(row.classEnrollment.attendanceStatus),
            paymentStatus: String(row.classEnrollment.paymentStatus),
            classSessionId: String(row.classEnrollment.classSessionId),
            classSession: row.classEnrollment.classSession
              ? {
                  id: String(row.classEnrollment.classSession.id),
                  startsAt: new Date(row.classEnrollment.classSession.startsAt).toISOString(),
                  endsAt: new Date(row.classEnrollment.classSession.endsAt).toISOString(),
                  teacher: row.classEnrollment.classSession.teacher
                    ? {
                        id: String(row.classEnrollment.classSession.teacher.id),
                        displayName: String(row.classEnrollment.classSession.teacher.displayName || '').trim(),
                        isActive: Boolean(row.classEnrollment.classSession.teacher.isActive),
                      }
                    : null,
                  activityType: row.classEnrollment.classSession.activityType
                    ? {
                        id: Number(row.classEnrollment.classSession.activityType.id),
                        name: String(row.classEnrollment.classSession.activityType.name || '').trim(),
                      }
                    : null,
                }
              : null,
          }
        : null,
    };
  }

  async listByClub(clubId: number, filters?: { q?: string }) {
    const q = normalizeOptionalString(filters?.q);
    const rows = await prisma.client.findMany({
      where: {
        clubId,
        AND: [
          {
            OR: [
              { studentClassEnrollments: { some: { clubId } } },
              { beneficiaryClassPasses: { some: { clubId } } },
              { ownedClassPasses: { some: { clubId } } },
              { incomingClientRelationships: { some: { clubId } } },
              { outgoingClientRelationships: { some: { clubId } } },
            ],
          },
          ...(q
            ? [
                {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { email: { contains: q, mode: 'insensitive' as const } },
                    { phone: { contains: q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        studentClassEnrollments: {
          select: {
            id: true,
            enrollmentStatus: true,
            classSession: { select: { startsAt: true, status: true } },
          },
        },
        beneficiaryClassPasses: {
          select: {
            id: true,
            status: true,
            remainingCredits: true,
            expiresAt: true,
          },
        },
        ownedClassPasses: {
          select: { id: true },
        },
        incomingClientRelationships: { select: { id: true } },
        outgoingClientRelationships: { select: { id: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const now = Date.now();

    return rows.map((row) => {
      const activeUpcomingEnrollments = row.studentClassEnrollments.filter((enrollment) => {
        const startsAt = new Date(enrollment.classSession.startsAt).getTime();
        return (
          Number.isFinite(startsAt) &&
          startsAt >= now &&
          String(enrollment.enrollmentStatus) !== 'CANCELLED' &&
          String(enrollment.classSession.status) !== 'CANCELLED'
        );
      });
      const upcomingEnrollmentsCount = activeUpcomingEnrollments.length;
      const pastEnrollmentsCount = Math.max(0, row.studentClassEnrollments.length - upcomingEnrollmentsCount);
      const activePasses = row.beneficiaryClassPasses.filter((classPass) => this.effectivePassStatus(classPass) === 'ACTIVE');
      const historicalClassTimes = row.studentClassEnrollments
        .filter((enrollment) => {
          const startsAt = new Date(enrollment.classSession.startsAt).getTime();
          return (
            Number.isFinite(startsAt) &&
            (
              startsAt < now ||
              String(enrollment.enrollmentStatus) === 'CANCELLED' ||
              String(enrollment.classSession.status) === 'CANCELLED'
            )
          );
        })
        .map((enrollment) => new Date(enrollment.classSession.startsAt).getTime())
        .sort((a, b) => a - b);

      const nextClassAt =
        activeUpcomingEnrollments
          .map((enrollment) => new Date(enrollment.classSession.startsAt).getTime())
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b)[0] ?? null;
      const lastClassAt = historicalClassTimes.length ? historicalClassTimes[historicalClassTimes.length - 1] : null;

      return {
        client: this.mapClient(row),
        summary: {
          upcomingEnrollmentsCount,
          pastEnrollmentsCount,
          activePassesCount: activePasses.length,
          ownedPassesCount: row.ownedClassPasses.length,
          totalRemainingCredits: activePasses.reduce((total, classPass) => total + Number(classPass.remainingCredits || 0), 0),
          totalCreditUsages: 0,
          incomingRelationshipsCount: row.incomingClientRelationships.length,
          outgoingRelationshipsCount: row.outgoingClientRelationships.length,
        },
        nextClassAt: nextClassAt ? new Date(nextClassAt).toISOString() : null,
        lastClassAt: lastClassAt ? new Date(lastClassAt).toISOString() : null,
      };
    });
  }

  async getOverview(clubId: number, clientId: string): Promise<AcademyStudentOverview> {
    const client = await prisma.client.findFirst({
      where: { id: String(clientId), clubId },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    if (!client) {
      throw notFound('Alumno no encontrado para este club.', ErrorCodes.CLIENT_NOT_FOUND);
    }

    await this.validation.assertClientBelongsToClub(clubId, clientId);

    const [enrollments, beneficiaryPasses, ownedPasses, creditUsages, incomingRelationships, outgoingRelationships] =
      await Promise.all([
        prisma.classEnrollment.findMany({
          where: { clubId, studentClientId: String(clientId) },
          include: {
            billingResponsibleClient: { select: { id: true, name: true } },
            classSession: {
              select: {
                id: true,
                startsAt: true,
                endsAt: true,
                status: true,
                visibility: true,
                classType: true,
                teacher: { select: { id: true, displayName: true, isActive: true } },
                activityType: { select: { id: true, name: true } },
                court: { select: { id: true, name: true } },
              },
            },
          },
        }),
        prisma.classPass.findMany({
          where: { clubId, beneficiaryClientId: String(clientId) },
          include: {
            ownerClient: { select: { id: true, name: true } },
            beneficiaryClient: { select: { id: true, name: true } },
            activityType: { select: { id: true, name: true } },
            teacher: { select: { id: true, displayName: true, isActive: true } },
            usages: {
              select: { id: true, usedAt: true, reason: true, creditsUsed: true, classEnrollmentId: true },
              orderBy: [{ usedAt: 'desc' }, { createdAt: 'desc' }],
              take: 3,
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        }),
        prisma.classPass.findMany({
          where: { clubId, ownerClientId: String(clientId) },
          include: {
            ownerClient: { select: { id: true, name: true } },
            beneficiaryClient: { select: { id: true, name: true } },
            activityType: { select: { id: true, name: true } },
            teacher: { select: { id: true, displayName: true, isActive: true } },
            usages: {
              select: { id: true, usedAt: true, reason: true, creditsUsed: true, classEnrollmentId: true },
              orderBy: [{ usedAt: 'desc' }, { createdAt: 'desc' }],
              take: 3,
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        }),
        prisma.classCreditUsage.findMany({
          where: {
            clubId,
            OR: [
              { classEnrollment: { studentClientId: String(clientId) } },
              { classPass: { beneficiaryClientId: String(clientId) } },
            ],
          },
          include: {
            createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
            classPass: {
              select: {
                id: true,
                packageName: true,
                beneficiaryClientId: true,
                remainingCredits: true,
                status: true,
                expiresAt: true,
              },
            },
            classEnrollment: {
              select: {
                id: true,
                snapshotName: true,
                enrollmentStatus: true,
                attendanceStatus: true,
                paymentStatus: true,
                classSessionId: true,
                classSession: {
                  select: {
                    id: true,
                    startsAt: true,
                    endsAt: true,
                    teacher: { select: { id: true, displayName: true, isActive: true } },
                    activityType: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
          orderBy: [{ usedAt: 'desc' }, { createdAt: 'desc' }],
        }),
        prisma.clientRelationship.findMany({
          where: { clubId, toClientId: String(clientId) },
          include: {
            fromClient: { select: { id: true, name: true } },
            toClient: { select: { id: true, name: true } },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        }),
        prisma.clientRelationship.findMany({
          where: { clubId, fromClientId: String(clientId) },
          include: {
            fromClient: { select: { id: true, name: true } },
            toClient: { select: { id: true, name: true } },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

    const now = Date.now();
    const mappedEnrollments = enrollments.map((row) => this.mapEnrollment(row));
    const upcomingEnrollments = mappedEnrollments
      .filter(
        (row) =>
          new Date(row.classSession.startsAt).getTime() >= now &&
          row.enrollmentStatus !== 'CANCELLED' &&
          row.classSession.status !== 'CANCELLED'
      )
      .sort((a, b) => new Date(a.classSession.startsAt).getTime() - new Date(b.classSession.startsAt).getTime());
    const pastEnrollments = mappedEnrollments
      .filter(
        (row) =>
          new Date(row.classSession.startsAt).getTime() < now ||
          row.enrollmentStatus === 'CANCELLED' ||
          row.classSession.status === 'CANCELLED'
      )
      .sort((a, b) => new Date(b.classSession.startsAt).getTime() - new Date(a.classSession.startsAt).getTime());

    const mappedBeneficiaryPasses = beneficiaryPasses.map((row) => this.mapPass(row));
    const mappedOwnedPasses = ownedPasses.map((row) => this.mapPass(row));
    const mappedIncomingRelationships = incomingRelationships.map((row) => this.mapRelationship(row));
    const mappedOutgoingRelationships = outgoingRelationships.map((row) => this.mapRelationship(row));
    const mappedCreditUsages = creditUsages.map((row) => this.mapCreditUsage(row));

    const activePassesCount = mappedBeneficiaryPasses.filter((row) => row.status === 'ACTIVE').length;
    const totalRemainingCredits = mappedBeneficiaryPasses
      .filter((row) => row.status === 'ACTIVE')
      .reduce((total, row) => total + row.remainingCredits, 0);

    const billingResponsibles = Array.from(
      new Map(
        mappedEnrollments
          .filter((row) => row.billingResponsibleClient)
          .map((row) => [row.billingResponsibleClient!.id, row.billingResponsibleClient!])
      ).values()
    );

    return {
      client: this.mapClient(client),
      summary: {
        upcomingEnrollmentsCount: upcomingEnrollments.length,
        pastEnrollmentsCount: pastEnrollments.length,
        activePassesCount,
        ownedPassesCount: mappedOwnedPasses.length,
        totalRemainingCredits,
        totalCreditUsages: mappedCreditUsages.length,
      },
      billingResponsibles,
      upcomingEnrollments,
      pastEnrollments,
      beneficiaryPasses: mappedBeneficiaryPasses,
      ownedPasses: mappedOwnedPasses,
      creditUsages: mappedCreditUsages,
      incomingRelationships: mappedIncomingRelationships,
      outgoingRelationships: mappedOutgoingRelationships,
    };
  }
}
