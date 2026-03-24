import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { ClientDuplicateIncidentService } from './ClientDuplicateIncidentService';

type LinkStatus =
  | 'already_linked'
  | 'linked_existing_client'
  | 'created_client'
  | 'duplicate_detected_no_link'
  | 'insufficient_data_no_link';

type LinkResult = {
  status: LinkStatus;
  clientId: string | null;
};

const normalizeDni = (value: unknown) => String(value || '').replace(/\D/g, '');
const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

export class ClubFavoriteService {
  private readonly duplicateIncidentService = new ClientDuplicateIncidentService();

  async listFavorites(userId: number) {
    const favorites = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
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
  }

  async removeFavorite(userId: number, clubId: number) {
    await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      await txAny.clubFavorite.deleteMany({
        where: { userId, clubId }
      });
    });
    return { removed: true };
  }

  async markFavorite(userId: number, clubId: number) {
    return prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const club = await tx.club.findUnique({
        where: { id: clubId },
        select: { id: true }
      });
      if (!club?.id) {
        throw new Error('Club no encontrado');
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
        select: { id: true, userId: true }
      });

      if (!target?.id) {
        return { status: 'insufficient_data_no_link', clientId: null };
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
      return { status: 'linked_existing_client', clientId: target.id };
    }

    const clientName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
    if (clientName.length < 2 || !normalizedPhone) {
      return { status: 'insufficient_data_no_link', clientId: null };
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
