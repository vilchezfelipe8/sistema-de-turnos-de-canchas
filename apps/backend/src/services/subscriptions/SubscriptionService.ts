import { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '../../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../../errors';
import { AccountingService } from '../AccountingService';
import { ProjectionService } from '../ProjectionService';
import { localDateKey } from '../MemberService';
import { generateDisplayCode } from '../../utils/displayCode';
import { acquireTransactionAdvisoryLock } from '../../utils/advisoryLock';
import { pushNotificationService } from '../PushNotificationService';
import { WhatsappNotificationOutboxService } from '../WhatsappNotificationOutboxService';
import { featureFlags } from '../../config/featureFlags';
import { toDialablePhoneNumber } from '../../utils/phone';
import {
  InstallmentState,
  addDaysKey,
  addMonthsKey,
  buildInitialSchedule,
  buildRenewalInstallment,
  dateKeyToDate,
  diffDaysKey,
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
  suspendMemberAfterDays?: number | null;
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
    suspendMemberAfterDays: plan.suspendMemberAfterDays,
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
    const suspendMemberAfterDays =
      input.suspendMemberAfterDays == null
        ? null
        : intInRange(input.suspendMemberAfterDays, 1, 365, 'Los días para suspender al socio deben ser de 1 a 365.');
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
      suspendMemberAfterDays,
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
        suspendMemberAfterDays: data.suspendMemberAfterDays,
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
          suspendMemberAfterDays: data.suspendMemberAfterDays,
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
        select: { id: true, userId: true },
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

      // Clases incluidas: un pack por cada mes que cubre el plan (ver grantPlanClassPassesTx).
      const periods = schedule.installments.filter((item) => item.kind === 'PERIOD');
      await this.grantPlanClassPassesTx(tx, {
        clubId,
        subscriptionId: subscription.id,
        planName: plan.name,
        entitlements: plan.entitlements.map((row) => ({
          kind: row.kind,
          activityTypeId: row.activityTypeId,
          activityTypeName: row.activityType?.name ?? null,
          creditsPerPeriod: row.creditsPerPeriod,
          classType: row.classType,
        })),
        ownerClientId: payerClientId,
        beneficiaryClientId: clientId,
        beneficiaryUserId: clients.find((row) => row.id === clientId)?.userId ?? null,
        coverageStart: periods.reduce((min, item) => (item.coversFrom < min ? item.coversFrom : min), periods[0]?.coversFrom || startDate),
        coverageEnd: periods.reduce((max, item) => (item.coversTo > max ? item.coversTo : max), periods[0]?.coversTo || startDate),
        actorUserId,
      });

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
        await this.reactivateSuspendedMemberTx(tx, subscription.clubId, subscription.clientId);
      }
    }

    await this.syncMemberValidUntilTx(tx, subscription.clubId, subscription.clientId, null);
  }

  // Clases incluidas: son por mes. Un pack por cada mes de la cobertura (no importa en cuántas
  // cuotas se pague), que vale desde que empieza ese mes y vence una semana después de que termina.
  // Al marcar presente se usa solo (como la cuota de un curso).
  private async grantPlanClassPassesTx(tx: TxClient, input: {
    clubId: number;
    subscriptionId: string;
    planName: string;
    entitlements: Array<{
      kind: string;
      activityTypeId: number;
      activityTypeName: string | null;
      creditsPerPeriod: number | null;
      classType: string | null;
    }>;
    ownerClientId: string;
    beneficiaryClientId: string;
    beneficiaryUserId: number | null;
    coverageStart: string;
    coverageEnd: string;
    actorUserId: number;
  }) {
    const creditEntitlements = input.entitlements.filter(
      (row) => row.kind === 'CLASS_CREDITS' && Number(row.creditsPerPeriod || 0) > 0
    );
    if (!creditEntitlements.length) return 0;
    const timeZone = await this.clubTimeZone(input.clubId, tx);
    const fmt = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
    const months: Array<{ coversFrom: string; coversTo: string }> = [];
    for (let index = 0; index < 120; index += 1) {
      const from = addMonthsKey(input.coverageStart, index);
      if (from > input.coverageEnd) break;
      const lastDay = addDaysKey(addMonthsKey(input.coverageStart, index + 1), -1);
      months.push({ coversFrom: from, coversTo: lastDay < input.coverageEnd ? lastDay : input.coverageEnd });
    }
    let created = 0;
    for (const row of months) {
      const graceEnd = addDaysKey(row.coversTo, 8);
      for (const entitlement of creditEntitlements) {
        const credits = Number(entitlement.creditsPerPeriod);
        await tx.classPass.create({
          data: {
            clubId: input.clubId,
            ownerClientId: input.ownerClientId,
            beneficiaryClientId: input.beneficiaryClientId,
            beneficiaryUserId: input.beneficiaryUserId,
            packageName: `${input.planName} · ${entitlement.activityTypeName || 'clases'} del ${fmt(row.coversFrom)} al ${fmt(row.coversTo)}`,
            priceAtPurchase: null,
            totalCredits: credits,
            usedCredits: 0,
            remainingCredits: credits,
            validFrom: fromZonedTime(`${row.coversFrom}T00:00:00`, timeZone),
            expiresAt: fromZonedTime(`${graceEnd}T00:00:00`, timeZone),
            activityTypeId: entitlement.activityTypeId,
            classType: (entitlement.classType as any) ?? null,
            status: 'ACTIVE',
            subscriptionId: input.subscriptionId,
            notes: 'Incluido en el plan.',
            createdByUserId: input.actorUserId,
          },
        });
        created += 1;
      }
    }
    return created;
  }

  // ── Renovación, vencimiento y mora (job) ───────────────────────────────

  /** Días antes del fin del período en que se genera la cuota del siguiente. */
  static readonly RENEW_LEAD_DAYS = 5;

  /**
   * Corre cada hora desde el scheduler. Es idempotente:
   * - RECURRING: faltando RENEW_LEAD_DAYS para el fin del período, crea la cuota del próximo
   *   con el precio vigente de la forma de pago (y sus clases incluidas) y corre currentPeriodEnd.
   * - FIXED_TERM: pasado endDate, queda EXPIRED (renovar es vender el plan de nuevo).
   * - Mora: con una cuota vencida fuera de la gracia, pasa a PAST_DUE (al pagar vuelve sola a ACTIVE).
   */
  async runLifecycle() {
    const result = { renewed: 0, expired: 0, pastDue: 0, paused: 0, resumed: 0, suspended: 0, expiringNotices: 0 };
    const candidates = await prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] } },
      select: { id: true, clubId: true },
    });
    const todayByClub = new Map<number, string>();
    for (const candidate of candidates) {
      if (!todayByClub.has(candidate.clubId)) todayByClub.set(candidate.clubId, await this.todayKey(candidate.clubId));
      const today = todayByClub.get(candidate.clubId)!;
      try {
        const done = await prisma.$transaction((tx) => this.runLifecycleTx(tx, candidate.id, today));
        result.renewed += done.renewed;
        result.expired += done.expired ? 1 : 0;
        result.pastDue += done.pastDue ? 1 : 0;
        result.paused += done.paused ? 1 : 0;
        result.resumed += done.resumed ? 1 : 0;
        result.suspended += done.suspended ? 1 : 0;
        result.expiringNotices += done.expiringNotice ? 1 : 0;
      } catch (error) {
        console.error(`❌ Error en el ciclo del plan ${candidate.id}:`, error);
      }
    }
    return result;
  }

  private async runLifecycleTx(tx: TxClient, subscriptionId: string, today: string) {
    const done = { renewed: 0, expired: false, pastDue: false, paused: false, resumed: false, suspended: false, expiringNotice: false };
    await acquireTransactionAdvisoryLock(tx, `subscription:${subscriptionId}`);
    const subscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: { include: { entitlements: { include: { activityType: { select: { name: true } } } } } },
        option: true,
        client: { select: { userId: true, name: true, phone: true } },
        payerClient: { select: { userId: true, name: true, phone: true } },
        club: { select: { name: true } },
        pauses: true,
      },
    });
    if (!subscription || !['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(subscription.status)) return done;
    const snapshot = subscription.planSnapshot as unknown as PlanSnapshot;
    let status = subscription.status as SubscriptionStatusValue;

    // Pausas: mientras dure no se renueva ni entra en mora (las fechas ya se corrieron al pausar).
    const pausedToday = subscription.pauses.some(
      (pause) => dateToKey(pause.startDate) <= today && dateToKey(pause.endDate) >= today
    );
    if (status === 'ACTIVE' && pausedToday) {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: 'PAUSED' } });
      await tx.subscriptionHistory.create({
        data: { subscriptionId, clubId: subscription.clubId, action: 'STATUS_CHANGED', fromStatus: 'ACTIVE', toStatus: 'PAUSED', detail: { reason: 'Empezó la pausa' } as Prisma.InputJsonValue },
      });
      done.paused = true;
      return done;
    }
    if (status === 'PAUSED') {
      if (pausedToday) return done;
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: 'ACTIVE' } });
      await tx.subscriptionHistory.create({
        data: { subscriptionId, clubId: subscription.clubId, action: 'STATUS_CHANGED', fromStatus: 'PAUSED', toStatus: 'ACTIVE', detail: { reason: 'Terminó la pausa' } as Prisma.InputJsonValue },
      });
      status = 'ACTIVE';
      done.resumed = true;
    }
    const notice = {
      clubId: subscription.clubId,
      clubName: subscription.club?.name || 'El club',
      planName: subscription.plan.name,
      subscriptionId,
      payer: subscription.payerClient,
    };

    if (subscription.plan.billingType === 'RECURRING' && subscription.autoRenew) {
      let periodEnd = dateToKey(subscription.currentPeriodEnd);
      const last = await tx.subscriptionInstallment.aggregate({ where: { subscriptionId }, _max: { sequence: true } });
      let sequence = Number(last._max.sequence || 0);
      // Si el job estuvo parado, se ponen al día todos los períodos que correspondan.
      for (let guard = 0; guard < 24 && addDaysKey(periodEnd, -SubscriptionService.RENEW_LEAD_DAYS) <= today; guard += 1) {
        sequence += 1;
        const price = Number(subscription.option.installmentPrice) || Number(snapshot?.installmentPrice || 0);
        const row = buildRenewalInstallment(
          { periodMonths: subscription.plan.periodMonths, dueDayOfMonth: subscription.plan.dueDayOfMonth },
          periodEnd,
          sequence,
          price
        );
        const installment = await tx.subscriptionInstallment.create({
          data: {
            clubId: subscription.clubId,
            subscriptionId,
            sequence: row.sequence,
            kind: row.kind,
            coversFrom: dateKeyToDate(row.coversFrom),
            coversTo: dateKeyToDate(row.coversTo),
            dueDate: dateKeyToDate(row.dueDate),
            listAmount: new Prisma.Decimal(row.listAmount),
          },
        });
        await this.createInstallmentAccountTx(tx, {
          clubId: subscription.clubId,
          installmentId: installment.id,
          payerClientId: subscription.payerClientId,
          description: this.installmentDescription(subscription.plan.name, row, 1),
          amount: row.listAmount,
          actorUserId: null,
        });
        await this.grantPlanClassPassesTx(tx, {
          clubId: subscription.clubId,
          subscriptionId,
          planName: subscription.plan.name,
          entitlements: subscription.plan.entitlements.map((item) => ({
            kind: item.kind,
            activityTypeId: item.activityTypeId,
            activityTypeName: item.activityType?.name ?? null,
            creditsPerPeriod: item.creditsPerPeriod,
            classType: item.classType,
          })),
          ownerClientId: subscription.payerClientId,
          beneficiaryClientId: subscription.clientId,
          beneficiaryUserId: subscription.client?.userId ?? null,
          coverageStart: row.coversFrom,
          coverageEnd: row.coversTo,
          actorUserId: subscription.createdByUserId,
        });
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId,
            clubId: subscription.clubId,
            action: 'PERIOD_RENEWED',
            detail: { sequence: row.sequence, coversFrom: row.coversFrom, coversTo: row.coversTo, amount: row.listAmount } as Prisma.InputJsonValue,
          },
        });
        await this.noticeTx(tx, {
          ...notice,
          eventType: 'SUBSCRIPTION_RENEWED',
          dedupe: `renewed:${row.sequence}`,
          title: `${notice.clubName}: nueva cuota de ${notice.planName}`,
          body: `Del ${row.coversFrom.slice(8, 10)}/${row.coversFrom.slice(5, 7)} al ${row.coversTo.slice(8, 10)}/${row.coversTo.slice(5, 7)} · $${row.listAmount.toLocaleString('es-AR')} · vence el ${row.dueDate.slice(8, 10)}/${row.dueDate.slice(5, 7)}.`,
          params: { amount: row.listAmount.toFixed(2), date: row.dueDate },
        });
        periodEnd = row.coversTo;
        done.renewed += 1;
      }
      if (done.renewed) {
        await tx.subscription.update({ where: { id: subscriptionId }, data: { currentPeriodEnd: dateKeyToDate(periodEnd) } });
      }
    }

    if (subscription.plan.billingType === 'FIXED_TERM' && subscription.endDate) {
      const endKey = dateToKey(subscription.endDate);
      if (endKey >= today && addDaysKey(endKey, -SubscriptionService.EXPIRY_NOTICE_DAYS) <= today) {
        const already = await tx.subscriptionHistory.findFirst({ where: { subscriptionId, action: 'EXPIRY_NOTICE' } });
        if (!already) {
          await this.noticeTx(tx, {
            ...notice,
            eventType: 'SUBSCRIPTION_EXPIRING',
            dedupe: `expiring:${endKey}`,
            title: `Tu plan ${notice.planName} termina el ${endKey.slice(8, 10)}/${endKey.slice(5, 7)}`,
            body: `Hablá con ${notice.clubName} para renovarlo.`,
            params: { date: endKey },
          });
          await tx.subscriptionHistory.create({
            data: { subscriptionId, clubId: subscription.clubId, action: 'EXPIRY_NOTICE', detail: { endDate: endKey } as Prisma.InputJsonValue },
          });
          done.expiringNotice = true;
        }
      }
    }

    if (subscription.plan.billingType === 'FIXED_TERM' && subscription.endDate && dateToKey(subscription.endDate) < today) {
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: 'EXPIRED', autoRenew: false } });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId,
          clubId: subscription.clubId,
          action: 'STATUS_CHANGED',
          fromStatus: status,
          toStatus: 'EXPIRED',
          detail: { reason: 'Terminó el plazo' } as Prisma.InputJsonValue,
        },
      });
      done.expired = true;
      return done;
    }

    if (status === 'ACTIVE') {
      const rows = await tx.subscriptionInstallment.findMany({ where: { subscriptionId } });
      if (hasOverdueInstallments(rows.map(toInstallmentState), today, Number(snapshot?.graceDays ?? 0))) {
        await tx.subscription.update({ where: { id: subscriptionId }, data: { status: 'PAST_DUE' } });
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId,
            clubId: subscription.clubId,
            action: 'STATUS_CHANGED',
            fromStatus: 'ACTIVE',
            toStatus: 'PAST_DUE',
            detail: { reason: 'Cuota vencida' } as Prisma.InputJsonValue,
          },
        });
        status = 'PAST_DUE';
        done.pastDue = true;
        const overdue = rows
          .filter((row) => isInstallmentOverdue(toInstallmentState(row), today, Number(snapshot?.graceDays ?? 0)))
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        await this.noticeTx(tx, {
          ...notice,
          eventType: 'SUBSCRIPTION_PAST_DUE',
          dedupe: `past-due:${overdue ? overdue.id : today}`,
          title: `Tenés una cuota vencida de ${notice.planName}`,
          body: `Pagala en ${notice.clubName} para seguir usando el plan.`,
          params: { amount: overdue ? Number(overdue.listAmount).toFixed(2) : '', date: overdue ? dateToKey(overdue.dueDate) : today },
        });
      }
    }

    // Socio suspendido después de X días de mora (si el plan lo configura y otorga categoría).
    const suspendAfter = Number(subscription.plan.suspendMemberAfterDays || 0);
    if (status === 'PAST_DUE' && suspendAfter > 0 && subscription.plan.grantsMemberCategoryId) {
      const rows = await tx.subscriptionInstallment.findMany({ where: { subscriptionId, status: 'PENDING' } });
      const grace = Number(snapshot?.graceDays ?? 0);
      const longOverdue = rows.some((row) => addDaysKey(dateToKey(row.dueDate), grace + suspendAfter) < today);
      if (longOverdue) {
        const member = await tx.clubMember.findUnique({ where: { clientId: subscription.clientId } });
        if (member && member.clubId === subscription.clubId && member.status === 'ACTIVE') {
          await tx.clubMember.update({
            where: { id: member.id },
            data: { status: 'SUSPENDED', statusReason: `${SubscriptionService.SUSPENSION_REASON} ${subscription.plan.name}` },
          });
          await tx.clubMemberHistory.create({
            data: {
              clubMemberId: member.id,
              clubId: member.clubId,
              action: 'STATUS_CHANGED',
              fromStatus: 'ACTIVE',
              toStatus: 'SUSPENDED',
              reason: `${SubscriptionService.SUSPENSION_REASON} ${subscription.plan.name}`,
            },
          });
          done.suspended = true;
        }
      }
    }
    return done;
  }

  /** Motivo con el que el job suspende socios (así sabe a quién reactivar cuando pagan). */
  static readonly SUSPENSION_REASON = 'Mora en el plan';
  /** Días antes del fin de un plazo fijo en que se avisa. */
  static readonly EXPIRY_NOTICE_DAYS = 7;

  private async reactivateSuspendedMemberTx(tx: TxClient, clubId: number, clientId: string) {
    const member = await tx.clubMember.findUnique({ where: { clientId } });
    if (!member || member.clubId !== clubId || member.status !== 'SUSPENDED') return;
    if (!String(member.statusReason || '').startsWith(SubscriptionService.SUSPENSION_REASON)) return;
    // Si tiene otro plan todavía en mora, sigue suspendido.
    const stillPastDue = await tx.subscription.count({ where: { clubId, clientId, status: 'PAST_DUE' } });
    if (stillPastDue) return;
    await tx.clubMember.update({ where: { id: member.id }, data: { status: 'ACTIVE', statusReason: null } });
    await tx.clubMemberHistory.create({
      data: { clubMemberId: member.id, clubId, action: 'STATUS_CHANGED', fromStatus: 'SUSPENDED', toStatus: 'ACTIVE', reason: 'Pagó las cuotas del plan' },
    });
  }

  private readonly whatsappOutbox = new WhatsappNotificationOutboxService();

  /**
   * Aviso al que paga el plan: push a su usuario de Pique y, si el club tiene la plantilla de
   * WhatsApp aprobada y activa para ese evento, también por WhatsApp. Nunca frena el job.
   */
  private async noticeTx(tx: TxClient, input: {
    clubId: number;
    clubName: string;
    planName: string;
    subscriptionId: string;
    payer: { userId: number | null; name: string; phone: string | null } | null;
    eventType: 'SUBSCRIPTION_RENEWED' | 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_EXPIRING';
    dedupe: string;
    title: string;
    body: string;
    params: { amount?: string; date: string };
  }) {
    try {
      if (input.payer?.userId) {
        await pushNotificationService.enqueue(tx, {
          clubId: input.clubId,
          userId: input.payer.userId,
          kind: 'PLAN_NOTICE',
          aggregateType: 'Subscription',
          aggregateId: input.subscriptionId,
          content: { title: input.title, body: input.body, url: '/perfil#mis-planes', tag: `plan-${input.subscriptionId}-${input.dedupe}` },
        });
      }
      const phone = toDialablePhoneNumber(input.payer?.phone);
      if (!phone || !featureFlags.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2) return;
      const template = await tx.whatsappTemplateMapping.findFirst({
        where: { eventType: input.eventType, recipientRole: 'CUSTOMER', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!template) return;
      const date = `${input.params.date.slice(8, 10)}/${input.params.date.slice(5, 7)}/${input.params.date.slice(0, 4)}`;
      await this.whatsappOutbox.enqueueSendV2(
        {
          eventType: input.eventType,
          recipientRole: 'CUSTOMER',
          clubId: input.clubId,
          recipientPhone: phone,
          referenceType: 'SUBSCRIPTION',
          referenceId: input.subscriptionId,
          dedupeKey: `wa-v2:subscription:${input.subscriptionId}:${input.dedupe}:${phone}`,
          templateParams: {
            client_name: input.payer?.name || '',
            club_name: input.clubName,
            plan_name: input.planName,
            amount: input.params.amount || '',
            date,
          },
          templateParameterOrder: ['client_name', 'club_name', 'plan_name', 'amount', 'date'],
          metadata: { source: input.eventType, subscriptionId: input.subscriptionId },
        },
        tx
      );
    } catch (error) {
      console.error('[planes] No se pudo encolar el aviso', { subscriptionId: input.subscriptionId, eventType: input.eventType, error });
    }
  }

  // ── Pausa ──────────────────────────────────────────────────────────────

  /**
   * Pausa el plan entre dos fechas: corre el fin del plazo/período, las cuotas que vienen y las
   * clases incluidas por los días de la pausa. Mientras dura, el plan queda PAUSED (sin acceso
   * ni clases); el job lo pasa a PAUSED el día que empieza y lo vuelve a ACTIVE al terminar.
   */
  async pause(
    clubId: number,
    actorUserId: number,
    subscriptionId: string,
    input: { startDate?: string | null; endDate: string; reason?: string | null }
  ) {
    await prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `subscription:${subscriptionId}`);
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, clubId },
        include: { pauses: true, installments: true },
      });
      if (!subscription) throw notFound('Plan del cliente no encontrado.', ErrorCodes.SUBSCRIPTION_NOT_FOUND);
      if (subscription.status !== 'ACTIVE') {
        throw conflict('Solo se puede pausar un plan activo y al día.', ErrorCodes.INVALID_INPUT);
      }
      const snapshot = subscription.planSnapshot as unknown as PlanSnapshot;
      const maxCount = Number(snapshot?.pauseMaxCount ?? 0);
      const maxDays = Number(snapshot?.pauseMaxDays ?? 0);
      if (maxCount < 1 || maxDays < 1) throw badRequest('Este plan no permite pausas.', ErrorCodes.INVALID_INPUT);
      if (subscription.pausesUsed >= maxCount) {
        throw conflict(
          maxCount === 1 ? 'Ya usó la pausa que permite el plan.' : `Ya usó las ${maxCount} pausas que permite el plan.`,
          ErrorCodes.INVALID_INPUT
        );
      }
      const today = await this.todayKey(clubId, tx);
      const startDate = input.startDate || today;
      const endDate = input.endDate;
      if (!isDateKey(startDate) || !isDateKey(endDate)) throw badRequest('Fechas inválidas.', ErrorCodes.INVALID_DATE_TIME);
      if (startDate < today) throw badRequest('La pausa no puede empezar antes de hoy.', ErrorCodes.INVALID_DATE_TIME);
      if (endDate < startDate) throw badRequest('La pausa tiene que terminar después de empezar.', ErrorCodes.INVALID_DATE_TIME);
      const days = diffDaysKey(startDate, endDate) + 1;
      if (days > maxDays) {
        throw badRequest(`La pausa puede ser de hasta ${maxDays} ${maxDays === 1 ? 'día' : 'días'}.`, ErrorCodes.INVALID_INPUT);
      }
      if (subscription.endDate && startDate > dateToKey(subscription.endDate)) {
        throw badRequest('La pausa tiene que empezar antes de que termine el plan.', ErrorCodes.INVALID_DATE_TIME);
      }
      const overlaps = subscription.pauses.some(
        (pause) => dateToKey(pause.startDate) <= endDate && dateToKey(pause.endDate) >= startDate
      );
      if (overlaps) throw conflict('Ya hay una pausa en esas fechas.', ErrorCodes.INVALID_INPUT);

      await this.shiftForPauseTx(tx, clubId, subscriptionId, subscription.installments, startDate, days);
      const shift = (key: string) => addDaysKey(key, days);

      await tx.subscriptionPause.create({
        data: {
          subscriptionId,
          startDate: dateKeyToDate(startDate),
          endDate: dateKeyToDate(endDate),
          reason: input.reason || null,
          createdByUserId: actorUserId,
        },
      });
      const startsToday = startDate === today;
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          pausesUsed: { increment: 1 },
          currentPeriodEnd: dateKeyToDate(shift(dateToKey(subscription.currentPeriodEnd))),
          endDate: subscription.endDate ? dateKeyToDate(shift(dateToKey(subscription.endDate))) : null,
          status: startsToday ? 'PAUSED' : subscription.status,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId,
          clubId,
          action: 'PAUSED',
          fromStatus: 'ACTIVE',
          toStatus: startsToday ? 'PAUSED' : 'ACTIVE',
          detail: { startDate, endDate, days, reason: input.reason || null } as Prisma.InputJsonValue,
          changedByUserId: actorUserId,
        },
      });
      await this.syncMemberValidUntilTx(tx, clubId, subscription.clientId, actorUserId);
    });
    return this.getSubscription(clubId, subscriptionId);
  }

  /**
   * Corre las fechas del plan por una pausa que empieza en `startDate` (días > 0 al pausar,
   * < 0 al acortar o anular una pausa: deshace exactamente el mismo corrimiento).
   * Cuotas que empiezan en/después de la pausa se corren enteras; la que está en curso se estira
   * (o se achica). Packs de clases: los que no empezaron se corren; el del mes en curso cambia
   * su vencimiento.
   */
  private async shiftForPauseTx(
    tx: Prisma.TransactionClient,
    clubId: number,
    subscriptionId: string,
    installments: Array<{ id: string; status: string; kind: string; coversFrom: Date; coversTo: Date; dueDate: Date }>,
    startDate: string,
    days: number
  ) {
    if (!days) return;
    const shift = (key: string) => addDaysKey(key, days);
    for (const row of installments) {
      if (row.status === 'VOID' || row.kind !== 'PERIOD') continue;
      const from = dateToKey(row.coversFrom);
      const to = dateToKey(row.coversTo);
      if (from >= startDate) {
        await tx.subscriptionInstallment.update({
          where: { id: row.id },
          data: {
            coversFrom: dateKeyToDate(shift(from)),
            coversTo: dateKeyToDate(shift(to)),
            dueDate: row.status === 'PENDING' ? dateKeyToDate(shift(dateToKey(row.dueDate))) : row.dueDate,
          },
        });
      } else if (to >= startDate) {
        await tx.subscriptionInstallment.update({ where: { id: row.id }, data: { coversTo: dateKeyToDate(shift(to)) } });
      }
    }

    const timeZone = await this.clubTimeZone(clubId, tx);
    const startInstant = fromZonedTime(`${startDate}T00:00:00`, timeZone);
    const shiftMs = days * 86_400_000;
    const fmt = (date: Date) => {
      const key = localDateKey(date, timeZone);
      return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
    };
    const passes = await tx.classPass.findMany({ where: { subscriptionId, status: 'ACTIVE' } });
    for (const pass of passes) {
      if (pass.validFrom && pass.validFrom >= startInstant) {
        const validFrom = new Date(pass.validFrom.getTime() + shiftMs);
        const expiresAt = pass.expiresAt ? new Date(pass.expiresAt.getTime() + shiftMs) : null;
        const coversTo = expiresAt ? new Date(expiresAt.getTime() - 8 * 86_400_000) : null;
        await tx.classPass.update({
          where: { id: pass.id },
          data: {
            validFrom,
            expiresAt,
            packageName: coversTo
              ? pass.packageName.replace(/del \d{2}\/\d{2} al \d{2}\/\d{2}$/, `del ${fmt(validFrom)} al ${fmt(coversTo)}`)
              : pass.packageName,
          },
        });
      } else if (pass.expiresAt && pass.expiresAt > startInstant) {
        await tx.classPass.update({ where: { id: pass.id }, data: { expiresAt: new Date(pass.expiresAt.getTime() + shiftMs) } });
      }
    }
  }

  /**
   * Termina una pausa antes de tiempo o la anula.
   * - Pausa en curso (empezó antes de hoy): termina ayer, el plan vuelve a ACTIVE hoy y las fechas
   *   se adelantan los días que no se usaron.
   * - Pausa que todavía no empezó (o empieza hoy): se borra, se deshace todo el corrimiento y se
   *   devuelve la pausa al cupo del plan (sirve para corregir una carga equivocada).
   */
  async endPause(clubId: number, actorUserId: number, subscriptionId: string, pauseId: string) {
    await prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `subscription:${subscriptionId}`);
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, clubId },
        include: { pauses: true, installments: true },
      });
      if (!subscription) throw notFound('Plan del cliente no encontrado.', ErrorCodes.SUBSCRIPTION_NOT_FOUND);
      if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
        throw conflict('El plan ya terminó.', ErrorCodes.INVALID_INPUT);
      }
      const pause = subscription.pauses.find((row) => row.id === pauseId);
      if (!pause) throw notFound('Pausa no encontrada.', ErrorCodes.INVALID_INPUT);
      const today = await this.todayKey(clubId, tx);
      const startDate = dateToKey(pause.startDate);
      const endDate = dateToKey(pause.endDate);
      if (endDate < today) throw conflict('Esa pausa ya terminó.', ErrorCodes.INVALID_INPUT);

      const cancelled = startDate >= today;
      const newEnd = cancelled ? null : addDaysKey(today, -1);
      const days = cancelled ? diffDaysKey(startDate, endDate) + 1 : diffDaysKey(newEnd as string, endDate);
      await this.shiftForPauseTx(tx, clubId, subscriptionId, subscription.installments, startDate, -days);

      if (cancelled) {
        await tx.subscriptionPause.delete({ where: { id: pause.id } });
      } else {
        await tx.subscriptionPause.update({ where: { id: pause.id }, data: { endDate: dateKeyToDate(newEnd as string) } });
      }
      const resumes = subscription.status === 'PAUSED';
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          pausesUsed: cancelled ? Math.max(0, subscription.pausesUsed - 1) : subscription.pausesUsed,
          currentPeriodEnd: dateKeyToDate(addDaysKey(dateToKey(subscription.currentPeriodEnd), -days)),
          endDate: subscription.endDate ? dateKeyToDate(addDaysKey(dateToKey(subscription.endDate), -days)) : null,
          status: resumes ? 'ACTIVE' : subscription.status,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId,
          clubId,
          action: cancelled ? 'PAUSE_CANCELLED' : 'PAUSE_ENDED',
          fromStatus: subscription.status,
          toStatus: resumes ? 'ACTIVE' : subscription.status,
          detail: { startDate, endDate, newEndDate: newEnd, daysGivenBack: days } as Prisma.InputJsonValue,
          changedByUserId: actorUserId,
        },
      });
      await this.syncMemberValidUntilTx(tx, clubId, subscription.clientId, actorUserId);
    });
    // Si al volver quedó una cuota vencida, el job la pasa a mora como siempre.
    const todayKey = await this.todayKey(clubId);
    await prisma.$transaction((tx) => this.runLifecycleTx(tx, subscriptionId, todayKey)).catch(() => undefined);
    return this.getSubscription(clubId, subscriptionId);
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

      // Clases incluidas de los períodos que todavía no empezaron: se anulan (si no se usaron).
      await tx.classPass.updateMany({
        where: { subscriptionId: subscription.id, status: 'ACTIVE', usedCredits: 0, validFrom: { gt: new Date() } },
        data: { status: 'CANCELLED' },
      });

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
      pauses: true;
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
        pauseMaxDays: Number(snapshot?.pauseMaxDays ?? 0),
        pauseMaxCount: Number(snapshot?.pauseMaxCount ?? 0),
        pauses: [...row.pauses]
          .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
          .map((pause) => ({
            id: pause.id,
            startDate: dateToKey(pause.startDate),
            endDate: dateToKey(pause.endDate),
            reason: pause.reason,
          })),
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
    pauses: true,
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

  // ── App del jugador ────────────────────────────────────────────────────

  /**
   * "Mis planes": los planes vigentes del jugador en todos sus clubes (los que usa y los que paga),
   * con la próxima cuota y las clases incluidas que le quedan.
   */
  async listMine(userId: number) {
    const rows = await prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] },
        OR: [{ client: { userId } }, { payerClient: { userId } }],
      },
      include: {
        ...this.subscriptionInclude,
        client: { select: { id: true, name: true, userId: true } },
        payerClient: { select: { id: true, name: true, userId: true } },
        club: { select: { name: true, slug: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (!rows.length) return [];

    const byClub = new Map<number, typeof rows>();
    for (const row of rows) byClub.set(row.clubId, [...(byClub.get(row.clubId) || []), row]);
    const mapped = new Map<string, any>();
    for (const [clubId, clubRows] of byClub) {
      for (const item of await this.mapSubscriptions(clubId, clubRows)) mapped.set(item.id, item);
    }

    const now = new Date();
    const passes = await prisma.classPass.findMany({
      where: {
        subscriptionId: { in: rows.map((row) => row.id) },
        status: 'ACTIVE',
        remainingCredits: { gt: 0 },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        ],
      },
      orderBy: [{ validFrom: 'asc' }],
      select: { subscriptionId: true, packageName: true, remainingCredits: true, totalCredits: true, expiresAt: true },
    });

    return rows.map((row) => {
      const item = mapped.get(row.id);
      // Lo paga para otro (hijo, etc.): no es quien toma las clases.
      const isPayer = row.client.userId !== userId;
      const pending = item.installments.filter((inst: any) => inst.status === 'PENDING');
      const next = pending.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate))[0] || null;
      const today = localDateKey(now, DEFAULT_TIME_ZONE);
      const pause = item.pauses.find((row: any) => row.endDate >= today) || null;
      return {
        id: row.id,
        clubId: row.clubId,
        clubName: row.club?.name || '',
        clubSlug: row.club?.slug || '',
        planName: item.planName,
        optionLabel: item.optionLabel,
        billingType: item.billingType,
        status: item.status,
        hasOverdue: item.hasOverdue,
        // Lo paga otro (o lo paga para otro): se muestra para quién es.
        beneficiaryName: row.client.id !== row.payerClient.id ? row.client.name : null,
        payerName: row.client.id !== row.payerClient.id ? row.payerClient.name : null,
        isPayerOnly: isPayer,
        startDate: item.startDate,
        endDate: item.endDate,
        currentPeriodEnd: item.currentPeriodEnd,
        paidThrough: item.paidThrough,
        pendingAmount: item.pendingAmount,
        nextInstallment: next
          ? {
              amount: next.account ? next.account.remainingAmount : next.listAmount,
              dueDate: next.dueDate,
              coversFrom: next.coversFrom,
              coversTo: next.coversTo,
              isOverdue: next.isOverdue,
              // Se puede pagar online: tiene cuenta abierta con saldo.
              payable: Boolean(next.account && next.account.status === 'OPEN' && next.account.remainingAmount > 0),
            }
          : null,
        pause: pause ? { id: pause.id, startDate: pause.startDate, endDate: pause.endDate, started: pause.startDate <= today } : null,
        pauseMaxDays: item.pauseMaxDays,
        pauseMaxCount: item.pauseMaxCount,
        pausesUsed: item.pausesUsed,
        // El jugador puede pausar solo: plan activo, que permita pausas, con cupo y sin otra pausa por venir.
        canPause: item.status === 'ACTIVE' && item.pauseMaxCount > 0 && item.pauseMaxDays > 0 && item.pausesUsed < item.pauseMaxCount && !pause,
        classes: passes
          .filter((pass) => pass.subscriptionId === row.id)
          .map((pass) => ({
            name: pass.packageName,
            remaining: pass.remainingCredits,
            total: pass.totalCredits,
            expiresAt: pass.expiresAt ? pass.expiresAt.toISOString() : null,
          })),
      };
    });
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
