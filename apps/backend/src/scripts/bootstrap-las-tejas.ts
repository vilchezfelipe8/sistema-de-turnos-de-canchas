/// <reference types="node" />
import {
  BookingConfirmationMode,
  ClubOperationalStatus,
  MembershipRole,
  PrismaClient,
  Role,
  ScheduleMode
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import process from 'process';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';

const prisma = new PrismaClient();

const CLUB_SLUG = 'las-tejas';
const ADMIN_EMAIL = 'admin@lastejas.com';
const REQUIRED_FLAG = 'ALLOW_BOOTSTRAP_LAS_TEJAS';
const REQUIRED_PASSWORD_ENV = 'BOOTSTRAP_LAS_TEJAS_ADMIN_PASSWORD';
const DEFAULT_TIME_ZONE = 'America/Argentina/Cordoba';

const FIXED_SLOTS = [
  '08:00',
  '09:30',
  '11:00',
  '12:30',
  '14:00',
  '15:30',
  '17:30',
  '19:00',
  '20:30',
  '22:00'
];

const PRODUCTS = [
  { name: 'Agua 500ml', category: 'Bebidas', price: '1800' },
  { name: 'Gaseosa 500ml', category: 'Bebidas', price: '2500' },
  { name: 'Pelota de Pádel', category: 'Insumos', price: '9000' },
  { name: 'Alquiler paleta', category: 'Alquiler', price: '7000' }
] as const;

type SummaryStatus = 'created' | 'updated' | 'found';

type Summary = {
  club: SummaryStatus;
  adminUser: SummaryStatus;
  ownerMembership: SummaryStatus;
  clubSettings: SummaryStatus;
  activityPadel: SummaryStatus;
  cancha1: SummaryStatus;
  cancha2: SummaryStatus;
  cajaPrincipal: SummaryStatus;
  products: Array<{ name: string; status: SummaryStatus }>;
};

function requireExplicitBootstrapConsent() {
  if (process.env[REQUIRED_FLAG] !== 'true') {
    throw new Error(
      `Bootstrap bloqueado. Definí ${REQUIRED_FLAG}=true para ejecutarlo conscientemente.`
    );
  }
}

function requireAdminPassword() {
  const rawPassword = String(process.env[REQUIRED_PASSWORD_ENV] || '');
  if (!rawPassword.trim()) {
    throw new Error(
      `Falta ${REQUIRED_PASSWORD_ENV}. Debe contener una contraseña temporal segura para ${ADMIN_EMAIL}.`
    );
  }
  if (rawPassword.length < 8) {
    throw new Error(
      `${REQUIRED_PASSWORD_ENV} debe tener al menos 8 caracteres.`
    );
  }
  return rawPassword;
}

async function ensureSchemaReady() {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "Club" LIMIT 1`;
  } catch (error: any) {
    if (
      error?.code === 'P2021' ||
      (error?.code === 'P2010' &&
        (error?.meta?.code === '42P01' ||
          String(error?.meta?.message || '').includes('does not exist')))
    ) {
      throw new Error(
        'La base no tiene el esquema aplicado. Ejecutá primero: npx prisma migrate deploy'
      );
    }
    throw error;
  }
}

async function main() {
  requireExplicitBootstrapConsent();
  const adminPassword = requireAdminPassword();
  await ensureSchemaReady();

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const summary: Summary = {
    club: 'found',
    adminUser: 'found',
    ownerMembership: 'found',
    clubSettings: 'found',
    activityPadel: 'found',
    cancha1: 'found',
    cancha2: 'found',
    cajaPrincipal: 'found',
    products: []
  };

  await prisma.$transaction(async (tx) => {
    await acquireTransactionAdvisoryLock(tx, 'bootstrap:las-tejas');

    const location = await tx.location.upsert({
      where: {
        city_province_country: {
          city: 'Río Tercero',
          province: 'Córdoba',
          country: 'Argentina'
        }
      },
      update: {},
      create: {
        city: 'Río Tercero',
        province: 'Córdoba',
        country: 'Argentina'
      }
    });

    const existingClub = await tx.club.findUnique({
      where: { slug: CLUB_SLUG },
      select: { id: true }
    });

    const club = await tx.club.upsert({
      where: { slug: CLUB_SLUG },
      update: {
        name: 'Las Tejas Pádel',
        addressLine: 'Sarmiento 60',
        city: 'Río Tercero',
        province: 'Córdoba',
        country: 'Argentina',
        locationId: location.id,
        contactInfo: 'contacto@lastejas.com',
        phone: '+54 9 357 135 9791',
        instagramUrl: 'https://www.instagram.com/lastejaspadel/',
        description: 'Complejo deportivo Las Tejas Pádel'
      },
      create: {
        slug: CLUB_SLUG,
        name: 'Las Tejas Pádel',
        addressLine: 'Sarmiento 60',
        city: 'Río Tercero',
        province: 'Córdoba',
        country: 'Argentina',
        locationId: location.id,
        contactInfo: 'contacto@lastejas.com',
        phone: '+54 9 357 135 9791',
        instagramUrl: 'https://www.instagram.com/lastejaspadel/',
        description: 'Complejo deportivo Las Tejas Pádel'
      }
    });
    summary.club = existingClub ? 'updated' : 'created';

    const existingUser = await tx.user.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { id: true }
    });

    const adminUser = await tx.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {
        firstName: 'Admin',
        lastName: 'Las Tejas',
        phoneNumber: '+54 9 357 135 9791',
        role: Role.ADMIN
      },
      create: {
        email: ADMIN_EMAIL,
        password: passwordHash,
        firstName: 'Admin',
        lastName: 'Las Tejas',
        phoneNumber: '+54 9 357 135 9791',
        role: Role.ADMIN
      }
    });
    summary.adminUser = existingUser ? 'updated' : 'created';

    if (existingUser) {
      console.log(
        `- Usuario ${ADMIN_EMAIL} ya existía: se conserva la contraseña actual. Para cambiarla, hacerlo luego desde la operación controlada del piloto.`
      );
    }

    const existingMembership = await tx.membership.findUnique({
      where: {
        userId_clubId: {
          userId: adminUser.id,
          clubId: club.id
        }
      },
      select: { id: true }
    });

    await tx.membership.upsert({
      where: {
        userId_clubId: {
          userId: adminUser.id,
          clubId: club.id
        }
      },
      update: { role: MembershipRole.OWNER },
      create: {
        userId: adminUser.id,
        clubId: club.id,
        role: MembershipRole.OWNER
      }
    });
    summary.ownerMembership = existingMembership ? 'updated' : 'created';

    const existingSettings = await tx.clubSettings.findUnique({
      where: { clubId: club.id },
      select: { id: true }
    });

    await tx.clubSettings.upsert({
      where: { clubId: club.id },
      update: {
        timeZone: DEFAULT_TIME_ZONE,
        openingDays: [1, 2, 3, 4, 5, 6],
        clubOperationalStatus: ClubOperationalStatus.OPEN,
        lightsEnabled: true,
        lightsExtraAmount: '5000',
        lightsFromHour: '20:00',
        bookingConfirmationMode: BookingConfirmationMode.MANUAL,
        bookingSimpleAdvanceDaysUser: 30,
        bookingSimpleAdvanceDaysAdmin: 30,
        allowAdminSkipSimpleAdvanceLimit: false
      },
      create: {
        clubId: club.id,
        timeZone: DEFAULT_TIME_ZONE,
        openingDays: [1, 2, 3, 4, 5, 6],
        clubOperationalStatus: ClubOperationalStatus.OPEN,
        lightsEnabled: true,
        lightsExtraAmount: '5000',
        lightsFromHour: '20:00',
        bookingConfirmationMode: BookingConfirmationMode.MANUAL,
        bookingSimpleAdvanceDaysUser: 30,
        bookingSimpleAdvanceDaysAdmin: 30,
        allowAdminSkipSimpleAdvanceLimit: false
      }
    });
    summary.clubSettings = existingSettings ? 'updated' : 'created';

    const existingActivity = await tx.activityType.findFirst({
      where: {
        clubId: club.id,
        name: 'Pádel'
      },
      select: { id: true }
    });

    const activity = existingActivity
      ? await tx.activityType.update({
          where: { id: existingActivity.id },
          data: {
            description: 'Actividad principal de pádel del club',
            defaultDurationMinutes: 90,
            scheduleMode: ScheduleMode.FIXED,
            scheduleOpenTime: null,
            scheduleCloseTime: null,
            scheduleIntervalMinutes: null,
            scheduleFixedSlots: FIXED_SLOTS.map((start) => ({ start, duration: 90 }))
          }
        })
      : await tx.activityType.create({
          data: {
            clubId: club.id,
            name: 'Pádel',
            description: 'Actividad principal de pádel del club',
            defaultDurationMinutes: 90,
            scheduleMode: ScheduleMode.FIXED,
            scheduleFixedSlots: FIXED_SLOTS.map((start) => ({ start, duration: 90 }))
          }
        });
    summary.activityPadel = existingActivity ? 'updated' : 'created';

    const upsertCourt = async (params: {
      name: 'Cancha 1' | 'Cancha 2';
      surface: string;
      isIndoor: boolean;
    }) => {
      const existingCourt = await tx.court.findFirst({
        where: { clubId: club.id, name: params.name },
        select: { id: true }
      });

      const court = existingCourt
        ? await tx.court.update({
            where: { id: existingCourt.id },
            data: {
              activityTypeId: activity.id,
              surface: params.surface,
              isIndoor: params.isIndoor,
              isUnderMaintenance: false,
              price: '28000'
            }
          })
        : await tx.court.create({
            data: {
              clubId: club.id,
              activityTypeId: activity.id,
              name: params.name,
              surface: params.surface,
              isIndoor: params.isIndoor,
              isUnderMaintenance: false,
              price: '28000'
            }
          });

      return {
        court,
        status: existingCourt ? 'updated' : 'created'
      } as const;
    };

    const cancha1 = await upsertCourt({
      name: 'Cancha 1',
      surface: 'Sintético',
      isIndoor: true
    });
    summary.cancha1 = cancha1.status;

    const cancha2 = await upsertCourt({
      name: 'Cancha 2',
      surface: 'Césped sintético',
      isIndoor: false
    });
    summary.cancha2 = cancha2.status;

    const existingCashRegister = await tx.cashRegister.findUnique({
      where: {
        clubId_name: {
          clubId: club.id,
          name: 'Caja Principal'
        }
      },
      select: { id: true }
    });

    await tx.cashRegister.upsert({
      where: {
        clubId_name: {
          clubId: club.id,
          name: 'Caja Principal'
        }
      },
      update: {},
      create: {
        clubId: club.id,
        name: 'Caja Principal'
      }
    });
    summary.cajaPrincipal = existingCashRegister ? 'found' : 'created';

    for (const product of PRODUCTS) {
      const existingProduct = await tx.product.findFirst({
        where: {
          clubId: club.id,
          name: product.name
        },
        select: { id: true }
      });

      if (existingProduct) {
        await tx.product.update({
          where: { id: existingProduct.id },
          data: {
            category: product.category,
            price: product.price,
            isActive: true
          }
        });
        summary.products.push({ name: product.name, status: 'updated' });
        continue;
      }

      await tx.product.create({
        data: {
          clubId: club.id,
          name: product.name,
          category: product.category,
          price: product.price,
          isActive: true
        }
      });
      summary.products.push({ name: product.name, status: 'created' });
    }
  });

  console.log('✅ Bootstrap controlado de Las Tejas listo.');
  console.log(`- Club Las Tejas: ${summary.club}`);
  console.log(`- Owner ${ADMIN_EMAIL}: ${summary.adminUser}`);
  console.log(`- Membership OWNER: ${summary.ownerMembership}`);
  console.log(`- ClubSettings: ${summary.clubSettings}`);
  console.log(`- Actividad Pádel: ${summary.activityPadel}`);
  console.log(`- Cancha 1: ${summary.cancha1}`);
  console.log(`- Cancha 2: ${summary.cancha2}`);
  for (const product of summary.products) {
    console.log(`- Producto ${product.name}: ${product.status}`);
  }
  console.log(`- Caja Principal: ${summary.cajaPrincipal}`);
  console.log('- Mercado Pago: OFF (el bootstrap no crea ni activa integraciones)');
  console.log('- WhatsApp: OFF (el bootstrap no crea sesiones ni activa workers)');
  console.log('- No se abrió ningún CashShift automáticamente.');
}

main()
  .catch((error) => {
    console.error('❌ Error en bootstrap Las Tejas:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
