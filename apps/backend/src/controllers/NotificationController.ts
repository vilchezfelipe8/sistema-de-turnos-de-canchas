import { Request, Response } from 'express';
import { sendAppError } from '../errors';
import { z } from 'zod';
import { prisma } from '../prisma';

export class NotificationController {
  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        unreadOnly: z.preprocess((v) => String(v) === 'true', z.boolean()).optional(),
        userId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(200).optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const rows = await prisma.notification.findMany({
        where: {
          clubId,
          ...(parsed.data.unreadOnly ? { isRead: false } : {}),
          ...(parsed.data.userId ? { userId: parsed.data.userId } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take ?? 100
      });

      return res.json(rows);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar notificaciones');
    }
  };

  markRead = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const existing = await prisma.notification.findFirst({
        where: { id: parsed.data.id, clubId }
      });

      if (!existing) return res.status(404).json({ error: 'Notificación no encontrada' });

      const updated = await prisma.notification.update({
        where: { id: parsed.data.id },
        data: { isRead: true, status: 'READ', sentAt: existing.sentAt ?? new Date() }
      });

      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al marcar notificación');
    }
  };

  markAllRead = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        userId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const result = await prisma.notification.updateMany({
        where: {
          clubId,
          isRead: false,
          ...(parsed.data.userId ? { userId: parsed.data.userId } : {})
        },
        data: { isRead: true, status: 'READ', sentAt: new Date() }
      });

      return res.json({ success: true, updated: result.count });
    } catch (error: any) {
      return sendAppError(res, error, 'Error al marcar notificaciones');
    }
  };
}
