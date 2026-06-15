import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, zodValidationAppError } from '../errors';
import { MembershipAdminService } from '../services/MembershipAdminService';

const membershipRoleSchema = z.enum(['OWNER', 'ADMIN', 'STAFF', 'CUSTOMER']);

export class MembershipAdminController {
  private readonly membershipAdminService = new MembershipAdminService();

  list = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId || (req as any).club?.id);
      const actorUserId = Number((req as any)?.user?.userId || 0);

      const memberships = await this.membershipAdminService.listMembers({
        clubId,
        actorUserId
      });

      return res.json({ items: memberships });
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los miembros del club.');
    }
  };

  invite = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        email: z.string().trim().email(),
        role: membershipRoleSchema
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      }

      const created = await this.membershipAdminService.inviteMember({
        clubId: Number((req as any).clubId || (req as any).club?.id),
        actorUserId: Number((req as any)?.user?.userId || 0),
        email: parsed.data.email,
        role: parsed.data.role
      });

      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo dar acceso al miembro.');
    }
  };

  updateRole = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        membershipId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        role: membershipRoleSchema
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) {
        return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
      }
      if (!bodyParsed.success) {
        return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));
      }

      const updated = await this.membershipAdminService.updateMemberRole({
        clubId: Number((req as any).clubId || (req as any).club?.id),
        actorUserId: Number((req as any)?.user?.userId || 0),
        membershipId: paramsParsed.data.membershipId,
        role: bodyParsed.data.role
      });

      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo actualizar el rol.');
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        membershipId: z.string().trim().min(1)
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
      }

      const result = await this.membershipAdminService.removeMember({
        clubId: Number((req as any).clubId || (req as any).club?.id),
        actorUserId: Number((req as any)?.user?.userId || 0),
        membershipId: paramsParsed.data.membershipId
      });

      return res.json(result);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo quitar el acceso.');
    }
  };
}
