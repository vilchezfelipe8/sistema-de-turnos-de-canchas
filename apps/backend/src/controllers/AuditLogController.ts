import { Request, Response } from 'express';
import { sendAppError } from '../errors';
import { z } from 'zod';
import { prisma } from '../prisma';

export class AuditLogController {
  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        entity: z.string().trim().min(1).optional(),
        entityId: z.string().trim().min(1).optional(),
        action: z.string().trim().min(1).optional(),
        userId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const logs = await prisma.auditLog.findMany({
        where: {
          clubId,
          ...(parsed.data.entity ? { entity: parsed.data.entity } : {}),
          ...(parsed.data.entityId ? { entityId: parsed.data.entityId } : {}),
          ...(parsed.data.action ? { action: parsed.data.action } : {}),
          ...(parsed.data.userId ? { userId: parsed.data.userId } : {})
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take ?? 100
      });

      return res.json(logs);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar auditoría');
    }
  };
}
