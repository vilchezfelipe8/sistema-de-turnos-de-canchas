import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log('⏳ Iniciando data migration (ActivityType por Club + Booking.clubId)...');
  // Nota importante:
  // - La conversión de FixedBooking.startTime/endTime -> startTimeMinutes/endTimeMinutes
  //   se ejecuta en la migración SQL estructural:
  //   prisma/migrations/20260306160000_activitytype_club_refactor/migration.sql
  // - Este script solo completa/normaliza datos de soporte y chequeos post-migración.

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      UPDATE "Booking" b
      SET "clubId" = c."clubId"
      FROM "Court" c
      WHERE b."courtId" = c."id"
        AND b."clubId" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType" at
      SET "clubId" = c."clubId"
      FROM "Court" c
      WHERE c."activityTypeId" = at."id"
        AND at."clubId" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType" at
      SET "clubId" = c."clubId"
      FROM "Booking" b
      JOIN "Court" c ON c."id" = b."courtId"
      WHERE b."activityId" = at."id"
        AND at."clubId" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType"
      SET "clubId" = (SELECT "id" FROM "Club" ORDER BY "id" ASC LIMIT 1)
      WHERE "clubId" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType"
      SET "scheduleMode" = COALESCE("scheduleMode", 'FIXED'::"ScheduleMode");
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType"
      SET "scheduleDurations" = to_json(ARRAY["defaultDurationMinutes"])
      WHERE "scheduleDurations" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "ActivityType"
      SET "scheduleFixedSlots" = json_build_array(json_build_object('start', '08:00', 'duration', "defaultDurationMinutes"))
      WHERE "scheduleMode" = 'FIXED'::"ScheduleMode"
        AND "scheduleFixedSlots" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "FixedBooking"
      SET "status" = 'ACTIVE'::"FixedBookingStatus"
      WHERE "status" IS NULL;
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "Club"
      SET "openingDays" = NULL
      WHERE "openingDays" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_array_elements_text(to_json("openingDays")) v
          WHERE (v::INT < 0 OR v::INT > 6)
        );
    `);
  });

  const [bookingsWithoutClub, activitiesWithoutClub, fixedWithoutStatus] = await Promise.all([
    prisma.booking.count({ where: { clubId: null as any } as any }),
    prisma.activityType.count({ where: { clubId: null as any } as any }),
    prisma.fixedBooking.count({ where: { status: null as any } as any })
  ]);

  console.log('✅ Data migration finalizada');
  console.log(`- Bookings sin clubId: ${bookingsWithoutClub}`);
  console.log(`- ActivityTypes sin clubId: ${activitiesWithoutClub}`);
  console.log(`- FixedBookings sin status: ${fixedWithoutStatus}`);
}

run()
  .catch((error) => {
    console.error('❌ Error en data migration:', error);
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
