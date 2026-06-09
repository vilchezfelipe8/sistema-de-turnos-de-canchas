import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';
import { recordUserClientLinkAuditTx } from './UserClientLinkAudit';

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
      throw badRequest('candidateClientIds is required', ErrorCodes.INVALID_INPUT);
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

  async createManualIdentityReview(input: {
    clubId: number;
    clientId: string;
    clientName: string;
    email?: string | null;
    phone?: string | null;
    dni?: string | null;
    status?: string | null;
    reasonCode?: string | null;
    summary?: string | null;
    signals?: string[] | null;
    recommendedUserId?: number | null;
    userCandidates?: any[] | null;
    duplicateClients?: any[] | null;
    note?: string | null;
    actorUserId?: number | null;
  }) {
    const duplicateClientIds = Array.isArray(input.duplicateClients)
      ? input.duplicateClients
          .map((row: any) => String(row?.clientId || row?.id || '').trim())
          .filter(Boolean)
      : [];

    const candidateClientIds = normalizeIds([input.clientId, ...duplicateClientIds]);
    const signals = Array.isArray(input.signals) ? input.signals.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean) : [];
    const status = String(input.status || 'REVIEW_REQUIRED').trim().toUpperCase();
    const reasonCode = String(input.reasonCode || 'NO_STRONG_MATCH').trim().toUpperCase();

    const reasonType = reasonCode === 'DUPLICATE_CLIENTS_FOUND' || reasonCode === 'DUPLICATE_CLIENT_AND_USER_CONFLICT'
      ? 'MULTI_SIGNAL_CONFLICT'
      : reasonCode === 'USER_ALREADY_LINKED_ELSEWHERE' || reasonCode === 'MULTIPLE_USER_CANDIDATES'
      ? 'LINKING_CONFLICT'
      : signals.includes('PHONE')
      ? 'PHONE'
      : signals.includes('EMAIL')
      ? 'EMAIL'
      : signals.includes('DNI')
      ? 'DNI'
      : 'UNKNOWN';

    const incident = await this.createOrReuseIncident({
      clubId: Number(input.clubId),
      userId: Number(input.recommendedUserId || 0) > 0 ? Number(input.recommendedUserId) : null,
      sourceType: 'ADMIN',
      reasonType,
      primaryClientId: String(input.clientId),
      candidateClientIds,
      payload: {
        kind: 'IDENTITY_REVIEW',
        clientId: String(input.clientId),
        clientName: String(input.clientName || '').trim() || 'Cliente sin nombre',
        email: input.email || null,
        phone: input.phone || null,
        dni: input.dni || null,
        status,
        reasonCode,
        summary: input.summary ? String(input.summary) : null,
        signals,
        recommendedUserId: Number(input.recommendedUserId || 0) > 0 ? Number(input.recommendedUserId) : null,
        userCandidates: Array.isArray(input.userCandidates) ? input.userCandidates : [],
        duplicateClients: Array.isArray(input.duplicateClients) ? input.duplicateClients : [],
        note: input.note ? String(input.note) : null,
        source: 'CLIENT_PROFILE_IDENTITY_REVIEW',
      }
    });

    if (Number(input.actorUserId || 0) > 0) {
      try {
        await prisma.auditLog.create({
          data: {
            clubId: Number(input.clubId),
            userId: Number(input.actorUserId),
            entity: 'CLIENT',
            entityId: String(input.clientId),
            action: 'IDENTITY_REVIEW_MARKED',
            payload: {
              incidentId: String((incident as any)?.id || ''),
              status,
              reasonCode,
              note: input.note ? String(input.note) : null,
              source: 'CLIENT_PROFILE'
            }
          }
        });
      } catch {
        // noop
      }
    }

    return incident;
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
      if (!incident) throw notFound('Incidente no encontrado', ErrorCodes.NOT_FOUND);
      if (incident.status !== 'OPEN') throw conflict('El incidente ya no está abierto', ErrorCodes.CONFLICT);
      if (!incident.userId) throw badRequest('El incidente no tiene usuario asociado para vincular', ErrorCodes.INVALID_INPUT);

      const candidateClientIds = normalizeIds(incident.candidateClientIds);
      if (!candidateClientIds.includes(String(input.clientId))) {
        throw conflict('El cliente seleccionado no pertenece a los candidatos del incidente', ErrorCodes.CLIENT_OUT_OF_CLUB);
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
      if (!targetClient?.id) throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);
      if (targetClient.userId && Number(targetClient.userId) !== Number(incident.userId)) {
        throw conflict('El cliente seleccionado ya está vinculado a otro usuario', ErrorCodes.CONFLICT);
      }

      await tx.client.update({
        where: { id: targetClient.id },
        data: { userId: Number(incident.userId) }
      });
      await recordUserClientLinkAuditTx(tx, {
        clubId: Number(input.clubId),
        userId: Number(incident.userId),
        clientId: String(targetClient.id),
        reason: 'MANUAL_ADMIN_LINK',
        source: 'DUPLICATE_INCIDENT',
        actorUserId: Number(input.actorUserId),
        payload: {
          incidentId: String(incident.id)
        }
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
    if (!existing) throw notFound('Incidente no encontrado', ErrorCodes.NOT_FOUND);
    if (existing.status !== 'OPEN') throw conflict('El incidente ya no está abierto', ErrorCodes.CONFLICT);

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
