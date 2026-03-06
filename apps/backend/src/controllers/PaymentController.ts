import { Request, Response } from 'express';
import { PaymentStatus } from '@prisma/client';
import { z } from 'zod';
import { PaymentService } from '../services/PaymentService';

export class PaymentController {
  private readonly paymentService = new PaymentService();

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        bookingId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        userId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        status: z.nativeEnum(PaymentStatus).optional(),
        method: z.string().trim().min(1).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const result = await this.paymentService.list({
        clubId,
        ...parsed.data,
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al listar pagos' });
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        method: z.string().trim().min(1),
        status: z.nativeEnum(PaymentStatus).optional(),
        bookingId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        userId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const payment = await this.paymentService.create({
        clubId,
        amount: parsed.data.amount,
        method: parsed.data.method,
        status: parsed.data.status,
        bookingId: parsed.data.bookingId,
        userId: parsed.data.userId
      });

      return res.status(201).json(payment);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al crear pago' });
    }
  };

  updateStatus = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const bodySchema = z.object({ status: z.nativeEnum(PaymentStatus) });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const updated = await this.paymentService.updateStatus(
        paramsParsed.data.id,
        clubId,
        bodyParsed.data.status
      );

      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al actualizar estado del pago' });
    }
  };
}
