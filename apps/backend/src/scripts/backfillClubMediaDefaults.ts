import { prisma } from '../prisma';

type ClubMediaDefaults = {
  logoUrl: string;
  clubImageUrl: string;
};

const CLUB_MEDIA_BY_SLUG: Record<string, ClubMediaDefaults> = {
  'las-tejas': {
    logoUrl: '/clubs/logo-las-tejas.svg',
    clubImageUrl: '/clubs/las-tejas.jpg'
  },
  'club-central': {
    logoUrl: '/clubs/logo-club-central.svg',
    clubImageUrl: '/clubs/club-central.webp'
  },
  'madrid-padel-center': {
    logoUrl: '/clubs/logo-madrid-padel.svg',
    clubImageUrl: '/clubs/madrid-padel-center.png'
  }
};

const FALLBACK_IMAGES = [
  '/clubs/las-tejas.jpg',
  '/clubs/club-central.webp',
  '/clubs/madrid-padel-center.png'
];

async function main() {
  const clubs = await prisma.club.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      clubImageUrl: true
    }
  });

  if (!clubs.length) {
    console.log('No hay clubes para actualizar.');
    return;
  }

  let updatedCount = 0;

  for (const club of clubs) {
    const mapped = CLUB_MEDIA_BY_SLUG[club.slug];
    const desiredLogo = mapped?.logoUrl ?? club.logoUrl ?? null;
    const desiredImage =
      mapped?.clubImageUrl ??
      club.clubImageUrl ??
      FALLBACK_IMAGES[Math.abs(club.id) % FALLBACK_IMAGES.length];

    const shouldUpdate =
      (club.logoUrl ?? null) !== desiredLogo ||
      (club.clubImageUrl ?? null) !== desiredImage;

    if (!shouldUpdate) {
      continue;
    }

    await prisma.club.update({
      where: { id: club.id },
      data: {
        logoUrl: desiredLogo,
        clubImageUrl: desiredImage
      }
    });

    updatedCount += 1;
    console.log(`Actualizado club ${club.id} (${club.slug}): logo=${desiredLogo}, image=${desiredImage}`);
  }

  console.log(`Listo. Clubes actualizados: ${updatedCount}/${clubs.length}`);
}

main()
  .catch((error) => {
    console.error('Error al backfillear medios de clubes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
