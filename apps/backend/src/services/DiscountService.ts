import { DiscountAmountType, DiscountApplyMode, DiscountScope, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type TxClient = Prisma.TransactionClient;

type DiscountDraftInput = {
  clubId: number;
  clientId?: string | null;
  itemType: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  quantity: number;
  unitPrice: number;
  activityTypeId?: number | null;
  productId?: number | null;
  productCategory?: string | null;
  serviceCode?: string | null;
  now?: Date;
};

type DiscountSnapshot = {
  policyId: string;
  clientId?: string | null;
  scope: DiscountScope;
  amountType: DiscountAmountType;
  amountValue: number;
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
};

type ComputeDiscountResult = {
  unitPrice: number;
  total: number;
  totalDiscount: number;
  snapshots: DiscountSnapshot[];
};

const round2 = (value: number) => Number(Number(value || 0).toFixed(2));

const toScope = (itemType: DiscountDraftInput['itemType']): DiscountScope | null => {
  if (itemType === 'BOOKING') return 'BOOKING';
  if (itemType === 'PRODUCT') return 'PRODUCT';
  if (itemType === 'SERVICE') return 'SERVICE';
  return null;
};

export class DiscountService {
  private isPolicyActive(now: Date, startsAt?: Date | null, endsAt?: Date | null) {
    if (startsAt && startsAt.getTime() > now.getTime()) return false;
    if (endsAt && endsAt.getTime() < now.getTime()) return false;
    return true;
  }

  private matchTarget(input: DiscountDraftInput, target: {
    activityTypeId: number | null;
    productId: number | null;
    productCategory: string | null;
    serviceCode: string | null;
  }) {
    if (input.itemType === 'BOOKING' && target.activityTypeId != null) {
      return Number(input.activityTypeId || 0) === target.activityTypeId;
    }

    if (input.itemType === 'PRODUCT') {
      if (target.productId != null) return Number(input.productId || 0) === target.productId;
      if (target.productCategory != null) {
        return String(input.productCategory || '').trim().toLowerCase() === String(target.productCategory).trim().toLowerCase();
      }
    }

    if (input.itemType === 'SERVICE' && target.serviceCode != null) {
      return String(input.serviceCode || '').trim().toLowerCase() === String(target.serviceCode).trim().toLowerCase();
    }

    return false;
  }

  private policyMatchesTargets(
    input: DiscountDraftInput,
    policy: {
      applyMode: DiscountApplyMode;
      targets: Array<{
        activityTypeId: number | null;
        productId: number | null;
        productCategory: string | null;
        serviceCode: string | null;
      }>;
    }
  ) {
    if (!policy.targets.length) return true;

    const anyMatch = policy.targets.some((target) => this.matchTarget(input, target));
    if (policy.applyMode === 'INCLUDE_ONLY') return anyMatch;
    return !anyMatch;
  }

  private selectPolicies(assignments: Array<{
    clientId: string;
    policy: {
      id: string;
      isStackable: boolean;
      priority: number;
      scope: DiscountScope;
      amountType: DiscountAmountType;
      amountValue: Prisma.Decimal;
      applyMode: DiscountApplyMode;
      targets: Array<{
        activityTypeId: number | null;
        productId: number | null;
        productCategory: string | null;
        serviceCode: string | null;
      }>;
    };
  }>) {
    // Precedencia:
    // 1) prioridad ascendente (menor número = mayor prioridad)
    // 2) primera política no stackable corta la cadena
    // 3) si todas son stackable, se aplican en cascada sobre el neto
    const selected: typeof assignments = [];
    for (const assignment of assignments) {
      if (!selected.length) {
        selected.push(assignment);
        if (!assignment.policy.isStackable) break;
        continue;
      }
      const hasNonStackable = selected.some((item) => !item.policy.isStackable);
      if (hasNonStackable) break;
      if (!assignment.policy.isStackable) {
        break;
      }
      selected.push(assignment);
    }
    return selected;
  }

  async computeDraftDiscountTx(tx: TxClient, input: DiscountDraftInput): Promise<ComputeDiscountResult> {
    const qty = Math.floor(Number(input.quantity || 0));
    const unitPrice = round2(input.unitPrice);
    const scope = toScope(input.itemType);

    if (!scope || !input.clientId || qty <= 0 || unitPrice <= 0) {
      return {
        unitPrice,
        total: round2(unitPrice * Math.max(1, qty)),
        totalDiscount: 0,
        snapshots: []
      };
    }

    const now = input.now ?? new Date();
    const assignments = await tx.clientDiscountAssignment.findMany({
      where: {
        clubId: input.clubId,
        clientId: input.clientId,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
        policy: {
          isActive: true,
          scope: { in: [scope, 'ALL'] },
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }]
        }
      },
      include: {
        policy: {
          include: {
            targets: true
          }
        }
      },
      orderBy: [
        { policy: { priority: 'asc' } },
        { policy: { id: 'asc' } },
        { createdAt: 'asc' }
      ]
    });

    const matching = assignments.filter((assignment) => {
      if (!this.isPolicyActive(now, assignment.policy.startsAt, assignment.policy.endsAt)) return false;
      return this.policyMatchesTargets(input, assignment.policy);
    });

    if (!matching.length) {
      return {
        unitPrice,
        total: round2(unitPrice * qty),
        totalDiscount: 0,
        snapshots: []
      };
    }

    const selected = this.selectPolicies(matching);
    let runningUnit = unitPrice;
    const snapshots: DiscountSnapshot[] = [];

    for (const assignment of selected) {
      if (runningUnit <= 0.009) break;

      const amountValue = Number(assignment.policy.amountValue || 0);
      if (!Number.isFinite(amountValue) || amountValue <= 0) continue;

      const baseAmount = round2(runningUnit * qty);
      let perUnitDiscount = 0;

      if (assignment.policy.amountType === 'PERCENT') {
        const bounded = Math.min(100, Math.max(0, amountValue));
        perUnitDiscount = round2((runningUnit * bounded) / 100);
      } else {
        perUnitDiscount = round2(amountValue);
      }

      if (perUnitDiscount <= 0) continue;
      perUnitDiscount = Math.min(perUnitDiscount, runningUnit);

      const discountAmount = round2(perUnitDiscount * qty);
      runningUnit = round2(Math.max(0, runningUnit - perUnitDiscount));
      const finalAmount = round2(runningUnit * qty);

      snapshots.push({
        policyId: assignment.policy.id,
        clientId: assignment.clientId,
        scope: assignment.policy.scope,
        amountType: assignment.policy.amountType,
        amountValue,
        baseAmount,
        discountAmount,
        finalAmount
      });
    }

    const finalUnitPrice = round2(runningUnit);
    const total = round2(finalUnitPrice * qty);
    const totalDiscount = round2(unitPrice * qty - total);

    return {
      unitPrice: finalUnitPrice,
      total,
      totalDiscount,
      snapshots
    };
  }

  async persistAppliedDiscountsTx(tx: TxClient, params: {
    clubId: number;
    accountItemId: string;
    appliedByUserId?: number | null;
    snapshots: DiscountSnapshot[];
  }) {
    if (!params.snapshots.length) return;

    await tx.accountItemDiscount.createMany({
      data: params.snapshots.map((snapshot) => ({
        clubId: params.clubId,
        accountItemId: params.accountItemId,
        clientId: snapshot.clientId || null,
        policyId: snapshot.policyId,
        scope: snapshot.scope,
        amountType: snapshot.amountType,
        amountValue: snapshot.amountValue,
        baseAmount: snapshot.baseAmount,
        discountAmount: snapshot.discountAmount,
        finalAmount: snapshot.finalAmount,
        appliedByUserId: params.appliedByUserId ?? null
      })),
      skipDuplicates: true
    });
  }

  async listPolicies(clubId: number) {
    return prisma.discountPolicy.findMany({
      where: { clubId },
      include: { targets: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
    });
  }

  async createPolicy(input: {
    clubId: number;
    name: string;
    description?: string;
    scope: DiscountScope;
    amountType: DiscountAmountType;
    amountValue: number;
    applyMode?: DiscountApplyMode;
    isStackable?: boolean;
    priority?: number;
    isActive?: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
    targets?: Array<{
      activityTypeId?: number | null;
      productId?: number | null;
      productCategory?: string | null;
      serviceCode?: string | null;
    }>;
  }) {
    const amount = Number(input.amountValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('amountValue inválido');
    }
    if (input.amountType === 'PERCENT' && amount > 100) {
      throw new Error('El descuento porcentual no puede superar 100');
    }

    return prisma.discountPolicy.create({
      data: {
        clubId: input.clubId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        scope: input.scope,
        amountType: input.amountType,
        amountValue: round2(amount),
        applyMode: input.applyMode ?? 'INCLUDE_ONLY',
        isStackable: Boolean(input.isStackable),
        priority: Number.isFinite(input.priority) ? Math.floor(Number(input.priority)) : 100,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        targets: input.targets?.length
          ? {
              create: input.targets.map((target) => ({
                activityTypeId: target.activityTypeId ?? null,
                productId: target.productId ?? null,
                productCategory: target.productCategory?.trim() || null,
                serviceCode: target.serviceCode?.trim() || null
              }))
            }
          : undefined
      },
      include: { targets: true }
    });
  }

  async updatePolicy(input: {
    clubId: number;
    policyId: string;
    name?: string;
    description?: string | null;
    scope?: DiscountScope;
    amountType?: DiscountAmountType;
    amountValue?: number;
    applyMode?: DiscountApplyMode;
    isStackable?: boolean;
    priority?: number;
    isActive?: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }) {
    const existing = await prisma.discountPolicy.findFirst({
      where: { id: input.policyId, clubId: input.clubId }
    });
    if (!existing) throw new Error('Política no encontrada para el club');

    const nextAmountType = input.amountType ?? existing.amountType;
    const nextAmountValue = input.amountValue == null
      ? Number(existing.amountValue || 0)
      : Number(input.amountValue);

    if (!Number.isFinite(nextAmountValue) || nextAmountValue <= 0) {
      throw new Error('amountValue inválido');
    }
    if (nextAmountType === 'PERCENT' && nextAmountValue > 100) {
      throw new Error('El descuento porcentual no puede superar 100');
    }

    return prisma.discountPolicy.update({
      where: { id: input.policyId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined ? {} : { description: input.description?.trim() || null }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.amountType === undefined ? {} : { amountType: input.amountType }),
        ...(input.amountValue === undefined ? {} : { amountValue: round2(nextAmountValue) }),
        ...(input.applyMode === undefined ? {} : { applyMode: input.applyMode }),
        ...(input.isStackable === undefined ? {} : { isStackable: Boolean(input.isStackable) }),
        ...(input.priority === undefined ? {} : { priority: Math.floor(Number(input.priority)) }),
        ...(input.isActive === undefined ? {} : { isActive: Boolean(input.isActive) }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt })
      },
      include: { targets: true }
    });
  }

  async assignPolicyToClient(input: {
    clubId: number;
    clientId: string;
    policyId: string;
    notes?: string;
    startsAt?: Date | null;
    endsAt?: Date | null;
    createdByUserId?: number | null;
  }) {
    const policy = await prisma.discountPolicy.findFirst({
      where: { id: input.policyId, clubId: input.clubId }
    });
    if (!policy) throw new Error('Política no encontrada para el club');

    const client = await prisma.client.findFirst({
      where: { id: input.clientId, clubId: input.clubId }
    });
    if (!client) throw new Error('Cliente no encontrado para el club');

    return prisma.clientDiscountAssignment.create({
      data: {
        clubId: input.clubId,
        clientId: input.clientId,
        policyId: input.policyId,
        notes: input.notes?.trim() || null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        createdByUserId: input.createdByUserId ?? null
      }
    });
  }

  async listClientAssignments(clubId: number, clientId: string) {
    return prisma.clientDiscountAssignment.findMany({
      where: { clubId, clientId },
      include: {
        policy: {
          include: { targets: true }
        }
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
    });
  }

  async setAssignmentActive(input: {
    clubId: number;
    assignmentId: string;
    isActive: boolean;
  }) {
    const assignment = await prisma.clientDiscountAssignment.findFirst({
      where: { id: input.assignmentId, clubId: input.clubId }
    });
    if (!assignment) throw new Error('Asignación no encontrada');

    return prisma.clientDiscountAssignment.update({
      where: { id: input.assignmentId },
      data: { isActive: input.isActive }
    });
  }
}
