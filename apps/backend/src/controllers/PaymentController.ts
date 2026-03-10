import { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentService } from '../services/PaymentService';
import { mapPaymentDto } from '../dto/financialDto';

export class PaymentController {
  private readonly paymentService = new PaymentService();
  private resolveActorUserId(req: Request) {
    const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
    return Number.isFinite(userId) && userId > 0 ? userId : undefined;
  }

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        accountId: z.string().trim().min(1).optional(),
        method: z.enum(['CASH', 'TRANSFER', 'CARD', 'MERCADO_PAGO', 'OTHER']).optional(),
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

      return res.json(result.map(mapPaymentDto));
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al listar pagos' });
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        accountId: z.string().trim().min(1),
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        method: z.enum(['CASH', 'TRANSFER', 'CARD', 'MERCADO_PAGO', 'OTHER']),
        source: z.enum(['POS', 'ONLINE', 'BACKOFFICE']).optional(),
        cashShiftId: z.string().trim().min(1).optional()
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const headerValue = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
      }
      const payment = await this.paymentService.create({
        clubId,
        accountId: parsed.data.accountId,
        amount: parsed.data.amount,
        method: parsed.data.method,
        source: parsed.data.source,
        cashShiftId: parsed.data.cashShiftId,
        createdByUserId: this.resolveActorUserId(req),
        idempotencyKey: idempotencyKey.trim()
      });

      return res.status(201).json(mapPaymentDto(payment));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al crear pago' });
    }
  };

}
