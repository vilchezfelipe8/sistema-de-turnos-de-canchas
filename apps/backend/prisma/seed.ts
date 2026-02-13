/// <reference types="node" />
import { PrismaClient, Role } from '@prisma/client'; 
import bcrypt from 'bcryptjs';
import process from 'process';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

async function main() {
  console.log('🌱 Iniciando carga de datos de prueba...');

  // 1. Actividad (Aquí SÍ dejamos el ID fijo porque actúa como un catálogo fijo)
  const padel = await prisma.activityType.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1, 
      name: 'Pádel',
      description: 'Deporte de paleta',
      defaultDurationMinutes: 90
    },
  });
  console.log('✅ Actividad creada: Pádel');

  const tenis = await prisma.activityType.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'Tenis',
      description: 'Deporte de raqueta',
      defaultDurationMinutes: 90
    }
  });
  console.log('✅ Actividad creada: Tenis');

  const futbol = await prisma.activityType.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      name: 'Fútbol',
      description: 'Deporte de equipo',
      defaultDurationMinutes: 60
    }
  });
  console.log('✅ Actividad creada: Fútbol');

  // 2. Ubicaciones
  const locationRíoTercero = await prismaAny.location.upsert({
    where: { city_province_country: { city: 'Río Tercero', province: 'Córdoba', country: 'Argentina' } },
    update: {},
    create: { city: 'Río Tercero', province: 'Córdoba', country: 'Argentina' }
  });

  const locationCaba = await prismaAny.location.upsert({
    where: { city_province_country: { city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina' } },
    update: {},
    create: { city: 'Ciudad Autónoma de Buenos Aires', province: 'Buenos Aires', country: 'Argentina' }
  });

  // 3. Clubes (Múltiples clubes para demostrar funcionalidad multi-club)
  const club1 = await prismaAny.club.upsert({
    where: { slug: 'las-tejas' },
    update: {
      name: 'Las Tejas Pádel',
      addressLine: 'Sarmiento 60',
      city: 'Río Tercero',
      province: 'Córdoba',
      country: 'Argentina',
      locationId: locationRíoTercero.id,
      contactInfo: 'contacto@lastejas.com',
      phone: '+54 9 357 135 9791',
      logoUrl: '/logo1.svg',
      instagramUrl: 'https://www.instagram.com/lastejaspadel/',
      description: 'Complejo deportivo Las Tejas Pádel'
    },
    create: {
      slug: 'las-tejas',
      name: 'Las Tejas Pádel',
      addressLine: 'Sarmiento 60',
      city: 'Río Tercero',
      province: 'Córdoba',
      country: 'Argentina',
      locationId: locationRíoTercero.id,
      contactInfo: 'contacto@lastejas.com',
      phone: '+54 9 357 135 9791',
      logoUrl: '/logo1.svg',
      instagramUrl: 'https://www.instagram.com/lastejaspadel/',
      description: 'Complejo deportivo Las Tejas Pádel'
    }
  });
  console.log(`✅ Club creado: ${club1.name} (ID: ${club1.id}, Slug: ${club1.slug})`);

  const club2 = await prismaAny.club.upsert({
    where: { slug: 'club-central' },
    update: {
      name: 'Club Deportivo Central',
      addressLine: 'Av. Siempre Viva 742',
      city: 'Ciudad Autónoma de Buenos Aires',
      province: 'Buenos Aires',
      country: 'Argentina',
      locationId: locationCaba.id,
      contactInfo: 'contacto@clubcentral.com',
      phone: '+54 9 11 1234 5678',
      description: 'Club deportivo con múltiples canchas'
    },
    create: {
      slug: 'club-central',
      name: 'Club Deportivo Central',
      addressLine: 'Av. Siempre Viva 742',
      city: 'Ciudad Autónoma de Buenos Aires',
      province: 'Buenos Aires',
      country: 'Argentina',
      locationId: locationCaba.id,
      contactInfo: 'contacto@clubcentral.com',
      phone: '+54 9 11 1234 5678',
      description: 'Club deportivo con múltiples canchas'
    }
  });
  console.log(`✅ Club creado: ${club2.name} (ID: ${club2.id}, Slug: ${club2.slug})`);

  // 3. Canchas
  await prismaAny.court.create({
    data: {
      name: 'Cancha 1',
      clubId: club1.id,
      isIndoor: true,
      surface: 'Sintético',
      activityTypeId: padel.id,
      activities: { connect: { id: padel.id } }
    } as any,
  });
  console.log('✅ Cancha creada: Cancha 1 (Las Tejas)');

  await prismaAny.court.create({
    data: {
      name: 'Cancha 2',
      clubId: club1.id,
      isIndoor: false,
      surface: 'Césped',
      activityTypeId: padel.id,
      activities: { connect: { id: padel.id } }
    } as any,
  });
  console.log('✅ Cancha creada: Cancha 2 (Las Tejas)');

  await prismaAny.court.create({
    data: {
      name: 'Cancha Central',
      clubId: club2.id,
      isIndoor: true,
      surface: 'Sintético',
      activityTypeId: padel.id,
      activities: { connect: { id: padel.id } }
    } as any,
  });
  console.log('✅ Cancha creada: Cancha Central (Club Central)');

  await prismaAny.court.create({
    data: {
      name: 'Cancha Tenis 1',
      clubId: club1.id,
      isIndoor: false,
      surface: 'Polvo de ladrillo',
      activityTypeId: tenis.id,
      activities: { connect: { id: tenis.id } }
    } as any,
  });
  console.log('✅ Cancha creada: Cancha Tenis 1 (Las Tejas)');

  await prismaAny.court.create({
    data: {
      name: 'Cancha Fútbol 5',
      clubId: club2.id,
      isIndoor: false,
      surface: 'Césped sintético',
      activityTypeId: futbol.id,
      activities: { connect: { id: futbol.id } }
    } as any,
  });
  console.log('✅ Cancha creada: Cancha Fútbol 5 (Club Central)');

  // 4. Usuarios (asociados a clubes)
  const hashedPassword = await bcrypt.hash('123456', 10);
  const userEmail = 'lio@messi.com';

  // Usuario miembro SIN club asignado (como quien se registra por su cuenta)
  await prisma.user.upsert({
    where: { email: userEmail },
    update: {
      firstName: 'Lionel',
      lastName: 'Messi',
      password: hashedPassword,
      phoneNumber: '555-101010',
      role: Role.MEMBER,
      clubId: null
    },
    create: {
      firstName: 'Lionel',
      lastName: 'Messi',
      email: userEmail,
      password: hashedPassword,
      phoneNumber: '555-101010',
      role: Role.MEMBER
      // clubId no se asigna: usuarios que se registran no tienen club
    },
  });
  console.log('✅ Usuario creado o actualizado: Lionel Messi (sin club)');
  
  // Admin del club 1 (Las Tejas)
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminEmail = 'admin@lastejas.com';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      firstName: 'Admin',
      lastName: 'Las Tejas',
      password: adminPassword,
      phoneNumber: '000-000000',
      role: Role.ADMIN,
      clubId: club1.id
    },
    create: {
      firstName: 'Admin',
      lastName: 'Las Tejas',
      email: adminEmail,
      password: adminPassword,
      phoneNumber: '000-000000',
      role: Role.ADMIN,
      clubId: club1.id
    },
  });
  console.log('✅ Usuario admin creado o actualizado:', adminEmail, '(Las Tejas)');

  // Admin del club 2 (Club Central)
  const admin2Email = 'admin@clubcentral.com';
  await prisma.user.upsert({
    where: { email: admin2Email },
    update: {
      firstName: 'Admin',
      lastName: 'Central',
      password: adminPassword,
      phoneNumber: '000-000001',
      role: Role.ADMIN,
      clubId: club2.id
    },
    create: {
      firstName: 'Admin',
      lastName: 'Central',
      email: admin2Email,
      password: adminPassword,
      phoneNumber: '000-000001',
      role: Role.ADMIN,
      clubId: club2.id
    },
  });
  console.log('✅ Usuario admin creado o actualizado:', admin2Email, '(Club Central)');

  // Usuario miembro del club 2
  const user2Email = 'usuario@clubcentral.com';
  await prisma.user.upsert({
    where: { email: user2Email },
    update: {
      firstName: 'Juan',
      lastName: 'Pérez',
      password: hashedPassword,
      phoneNumber: '555-202020',
      role: Role.MEMBER,
      clubId: club2.id
    },
    create: {
      firstName: 'Juan',
      lastName: 'Pérez',
      email: user2Email,
      password: hashedPassword,
      phoneNumber: '555-202020',
      role: Role.MEMBER,
      clubId: club2.id
    },
  });
  console.log('✅ Usuario creado o actualizado: Juan Pérez (Club Central)');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

