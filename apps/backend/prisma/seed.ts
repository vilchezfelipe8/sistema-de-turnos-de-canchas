/// <reference types="node" />
import { PrismaClient, Role, MembershipRole } from '@prisma/client'; 
import bcrypt from 'bcryptjs';
import process from 'process';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
  console.error('❌ Seed bloqueado en producción. Define ALLOW_SEED=true para ejecutarlo conscientemente.');
  process.exit(1);
}

async function ensureSchemaReady() {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "Club" LIMIT 1`;
  } catch (error: any) {
    if (
      error?.code === 'P2021' ||
      (error?.code === 'P2010' && (error?.meta?.code === '42P01' || String(error?.meta?.message || '').includes('does not exist')))
    ) {
      throw new Error('La base no tiene el esquema aplicado. Ejecutá primero: npx prisma migrate deploy');
    }
    throw error;
  }
}

async function main() {
  console.log('🌱 Iniciando carga de datos de prueba...');
  await ensureSchemaReady();

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

  const upsertClubSettings = async (club: any) => {
    await prisma.clubSettings.upsert({
      where: { clubId: club.id },
      update: {
        timeZone: club.timeZone,
        openingDays: [1, 2, 3, 4, 5, 6],
        lightsEnabled: true,
        lightsExtraAmount: 5000,
        lightsFromHour: 20,
        professorDiscountEnabled: true,
        professorDiscountPercent: 15
      },
      create: {
        clubId: club.id,
        timeZone: club.timeZone,
        openingDays: [1, 2, 3, 4, 5, 6],
        lightsEnabled: true,
        lightsExtraAmount: 5000,
        lightsFromHour: 20,
        professorDiscountEnabled: true,
        professorDiscountPercent: 15
      }
    });
  };

  await upsertClubSettings(club1);
  await upsertClubSettings(club2);
  await upsertClubSettings(club3);
  console.log('✅ ClubSettings creado/actualizado');

  // 4. Actividades por club (multi-tenant)
  const ensureActivityType = async (clubId: number, name: string, description: string, defaultDurationMinutes: number) => {
    const existing = await prisma.activityType.findFirst({
      where: { clubId, name }
    });

    if (existing) {
      return prisma.activityType.update({
        where: { id: existing.id },
        data: { description, defaultDurationMinutes }
      });
    }

    return prisma.activityType.create({
      data: { clubId, name, description, defaultDurationMinutes }
    });
  };

  const padelClub1 = await ensureActivityType(club1.id, 'Pádel', 'Deporte de paleta', 90);
  const tenisClub1 = await ensureActivityType(club1.id, 'Tenis', 'Deporte de raqueta', 90);
  const futbolClub1 = await ensureActivityType(club1.id, 'Fútbol', 'Deporte de equipo', 60);

  const padelClub2 = await ensureActivityType(club2.id, 'Pádel', 'Deporte de paleta', 90);
  const tenisClub2 = await ensureActivityType(club2.id, 'Tenis', 'Deporte de raqueta', 90);
  const futbolClub2 = await ensureActivityType(club2.id, 'Fútbol', 'Deporte de equipo', 60);

  const padelClub3 = await ensureActivityType(club3.id, 'Pádel', 'Deporte de paleta', 90);
  const tenisClub3 = await ensureActivityType(club3.id, 'Tenis', 'Deporte de raqueta', 90);
  const futbolClub3 = await ensureActivityType(club3.id, 'Fútbol', 'Deporte de equipo', 60);

  const lasTejasPadelFixedSlots = [
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
  ].map((start) => ({
    start,
    duration: 90
  }));

  await prisma.activityType.update({
    where: { id: padelClub1.id },
    data: {
      scheduleMode: 'FIXED',
      scheduleFixedSlots: lasTejasPadelFixedSlots,
      scheduleOpenTime: null,
      scheduleCloseTime: null,
      scheduleIntervalMinutes: null
    }
  });

  console.log('✅ Actividades creadas/actualizadas por club');

  // 5. Canchas (idempotente por id fijo)
  await prisma.court.upsert({
    where: { id: 101 },
    update: { name: 'Cancha 1', clubId: club1.id, isIndoor: true, surface: 'Sintético', price: 28000, activityTypeId: padelClub1.id },
    create: { id: 101, name: 'Cancha 1', clubId: club1.id, isIndoor: true, surface: 'Sintético', price: 28000, activityTypeId: padelClub1.id }
  });
  await prisma.court.upsert({
    where: { id: 102 },
    update: { name: 'Cancha 2', clubId: club1.id, isIndoor: false, surface: 'Césped', price: 28000, activityTypeId: padelClub1.id },
    create: { id: 102, name: 'Cancha 2', clubId: club1.id, isIndoor: false, surface: 'Césped', price: 28000, activityTypeId: padelClub1.id }
  });
  await prisma.court.upsert({
    where: { id: 103 },
    update: { name: 'Cancha Central', clubId: club2.id, isIndoor: true, surface: 'Sintético', price: 30000, activityTypeId: padelClub2.id },
    create: { id: 103, name: 'Cancha Central', clubId: club2.id, isIndoor: true, surface: 'Sintético', price: 30000, activityTypeId: padelClub2.id }
  });
  await prisma.court.upsert({
    where: { id: 104 },
    update: { name: 'Cancha Tenis 1', clubId: club1.id, isIndoor: false, surface: 'Polvo de ladrillo', price: 32000, activityTypeId: tenisClub1.id },
    create: { id: 104, name: 'Cancha Tenis 1', clubId: club1.id, isIndoor: false, surface: 'Polvo de ladrillo', price: 32000, activityTypeId: tenisClub1.id }
  });
  await prisma.court.upsert({
    where: { id: 105 },
    update: { name: 'Cancha Fútbol 5', clubId: club2.id, isIndoor: false, surface: 'Césped sintético', price: 35000, activityTypeId: futbolClub2.id },
    create: { id: 105, name: 'Cancha Fútbol 5', clubId: club2.id, isIndoor: false, surface: 'Césped sintético', price: 35000, activityTypeId: futbolClub2.id }
  });
  await prisma.court.upsert({
    where: { id: 106 },
    update: { name: 'Pista Central WPT', clubId: club3.id, isIndoor: true, surface: 'Sintético', price: 40000, activityTypeId: padelClub3.id },
    create: { id: 106, name: 'Pista Central WPT', clubId: club3.id, isIndoor: true, surface: 'Sintético', price: 40000, activityTypeId: padelClub3.id }
  });
  console.log('✅ Canchas creadas');

  const upsertProduct = async (clubId: number, name: string, price: number, stock: number, category: string) => {
    const existing = await prisma.product.findFirst({ where: { clubId, name } });
    if (existing) {
      return prisma.product.update({
        where: { id: existing.id },
        data: { price, stock, category, isActive: true }
      });
    }
    return prisma.product.create({
      data: { clubId, name, price, stock, category, isActive: true }
    });
  };

  await upsertProduct(club1.id, 'Gaseosa 500ml', 2500, 50, 'Bebidas');
  await upsertProduct(club1.id, 'Agua 500ml', 1800, 60, 'Bebidas');
  await upsertProduct(club1.id, 'Pelota de Pádel', 9000, 20, 'Insumos');

  await upsertProduct(club2.id, 'Gatorade', 3000, 40, 'Bebidas');
  await upsertProduct(club2.id, 'Toalla deportiva', 7000, 12, 'Insumos');

  await upsertProduct(club3.id, 'Isotónica', 3500, 35, 'Bebidas');
  await upsertProduct(club3.id, 'Grip over', 6000, 30, 'Insumos');
  console.log('✅ Productos creados/actualizados');

  // 6. Usuarios
  const hashedPassword = await bcrypt.hash('123456', 10);
  const adminPassword = await bcrypt.hash('admin123', 10);

  // Usuario Sin Club
  const lioUser = await prisma.user.upsert({
    where: { email: 'lio@messi.com' },
    update: { firstName: 'Lionel', lastName: 'Messi', password: hashedPassword, phoneNumber: '555-101010', role: Role.MEMBER },
    create: { firstName: 'Lionel', lastName: 'Messi', email: 'lio@messi.com', password: hashedPassword, phoneNumber: '555-101010', role: Role.MEMBER },
  });

  // Admin Tejas
  const adminTejas = await prisma.user.upsert({
    where: { email: 'admin@lastejas.com' },
    update: { firstName: 'Admin', lastName: 'Las Tejas', password: adminPassword, phoneNumber: '000-000000', role: Role.ADMIN },
    create: { firstName: 'Admin', lastName: 'Las Tejas', email: 'admin@lastejas.com', password: adminPassword, phoneNumber: '000-000000', role: Role.ADMIN },
  });

  // Admin Central
  const adminCentral = await prisma.user.upsert({
    where: { email: 'admin@clubcentral.com' },
    update: { firstName: 'Admin', lastName: 'Central', password: adminPassword, phoneNumber: '000-000001', role: Role.ADMIN },
    create: { firstName: 'Admin', lastName: 'Central', email: 'admin@clubcentral.com', password: adminPassword, phoneNumber: '000-000001', role: Role.ADMIN },
  });

  // Admin Madrid (¡NUEVO!)
  const adminMadrid = await prisma.user.upsert({
    where: { email: 'admin@madridpadel.es' },
    update: { firstName: 'Admin', lastName: 'Madrid', password: adminPassword, phoneNumber: '+34600000000', role: Role.ADMIN },
    create: { firstName: 'Admin', lastName: 'Madrid', email: 'admin@madridpadel.es', password: adminPassword, phoneNumber: '+34600000000', role: Role.ADMIN },
  });

  // Miembro Central
  const memberCentral = await prisma.user.upsert({
    where: { email: 'usuario@clubcentral.com' },
    update: { firstName: 'Juan', lastName: 'Pérez', password: hashedPassword, phoneNumber: '555-202020', role: Role.MEMBER },
    create: { firstName: 'Juan', lastName: 'Pérez', email: 'usuario@clubcentral.com', password: hashedPassword, phoneNumber: '555-202020', role: Role.MEMBER },
  });

  // 7. Memberships (fuente de verdad multi-club)
  const upsertMembership = async (userId: number, clubId: number, role: MembershipRole) => {
    await prisma.membership.upsert({
      where: { userId_clubId: { userId, clubId } },
      update: { role },
      create: { userId, clubId, role }
    });
  };

  await upsertMembership(adminTejas.id, club1.id, MembershipRole.OWNER);
  await upsertMembership(adminCentral.id, club2.id, MembershipRole.OWNER);
  await upsertMembership(adminMadrid.id, club3.id, MembershipRole.OWNER);
  await upsertMembership(memberCentral.id, club2.id, MembershipRole.CUSTOMER);

  // Membership opcional para pruebas cross-club
  await upsertMembership(lioUser.id, club1.id, MembershipRole.CUSTOMER);

  console.log('✅ Usuarios y memberships creados');

  const normalizePhone = (value?: string) => {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('549') && digits.length >= 12) return digits;
    if (digits.startsWith('54') && digits.length >= 12) return `549${digits.slice(2)}`;
    if (digits.length === 10) return `549${digits}`;
    if (digits.startsWith('0') && digits.length === 11) return `549${digits.slice(1)}`;
    return digits.length >= 8 ? digits : null;
  };

  const normalizeDni = (value?: string) => {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    return digits.length >= 6 ? digits : null;
  };

  const upsertClient = async (
    clubId: number,
    name: string,
    phone?: string,
    email?: string,
    dni?: string,
    userId?: number
  ) => {
    const normalizedPhone = normalizePhone(phone);
    const normalizedDni = normalizeDni(dni);
    const safeEmail = email?.trim().toLowerCase() || null;

    let existing = null;

    if (userId) {
      existing = await prismaAny.client.findFirst({ where: { clubId, userId } });
    }

    if (!existing && normalizedDni) {
      existing = await prismaAny.client.findFirst({ where: { clubId, dni: normalizedDni } });
    }

    if (!existing && normalizedPhone) {
      existing = await prismaAny.client.findFirst({ where: { clubId, phone: normalizedPhone } });
    }

    if (!existing && safeEmail) {
      existing = await prismaAny.client.findFirst({ where: { clubId, email: safeEmail } });
    }

    if (!existing) {
      existing = await prismaAny.client.findFirst({ where: { clubId, name } });
    }

    const upsertPayload = {
      name,
      phone: normalizedPhone,
      email: safeEmail,
      dni: normalizedDni,
      userId: userId ?? null
    };

    if (existing) {
      return prismaAny.client.update({
        where: { id: existing.id },
        data: upsertPayload
      });
    }

    return prismaAny.client.create({
      data: {
        clubId,
        ...upsertPayload
      }
    });
  };

  await upsertClient(club1.id, 'Lionel Messi', '555-101010', 'lio@messi.com', '30123123', lioUser.id);
  await upsertClient(club1.id, 'Cliente Mostrador Tejas', '+54 9 357 000 0001', 'cliente.tejas@example.com', '30999001');
  await upsertClient(club2.id, 'Juan Perez', '555-202020', 'usuario@clubcentral.com', '30999002', memberCentral.id);
  await upsertClient(club2.id, 'Cliente Mostrador Central', '+54 9 11 0000 0002', 'cliente.central@example.com', '30999003');
  await upsertClient(club3.id, 'Cliente Mostrador Madrid', '+34 600 111 222', 'cliente.madrid@example.com', '30999004');
  console.log('✅ Clientes creados/actualizados');

  const upsertCashRegister = async (clubId: number) => {
    return prisma.cashRegister.upsert({
      where: { clubId_name: { clubId, name: 'Caja Principal' } },
      update: {},
      create: {
        clubId,
        name: 'Caja Principal',
        location: 'Recepción'
      }
    });
  };

  const register1 = await upsertCashRegister(club1.id);
  const register2 = await upsertCashRegister(club2.id);
  const register3 = await upsertCashRegister(club3.id);

  const ensureOpenShift = async (cashRegisterId: string, openedByUserId: number) => {
    const openShift = await prisma.cashShift.findFirst({
      where: { cashRegisterId, status: 'OPEN' }
    });

    if (openShift) return openShift;

    return prisma.cashShift.create({
      data: {
        cashRegisterId,
        openedByUserId,
        openingAmount: 50000,
        status: 'OPEN'
      }
    });
  };

  await ensureOpenShift(register1.id, adminTejas.id);
  await ensureOpenShift(register2.id, adminCentral.id);
  await ensureOpenShift(register3.id, adminMadrid.id);
  console.log('✅ Caja principal y turnos de caja abiertos');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });