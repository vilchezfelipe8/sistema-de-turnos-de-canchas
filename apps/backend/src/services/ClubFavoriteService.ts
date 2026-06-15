import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ErrorCodes, conflict, notFound } from '../errors';

const isMissingFavoritesTableError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2021' &&
  String((error.meta as any)?.table || '').includes('ClubFavorite');
const missingFavoritesTableMessage =
  'Favoritos no disponibles temporalmente. Faltan migraciones de base de datos.';

export class ClubFavoriteService {
  private hasFavoritesDelegate() {
    return Boolean((prisma as any)?.clubFavorite);
  }
  private async listFavoritesRaw(userId: number) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        f."id" AS "favoriteId",
        f."clubId" AS "clubId",
        f."userId" AS "userId",
        f."createdAt" AS "createdAt",
        c."id" AS "c_id",
        c."slug" AS "c_slug",
        c."name" AS "c_name",
        c."addressLine" AS "c_addressLine",
        c."city" AS "c_city",
        c."province" AS "c_province",
        c."country" AS "c_country",
        c."contactInfo" AS "c_contactInfo",
        c."phone" AS "c_phone",
        c."logoUrl" AS "c_logoUrl",
        c."clubImageUrl" AS "c_clubImageUrl",
        c."instagramUrl" AS "c_instagramUrl",
        c."facebookUrl" AS "c_facebookUrl",
        c."websiteUrl" AS "c_websiteUrl",
        c."description" AS "c_description"
      FROM "ClubFavorite" f
      INNER JOIN "Club" c ON c."id" = f."clubId"
      WHERE f."userId" = ${userId}
      ORDER BY f."createdAt" DESC
    `;

    return rows.map((row: any) => ({
      id: String(row.favoriteId),
      clubId: Number(row.clubId),
      userId: Number(row.userId),
      createdAt: row.createdAt,
      club: {
        id: Number(row.c_id),
        slug: String(row.c_slug || ''),
        name: String(row.c_name || ''),
        addressLine: String(row.c_addressLine || ''),
        city: String(row.c_city || ''),
        province: String(row.c_province || ''),
        country: String(row.c_country || ''),
        contactInfo: String(row.c_contactInfo || ''),
        phone: row.c_phone ?? null,
        logoUrl: row.c_logoUrl ?? null,
        clubImageUrl: row.c_clubImageUrl ?? null,
        instagramUrl: row.c_instagramUrl ?? null,
        facebookUrl: row.c_facebookUrl ?? null,
        websiteUrl: row.c_websiteUrl ?? null,
        description: row.c_description ?? null
      }
    }));
  }

  private async removeFavoriteRaw(userId: number, clubId: number) {
    await prisma.$executeRaw`
      DELETE FROM "ClubFavorite"
      WHERE "userId" = ${userId} AND "clubId" = ${clubId}
    `;
  }

  private async markFavoriteRaw(userId: number, clubId: number) {
    const clubRows = await prisma.$queryRaw<any[]>`
      SELECT "id" FROM "Club" WHERE "id" = ${clubId} LIMIT 1
    `;
    if (!Array.isArray(clubRows) || clubRows.length === 0) {
      throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);
    }

    const favoriteId =
      typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function'
        ? String((crypto as any).randomUUID())
        : `fav_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await prisma.$executeRaw`
      INSERT INTO "ClubFavorite" ("id", "clubId", "userId", "createdAt")
      VALUES (${favoriteId}, ${clubId}, ${userId}, NOW())
      ON CONFLICT ("clubId","userId") DO NOTHING
    `;

    const favoriteRows = await prisma.$queryRaw<any[]>`
      SELECT "id", "clubId", "userId", "createdAt"
      FROM "ClubFavorite"
      WHERE "clubId" = ${clubId} AND "userId" = ${userId}
      LIMIT 1
    `;
    const favorite = favoriteRows?.[0];
    if (!favorite) {
      throw conflict('No se pudo marcar favorito', ErrorCodes.CONFLICT);
    }

    return {
      favorite: {
        id: String(favorite.id),
        clubId: Number(favorite.clubId),
        userId: Number(favorite.userId),
        createdAt: favorite.createdAt
      }
    };
  }

  async listFavorites(userId: number) {
    try {
      if (!this.hasFavoritesDelegate()) {
        return this.listFavoritesRaw(userId);
      }
      const favorites = await prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        if (!txAny?.clubFavorite?.findMany) return [];
        return txAny.clubFavorite.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          include: {
            club: true
          }
        });
      });

      return favorites.map((favorite: any) => ({
        id: favorite.id,
        clubId: Number(favorite.clubId),
        userId: Number(favorite.userId),
        createdAt: favorite.createdAt,
        club: favorite.club
      }));
    } catch (error) {
      if (isMissingFavoritesTableError(error)) throw conflict(missingFavoritesTableMessage, ErrorCodes.CLUB_CONFIG_INVALID);
      throw error;
    }
  }

  async removeFavorite(userId: number, clubId: number) {
    try {
      if (!this.hasFavoritesDelegate()) {
        await this.removeFavoriteRaw(userId, clubId);
        return { removed: true };
      }
      await prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        if (!txAny?.clubFavorite?.deleteMany) return;
        await txAny.clubFavorite.deleteMany({
          where: { userId, clubId }
        });
      });
      return { removed: true };
    } catch (error) {
      if (isMissingFavoritesTableError(error)) throw conflict(missingFavoritesTableMessage, ErrorCodes.CLUB_CONFIG_INVALID);
      throw error;
    }
  }

  async markFavorite(userId: number, clubId: number) {
    try {
      if (!this.hasFavoritesDelegate()) {
        return this.markFavoriteRaw(userId, clubId);
      }
      return prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        const club = await tx.club.findUnique({
          where: { id: clubId },
          select: { id: true }
        });
        if (!club?.id) {
          throw notFound('Club no encontrado', ErrorCodes.CLUB_NOT_FOUND);
        }

        if (!txAny?.clubFavorite?.upsert) {
          return {
            favorite: {
              id: `unavailable-${clubId}-${userId}`,
              clubId,
              userId,
              createdAt: new Date()
            }
          };
        }

        const favorite = await txAny.clubFavorite.upsert({
          where: {
            clubId_userId: {
              clubId,
              userId
            }
          },
          update: {},
          create: {
            clubId,
            userId
          }
        });

        return {
          favorite: {
            id: favorite.id,
            clubId: Number(favorite.clubId),
            userId: Number(favorite.userId),
            createdAt: favorite.createdAt
          }
        };
      });
    } catch (error) {
      if (isMissingFavoritesTableError(error)) throw conflict(missingFavoritesTableMessage, ErrorCodes.CLUB_CONFIG_INVALID);
      throw error;
    }
  }
}
