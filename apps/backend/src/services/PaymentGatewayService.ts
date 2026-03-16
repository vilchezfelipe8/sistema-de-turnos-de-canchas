import {
  FiscalDocumentType,
  FiscalMode,
  FiscalProvider,
  GatewayTransactionStatus,
  GatewayTransactionType,
  PaymentProvider,
  Prisma,
  ProviderAccountStatus
} from '@prisma/client';
import { prisma } from '../prisma';
import { OUTBOX_TYPES, OutboxService } from './OutboxService';
import { MercadoPagoService } from './MercadoPagoService';
import {
  decryptJsonSecret,
  decryptMaybeEncryptedText,
  encryptJsonSecret,
  encryptMaybeText
} from '../utils/secretsEncryption';

type RegisterProviderAccountInput = {
  clubId: number;
  provider: PaymentProvider;
  displayName: string;
  externalMerchantId?: string;
  accountAlias?: string;
  accountCbu?: string;
  accountCvu?: string;
  credentialsEncrypted?: Record<string, unknown>;
  webhookSecretEncrypted?: string;
  isDefault?: boolean;
};

type RegisterGatewayTransactionInput = {
  clubId?: number;
  providerAccountId?: string;
  provider: PaymentProvider;
  externalId: string;
  externalReference?: string;
  type: GatewayTransactionType;
  status: GatewayTransactionStatus;
  amount: number;
  netAmount?: number;
  feeAmount?: number;
  currency?: string;
  paymentId?: string;
  refundId?: string;
  occurredAt?: Date;
  settledAt?: Date;
  rawPayload?: Record<string, unknown>;
  reconciliationNotes?: string;
};

export type FiscalIssuePayload = {
  clubId: number;
  paymentId?: string;
  refundId?: string;
  documentType?: FiscalDocumentType;
};

export class PaymentGatewayService {
  private readonly outboxService = new OutboxService();
  private readonly mercadoPagoService = new MercadoPagoService();

  private roundMoney(value: number) {
    return Number((Number(value || 0)).toFixed(2));
  }

  private normalizeText(value: unknown, maxLen: number): string | null {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  async listProviderAccounts(clubId: number) {
    return prisma.paymentProviderAccount.findMany({
      where: { clubId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async listGatewayTransactions(params: {
    clubId: number;
    providerAccountId?: string;
    status?: GatewayTransactionStatus;
    paymentId?: string;
    refundId?: string;
    take?: number;
  }) {
    return prisma.gatewayTransaction.findMany({
      where: {
        clubId: params.clubId,
        ...(params.providerAccountId ? { providerAccountId: params.providerAccountId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.paymentId ? { paymentId: params.paymentId } : {}),
        ...(params.refundId ? { refundId: params.refundId } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100
    });
  }

  getMercadoPagoOAuthStartUrl(params: { clubId: number; providerAccountId?: string }) {
    return this.mercadoPagoService.buildOAuthStartUrl(params);
  }

  async connectMercadoPagoAccount(input: {
    code: string;
    state: string;
    displayName?: string;
  }) {
    const statePayload = this.mercadoPagoService.verifyOAuthState(input.state);
    const token = await this.mercadoPagoService.exchangeOAuthCode(input.code);
    const tokenExpiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;

    return prisma.$transaction(async (tx) => {
      const credentials: Record<string, unknown> = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenType: token.token_type ?? null,
        publicKey: token.public_key ?? null,
        liveMode: token.live_mode ?? null,
        userId: token.user_id ?? null,
        scope: token.scope ?? null,
        obtainedAt: new Date().toISOString()
      };

      if (statePayload.providerAccountId) {
        const existing = await tx.paymentProviderAccount.findFirst({
          where: {
            id: statePayload.providerAccountId,
            clubId: statePayload.clubId,
            provider: 'MERCADOPAGO'
          }
        });
        if (!existing) {
          throw new Error('Cuenta proveedora no encontrada para vincular OAuth');
        }

        return tx.paymentProviderAccount.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            displayName: input.displayName?.trim() || existing.displayName,
            externalMerchantId: token.user_id ? String(token.user_id) : existing.externalMerchantId,
            credentialsEncrypted: encryptJsonSecret(credentials) as Prisma.InputJsonValue,
            tokenExpiresAt,
            lastSyncAt: new Date(),
            lastError: null
          }
        });
      }

      const merchantId = token.user_id ? String(token.user_id) : null;
      if (!merchantId) {
        return tx.paymentProviderAccount.create({
          data: {
            clubId: statePayload.clubId,
            provider: 'MERCADOPAGO',
            status: 'ACTIVE',
            displayName: input.displayName?.trim() || 'Mercado Pago',
            externalMerchantId: null,
            credentialsEncrypted: encryptJsonSecret(credentials) as Prisma.InputJsonValue,
            tokenExpiresAt,
            lastSyncAt: new Date()
          }
        });
      }

      return tx.paymentProviderAccount.upsert({
        where: {
          clubId_provider_externalMerchantId: {
            clubId: statePayload.clubId,
            provider: 'MERCADOPAGO',
            externalMerchantId: merchantId
          }
        },
        create: {
          clubId: statePayload.clubId,
          provider: 'MERCADOPAGO',
          status: 'ACTIVE',
          displayName: input.displayName?.trim() || 'Mercado Pago',
          externalMerchantId: merchantId,
          credentialsEncrypted: encryptJsonSecret(credentials) as Prisma.InputJsonValue,
          tokenExpiresAt,
          lastSyncAt: new Date()
        },
        update: {
          status: 'ACTIVE',
          displayName: input.displayName?.trim() || undefined,
          credentialsEncrypted: encryptJsonSecret(credentials) as Prisma.InputJsonValue,
          tokenExpiresAt,
          lastSyncAt: new Date(),
          lastError: null
        }
      });
    });
  }

  async registerProviderAccount(input: RegisterProviderAccountInput) {
    if (!input.displayName?.trim()) {
      throw new Error('El nombre de la cuenta proveedora es obligatorio');
    }

    return prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.paymentProviderAccount.updateMany({
          where: {
            clubId: input.clubId,
            provider: input.provider,
            isDefault: true
          },
          data: { isDefault: false }
        });
      }

      return tx.paymentProviderAccount.create({
        data: {
          clubId: input.clubId,
          provider: input.provider,
          displayName: input.displayName.trim(),
          externalMerchantId: this.normalizeText(input.externalMerchantId, 120),
          accountAlias: this.normalizeText(input.accountAlias, 120),
          accountCbu: this.normalizeText(input.accountCbu, 32),
          accountCvu: this.normalizeText(input.accountCvu, 32),
          credentialsEncrypted: input.credentialsEncrypted
            ? (encryptJsonSecret(input.credentialsEncrypted) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          webhookSecretEncrypted: encryptMaybeText(this.normalizeText(input.webhookSecretEncrypted, 300)),
          isDefault: Boolean(input.isDefault)
        }
      });
    });
  }

  async setProviderAccountStatus(input: {
    clubId: number;
    providerAccountId: string;
    status: ProviderAccountStatus;
    isDefault?: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      const account = await tx.paymentProviderAccount.findFirst({
        where: {
          id: input.providerAccountId,
          clubId: input.clubId
        }
      });
      if (!account) throw new Error('Cuenta proveedora no encontrada');

      if (input.isDefault === true) {
        await tx.paymentProviderAccount.updateMany({
          where: {
            clubId: input.clubId,
            provider: account.provider,
            isDefault: true
          },
          data: { isDefault: false }
        });
      }

      return tx.paymentProviderAccount.update({
        where: { id: input.providerAccountId },
        data: {
          status: input.status,
          isDefault: input.isDefault === undefined ? account.isDefault : input.isDefault
        }
      });
    });
  }

  async registerGatewayTransaction(input: RegisterGatewayTransactionInput) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('El monto de la transaccion debe ser mayor a 0');
    }

    return prisma.$transaction(async (tx) => {
      let clubId = input.clubId;

      if (input.providerAccountId) {
        const providerAccount = await tx.paymentProviderAccount.findUnique({
          where: { id: input.providerAccountId },
          select: { id: true, clubId: true, provider: true, status: true }
        });
        if (!providerAccount) throw new Error('Cuenta proveedora no encontrada');
        if (providerAccount.provider !== input.provider) {
          throw new Error('La cuenta proveedora no coincide con el proveedor');
        }
        if (providerAccount.status !== 'ACTIVE') {
          throw new Error('La cuenta proveedora no esta activa');
        }
        clubId = providerAccount.clubId;
      }

      if (input.paymentId) {
        const payment = await tx.payment.findUnique({
          where: { id: input.paymentId },
          include: { account: { select: { clubId: true } } }
        });
        if (!payment) throw new Error('Pago no encontrado');
        if (!clubId) clubId = payment.account.clubId;
        if (clubId !== payment.account.clubId) {
          throw new Error('El pago no pertenece al club de la transaccion');
        }
      }

      if (input.refundId) {
        const refund = await tx.refund.findUnique({
          where: { id: input.refundId },
          select: { id: true, clubId: true }
        });
        if (!refund) throw new Error('Refund no encontrado');
        if (!clubId) clubId = refund.clubId;
        if (clubId !== refund.clubId) {
          throw new Error('El refund no pertenece al club de la transaccion');
        }
      }

      if (!clubId) {
        throw new Error('No se pudo resolver el club de la transaccion');
      }

      const baseData: Prisma.GatewayTransactionUncheckedCreateInput = {
        clubId,
        providerAccountId: input.providerAccountId ?? null,
        provider: input.provider,
        type: input.type,
        status: input.status,
        externalId: input.externalId.trim(),
        externalReference: this.normalizeText(input.externalReference, 120),
        amount: new Prisma.Decimal(this.roundMoney(input.amount)),
        netAmount: input.netAmount == null ? null : new Prisma.Decimal(this.roundMoney(input.netAmount)),
        feeAmount: input.feeAmount == null ? null : new Prisma.Decimal(this.roundMoney(input.feeAmount)),
        currency: this.normalizeText(input.currency || 'ARS', 10) || 'ARS',
        paymentId: input.paymentId ?? null,
        refundId: input.refundId ?? null,
        occurredAt: input.occurredAt ?? null,
        settledAt: input.settledAt ?? null,
        rawPayload: input.rawPayload ? (input.rawPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        reconciliationNotes: this.normalizeText(input.reconciliationNotes, 500)
      };

      const existing = await tx.gatewayTransaction.findUnique({
        where: {
          provider_externalId: {
            provider: input.provider,
            externalId: input.externalId.trim()
          }
        }
      });

      if (existing) {
        return tx.gatewayTransaction.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            type: input.type,
            providerAccountId: baseData.providerAccountId,
            externalReference: baseData.externalReference,
            amount: baseData.amount,
            netAmount: baseData.netAmount,
            feeAmount: baseData.feeAmount,
            currency: baseData.currency,
            paymentId: baseData.paymentId,
            refundId: baseData.refundId,
            occurredAt: baseData.occurredAt,
            settledAt: baseData.settledAt,
            rawPayload: baseData.rawPayload,
            reconciliationNotes: baseData.reconciliationNotes
          }
        });
      }

      return tx.gatewayTransaction.create({ data: baseData });
    });
  }

  private normalizeWebhookSecret(secretRaw: unknown) {
    const value = String(secretRaw || '').trim();
    if (!value) return null;
    return value;
  }

  private async resolvePaymentByReference(params: {
    clubId: number;
    externalReference?: string;
    paymentIdFromMetadata?: string;
  }) {
    if (params.paymentIdFromMetadata) {
      const byId = await prisma.payment.findFirst({
        where: {
          id: params.paymentIdFromMetadata,
          account: { clubId: params.clubId }
        },
        select: { id: true, accountId: true }
      });
      if (byId) return byId;
    }

    const externalReference = String(params.externalReference || '').trim();
    if (!externalReference) return null;

    const byExternalRef = await prisma.payment.findFirst({
      where: {
        account: { clubId: params.clubId },
        OR: [
          { externalReference: externalReference },
          { id: externalReference }
        ]
      },
      select: { id: true, accountId: true }
    });
    return byExternalRef;
  }

  async handleMercadoPagoWebhook(input: {
    providerAccountId?: string;
    rawPayload: Record<string, unknown>;
    rawBody: string;
    signatureHeader?: string | null;
    requestIdHeader?: string | null;
    dataIdQueryParam?: string | null;
  }) {
    let providerAccountId = input.providerAccountId;
    if (!providerAccountId) {
      const fromPayload = (input.rawPayload as any)?.providerAccountId;
      if (typeof fromPayload === 'string' && fromPayload.trim()) {
        providerAccountId = fromPayload.trim();
      }
    }
    if (!providerAccountId) {
      throw new Error('Falta providerAccountId para procesar webhook Mercado Pago');
    }

    const providerAccount = await prisma.paymentProviderAccount.findFirst({
      where: {
        id: providerAccountId,
        provider: 'MERCADOPAGO'
      },
      select: {
        id: true,
        clubId: true,
        status: true,
        webhookSecretEncrypted: true,
        credentialsEncrypted: true
      }
    });

    if (!providerAccount) {
      throw new Error('Cuenta Mercado Pago no encontrada');
    }
    if (providerAccount.status !== 'ACTIVE') {
      throw new Error('Cuenta Mercado Pago inactiva');
    }

    const isValidSignature = this.mercadoPagoService.validateWebhookSignature({
      rawBody: input.rawBody,
      headerSignature: input.signatureHeader,
      headerRequestId: input.requestIdHeader,
      dataId: input.dataIdQueryParam,
      secret: this.normalizeWebhookSecret(decryptMaybeEncryptedText(providerAccount.webhookSecretEncrypted))
    });

    if (!isValidSignature) {
      throw new Error('Firma de webhook invalida');
    }

    const credentials = decryptJsonSecret(providerAccount.credentialsEncrypted);
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : undefined;

    const parsed = await this.mercadoPagoService.parseWebhookToGatewayTransaction({
      rawPayload: input.rawPayload,
      accessToken
    });

    const linkedPayment = await this.resolvePaymentByReference({
      clubId: providerAccount.clubId,
      externalReference: parsed.externalReference,
      paymentIdFromMetadata: parsed.paymentId
    });

    const tx = await this.registerGatewayTransaction({
      clubId: providerAccount.clubId,
      providerAccountId: providerAccount.id,
      provider: 'MERCADOPAGO',
      externalId: parsed.externalId,
      externalReference: parsed.externalReference,
      type: parsed.type,
      status: parsed.status,
      amount: parsed.amount,
      netAmount: parsed.netAmount,
      feeAmount: parsed.feeAmount,
      paymentId: linkedPayment?.id || parsed.paymentId,
      refundId: parsed.refundId,
      occurredAt: parsed.occurredAt,
      settledAt: parsed.settledAt,
      rawPayload: parsed.rawPayload
    });

    if (linkedPayment && parsed.status === 'APPROVED') {
      await prisma.payment.update({
        where: { id: linkedPayment.id },
        data: {
          externalReference: parsed.externalReference || tx.externalReference || linkedPayment.id
        }
      });
    }

    return tx;
  }

  async reprocessMercadoPagoTransaction(input: {
    clubId: number;
    providerAccountId: string;
    externalId: string;
    paymentIdHint?: string;
  }) {
    const providerAccount = await prisma.paymentProviderAccount.findFirst({
      where: {
        id: input.providerAccountId,
        clubId: input.clubId,
        provider: 'MERCADOPAGO'
      },
      select: {
        id: true,
        clubId: true,
        credentialsEncrypted: true
      }
    });

    if (!providerAccount) {
      throw new Error('Cuenta Mercado Pago no encontrada para reproceso');
    }

    const credentials = decryptJsonSecret(providerAccount.credentialsEncrypted);
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : undefined;
    if (!accessToken) {
      throw new Error('La cuenta Mercado Pago no tiene access token disponible');
    }

    const parsed = await this.mercadoPagoService.parseWebhookToGatewayTransaction({
      rawPayload: {
        type: 'payment',
        data: { id: input.externalId }
      },
      accessToken
    });

    const linkedPayment = await this.resolvePaymentByReference({
      clubId: providerAccount.clubId,
      externalReference: parsed.externalReference,
      paymentIdFromMetadata: input.paymentIdHint || parsed.paymentId
    });

    return this.registerGatewayTransaction({
      clubId: providerAccount.clubId,
      providerAccountId: providerAccount.id,
      provider: 'MERCADOPAGO',
      externalId: parsed.externalId,
      externalReference: parsed.externalReference,
      type: parsed.type,
      status: parsed.status,
      amount: parsed.amount,
      netAmount: parsed.netAmount,
      feeAmount: parsed.feeAmount,
      paymentId: linkedPayment?.id || input.paymentIdHint || parsed.paymentId,
      refundId: parsed.refundId,
      occurredAt: parsed.occurredAt,
      settledAt: parsed.settledAt,
      rawPayload: parsed.rawPayload,
      reconciliationNotes: 'Reprocesado manualmente por admin'
    });
  }

  async enqueueFiscalIssueForPayment(input: {
    clubId: number;
    paymentId: string;
    documentType?: FiscalDocumentType;
    dedupeSuffix?: string;
  }) {
    return this.outboxService.enqueue({
      clubId: input.clubId,
      type: OUTBOX_TYPES.FISCAL_DOCUMENT_ISSUE,
      aggregateType: 'PAYMENT',
      aggregateId: input.paymentId,
      dedupeKey: `fiscal:payment:${input.paymentId}:${input.dedupeSuffix || 'default'}`,
      payload: {
        clubId: input.clubId,
        paymentId: input.paymentId,
        documentType: input.documentType || 'INVOICE_B'
      }
    });
  }

  async enqueueFiscalIssueForRefund(input: {
    clubId: number;
    refundId: string;
    documentType?: FiscalDocumentType;
    dedupeSuffix?: string;
  }) {
    return this.outboxService.enqueue({
      clubId: input.clubId,
      type: OUTBOX_TYPES.FISCAL_DOCUMENT_ISSUE,
      aggregateType: 'REFUND',
      aggregateId: input.refundId,
      dedupeKey: `fiscal:refund:${input.refundId}:${input.dedupeSuffix || 'default'}`,
      payload: {
        clubId: input.clubId,
        refundId: input.refundId,
        documentType: input.documentType || 'CREDIT_NOTE_B'
      }
    });
  }

  async processFiscalIssue(payload: FiscalIssuePayload) {
    if (!payload.paymentId && !payload.refundId) {
      throw new Error('Payload fiscal invalido: falta paymentId o refundId');
    }

    return prisma.$transaction(async (tx) => {
      if (payload.paymentId) {
        const payment = await tx.payment.findUnique({
          where: { id: payload.paymentId },
          include: { account: true }
        });
        if (!payment || payment.account.clubId !== payload.clubId) {
          throw new Error('Pago no encontrado para emitir comprobante fiscal');
        }

        if (payment.fiscalMode === FiscalMode.NONE) {
          throw new Error('El pago esta configurado como no fiscalizable');
        }

        if (payment.fiscalDocumentId) {
          const existingDocument = await tx.fiscalDocument.findUnique({
            where: { id: payment.fiscalDocumentId }
          });
          if (existingDocument) return existingDocument;
        }

        const doc = await tx.fiscalDocument.create({
          data: {
            clubId: payload.clubId,
            accountId: payment.accountId,
            provider: FiscalProvider.ARCA,
            type: payload.documentType || 'INVOICE_B',
            status: 'PENDING',
            totalAmount: payment.amount,
            requestPayload: {
              source: 'OUTBOX',
              paymentId: payment.id
            }
          }
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            fiscalStatus: 'PENDING',
            fiscalDocumentId: doc.id
          }
        });

        return doc;
      }

      const refund = await tx.refund.findUnique({
        where: { id: payload.refundId! }
      });
      if (!refund || refund.clubId !== payload.clubId) {
        throw new Error('Refund no encontrado para emitir comprobante fiscal');
      }

      if (refund.fiscalMode === FiscalMode.NONE) {
        throw new Error('El refund esta configurado como no fiscalizable');
      }

      if (refund.fiscalDocumentId) {
        const existingDocument = await tx.fiscalDocument.findUnique({
          where: { id: refund.fiscalDocumentId }
        });
        if (existingDocument) return existingDocument;
      }

      const doc = await tx.fiscalDocument.create({
        data: {
          clubId: payload.clubId,
          accountId: refund.accountId,
          provider: FiscalProvider.ARCA,
          type: payload.documentType || 'CREDIT_NOTE_B',
          status: 'PENDING',
          totalAmount: refund.amount,
          requestPayload: {
            source: 'OUTBOX',
            refundId: refund.id
          }
        }
      });

      await tx.refund.update({
        where: { id: refund.id },
        data: {
          fiscalStatus: 'PENDING',
          fiscalDocumentId: doc.id
        }
      });

      return doc;
    });
  }
}
