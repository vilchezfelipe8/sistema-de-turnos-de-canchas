import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { ClubPaymentIntegrationService } from '../ClubPaymentIntegrationService';
import { MercadoPagoService } from '../MercadoPagoService';
import { pushNotificationService } from '../PushNotificationService';
import { mercadoPagoConfig } from '../../utils/mercadoPagoConfig';
import { generateDisplayCode } from '../../utils/displayCode';
import { subscriptionService } from './SubscriptionService';
import { localDateKey } from '../MemberService';

const ACTIVE_STATUSES = ['ACTIVE', 'PAST_DUE', 'PAUSED'];
/** Un link de pago abierto se reusa durante este tiempo (evita preferencias repetidas por doble toque). */
const CHECKOUT_REUSE_MS = 30 * 60_000;

/**
 * "Mis planes" en la app del jugador: ver sus planes, pagar la cuota con Mercado Pago y pausar
 * (dentro de lo que permite el plan). El pago entra por el webhook común: se imputa a la cuenta
 * de la cuota y la cuota queda pagada sola.
 */
export class PlayerSubscriptionService {
  private readonly paymentIntegrationService = new ClubPaymentIntegrationService();
  private readonly mercadoPagoService = new MercadoPagoService();

  async listMine(userId: number) {
    const rows = await subscriptionService.listMine(userId);
    const online = new Map<number, boolean>();
    for (const clubId of new Set(rows.map((row) => row.clubId))) {
      const status = await this.paymentIntegrationService.getMercadoPagoIntegrationStatusForClub(clubId).catch(() => null);
      online.set(clubId, Boolean(status?.connected));
    }
    return rows.map(({ clubId, ...row }) => ({
      ...row,
      canPayOnline: Boolean(online.get(clubId) && row.nextInstallment?.payable),
    }));
  }

  /** Plan del jugador (lo usa o lo paga). */
  private async mine(userId: number, subscriptionId: string) {
    const row = await prisma.subscription.findFirst({
      where: { id: String(subscriptionId), OR: [{ client: { userId } }, { payerClient: { userId } }] },
      include: {
        installments: true,
        pauses: true,
        club: { select: { name: true, slug: true } },
        client: { select: { name: true } },
        plan: { select: { name: true } },
      },
    });
    if (!row) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_NOT_FOUND);
    return row;
  }

  /** Link de Mercado Pago para la cuota pendiente más vieja del plan. */
  async createInstallmentCheckout(userId: number, subscriptionId: string) {
    const subscription = await this.mine(userId, subscriptionId);
    if (!ACTIVE_STATUSES.includes(subscription.status)) throw conflict('Este plan ya terminó.', ErrorCodes.INVALID_INPUT);
    const installment = subscription.installments
      .filter((row) => row.status === 'PENDING' && row.accountId)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    if (!installment?.accountId) throw conflict('No tenés cuotas para pagar.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);

    const accessToken = await this.paymentIntegrationService.getMercadoPagoAccessTokenForClub(subscription.clubId);
    if (!accessToken) {
      throw conflict('Este club todavía no cobra online. Pagá la cuota en el club.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }
    const account = await prisma.account.findUnique({ where: { id: installment.accountId } });
    const amount = account ? Number((Number(account.totalAmount) - Number(account.paidAmount)).toFixed(2)) : 0;
    if (!account || account.status !== 'OPEN' || !(amount > 0)) {
      throw conflict('Esa cuota ya no tiene saldo para pagar.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);
    }

    const open = await prisma.onlinePaymentAttempt.findFirst({
      where: {
        accountId: account.id,
        userId,
        status: { in: ['CREATED', 'PENDING'] },
        initPoint: { not: null },
        amount,
        createdAt: { gt: new Date(Date.now() - CHECKOUT_REUSE_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { initPoint: true },
    });
    if (open?.initPoint) return { initPoint: open.initPoint, amount };

    const [user, integration] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
      prisma.clubPaymentIntegration.findUnique({
        where: { clubId_provider: { clubId: subscription.clubId, provider: 'MERCADO_PAGO' } },
        select: { id: true },
      }),
    ]);
    const attempt = await prisma.onlinePaymentAttempt.create({
      data: {
        clubId: subscription.clubId,
        bookingId: null,
        accountId: account.id,
        userId,
        integrationId: integration?.id ?? null,
        provider: 'MERCADO_PAGO',
        status: 'CREATED',
        amount,
        currency: 'ARS',
        idempotencyKey: `plan:${installment.id}:${amount.toFixed(2)}:${generateDisplayCode('K')}`,
        externalReference: `plan-checkout:${installment.id}:attempt:${generateDisplayCode('CHK')}`,
      },
    });

    const publicBase = mercadoPagoConfig.frontendUrl || 'http://localhost:3001';
    const backendBase = mercadoPagoConfig.appBaseUrl || 'http://localhost:3000';
    const returnUrl = (checkoutStatus: 'success' | 'pending' | 'failure') => {
      const url = new URL('/perfil', publicBase);
      url.searchParams.set('plan', subscription.id);
      url.searchParams.set('checkoutStatus', checkoutStatus);
      url.hash = 'mis-planes';
      return url.toString();
    };
    const webhookUrl = new URL('/api/webhooks/mercadopago', backendBase);
    webhookUrl.searchParams.set('clubId', String(subscription.clubId));
    webhookUrl.searchParams.set('attemptId', attempt.id);

    const planName = subscription.plan?.name || 'Plan';
    const range = `${installment.coversFrom.toISOString().slice(8, 10)}/${installment.coversFrom.toISOString().slice(5, 7)} al ${installment.coversTo.toISOString().slice(8, 10)}/${installment.coversTo.toISOString().slice(5, 7)}`;
    const title = `Cuota ${planName} (${range})`;
    try {
      const preference = await this.mercadoPagoService.createPreference({
        accessToken,
        title: `${title} - ${subscription.club?.name || 'Club'}`,
        description: `${title} · ${subscription.client?.name || ''}`.trim(),
        quantity: 1,
        unitPrice: amount,
        payer: user?.email
          ? { name: user.firstName || 'Jugador', surname: user.lastName || undefined, email: user.email }
          : undefined,
        externalReference: attempt.id,
        notificationUrl: webhookUrl.toString(),
        successUrl: returnUrl('success'),
        pendingUrl: returnUrl('pending'),
        failureUrl: returnUrl('failure'),
        metadata: { attemptId: attempt.id, subscriptionId: subscription.id, installmentId: installment.id, accountId: account.id, clubId: subscription.clubId },
      });
      const initPoint = String(preference.init_point || preference.sandbox_init_point || '').trim();
      if (!initPoint) throw conflict('Mercado Pago no devolvió el link de pago.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
      await prisma.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'PENDING',
          providerPreferenceId: String(preference.id || '').trim() || null,
          initPoint,
          rawProviderData: preference as Prisma.InputJsonValue,
        },
      });
      await prisma.auditLog.create({
        data: {
          clubId: subscription.clubId,
          userId,
          entity: 'ONLINE_PAYMENT_ATTEMPT',
          entityId: attempt.id,
          action: 'CHECKOUT_ATTEMPT_CREATED',
          payload: { provider: 'MERCADO_PAGO', subscriptionId: subscription.id, installmentId: installment.id, amount },
        },
      });
      return { initPoint, amount };
    } catch (error) {
      await prisma.onlinePaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'ERROR', failureReason: 'PREFERENCE_FAILED' },
      });
      throw error;
    }
  }

  /** El jugador pausa su plan (dentro de los días y las veces que permite el plan). */
  async pause(userId: number, subscriptionId: string, input: { startDate?: string | null; endDate: string }) {
    const subscription = await this.mine(userId, subscriptionId);
    if (!input.endDate) throw badRequest('Elegí hasta cuándo.', ErrorCodes.INVALID_DATE_TIME);
    const result = await subscriptionService
      .pause(subscription.clubId, userId, subscription.id, {
        startDate: input.startDate || null,
        endDate: input.endDate,
        reason: 'Pedida desde la app',
      })
      .catch((error: any) => {
        // Los mensajes del admin hablan del cliente en tercera persona; acá le hablamos al jugador.
        if (error && typeof error.message === 'string') error.message = error.message.replace(/^Ya usó/, 'Ya usaste');
        throw error;
      });
    const fmt = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
    const pause = result.pauses.find((row: { endDate: string }) => row.endDate === input.endDate);
    await this.notifyStaff(subscription.clubId, userId, subscription.id, {
      title: `${subscription.client?.name || 'Un jugador'} pausó su plan`,
      body: `${subscription.plan?.name || 'Plan'}: del ${fmt(pause?.startDate || input.startDate || input.endDate)} al ${fmt(input.endDate)}. Las cuotas y clases se corrieron solas.`,
    });
    return result;
  }

  /** Anula una pausa que todavía no empezó, o termina hoy una en curso. */
  async endPause(userId: number, subscriptionId: string, pauseId: string) {
    const subscription = await this.mine(userId, subscriptionId);
    const pause = subscription.pauses.find((row) => row.id === String(pauseId));
    if (!pause) throw notFound('Pausa no encontrada.', ErrorCodes.INVALID_INPUT);
    const started = pause.startDate.toISOString().slice(0, 10) < localDateKey(new Date(), 'America/Argentina/Buenos_Aires');
    const result = await subscriptionService.endPause(subscription.clubId, userId, subscription.id, pause.id);
    await this.notifyStaff(subscription.clubId, userId, subscription.id, {
      title: `${subscription.client?.name || 'Un jugador'} ${started ? 'terminó antes su pausa' : 'anuló su pausa'}`,
      body: `${subscription.plan?.name || 'Plan'}: las fechas volvieron a correrse solas.`,
    });
    return result;
  }

  private async notifyStaff(clubId: number, actorUserId: number, subscriptionId: string, content: { title: string; body: string }) {
    try {
      const staff = await prisma.membership.findMany({
        where: { clubId, role: { in: ['OWNER', 'ADMIN', 'STAFF'] }, userId: { not: actorUserId } },
        select: { userId: true },
      });
      for (const row of staff) {
        await pushNotificationService.enqueue(prisma, {
          clubId,
          userId: row.userId,
          kind: 'PLAN_NOTICE',
          aggregateType: 'Subscription',
          aggregateId: subscriptionId,
          content: { ...content, url: '/admin/clientes', tag: `plan-${subscriptionId}-player-${Date.now()}` },
        });
      }
    } catch (error) {
      console.error('[planes] No se pudo avisar al club', error);
    }
  }
}

export const playerSubscriptionService = new PlayerSubscriptionService();
