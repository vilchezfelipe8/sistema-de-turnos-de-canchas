import 'dotenv/config';
import { MembershipRole, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';

const prisma = new PrismaClient();
const slug = 'club-atletico-barrio-parque';
const adminEmail = 'admin@barrioparque.com';

const products = [
  { name: 'Agua 500ml', price: 1800, stock: 50, category: 'Bebidas' },
  { name: 'Gatorade', price: 3000, stock: 40, category: 'Bebidas' },
  { name: 'Coca-Cola 500ml', price: 2500, stock: 40, category: 'Bebidas' },
  { name: 'Pelotas de Tenis (tubo x3)', price: 8500, stock: 25, category: 'Insumos' },
  { name: 'Grip over', price: 6000, stock: 30, category: 'Insumos' },
  { name: 'Muñequera', price: 4500, stock: 15, category: 'Insumos' },
  { name: 'Alquiler de raqueta', price: 5000, stock: 8, category: 'Alquiler' }
];

async function main() {
  if (process.env.ALLOW_BOOTSTRAP_BARRIO_PARQUE !== 'true') {
    throw new Error('Definí ALLOW_BOOTSTRAP_BARRIO_PARQUE=true para ejecutar el bootstrap.');
  }
  const password = process.env.BOOTSTRAP_BARRIO_PARQUE_ADMIN_PASSWORD || '';
  if (password.length < 16) {
    throw new Error('BOOTSTRAP_BARRIO_PARQUE_ADMIN_PASSWORD debe tener al menos 16 caracteres.');
  }
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionAdvisoryLock(tx, 'bootstrap:barrio-parque');
    const location = await tx.location.upsert({
      where: { city_province_country: { city: 'Córdoba', province: 'Córdoba', country: 'Argentina' } },
      update: {},
      create: { city: 'Córdoba', province: 'Córdoba', country: 'Argentina' }
    });
    const club = await tx.club.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: 'Club Atlético Barrio Parque',
        addressLine: 'Lagunilla 2227',
        city: 'Córdoba',
        province: 'Córdoba',
        country: 'Argentina',
        locationId: location.id,
        contactInfo: 'contacto@barrioparque.com',
        phone: '+54 9 3571 538801',
        instagramUrl: 'https://www.instagram.com/clubatleticobarrioparque/',
        description: 'Club de tenis'
      }
    });
    await tx.clubSettings.upsert({
      where: { clubId: club.id },
      update: {},
      create: {
        clubId: club.id,
        timeZone: 'America/Argentina/Cordoba',
        openingDays: [1, 2, 3, 4, 5, 6],
        lightsEnabled: true,
        lightsExtraAmount: 5000,
        lightsFromHour: '20:00',
        bookingSimpleAdvanceDaysUser: 30,
        bookingSimpleAdvanceDaysAdmin: 30,
        allowAdminSkipSimpleAdvanceLimit: false,
        onlineCheckoutEnabled: false
      }
    });
    const admin = await tx.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password: passwordHash,
        firstName: 'Admin',
        lastName: 'Barrio Parque',
        phoneNumber: '000-000002',
        role: Role.ADMIN
      }
    });
    await tx.membership.upsert({
      where: { userId_clubId: { userId: admin.id, clubId: club.id } },
      update: { role: MembershipRole.OWNER },
      create: { userId: admin.id, clubId: club.id, role: MembershipRole.OWNER }
    });

    const existingActivity = await tx.activityType.findFirst({ where: { clubId: club.id, name: 'Tenis' } });
    const activity = existingActivity || await tx.activityType.create({
      data: { clubId: club.id, name: 'Tenis', description: 'Deporte de raqueta', defaultDurationMinutes: 90 }
    });
    for (let number = 1; number <= 4; number += 1) {
      const name = `Cancha ${number}`;
      if (!await tx.court.findFirst({ where: { clubId: club.id, name } })) {
        await tx.court.create({
          data: {
            clubId: club.id,
            name,
            isIndoor: number <= 2,
            surface: 'Polvo de ladrillo',
            price: 28000,
            activityTypeId: activity.id
          }
        });
      }
    }
    for (const product of products) {
      if (!await tx.product.findFirst({ where: { clubId: club.id, name: product.name } })) {
        await tx.product.create({ data: { ...product, clubId: club.id } });
      }
    }
    await tx.cashRegister.upsert({
      where: { clubId_name: { clubId: club.id, name: 'Caja Principal' } },
      update: {},
      create: { clubId: club.id, name: 'Caja Principal' }
    });
    return { clubId: club.id, slug: club.slug, adminEmail };
  }, { timeout: 30_000 });
  console.log('Bootstrap Barrio Parque completado:', result);
  console.log('No se modifican contraseñas, stock ni configuración preexistentes al repetirlo.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
