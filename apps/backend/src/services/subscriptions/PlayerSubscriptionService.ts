import { Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { ClubPaymentIntegrationService } from '../ClubPaymentIntegrationService';
import { MercadoPagoService } from '../MercadoPagoService';
import { pushNotificationService } from '../PushNotificationService';
import { mercadoPagoConfig } from '../../utils/mercadoPagoConfig';
import { generateDisplayCode } from '../../utils/displayCode';
import { initialPurchaseInstallments, subscriptionService } from './SubscriptionService';
import { PersonService } from '../PersonService';
import { acquireTransactionAdvisoryLock } from '../../utils/advisoryLock';
import { localDateKey } from '../MemberService';

const ACTIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'PAUSED'];
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
  private readonly personService = new PersonService();

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

  private async clubBySlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug: String(slug || '').trim() }, select: { id: true, name: true } });
    if (!club) throw notFound('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
    return club;
  }

  /**
   * Planes del club para la pestaña Gimnasio: qué incluye cada uno, formas de pago y si se puede
   * comprar desde la app. Con sesión, marca los planes que el jugador ya tiene.
   */
  async listClubPlans(slug: string, userId: number | null) {
    const club = await this.clubBySlug(slug);
    const [plans, status, mine] = await Promise.all([
      prisma.subscriptionPlan.findMany({
        where: { clubId: club.id, isActive: true },
        include: {
          options: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { installmentsCount: 'asc' }] },
          entitlements: { include: { activityType: { select: { name: true } } } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.paymentIntegrationService.getMercadoPagoIntegrationStatusForClub(club.id).catch(() => null),
      userId
        ? prisma.subscription.findMany({
            where: { clubId: club.id, status: { in: ACTIVE_STATUSES }, client: { userId } },
            select: { planId: true, awaitingOnlinePayment: true },
          })
        : Promise.resolve([] as Array<{ planId: string; awaitingOnlinePayment: boolean }>),
    ]);
    const onlineReady = Boolean(status?.connected);
    return {
      canPayOnline: onlineReady,
      plans: plans
        .filter((plan) => plan.options.length > 0)
        .map((plan) => {
          const owned = mine.filter((row) => row.planId === plan.id);
          return {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            billingType: plan.billingType,
            periodMonths: plan.periodMonths,
            enrollmentFee: plan.enrollmentFee == null ? null : Number(plan.enrollmentFee),
            includes: plan.entitlements.map((row) => describeEntitlement(row)),
            options: plan.options.map((option) => ({
              id: option.id,
              label: option.label,
              installmentsCount: option.installmentsCount,
              installmentPrice: Number(option.installmentPrice),
              totalPrice: Number((Number(option.installmentPrice) * option.installmentsCount).toFixed(2)),
            })),
            buyOnline: plan.sellOnline && onlineReady,
            // Lo que ya tiene el jugador de este plan: activo o comprado sin pagar.
            mine: owned.some((row) => !row.awaitingOnlinePayment) ? 'ACTIVE' : owned.length ? 'AWAITING_PAYMENT' : null,
          };
        }),
    };
  }

  /**
   * Compra de un plan desde la app: crea (o retoma) la suscripción sin pagar y devuelve el link de
   * Mercado Pago por la matrícula y la primera cuota. Hasta que se pague no habilita nada.
   */
  async purchase(userId: number, slug: string, input: { planId: string; optionId: string; returnTo?: 'club' | 'perfil' }) {
    const club = await this.clubBySlug(slug);
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: String(input.planId), clubId: club.id },
      include: { options: true },
    });
    if (!plan || !plan.isActive) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND);
    if (!plan.sellOnline) throw conflict('Este plan se compra en el club.', ErrorCodes.CHECKOUT_NOT_AVAILABLE);
    const option = plan.options.find((row) => row.id === String(input.optionId) && row.isActive);
    if (!option) throw badRequest('Elegí una forma de pago del plan.', ErrorCodes.INVALID_INPUT);
    const accessToken = await this.paymentIntegrationService.getMercadoPagoAccessTokenForClub(club.id);
    if (!accessToken) {
      throw conflict('Este club todavía no cobra online. Comprá el plan en el club.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }

    const client = await this.personService.ensureClientForUser(club.id, userId, { source: 'SELF_BOOKING' });
    const owned = () =>
      prisma.subscription.findMany({
        where: { clubId: club.id, clientId: client.id, planId: plan.id, status: { in: ACTIVE_STATUSES } },
        select: { id: true, optionId: true, awaitingOnlinePayment: true },
      });

    // Cambió la forma de pago de una compra que no pagó: la anterior se cancela (si no tiene pagos).
    for (const row of await owned()) {
      if (!row.awaitingOnlinePayment || row.optionId === option.id) continue;
      const installments = await prisma.subscriptionInstallment.findMany({
        where: { subscriptionId: row.id, accountId: { not: null } },
        select: { accountId: true },
      });
      const paid = await prisma.account.count({
        where: { id: { in: installments.map((inst) => String(inst.accountId)) }, paidAmount: { gt: 0 } },
      });
      if (paid === 0) await subscriptionService.cancel(club.id, userId, row.id, 'Cambió la forma de pago (compra online)');
    }

    const subscriptionId = await prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `plan-purchase:${client.id}:${plan.id}`);
      const existing = await tx.subscription.findMany({
        where: { clubId: club.id, clientId: client.id, planId: plan.id, status: { in: ACTIVE_STATUSES } },
        select: { id: true, optionId: true, awaitingOnlinePayment: true },
      });
      if (existing.some((row) => !row.awaitingOnlinePayment)) {
        throw conflict('Ya tenés este plan. Pagá tus cuotas desde "Mi plan".', ErrorCodes.CONFLICT);
      }
      const pending = existing.find((row) => row.awaitingOnlinePayment);
      if (pending && pending.optionId === option.id) return pending.id;
      if (pending) throw conflict('Ya tenés una compra de este plan esperando el pago.', ErrorCodes.CONFLICT);
      return subscriptionService.sellTx(
        tx,
        club.id,
        userId,
        { clientId: client.id, planId: plan.id, optionId: option.id, notes: 'Comprado desde la app' },
        { awaitingOnlinePayment: true }
      );
    });

    const checkout = await this.createInstallmentCheckout(userId, subscriptionId, { returnTo: input.returnTo || 'club' });
    return { subscriptionId, ...checkout };
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

  /**
   * Link de Mercado Pago para la cuota pendiente más vieja del plan.
   * Compra online sin pagar: un solo pago por la matrícula (si hay) y la primera cuota.
   * `returnTo: 'club'` vuelve a la pestaña Gimnasio de la página del club en vez de al perfil.
   */
  async createInstallmentCheckout(userId: number, subscriptionId: string, options: { returnTo?: 'club' | 'perfil' } = {}) {
    const subscription = await this.mine(userId, subscriptionId);
    if (!ACTIVE_STATUSES.includes(subscription.status)) throw conflict('Este plan ya terminó.', ErrorCodes.INVALID_INPUT);
    const pendingRows = subscription.installments.filter((row) => row.status === 'PENDING' && row.accountId);
    const installments = subscription.awaitingOnlinePayment
      ? initialPurchaseInstallments(subscription.installments).filter((row) => row.status === 'PENDING' && row.accountId)
      : pendingRows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).slice(0, 1);
    if (!installments.length) throw conflict('No tenés cuotas para pagar.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);
    // La cuenta principal del pago es la de la cuota del período (o la única que hay).
    const installment = installments.find((row) => row.kind === 'PERIOD') || installments[0];

    const accessToken = await this.paymentIntegrationService.getMercadoPagoAccessTokenForClub(subscription.clubId);
    if (!accessToken) {
      throw conflict('Este club todavía no cobra online. Pagá la cuota en el club.', ErrorCodes.PAYMENT_PROVIDER_NOT_CONFIGURED);
    }
    const accounts = await prisma.account.findMany({ where: { id: { in: installments.map((row) => String(row.accountId)) } } });
    const parts = installments.map((row) => {
      const account = accounts.find((item) => item.id === row.accountId);
      const due = account ? Number((Number(account.totalAmount) - Number(account.paidAmount)).toFixed(2)) : 0;
      return { installment: row, account, amount: account && account.status === 'OPEN' && due > 0 ? due : 0 };
    }).filter((part) => part.amount > 0);
    const account = parts.find((part) => part.installment.id === installment.id)?.account || parts[0]?.account;
    const amount = Number(parts.reduce((sum, part) => sum + part.amount, 0).toFixed(2));
    if (!account || !(amount > 0)) {
      throw conflict('Esa cuota ya no tiene saldo para pagar.', ErrorCodes.CHECKOUT_NO_PENDING_BALANCE);
    }
    // Más de una cuenta (matrícula + primera cuota): el webhook reparte el pago entre las dos.
    const bundle = parts.length > 1 ? parts.map((part) => ({ accountId: part.account!.id, amount: part.amount })) : null;

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
      select: { initPoint: true, target: true },
    });
    const sameReturn = (open?.target as { returnTo?: string } | null)?.returnTo === (options.returnTo || 'perfil');
    if (open?.initPoint && sameReturn) return { initPoint: open.initPoint, amount };

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
        target: { returnTo: options.returnTo || 'perfil', ...(bundle ? { bundle } : {}) } as Prisma.InputJsonValue,
      },
    });

    const publicBase = mercadoPagoConfig.frontendUrl || 'http://localhost:3001';
    const backendBase = mercadoPagoConfig.appBaseUrl || 'http://localhost:3000';
    const returnUrl = (checkoutStatus: 'success' | 'pending' | 'failure') => {
      const toClub = options.returnTo === 'club' && subscription.club?.slug;
      const url = new URL(toClub ? `/club/${encodeURIComponent(subscription.club!.slug)}` : '/perfil', publicBase);
      if (toClub) url.searchParams.set('tab', 'gimnasio');
      url.searchParams.set('plan', subscription.id);
      url.searchParams.set('checkoutStatus', checkoutStatus);
      if (!toClub) url.hash = 'mis-planes';
      return url.toString();
    };
    const webhookUrl = new URL('/api/webhooks/mercadopago', backendBase);
    webhookUrl.searchParams.set('clubId', String(subscription.clubId));
    webhookUrl.searchParams.set('attemptId', attempt.id);

    const planName = subscription.plan?.name || 'Plan';
    const range = `${installment.coversFrom.toISOString().slice(8, 10)}/${installment.coversFrom.toISOString().slice(5, 7)} al ${installment.coversTo.toISOString().slice(8, 10)}/${installment.coversTo.toISOString().slice(5, 7)}`;
    const title = bundle
      ? `${planName}: matrícula y primera cuota (${range})`
      : subscription.awaitingOnlinePayment
        ? `${planName}: primera cuota (${range})`
        : `Cuota ${planName} (${range})`;
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

/** "Musculación libre", "Funcional 3 veces por semana", "8 clases de Pádel por mes". */
export function describeEntitlement(row: {
  kind: string;
  timesPerWeek: number | null;
  creditsPerPeriod: number | null;
  classType?: string | null;
  activityType?: { name: string } | null;
}) {
  const name = row.activityType?.name || 'Actividad';
  if (row.kind === 'CLASS_CREDITS') {
    const count = Number(row.creditsPerPeriod || 0);
    const type = row.classType === 'INDIVIDUAL' ? ' individuales' : row.classType === 'GROUP' ? ' grupales' : '';
    return `${count} ${count === 1 ? 'clase' : 'clases'}${type} de ${name} por mes`;
  }
  if (row.timesPerWeek) return `${name} ${row.timesPerWeek} ${row.timesPerWeek === 1 ? 'vez' : 'veces'} por semana`;
  return `${name} libre`;
}

export const playerSubscriptionService = new PlayerSubscriptionService();
