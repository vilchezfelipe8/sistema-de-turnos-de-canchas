import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { localDateKey } from '../MemberService';
import {
  InstallmentState,
  addDaysKey,
  dateToKey,
  memberValidUntilFromSubscription,
  paidThroughKey,
} from '../../domain/subscriptionSchedule';

type DbClient = Prisma.TransactionClient | typeof prisma;

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export type AccessCode = 'OK' | 'NO_PLAN' | 'NOT_STARTED' | 'PAUSED' | 'EXPIRED' | 'UNPAID' | 'NO_TURN';

export type AccessResult = {
  allowed: boolean;
  code: AccessCode;
  message: string;
  activityName: string;
  plan: { subscriptionId: string; name: string; validUntil: string | null } | null;
  /** Límite de turnos por semana del plan (null = libre). */
  timesPerWeek: number | null;
  turn: { id: string; startsAt: string; endsAt: string } | null;
};

/** dd/mm de una fecha "YYYY-MM-DD". */
export const shortDateKey = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

export const clubTimeZone = async (clubId: number, db: DbClient = prisma) => {
  const settings = await db.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
  return settings?.timeZone || DEFAULT_TIME_ZONE;
};

export const localTimeLabel = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);

// Si ninguna suscripción habilita, se explica la más relevante.
const FAILURE_PRIORITY: AccessCode[] = ['UNPAID', 'PAUSED', 'NOT_STARTED', 'EXPIRED', 'NO_PLAN'];

/**
 * ¿Puede este cliente usar esta actividad en este momento?
 * Lo usan el turnero (al reservar, sin pedir turno) y el ingreso (molinete, kiosco).
 */
export class ActivityAccessService {
  async check(
    clubId: number,
    clientId: string,
    activityTypeId: number,
    options: { at?: Date; ignoreTurn?: boolean; db?: DbClient } = {}
  ): Promise<AccessResult> {
    const db = options.db ?? prisma;
    const at = options.at ?? new Date();
    const timeZone = await clubTimeZone(clubId, db);
    const dayKey = localDateKey(at, timeZone);

    const activity = await db.activityType.findFirst({
      where: { id: activityTypeId, clubId },
      select: { name: true, turnSchedule: true },
    });
    const activityName = activity?.name || 'la actividad';

    const subscriptions = await db.subscription.findMany({
      where: {
        clubId,
        clientId,
        status: { not: 'CANCELLED' },
        plan: { entitlements: { some: { kind: 'ACTIVITY_ACCESS', activityTypeId } } },
      },
      include: {
        installments: true,
        pauses: true,
        plan: { select: { name: true, entitlements: { where: { kind: 'ACTIVITY_ACCESS', activityTypeId } } } },
      },
      orderBy: { startDate: 'desc' },
    });

    const base = { activityName, turn: null };
    if (subscriptions.length === 0) {
      return {
        ...base,
        allowed: false,
        code: 'NO_PLAN',
        message: `No tenés un plan que incluya ${activityName}.`,
        plan: null,
        timesPerWeek: null,
      };
    }

    const evaluated = subscriptions.map((sub) => {
      const snapshot = (sub.planSnapshot || {}) as { planName?: string; graceDays?: number };
      const planName = snapshot.planName || sub.plan.name;
      const installments: InstallmentState[] = sub.installments.map((row) => ({
        sequence: row.sequence,
        kind: row.kind,
        coversFrom: dateToKey(row.coversFrom),
        coversTo: dateToKey(row.coversTo),
        dueDate: dateToKey(row.dueDate),
        status: row.status,
      }));
      const startKey = dateToKey(sub.startDate);
      const endKey = sub.endDate ? dateToKey(sub.endDate) : null;
      const validUntil = memberValidUntilFromSubscription({
        startDate: startKey,
        graceDays: Number(snapshot.graceDays ?? 0),
        installments,
      });
      const plan = { subscriptionId: sub.id, name: planName, validUntil: validUntil >= startKey ? validUntil : null };
      const timesPerWeek = sub.plan.entitlements[0]?.timesPerWeek ?? null;
      const fail = (code: AccessCode, message: string) => ({ code, message, plan, timesPerWeek });

      if (dayKey < startKey) return fail('NOT_STARTED', `Tu plan ${planName} arranca el ${shortDateKey(startKey)}.`);
      if (sub.status === 'EXPIRED' || (endKey && dayKey > endKey)) {
        return fail('EXPIRED', `Tu plan ${planName} venció el ${shortDateKey(endKey || dateToKey(sub.currentPeriodEnd))}.`);
      }
      const pause = sub.pauses.find((row) => dateToKey(row.startDate) <= dayKey && dayKey <= dateToKey(row.endDate));
      if (pause) return fail('PAUSED', `Tu plan está pausado hasta el ${shortDateKey(dateToKey(pause.endDate))}.`);
      if (dayKey > validUntil) {
        const paidThrough = paidThroughKey(installments);
        return fail(
          'UNPAID',
          paidThrough
            ? `Tu cuota venció el ${shortDateKey(addDaysKey(paidThrough, 1))}. Pagala para volver a entrar.`
            : `Todavía no pagaste tu plan ${planName}.`
        );
      }
      return { code: 'OK' as AccessCode, message: '', plan, timesPerWeek };
    });

    const ok = evaluated.find((row) => row.code === 'OK');
    if (!ok) {
      const worst = FAILURE_PRIORITY.map((code) => evaluated.find((row) => row.code === code)).find(Boolean)!;
      return { ...base, allowed: false, ...worst };
    }

    const schedule = activity?.turnSchedule;
    if (options.ignoreTurn || !schedule || !schedule.isActive || !schedule.requiresTurn) {
      return { ...base, allowed: true, code: 'OK', message: `Plan ${ok.plan.name} al día.`, plan: ok.plan, timesPerWeek: ok.timesPerWeek };
    }

    const early = Math.max(0, schedule.earlyEntryMinutes) * 60_000;
    const turns = await db.activityTurn.findMany({
      where: {
        clubId,
        clientId,
        activityTypeId,
        status: 'BOOKED',
        endsAt: { gt: at },
        startsAt: { lte: new Date(at.getTime() + 24 * 3600_000) },
      },
      orderBy: { startsAt: 'asc' },
    });
    const current = turns.find((row) => row.startsAt.getTime() - early <= at.getTime());
    if (current) {
      return {
        ...base,
        allowed: true,
        code: 'OK',
        message: `Turno de ${localTimeLabel(current.startsAt, timeZone)} a ${localTimeLabel(current.endsAt, timeZone)}.`,
        plan: ok.plan,
        timesPerWeek: ok.timesPerWeek,
        turn: { id: current.id, startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() },
      };
    }
    const next = turns.find((row) => localDateKey(row.startsAt, timeZone) === dayKey);
    return {
      ...base,
      allowed: false,
      code: 'NO_TURN',
      message: next
        ? `Tu turno es a las ${localTimeLabel(next.startsAt, timeZone)}. Podés entrar desde las ${localTimeLabel(
            new Date(next.startsAt.getTime() - early),
            timeZone
          )}.`
        : 'No tenés turno ahora. Reservalo desde la app.',
      plan: ok.plan,
      timesPerWeek: ok.timesPerWeek,
    };
  }
}

export const activityAccessService = new ActivityAccessService();
