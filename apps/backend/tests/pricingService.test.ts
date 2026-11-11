import test from 'node:test';
import assert from 'node:assert/strict';
import { PricingService } from '../src/services/PricingService';
import { prisma } from '../src/prisma';

const TZ = 'America/Argentina/Buenos_Aires';
// 2026-10-14 es miércoles (dayOfWeek 3). 22:00 UTC = 19:00 hora local (UTC-3).
const AT_19_LOCAL = new Date('2026-10-14T22:00:00.000Z');
const AT_17_LOCAL = new Date('2026-10-14T20:00:00.000Z');

const LIGHTS = { lightsEnabled: true, lightsExtraAmount: 4000, lightsFromHour: '19:00' };

async function withCourtMocks(
  mocks: { courtPrice: number; rulePrice?: number | null },
  fn: () => Promise<void>
) {
  const originalCourt = (prisma as any).court;
  const originalRule = (prisma as any).courtPriceRule;
  (prisma as any).court = {
    findUnique: async () => ({ id: 1, price: mocks.courtPrice, club: { settings: { timeZone: TZ } } })
  };
  (prisma as any).courtPriceRule = {
    findFirst: async () => (mocks.rulePrice == null ? null : { price: mocks.rulePrice })
  };
  try {
    await fn();
  } finally {
    (prisma as any).court = originalCourt;
    (prisma as any).courtPriceRule = originalRule;
  }
}

test('adjustForDuration es proporcional a la duración de referencia', () => {
  assert.equal(PricingService.adjustForDuration(12000, 90, 60), 18000);
  assert.equal(PricingService.adjustForDuration(10000, 90, 90), 10000);
  assert.equal(PricingService.adjustForDuration(10000, 0, 60), 10000);
  assert.equal(PricingService.adjustForDuration(10000, 90, 0), 10000);
  assert.equal(PricingService.adjustForDuration(0, 90, 60), 0);
  assert.equal(PricingService.adjustForDuration(1000, 50, 60), 833.33);
});

test('computeLightsExtra aplica desde la hora configurada en hora local del club', () => {
  assert.equal(PricingService.computeLightsExtra(AT_19_LOCAL, TZ, LIGHTS), 4000);
  assert.equal(PricingService.computeLightsExtra(AT_17_LOCAL, TZ, LIGHTS), 0);
});

test('computeLightsExtra no aplica con luces desactivadas, monto inválido u hora inválida', () => {
  assert.equal(PricingService.computeLightsExtra(AT_19_LOCAL, TZ, { ...LIGHTS, lightsEnabled: false }), 0);
  assert.equal(PricingService.computeLightsExtra(AT_19_LOCAL, TZ, { ...LIGHTS, lightsExtraAmount: 0 }), 0);
  assert.equal(PricingService.computeLightsExtra(AT_19_LOCAL, TZ, { ...LIGHTS, lightsFromHour: 'xx' }), 0);
  assert.equal(PricingService.computeLightsExtra(AT_19_LOCAL, TZ, null), 0);
});

test('resolveCourtPriceBreakdown usa la regla horaria, ajusta duración y suma luces', async () => {
  await withCourtMocks({ courtPrice: 8000, rulePrice: 12000 }, async () => {
    const breakdown = await new PricingService().resolveCourtPriceBreakdown({
      courtId: 1,
      startDateTime: AT_19_LOCAL,
      effectiveDurationMinutes: 90,
      referenceDurationMinutes: 60,
      timeZone: TZ,
      lights: LIGHTS
    });
    assert.deepEqual(breakdown, {
      basePrice: 12000,
      durationAdjustedPrice: 18000,
      lightsExtra: 4000,
      listPrice: 22000
    });
  });
});

test('resolveCourtPriceBreakdown cae a Court.price si no hay regla', async () => {
  await withCourtMocks({ courtPrice: 8000, rulePrice: null }, async () => {
    const breakdown = await new PricingService().resolveCourtPriceBreakdown({
      courtId: 1,
      startDateTime: AT_17_LOCAL,
      effectiveDurationMinutes: 60,
      referenceDurationMinutes: 60,
      timeZone: TZ,
      lights: LIGHTS
    });
    assert.deepEqual(breakdown, { basePrice: 8000, durationAdjustedPrice: 8000, lightsExtra: 0, listPrice: 8000 });
  });
});

test('resolveCourtPriceBreakdown devuelve basePrice 0 sin precio configurado, sin sumar luces', async () => {
  await withCourtMocks({ courtPrice: 0, rulePrice: null }, async () => {
    const breakdown = await new PricingService().resolveCourtPriceBreakdown({
      courtId: 1,
      startDateTime: AT_19_LOCAL,
      effectiveDurationMinutes: 60,
      referenceDurationMinutes: 60,
      timeZone: TZ,
      lights: LIGHTS
    });
    assert.deepEqual(breakdown, { basePrice: 0, durationAdjustedPrice: 0, lightsExtra: 0, listPrice: 0 });
  });
});
