import { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentService } from '../services/PaymentService';
import { mapPaymentDto, mapRefundDto } from '../dto/financialDto';
import { RefundService } from '../services/RefundService';

const refundStatusEnum = z.enum(['REQUESTED', 'APPROVED', 'READY_TO_EXECUTE', 'EXECUTED', 'FAILED', 'CANCELLED']);
const refundReasonTypeEnum = z.enum(['FULL', 'PARTIAL_COMMERCIAL', 'PARTIAL_SERVICE_FAILURE', 'PARTIAL_PRICING_ERROR', 'OTHER']);
const refundExecutionMethodEnum = z.enum(['CASH', 'TRANSFER', 'CARD_REVERSAL', 'CREDIT_NOTE', 'OTHER']);
const paymentChannelEnum = z.enum(['AUTO', 'CASH_DRAWER', 'BANK_ACCOUNT', 'CARD_TERMINAL', 'VIRTUAL_WALLET', 'OTHER']);

export class PaymentController {
  private readonly paymentService = new PaymentService();
  private readonly refundService = new RefundService();

  private resolveActorUserId(req: Request) {
    const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
    return Number.isFinite(userId) && userId > 0 ? userId : undefined;
  }

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        accountId: z.string().trim().min(1).optional(),
        method: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
        channel: paymentChannelEnum.optional(),
        externalReference: z.string().trim().min(1).max(120).optional(),
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
        method: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']),
        channel: paymentChannelEnum.optional(),
        collectorAccountLabel: z.string().trim().max(120).optional(),
        externalReference: z.string().trim().max(120).optional(),
        source: z.enum(['POS', 'ONLINE', 'BACKOFFICE']).optional(),
        cashShiftId: z.string().trim().min(1).optional()
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });
      if (parsed.data.method === 'TRANSFER' && !parsed.data.channel) {
        return res.status(400).json({ error: 'El canal es obligatorio para pagos por transferencia' });
      }

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
        channel: parsed.data.channel,
        collectorAccountLabel: parsed.data.collectorAccountLabel,
        externalReference: parsed.data.externalReference,
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

  requestRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        id: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        reason: z.string().trim().max(300).optional(),
        reasonType: refundReasonTypeEnum.optional(),
        executionMethod: refundExecutionMethodEnum.optional(),
        executionNotes: z.string().trim().max(500).optional(),
        executeNow: z.boolean().optional(),
        cashShiftId: z.string().trim().min(1).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.requestRefund({
        clubId,
        paymentId: paramsParsed.data.id,
        amount: bodyParsed.data.amount,
        reason: bodyParsed.data.reason,
        reasonType: bodyParsed.data.reasonType,
        executionMethod: bodyParsed.data.executionMethod,
        executionNotes: bodyParsed.data.executionNotes,
        executeNow: bodyParsed.data.executeNow,
        cashShiftId: bodyParsed.data.cashShiftId,
        createdByUserId: this.resolveActorUserId(req)
      });

      return res.status(201).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al solicitar devolucion' });
    }
  };

  approveRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        executeNow: z.boolean().optional(),
        cashShiftId: z.string().trim().min(1).optional(),
        executionReference: z.string().trim().max(120).optional(),
        executionNotes: z.string().trim().max(500).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.approveRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        approvedByUserId: this.resolveActorUserId(req),
        executeNow: bodyParsed.data.executeNow,
        cashShiftId: bodyParsed.data.cashShiftId,
        executionReference: bodyParsed.data.executionReference,
        executionNotes: bodyParsed.data.executionNotes
      });

      return res.status(200).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al aprobar devolucion' });
    }
  };

  executeRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        cashShiftId: z.string().trim().min(1).optional(),
        executionReference: z.string().trim().max(120).optional(),
        executionNotes: z.string().trim().max(500).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.executeRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        cashShiftId: bodyParsed.data.cashShiftId,
        executedByUserId: this.resolveActorUserId(req),
        executionReference: bodyParsed.data.executionReference,
        executionNotes: bodyParsed.data.executionNotes
      });

      return res.status(200).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al ejecutar devolucion' });
    }
  };

  failRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        reason: z.string().trim().min(3).max(500)
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.failRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        failedByUserId: this.resolveActorUserId(req),
        reason: bodyParsed.data.reason
      });

      return res.status(200).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al marcar devolucion fallida' });
    }
  };

  retryRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        executeNow: z.boolean().optional(),
        cashShiftId: z.string().trim().min(1).optional(),
        executionReference: z.string().trim().max(120).optional(),
        executionNotes: z.string().trim().max(500).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.retryRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        retriedByUserId: this.resolveActorUserId(req),
        executeNow: bodyParsed.data.executeNow,
        cashShiftId: bodyParsed.data.cashShiftId,
        executionReference: bodyParsed.data.executionReference,
        executionNotes: bodyParsed.data.executionNotes
      });

      return res.status(200).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al reintentar devolucion' });
    }
  };

  cancelRefund = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        reason: z.string().trim().min(3).max(300)
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = Number((req as any).clubId);
      const refund = await this.refundService.cancelRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        cancelledByUserId: this.resolveActorUserId(req),
        reason: bodyParsed.data.reason
      });

      return res.status(200).json(mapRefundDto(refund));
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al cancelar devolucion' });
    }
  };

  listPendingRefunds = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const result = await this.refundService.listPendingRefunds({
        clubId,
        take: parsed.data.take
      });

      return res.json(result.map(mapRefundDto));
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al listar devoluciones pendientes' });
    }
  };

  listRefunds = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        status: z.preprocess((value) => {
          if (value == null || value === '') return undefined;
          if (Array.isArray(value)) return value;
          return String(value).split(',').map((x) => x.trim()).filter(Boolean);
        }, z.array(refundStatusEnum).optional()),
        paymentId: z.string().trim().min(1).optional(),
        accountId: z.string().trim().min(1).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(500).optional())
      });

      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const result = await this.refundService.listRefunds({
        clubId,
        status: parsed.data.status,
        paymentId: parsed.data.paymentId,
        accountId: parsed.data.accountId,
        from: parsed.data.from ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to ? new Date(parsed.data.to) : undefined,
        take: parsed.data.take
      });

      return res.json(result.map(mapRefundDto));
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Error al listar devoluciones' });
    }
  };
}
