import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClassEnrollmentAdminService } from '../services/academy/ClassEnrollmentAdminService';
import { sanitizeString } from '../utils/sanitize';

const optionalNumber = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().int().positive().optional()
);

const enrollmentStatusSchema = z.enum(['ENROLLED', 'WAITLISTED', 'CANCELLED']);
const attendanceStatusSchema = z.enum([
  'PENDING',
  'ATTENDED',
  'ABSENT',
  'NO_SHOW',
]);

const createEnrollmentSchema = z.object({
  studentClientId: z.string().trim().min(1),
  studentUserId: optionalNumber.nullable().optional(),
  billingResponsibleClientId: z.string().trim().min(1).optional().nullable(),
  enrollmentStatus: enrollmentStatusSchema.exclude(['CANCELLED']).optional(),
  notes: z.string().trim().max(1200).optional().nullable(),
});

const updateEnrollmentSchema = z.object({
  studentUserId: optionalNumber.nullable().optional(),
  billingResponsibleClientId: z.string().trim().min(1).optional().nullable(),
  notes: z.string().trim().max(1200).optional().nullable(),
});

export class ClassEnrollmentAdminController {
  private readonly service = new ClassEnrollmentAdminService();

  private resolveClubId(req: Request & { clubId?: number }) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const userId = Number((req as any)?.user?.userId || 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw validationError('No se pudo resolver el usuario actual.', { user: 'Usuario inválido.' });
    }
    return userId;
  }

  private resolveClassSessionId(raw: unknown) {
    const classSessionId = String(raw || '').trim();
    if (!classSessionId) {
      throw validationError('Revisá los campos marcados.', { classSessionId: 'Clase inválida.' });
    }
    return classSessionId;
  }

  private resolveEnrollmentId(raw: unknown) {
    const enrollmentId = String(raw || '').trim();
    if (!enrollmentId) {
      throw validationError('Revisá los campos marcados.', { enrollmentId: 'Inscripción inválida.' });
    }
    return enrollmentId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.classSessionId);
      const rows = await this.service.listByClassSession(clubId, classSessionId);
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las inscripciones.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const classSessionId = this.resolveClassSessionId(req.params.classSessionId);
      const parsed = createEnrollmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, classSessionId, actorUserId, {
        studentClientId: sanitizeString(parsed.data.studentClientId, 120),
        studentUserId: parsed.data.studentUserId ?? undefined,
        billingResponsibleClientId: parsed.data.billingResponsibleClientId
          ? sanitizeString(parsed.data.billingResponsibleClientId, 120)
          : undefined,
        enrollmentStatus: parsed.data.enrollmentStatus,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : undefined,
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear la inscripción.');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.classSessionId);
      const enrollmentId = this.resolveEnrollmentId(req.params.enrollmentId);
      const parsed = updateEnrollmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, classSessionId, enrollmentId, {
        studentUserId: parsed.data.studentUserId ?? undefined,
        billingResponsibleClientId:
          parsed.data.billingResponsibleClientId === undefined
            ? undefined
            : parsed.data.billingResponsibleClientId
              ? sanitizeString(parsed.data.billingResponsibleClientId, 120)
              : null,
        notes: parsed.data.notes === undefined ? undefined : parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : null,
      });

      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar la inscripción.');
    }
  };

  cancel = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.classSessionId);
      const enrollmentId = this.resolveEnrollmentId(req.params.enrollmentId);
      const parsed = z.object({ isLate: z.boolean().optional() }).safeParse(req.body || {});
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.cancel(
        clubId,
        classSessionId,
        enrollmentId,
        Boolean(parsed.data.isLate)
      );
      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cancelar la inscripción.');
    }
  };

  setAttendanceStatus = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.classSessionId);
      const enrollmentId = this.resolveEnrollmentId(req.params.enrollmentId);
      const parsed = z.object({ attendanceStatus: attendanceStatusSchema }).safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.setAttendanceStatus(
        clubId,
        classSessionId,
        enrollmentId,
        parsed.data.attendanceStatus
      );
      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar la asistencia.');
    }
  };
}
