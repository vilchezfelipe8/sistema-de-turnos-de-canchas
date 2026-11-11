// Cálculo puro de cuotas de planes (sin DB). Fechas como claves 'YYYY-MM-DD',
// que es como se guardan las columnas @db.Date. Ver docs/planes-y-cuotas-diseno.md.

export type BillingType = 'RECURRING' | 'FIXED_TERM';
export type InstallmentKind = 'ENROLLMENT_FEE' | 'PERIOD';
export type InstallmentStatus = 'PENDING' | 'PAID' | 'VOID';

export type PlanScheduleInput = {
  billingType: BillingType;
  periodMonths: number;
  enrollmentFee: number | null;
  dueDayOfMonth: number | null;
};

export type OptionScheduleInput = {
  installmentsCount: number;
  installmentPrice: number;
};

export type ScheduledInstallment = {
  sequence: number;
  kind: InstallmentKind;
  coversFrom: string;
  coversTo: string;
  dueDate: string;
  listAmount: number;
};

export type InitialSchedule = {
  startDate: string;
  endDate: string | null;
  currentPeriodEnd: string;
  installments: ScheduledInstallment[];
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const parts = (key: string) => {
  if (!isDateKey(key)) throw new Error(`Fecha inválida: ${key}`);
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
};

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const toKey = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function dateKeyToDate(key: string): Date {
  parts(key);
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  const date = dateKeyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToKey(date);
}

// Suma meses respetando el fin de mes: 31/01 + 1 mes = 28/02 (o 29).
export function addMonthsKey(key: string, months: number): string {
  const { y, m, d } = parts(key);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toKey(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

// Último día cubierto por un período de N meses que empieza en startKey.
export function periodEndKey(startKey: string, months: number): string {
  return addDaysKey(addMonthsKey(startKey, months), -1);
}

export function diffDaysKey(fromKey: string, toKeyValue: string): number {
  return Math.round((dateKeyToDate(toKeyValue).getTime() - dateKeyToDate(fromKey).getTime()) / 86_400_000);
}

// Vencimiento de una cuota que cubre desde coversFrom.
// Sin día fijo: vence el primer día que cubre. Con día fijo: ese día del mes de
// coversFrom, pero nunca antes de coversFrom (un alta del 20 con día fijo 10 vence el 20).
export function dueDateFor(coversFrom: string, dueDayOfMonth: number | null): string {
  if (!dueDayOfMonth) return coversFrom;
  const { y, m } = parts(coversFrom);
  const candidate = toKey(y, m, Math.min(dueDayOfMonth, daysInMonth(y, m)));
  return candidate < coversFrom ? coversFrom : candidate;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function validatePlanOptionShape(plan: Pick<PlanScheduleInput, 'billingType' | 'periodMonths'>, option: OptionScheduleInput): string | null {
  if (!Number.isInteger(plan.periodMonths) || plan.periodMonths < 1 || plan.periodMonths > 24) {
    return 'La duración del plan debe ser de 1 a 24 meses.';
  }
  if (!Number.isInteger(option.installmentsCount) || option.installmentsCount < 1) {
    return 'La cantidad de cuotas debe ser 1 o más.';
  }
  if (!(Number(option.installmentPrice) > 0)) {
    return 'El precio de la cuota debe ser mayor a 0.';
  }
  if (plan.billingType === 'RECURRING' && option.installmentsCount !== 1) {
    return 'Un plan que se renueva solo se cobra en 1 cuota por período.';
  }
  if (plan.billingType === 'FIXED_TERM' && plan.periodMonths % option.installmentsCount !== 0) {
    return 'La cantidad de cuotas tiene que dividir la duración del plan (por ejemplo, 3 cuotas en 3 o 6 meses).';
  }
  return null;
}

// Cuotas que se generan al vender un plan.
// FIXED_TERM: todas de entrada, cada una cubre una parte igual del plazo.
// RECURRING: solo el primer período; el resto lo genera la renovación.
export function buildInitialSchedule(plan: PlanScheduleInput, option: OptionScheduleInput, startDate: string): InitialSchedule {
  const shapeError = validatePlanOptionShape(plan, option);
  if (shapeError) throw new Error(shapeError);
  parts(startDate);

  const installments: ScheduledInstallment[] = [];
  const enrollmentFee = roundMoney(Number(plan.enrollmentFee || 0));
  if (enrollmentFee > 0) {
    installments.push({
      sequence: 0,
      kind: 'ENROLLMENT_FEE',
      coversFrom: startDate,
      coversTo: startDate,
      dueDate: startDate,
      listAmount: enrollmentFee,
    });
  }

  const price = roundMoney(Number(option.installmentPrice));
  const count = plan.billingType === 'RECURRING' ? 1 : option.installmentsCount;
  const monthsPerInstallment = plan.periodMonths / count;

  for (let i = 0; i < count; i += 1) {
    const coversFrom = addMonthsKey(startDate, i * monthsPerInstallment);
    const coversTo = periodEndKey(startDate, (i + 1) * monthsPerInstallment);
    installments.push({
      sequence: i + 1,
      kind: 'PERIOD',
      coversFrom,
      coversTo,
      // La primera se paga al dar el alta.
      dueDate: i === 0 ? startDate : dueDateFor(coversFrom, plan.dueDayOfMonth),
      listAmount: price,
    });
  }

  const termEnd = periodEndKey(startDate, plan.periodMonths);
  return {
    startDate,
    endDate: plan.billingType === 'FIXED_TERM' ? termEnd : null,
    currentPeriodEnd: termEnd,
    installments,
  };
}

// Próxima cuota de un plan RECURRING, a partir del fin del período en curso.
export function buildRenewalInstallment(
  plan: Pick<PlanScheduleInput, 'periodMonths' | 'dueDayOfMonth'>,
  currentPeriodEnd: string,
  nextSequence: number,
  listAmount: number
): ScheduledInstallment {
  const coversFrom = addDaysKey(currentPeriodEnd, 1);
  return {
    sequence: nextSequence,
    kind: 'PERIOD',
    coversFrom,
    coversTo: periodEndKey(coversFrom, plan.periodMonths),
    dueDate: dueDateFor(coversFrom, plan.dueDayOfMonth),
    listAmount: roundMoney(listAmount),
  };
}

export type InstallmentState = {
  sequence: number;
  kind: InstallmentKind;
  coversFrom: string;
  coversTo: string;
  dueDate: string;
  status: InstallmentStatus;
};

// Último día cubierto por cuotas de período pagas y consecutivas desde el inicio.
// null si la primera cuota de período no está paga.
export function paidThroughKey(installments: InstallmentState[]): string | null {
  const periods = installments
    .filter((row) => row.kind === 'PERIOD' && row.status !== 'VOID')
    .sort((a, b) => a.sequence - b.sequence);
  let paidThrough: string | null = null;
  for (const row of periods) {
    if (row.status !== 'PAID') break;
    paidThrough = row.coversTo;
  }
  return paidThrough;
}

export function isInstallmentOverdue(row: Pick<InstallmentState, 'status' | 'dueDate'>, todayKey: string, graceDays: number): boolean {
  if (row.status !== 'PENDING') return false;
  return addDaysKey(row.dueDate, Math.max(0, graceDays)) < todayKey;
}

export function hasOverdueInstallments(rows: InstallmentState[], todayKey: string, graceDays: number): boolean {
  return rows.some((row) => isInstallmentOverdue(row, todayKey, graceDays));
}

// "Al día hasta" de un socio por un plan: lo cubierto por cuotas pagas más los días de gracia.
// Si no hay nada pago, el día anterior al inicio (no vigente).
export function memberValidUntilFromSubscription(input: {
  startDate: string;
  graceDays: number;
  installments: InstallmentState[];
}): string {
  const paidThrough = paidThroughKey(input.installments);
  if (!paidThrough) return addDaysKey(input.startDate, -1);
  return addDaysKey(paidThrough, Math.max(0, input.graceDays));
}
