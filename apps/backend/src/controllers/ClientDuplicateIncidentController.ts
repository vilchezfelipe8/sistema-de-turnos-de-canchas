import { Request, Response } from 'express';
import { z } from 'zod';
import { ClientDuplicateIncidentService } from '../services/ClientDuplicateIncidentService';
import { sendAuthError } from '../utils/authError';
import { sendAppError } from '../errors';

export class ClientDuplicateIncidentController {
  constructor(private readonly service: ClientDuplicateIncidentService) {}

  list = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const querySchema = z.object({
        status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(),
        sourceType: z.string().trim().optional()
      });
      const parsed = querySchema.safeParse(req.query || {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const incidents = await this.service.listByClub({
        clubId,
        status: parsed.data.status,
        sourceType: parsed.data.sourceType || undefined
      });
      return res.json({ incidents });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar los incidentes');
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const paramsSchema = z.object({ incidentId: z.string().trim().min(1) });
      const parsed = paramsSchema.safeParse(req.params || {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const incident = await this.service.getDetail({
        clubId,
        incidentId: parsed.data.incidentId
      });
      if (!incident) return res.status(404).json({ error: 'Incidente no encontrado' });
      return res.json({ incident });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el incidente');
    }
  };

  resolveLink = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const actorUserId = Number((req as any)?.user?.userId || 0);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
      }

      const paramsSchema = z.object({ incidentId: z.string().trim().min(1) });
      const bodySchema = z.object({ clientId: z.string().trim().min(1) });
      const paramsParsed = paramsSchema.safeParse(req.params || {});
      const bodyParsed = bodySchema.safeParse(req.body || {});
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const incident = await this.service.resolveByLinkingUser({
        clubId,
        incidentId: paramsParsed.data.incidentId,
        clientId: bodyParsed.data.clientId,
        actorUserId
      });

      return res.json({ incident });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo resolver el incidente');
    }
  };

  dismiss = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const actorUserId = Number((req as any)?.user?.userId || 0);
      if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
      }

      const paramsSchema = z.object({ incidentId: z.string().trim().min(1) });
      const bodySchema = z.object({
        reason: z.string().trim().max(300).optional()
      });
      const paramsParsed = paramsSchema.safeParse(req.params || {});
      const bodyParsed = bodySchema.safeParse(req.body || {});
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const incident = await this.service.dismissIncident({
        clubId,
        incidentId: paramsParsed.data.incidentId,
        actorUserId,
        resolutionNotes: bodyParsed.data.reason || null
      });

      return res.json({ incident });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo descartar el incidente');
    }
  };
}
