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

      // Reserva por jugador: el pago se imputa a las partes que cubre (solo esas quedan congeladas, D10).
      // Si alguna parte cambió desde que se inició el pago, no se imputa: lo revisa el club.
      const target = this.parseAttemptTarget(attempt.target);
      const methodDiscount = this.parseAttemptMethodDiscount(attempt.target);
      if (target) {
        const ids = target.items.map((item) => item.accountItemId);
        const [items, allocated] = await Promise.all([
          tx.accountItem.findMany({ where: { id: { in: ids }, accountId: account.id }, select: { id: true, total: true } }),
          tx.paymentAllocation.groupBy({ by: ['accountItemId'], where: { accountItemId: { in: ids } }, _sum: { amount: true } })
        ]);
        const allocatedById = new Map(allocated.map((row) => [row.accountItemId, Number(row._sum.amount || 0)]));
        const targetTotal = Number(target.items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
        const changed = items.length !== ids.length
          || Math.abs(targetTotal - (methodDiscount ? methodDiscount.listAmount : approvedAmount)) > EPSILON
          || target.items.some((item) => {
            const row = items.find((candidate) => candidate.id === item.accountItemId);
            const outstanding = Number(row?.total || 0) - (allocatedById.get(item.accountItemId) || 0);
            return outstanding + EPSILON < item.amount;
          });
        if (changed) {
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
              action: 'PAYMENT_ONLINE_SHARES_CHANGED',
              payload: { provider: 'MERCADO_PAGO', providerPaymentId, approvedAmount, target } as Prisma.InputJsonValue
            }
          });
          return { ok: true, attemptId: attempt.id, status: 'ERROR', reason: ErrorCodes.CHECKOUT_AMOUNT_CHANGED };
        }
      }

      const paymentMethod = this.mapMercadoPagoMethod(payment.payment_type_id);
      const createdPayment = await this.paymentService.createInTransaction(tx, {
        clubId,
        accountId: account.id,
        // Con descuento online: se imputa a precio de lista y el descuento congelado baja los ítems;
        // lo registrado como pago coincide con lo aprobado (se validó contra attempt.amount).
        amount: methodDiscount ? methodDiscount.listAmount : approvedAmount,
        ...(methodDiscount
          ? {
            methodDiscountOverride: { key: 'ONLINE' as const, percent: methodDiscount.percent },
            ...(target ? {} : { allocations: methodDiscount.listItems })
          }
          : {}),
        method: paymentMethod.method,
        channel: paymentMethod.channel,
        source: 'ONLINE',
        externalReference: providerPaymentId,
        idempotencyKey: `mercadopago:${providerPaymentId}`,
        ...(target
          ? {
            allocations: target.items,
            ...(target.payer ? { payerParticipantRef: target.payer.ref, payerParticipantName: target.payer.name || undefined } : {}),
            ...(target.scope === 'OWN_SHARE' && target.payer
              ? { coveredParticipantRef: target.payer.ref, coveredParticipantName: target.payer.name || undefined }
              : {})
          }
          : {})
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

  private parseAttemptMethodDiscount(raw: unknown): {
    percent: number;
    listAmount: number;
    listItems: Array<{ accountItemId: string; amount: number }>;
  } | null {
    const value = raw && typeof raw === 'object' ? (raw as { methodDiscount?: unknown }).methodDiscount : null;
    if (!value || typeof value !== 'object') return null;
    const discount = value as { percent?: unknown; listAmount?: unknown; listItems?: unknown };
    const percent = Number(discount.percent || 0);
    const listAmount = Number(Number(discount.listAmount || 0).toFixed(2));
    if (!(percent > 0) || !(listAmount > 0)) return null;
    const listItems = (Array.isArray(discount.listItems) ? discount.listItems : [])
      .map((item) => ({
        accountItemId: String((item as { accountItemId?: unknown })?.accountItemId || '').trim(),
        amount: Number(Number((item as { amount?: unknown })?.amount || 0).toFixed(2))
      }))
      .filter((item) => item.accountItemId && item.amount > 0);
    return { percent, listAmount, listItems };
  }

  private parseAttemptTarget(raw: unknown): {
    scope: 'OWN_SHARE' | 'ALL_SHARES';
    items: Array<{ accountItemId: string; amount: number }>;
    payer: { ref: string; name: string | null } | null;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { scope?: unknown; items?: unknown; payer?: unknown };
    if (!Array.isArray(value.items) || value.items.length === 0) return null;
    const items = value.items
      .map((item) => ({
        accountItemId: String((item as { accountItemId?: unknown })?.accountItemId || '').trim(),
        amount: Number(Number((item as { amount?: unknown })?.amount || 0).toFixed(2))
      }))
      .filter((item) => item.accountItemId && item.amount > 0);
    if (items.length === 0) return null;
    const payer = value.payer && typeof value.payer === 'object'
      ? { ref: String((value.payer as { ref?: unknown }).ref || ''), name: ((value.payer as { name?: unknown }).name as string | null) ?? null }
      : null;
    return {
      // La seña la paga el titular para toda la reserva: se imputa como "todas las partes".
      scope: value.scope === 'ALL_SHARES' || value.scope === 'DEPOSIT' ? 'ALL_SHARES' : 'OWN_SHARE',
      items,
      payer: payer?.ref ? payer : null
    };
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
