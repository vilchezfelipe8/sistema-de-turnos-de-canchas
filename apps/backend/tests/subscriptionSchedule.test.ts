import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsKey,
  buildInitialSchedule,
  buildRenewalInstallment,
  dueDateFor,
  isInstallmentOverdue,
  memberValidUntilFromSubscription,
  paidThroughKey,
  periodEndKey,
  validatePlanOptionShape,
  InstallmentState,
} from '../src/domain/subscriptionSchedule';

test('suma meses respetando fin de mes', () => {
  assert.equal(addMonthsKey('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsKey('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonthsKey('2026-11-15', 3), '2027-02-15');
  assert.equal(periodEndKey('2026-11-05', 1), '2026-12-04');
  assert.equal(periodEndKey('2026-11-05', 6), '2027-05-04');
});

test('vencimiento con día fijo nunca antes del inicio de la cuota', () => {
  assert.equal(dueDateFor('2026-12-05', null), '2026-12-05');
  assert.equal(dueDateFor('2026-12-05', 10), '2026-12-10');
  assert.equal(dueDateFor('2026-12-20', 10), '2026-12-20');
});

test('Full Pass trimestral en 3 cuotas (PadFit): una por mes, la primera al alta', () => {
  const schedule = buildInitialSchedule(
    { billingType: 'FIXED_TERM', periodMonths: 3, enrollmentFee: null, dueDayOfMonth: 10 },
    { installmentsCount: 3, installmentPrice: 56300 },
    '2026-11-05'
  );
  assert.equal(schedule.endDate, '2027-02-04');
  assert.equal(schedule.currentPeriodEnd, '2027-02-04');
  assert.deepEqual(
    schedule.installments.map((row) => [row.sequence, row.coversFrom, row.coversTo, row.dueDate, row.listAmount]),
    [
      [1, '2026-11-05', '2026-12-04', '2026-11-05', 56300],
      [2, '2026-12-05', '2027-01-04', '2026-12-10', 56300],
      [3, '2027-01-05', '2027-02-04', '2027-01-10', 56300],
    ]
  );
});

test('Full Pass trimestral en 1 pago cubre los 3 meses', () => {
  const schedule = buildInitialSchedule(
    { billingType: 'FIXED_TERM', periodMonths: 3, enrollmentFee: null, dueDayOfMonth: null },
    { installmentsCount: 1, installmentPrice: 152500 },
    '2026-11-05'
  );
  assert.equal(schedule.installments.length, 1);
  assert.equal(schedule.installments[0].coversTo, '2027-02-04');
  assert.equal(schedule.installments[0].listAmount, 152500);
});

test('mensual recurrente con matrícula: matrícula + primer período', () => {
  const schedule = buildInitialSchedule(
    { billingType: 'RECURRING', periodMonths: 1, enrollmentFee: 10000, dueDayOfMonth: null },
    { installmentsCount: 1, installmentPrice: 68750 },
    '2026-11-05'
  );
  assert.equal(schedule.endDate, null);
  assert.equal(schedule.currentPeriodEnd, '2026-12-04');
  assert.deepEqual(
    schedule.installments.map((row) => [row.sequence, row.kind, row.listAmount]),
    [
      [0, 'ENROLLMENT_FEE', 10000],
      [1, 'PERIOD', 68750],
    ]
  );
  const renewal = buildRenewalInstallment({ periodMonths: 1, dueDayOfMonth: null }, schedule.currentPeriodEnd, 2, 70000);
  assert.deepEqual(
    [renewal.sequence, renewal.coversFrom, renewal.coversTo, renewal.dueDate, renewal.listAmount],
    [2, '2026-12-05', '2027-01-04', '2026-12-05', 70000]
  );
});

test('rechaza formas de pago que no cierran con el plan', () => {
  assert.match(String(validatePlanOptionShape({ billingType: 'RECURRING', periodMonths: 1 }, { installmentsCount: 3, installmentPrice: 1 })), /1 cuota/);
  assert.match(String(validatePlanOptionShape({ billingType: 'FIXED_TERM', periodMonths: 6 }, { installmentsCount: 4, installmentPrice: 1 })), /dividir/);
  assert.match(String(validatePlanOptionShape({ billingType: 'FIXED_TERM', periodMonths: 3 }, { installmentsCount: 3, installmentPrice: 0 })), /mayor a 0/);
  assert.equal(validatePlanOptionShape({ billingType: 'FIXED_TERM', periodMonths: 6 }, { installmentsCount: 3, installmentPrice: 1 }), null);
});

const rows = (statuses: Array<'PENDING' | 'PAID' | 'VOID'>): InstallmentState[] => [
  { sequence: 0, kind: 'ENROLLMENT_FEE', coversFrom: '2026-11-05', coversTo: '2026-11-05', dueDate: '2026-11-05', status: 'PAID' },
  { sequence: 1, kind: 'PERIOD', coversFrom: '2026-11-05', coversTo: '2026-12-04', dueDate: '2026-11-05', status: statuses[0] },
  { sequence: 2, kind: 'PERIOD', coversFrom: '2026-12-05', coversTo: '2027-01-04', dueDate: '2026-12-10', status: statuses[1] },
  { sequence: 3, kind: 'PERIOD', coversFrom: '2027-01-05', coversTo: '2027-02-04', dueDate: '2027-01-10', status: statuses[2] },
];

test('al día hasta: solo cuotas pagas consecutivas, más gracia', () => {
  assert.equal(paidThroughKey(rows(['PENDING', 'PENDING', 'PENDING'])), null);
  assert.equal(paidThroughKey(rows(['PAID', 'PENDING', 'PAID'])), '2026-12-04');
  assert.equal(paidThroughKey(rows(['PAID', 'PAID', 'PAID'])), '2027-02-04');
  assert.equal(
    memberValidUntilFromSubscription({ startDate: '2026-11-05', graceDays: 5, installments: rows(['PAID', 'PENDING', 'PENDING']) }),
    '2026-12-09'
  );
  assert.equal(
    memberValidUntilFromSubscription({ startDate: '2026-11-05', graceDays: 5, installments: rows(['PENDING', 'PENDING', 'PENDING']) }),
    '2026-11-04'
  );
});

test('mora: cuota pendiente pasada la gracia', () => {
  const due = { status: 'PENDING' as const, dueDate: '2026-12-10' };
  assert.equal(isInstallmentOverdue(due, '2026-12-15', 5), false);
  assert.equal(isInstallmentOverdue(due, '2026-12-16', 5), true);
  assert.equal(isInstallmentOverdue({ ...due, status: 'PAID' }, '2027-01-30', 5), false);
});
