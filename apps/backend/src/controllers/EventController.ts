import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { EventService } from '../services/EventService';
import { BookingHistoryService } from '../services/BookingHistoryService';
import { sendAppError } from '../errors';

export class EventController {
  private readonly eventService = new EventService();
  private readonly bookingHistoryService = new BookingHistoryService();

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        processed: z.preprocess((v) => {
          if (v === undefined || v === null || v === '') return undefined;
          return String(v) === 'true';
        }, z.boolean().optional()),
        type: z.string().trim().min(1).optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional()),
        bookingId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const where: any = {
        clubId,
        ...(parsed.data.type ? { type: parsed.data.type } : {}),
        ...(parsed.data.processed === undefined ? {} : { processed: parsed.data.processed })
      };

      if (parsed.data.bookingId) {
        const bookingId = Number(parsed.data.bookingId);
        const booking = await prisma.booking.findFirst({
          where: {
            id: bookingId,
            court: { clubId }
          },
          select: { id: true }
        });
        if (!booking) return res.status(404).json({ error: 'Reserva no encontrada en el club activo' });

        const bookingHistory = await this.bookingHistoryService.listByBooking({
          clubId,
          bookingId,
          take: parsed.data.take ?? 100,
        });

        return res.json(
          bookingHistory.map((entry) => ({
            id: entry.id,
            action: entry.action,
            category: entry.category,
            source: entry.source,
            summary: entry.summary,
            detail: entry.detail,
            previousState: entry.previousState,
            nextState: entry.nextState,
            metadata: entry.metadata,
            actorUserId: entry.actorUserId,
            actorLabel: entry.actorLabel,
            bookingParticipantId: entry.bookingParticipantId,
            paymentId: entry.paymentId,
            accountId: entry.accountId,
            occurredAt: entry.occurredAt,
            createdAt: entry.createdAt,
          }))
        );
      }

      const events = await prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take ?? 100
      });

      return res.json(events);
    } catch (error: any) {
      return sendAppError(res, error, 'Error al listar eventos');
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
      return sendAppError(res, error, 'Error al crear evento');
    }
  };

}
