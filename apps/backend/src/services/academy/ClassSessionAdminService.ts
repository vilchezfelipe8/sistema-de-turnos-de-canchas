import { Prisma } from '@prisma/client';
import { toZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { AccountService } from '../AccountService';
import { pushNotificationService } from '../PushNotificationService';
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
  /** Curso al que pertenece (clase con días fijos). Null = clase suelta. */
  seriesId: string | null;
  series: { id: string; weekdays: number[]; startTime: string; status: string; visibility: string; pendingRequests: number } | null;
  /** Alumnos anotados (sin contar en espera ni cancelados). Solo viene en el listado. */
  enrolledCount?: number;
};

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class ClassSessionAdminService {
  private readonly validation = new AcademyAdminValidationService();
  private readonly accountService = new AccountService();

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
      seriesId: row.seriesId ? String(row.seriesId) : null,
      series: row.series
        ? {
            id: String(row.series.id),
            weekdays: Array.isArray(row.series.weekdays) ? row.series.weekdays.map(Number) : [],
            startTime: String(row.series.startTime),
            status: String(row.series.status),
            visibility: String(row.series.visibility || 'PRIVATE'),
            pendingRequests: Number(row.series._count?.members || 0),
          }
        : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      ...(row._count && Number.isFinite(Number(row._count.enrollments))
        ? { enrolledCount: Number(row._count.enrollments) }
        : {}),
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
        series: { select: { id: true, weekdays: true, startTime: true, status: true, visibility: true, _count: { select: { members: { where: { leftAt: null, status: 'PENDING' } } } } } },
        _count: { select: { enrollments: { where: { enrollmentStatus: 'ENROLLED' } } } },
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
        series: { select: { id: true, weekdays: true, startTime: true, status: true, visibility: true, _count: { select: { members: { where: { leftAt: null, status: 'PENDING' } } } } } },
      },
    });
    if (!row) {
      throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    }
    return this.mapRow(row);
  }

  async create(clubId: number, actorUserId: number, input: ClassSessionInput) {
    // Una clase nueva siempre arranca programada: cancelarla o cerrarla tiene su propio camino.
    const data = await this.validateInput(clubId, actorUserId, { ...input, status: 'SCHEDULED' });
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
        series: { select: { id: true, weekdays: true, startTime: true, status: true, visibility: true, _count: { select: { members: { where: { leftAt: null, status: 'PENDING' } } } } } },
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
      // El estado no se edita a mano: se cancela, se reactiva o se cierra sola al pasar.
      status: existing.status as any,
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
        series: { select: { id: true, weekdays: true, startTime: true, status: true, visibility: true, _count: { select: { members: { where: { leftAt: null, status: 'PENDING' } } } } } },
      },
    });
    return this.mapRow(updated);
  }

  /**
   * Único cambio de estado a mano: cancelar (CANCELLED) o reactivar (SCHEDULED).
   * Completada la pone el scheduler cuando la clase termina.
   */
  async setStatus(clubId: number, classSessionId: string, status: ClassSessionInput['status'], actorUserId: number) {
    if (status === 'CANCELLED') return this.cancel(clubId, classSessionId, actorUserId);
    if (status === 'SCHEDULED') return this.reactivate(clubId, classSessionId, actorUserId);
    throw badRequest('La clase solo se puede cancelar o reactivar.', ErrorCodes.INVALID_INPUT);
  }

  private readonly sessionInclude = {
    teacher: { select: { id: true, displayName: true, isActive: true } },
    court: { select: { id: true, name: true } },
    activityType: { select: { id: true, name: true } },
    createdByUser: { select: { id: true, email: true, firstName: true, lastName: true } },
    series: { select: { id: true, weekdays: true, startTime: true, status: true, visibility: true, _count: { select: { members: { where: { leftAt: null, status: 'PENDING' as const } } } } } },
  };

  /**
   * Cancela la clase y todo lo que cuelga de ella: los alumnos quedan cancelados a tiempo, se
   * devuelven las clases que se habían usado de packs o planes, se anula lo que faltaba pagar
   * y se avisa por push a los alumnos con cuenta. Lo ya pagado queda en su cuenta para devolverlo
   * desde Caja.
   */
  async cancel(clubId: number, classSessionId: string, actorUserId: number) {
    const session = await prisma.classSession.findFirst({
      where: { id: String(classSessionId), clubId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        teacher: { select: { displayName: true } },
        activityType: { select: { name: true } },
      },
    });
    if (!session) throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (session.status === 'CANCELLED') throw conflict('La clase ya está cancelada.', ErrorCodes.INVALID_INPUT);
    if (session.endsAt.getTime() <= Date.now()) {
      throw conflict('La clase ya pasó: no se puede cancelar.', ErrorCodes.INVALID_INPUT);
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await tx.classSession.update({ where: { id: session.id }, data: { status: 'CANCELLED' } });
      const enrollments = await tx.classEnrollment.findMany({
        where: { classSessionId: session.id, clubId, enrollmentStatus: { not: 'CANCELLED' } },
        select: {
          id: true,
          enrollmentStatus: true,
          studentUserId: true,
          studentClient: { select: { name: true } },
          creditUsages: { select: { id: true, classPassId: true, creditsUsed: true } },
        },
      });

      let creditsReturned = 0;
      const notify: Array<{ userId: number; creditReturned: boolean }> = [];
      const paid: Array<{ name: string; amount: number }> = [];
      for (const enrollment of enrollments) {
        await tx.classEnrollment.update({
          where: { id: enrollment.id },
          data: {
            enrollmentStatus: 'CANCELLED',
            attendanceStatus: 'CANCELLED_ON_TIME',
            attendedAt: null,
            cancelledAt: now,
          },
        });

        // Clases usadas de un pack o plan: vuelven al pack.
        for (const usage of enrollment.creditUsages) {
          await tx.classCreditUsage.delete({ where: { id: usage.id } });
          const pass = await tx.classPass.update({
            where: { id: usage.classPassId },
            data: { usedCredits: { decrement: usage.creditsUsed }, remainingCredits: { increment: usage.creditsUsed } },
            select: { id: true, status: true },
          });
          if (pass.status === 'DEPLETED') await tx.classPass.update({ where: { id: pass.id }, data: { status: 'ACTIVE' } });
          creditsReturned += usage.creditsUsed;
        }
        if (enrollment.creditUsages.length) {
          await tx.classEnrollment.updateMany({
            where: { id: enrollment.id, paymentStatus: 'COVERED_BY_CREDIT' },
            data: { paymentStatus: 'UNPAID' },
          });
        }

        // Lo que faltaba pagar se anula; lo pagado queda a favor en la cuenta.
        const account = await tx.account.findFirst({
          where: { clubId, sourceType: 'CLASS_ENROLLMENT', sourceId: enrollment.id },
          select: { paidAmount: true },
        });
        const paidAmount = Number(account?.paidAmount || 0);
        if (paidAmount > 0.009) paid.push({ name: enrollment.studentClient?.name || 'Alumno', amount: paidAmount });
        if (account) await this.accountService.cancelItemsForSourceTx(tx, { sourceType: 'CLASS_ENROLLMENT', sourceId: enrollment.id });

        if (enrollment.studentUserId && enrollment.enrollmentStatus === 'ENROLLED') {
          notify.push({ userId: enrollment.studentUserId, creditReturned: enrollment.creditUsages.length > 0 });
        }
      }

      const updated = await tx.classSession.findUniqueOrThrow({ where: { id: session.id }, include: this.sessionInclude });
      return { updated, cancelledStudents: enrollments.length, creditsReturned, paid, notify };
    });

    // Aviso a los alumnos (fuera de la transacción: si falla el push la clase igual queda cancelada).
    if (result.notify.length) {
      try {
        const settings = await prisma.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
        const local = toZonedTime(session.startsAt, String(settings?.timeZone || DEFAULT_TIME_ZONE));
        const when = `el ${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')} a las ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
        const what = `${session.activityType?.name || 'Clase'}${session.teacher?.displayName ? ` con ${session.teacher.displayName}` : ''}`;
        const seen = new Set<number>();
        for (const row of result.notify) {
          if (seen.has(row.userId)) continue;
          seen.add(row.userId);
          await pushNotificationService.enqueue(prisma, {
            clubId,
            userId: row.userId,
            kind: 'CLASS_CANCELLED',
            aggregateType: 'ClassSession',
            aggregateId: session.id,
            content: {
              title: 'Se canceló tu clase',
              body: `${what} ${when}.${row.creditReturned ? ' Te devolvimos la clase al pack.' : ''}`,
              url: '/perfil',
              tag: `class-${session.id}-cancelled`,
            },
          });
        }
      } catch (error) {
        console.error('[academia] No se pudo avisar la cancelación de la clase', error);
      }
    }

    return {
      ...this.mapRow(result.updated),
      cancellation: {
        cancelledStudents: result.cancelledStudents,
        notifiedStudents: new Set(result.notify.map((row) => row.userId)).size,
        creditsReturned: result.creditsReturned,
        paid: result.paid,
      },
    };
  }

  /** Vuelve a programar una clase cancelada que todavía no pasó (si la cancha sigue libre). */
  async reactivate(clubId: number, classSessionId: string, actorUserId: number) {
    const existing = await prisma.classSession.findFirst({ where: { id: String(classSessionId), clubId } });
    if (!existing) throw notFound('Clase no encontrada.', ErrorCodes.CLASS_SESSION_NOT_FOUND);
    if (existing.status !== 'CANCELLED') throw conflict('La clase no está cancelada.', ErrorCodes.INVALID_INPUT);
    if (existing.endsAt.getTime() <= Date.now()) {
      throw conflict('La clase ya pasó: no se puede reactivar.', ErrorCodes.INVALID_INPUT);
    }
    if (existing.seriesId) {
      const series = await prisma.classSeries.findUnique({ where: { id: existing.seriesId }, select: { status: true } });
      if (series?.status === 'ENDED') throw conflict('El curso de esta clase ya terminó.', ErrorCodes.INVALID_INPUT);
    }
    // Revisa que la cancha siga libre en ese horario.
    await this.validateInput(
      clubId,
      actorUserId,
      {
        teacherId: existing.teacherId,
        visibility: existing.visibility as 'PUBLIC' | 'PRIVATE',
        classType: existing.classType as 'INDIVIDUAL' | 'GROUP',
        activityTypeId: existing.activityTypeId,
        courtId: existing.courtId,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        durationMinutes: existing.durationMinutes,
        capacity: existing.capacity,
        pricePerStudent: existing.pricePerStudent == null ? null : Number(existing.pricePerStudent),
        status: 'SCHEDULED',
      },
      existing.id
    );
    const updated = await prisma.classSession.update({
      where: { id: existing.id },
      data: { status: 'SCHEDULED' },
      include: this.sessionInclude,
    });
    return this.mapRow(updated);
  }

  /** Scheduler: las clases que ya terminaron quedan como dadas. La asistencia no se toca. */
  async completePastSessions(now: Date = new Date()) {
    const result = await prisma.classSession.updateMany({
      where: { status: { in: ['DRAFT', 'SCHEDULED', 'CONFIRMED'] }, endsAt: { lte: now } },
      data: { status: 'COMPLETED' },
    });
    return result.count;
  }
}
