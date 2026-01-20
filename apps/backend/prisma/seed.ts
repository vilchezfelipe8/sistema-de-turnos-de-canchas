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

  // 2. Club (Quitamos el ID manual)
  // Usamos create en lugar de upsert para simplificar y dejar que el ID sea automático
  // Como hacemos reset de la base antes, no hace falta verificar si existe
  const club = await prisma.club.create({
    data: {
      name: 'Club Central',
      address: 'Av. Siempre Viva 742',
      contactInfo: 'contacto@clubcentral.com'
    },
  });
  console.log(`✅ Club creado: ${club.name} (ID: ${club.id})`);

  // 3. Cancha (Quitamos el ID manual)
  await prisma.court.create({
    data: {
      name: 'Cancha Central',
      clubId: club.id, // Usamos el ID real que generó la base de datos
      isIndoor: true,
      surface: 'Sintético'
    },
  });
  console.log('✅ Cancha creada: Cancha Central');

  // 4. Usuario (Quitamos el ID manual)

  const hashedPassword = await bcrypt.hash('123456', 10);
  const userEmail = 'lio@messi.com';

  // Usamos upsert para que el seed sea idempotente (no rompa si el email ya existe)
  await prisma.user.upsert({
    where: { email: userEmail },
    update: {
      firstName: 'Lionel',
      lastName: 'Messi',
      password: hashedPassword,
      phoneNumber: '555-101010',
      role: Role.MEMBER
    },
    create: {
      firstName: 'Lionel',
      lastName: 'Messi',
      email: userEmail,
      password: hashedPassword,
      phoneNumber: '555-101010',
      role: Role.MEMBER
    },
  });
  console.log('✅ Usuario creado o actualizado: Lionel Messi');
  
  // Admin (agregado por seed)
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminEmail = 'admin@local.test';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      firstName: 'Admin',
      lastName: 'User',
      password: adminPassword,
      phoneNumber: '000-000000',
      role: Role.ADMIN
    },
    create: {
      firstName: 'Admin',
      lastName: 'User',
      email: adminEmail,
      password: adminPassword,
      phoneNumber: '000-000000',
      role: Role.ADMIN
    },
  });
  console.log('✅ Usuario admin creado o actualizado:', adminEmail);
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

