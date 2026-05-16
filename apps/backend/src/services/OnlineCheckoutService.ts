import { PaymentChannel, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, ErrorCodes, badRequest } from '../errors';
import { ClubPaymentIntegrationService } from './ClubPaymentIntegrationService';
import { MercadoPagoService } from './MercadoPagoService';
import { PaymentService } from './PaymentService';
import { AccountService } from './AccountService';

const EPSILON = 0.009;

export class OnlineCheckoutService {
  private readonly mercadoPagoService = new MercadoPagoService();
  private readonly clubPaymentIntegrationService = new ClubPaymentIntegrationService();
  private readonly paymentService = new PaymentService();
  private readonly accountService = new AccountService();

  async processMercadoPagoWebhook(input: {
    clubId?: number | null;
    attemptId?: string | null;
    paymentId?: string | null;
    xSignature?: string | null;
    xRequestId?: string | null;
  }) {
    const paymentId = String(input.paymentId || '').trim();
    const attemptIdFromQuery = String(input.attemptId || '').trim();
    const clubId = Number(input.clubId || 0);

    if (!paymentId || !Number.isInteger(clubId) || clubId <= 0) {
      throw badRequest('Webhook de Mercado Pago inválido.', ErrorCodes.ONLINE_PAYMENT_WEBHOOK_INVALID);
    }

    if (!this.mercadoPagoService.validateWebhookSignature({
      dataId: paymentId,
      xSignature: input.xSignature,
      xRequestId: input.xRequestId
    })) {
      throw badRequest('La firma del webhook de Mercado Pago no es válida.', ErrorCodes.ONLINE_PAYMENT_WEBHOOK_INVALID);
    }

    const accessToken = await this.clubPaymentIntegrationService.getMercadoPagoAccessTokenForClub(clubId);
    if (!accessToken) {
      throw badRequest('El club no tiene una integración válida con Mercado Pago.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }

    const payment = await this.mercadoPagoService.getPayment(accessToken, paymentId);
    const externalReference = String(payment.external_reference || '').trim();
    const attemptId = attemptIdFromQuery || externalReference;
    if (!attemptId) {
      throw badRequest('No pudimos asociar el pago online a un intento local.', ErrorCodes.ONLINE_PAYMENT_WEBHOOK_INVALID);
    }

    return prisma.$transaction(async (tx) => {
      const attemptRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "OnlinePaymentAttempt"
        WHERE "id" = ${attemptId}
        FOR UPDATE
      `;

      if (attemptRows.length === 0) {
        throw new AppError({
          statusCode: 404,
          code: ErrorCodes.ONLINE_PAYMENT_ATTEMPT_NOT_FOUND,
          message: 'No encontramos el intento de pago online.'
        });
      }

      const attempt = await tx.onlinePaymentAttempt.findUnique({
        where: { id: attemptId }
      });

      if (!attempt || attempt.clubId !== clubId) {
        throw new AppError({
          statusCode: 404,
          code: ErrorCodes.ONLINE_PAYMENT_ATTEMPT_NOT_FOUND,
          message: 'No encontramos el intento de pago online.'
        });
      }

      const providerStatus = String(payment.status || '').trim().toLowerCase();
      const providerPaymentId = String(payment.id || '').trim() || paymentId;
      const rawPaymentJson = payment as Prisma.InputJsonValue;

      if (attempt.status === 'APPROVED' && attempt.paymentId) {
        return {
          ok: true,
          attemptId: attempt.id,
          paymentId: attempt.paymentId,
          alreadyProcessed: true
        };
      }

      if (providerStatus !== 'approved') {
        const nextStatus =
          providerStatus === 'rejected'
            ? 'REJECTED'
            : providerStatus === 'cancelled'
              ? 'CANCELLED'
              : providerStatus === 'expired'
                ? 'EXPIRED'
                : 'PENDING';

        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: nextStatus,
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            failureReason: null
          }
        });

        await tx.auditLog.create({
          data: {
            clubId,
            userId: attempt.userId,
            entity: 'ONLINE_PAYMENT_ATTEMPT',
            entityId: attempt.id,
            action: providerStatus === 'rejected' ? 'PAYMENT_ONLINE_REJECTED' : 'PAYMENT_ONLINE_UPDATED',
            payload: {
              provider: 'MERCADO_PAGO',
              providerStatus,
              providerPaymentId
            }
          }
        });

        return { ok: true, attemptId: attempt.id, status: nextStatus };
      }

      const approvedAmount = Number(Number(payment.transaction_amount || 0).toFixed(2));
      const expectedAmount = Number(Number(attempt.amount || 0).toFixed(2));
      if (Math.abs(approvedAmount - expectedAmount) > EPSILON) {
        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'ERROR',
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            failureReason: ErrorCodes.CHECKOUT_AMOUNT_CHANGED
          }
        });

        await tx.auditLog.create({
          data: {
            clubId,
            userId: attempt.userId,
            entity: 'ONLINE_PAYMENT_ATTEMPT',
            entityId: attempt.id,
            action: 'PAYMENT_ONLINE_AMOUNT_MISMATCH',
            payload: {
              provider: 'MERCADO_PAGO',
              providerPaymentId,
              approvedAmount,
              expectedAmount
            }
          }
        });

        return { ok: true, attemptId: attempt.id, status: 'ERROR', reason: ErrorCodes.CHECKOUT_AMOUNT_CHANGED };
      }

      const account = await tx.account.findUnique({
        where: { id: attempt.accountId },
        include: {
          refunds: {
            select: { status: true }
          }
        }
      });
      if (!account) {
        throw new AppError({
          statusCode: 404,
          code: ErrorCodes.ACCOUNT_NOT_FOUND,
          message: 'Cuenta no encontrada.'
        });
      }

      if (account.refunds.some((refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELLED')) {
        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'ERROR',
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            failureReason: ErrorCodes.CHECKOUT_NOT_AVAILABLE
          }
        });

        return { ok: true, attemptId: attempt.id, status: 'ERROR', reason: ErrorCodes.CHECKOUT_NOT_AVAILABLE };
      }

      const { remaining } = await this.accountService.reconcilePaidAmountTx(tx, account.id, { updateStatus: true });
      if (remaining <= EPSILON) {
        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'ERROR',
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            failureReason: ErrorCodes.CHECKOUT_ALREADY_PAID
          }
        });

        await tx.auditLog.create({
          data: {
            clubId,
            userId: attempt.userId,
            entity: 'ONLINE_PAYMENT_ATTEMPT',
            entityId: attempt.id,
            action: 'PAYMENT_ONLINE_ALREADY_PAID',
            payload: {
              provider: 'MERCADO_PAGO',
              providerPaymentId
            }
          }
        });

        return { ok: true, attemptId: attempt.id, status: 'ERROR', reason: ErrorCodes.CHECKOUT_ALREADY_PAID };
      }

      if (approvedAmount > remaining + EPSILON) {
        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'ERROR',
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            failureReason: ErrorCodes.CHECKOUT_AMOUNT_CHANGED
          }
        });

        await tx.auditLog.create({
          data: {
            clubId,
            userId: attempt.userId,
            entity: 'ONLINE_PAYMENT_ATTEMPT',
            entityId: attempt.id,
            action: 'PAYMENT_ONLINE_AMOUNT_CHANGED',
            payload: {
              provider: 'MERCADO_PAGO',
              providerPaymentId,
              approvedAmount,
              remaining
            }
          }
        });

        return { ok: true, attemptId: attempt.id, status: 'ERROR', reason: ErrorCodes.CHECKOUT_AMOUNT_CHANGED };
      }

      const paymentMethod = this.mapMercadoPagoMethod(payment.payment_type_id);
      const createdPayment = await this.paymentService.createInTransaction(tx, {
        clubId,
        accountId: account.id,
        amount: approvedAmount,
        method: paymentMethod.method,
        channel: paymentMethod.channel,
        source: 'ONLINE',
        externalReference: providerPaymentId,
        idempotencyKey: `mercadopago:${providerPaymentId}`
      });

      await tx.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'APPROVED',
          providerPaymentId,
          providerStatus,
          rawProviderData: rawPaymentJson,
          processedAt: new Date(),
          paymentId: createdPayment?.id || null,
          failureReason: null
        }
      });

      await tx.auditLog.create({
        data: {
          clubId,
          userId: attempt.userId,
          entity: 'ONLINE_PAYMENT_ATTEMPT',
          entityId: attempt.id,
          action: 'PAYMENT_ONLINE_APPROVED',
          payload: {
            provider: 'MERCADO_PAGO',
            providerPaymentId,
            localPaymentId: createdPayment?.id || null,
            amount: approvedAmount
          }
        }
      });

      return {
        ok: true,
        attemptId: attempt.id,
        paymentId: createdPayment?.id || null,
        status: 'APPROVED'
      };
    });
  }

  private mapMercadoPagoMethod(paymentTypeId: unknown): {
    method: PaymentMethod;
    channel?: PaymentChannel;
  } {
    const normalized = String(paymentTypeId || '').trim().toLowerCase();

    if (normalized === 'account_money') {
      return { method: 'TRANSFER', channel: 'VIRTUAL_WALLET' };
    }
    if (normalized === 'bank_transfer') {
      return { method: 'TRANSFER', channel: 'BANK_ACCOUNT' };
    }
    if (normalized === 'credit_card' || normalized === 'debit_card' || normalized === 'prepaid_card') {
      return { method: 'CARD', channel: 'OTHER' };
    }
    return { method: 'OTHER', channel: 'OTHER' };
  }
}
