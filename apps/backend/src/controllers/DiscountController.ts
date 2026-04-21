import { Request, Response } from 'express';
import { z } from 'zod';
import { DiscountService } from '../services/DiscountService';

export class DiscountController {
  private readonly discountService = new DiscountService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as any).clubId);
    if (!Number.isInteger(clubId) || clubId <= 0) {
      throw new Error('Club inválido');
    }
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const actorUserId = Number((req as any).user?.userId || 0);
    return Number.isFinite(actorUserId) && actorUserId > 0 ? actorUserId : null;
  }

  listPolicies = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const policies = await this.discountService.listPolicies(clubId);
      return res.json(policies);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudieron listar las políticas' });
    }
  };

  createPolicy = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500).optional(),
        scope: z.enum(['BOOKING', 'PRODUCT', 'SERVICE', 'ALL']),
        amountType: z.enum(['PERCENT', 'FIXED']),
        amountValue: z.preprocess((v) => Number(v), z.number().positive()),
        applyMode: z.enum(['INCLUDE_ONLY', 'EXCLUDE_LIST']).optional(),
        isStackable: z.boolean().optional(),
        priority: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().optional()),
        isActive: z.boolean().optional(),
        startsAt: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
        endsAt: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
        targets: z.array(z.object({
          activityTypeId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
          productId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
          productCategory: z.string().trim().min(1).max(120).optional(),
          serviceCode: z.string().trim().min(1).max(80).optional()
        })).optional()
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const created = await this.discountService.createPolicy({
        clubId,
        ...parsed.data
      });
      return res.status(201).json(created);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo crear la política' });
    }
  };

  updatePolicy = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        policyId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        scope: z.enum(['BOOKING', 'PRODUCT', 'SERVICE', 'ALL']).optional(),
        amountType: z.enum(['PERCENT', 'FIXED']).optional(),
        amountValue: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().positive().optional()),
        applyMode: z.enum(['INCLUDE_ONLY', 'EXCLUDE_LIST']).optional(),
        isStackable: z.boolean().optional(),
        priority: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().optional()),
        isActive: z.boolean().optional(),
        startsAt: z.preprocess((v) => (v == null || v === '' ? undefined : (v === null ? null : new Date(String(v)))), z.union([z.date(), z.null()]).optional()),
        endsAt: z.preprocess((v) => (v == null || v === '' ? undefined : (v === null ? null : new Date(String(v)))), z.union([z.date(), z.null()]).optional())
      });

      const parsedParams = paramsSchema.safeParse(req.params);
      const parsedBody = bodySchema.safeParse(req.body);
      if (!parsedParams.success) return res.status(400).json({ error: parsedParams.error.format() });
      if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.format() });

      const body = parsedBody.data;
      if (Object.keys(body).length === 0) {
        return res.status(400).json({ error: 'No se enviaron cambios para actualizar' });
      }

      const clubId = this.resolveClubId(req);
      const updated = await this.discountService.updatePolicy({
        clubId,
        policyId: parsedParams.data.policyId,
        ...body
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo actualizar la política' });
    }
  };

  listClientAssignments = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const assignments = await this.discountService.listClientAssignments(clubId, parsed.data.clientId);
      return res.json(assignments);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudieron listar las asignaciones' });
    }
  };

  assignToClient = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ clientId: z.string().trim().min(1) });
      const bodySchema = z.object({
        policyId: z.string().trim().min(1),
        notes: z.string().trim().max(500).optional(),
        startsAt: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional()),
        endsAt: z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional())
      });
      const parsedParams = paramsSchema.safeParse(req.params);
      const parsedBody = bodySchema.safeParse(req.body);
      if (!parsedParams.success) return res.status(400).json({ error: parsedParams.error.format() });
      if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.format() });

      const clubId = this.resolveClubId(req);
      const assignment = await this.discountService.assignPolicyToClient({
        clubId,
        clientId: parsedParams.data.clientId,
        policyId: parsedBody.data.policyId,
        notes: parsedBody.data.notes,
        startsAt: parsedBody.data.startsAt ?? null,
        endsAt: parsedBody.data.endsAt ?? null,
        createdByUserId: this.resolveActorUserId(req)
      });
      return res.status(201).json(assignment);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo asignar la política al cliente' });
    }
  };

  setAssignmentStatus = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ assignmentId: z.string().trim().min(1) });
      const bodySchema = z.object({ isActive: z.boolean() });
      const parsedParams = paramsSchema.safeParse(req.params);
      const parsedBody = bodySchema.safeParse(req.body);
      if (!parsedParams.success) return res.status(400).json({ error: parsedParams.error.format() });
      if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.format() });

      const clubId = this.resolveClubId(req);
      const updated = await this.discountService.setAssignmentActive({
        clubId,
        assignmentId: parsedParams.data.assignmentId,
        isActive: parsedBody.data.isActive
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo actualizar la asignación' });
    }
  };
}
