import { prisma } from '../prisma';
import { ErrorCodes, conflict } from '../errors';
import { TimeHelper } from '../utils/TimeHelper';
import { MemberService } from './MemberService';

// Ventanas de reserva desde la app (prioridad de socios):
// cada día, en la hora del club, los socios vigentes reservan desde una hora y el resto desde otra,
// para hoy y los próximos N días, hasta la hora de cierre. El mostrador y los turnos fijos no se ven afectados.

export type BookingReleaseTimes = { memberOpensAt: string; publicOpensAt: string };

export type BookingReleasePolicy = {
  enabled: boolean;
  weekdays: BookingReleaseTimes;
  // SAME = igual que en la semana · CUSTOM = otros horarios · NO_PRIORITY = todos desde publicOpensAt
  weekendMode: 'SAME' | 'CUSTOM' | 'NO_PRIORITY';
  weekend: BookingReleaseTimes;
  // 0 = solo hoy · 1 = hoy y mañana · …
  daysAhead: number;
  // "00:00" = hasta el fin del día
  closesAt: string;
};

export type BookingReleaseState = 'OPEN' | 'NOT_OPEN_YET' | 'MEMBERS_ONLY' | 'CLOSED_FOR_TODAY';

export type BookingReleaseEvaluation =
  | { enabled: false }
  | {
      enabled: true;
      state: BookingReleaseState;
      canBookNow: boolean;
      isAuthenticated: boolean;
      isMember: boolean;
      hasMemberPriority: boolean;
      // El socio está reservando antes que el resto en este momento (para mostrarle la prioridad).
      memberPriorityActive: boolean;
      memberOpensAt: string;
      publicOpensAt: string;
      // Hora en que puede reservar quien mira (hoy, o mañana si ya cerró).
      viewerOpensAt: string;
      closesAt: string;
      daysAhead: number;
      allowedDates: string[];
      serverNow: string;
      timeZone: string;
    };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_BOOKING_RELEASE_POLICY: BookingReleasePolicy = {
  enabled: false,
  weekdays: { memberOpensAt: '08:00', publicOpensAt: '11:00' },
  weekendMode: 'SAME',
  weekend: { memberOpensAt: '08:00', publicOpensAt: '11:00' },
  daysAhead: 1,
  closesAt: '00:00'
};

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// "00:00" como cierre significa medianoche: fin del día.
const closeToMinutes = (time: string) => (time === '00:00' ? 24 * 60 : toMinutes(time));

const validTime = (value: unknown, fallback: string) =>
  typeof value === 'string' && TIME_RE.test(value) ? value : fallback;

export function normalizeBookingReleasePolicy(raw: unknown): BookingReleasePolicy {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const defaults = DEFAULT_BOOKING_RELEASE_POLICY;
  const times = (value: any, fallback: BookingReleaseTimes): BookingReleaseTimes => ({
    memberOpensAt: validTime(value?.memberOpensAt, fallback.memberOpensAt),
    publicOpensAt: validTime(value?.publicOpensAt, fallback.publicOpensAt)
  });
  const daysAhead = Number(source.daysAhead);
  return {
    enabled: source.enabled === true,
    weekdays: times(source.weekdays, defaults.weekdays),
    weekendMode: ['SAME', 'CUSTOM', 'NO_PRIORITY'].includes(source.weekendMode) ? source.weekendMode : defaults.weekendMode,
    weekend: times(source.weekend, defaults.weekend),
    daysAhead: Number.isInteger(daysAhead) && daysAhead >= 0 && daysAhead <= 30 ? daysAhead : defaults.daysAhead,
    closesAt: validTime(source.closesAt, defaults.closesAt)
  };
}

// Problemas de una política antes de guardarla (null = válida).
export function validateBookingReleasePolicy(policy: BookingReleasePolicy): string | null {
  const close = closeToMinutes(policy.closesAt);
  const groups: Array<[string, BookingReleaseTimes]> = [['de lunes a viernes', policy.weekdays]];
  if (policy.weekendMode === 'CUSTOM') groups.push(['del fin de semana', policy.weekend]);
  for (const [label, times] of groups) {
    if (toMinutes(times.memberOpensAt) > toMinutes(times.publicOpensAt)) {
      return `Los socios ${label} no pueden empezar después que el resto.`;
    }
    if (toMinutes(times.publicOpensAt) >= close) {
      return `La hora de cierre tiene que ser posterior a la apertura ${label}.`;
    }
  }
  if (policy.weekendMode === 'NO_PRIORITY' && toMinutes(policy.weekend.publicOpensAt) >= close) {
    return 'La hora de cierre tiene que ser posterior a la apertura del fin de semana.';
  }
  return null;
}

// Horarios que rigen un día (0 = domingo … 6 = sábado), según el día en que se reserva.
export function resolveTimesForDay(policy: BookingReleasePolicy, dayOfWeek: number): BookingReleaseTimes {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (!isWeekend || policy.weekendMode === 'SAME') return policy.weekdays;
  if (policy.weekendMode === 'NO_PRIORITY') {
    return { memberOpensAt: policy.weekend.publicOpensAt, publicOpensAt: policy.weekend.publicOpensAt };
  }
  return policy.weekend;
}

const dateKeyFromParts = (year: number, monthIndex: number, day: number) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
};

// Evaluación pura (sin base): útil para tests y para el endpoint.
export function evaluateBookingRelease(input: {
  policy: BookingReleasePolicy;
  now: Date;
  timeZone: string;
  isMember: boolean;
  isAuthenticated: boolean;
}): BookingReleaseEvaluation {
  const { policy } = input;
  if (!policy.enabled) return { enabled: false };

  const local = TimeHelper.utcToLocal(input.now, input.timeZone);
  const nowMinutes = local.getHours() * 60 + local.getMinutes();
  const today = resolveTimesForDay(policy, local.getDay());
  const tomorrow = resolveTimesForDay(policy, (local.getDay() + 1) % 7);
  const close = closeToMinutes(policy.closesAt);
  const memberOpens = toMinutes(today.memberOpensAt);
  const publicOpens = toMinutes(today.publicOpensAt);
  const viewerOpens = input.isMember ? memberOpens : publicOpens;

  let state: BookingReleaseState;
  if (nowMinutes >= close) state = 'CLOSED_FOR_TODAY';
  else if (nowMinutes < Math.min(memberOpens, publicOpens)) state = 'NOT_OPEN_YET';
  else if (nowMinutes < viewerOpens) state = 'MEMBERS_ONLY';
  else state = 'OPEN';

  const allowedDates = Array.from({ length: policy.daysAhead + 1 }, (_, offset) =>
    dateKeyFromParts(local.getFullYear(), local.getMonth(), local.getDate() + offset)
  );

  return {
    enabled: true,
    state,
    canBookNow: state === 'OPEN',
    isAuthenticated: input.isAuthenticated,
    isMember: input.isMember,
    hasMemberPriority: memberOpens < publicOpens,
    memberPriorityActive: input.isMember && state === 'OPEN' && nowMinutes < publicOpens,
    memberOpensAt: today.memberOpensAt,
    publicOpensAt: today.publicOpensAt,
    viewerOpensAt: state === 'CLOSED_FOR_TODAY'
      ? (input.isMember ? tomorrow.memberOpensAt : tomorrow.publicOpensAt)
      : (input.isMember ? today.memberOpensAt : today.publicOpensAt),
    closesAt: policy.closesAt,
    daysAhead: policy.daysAhead,
    allowedDates,
    serverNow: input.now.toISOString(),
    timeZone: input.timeZone
  };
}

export class BookingReleaseService {
  private readonly memberService = new MemberService();

  async getPolicy(clubId: number) {
    const settings = await prisma.clubSettings.findUnique({
      where: { clubId },
      select: { bookingReleasePolicy: true }
    });
    return normalizeBookingReleasePolicy(settings?.bookingReleasePolicy);
  }

  async savePolicy(clubId: number, policy: BookingReleasePolicy, actorUserId: number | null) {
    const normalized = normalizeBookingReleasePolicy(policy);
    const problem = validateBookingReleasePolicy(normalized);
    if (problem) throw conflict(problem, ErrorCodes.INVALID_INPUT);
    await prisma.clubSettings.upsert({
      where: { clubId },
      update: { bookingReleasePolicy: normalized },
      create: { clubId, bookingReleasePolicy: normalized }
    });
    await prisma.auditLog.create({
      data: {
        clubId,
        userId: actorUserId,
        entity: 'CLUB_SETTINGS',
        entityId: String(clubId),
        action: 'BOOKING_RELEASE_POLICY_UPDATED',
        payload: normalized
      }
    });
    return normalized;
  }

  // Socio vigente = ficha del club vinculada a su usuario y vigente hoy (RN-01).
  private async isViewerMember(clubId: number, userId: number | null, now: Date, timeZone: string) {
    if (!userId) return false;
    const client = await prisma.client.findFirst({ where: { clubId, userId }, select: { id: true } });
    if (!client) return false;
    const categoryId = await this.memberService.resolveActiveMemberCategoryTx(prisma, {
      clubId,
      clientId: client.id,
      atDateTime: now,
      timeZone
    });
    return Boolean(categoryId);
  }

  async evaluate(input: { clubId: number; userId: number | null; now?: Date }): Promise<BookingReleaseEvaluation> {
    const settings = await prisma.clubSettings.findUnique({
      where: { clubId: input.clubId },
      select: { timeZone: true, bookingReleasePolicy: true }
    });
    const policy = normalizeBookingReleasePolicy(settings?.bookingReleasePolicy);
    if (!policy.enabled) return { enabled: false };
    const now = input.now ?? new Date();
    const timeZone = settings?.timeZone || 'America/Argentina/Buenos_Aires';
    return evaluateBookingRelease({
      policy,
      now,
      timeZone,
      isAuthenticated: Boolean(input.userId),
      isMember: await this.isViewerMember(input.clubId, input.userId, now, timeZone)
    });
  }

  // Reservas hechas por el jugador desde la app: valida la ventana y el día del turno.
  async assertCanBook(input: { clubId: number; userId: number | null; startDateTime: Date; now?: Date }) {
    const evaluation = await this.evaluate(input);
    if (!evaluation.enabled) return;
    if (!evaluation.canBookNow) {
      const message = evaluation.state === 'MEMBERS_ONLY'
        ? `Hasta las ${evaluation.publicOpensAt} reservan solo socios. Podés reservar desde las ${evaluation.publicOpensAt}.`
        : evaluation.state === 'CLOSED_FOR_TODAY'
          ? `Las reservas ya cerraron por hoy. Vuelven a abrir a las ${evaluation.viewerOpensAt}.`
          : `Las reservas abren a las ${evaluation.viewerOpensAt}.`;
      throw conflict(message, ErrorCodes.BOOKING_WINDOW_CLOSED, { state: evaluation.state });
    }
    const local = TimeHelper.utcToLocal(input.startDateTime, evaluation.timeZone);
    const bookingDateKey = dateKeyFromParts(local.getFullYear(), local.getMonth(), local.getDate());
    if (!evaluation.allowedDates.includes(bookingDateKey)) {
      const range = evaluation.daysAhead === 0
        ? 'solo para hoy'
        : evaluation.daysAhead === 1
          ? 'para hoy y mañana'
          : `hasta ${evaluation.daysAhead} días hacia adelante`;
      throw conflict(`Desde la app podés reservar ${range}.`, ErrorCodes.BOOKING_WINDOW_CLOSED, { state: 'DATE_OUT_OF_RANGE' });
    }
  }
}
