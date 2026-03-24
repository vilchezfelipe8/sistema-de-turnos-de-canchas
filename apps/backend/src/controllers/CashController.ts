import { Request, Response } from 'express';
import { z } from 'zod';
import { CashService } from '../services/CashService';
import { CashShiftService } from '../services/CashShiftService';
import { ClientDuplicateIncidentService } from '../services/ClientDuplicateIncidentService';
import { sanitizeString } from '../utils/sanitize';

const optionalPositiveIntSchema = z.preprocess((v) => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}, z.number().int().positive().optional());

const optionalPositiveNumberSchema = z.preprocess((v) => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}, z.number().positive().optional());

const saleItemSchema = z.object({
  itemKey: z.string().trim().min(1).max(120).optional(),
  productId: optionalPositiveIntSchema,
  quantity: z.preprocess((v) => Number(v), z.number().int().positive()),
  customName: z.string().trim().min(2).max(200).optional(),
  unitPrice: optionalPositiveNumberSchema
}).superRefine((value, ctx) => {
  if (value.productId) return;
  if (!value.customName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customName'],
      message: 'Debe indicar un nombre para el item manual'
    });
  }
  if (value.unitPrice == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unitPrice'],
      message: 'Debe indicar un precio unitario para el item manual'
    });
  }
});

const salePaymentAllocationSchema = z.object({
  itemKey: z.string().trim().min(1).max(120).optional(),
  productId: optionalPositiveIntSchema,
  amount: z.preprocess((v) => Number(v), z.number().positive())
}).superRefine((value, ctx) => {
  if (value.itemKey || value.productId) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['itemKey'],
    message: 'La asignación debe indicar itemKey o productId'
  });
});

const clientDraftSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(4).max(30).optional(),
  phoneCountryCode: z.string().trim().min(1).max(8).optional(),
  phoneNumberLocal: z.string().trim().min(4).max(30).optional(),
  dni: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  isProfessor: z.boolean().optional()
}).superRefine((value, ctx) => {
  const hasPhone = String(value.phone || '').trim().length > 0;
  const hasLocal = String(value.phoneNumberLocal || '').trim().length > 0;
  if (!hasPhone && !hasLocal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'Teléfono inválido'
    });
  }
});

const sanitizeSaleItems = (items?: Array<z.infer<typeof saleItemSchema>>) =>
  Array.isArray(items)
    ? items.map((item) => ({
        itemKey: item.itemKey ? sanitizeString(item.itemKey, 120) : undefined,
        productId: item.productId,
        quantity: Number(item.quantity),
        customName: item.customName ? sanitizeString(item.customName, 200) : undefined,
        unitPrice: item.unitPrice == null ? undefined : Number(item.unitPrice)
      }))
    : undefined;

const sanitizeSalePaymentAllocations = (payments?: Array<{
  method: 'CASH' | 'TRANSFER' | 'CARD';
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
  amount: number;
  allocations?: Array<z.infer<typeof salePaymentAllocationSchema>>;
}>) =>
  Array.isArray(payments)
    ? payments.map((payment) => ({
        method: payment.method,
        channel: payment.channel,
        amount: Number(payment.amount),
        allocations: Array.isArray(payment.allocations)
          ? payment.allocations.map((allocation) => ({
              itemKey: allocation.itemKey ? sanitizeString(allocation.itemKey, 120) : undefined,
              productId: allocation.productId,
              amount: Number(allocation.amount)
            }))
          : undefined
      }))
    : undefined;

export class CashController {
  private readonly duplicateIncidentService = new ClientDuplicateIncidentService();

  constructor(private readonly cashService: CashService) {}

  private async registerDuplicateIncident(req: Request, error: any, endpoint: 'createProductSale' | 'quoteProductSale') {
    try {
      const details = (error && typeof error === 'object') ? (error.details || {}) : {};
      const clubId = Number((req as any).clubId || details?.clubId || 0);
      if (!Number.isInteger(clubId) || clubId <= 0) return;

      const candidateClientIds: string[] = Array.from(
        new Set(
          (Array.isArray(details?.candidateClientIds) ? details.candidateClientIds : [])
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)
        )
      );
      if (candidateClientIds.length === 0) return;

      const actorUserId = Number((req as any)?.user?.userId || 0);
      const userId = Number(req.body?.userId || 0) > 0 ? Number(req.body.userId) : null;

      await this.duplicateIncidentService.createOrReuseIncident({
        clubId,
        userId,
        sourceType: 'CASH',
        reasonType: String(details?.reasonType || 'MULTI_SIGNAL_CONFLICT'),
        primaryClientId: details?.primaryClientId ? String(details.primaryClientId) : null,
        candidateClientIds,
        payload: {
          endpoint,
          signals: details?.signals || null,
          actorUserId: Number.isInteger(actorUserId) && actorUserId > 0 ? actorUserId : null
        }
      });
    } catch (incidentError) {
      console.warn('No se pudo registrar incidente de duplicado en caja', incidentError);
    }
  }

  getSummary = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const rawStartDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const rawEndDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const rawDate = typeof req.query.date === 'string' ? req.query.date : undefined;

      let summary;
      if (rawStartDate || rawEndDate) {
        if (!rawStartDate || !rawEndDate) {
          return res.status(400).json({ error: 'Debe enviar startDate y endDate juntos' });
        }
        summary = await this.cashService.getSummaryByDateRange(clubId, rawStartDate, rawEndDate);
      } else if (rawDate) {
        summary = await this.cashService.getSummaryByDate(clubId, rawDate);
      } else {
        summary = await this.cashService.getDailySummary(clubId);
      }

      return res.json(summary);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Error al obtener caja' });
    }
  };

  createMovement = async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        concept: z.string().trim().min(1),
        type: z.enum(['PAYMENT_IN', 'REFUND', 'WITHDRAW', 'DEPOSIT']),
        method: z.enum(['CASH', 'TRANSFER', 'CARD'])
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const actorUserId = Number((req as any)?.user?.userId || 0) || undefined;
      const shiftService = new CashShiftService();
      const currentShift = await shiftService.current(clubId);
      if (!currentShift) {
        return res.status(400).json({ error: 'No hay turno de caja abierto' });
      }

      const movement = await this.cashService.addMovement({
        ...parsed.data,
        concept: sanitizeString(parsed.data.concept, 500),
        clubId,
        cashShiftId: currentShift.id,
        createdByUserId: actorUserId
      }, actorUserId);

      return res.status(201).json(movement);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Error al crear movimiento' });
    }
  };

  getProducts = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      const products = await this.cashService.getProducts(clubId);
      return res.json(products);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudieron obtener los productos' });
    }
  };

  createProductSale = async (req: Request, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const schema = z.object({
        productId: optionalPositiveIntSchema,
        quantity: z.preprocess((v) => {
          if (v == null || v === '') return undefined;
          return Number(v);
        }, z.number().int().positive().optional()),
        items: z.array(saleItemSchema).optional(),
        method: z.enum(['CASH', 'TRANSFER', 'CARD']),
        channel: z.enum(['BANK_ACCOUNT', 'VIRTUAL_WALLET']).optional(),
        payments: z.array(z.object({
          method: z.enum(['CASH', 'TRANSFER', 'CARD']),
          channel: z.enum(['BANK_ACCOUNT', 'VIRTUAL_WALLET']).optional(),
          amount: z.preprocess((v) => Number(v), z.number().positive()),
          allocations: z.array(salePaymentAllocationSchema).optional()
        })).optional(),
        clientId: z.string().trim().optional(),
        clientDraft: clientDraftSchema.optional(),
        userId: z.preprocess((v) => {
          if (v == null || v === '') return undefined;
          const n = Number(v);
          return Number.isNaN(n) || n < 1 ? undefined : n;
        }, z.number().int().positive().optional())
      }).superRefine((value, ctx) => {
        if (value.clientId || value.clientDraft) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'Debes seleccionar un cliente o cargar un alta rápida válida.'
        });
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      const actorUserId = Number((req as any)?.user?.userId || 0) || undefined;

      const sale = await this.cashService.createProductSale({
        clubId,
        productId: parsed.data.productId,
        quantity: parsed.data.quantity,
        items: sanitizeSaleItems(parsed.data.items),
        method: parsed.data.method,
        channel: parsed.data.channel,
        payments: sanitizeSalePaymentAllocations(parsed.data.payments),
        clientId: parsed.data.clientId ? sanitizeString(parsed.data.clientId, 64) : undefined,
        clientDraft: parsed.data.clientDraft ? {
          name: sanitizeString(parsed.data.clientDraft.name, 200),
          phone: parsed.data.clientDraft.phone ? sanitizeString(parsed.data.clientDraft.phone, 30) : undefined,
          phoneCountryCode: parsed.data.clientDraft.phoneCountryCode ? sanitizeString(parsed.data.clientDraft.phoneCountryCode, 8) : undefined,
          phoneNumberLocal: parsed.data.clientDraft.phoneNumberLocal ? sanitizeString(parsed.data.clientDraft.phoneNumberLocal, 30) : undefined,
          dni: parsed.data.clientDraft.dni ? sanitizeString(parsed.data.clientDraft.dni, 20) : undefined,
          email: parsed.data.clientDraft.email ? sanitizeString(parsed.data.clientDraft.email, 120).toLowerCase() : undefined,
          isProfessor: Boolean(parsed.data.clientDraft.isProfessor)
        } : undefined,
        userId: parsed.data.userId,
        idempotencyKey
      } as any, actorUserId);

      return res.status(201).json(sale);
    } catch (error: any) {
      if (error?.code === 'CLIENT_POSSIBLE_DUPLICATE' || error?.message === 'CLIENT_POSSIBLE_DUPLICATE') {
        await this.registerDuplicateIncident(req, error, 'createProductSale');
        return res.status(409).json({ error: 'CLIENT_POSSIBLE_DUPLICATE' });
      }
      return res.status(400).json({ error: error.message || 'No se pudo registrar la venta' });
    }
  };

  quoteProductSale = async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        productId: optionalPositiveIntSchema,
        quantity: z.preprocess((v) => {
          if (v == null || v === '') return undefined;
          return Number(v);
        }, z.number().int().positive().optional()),
        items: z.array(saleItemSchema).optional(),
        clientId: z.string().trim().optional(),
        clientDraft: clientDraftSchema.optional(),
        userId: z.preprocess((v) => {
          if (v == null || v === '') return undefined;
          const n = Number(v);
          return Number.isNaN(n) || n < 1 ? undefined : n;
        }, z.number().int().positive().optional())
      }).superRefine((value, ctx) => {
        if (value.clientId || value.clientDraft) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clientId'],
          message: 'Debes seleccionar un cliente o cargar un alta rápida válida.'
        });
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = Number((req as any).clubId);
      if (parsed.data.clientDraft) {
        const hasAnyPhoneInput =
          Boolean(String(parsed.data.clientDraft.phone || '').trim()) ||
          Boolean(String(parsed.data.clientDraft.phoneNumberLocal || '').trim());
        if (!hasAnyPhoneInput) {
          return res.status(400).json({ error: 'CLIENT_DRAFT_INVALID' });
        }
      }
      const quote = await this.cashService.quoteProductSale({
        clubId,
        productId: parsed.data.productId,
        quantity: parsed.data.quantity,
        items: sanitizeSaleItems(parsed.data.items),
        clientId: parsed.data.clientId ? sanitizeString(parsed.data.clientId, 64) : undefined,
        clientDraft: parsed.data.clientDraft ? {
          name: sanitizeString(parsed.data.clientDraft.name, 200),
          phone: parsed.data.clientDraft.phone ? sanitizeString(parsed.data.clientDraft.phone, 30) : undefined,
          phoneCountryCode: parsed.data.clientDraft.phoneCountryCode ? sanitizeString(parsed.data.clientDraft.phoneCountryCode, 8) : undefined,
          phoneNumberLocal: parsed.data.clientDraft.phoneNumberLocal ? sanitizeString(parsed.data.clientDraft.phoneNumberLocal, 30) : undefined,
          dni: parsed.data.clientDraft.dni ? sanitizeString(parsed.data.clientDraft.dni, 20) : undefined,
          email: parsed.data.clientDraft.email ? sanitizeString(parsed.data.clientDraft.email, 120).toLowerCase() : undefined,
          isProfessor: Boolean(parsed.data.clientDraft.isProfessor)
        } : undefined,
        userId: parsed.data.userId
      } as any);

      return res.json(quote);
    } catch (error: any) {
      if (error?.code === 'CLIENT_POSSIBLE_DUPLICATE' || error?.message === 'CLIENT_POSSIBLE_DUPLICATE') {
        await this.registerDuplicateIncident(req, error, 'quoteProductSale');
        return res.status(409).json({ error: 'CLIENT_POSSIBLE_DUPLICATE' });
      }
      return res.status(400).json({ error: error.message || 'No se pudo cotizar la venta' });
    }
  };
}
