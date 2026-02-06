/// <reference types="node" />
import { PrismaClient, Role } from '@prisma/client'; 
import bcrypt from 'bcryptjs';
import process from 'process';

const prisma = new PrismaClient();

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

  // 2. Clubes (Múltiples clubes para demostrar funcionalidad multi-club)
  const club1 = await prisma.club.create({
    data: {
      slug: 'las-tejas',
      name: 'Las Tejas Pádel',
      address: 'Sarmiento 60, Río Tercero, Córdoba',
      contactInfo: 'contacto@lastejas.com',
      phone: '+54 9 357 135 9791',
      logoUrl: '/logo1.svg',
      instagramUrl: 'https://www.instagram.com/lastejaspadel/',
      description: 'Complejo deportivo Las Tejas Pádel'
    },
  });
  console.log(`✅ Club creado: ${club1.name} (ID: ${club1.id}, Slug: ${club1.slug})`);

  const club2 = await prisma.club.create({
    data: {
      slug: 'club-central',
      name: 'Club Deportivo Central',
      address: 'Av. Siempre Viva 742',
      contactInfo: 'contacto@clubcentral.com',
      phone: '+54 9 11 1234 5678',
      description: 'Club deportivo con múltiples canchas'
    },
  });
  console.log(`✅ Club creado: ${club2.name} (ID: ${club2.id}, Slug: ${club2.slug})`);

  // 3. Canchas
  await prisma.court.create({
    data: {
      name: 'Cancha 1',
      clubId: club1.id,
      isIndoor: true,
      surface: 'Sintético',
      activities: { connect: { id: padel.id } }
    },
  });
  console.log('✅ Cancha creada: Cancha 1 (Las Tejas)');

  await prisma.court.create({
    data: {
      name: 'Cancha 2',
      clubId: club1.id,
      isIndoor: false,
      surface: 'Césped',
      activities: { connect: { id: padel.id } }
    },
  });
  console.log('✅ Cancha creada: Cancha 2 (Las Tejas)');

  await prisma.court.create({
    data: {
      name: 'Cancha Central',
      clubId: club2.id,
      isIndoor: true,
      surface: 'Sintético',
      activities: { connect: { id: padel.id } }
    },
  });
  console.log('✅ Cancha creada: Cancha Central (Club Central)');

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

