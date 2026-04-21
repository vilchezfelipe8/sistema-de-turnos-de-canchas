import { Request, Response } from 'express';
import { z } from 'zod';
import { AccountService } from '../services/AccountService';
import { AccountItemService } from '../services/AccountItemService';
import { PaymentService } from '../services/PaymentService';
import { mapAccountDto, mapAccountItemDto, mapLedgerEntryDto, mapPaymentDto } from '../dto/financialDto';
import { sanitizeString } from '../utils/sanitize';
import { prismaRead } from '../prisma';

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

      const bookingIds = result
        .filter((account: any) => account.sourceType === 'BOOKING')
        .map((account: any) => Number(account.sourceId))
        .filter((id: number) => Number.isFinite(id) && id > 0);

      const bookings = bookingIds.length > 0
        ? await prismaRead.booking.findMany({
            where: { clubId, id: { in: bookingIds } },
            include: {
              court: { select: { name: true } },
              client: { select: { name: true } }
            }
          })
        : [];

      const bookingMap = new Map<number, any>();
      for (const booking of bookings) {
        bookingMap.set(booking.id, booking);
      }

      return res.json(result.map((account: any) => {
        const bookingId = account.sourceType === 'BOOKING' ? Number(account.sourceId) : null;
        const booking = bookingId ? bookingMap.get(bookingId) : null;
        return {
          ...mapAccountDto(account),
          items: Array.isArray(account.items) ? account.items.map(mapAccountItemDto) : [],
          payments: Array.isArray(account.payments) ? account.payments.map(mapPaymentDto) : [],
          booking: booking
            ? {
                id: booking.id,
                startDateTime: booking.startDateTime,
                courtName: booking.court?.name ?? null,
                clientName: booking.client?.name ?? null
              }
            : null
        };
      }));
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
        type: z.enum(['PRODUCT', 'SERVICE', 'ADJUSTMENT']).optional(),
        productId: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),
        serviceCode: z.string().trim().min(1).optional(),
        applyDiscount: z.preprocess((v) => v === undefined ? undefined : (v === true || v === 'true'), z.boolean().optional())
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = this.resolveClubId(req);
      const safeDescription = sanitizeString(bodyParsed.data.description);
      const actorUserId = this.resolveActorUserId(req);
      const item = await this.accountItemService.create(clubId, paramsParsed.data.id, {
        ...bodyParsed.data,
        description: safeDescription,
        actorUserId: actorUserId ?? null
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
      const knownError = error as Error & { code?: string; remaining?: number };
      const message = knownError?.message || 'No se pudo cerrar la cuenta';

      if (knownError?.code === 'ACCOUNT_HAS_PENDING_BALANCE') {
        return res.status(409).json({
          error: message,
          code: knownError.code,
          remaining: Number(knownError.remaining || 0)
        });
      }

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
        method: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']),
        channel: z.enum(['AUTO', 'CASH_DRAWER', 'BANK_ACCOUNT', 'CARD_TERMINAL', 'VIRTUAL_WALLET', 'OTHER']).optional(),
        collectorAccountLabel: z.string().trim().max(120).optional(),
        externalReference: z.string().trim().max(120).optional(),
        source: z.enum(['POS', 'ONLINE', 'BACKOFFICE']).optional(),
        cashShiftId: z.string().trim().min(1).optional(),
        allocations: z.array(z.object({
          accountItemId: z.string().trim().min(1),
          amount: z.preprocess((v) => Number(v), z.number().positive())
        })).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });
      if (bodyParsed.data.method === 'TRANSFER' && !bodyParsed.data.channel) {
        return res.status(400).json({ error: 'El canal es obligatorio para pagos por transferencia' });
      }

      const actorUserId = this.resolveActorUserId(req);
      const clubId = this.resolveClubId(req);
      const headerValue = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        return res.status(400).json({ error: 'Falta la clave de idempotencia para registrar el pago' });
      }
      const payment = await this.paymentService.create({
        clubId,
        accountId: paramsParsed.data.id,
        amount: bodyParsed.data.amount,
        method: bodyParsed.data.method,
        channel: bodyParsed.data.channel,
        collectorAccountLabel: bodyParsed.data.collectorAccountLabel,
        externalReference: bodyParsed.data.externalReference,
        source: bodyParsed.data.source,
        cashShiftId: bodyParsed.data.cashShiftId,
        createdByUserId: actorUserId,
        idempotencyKey: idempotencyKey.trim(),
        allocations: bodyParsed.data.allocations
      });

      return res.status(201).json(mapPaymentDto(payment));
    } catch (error: unknown) {
      const knownError = error as Error & { code?: string };
      const message = knownError?.message || 'No se pudo registrar el pago';
      if (knownError?.code === 'BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN') {
        return res.status(409).json({ error: message, code: knownError.code });
      }
      return res.status(400).json({ error: message });
    }
  };
}
