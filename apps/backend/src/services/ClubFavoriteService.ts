import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { ClientDuplicateIncidentService } from './ClientDuplicateIncidentService';
import { recordUserClientLinkAuditTx, UserClientLinkReason } from './UserClientLinkAudit';

type LinkStatus =
  | 'already_linked'
  | 'linked_existing_client'
  | 'created_client'
  | 'duplicate_detected_no_link'
  | 'insufficient_data_no_link';

type LinkResult = {
  status: LinkStatus;
  clientId: string | null;
  reason?: 'missing_phone' | 'missing_name' | 'insufficient_identity_data';
};

const normalizeDni = (value: unknown) => String(value || '').replace(/\D/g, '');
const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const isMissingFavoritesTableError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2021' &&
  String((error.meta as any)?.table || '').includes('ClubFavorite');
const missingFavoritesTableMessage =
  'Favoritos no disponibles temporalmente. Faltan migraciones de base de datos.';

export class ClubFavoriteService {
  private readonly duplicateIncidentService = new ClientDuplicateIncidentService();
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
      throw new Error('Club no encontrado');
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
      throw new Error('No se pudo marcar favorito');
    }

    const linkResult = await this.tryLinkUserWithClientTx(prisma as any, userId, clubId);
    return {
      favorite: {
        id: String(favorite.id),
        clubId: Number(favorite.clubId),
        userId: Number(favorite.userId),
        createdAt: favorite.createdAt
      },
      linking: linkResult
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
      if (isMissingFavoritesTableError(error)) throw new Error(missingFavoritesTableMessage);
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
      if (isMissingFavoritesTableError(error)) throw new Error(missingFavoritesTableMessage);
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
          throw new Error('Club no encontrado');
        }

        if (!txAny?.clubFavorite?.upsert) {
        return {
          favorite: {
            id: `unavailable-${clubId}-${userId}`,
            clubId,
            userId,
            createdAt: new Date()
          },
          linking: { status: 'insufficient_data_no_link' as const, clientId: null, reason: 'insufficient_identity_data' as const }
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

        const linkResult = await this.tryLinkUserWithClientTx(tx as any, userId, clubId);

        return {
          favorite: {
            id: favorite.id,
            clubId: Number(favorite.clubId),
            userId: Number(favorite.userId),
            createdAt: favorite.createdAt
          },
          linking: linkResult
        };
      });
    } catch (error) {
      if (isMissingFavoritesTableError(error)) throw new Error(missingFavoritesTableMessage);
      throw error;
    }
  }

  private async tryLinkUserWithClientTx(tx: any, userId: number, clubId: number): Promise<LinkResult> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        email: true,
        dni: true
      }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    const alreadyLinked = await tx.client.findFirst({
      where: { clubId, userId },
      select: { id: true }
    });
    if (alreadyLinked?.id) {
      await recordUserClientLinkAuditTx(tx, {
        clubId,
        userId,
        clientId: alreadyLinked.id,
        reason: 'ALREADY_LINKED',
        source: 'FAVORITE'
      });
      return { status: 'already_linked', clientId: alreadyLinked.id };
    }

    const normalizedDni = normalizeDni(user.dni);
    const normalizedPhone = normalizeIdentityPhone(user.phoneNumber);
    const normalizedEmail = normalizeEmail(user.email);

    const candidateIds = new Set<string>();
    if (normalizedDni.length >= 6) {
      const byDni = await tx.client.findFirst({
        where: { clubId, dni: normalizedDni },
        select: { id: true, userId: true }
      });
      if (byDni?.id) candidateIds.add(byDni.id);
    }
    if (normalizedPhone) {
      const phoneVariants = getPhoneIdentityVariants(normalizedPhone);
      const byPhone = await tx.client.findFirst({
        where: { clubId, phone: { in: phoneVariants } },
        select: { id: true, userId: true }
      });
      if (byPhone?.id) candidateIds.add(byPhone.id);
    }
    if (normalizedEmail.length > 3) {
      const byEmail = await tx.client.findFirst({
        where: { clubId, email: normalizedEmail },
        select: { id: true, userId: true }
      });
      if (byEmail?.id) candidateIds.add(byEmail.id);
    }

    if (candidateIds.size > 1) {
      await this.registerDuplicateIncidentSafeTx(tx, {
        clubId,
        userId,
        reasonType: 'MULTI_SIGNAL_CONFLICT',
        candidateClientIds: Array.from(candidateIds),
        payload: {
          source: 'favorite_linking',
          signals: {
            dni: normalizedDni || null,
            phone: normalizedPhone || null,
            email: normalizedEmail || null
          }
        }
      });
      return { status: 'duplicate_detected_no_link', clientId: null };
    }

    if (candidateIds.size === 1) {
      const clientId = Array.from(candidateIds)[0];
      const target = await tx.client.findUnique({
        where: { id: clientId },
        select: { id: true, userId: true, dni: true, phone: true, email: true }
      });

      if (!target?.id) {
        return { status: 'insufficient_data_no_link', clientId: null, reason: 'insufficient_identity_data' };
      }
      const mismatchSignals: string[] = [];
      const targetDni = normalizeDni(target.dni);
      const targetPhone = normalizeIdentityPhone(target.phone);
      const targetEmail = normalizeEmail(target.email);
      if (normalizedDni.length >= 6 && targetDni && normalizedDni !== targetDni) mismatchSignals.push('DNI');
      if (normalizedPhone && targetPhone) {
        const inputVariants = new Set(getPhoneIdentityVariants(normalizedPhone));
        const samePhone = getPhoneIdentityVariants(targetPhone).some((value) => inputVariants.has(value));
        if (!samePhone) mismatchSignals.push('PHONE');
      }
      if (normalizedEmail.length > 3 && targetEmail.length > 3 && normalizedEmail !== targetEmail) mismatchSignals.push('EMAIL');
      if (mismatchSignals.length > 0) {
        await this.registerDuplicateIncidentSafeTx(tx, {
          clubId,
          userId,
          reasonType: 'LINKING_CONFLICT',
          candidateClientIds: [target.id],
          primaryClientId: target.id,
          payload: {
            source: 'favorite_linking',
            reason: 'identity_signal_mismatch',
            mismatchSignals
          }
        });
        return { status: 'duplicate_detected_no_link', clientId: null };
      }
      if (target.userId && Number(target.userId) !== Number(userId)) {
        await this.registerDuplicateIncidentSafeTx(tx, {
          clubId,
          userId,
          reasonType: 'LINKING_CONFLICT',
          candidateClientIds: [target.id],
          primaryClientId: target.id,
          payload: {
            source: 'favorite_linking',
            reason: 'client_already_linked_to_other_user'
          }
        });
        return { status: 'duplicate_detected_no_link', clientId: null };
      }

      await tx.client.update({
        where: { id: target.id },
        data: { userId }
      });
      let reason: UserClientLinkReason = 'EXACT_PHONE_MATCH';
      if (normalizedDni.length >= 6 && targetDni && normalizedDni === targetDni) reason = 'EXACT_DNI_MATCH';
      else if (normalizedEmail.length > 3 && targetEmail.length > 3 && normalizedEmail === targetEmail) reason = 'EXACT_EMAIL_MATCH';
      await recordUserClientLinkAuditTx(tx, {
        clubId,
        userId,
        clientId: target.id,
        reason,
        source: 'FAVORITE'
      });
      return { status: 'linked_existing_client', clientId: target.id };
    }

    const clientName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
    if (clientName.length < 2 || !normalizedPhone) {
      if (!normalizedPhone) {
        return { status: 'insufficient_data_no_link', clientId: null, reason: 'missing_phone' };
      }
      if (clientName.length < 2) {
        return { status: 'insufficient_data_no_link', clientId: null, reason: 'missing_name' };
      }
      return { status: 'insufficient_data_no_link', clientId: null, reason: 'insufficient_identity_data' };
    }

    try {
      const createdClient = await tx.client.create({
        data: {
          clubId,
          userId,
          name: clientName,
          phone: normalizedPhone,
          ...(normalizedDni.length >= 6 ? { dni: normalizedDni } : {}),
          ...(normalizedEmail.length > 3 ? { email: normalizedEmail } : {})
        },
        select: { id: true }
      });
      await recordUserClientLinkAuditTx(tx, {
        clubId,
        userId,
        clientId: createdClient.id,
        reason: 'CREATED_CLIENT',
        source: 'FAVORITE'
      });
      return { status: 'created_client', clientId: createdClient.id };
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.registerDuplicateIncidentSafeTx(tx, {
          clubId,
          userId,
          reasonType: 'LINKING_CONFLICT',
          candidateClientIds: [],
          payload: {
            source: 'favorite_linking',
            reason: 'unique_constraint_conflict_on_link_or_identity'
          }
        });
        return { status: 'duplicate_detected_no_link', clientId: null };
      }
      throw error;
    }
  }

  private async registerDuplicateIncidentSafeTx(tx: any, input: {
    clubId: number;
    userId?: number | null;
    reasonType: string;
    primaryClientId?: string | null;
    candidateClientIds: string[];
    payload?: Record<string, any>;
  }) {
    try {
      if (!tx || !(tx as any).clientDuplicateIncident) return;
      const candidateClientIds = Array.from(
        new Set((input.candidateClientIds || []).map((value) => String(value || '').trim()).filter(Boolean))
      );
      await this.duplicateIncidentService.createOrReuseIncidentTx(tx, {
        clubId: Number(input.clubId),
        userId: input.userId ?? null,
        sourceType: 'FAVORITE',
        reasonType: String(input.reasonType || 'UNKNOWN'),
        primaryClientId: input.primaryClientId ? String(input.primaryClientId) : null,
        candidateClientIds,
        payload: input.payload || null
      });
    } catch {
      // No bloqueamos favoritos por fallas de trazabilidad de incidentes.
    }
  }
}
