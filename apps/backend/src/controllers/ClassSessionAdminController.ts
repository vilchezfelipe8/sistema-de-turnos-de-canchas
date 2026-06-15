import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClassSessionAdminService } from '../services/academy/ClassSessionAdminService';
import { sanitizeString } from '../utils/sanitize';

const optionalNumber = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().int().positive().optional()
);

const optionalMoney = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().nonnegative().optional()
);

const classSessionStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED']);
const classSessionVisibilitySchema = z.enum(['PUBLIC', 'PRIVATE']);
const classSessionTypeSchema = z.enum(['INDIVIDUAL', 'GROUP']);

const classSessionBodySchema = z.object({
  teacherId: z.string().trim().min(1),
  visibility: classSessionVisibilitySchema,
  classType: classSessionTypeSchema,
  activityTypeId: optionalNumber.nullable().optional(),
  courtId: optionalNumber.nullable().optional(),
  startsAt: z.string().trim().min(1),
  endsAt: z.string().trim().min(1),
  durationMinutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  pricePerStudent: optionalMoney.nullable().optional(),
  status: classSessionStatusSchema.optional(),
  level: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(1200).optional().nullable(),
  requiresApproval: z.boolean().optional(),
  requiresPaymentToEnroll: z.boolean().optional(),
  metadata: z.unknown().optional(),
});

const classSessionUpdateSchema = classSessionBodySchema.partial();

export class ClassSessionAdminController {
  private readonly service = new ClassSessionAdminService();

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
      throw validationError('Revisá los campos marcados.', { id: 'Clase inválida.' });
    }
    return classSessionId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const rows = await this.service.listByClub(clubId);
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las clases.');
    }
  };

  getById = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.id);
      const row = await this.service.getById(clubId, classSessionId);
      return res.json(row);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener la clase.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const parsed = classSessionBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, actorUserId, {
        teacherId: sanitizeString(parsed.data.teacherId, 120),
        visibility: parsed.data.visibility,
        classType: parsed.data.classType,
        activityTypeId: parsed.data.activityTypeId ?? undefined,
        courtId: parsed.data.courtId ?? undefined,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        durationMinutes: parsed.data.durationMinutes,
        capacity: parsed.data.capacity,
        pricePerStudent: parsed.data.pricePerStudent ?? undefined,
        status: parsed.data.status,
        level: parsed.data.level ? sanitizeString(parsed.data.level, 120) : undefined,
        description: parsed.data.description ? sanitizeString(parsed.data.description, 1200) : undefined,
        requiresApproval: parsed.data.requiresApproval,
        requiresPaymentToEnroll: parsed.data.requiresPaymentToEnroll,
        metadata: parsed.data.metadata,
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear la clase.');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const classSessionId = this.resolveClassSessionId(req.params.id);
      const parsed = classSessionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, classSessionId, actorUserId, {
        teacherId: parsed.data.teacherId ? sanitizeString(parsed.data.teacherId, 120) : undefined,
        visibility: parsed.data.visibility,
        classType: parsed.data.classType,
        activityTypeId: parsed.data.activityTypeId ?? undefined,
        courtId: parsed.data.courtId ?? undefined,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        durationMinutes: parsed.data.durationMinutes,
        capacity: parsed.data.capacity,
        pricePerStudent: parsed.data.pricePerStudent ?? undefined,
        status: parsed.data.status,
        level: parsed.data.level === undefined ? undefined : parsed.data.level ? sanitizeString(parsed.data.level, 120) : null,
        description:
          parsed.data.description === undefined
            ? undefined
            : parsed.data.description
              ? sanitizeString(parsed.data.description, 1200)
              : null,
        requiresApproval: parsed.data.requiresApproval,
        requiresPaymentToEnroll: parsed.data.requiresPaymentToEnroll,
        metadata: parsed.data.metadata,
      });

      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar la clase.');
    }
  };

  setStatus = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classSessionId = this.resolveClassSessionId(req.params.id);
      const parsed = z.object({ status: classSessionStatusSchema }).safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.setStatus(clubId, classSessionId, parsed.data.status);
      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el estado de la clase.');
    }
  };
}
