import { PaymentChannel, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, ErrorCodes, badRequest } from '../errors';
import { ClubPaymentIntegrationService } from './ClubPaymentIntegrationService';
import { MercadoPagoService } from './MercadoPagoService';
import { PaymentService } from './PaymentService';
import { AccountService } from './AccountService';
import { ClassSeriesAdminService } from './academy/ClassSeriesAdminService';

const EPSILON = 0.009;

export class OnlineCheckoutService {
  private readonly mercadoPagoService = new MercadoPagoService();
  private readonly clubPaymentIntegrationService = new ClubPaymentIntegrationService();
  private readonly paymentService = new PaymentService();
  private readonly accountService = new AccountService();
  private readonly classSeriesService = new ClassSeriesAdminService();

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

    // Cobro al anotarse a un curso: el aviso al club va después de confirmar la transacción.
    const after = { courseMemberId: null as string | null };
    const result = await prisma.$transaction(async (tx) => {
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

      // Un solo pago para varias cuentas (compra de plan: matrícula + primera cuota).
      const bundle = this.parseAttemptBundle(attempt.target);
      if (bundle) {
        const markError = async (reason: string, action: string, payload: Record<string, unknown> = {}) => {
          await tx.onlinePaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'ERROR',
              providerPaymentId,
              providerStatus,
              rawProviderData: rawPaymentJson,
              processedAt: new Date(),
              failureReason: reason
            }
          });
          await tx.auditLog.create({
            data: {
              clubId,
              userId: attempt.userId,
              entity: 'ONLINE_PAYMENT_ATTEMPT',
              entityId: attempt.id,
              action,
              payload: { provider: 'MERCADO_PAGO', providerPaymentId, approvedAmount, bundle, ...payload } as Prisma.InputJsonValue
            }
          });
          return { ok: true, attemptId: attempt.id, status: 'ERROR', reason };
        };

        const bundleTotal = Number(bundle.reduce((sum, part) => sum + part.amount, 0).toFixed(2));
        if (Math.abs(bundleTotal - approvedAmount) > EPSILON) {
          return markError(ErrorCodes.CHECKOUT_AMOUNT_CHANGED, 'PAYMENT_ONLINE_AMOUNT_MISMATCH', { bundleTotal });
        }
        // Todas las cuentas tienen que seguir con ese saldo: si alguna cambió, no se imputa nada y lo revisa el club.
        for (const part of bundle) {
          const partAccount = await tx.account.findUnique({
            where: { id: part.accountId },
            select: { clubId: true, refunds: { select: { status: true } } }
          });
          if (!partAccount || partAccount.clubId !== clubId
            || partAccount.refunds.some((refund) => refund.status !== 'FAILED' && refund.status !== 'CANCELLED')) {
            return markError(ErrorCodes.CHECKOUT_NOT_AVAILABLE, 'PAYMENT_ONLINE_UPDATED', { accountId: part.accountId });
          }
          const { remaining } = await this.accountService.reconcilePaidAmountTx(tx, part.accountId, { updateStatus: true });
          if (remaining + EPSILON < part.amount) {
            return markError(
              remaining <= EPSILON ? ErrorCodes.CHECKOUT_ALREADY_PAID : ErrorCodes.CHECKOUT_AMOUNT_CHANGED,
              remaining <= EPSILON ? 'PAYMENT_ONLINE_ALREADY_PAID' : 'PAYMENT_ONLINE_AMOUNT_CHANGED',
              { accountId: part.accountId, remaining }
            );
          }
        }

        const paymentMethod = this.mapMercadoPagoMethod(payment.payment_type_id);
        const created: string[] = [];
        for (const part of bundle) {
          const createdPayment = await this.paymentService.createInTransaction(tx, {
            clubId,
            accountId: part.accountId,
            amount: part.amount,
            method: paymentMethod.method,
            channel: paymentMethod.channel,
            source: 'ONLINE',
            externalReference: providerPaymentId,
            idempotencyKey: `mercadopago:${providerPaymentId}:${part.accountId}`
          });
          if (createdPayment?.id) created.push(createdPayment.id);
        }

        await tx.onlinePaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'APPROVED',
            providerPaymentId,
            providerStatus,
            rawProviderData: rawPaymentJson,
            processedAt: new Date(),
            // El pago de la cuenta principal del intento (la cuota); los demás quedan en la auditoría.
            paymentId: created[bundle.findIndex((part) => part.accountId === attempt.accountId)] || created[0] || null,
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
              localPaymentIds: created,
              amount: approvedAmount,
              bundle
            } as Prisma.InputJsonValue
          }
        });
        return { ok: true, attemptId: attempt.id, paymentId: created[0] || null, status: 'APPROVED' };
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

      // Curso pagado al anotarse: queda anotado en las clases que vienen.
      if (attempt.classSeriesMemberId) {
        const confirmed = await this.classSeriesService.confirmPaidSpotTx(tx, attempt.classSeriesMemberId);
        if (confirmed) after.courseMemberId = attempt.classSeriesMemberId;
      }

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

    if (after.courseMemberId) {
      try {
        await this.classSeriesService.notifyPaidSpotConfirmed(after.courseMemberId);
      } catch (error) {
        console.error('[academia] No se pudo avisar el curso pagado', error);
      }
    }
    return result;
  }

  /** `target.bundle`: el pago se reparte entre varias cuentas (cada una con su monto). */
  private parseAttemptBundle(raw: unknown): Array<{ accountId: string; amount: number }> | null {
    const value = raw && typeof raw === 'object' ? (raw as { bundle?: unknown }).bundle : null;
    if (!Array.isArray(value) || value.length === 0) return null;
    const parts = value
      .map((item) => ({
        accountId: String((item as { accountId?: unknown })?.accountId || '').trim(),
        amount: Number(Number((item as { amount?: unknown })?.amount || 0).toFixed(2))
      }))
      .filter((item) => item.accountId && item.amount > 0);
    return parts.length === value.length ? parts : null;
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
