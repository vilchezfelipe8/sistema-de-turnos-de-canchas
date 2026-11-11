import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AccountingService } from '../AccountingService';
import { ProjectionService } from '../ProjectionService';
import { localDateKey } from '../MemberService';
import { generateDisplayCode } from '../../utils/displayCode';
import { acquireTransactionAdvisoryLock } from '../../utils/advisoryLock';
import {
  InstallmentState,
  buildInitialSchedule,
  dateKeyToDate,
  dateToKey,
  hasOverdueInstallments,
  isDateKey,
  isInstallmentOverdue,
  memberValidUntilFromSubscription,
  paidThroughKey,
  validatePlanOptionShape,
} from '../../domain/subscriptionSchedule';

type TxClient = Prisma.TransactionClient;
type DbClient = TxClient | typeof prisma;

const EPSILON = 0.009;
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export type BillingTypeValue = 'RECURRING' | 'FIXED_TERM';
export type EntitlementKindValue = 'ACTIVITY_ACCESS' | 'CLASS_CREDITS';
export type SubscriptionStatusValue = 'ACTIVE' | 'PAUSED' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';

export type PlanOptionInput = {
  id?: string | null;
  label: string;
  installmentsCount: number;
  installmentPrice: number;
  isActive?: boolean;
};

export type PlanEntitlementInput = {
  kind: EntitlementKindValue;
  activityTypeId: number;
  timesPerWeek?: number | null;
  creditsPerPeriod?: number | null;
  classType?: 'INDIVIDUAL' | 'GROUP' | null;
};

export type PlanInput = {
  name: string;
  description?: string | null;
  billingType: BillingTypeValue;
  periodMonths: number;
  enrollmentFee?: number | null;
  dueDayOfMonth?: number | null;
  graceDays?: number;
  pauseMaxDays?: number;
  pauseMaxCount?: number;
  grantsMemberCategoryId?: string | null;
  sortOrder?: number;
  options: PlanOptionInput[];
  entitlements?: PlanEntitlementInput[];
};

export type SellSubscriptionInput = {
  clientId: string;
  payerClientId?: string | null;
  planId: string;
  optionId: string;
  startDate?: string | null;
  notes?: string | null;
};

type PlanSnapshot = {
  planName: string;
  billingType: BillingTypeValue;
  periodMonths: number;
  optionLabel: string;
  installmentsCount: number;
  installmentPrice: number;
  enrollmentFee: number | null;
  dueDayOfMonth: number | null;
  graceDays: number;
  pauseMaxDays: number;
  pauseMaxCount: number;
  grantsMemberCategoryId: string | null;
  entitlements: Array<{
    kind: EntitlementKindValue;
    activityTypeId: number;
    activityTypeName: string | null;
    timesPerWeek: number | null;
    creditsPerPeriod: number | null;
    classType: string | null;
  }>;
};

const planInclude = {
  options: { orderBy: [{ sortOrder: 'asc' as const }, { installmentsCount: 'asc' as const }] },
  entitlements: { include: { activityType: { select: { id: true, name: true } } } },
  grantsMemberCategory: { select: { id: true, name: true } },
  _count: { select: { subscriptions: true } },
};

type PlanRow = Prisma.SubscriptionPlanGetPayload<{ include: typeof planInclude }>;

const toNumber = (value: Prisma.Decimal | number | null | undefined) =>
  value == null ? null : Number(value);

const toKeyOrNull = (value: Date | null | undefined) => (value ? dateToKey(value) : null);

function mapPlan(plan: PlanRow) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    billingType: plan.billingType,
    periodMonths: plan.periodMonths,
    enrollmentFee: toNumber(plan.enrollmentFee),
    dueDayOfMonth: plan.dueDayOfMonth,
    graceDays: plan.graceDays,
    pauseMaxDays: plan.pauseMaxDays,
    pauseMaxCount: plan.pauseMaxCount,
    grantsMemberCategory: plan.grantsMemberCategory,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    subscriptionsCount: plan._count.subscriptions,
    options: plan.options.map((option) => ({
      id: option.id,
      label: option.label,
      installmentsCount: option.installmentsCount,
      installmentPrice: Number(option.installmentPrice),
      totalListPrice: Number((Number(option.installmentPrice) * option.installmentsCount).toFixed(2)),
      isActive: option.isActive,
      sortOrder: option.sortOrder,
    })),
    entitlements: plan.entitlements.map((row) => ({
      id: row.id,
      kind: row.kind,
      activityType: row.activityType,
      timesPerWeek: row.timesPerWeek,
      creditsPerPeriod: row.creditsPerPeriod,
      classType: row.classType,
    })),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export class SubscriptionService {
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();

  // ── Utilidades ─────────────────────────────────────────────────────────

  private async clubTimeZone(clubId: number, db: DbClient = prisma) {
    const settings = await db.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
    return settings?.timeZone || DEFAULT_TIME_ZONE;
  }

  async todayKey(clubId: number, db: DbClient = prisma) {
    return localDateKey(new Date(), await this.clubTimeZone(clubId, db));
  }

  // ── Planes ─────────────────────────────────────────────────────────────

  private async validatePlanInput(clubId: number, input: PlanInput, db: DbClient) {
    const name = String(input.name || '').trim();
    if (name.length < 2) throw badRequest('Poné un nombre al plan.', ErrorCodes.INVALID_INPUT);
    if (input.billingType !== 'RECURRING' && input.billingType !== 'FIXED_TERM') {
      throw badRequest('Tipo de plan inválido.', ErrorCodes.INVALID_INPUT);
    }
    const intInRange = (value: unknown, min: number, max: number, message: string) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) throw badRequest(message, ErrorCodes.INVALID_INPUT);
      return n;
    };
    const periodMonths = intInRange(input.periodMonths, 1, 24, 'La duración del plan debe ser de 1 a 24 meses.');
    const dueDayOfMonth =
      input.dueDayOfMonth == null ? null : intInRange(input.dueDayOfMonth, 1, 28, 'El día de vencimiento debe ser de 1 a 28.');
    const graceDays = input.graceDays == null ? 5 : intInRange(input.graceDays, 0, 60, 'Los días de gracia deben ser de 0 a 60.');
    const pauseMaxDays = input.pauseMaxDays == null ? 0 : intInRange(input.pauseMaxDays, 0, 180, 'La pausa máxima debe ser de 0 a 180 días.');
    const pauseMaxCount = input.pauseMaxCount == null ? 0 : intInRange(input.pauseMaxCount, 0, 12, 'Las pausas permitidas deben ser de 0 a 12.');
    const enrollmentFee = input.enrollmentFee == null || Number(input.enrollmentFee) === 0 ? null : Number(input.enrollmentFee);
    if (enrollmentFee != null && !(enrollmentFee > 0)) {
      throw badRequest('La matrícula debe ser mayor a 0.', ErrorCodes.INVALID_INPUT);
    }

    const options = Array.isArray(input.options) ? input.options : [];
    if (!options.length) throw badRequest('Agregá al menos una forma de pago.', ErrorCodes.INVALID_INPUT);
    options.forEach((option) => {
      if (String(option.label || '').trim().length < 1) {
        throw badRequest('Cada forma de pago necesita un nombre.', ErrorCodes.INVALID_INPUT);
      }
      const shapeError = validatePlanOptionShape(
        { billingType: input.billingType, periodMonths },
        { installmentsCount: Number(option.installmentsCount), installmentPrice: Number(option.installmentPrice) }
      );
      if (shapeError) throw badRequest(shapeError, ErrorCodes.INVALID_INPUT);
    });

    let grantsMemberCategoryId: string | null = null;
    if (input.grantsMemberCategoryId) {
      const category = await db.memberCategory.findFirst({
        where: { id: String(input.grantsMemberCategoryId), clubId },
        select: { id: true },
      });
      if (!category) throw notFound('Categoría de socio no encontrada.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);
      grantsMemberCategoryId = category.id;
    }

    const entitlements = Array.isArray(input.entitlements) ? input.entitlements : [];
    const activityIds = Array.from(new Set(entitlements.map((row) => Number(row.activityTypeId))));
    if (activityIds.length) {
      const found = await db.activityType.count({ where: { clubId, id: { in: activityIds } } });
      if (found !== activityIds.length) {
        throw badRequest('Alguna actividad del plan no pertenece al club.', ErrorCodes.INVALID_INPUT);
      }
    }
    entitlements.forEach((row) => {
      if (row.kind === 'ACTIVITY_ACCESS') {
        if (row.timesPerWeek != null) intInRange(row.timesPerWeek, 1, 14, 'Las veces por semana deben ser de 1 a 14.');
      } else if (row.kind === 'CLASS_CREDITS') {
        intInRange(row.creditsPerPeriod, 1, 100, 'Los créditos por período deben ser de 1 a 100.');
      } else {
        throw badRequest('Tipo de beneficio inválido.', ErrorCodes.INVALID_INPUT);
      }
    });

    return {
      name,
      description: String(input.description || '').trim() || null,
      billingType: input.billingType,
      periodMonths,
      enrollmentFee,
      dueDayOfMonth,
      graceDays,
      pauseMaxDays,
      pauseMaxCount,
      grantsMemberCategoryId,
      sortOrder: Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
      options: options.map((option, index) => ({
        id: option.id ? String(option.id) : null,
        label: String(option.label).trim(),
        installmentsCount: Number(option.installmentsCount),
        installmentPrice: new Prisma.Decimal(Number(option.installmentPrice).toFixed(2)),
        isActive: option.isActive !== false,
        sortOrder: index,
      })),
      entitlements: entitlements.map((row) => ({
        kind: row.kind,
        activityTypeId: Number(row.activityTypeId),
        timesPerWeek: row.kind === 'ACTIVITY_ACCESS' && row.timesPerWeek != null ? Number(row.timesPerWeek) : null,
        creditsPerPeriod: row.kind === 'CLASS_CREDITS' ? Number(row.creditsPerPeriod) : null,
        classType: row.kind === 'CLASS_CREDITS' ? row.classType ?? null : null,
      })),
    };
  }

  async listPlans(clubId: number, options?: { includeInactive?: boolean }) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { clubId, ...(options?.includeInactive ? {} : { isActive: true }) },
      include: planInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return plans.map(mapPlan);
  }

  async getPlan(clubId: number, planId: string) {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, clubId }, include: planInclude });
    if (!plan) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND);
    return mapPlan(plan);
  }

  async createPlan(clubId: number, input: PlanInput) {
    const data = await this.validatePlanInput(clubId, input, prisma);
    const created = await prisma.subscriptionPlan.create({
      data: {
        clubId,
        name: data.name,
        description: data.description,
        billingType: data.billingType,
        periodMonths: data.periodMonths,
        enrollmentFee: data.enrollmentFee,
        dueDayOfMonth: data.dueDayOfMonth,
        graceDays: data.graceDays,
        pauseMaxDays: data.pauseMaxDays,
        pauseMaxCount: data.pauseMaxCount,
        grantsMemberCategoryId: data.grantsMemberCategoryId,
        sortOrder: data.sortOrder,
        options: {
          create: data.options.map(({ id: _id, ...option }) => option),
        },
        entitlements: { create: data.entitlements },
      },
      include: planInclude,
    });
    return mapPlan(created);
  }

  // Las formas de pago ya usadas por una suscripción no se borran: se desactivan.
  // Cambiar el precio de una forma de pago no afecta lo ya vendido (queda en el snapshot y en las cuotas).
  async updatePlan(clubId: number, planId: string, input: PlanInput) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionPlan.findFirst({
        where: { id: planId, clubId },
        include: { options: { include: { _count: { select: { subscriptions: true } } } } },
      });
      if (!existing) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND);
      const data = await this.validatePlanInput(clubId, input, tx);

      if (existing.billingType !== data.billingType && (await tx.subscription.count({ where: { planId } })) > 0) {
        throw conflict('No se puede cambiar el tipo de un plan que ya se vendió. Creá un plan nuevo.', ErrorCodes.CONFLICT);
      }
      if (existing.periodMonths !== data.periodMonths && (await tx.subscription.count({ where: { planId } })) > 0) {
        throw conflict('No se puede cambiar la duración de un plan que ya se vendió. Creá un plan nuevo.', ErrorCodes.CONFLICT);
      }

      await tx.subscriptionPlan.update({
        where: { id: planId },
        data: {
          name: data.name,
          description: data.description,
          billingType: data.billingType,
          periodMonths: data.periodMonths,
          enrollmentFee: data.enrollmentFee,
          dueDayOfMonth: data.dueDayOfMonth,
          graceDays: data.graceDays,
          pauseMaxDays: data.pauseMaxDays,
          pauseMaxCount: data.pauseMaxCount,
          grantsMemberCategoryId: data.grantsMemberCategoryId,
          sortOrder: data.sortOrder,
        },
      });

      const existingById = new Map(existing.options.map((option) => [option.id, option]));
      const keptIds = new Set<string>();
      for (const option of data.options) {
        if (option.id && existingById.has(option.id)) {
          keptIds.add(option.id);
          const { id, ...rest } = option;
          const current = existingById.get(id)!;
          if (current._count.subscriptions > 0 && current.installmentsCount !== rest.installmentsCount) {
            throw conflict(
              `La forma de pago "${current.label}" ya se vendió: no se puede cambiar la cantidad de cuotas. Agregá una nueva.`,
              ErrorCodes.CONFLICT
            );
          }
          await tx.subscriptionPlanOption.update({ where: { id }, data: rest });
        } else {
          const { id: _id, ...rest } = option;
          await tx.subscriptionPlanOption.create({ data: { ...rest, planId } });
        }
      }
      for (const option of existing.options) {
        if (keptIds.has(option.id)) continue;
        if (option._count.subscriptions > 0) {
          await tx.subscriptionPlanOption.update({ where: { id: option.id }, data: { isActive: false } });
        } else {
          await tx.subscriptionPlanOption.delete({ where: { id: option.id } });
        }
      }

      await tx.subscriptionPlanEntitlement.deleteMany({ where: { planId } });
      if (data.entitlements.length) {
        await tx.subscriptionPlanEntitlement.createMany({
          data: data.entitlements.map((row) => ({ ...row, planId })),
        });
      }

      const updated = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId }, include: planInclude });
      return mapPlan(updated);
    });
  }

  async setPlanActive(clubId: number, planId: string, isActive: boolean) {
    const existing = await prisma.subscriptionPlan.findFirst({ where: { id: planId, clubId }, select: { id: true } });
    if (!existing) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND);
    await prisma.subscriptionPlan.update({ where: { id: planId }, data: { isActive } });
    return this.getPlan(clubId, planId);
  }

  // ── Venta ──────────────────────────────────────────────────────────────

  private async createInstallmentAccountTx(tx: TxClient, input: {
    clubId: number;
    installmentId: string;
    payerClientId: string;
    description: string;
    amount: number;
    actorUserId: number | null;
  }) {
    const account = await tx.account.create({
      data: {
        clubId: input.clubId,
        displayCode: generateDisplayCode('CTA'),
        sourceType: 'SUBSCRIPTION_INSTALLMENT',
        sourceId: input.installmentId,
        status: 'OPEN',
        clientId: input.payerClientId,
        totalAmount: new Prisma.Decimal(input.amount),
      },
    });
    const item = await tx.accountItem.create({
      data: {
        accountId: account.id,
        type: 'SERVICE',
        description: input.description,
        quantity: 1,
        unitPrice: new Prisma.Decimal(input.amount),
        total: new Prisma.Decimal(input.amount),
        clientId: input.payerClientId,
      },
    });
    await this.accountingService.createAccountItemTransaction(tx, {
      clubId: input.clubId,
      type: 'ACCOUNT_ITEM',
      referenceType: 'SUBSCRIPTION',
      referenceId: input.installmentId,
      accountId: account.id,
      accountItemId: item.id,
      amount: input.amount,
      revenueAccount: 'MEMBERSHIP_REVENUE',
      description: input.description,
      createdByUserId: input.actorUserId,
    });
    await this.projectionService.refreshAccountSummary(account.id, tx);
    await tx.subscriptionInstallment.update({ where: { id: input.installmentId }, data: { accountId: account.id } });
    return account;
  }

  private installmentDescription(planName: string, row: { kind: string; sequence: number; coversFrom: string; coversTo: string }, total: number) {
    if (row.kind === 'ENROLLMENT_FEE') return `${planName} · Matrícula`;
    const fmt = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
    const suffix = total > 1 ? ` · Cuota ${row.sequence}/${total}` : '';
    return `${planName}${suffix} · ${fmt(row.coversFrom)} al ${fmt(row.coversTo)}`;
  }

  async sell(clubId: number, actorUserId: number, input: SellSubscriptionInput) {
    const result = await prisma.$transaction(async (tx) => {
      const clientId = String(input.clientId || '').trim();
      const payerClientId = String(input.payerClientId || '').trim() || clientId;
      const clients = await tx.client.findMany({
        where: { clubId, id: { in: Array.from(new Set([clientId, payerClientId])) } },
        select: { id: true },
      });
      if (!clientId || clients.length !== new Set([clientId, payerClientId]).size) {
        throw notFound('Cliente no encontrado.', ErrorCodes.CLIENT_NOT_FOUND);
      }

      const plan = await tx.subscriptionPlan.findFirst({
        where: { id: String(input.planId), clubId },
        include: { options: true, entitlements: { include: { activityType: { select: { name: true } } } } },
      });
      if (!plan) throw notFound('Plan no encontrado.', ErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND);
      if (!plan.isActive) throw conflict('El plan está desactivado.', ErrorCodes.SUBSCRIPTION_PLAN_INACTIVE);
      const option = plan.options.find((row) => row.id === String(input.optionId));
      if (!option || !option.isActive) {
        throw badRequest('Elegí una forma de pago válida del plan.', ErrorCodes.INVALID_INPUT);
      }

      const today = await this.todayKey(clubId, tx);
      const startDate = input.startDate ? String(input.startDate) : today;
      if (!isDateKey(startDate)) throw badRequest('Fecha de inicio inválida.', ErrorCodes.INVALID_DATE_TIME);

      const schedule = buildInitialSchedule(
        {
          billingType: plan.billingType,
          periodMonths: plan.periodMonths,
          enrollmentFee: toNumber(plan.enrollmentFee),
          dueDayOfMonth: plan.dueDayOfMonth,
        },
        { installmentsCount: option.installmentsCount, installmentPrice: Number(option.installmentPrice) },
        startDate
      );

      const snapshot: PlanSnapshot = {
        planName: plan.name,
        billingType: plan.billingType,
        periodMonths: plan.periodMonths,
        optionLabel: option.label,
        installmentsCount: option.installmentsCount,
        installmentPrice: Number(option.installmentPrice),
        enrollmentFee: toNumber(plan.enrollmentFee),
        dueDayOfMonth: plan.dueDayOfMonth,
        graceDays: plan.graceDays,
        pauseMaxDays: plan.pauseMaxDays,
        pauseMaxCount: plan.pauseMaxCount,
        grantsMemberCategoryId: plan.grantsMemberCategoryId,
        entitlements: plan.entitlements.map((row) => ({
          kind: row.kind,
          activityTypeId: row.activityTypeId,
          activityTypeName: row.activityType?.name ?? null,
          timesPerWeek: row.timesPerWeek,
          creditsPerPeriod: row.creditsPerPeriod,
          classType: row.classType,
        })),
      };

      const subscription = await tx.subscription.create({
        data: {
          clubId,
          planId: plan.id,
          optionId: option.id,
          clientId,
          payerClientId,
          status: 'ACTIVE',
          planSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          priceLocked: plan.billingType === 'FIXED_TERM',
          startDate: dateKeyToDate(schedule.startDate),
          endDate: schedule.endDate ? dateKeyToDate(schedule.endDate) : null,
          currentPeriodEnd: dateKeyToDate(schedule.currentPeriodEnd),
          autoRenew: plan.billingType === 'RECURRING',
          notes: String(input.notes || '').trim() || null,
          createdByUserId: actorUserId,
        },
      });

      const periodCount = schedule.installments.filter((row) => row.kind === 'PERIOD').length;
      for (const row of schedule.installments) {
        const installment = await tx.subscriptionInstallment.create({
          data: {
            clubId,
            subscriptionId: subscription.id,
            sequence: row.sequence,
            kind: row.kind,
            coversFrom: dateKeyToDate(row.coversFrom),
            coversTo: dateKeyToDate(row.coversTo),
            dueDate: dateKeyToDate(row.dueDate),
            listAmount: new Prisma.Decimal(row.listAmount),
          },
        });
        await this.createInstallmentAccountTx(tx, {
          clubId,
          installmentId: installment.id,
          payerClientId,
          description: this.installmentDescription(plan.name, row, periodCount),
          amount: row.listAmount,
          actorUserId,
        });
      }

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          clubId,
          action: 'CREATED',
          toStatus: 'ACTIVE',
          detail: { planName: plan.name, optionLabel: option.label, startDate } as Prisma.InputJsonValue,
          changedByUserId: actorUserId,
        },
      });

      if (plan.grantsMemberCategoryId) {
        await this.ensureMemberTx(tx, {
          clubId,
          clientId,
          categoryId: plan.grantsMemberCategoryId,
          joinedAt: startDate,
          actorUserId,
        });
        await this.syncMemberValidUntilTx(tx, clubId, clientId, actorUserId);
      }

      return subscription.id;
    });
    return this.getSubscription(clubId, result);
  }

  private async ensureMemberTx(tx: TxClient, input: {
    clubId: number;
    clientId: string;
    categoryId: string;
    joinedAt: string;
    actorUserId: number | null;
  }) {
    const existing = await tx.clubMember.findUnique({ where: { clientId: input.clientId } });
    if (existing) return existing;
    const member = await tx.clubMember.create({
      data: {
        clubId: input.clubId,
        clientId: input.clientId,
        categoryId: input.categoryId,
        joinedAt: dateKeyToDate(input.joinedAt),
        validUntil: null,
        notes: 'Alta automática por venta de plan.',
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    });
    await tx.clubMemberHistory.create({
      data: {
        clubMemberId: member.id,
        clubId: input.clubId,
        action: 'CREATED',
        toStatus: member.status,
        toCategoryId: member.categoryId,
        reason: 'Venta de plan',
        changedByUserId: input.actorUserId,
      },
    });
    return member;
  }

  // "Al día hasta" del socio = el mayor de sus planes que otorgan categoría.
  // Si el cliente no tiene planes que otorguen categoría, no se toca (se sigue cargando a mano).
  async syncMemberValidUntilTx(tx: TxClient, clubId: number, clientId: string, actorUserId: number | null) {
    const member = await tx.clubMember.findUnique({ where: { clientId } });
    if (!member || member.clubId !== clubId) return null;

    const subscriptions = await tx.subscription.findMany({
      where: {
        clubId,
        clientId,
        status: { not: 'CANCELLED' },
        plan: { grantsMemberCategoryId: { not: null } },
      },
      include: { installments: true },
    });
    if (!subscriptions.length) return null;

    let best: string | null = null;
    for (const subscription of subscriptions) {
      const snapshot = subscription.planSnapshot as unknown as PlanSnapshot;
      const candidate = memberValidUntilFromSubscription({
        startDate: dateToKey(subscription.startDate),
        graceDays: Number(snapshot?.graceDays ?? 0),
        installments: subscription.installments.map(toInstallmentState),
      });
      if (!best || candidate > best) best = candidate;
    }
    if (!best) return null;

    const current = toKeyOrNull(member.validUntil);
    if (current === best) return best;
    await tx.clubMember.update({
      where: { id: member.id },
      data: { validUntil: dateKeyToDate(best), updatedByUserId: actorUserId },
    });
    await tx.clubMemberHistory.create({
      data: {
        clubMemberId: member.id,
        clubId,
        action: 'VALID_UNTIL_SYNCED',
        reason: `Al día hasta ${best} (planes)`,
        changedByUserId: actorUserId,
      },
    });
    return best;
  }

  // ── Pago de cuotas ─────────────────────────────────────────────────────

  // Lo llama AccountService.reconcilePaidAmountTx para cuentas SUBSCRIPTION_INSTALLMENT,
  // dentro de la misma transacción del pago o la devolución.
  async syncInstallmentFromAccountTx(tx: TxClient, accountId: string) {
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true, clubId: true, sourceType: true, sourceId: true, status: true, totalAmount: true, paidAmount: true },
    });
    if (!account || account.sourceType !== 'SUBSCRIPTION_INSTALLMENT') return;

    const installment = await tx.subscriptionInstallment.findUnique({
      where: { id: account.sourceId },
      include: { subscription: true },
    });
    if (!installment || installment.status === 'VOID') return;

    const remaining = Number(account.totalAmount) - Number(account.paidAmount);
    const isPaid = account.status === 'CLOSED' && remaining <= EPSILON && Number(account.paidAmount) > EPSILON;
    const nextStatus = isPaid ? 'PAID' : 'PENDING';
    if (nextStatus === installment.status) return;

    await acquireTransactionAdvisoryLock(tx, `subscription:${installment.subscriptionId}`);
    await tx.subscriptionInstallment.update({
      where: { id: installment.id },
      data: { status: nextStatus, paidAt: isPaid ? new Date() : null },
    });

    const subscription = installment.subscription;
    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        clubId: subscription.clubId,
        action: isPaid ? 'INSTALLMENT_PAID' : 'INSTALLMENT_REOPENED',
        detail: { installmentId: installment.id, sequence: installment.sequence } as Prisma.InputJsonValue,
      },
    });

    if (isPaid && subscription.status === 'PAST_DUE') {
      const rows = await tx.subscriptionInstallment.findMany({ where: { subscriptionId: subscription.id } });
      const snapshot = subscription.planSnapshot as unknown as PlanSnapshot;
      const today = await this.todayKey(subscription.clubId, tx);
      if (!hasOverdueInstallments(rows.map(toInstallmentState), today, Number(snapshot?.graceDays ?? 0))) {
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE' } });
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            clubId: subscription.clubId,
            action: 'STATUS_CHANGED',
            fromStatus: 'PAST_DUE',
            toStatus: 'ACTIVE',
            detail: { reason: 'Cuotas al día' } as Prisma.InputJsonValue,
          },
        });
      }
    }

    await this.syncMemberValidUntilTx(tx, subscription.clubId, subscription.clientId, null);
  }

  // ── Cancelación ────────────────────────────────────────────────────────

  // Anula las cuotas pendientes sin pagos. Las que tienen pagos parciales quedan como deuda.
  async cancel(clubId: number, actorUserId: number, subscriptionId: string, reason?: string | null) {
    await prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `subscription:${subscriptionId}`);
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, clubId },
        include: { installments: true },
      });
      if (!subscription) throw notFound('Plan del cliente no encontrado.', ErrorCodes.SUBSCRIPTION_NOT_FOUND);
      if (subscription.status === 'CANCELLED') {
        throw conflict('El plan ya está cancelado.', ErrorCodes.SUBSCRIPTION_INVALID_STATUS);
      }

      const pendingAccountIds = subscription.installments
        .filter((row) => row.status === 'PENDING' && row.accountId)
        .map((row) => String(row.accountId));
      const accounts = await tx.account.findMany({
        where: { id: { in: pendingAccountIds } },
        select: { id: true, sourceId: true, paidAmount: true, status: true, totalAmount: true, clubId: true },
      });

      for (const account of accounts) {
        if (Number(account.paidAmount) > EPSILON || account.status !== 'OPEN') continue;
        const amount = Number(account.totalAmount);
        if (amount > EPSILON) {
          const description = 'Cancelación de plan';
          const item = await tx.accountItem.create({
            data: {
              accountId: account.id,
              type: 'ADJUSTMENT',
              description,
              quantity: 1,
              unitPrice: new Prisma.Decimal(-amount),
              total: new Prisma.Decimal(-amount),
            },
          });
          await this.accountingService.reverseAccountItemTransaction(tx, {
            clubId: account.clubId,
            type: 'ADJUSTMENT',
            referenceType: 'ACCOUNT_ITEM',
            referenceId: item.id,
            accountId: account.id,
            accountItemId: item.id,
            amount,
            revenueAccount: 'MEMBERSHIP_REVENUE',
            description,
            createdByUserId: actorUserId,
          });
        }
        await tx.account.update({
          where: { id: account.id },
          data: { totalAmount: new Prisma.Decimal(0), status: 'CLOSED', closedAt: new Date() },
        });
        await this.projectionService.refreshAccountSummary(account.id, tx);
        await tx.subscriptionInstallment.update({ where: { id: account.sourceId }, data: { status: 'VOID' } });
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'CANCELLED',
          autoRenew: false,
          cancelledAt: new Date(),
          cancelReason: String(reason || '').trim() || null,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          clubId,
          action: 'CANCELLED',
          fromStatus: subscription.status,
          toStatus: 'CANCELLED',
          detail: { reason: String(reason || '').trim() || null } as Prisma.InputJsonValue,
          changedByUserId: actorUserId,
        },
      });
      await this.syncMemberValidUntilTx(tx, clubId, subscription.clientId, actorUserId);
    });
    return this.getSubscription(clubId, subscriptionId);
  }

  // ── Consultas ──────────────────────────────────────────────────────────

  private async mapSubscriptions(clubId: number, rows: Array<Prisma.SubscriptionGetPayload<{
    include: {
      installments: true;
      client: { select: { id: true; name: true } };
      payerClient: { select: { id: true; name: true } };
    };
  }>>) {
    const accountIds = rows.flatMap((row) => row.installments.map((inst) => inst.accountId).filter(Boolean) as string[]);
    const accounts = accountIds.length
      ? await prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, displayCode: true, status: true, totalAmount: true, paidAmount: true },
        })
      : [];
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const today = await this.todayKey(clubId);

    return rows.map((row) => {
      const snapshot = row.planSnapshot as unknown as PlanSnapshot;
      const graceDays = Number(snapshot?.graceDays ?? 0);
      const states = row.installments.map(toInstallmentState);
      const installments = [...row.installments]
        .sort((a, b) => a.sequence - b.sequence)
        .map((inst) => {
          const account = inst.accountId ? accountById.get(inst.accountId) : null;
          const total = account ? Number(account.totalAmount) : Number(inst.listAmount);
          const paid = account ? Number(account.paidAmount) : 0;
          const state = toInstallmentState(inst);
          return {
            id: inst.id,
            sequence: inst.sequence,
            kind: inst.kind,
            coversFrom: dateToKey(inst.coversFrom),
            coversTo: dateToKey(inst.coversTo),
            dueDate: dateToKey(inst.dueDate),
            listAmount: Number(inst.listAmount),
            status: inst.status,
            isOverdue: isInstallmentOverdue(state, today, graceDays),
            paidAt: inst.paidAt ? inst.paidAt.toISOString() : null,
            account: account
              ? {
                  id: account.id,
                  displayCode: account.displayCode,
                  status: account.status,
                  totalAmount: total,
                  paidAmount: paid,
                  remainingAmount: Number(Math.max(0, total - paid).toFixed(2)),
                }
              : null,
          };
        });
      const pendingAmount = installments
        .filter((inst) => inst.status === 'PENDING')
        .reduce((sum, inst) => sum + (inst.account ? inst.account.remainingAmount : inst.listAmount), 0);

      return {
        id: row.id,
        planId: row.planId,
        optionId: row.optionId,
        planName: snapshot?.planName ?? '',
        optionLabel: snapshot?.optionLabel ?? '',
        billingType: snapshot?.billingType ?? null,
        snapshot,
        status: row.status,
        client: row.client,
        payerClient: row.payerClient,
        startDate: dateToKey(row.startDate),
        endDate: toKeyOrNull(row.endDate),
        currentPeriodEnd: dateToKey(row.currentPeriodEnd),
        paidThrough: paidThroughKey(states),
        hasOverdue: hasOverdueInstallments(states, today, graceDays),
        pendingAmount: Number(pendingAmount.toFixed(2)),
        autoRenew: row.autoRenew,
        pausesUsed: row.pausesUsed,
        priceLocked: row.priceLocked,
        cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
        cancelReason: row.cancelReason,
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
        installments,
      };
    });
  }

  private readonly subscriptionInclude = {
    installments: true,
    client: { select: { id: true, name: true } },
    payerClient: { select: { id: true, name: true } },
  } as const;

  async getSubscription(clubId: number, subscriptionId: string) {
    const row = await prisma.subscription.findFirst({
      where: { id: subscriptionId, clubId },
      include: this.subscriptionInclude,
    });
    if (!row) throw notFound('Plan del cliente no encontrado.', ErrorCodes.SUBSCRIPTION_NOT_FOUND);
    const [mapped] = await this.mapSubscriptions(clubId, [row]);
    return mapped;
  }

  async listByClient(clubId: number, clientId: string) {
    const rows = await prisma.subscription.findMany({
      where: { clubId, OR: [{ clientId }, { payerClientId: clientId }] },
      include: this.subscriptionInclude,
      orderBy: [{ createdAt: 'desc' }],
    });
    return this.mapSubscriptions(clubId, rows);
  }
}

function toInstallmentState(row: {
  sequence: number;
  kind: 'ENROLLMENT_FEE' | 'PERIOD';
  coversFrom: Date;
  coversTo: Date;
  dueDate: Date;
  status: 'PENDING' | 'PAID' | 'VOID';
}): InstallmentState {
  return {
    sequence: row.sequence,
    kind: row.kind,
    coversFrom: dateToKey(row.coversFrom),
    coversTo: dateToKey(row.coversTo),
    dueDate: dateToKey(row.dueDate),
    status: row.status,
  };
}

export const subscriptionService = new SubscriptionService();
