import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { ClientRelationshipAdminService } from '../services/academy/ClientRelationshipAdminService';
import { sanitizeString } from '../utils/sanitize';

const relationshipTypeSchema = z.enum([
  'PARENT',
  'GUARDIAN',
  'CHILD',
  'PAYER',
  'FAMILY_MEMBER',
  'EMERGENCY_CONTACT',
  'OTHER',
]);

const relationshipBodySchema = z.object({
  fromClientId: z.string().trim().min(1),
  toClientId: z.string().trim().min(1),
  relationshipType: relationshipTypeSchema,
  canPayFor: z.boolean().optional(),
  canManageEnrollments: z.boolean().optional(),
  canViewSchedule: z.boolean().optional(),
  canCancelClass: z.boolean().optional(),
  canViewPayments: z.boolean().optional(),
  notes: z.string().trim().max(1200).optional().nullable(),
});

const relationshipUpdateSchema = relationshipBodySchema.partial();

export class ClientRelationshipAdminController {
  private readonly service = new ClientRelationshipAdminService();

  private resolveClubId(req: Request & { clubId?: number }) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveRelationshipId(raw: unknown) {
    const relationshipId = String(raw || '').trim();
    if (!relationshipId) {
      throw validationError('Revisá los campos marcados.', { id: 'Relación inválida.' });
    }
    return relationshipId;
  }

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const clientId = String(req.query.clientId || '').trim() || undefined;
      const rows = await this.service.listByClub(clubId, clientId);
      return res.json(rows);
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar las relaciones.');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const parsed = relationshipBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, {
        fromClientId: sanitizeString(parsed.data.fromClientId, 120),
        toClientId: sanitizeString(parsed.data.toClientId, 120),
        relationshipType: parsed.data.relationshipType,
        canPayFor: parsed.data.canPayFor,
        canManageEnrollments: parsed.data.canManageEnrollments,
        canViewSchedule: parsed.data.canViewSchedule,
        canCancelClass: parsed.data.canCancelClass,
        canViewPayments: parsed.data.canViewPayments,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : undefined,
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear la relación.');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const relationshipId = this.resolveRelationshipId(req.params.id);
      const parsed = relationshipUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, relationshipId, {
        fromClientId: parsed.data.fromClientId ? sanitizeString(parsed.data.fromClientId, 120) : undefined,
        toClientId: parsed.data.toClientId ? sanitizeString(parsed.data.toClientId, 120) : undefined,
        relationshipType: parsed.data.relationshipType,
        canPayFor: parsed.data.canPayFor,
        canManageEnrollments: parsed.data.canManageEnrollments,
        canViewSchedule: parsed.data.canViewSchedule,
        canCancelClass: parsed.data.canCancelClass,
        canViewPayments: parsed.data.canViewPayments,
        notes: parsed.data.notes === undefined ? undefined : parsed.data.notes ? sanitizeString(parsed.data.notes, 1200) : null,
      });

      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar la relación.');
    }
  };

  remove = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const relationshipId = this.resolveRelationshipId(req.params.id);
      const result = await this.service.remove(clubId, relationshipId);
      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo eliminar la relación.');
    }
  };
}
