import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type IncidentStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
type SourceType = 'BOOKING' | 'FIXED_BOOKING' | 'CASH' | 'FAVORITE' | 'ADMIN' | 'UNKNOWN';
type ReasonType = 'PHONE' | 'EMAIL' | 'DNI' | 'LINKING_CONFLICT' | 'MULTI_SIGNAL_CONFLICT' | 'UNKNOWN';

type RegisterIncidentInput = {
  clubId: number;
  userId?: number | null;
  sourceType: SourceType | string;
  reasonType: ReasonType | string;
  primaryClientId?: string | null;
  candidateClientIds: string[];
  payload?: Record<string, any> | null;
};

const normalizeIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0)
    )
  ).sort();
};

const buildDedupeKey = (input: RegisterIncidentInput) => {
  const userId = Number(input.userId || 0) > 0 ? String(Number(input.userId)) : 'none';
  const candidate = normalizeIds(input.candidateClientIds).join(',');
  const primary = String(input.primaryClientId || '').trim() || 'none';
  return [
    String(input.clubId),
    String(input.sourceType || 'UNKNOWN').toUpperCase(),
    String(input.reasonType || 'UNKNOWN').toUpperCase(),
    userId,
    primary,
    candidate
  ].join('|');
};

export class ClientDuplicateIncidentService {
  async createOrReuseIncident(input: RegisterIncidentInput) {
    return prisma.$transaction((tx) => this.createOrReuseIncidentTx(tx as any, input));
  }

  async createOrReuseIncidentTx(tx: any, input: RegisterIncidentInput) {
    const candidateClientIds = normalizeIds(input.candidateClientIds);
    if (candidateClientIds.length === 0) {
      throw new Error('candidateClientIds is required');
    }

    const dedupeKey = buildDedupeKey(input);
    const txAny = tx as any;
    const existing = await txAny.clientDuplicateIncident.findFirst({
      where: {
        clubId: input.clubId,
        status: 'OPEN',
        dedupeKey
      },
      select: { id: true }
    });

    if (existing?.id) {
      return txAny.clientDuplicateIncident.update({
        where: { id: existing.id },
        data: {
          payload: input.payload || Prisma.JsonNull
        }
      });
    }

    return txAny.clientDuplicateIncident.create({
      data: {
        clubId: input.clubId,
        userId: Number(input.userId || 0) > 0 ? Number(input.userId) : null,
        status: 'OPEN',
        sourceType: String(input.sourceType || 'UNKNOWN').toUpperCase(),
        reasonType: String(input.reasonType || 'UNKNOWN').toUpperCase(),
        primaryClientId: input.primaryClientId ? String(input.primaryClientId) : null,
        candidateClientIds,
        dedupeKey,
        payload: input.payload || Prisma.JsonNull
      }
    });
  }

  async listByClub(input: {
    clubId: number;
    status?: IncidentStatus | null;
    sourceType?: string | null;
  }) {
    const txAny = prisma as any;
    const where: any = { clubId: input.clubId };
    if (input.status) where.status = String(input.status);
    if (input.sourceType) where.sourceType = String(input.sourceType).toUpperCase();

    return txAny.clientDuplicateIncident.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, dni: true }
        },
        resolvedByUser: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }

  async getDetail(input: { clubId: number; incidentId: string }) {
    const txAny = prisma as any;
    const incident = await txAny.clientDuplicateIncident.findFirst({
      where: {
        id: input.incidentId,
        clubId: input.clubId
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, dni: true }
        },
        resolvedByUser: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
    if (!incident) return null;

    const candidateClientIds = normalizeIds(incident.candidateClientIds);
    const candidates = candidateClientIds.length > 0
      ? await prisma.client.findMany({
          where: { clubId: input.clubId, id: { in: candidateClientIds } },
          select: { id: true, name: true, phone: true, email: true, dni: true, userId: true, isProfessor: true, createdAt: true, updatedAt: true }
        })
      : [];

    const candidateById = new Map(candidates.map((client) => [client.id, client]));
    const orderedCandidates = candidateClientIds
      .map((id) => candidateById.get(id))
      .filter(Boolean);

    return {
      ...incident,
      candidateClients: orderedCandidates
    };
  }

  async resolveByLinkingUser(input: {
    clubId: number;
    incidentId: string;
    clientId: string;
    actorUserId: number;
  }) {
    return prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const incident = await txAny.clientDuplicateIncident.findFirst({
        where: { id: input.incidentId, clubId: input.clubId }
      });
      if (!incident) throw new Error('Incidente no encontrado');
      if (incident.status !== 'OPEN') throw new Error('El incidente ya no está abierto');
      if (!incident.userId) throw new Error('El incidente no tiene usuario asociado para vincular');

      const candidateClientIds = normalizeIds(incident.candidateClientIds);
      if (!candidateClientIds.includes(String(input.clientId))) {
        throw new Error('El cliente seleccionado no pertenece a los candidatos del incidente');
      }

      const targetClient = await tx.client.findFirst({
        where: {
          id: input.clientId,
          clubId: input.clubId
        },
        select: {
          id: true,
          userId: true
        }
      });
      if (!targetClient?.id) throw new Error('Cliente no encontrado');
      if (targetClient.userId && Number(targetClient.userId) !== Number(incident.userId)) {
        throw new Error('El cliente seleccionado ya está vinculado a otro usuario');
      }

      await tx.client.update({
        where: { id: targetClient.id },
        data: { userId: Number(incident.userId) }
      });

      return txAny.clientDuplicateIncident.update({
        where: { id: incident.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'LINK_USER_TO_CLIENT',
          resolvedClientId: targetClient.id,
          resolvedByUserId: Number(input.actorUserId),
          resolvedAt: new Date()
        }
      });
    });
  }

  async dismissIncident(input: {
    clubId: number;
    incidentId: string;
    actorUserId: number;
    resolutionNotes?: string | null;
  }) {
    const txAny = prisma as any;
    const existing = await txAny.clientDuplicateIncident.findFirst({
      where: { id: input.incidentId, clubId: input.clubId }
    });
    if (!existing) throw new Error('Incidente no encontrado');
    if (existing.status !== 'OPEN') throw new Error('El incidente ya no está abierto');

    return txAny.clientDuplicateIncident.update({
      where: { id: existing.id },
      data: {
        status: 'DISMISSED',
        resolutionType: 'DISMISSED',
        resolutionNotes: input.resolutionNotes ? String(input.resolutionNotes) : null,
        resolvedByUserId: Number(input.actorUserId),
        resolvedAt: new Date()
      }
    });
  }
}
