import { Request, Response } from 'express';
import { z } from 'zod';
import { AccountService } from '../services/AccountService';
import { AccountItemService } from '../services/AccountItemService';
import { PaymentService } from '../services/PaymentService';
import { mapAccountDto, mapAccountItemDto, mapLedgerEntryDto, mapPaymentDto } from '../dto/financialDto';
import { sanitizeString } from '../utils/sanitize';

export class AccountController {
  private readonly accountService = new AccountService();
  private readonly accountItemService = new AccountItemService();
  private readonly paymentService = new PaymentService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as Request & { clubId?: number }).clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) throw new Error('Club inválido');
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const userId = Number((req as Request & { user?: { userId?: number } }).user?.userId || 0);
    return Number.isFinite(userId) && userId > 0 ? userId : undefined;
  }

  list = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        status: z.enum(['OPEN', 'CLOSED']).optional(),
        bookingId: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().optional())
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.listAccounts(clubId, parsed.data.status, parsed.data.bookingId);
      return res.json(result.map((account: any) => ({
        ...mapAccountDto(account),
        items: Array.isArray(account.items) ? account.items.map(mapAccountItemDto) : [],
        payments: Array.isArray(account.payments) ? account.payments.map(mapPaymentDto) : []
      })));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al listar cuentas';
      return res.status(500).json({ error: message });
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        sourceType: z.enum(['BOOKING', 'BAR', 'TABLE', 'MANUAL']),
        sourceId: z.string().trim().min(1)
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const account = await this.accountService.openAccount({
        clubId,
        sourceType: parsed.data.sourceType,
        sourceId: parsed.data.sourceId
      });

      return res.status(201).json(mapAccountDto(account));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir la cuenta';
      return res.status(400).json({ error: message });
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getAccount(clubId, parsed.data.id);
      return res.json({
        account: mapAccountDto(result.account),
        items: result.items.map(mapAccountItemDto),
        payments: result.payments.map(mapPaymentDto),
        total: result.total,
        paid: result.paid,
        remaining: result.remaining
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Cuenta no encontrada';
      return res.status(404).json({ error: message });
    }
  };

  addItem = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const bodySchema = z.object({
        description: z.string().trim().min(1),
        quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
        unitPrice: z.preprocess((v) => Number(v), z.number().positive()),
        type: z.enum(['BOOKING', 'PRODUCT', 'SERVICE', 'ADJUSTMENT']).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = this.resolveClubId(req);
      const safeDescription = sanitizeString(bodyParsed.data.description);
      const item = await this.accountItemService.create(clubId, paramsParsed.data.id, {
        ...bodyParsed.data,
        description: safeDescription
      });
      return res.status(201).json(mapAccountItemDto(item));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo agregar el consumo';
      return res.status(400).json({ error: message });
    }
  };

  close = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const account = await this.accountService.closeAccount(clubId, parsed.data.id);
      return res.json(mapAccountDto(account));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo cerrar la cuenta';
      return res.status(400).json({ error: message });
    }
  };

  summary = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getAccountSummary(clubId, parsed.data.id);
      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo obtener el resumen de la cuenta';
      return res.status(400).json({ error: message });
    }
  };

  balance = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getBalance(clubId, parsed.data.id);
      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo obtener el balance';
      return res.status(400).json({ error: message });
    }
  };

  ledger = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getLedger(clubId, parsed.data.id);
      return res.json(result.map(mapLedgerEntryDto));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo obtener el libro contable';
      return res.status(400).json({ error: message });
    }
  };

  registerPayment = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const bodySchema = z.object({
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        method: z.enum(['CASH', 'CARD', 'TRANSFER', 'MERCADO_PAGO', 'OTHER']),
        source: z.enum(['POS', 'ONLINE', 'BACKOFFICE']).optional(),
        cashShiftId: z.string().trim().min(1).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const actorUserId = this.resolveActorUserId(req);
      const clubId = this.resolveClubId(req);
      const headerValue = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
      }
      const payment = await this.paymentService.create({
        clubId,
        accountId: paramsParsed.data.id,
        amount: bodyParsed.data.amount,
        method: bodyParsed.data.method,
        source: bodyParsed.data.source,
        cashShiftId: bodyParsed.data.cashShiftId,
        createdByUserId: actorUserId,
        idempotencyKey: idempotencyKey.trim()
      });

      return res.status(201).json(mapPaymentDto(payment));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el pago';
      return res.status(400).json({ error: message });
    }
  };
}
