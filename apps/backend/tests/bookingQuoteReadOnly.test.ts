import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/services/BookingService';
import { prisma } from '../src/prisma';

function buildServiceHarness() {
  const service = new BookingService(
    {} as any,
    {
      findById: async () => ({
        id: 10,
        name: 'Cancha 1',
        isUnderMaintenance: false,
        club: {
          id: 5,
          name: 'Club Demo',
          phone: '+5493511234567',
          settings: {
            timeZone: 'America/Argentina/Buenos_Aires',
            openingDays: [0, 1, 2, 3, 4, 5, 6],
            closureDates: [],
            professorDurationOverrideEnabled: true,
            professorDurationOverrideMinutes: 60,
            allowManualConfirmationOverride: true,
            bookingConfirmationMode: 'MANUAL',
            lightsEnabled: false,
            allowAdminSkipSimpleAdvanceLimit: false,
            bookingSimpleAdvanceDaysUser: 365,
            bookingSimpleAdvanceDaysAdmin: 365
          }
        }
      })
    } as any,
    {} as any,
    {
      findById: async () => ({
        id: 20,
        name: 'Pádel',
        defaultDurationMinutes: 90,
        clubId: 5,
        scheduleMode: 'FIXED',
        scheduleOpenTime: '08:00',
        scheduleCloseTime: '23:00',
        scheduleIntervalMinutes: 90,
        scheduleWindows: [],
        scheduleDurations: [90],
        scheduleFixedSlots: [{ start: '19:00', duration: 90 }]
      })
    } as any,
    {} as any,
    {} as any
  ) as any;

  service.resolveClientProfessorStatus = async () => false;
  service.resolveActivityScheduleForDate = async () => ({
    isClosed: false,
    schedule: {
      mode: 'FIXED',
      openTime: '08:00',
      closeTime: '23:00',
      intervalMinutes: 90,
      rangeWindows: [],
      durations: [90],
      fixedSlots: [{ start: '19:00', duration: 90 }]
    }
  });
  service.pricingService = {
    calculateCourtPrice: async () => 28000
  };
  service.discountService = {
    computeDraftDiscountTx: async (_tx: any, input: any) => ({
      total: Number(input.unitPrice),
      snapshots: []
    })
  };
  service.bookingHistoryService = {
    appendBookingHistoryEntryTx: async () => {
      throw new Error('quote no debería escribir historial');
    }
  };

  return service;
}

test('quoteBookingPrice es read-only y no crea entidades aunque llegue un cliente nuevo', async () => {
  const service = buildServiceHarness();
  let clientCreateCalls = 0;
  let bookingCreateCalls = 0;
  let accountCreateCalls = 0;
  let participantCreateCalls = 0;
  let paymentCreateCalls = 0;

  const originalTransaction = (prisma as any).$transaction;
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      client: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => {
          clientCreateCalls += 1;
          throw new Error('quote no debería crear clients');
        }
      },
      booking: {
        create: async () => {
          bookingCreateCalls += 1;
          throw new Error('quote no debería crear bookings');
        }
      },
      account: {
        create: async () => {
          accountCreateCalls += 1;
          throw new Error('quote no debería crear accounts');
        }
      },
      bookingParticipant: {
        create: async () => {
          participantCreateCalls += 1;
          throw new Error('quote no debería crear participantes');
        }
      },
      payment: {
        create: async () => {
          paymentCreateCalls += 1;
          throw new Error('quote no debería crear pagos');
        }
      },
      discountPolicy: {
        findMany: async () => []
      }
    });

  try {
    const quote = await service.quoteBookingPrice({
      courtId: 10,
      activityId: 20,
      startDateTime: new Date('2026-05-20T22:00:00.000Z'),
      durationMinutes: 90,
      clientPhone: '+54 9 357 135 9791',
      clientEmail: 'nuevo@ejemplo.com',
      clientDni: '',
      allowAdminBenefits: true,
      applyDiscount: true
    });

    assert.equal(quote.listPrice, 28000);
    assert.equal(clientCreateCalls, 0);
    assert.equal(bookingCreateCalls, 0);
    assert.equal(accountCreateCalls, 0);
    assert.equal(participantCreateCalls, 0);
    assert.equal(paymentCreateCalls, 0);
  } finally {
    (prisma as any).$transaction = originalTransaction;
  }
});
