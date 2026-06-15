import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClassCreditUsageAdminService } from '../services/academy/ClassCreditUsageAdminService';
import { sanitizeString } from '../utils/sanitize';

const creditUsageReasonSchema = z.enum([
  'ATTENDANCE',
  'LATE_CANCEL',
  'NO_SHOW',
  'MANUAL_ADJUSTMENT',
  'REFUND_REVERSAL',
]);

export class ClassCreditUsageAdminController {
  private readonly service = new ClassCreditUsageAdminService();

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

  private resolveClassPassId(raw: unknown) {
    const classPassId = String(raw || '').trim();
    if (!classPassId) {
      throw validationError('Revisá los campos marcados.', { classPassId: 'Pack inválido.' });
    }
    return classPassId;
  }

  private resolveEnrollmentId(raw: unknown) {
    const enrollmentId = String(raw || '').trim();
    if (!enrollmentId) {
      throw validationError('Revisá los campos marcados.', { classEnrollmentId: 'Inscripción inválida.' });
    }
    return enrollmentId;
  }

  listByClassPass = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.passId);
      const rows = await this.service.listByClassPass(clubId, classPassId);
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los consumos del pack.');
    }
  };

  listByEnrollment = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const enrollmentId = this.resolveEnrollmentId(req.params.enrollmentId);
      const rows = await this.service.listByEnrollment(clubId, enrollmentId);
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los consumos de la inscripción.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const classPassId = this.resolveClassPassId(req.params.passId);
      const parsed = z
        .object({
          classEnrollmentId: z.string().trim().min(1),
          creditsUsed: z.number().int().positive(),
          reason: creditUsageReasonSchema,
          notes: z.string().trim().max(1200).optional().nullable(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, classPassId, actorUserId, {
        classEnrollmentId: sanitizeString(parsed.data.classEnrollmentId, 120),
        creditsUsed: parsed.data.creditsUsed,
        reason: parsed.data.reason,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : undefined,
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo consumir el crédito.');
    }
  };
}
