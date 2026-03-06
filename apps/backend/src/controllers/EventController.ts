import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { EventProcessor } from '../services/EventProcessor';
import { EventService } from '../services/EventService';

export class EventController {
  private readonly processor = new EventProcessor();
  private readonly eventService = new EventService();

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        processed: z.preprocess((v) => {
          if (v === undefined || v === null || v === '') return undefined;
          return String(v) === 'true';
        }, z.boolean().optional()),
        type: z.string().trim().min(1).optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const events = await prisma.event.findMany({
        where: {
          clubId,
          ...(parsed.data.type ? { type: parsed.data.type } : {}),
          ...(parsed.data.processed === undefined ? {} : { processed: parsed.data.processed })
        },
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take ?? 100
      });

      return res.json(events);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al listar eventos' });
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        type: z.string().trim().min(1),
        payload: z.record(z.any())
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const event = await this.eventService.createEvent(clubId, parsed.data.type, parsed.data.payload);
      return res.status(201).json(event);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al crear evento' });
    }
  };

  processPending = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        batchSize: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const result = await this.processor.processPending(parsed.data.batchSize ?? 50);
      return res.json({ success: true, ...result });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al procesar eventos pendientes' });
    }
  };
}
