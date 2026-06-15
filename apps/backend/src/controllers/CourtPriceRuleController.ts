import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { sendAppError } from '../errors';

export class CourtPriceRuleController {
  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        courtId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const rows = await prisma.courtPriceRule.findMany({
        where: {
          clubId,
          ...(parsed.data.courtId ? { courtId: parsed.data.courtId } : {})
        },
        orderBy: [{ courtId: 'asc' }, { dayOfWeek: 'asc' }, { startMinutes: 'asc' }]
      });

      return res.json(rows);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar reglas de precio');
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        courtId: z.preprocess((v) => Number(v), z.number().int().positive()),
        dayOfWeek: z.preprocess((v) => Number(v), z.number().int().min(0).max(6)),
        startMinutes: z.preprocess((v) => Number(v), z.number().int().min(0).max(1439)),
        endMinutes: z.preprocess((v) => Number(v), z.number().int().min(1).max(1440)),
        price: z.preprocess((v) => Number(v), z.number().positive())
      }).refine((data) => data.endMinutes > data.startMinutes, {
        message: 'endMinutes debe ser mayor a startMinutes',
        path: ['endMinutes']
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const court = await prisma.court.findFirst({ where: { id: parsed.data.courtId, clubId } });
      if (!court) return res.status(404).json({ error: 'Cancha no encontrada en el club' });

      const created = await prisma.courtPriceRule.create({
        data: {
          clubId,
          courtId: parsed.data.courtId,
          dayOfWeek: parsed.data.dayOfWeek,
          startMinutes: parsed.data.startMinutes,
          endMinutes: parsed.data.endMinutes,
          price: parsed.data.price
        }
      });

      return res.status(201).json(created);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al crear regla de precio');
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.preprocess((v) => Number(v), z.number().int().positive()) });
      const bodySchema = z.object({
        dayOfWeek: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().min(0).max(6).optional()),
        startMinutes: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().min(0).max(1439).optional()),
        endMinutes: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().min(1).max(1440).optional()),
        price: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().positive().optional())
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const existing = await prisma.courtPriceRule.findFirst({
        where: { id: paramsParsed.data.id, clubId }
      });
      if (!existing) return res.status(404).json({ error: 'Regla no encontrada' });

      const nextStart = bodyParsed.data.startMinutes ?? existing.startMinutes;
      const nextEnd = bodyParsed.data.endMinutes ?? existing.endMinutes;
      if (nextEnd <= nextStart) {
        return res.status(400).json({ error: 'endMinutes debe ser mayor a startMinutes' });
      }

      const updated = await prisma.courtPriceRule.update({
        where: { id: paramsParsed.data.id },
        data: {
          ...(bodyParsed.data.dayOfWeek !== undefined ? { dayOfWeek: bodyParsed.data.dayOfWeek } : {}),
          ...(bodyParsed.data.startMinutes !== undefined ? { startMinutes: bodyParsed.data.startMinutes } : {}),
          ...(bodyParsed.data.endMinutes !== undefined ? { endMinutes: bodyParsed.data.endMinutes } : {}),
          ...(bodyParsed.data.price !== undefined ? { price: bodyParsed.data.price } : {})
        }
      });

      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al actualizar regla de precio');
    }
  };

  remove = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.preprocess((v) => Number(v), z.number().int().positive()) });
      const paramsParsed = paramsSchema.safeParse(req.params);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const existing = await prisma.courtPriceRule.findFirst({
        where: { id: paramsParsed.data.id, clubId }
      });
      if (!existing) return res.status(404).json({ error: 'Regla no encontrada' });

      await prisma.courtPriceRule.delete({ where: { id: paramsParsed.data.id } });
      return res.json({ success: true });
    } catch (error: any) {
      return sendAppError(res, error, 'Error al eliminar regla de precio');
    }
  };
}
