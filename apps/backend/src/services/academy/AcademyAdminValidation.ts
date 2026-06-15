import { prisma } from '../../prisma';
import { ErrorCodes, forbidden, notFound } from '../../errors';

export type AcademyClientSummary = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
};

export class AcademyAdminValidationService {
  async assertClientBelongsToClub(clubId: number, clientId: string): Promise<AcademyClientSummary> {
    const client = await prisma.client.findFirst({
      where: { id: String(clientId), clubId: Number(clubId) },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
      },
    });

    if (!client) {
      throw notFound('Cliente no encontrado para este club.', ErrorCodes.CLIENT_NOT_FOUND);
    }

    return {
      id: String(client.id),
      clubId: Number(client.clubId),
      userId: Number.isFinite(Number(client.userId)) ? Number(client.userId) : null,
      name: String(client.name || '').trim(),
      email: client.email ? String(client.email).trim() : null,
      phone: client.phone ? String(client.phone).trim() : null,
    };
  }

  async assertUserBelongsToClub(clubId: number, userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      select: { id: true, email: true, firstName: true, lastName: true },
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
      id: Number(user.id),
      email: String(user.email || '').trim(),
      firstName: user.firstName ? String(user.firstName).trim() : null,
      lastName: user.lastName ? String(user.lastName).trim() : null,
      linkedClientId: linkedClient?.id ? String(linkedClient.id) : null,
    };
  }

  async assertTeacherBelongsToClub(clubId: number, teacherId: string) {
    const teacher = await prisma.teacher.findFirst({
      where: { id: String(teacherId), clubId: Number(clubId) },
      select: { id: true, clubId: true, displayName: true, isActive: true },
    });
    if (!teacher) {
      throw notFound('Profesor no encontrado para este club.', ErrorCodes.TEACHER_NOT_FOUND);
    }
    return {
      id: String(teacher.id),
      clubId: Number(teacher.clubId),
      displayName: String(teacher.displayName || '').trim(),
      isActive: Boolean(teacher.isActive),
    };
  }

  async assertCourtBelongsToClub(clubId: number, courtId: number) {
    const court = await prisma.court.findFirst({
      where: { id: Number(courtId), clubId: Number(clubId) },
      select: { id: true, clubId: true, name: true },
    });
    if (!court) {
      throw notFound('Cancha no encontrada para este club.', ErrorCodes.COURT_NOT_FOUND);
    }
    return {
      id: Number(court.id),
      clubId: Number(court.clubId),
      name: String(court.name || '').trim(),
    };
  }

  async assertActivityBelongsToClub(clubId: number, activityTypeId: number) {
    const activity = await prisma.activityType.findFirst({
      where: { id: Number(activityTypeId), clubId: Number(clubId) },
      select: { id: true, clubId: true, name: true },
    });
    if (!activity) {
      throw notFound('Actividad no encontrada para este club.', ErrorCodes.ACTIVITY_NOT_FOUND);
    }
    return {
      id: Number(activity.id),
      clubId: Number(activity.clubId),
      name: String(activity.name || '').trim(),
    };
  }

  async assertClassSessionBelongsToClub(clubId: number, classSessionId: string) {
    const classSession = await prisma.classSession.findFirst({
      where: { id: String(classSessionId), clubId: Number(clubId) },
      select: {
        id: true,
        clubId: true,
        teacherId: true,
        classType: true,
        capacity: true,
        pricePerStudent: true,
        status: true,
      },
    });
    if (!classSession) {
      throw notFound('Clase no encontrada para este club.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    }
    return classSession;
  }

  async assertClassEnrollmentBelongsToClub(clubId: number, enrollmentId: string) {
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { id: String(enrollmentId), clubId: Number(clubId) },
      select: {
        id: true,
        clubId: true,
        classSessionId: true,
        studentClientId: true,
        studentUserId: true,
        enrollmentStatus: true,
        attendanceStatus: true,
        paymentStatus: true,
      },
    });
    if (!enrollment) {
      throw notFound('Inscripción no encontrada para este club.', ErrorCodes.CLASS_ENROLLMENT_NOT_FOUND);
    }
    return enrollment;
  }

  async assertClassPassBelongsToClub(clubId: number, classPassId: string) {
    const classPass = await prisma.classPass.findFirst({
      where: { id: String(classPassId), clubId: Number(clubId) },
      select: {
        id: true,
        clubId: true,
        ownerClientId: true,
        ownerUserId: true,
        beneficiaryClientId: true,
        beneficiaryUserId: true,
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
    });
    if (!classPass) {
      throw notFound('Pack de clases no encontrado para este club.', ErrorCodes.CLASS_PASS_NOT_FOUND);
    }
    return classPass;
  }
}
