/// <reference types="node" />
import { PrismaClient, Role } from '@prisma/client'; 
import bcrypt from 'bcryptjs';
import process from 'process';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
  console.error('❌ Seed bloqueado en producción. Define ALLOW_SEED=true para ejecutarlo conscientemente.');
  process.exit(1);
}

async function main() {
  console.log('🌱 Iniciando carga de datos de prueba...');

  // 1. Actividades
  const padel = await prisma.activityType.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, name: 'Pádel', description: 'Deporte de paleta', defaultDurationMinutes: 90 },
  });
  console.log('✅ Actividad: Pádel');

  const tenis = await prisma.activityType.upsert({
    where: { id: 2 }, update: {},
    create: { id: 2, name: 'Tenis', description: 'Deporte de raqueta', defaultDurationMinutes: 90 }
  });
  console.log('✅ Actividad: Tenis');

  const futbol = await prisma.activityType.upsert({
    where: { id: 3 }, update: {},
    create: { id: 3, name: 'Fútbol', description: 'Deporte de equipo', defaultDurationMinutes: 60 }
  });
  console.log('✅ Actividad: Fútbol');

  // 2. Ubicaciones (¡Agregamos Madrid!)
  const locationRíoTercero = await prismaAny.location.upsert({
    where: { city_province_country: { city: 'Río Tercero', province: 'Córdoba', country: 'Argentina' } },
    update: {}, create: { city: 'Río Tercero', province: 'Córdoba', country: 'Argentina' }
  });

  const locationCaba = await prismaAny.location.upsert({
    where: { city_province_country: { city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina' } },
    update: {}, create: { city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina' }
  });

  const locationMadrid = await prismaAny.location.upsert({
    where: { city_province_country: { city: 'Madrid', province: 'Madrid', country: 'España' } },
    update: {}, create: { city: 'Madrid', province: 'Madrid', country: 'España' }
  });

  // 3. Clubes
  const club1 = await prismaAny.club.upsert({
    where: { slug: 'las-tejas' },
    update: {
      name: 'Las Tejas Pádel', addressLine: 'Sarmiento 60', city: 'Río Tercero', province: 'Córdoba', country: 'Argentina',
      locationId: locationRíoTercero.id, contactInfo: 'contacto@lastejas.com', phone: '+54 9 357 135 9791',
      logoUrl: '/logo1.svg', instagramUrl: 'https://www.instagram.com/lastejaspadel/', description: 'Complejo deportivo Las Tejas Pádel',
      timeZone: 'America/Argentina/Buenos_Aires'
    },
    create: {
      slug: 'las-tejas', name: 'Las Tejas Pádel', addressLine: 'Sarmiento 60', city: 'Río Tercero', province: 'Córdoba', country: 'Argentina',
      locationId: locationRíoTercero.id, contactInfo: 'contacto@lastejas.com', phone: '+54 9 357 135 9791',
      logoUrl: '/logo1.svg', instagramUrl: 'https://www.instagram.com/lastejaspadel/', description: 'Complejo deportivo Las Tejas Pádel',
      timeZone: 'America/Argentina/Buenos_Aires'
    }
  });
  console.log(`✅ Club: ${club1.name}`);

  const club2 = await prismaAny.club.upsert({
    where: { slug: 'club-central' },
    update: {
      name: 'Club Deportivo Central', addressLine: 'Av. Siempre Viva 742', city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina',
      locationId: locationCaba.id, contactInfo: 'contacto@clubcentral.com', phone: '+54 9 11 1234 5678', description: 'Club deportivo con múltiples canchas',
      timeZone: 'America/Argentina/Buenos_Aires'
    },
    create: {
      slug: 'club-central', name: 'Club Deportivo Central', addressLine: 'Av. Siempre Viva 742', city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina',
      locationId: locationCaba.id, contactInfo: 'contacto@clubcentral.com', phone: '+54 9 11 1234 5678', description: 'Club deportivo con múltiples canchas',
      timeZone: 'America/Argentina/Buenos_Aires'
    }
  });
  console.log(`✅ Club: ${club2.name}`);

  // EL NUEVO CLUB INTERNACIONAL
  const club3 = await prismaAny.club.upsert({
    where: { slug: 'madrid-padel-center' },
    update: {
      name: 'Madrid Pádel Center', addressLine: 'Calle de Alcalá 500', city: 'Madrid', province: 'Madrid', country: 'España',
      locationId: locationMadrid.id, contactInfo: 'hola@madridpadel.es', phone: '+34 600 123 456', logoUrl: '/logo2.svg',
      instagramUrl: 'https://www.instagram.com/madridpadelcenter/', description: 'El mejor complejo de pádel en la capital española',
      timeZone: 'Europe/Madrid' 
    },
    create: {
      slug: 'madrid-padel-center', name: 'Madrid Pádel Center', addressLine: 'Calle de Alcalá 500', city: 'Madrid', province: 'Madrid', country: 'España',
      locationId: locationMadrid.id, contactInfo: 'hola@madridpadel.es', phone: '+34 600 123 456', logoUrl: '/logo2.svg',
      instagramUrl: 'https://www.instagram.com/madridpadelcenter/', description: 'El mejor complejo de pádel en la capital española',
      timeZone: 'Europe/Madrid'
    }
  });
  console.log(`✅ Club: ${club3.name} (TimeZone: Europe/Madrid)`);

  // 4. Canchas
  await prismaAny.court.create({ data: { name: 'Cancha 1', clubId: club1.id, isIndoor: true, surface: 'Sintético', price: 28000, activityTypeId: padel.id, activities: { connect: { id: padel.id } } } as any, });
  await prismaAny.court.create({ data: { name: 'Cancha 2', clubId: club1.id, isIndoor: false, surface: 'Césped', price: 28000, activityTypeId: padel.id, activities: { connect: { id: padel.id } } } as any, });
  await prismaAny.court.create({ data: { name: 'Cancha Central', clubId: club2.id, isIndoor: true, surface: 'Sintético', price: 30000, activityTypeId: padel.id, activities: { connect: { id: padel.id } } } as any, });
  await prismaAny.court.create({ data: { name: 'Cancha Tenis 1', clubId: club1.id, isIndoor: false, surface: 'Polvo de ladrillo', price: 32000, activityTypeId: tenis.id, activities: { connect: { id: tenis.id } } } as any, });
  await prismaAny.court.create({ data: { name: 'Cancha Fútbol 5', clubId: club2.id, isIndoor: false, surface: 'Césped sintético', price: 35000, activityTypeId: futbol.id, activities: { connect: { id: futbol.id } } } as any, });
  
  // Cancha para Madrid
  await prismaAny.court.create({ 
    data: { name: 'Pista Central WPT', clubId: club3.id, isIndoor: true, surface: 'Sintético', price: 40000, activityTypeId: padel.id, activities: { connect: { id: padel.id } } } as any, 
  });
  console.log('✅ Canchas creadas');

  // 5. Usuarios
  const hashedPassword = await bcrypt.hash('123456', 10);
  const adminPassword = await bcrypt.hash('admin123', 10);

  // Usuario Sin Club
  await prisma.user.upsert({
    where: { email: 'lio@messi.com' },
    update: { firstName: 'Lionel', lastName: 'Messi', password: hashedPassword, phoneNumber: '555-101010', role: Role.MEMBER, clubId: null },
    create: { firstName: 'Lionel', lastName: 'Messi', email: 'lio@messi.com', password: hashedPassword, phoneNumber: '555-101010', role: Role.MEMBER },
  });

  // Admin Tejas
  await prisma.user.upsert({
    where: { email: 'admin@lastejas.com' },
    update: { firstName: 'Admin', lastName: 'Las Tejas', password: adminPassword, phoneNumber: '000-000000', role: Role.ADMIN, clubId: club1.id },
    create: { firstName: 'Admin', lastName: 'Las Tejas', email: 'admin@lastejas.com', password: adminPassword, phoneNumber: '000-000000', role: Role.ADMIN, clubId: club1.id },
  });

  // Admin Central
  await prisma.user.upsert({
    where: { email: 'admin@clubcentral.com' },
    update: { firstName: 'Admin', lastName: 'Central', password: adminPassword, phoneNumber: '000-000001', role: Role.ADMIN, clubId: club2.id },
    create: { firstName: 'Admin', lastName: 'Central', email: 'admin@clubcentral.com', password: adminPassword, phoneNumber: '000-000001', role: Role.ADMIN, clubId: club2.id },
  });

  // Admin Madrid (¡NUEVO!)
  await prisma.user.upsert({
    where: { email: 'admin@madridpadel.es' },
    update: { firstName: 'Admin', lastName: 'Madrid', password: adminPassword, phoneNumber: '+34600000000', role: Role.ADMIN, clubId: club3.id },
    create: { firstName: 'Admin', lastName: 'Madrid', email: 'admin@madridpadel.es', password: adminPassword, phoneNumber: '+34600000000', role: Role.ADMIN, clubId: club3.id },
  });

  // Miembro Central
  await prisma.user.upsert({
    where: { email: 'usuario@clubcentral.com' },
    update: { firstName: 'Juan', lastName: 'Pérez', password: hashedPassword, phoneNumber: '555-202020', role: Role.MEMBER, clubId: club2.id },
    create: { firstName: 'Juan', lastName: 'Pérez', email: 'usuario@clubcentral.com', password: hashedPassword, phoneNumber: '555-202020', role: Role.MEMBER, clubId: club2.id },
  });
  console.log('✅ Usuarios creados');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });