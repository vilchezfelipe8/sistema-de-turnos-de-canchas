import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClassPassAdminService } from '../services/academy/ClassPassAdminService';
import { sanitizeString } from '../utils/sanitize';

const optionalNumber = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().int().positive().optional()
);

const optionalMoney = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : Number(value)),
  z.number().positive().optional()
);

const optionalDateTime = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}, z.string().datetime({ offset: true }).optional());

const optionalString = (maxLength: number) => z.string().trim().max(maxLength).optional().nullable();

const classSessionTypeSchema = z.enum(['INDIVIDUAL', 'GROUP']);
const classPassStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);

const createClassPassSchema = z.object({
  ownerClientId: z.string().trim().min(1),
  ownerUserId: optionalNumber.nullable().optional(),
  beneficiaryClientId: z.string().trim().min(1),
  beneficiaryUserId: optionalNumber.nullable().optional(),
  packageName: z.string().trim().min(2).max(160),
  priceAtPurchase: optionalMoney.nullable().optional(),
  totalCredits: z.number().int().positive(),
  expiresAt: optionalDateTime.nullable().optional(),
  activityTypeId: optionalNumber.nullable().optional(),
  classType: classSessionTypeSchema.nullable().optional(),
  teacherId: z.string().trim().min(1).nullable().optional(),
  transferable: z.boolean().optional(),
  notes: optionalString(1200),
});

const updateClassPassSchema = z.object({
  packageName: z.string().trim().min(2).max(160).optional().nullable(),
  expiresAt: optionalDateTime.nullable().optional(),
  activityTypeId: optionalNumber.nullable().optional(),
  classType: classSessionTypeSchema.nullable().optional(),
  teacherId: z.string().trim().min(1).nullable().optional(),
  transferable: z.boolean().optional(),
  notes: optionalString(1200),
});

export class ClassPassAdminController {
  private readonly service = new ClassPassAdminService();

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
      throw validationError('Revisá los campos marcados.', { id: 'Pack inválido.' });
    }
    return classPassId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const beneficiaryClientId = String(req.query.beneficiaryClientId || '').trim() || undefined;
      const status = String(req.query.status || '').trim() || undefined;
      const rows = await this.service.listByClub(clubId, {
        beneficiaryClientId,
        status: status ? (status as 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'CANCELLED') : undefined,
      });
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los packs de clases.');
    }
  };

  getById = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.id);
      const row = await this.service.getById(clubId, classPassId);
      return res.json(row);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener el pack de clases.');
    }
  };

  getAccount = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.passId);
      const payload = await this.service.getAccount(clubId, classPassId);
      return res.json(payload);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener la cuenta del pack.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const parsed = createClassPassSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, actorUserId, {
        ownerClientId: sanitizeString(parsed.data.ownerClientId, 120),
        ownerUserId: parsed.data.ownerUserId ?? undefined,
        beneficiaryClientId: sanitizeString(parsed.data.beneficiaryClientId, 120),
        beneficiaryUserId: parsed.data.beneficiaryUserId ?? undefined,
        packageName: sanitizeString(parsed.data.packageName, 160),
        priceAtPurchase: parsed.data.priceAtPurchase ?? undefined,
        totalCredits: parsed.data.totalCredits,
        expiresAt: parsed.data.expiresAt ?? undefined,
        activityTypeId: parsed.data.activityTypeId ?? undefined,
        classType: parsed.data.classType ?? undefined,
        teacherId: parsed.data.teacherId ? sanitizeString(parsed.data.teacherId, 120) : undefined,
        transferable: parsed.data.transferable,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : undefined,
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear el pack de clases.');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.id);
      const parsed = updateClassPassSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, classPassId, {
        packageName:
          parsed.data.packageName === undefined
            ? undefined
            : parsed.data.packageName
              ? sanitizeString(parsed.data.packageName, 160)
              : null,
        expiresAt: parsed.data.expiresAt ?? undefined,
        activityTypeId: parsed.data.activityTypeId ?? undefined,
        classType: parsed.data.classType ?? undefined,
        teacherId:
          parsed.data.teacherId === undefined
            ? undefined
            : parsed.data.teacherId
              ? sanitizeString(parsed.data.teacherId, 120)
              : null,
        transferable: parsed.data.transferable,
        notes:
          parsed.data.notes === undefined ? undefined : parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : null,
      });

      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el pack de clases.');
    }
  };

  setStatus = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.id);
      const parsed = z.object({ status: classPassStatusSchema }).safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }
      const updated = await this.service.setStatus(clubId, classPassId, parsed.data.status);
      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el estado del pack.');
    }
  };

  openAccount = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const classPassId = this.resolveClassPassId(req.params.passId);
      const payload = await this.service.openAccount(clubId, classPassId);
      return res.json(payload);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo abrir la cuenta del pack.');
    }
  };
}
