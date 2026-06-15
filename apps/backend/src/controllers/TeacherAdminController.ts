import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { TeacherAdminService } from '../services/TeacherAdminService';
import { sanitizeString } from '../utils/sanitize';

const optionalNumber = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().int().positive().optional()
);

const optionalString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .nullable();

const teacherBodySchema = z.object({
  clientId: z.string().trim().min(1).optional().nullable(),
  userId: optionalNumber.nullable(),
  displayName: z.string().trim().min(2, 'Cargá un nombre válido.'),
  email: optionalString(160),
  phone: optionalString(80),
  isInternal: z.boolean().optional(),
  isActive: z.boolean().optional(),
  specialties: z.array(z.string().trim().min(1).max(80)).optional(),
  notes: optionalString(1200),
});

const teacherUpdateSchema = z.object({
  clientId: z.string().trim().min(1).optional().nullable(),
  userId: optionalNumber.nullable().optional(),
  displayName: z.string().trim().min(2, 'Cargá un nombre válido.').optional(),
  email: optionalString(160),
  phone: optionalString(80),
  isInternal: z.boolean().optional(),
  isActive: z.boolean().optional(),
  specialties: z.array(z.string().trim().min(1).max(80)).optional(),
  notes: optionalString(1200),
});

export class TeacherAdminController {
  private readonly service = new TeacherAdminService();

  private resolveClubId(req: Request & { clubId?: number }) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveTeacherId(raw: unknown) {
    const teacherId = String(raw || '').trim();
    if (!teacherId) {
      throw validationError('Revisá los campos marcados.', { id: 'Profesor inválido.' });
    }
    return teacherId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
      const rows = await this.service.listByClub(clubId, includeInactive);
      return res.json(rows);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar los profesores');
    }
  };

  getById = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const teacherId = this.resolveTeacherId(req.params.id);
      const row = await this.service.getById(clubId, teacherId);
      return res.json(row);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el profesor');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const parsed = teacherBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, {
        clientId: parsed.data.clientId ?? undefined,
        userId: parsed.data.userId ?? undefined,
        displayName: sanitizeString(parsed.data.displayName, 200),
        email: parsed.data.email ? sanitizeString(parsed.data.email, 160) : undefined,
        phone: parsed.data.phone ? sanitizeString(parsed.data.phone, 80) : undefined,
        isInternal: parsed.data.isInternal,
        isActive: parsed.data.isActive,
        specialties: Array.isArray(parsed.data.specialties)
          ? parsed.data.specialties.map((value) => sanitizeString(value, 80))
          : undefined,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : undefined,
      });
      return res.status(201).json(created);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo crear el profesor');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const teacherId = this.resolveTeacherId(req.params.id);
      const parsed = teacherUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, teacherId, {
        clientId: parsed.data.clientId ?? undefined,
        userId: parsed.data.userId ?? undefined,
        displayName:
          parsed.data.displayName === undefined ? undefined : sanitizeString(parsed.data.displayName, 200),
        email:
          parsed.data.email === undefined ? undefined : parsed.data.email ? sanitizeString(parsed.data.email, 160) : null,
        phone:
          parsed.data.phone === undefined ? undefined : parsed.data.phone ? sanitizeString(parsed.data.phone, 80) : null,
        isInternal: parsed.data.isInternal,
        isActive: parsed.data.isActive,
        specialties:
          parsed.data.specialties === undefined
            ? undefined
            : parsed.data.specialties.map((value) => sanitizeString(value, 80)),
        notes:
          parsed.data.notes === undefined ? undefined : parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : null,
      });
      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar el profesor');
    }
  };

  setStatus = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const teacherId = this.resolveTeacherId(req.params.id);
      const parsed = z
        .object({
          isActive: z.boolean(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.setActive(clubId, teacherId, parsed.data.isActive);
      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar el estado del profesor');
    }
  };
}
