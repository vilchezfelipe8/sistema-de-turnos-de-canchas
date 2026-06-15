import { Request, Response } from 'express';
import { badRequest, ErrorCodes, sendAppError, validationError, zodValidationAppError } from '../errors';
import { z } from 'zod';
import { ClubServiceCatalogService } from '../services/ClubServiceCatalogService';
import { sanitizeString } from '../utils/sanitize';

export class ClubServiceCatalogController {
  private service = new ClubServiceCatalogService();

  list = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = Number(req.clubId);
      if (!Number.isFinite(clubId) || clubId <= 0) {
        throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
      }
      const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
      const rows = await this.service.listByClub(clubId, includeInactive);
      return res.json(rows);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar servicios');
    }
  };

  create = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = Number(req.clubId);
      if (!Number.isFinite(clubId) || clubId <= 0) {
        throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
      }

      const bodySchema = z.object({
        code: z.string().trim().min(1),
        name: z.string().trim().min(1),
        description: z.string().trim().max(500).optional().nullable(),
        price: z.preprocess((v) => Number(v), z.number().positive())
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.service.create(clubId, {
        code: sanitizeString(parsed.data.code, 80),
        name: sanitizeString(parsed.data.name, 200),
        description: parsed.data.description ? sanitizeString(parsed.data.description, 500) : undefined,
        price: parsed.data.price
      });
      return res.status(201).json(created);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo crear el servicio');
    }
  };

  update = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = Number(req.clubId);
      const id = Number(req.params.id);
      if (!Number.isFinite(clubId) || clubId <= 0) {
        throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
      }
      if (!Number.isFinite(id) || id <= 0) {
        throw validationError('Revisá los campos marcados.', { id: 'ID inválido.' });
      }

      const bodySchema = z.object({
        code: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        price: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().positive().optional()),
        isActive: z.boolean().optional()
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.service.update(clubId, id, {
        code: parsed.data.code ? sanitizeString(parsed.data.code, 80) : undefined,
        name: parsed.data.name ? sanitizeString(parsed.data.name, 200) : undefined,
        description:
          parsed.data.description === undefined
            ? undefined
            : parsed.data.description === null
              ? null
              : sanitizeString(parsed.data.description, 500),
        price: parsed.data.price,
        isActive: parsed.data.isActive
      });

      if (!updated) throw badRequest('Servicio no encontrado.', ErrorCodes.SERVICE_NOT_FOUND);
      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar el servicio');
    }
  };

  delete = async (req: Request & { clubId?: number }, res: Response) => {
    try {
      const clubId = Number(req.clubId);
      const id = Number(req.params.id);
      if (!Number.isFinite(clubId) || clubId <= 0) {
        throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
      }
      if (!Number.isFinite(id) || id <= 0) {
        throw validationError('Revisá los campos marcados.', { id: 'ID inválido.' });
      }
      const deleted = await this.service.delete(clubId, id);
      if (!deleted) throw badRequest('Servicio no encontrado.', ErrorCodes.SERVICE_NOT_FOUND);
      return res.json({ message: 'Servicio dado de baja' });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo eliminar el servicio');
    }
  };
}
