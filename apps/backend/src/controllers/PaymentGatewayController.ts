import { Request, Response } from 'express';
import { z } from 'zod';
import {
  mapFiscalDocumentDto,
  mapGatewayTransactionDto,
  mapPaymentProviderAccountDto
} from '../dto/financialDto';
import { PaymentGatewayService } from '../services/PaymentGatewayService';
import { prismaRead } from '../prisma';

const providerEnum = z.enum(['MERCADOPAGO', 'BANK_TRANSFER', 'MANUAL_POS', 'OTHER']);
const providerStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'ERROR']);
const gatewayTypeEnum = z.enum(['PAYMENT', 'REFUND', 'CHARGEBACK', 'REVERSAL']);
const gatewayStatusEnum = z.enum([
  'PENDING',
  'IN_PROCESS',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'FAILED'
]);
const fiscalDocumentTypeEnum = z.enum([
  'INVOICE_B',
  'INVOICE_C',
  'CREDIT_NOTE_B',
  'CREDIT_NOTE_C',
  'DEBIT_NOTE_B',
  'DEBIT_NOTE_C',
  'RECEIPT_X'
]);

export class PaymentGatewayController {
  private readonly paymentGatewayService = new PaymentGatewayService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as Request & { clubId?: number }).clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) throw new Error('Club invalido');
    return clubId;
  }

  listProviderAccounts = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const rows = await this.paymentGatewayService.listProviderAccounts(clubId);
      return res.json(rows.map(mapPaymentProviderAccountDto));
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al listar cuentas proveedoras' });
    }
  };

  createProviderAccount = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        provider: providerEnum,
        displayName: z.string().trim().min(2).max(100),
        externalMerchantId: z.string().trim().max(120).optional(),
        accountAlias: z.string().trim().max(120).optional(),
        accountCbu: z.string().trim().max(32).optional(),
        accountCvu: z.string().trim().max(32).optional(),
        credentialsEncrypted: z.record(z.unknown()).optional(),
        webhookSecretEncrypted: z.string().trim().max(300).optional(),
        isDefault: z.boolean().optional()
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const row = await this.paymentGatewayService.registerProviderAccount({
        clubId: this.resolveClubId(req),
        ...parsed.data
      });
      return res.status(201).json(mapPaymentProviderAccountDto(row));
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al crear cuenta proveedora' });
    }
  };

  startMercadoPagoOAuth = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        providerAccountId: z.string().trim().min(1).optional()
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const result = this.paymentGatewayService.getMercadoPagoOAuthStartUrl({
        clubId: this.resolveClubId(req),
        providerAccountId: parsed.data.providerAccountId
      });

      return res.status(200).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al iniciar OAuth con Mercado Pago' });
    }
  };

  mercadoPagoOAuthCallback = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        code: z.string().trim().min(1),
        state: z.string().trim().min(1),
        displayName: z.string().trim().max(100).optional()
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const account = await this.paymentGatewayService.connectMercadoPagoAccount({
        code: parsed.data.code,
        state: parsed.data.state,
        displayName: parsed.data.displayName
      });

      const successRedirect = process.env.MP_OAUTH_SUCCESS_REDIRECT_URL?.trim();
      if (successRedirect) {
        const redirectUrl = new URL(successRedirect);
        redirectUrl.searchParams.set('status', 'ok');
        redirectUrl.searchParams.set('provider', 'mercadopago');
        redirectUrl.searchParams.set('providerAccountId', account.id);
        return res.redirect(redirectUrl.toString());
      }

      return res.status(200).json({
        status: 'ok',
        account: mapPaymentProviderAccountDto(account)
      });
    } catch (error: any) {
      const errorMessage = error?.message || 'Error en callback OAuth de Mercado Pago';
      const errorRedirect = process.env.MP_OAUTH_ERROR_REDIRECT_URL?.trim();
      if (errorRedirect) {
        const redirectUrl = new URL(errorRedirect);
        redirectUrl.searchParams.set('status', 'error');
        redirectUrl.searchParams.set('message', errorMessage);
        return res.redirect(redirectUrl.toString());
      }
      return res.status(400).json({ error: errorMessage });
    }
  };

  updateProviderAccountStatus = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        providerAccountId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        status: providerStatusEnum,
        isDefault: z.boolean().optional()
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const row = await this.paymentGatewayService.setProviderAccountStatus({
        clubId: this.resolveClubId(req),
        providerAccountId: paramsParsed.data.providerAccountId,
        ...bodyParsed.data
      });

      return res.status(200).json(mapPaymentProviderAccountDto(row));
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al actualizar estado de cuenta proveedora' });
    }
  };

  upsertGatewayTransaction = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        providerAccountId: z.string().trim().min(1).optional(),
        provider: providerEnum,
        externalId: z.string().trim().min(1).max(200),
        externalReference: z.string().trim().max(120).optional(),
        type: gatewayTypeEnum,
        status: gatewayStatusEnum,
        amount: z.preprocess((v) => Number(v), z.number().positive()),
        netAmount: z.preprocess((v) => (v == null ? undefined : Number(v)), z.number().positive().optional()),
        feeAmount: z.preprocess((v) => (v == null ? undefined : Number(v)), z.number().nonnegative().optional()),
        currency: z.string().trim().max(10).optional(),
        paymentId: z.string().trim().min(1).optional(),
        refundId: z.string().trim().min(1).optional(),
        occurredAt: z.string().datetime().optional(),
        settledAt: z.string().datetime().optional(),
        rawPayload: z.record(z.unknown()).optional(),
        reconciliationNotes: z.string().trim().max(500).optional()
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const row = await this.paymentGatewayService.registerGatewayTransaction({
        ...parsed.data,
        clubId: this.resolveClubId(req),
        occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
        settledAt: parsed.data.settledAt ? new Date(parsed.data.settledAt) : undefined
      });

      return res.status(201).json(mapGatewayTransactionDto(row));
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al registrar transaccion gateway' });
    }
  };

  listGatewayTransactions = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        providerAccountId: z.string().trim().min(1).optional(),
        status: gatewayStatusEnum.optional(),
        paymentId: z.string().trim().min(1).optional(),
        refundId: z.string().trim().min(1).optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(300).optional())
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const rows = await this.paymentGatewayService.listGatewayTransactions({
        clubId: this.resolveClubId(req),
        providerAccountId: parsed.data.providerAccountId,
        status: parsed.data.status,
        paymentId: parsed.data.paymentId,
        refundId: parsed.data.refundId,
        take: parsed.data.take
      });

      return res.json(rows.map(mapGatewayTransactionDto));
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Error al listar transacciones gateway' });
    }
  };

  requestPaymentFiscalDocument = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        paymentId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        documentType: fiscalDocumentTypeEnum.optional()
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = this.resolveClubId(req);
      await this.paymentGatewayService.enqueueFiscalIssueForPayment({
        clubId,
        paymentId: paramsParsed.data.paymentId,
        documentType: bodyParsed.data.documentType,
        dedupeSuffix: `manual-${Date.now()}`
      });

      return res.status(202).json({ status: 'queued' });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al solicitar documento fiscal del pago' });
    }
  };

  requestRefundFiscalDocument = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        refundId: z.string().trim().min(1)
      });
      const bodySchema = z.object({
        documentType: fiscalDocumentTypeEnum.optional()
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = this.resolveClubId(req);
      await this.paymentGatewayService.enqueueFiscalIssueForRefund({
        clubId,
        refundId: paramsParsed.data.refundId,
        documentType: bodyParsed.data.documentType,
        dedupeSuffix: `manual-${Date.now()}`
      });

      return res.status(202).json({ status: 'queued' });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error al solicitar documento fiscal de la devolucion' });
    }
  };

  listFiscalDocuments = async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        paymentId: z.string().trim().min(1).optional(),
        refundId: z.string().trim().min(1).optional(),
        status: z.enum(['PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'FAILED']).optional(),
        take: z.preprocess((v) => (v == null || v === '' ? undefined : Number(v)), z.number().int().positive().max(200).optional())
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const clubId = this.resolveClubId(req);
      const rows = await prismaRead.fiscalDocument.findMany({
        where: {
          clubId,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.paymentId ? { payment: { id: parsed.data.paymentId } } : {}),
          ...(parsed.data.refundId ? { refund: { id: parsed.data.refundId } } : {})
        },
        orderBy: { createdAt: 'desc' },
        take: parsed.data.take ?? 100
      });

      return res.json(rows.map(mapFiscalDocumentDto));
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Error al listar documentos fiscales' });
    }
  };

  mercadopagoWebhook = async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        providerAccountId: z.string().trim().min(1).optional()
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

      const row = await this.paymentGatewayService.handleMercadoPagoWebhook({
        providerAccountId: parsed.data.providerAccountId,
        rawPayload: req.body as Record<string, unknown>,
        rawBody: String((req as Request & { rawBody?: string }).rawBody || ''),
        signatureHeader: req.header('x-signature'),
        requestIdHeader: req.header('x-request-id'),
        dataIdQueryParam: this.resolveDataIdQueryParam(req)
      });

      return res.status(200).json({
        status: 'ok',
        transaction: mapGatewayTransactionDto(row)
      });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Webhook Mercado Pago invalido' });
    }
  };

  reprocessMercadoPagoTransaction = async (req: Request, res: Response) => {
    try {
      const paramsSchema = z.object({
        externalId: z.string().trim().min(1).max(200)
      });
      const bodySchema = z.object({
        providerAccountId: z.string().trim().min(1),
        paymentIdHint: z.string().trim().min(1).optional()
      });
      const paramsParsed = paramsSchema.safeParse(req.params);
      const bodyParsed = bodySchema.safeParse(req.body);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const row = await this.paymentGatewayService.reprocessMercadoPagoTransaction({
        clubId: this.resolveClubId(req),
        providerAccountId: bodyParsed.data.providerAccountId,
        externalId: paramsParsed.data.externalId,
        paymentIdHint: bodyParsed.data.paymentIdHint
      });

      return res.status(200).json({
        status: 'reprocessed',
        transaction: mapGatewayTransactionDto(row)
      });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Error reprocesando transaccion de Mercado Pago' });
    }
  };

  private resolveDataIdQueryParam(req: Request) {
    const value = (req.query as Record<string, unknown>)['data.id'];
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
    if (typeof value === 'string') return value;
    return null;
  }
}
