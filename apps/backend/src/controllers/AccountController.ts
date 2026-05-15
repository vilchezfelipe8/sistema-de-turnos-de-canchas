import { Request, Response } from 'express';
import { z } from 'zod';
import { AccountService } from '../services/AccountService';
import { AccountItemService } from '../services/AccountItemService';
import { PaymentService } from '../services/PaymentService';
import { mapAccountDto, mapAccountItemDto, mapLedgerEntryDto, mapPaymentDto } from '../dto/financialDto';
import { sanitizeString } from '../utils/sanitize';
import { prismaRead } from '../prisma';
import { sendAppError, badRequest, ErrorCodes, validationError, zodValidationAppError } from '../errors';

export class AccountController {
  private readonly accountService = new AccountService();
  private readonly accountItemService = new AccountItemService();
  private readonly paymentService = new PaymentService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as Request & { clubId?: number }).clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) throw badRequest('Club inválido.', ErrorCodes.INVALID_INPUT);
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
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

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
      return sendAppError(res, error, 'No se pudieron cargar las cuentas.');
    }
  };

  create = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        sourceType: z.enum(['BOOKING', 'BAR', 'TABLE', 'MANUAL']),
        sourceId: z.string().trim().min(1)
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const account = await this.accountService.openAccount({
        clubId,
        sourceType: parsed.data.sourceType,
        sourceId: parsed.data.sourceId
      });

      return res.status(201).json(mapAccountDto(account));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo abrir la cuenta.');
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

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
      return sendAppError(res, error, 'Cuenta no encontrada.');
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
      if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
      if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));

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
      return sendAppError(res, error, 'No se pudo agregar el consumo.');
    }
  };

  close = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const account = await this.accountService.closeAccount(clubId, parsed.data.id);
      return res.json(mapAccountDto(account));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo cerrar la cuenta.');
    }
  };

  // P2-B: Anular venta de mostrador — restaura stock, cierra cuenta.
  voidPos = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const account = await this.accountService.voidPosAccount(clubId, parsed.data.id, actorUserId ?? null);
      return res.json(mapAccountDto(account));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo anular la cuenta.');
    }
  };

  summary = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getAccountSummary(clubId, parsed.data.id);
      return res.json(result);
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el resumen de la cuenta.');
    }
  };

  balance = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getBalance(clubId, parsed.data.id);
      return res.json(result);
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el balance.');
    }
  };

  ledger = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({ id: z.string().min(1) });
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));

      const clubId = this.resolveClubId(req);
      const result = await this.accountService.getLedger(clubId, parsed.data.id);
      return res.json(result.map(mapLedgerEntryDto));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo obtener el libro contable.');
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
        payerParticipantRef: z.string().trim().min(1).max(191).optional(),
        payerParticipantName: z.string().trim().min(1).max(120).optional(),
        coveredParticipantRef: z.string().trim().min(1).max(191).optional(),
        coveredParticipantName: z.string().trim().min(1).max(120).optional(),
        allocations: z.array(z.object({
          accountItemId: z.string().trim().min(1),
          amount: z.preprocess((v) => Number(v), z.number().positive())
        })).optional()
      });

      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return sendAppError(res, zodValidationAppError(paramsParsed.error, 'Revisá los campos marcados.'));
      if (!bodyParsed.success) return sendAppError(res, zodValidationAppError(bodyParsed.error, 'Revisá los campos marcados.'));
      if (bodyParsed.data.method === 'TRANSFER' && !bodyParsed.data.channel) {
        throw validationError('Revisá los campos marcados.', { channel: 'El canal es obligatorio para pagos por transferencia.' });
      }

      const actorUserId = this.resolveActorUserId(req);
      const clubId = this.resolveClubId(req);
      const headerValue = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
        throw validationError('Revisá los campos marcados.', { general: 'Falta la clave de idempotencia para registrar el pago.' });
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
        payerParticipantRef: bodyParsed.data.payerParticipantRef,
        payerParticipantName: bodyParsed.data.payerParticipantName,
        coveredParticipantRef: bodyParsed.data.coveredParticipantRef,
        coveredParticipantName: bodyParsed.data.coveredParticipantName,
        createdByUserId: actorUserId,
        idempotencyKey: idempotencyKey.trim(),
        allocations: bodyParsed.data.allocations
      });

      return res.status(201).json(mapPaymentDto(payment));
    } catch (error: unknown) {
      return sendAppError(res, error, 'No se pudo registrar el pago.');
    }
  };
}
