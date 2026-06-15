import { prisma } from '../prisma';
import { ErrorCodes, forbidden, notFound } from '../errors';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { normalizeEmail } from '../utils/magicLink';

export type IdentityMatchSignal = 'EMAIL' | 'PHONE' | 'DNI';
export type ClientIdentityOverviewStatus = 'LINKED' | 'SUGGESTED_LINK' | 'REVIEW_REQUIRED' | 'NO_MATCH';
export type ClientIdentityOverviewReasonCode =
  | 'ALREADY_LINKED'
  | 'SINGLE_USER_CANDIDATE'
  | 'MULTIPLE_USER_CANDIDATES'
  | 'USER_ALREADY_LINKED_ELSEWHERE'
  | 'DUPLICATE_CLIENTS_FOUND'
  | 'DUPLICATE_CLIENT_AND_USER_CONFLICT'
  | 'NO_STRONG_MATCH';

export type IdentityUserCandidate = {
  userId: number;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  matchedBy: IdentityMatchSignal[];
  linkedClientId: string | null;
  linkedClientName: string | null;
};

export type IdentityDuplicateClient = {
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  userId: number | null;
  matchedBy: IdentityMatchSignal[];
};

export type ClientIdentityOverview = {
  clientId: string;
  clubId: number;
  status: ClientIdentityOverviewStatus;
  reasonCode: ClientIdentityOverviewReasonCode;
  summary: string;
  linkedUser: {
    id: number;
    displayName: string;
    email: string | null;
  } | null;
  recommendedUserId: number | null;
  signals: IdentityMatchSignal[];
  userCandidates: IdentityUserCandidate[];
  duplicateClients: IdentityDuplicateClient[];
  incidentId?: string | null;
  isManualReview?: boolean;
  manualReviewNote?: string | null;
  manualReviewCreatedAt?: Date | null;
};

export type ClientIdentityQueueItem = {
  clientId: string;
  clubId: number;
  clientName: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  status: ClientIdentityOverviewStatus;
  reasonCode: ClientIdentityOverviewReasonCode;
  summary: string;
  recommendedUserId: number | null;
  signals: IdentityMatchSignal[];
  userCandidates: IdentityUserCandidate[];
  duplicateClients: IdentityDuplicateClient[];
  incidentId?: string | null;
  isManualReview?: boolean;
  manualReviewNote?: string | null;
  manualReviewCreatedAt?: Date | null;
};

type ClientRow = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  user?: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
};

type UserRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  dni: string | null;
};

export class ClientIdentityOverviewService {
  async getOverview(clubId: number, clientId: string): Promise<ClientIdentityOverview> {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        dni: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          }
        }
      }
    }) as ClientRow | null;

    if (!client) {
      throw notFound('Cliente no encontrado', ErrorCodes.CLIENT_NOT_FOUND);
    }
    if (Number(client.clubId) !== Number(clubId)) {
      throw forbidden('El cliente no pertenece a este club.', ErrorCodes.CLIENT_OUT_OF_CLUB);
    }

    const overview = await this.buildOverviewForClient(client);
    return this.attachManualIncident(overview, client);
  }

  async listQueue(clubId: number, input?: {
    statuses?: ClientIdentityOverviewStatus[];
    limit?: number | null;
  }): Promise<ClientIdentityQueueItem[]> {
    const limit = Math.min(Math.max(Number(input?.limit || 60), 1), 200);
    const allowedStatuses = new Set(
      (Array.isArray(input?.statuses) && input?.statuses.length > 0
        ? input?.statuses
        : ['REVIEW_REQUIRED', 'SUGGESTED_LINK']
      ).map((status) => String(status).trim().toUpperCase())
    );

    const clients = await prisma.client.findMany({
      where: {
        clubId: Number(clubId),
        userId: null
      },
      select: {
        id: true,
        clubId: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        dni: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit
    }) as ClientRow[];

    const rows = await Promise.all(
      clients
        .filter((client) => {
          const hasEmail = Boolean(normalizeEmail(String(client.email || '')));
          const hasPhone = Boolean(normalizeIdentityPhone(client.phone));
          const hasDni = String(client.dni || '').replace(/\D/g, '').trim().length >= 6;
          return hasEmail || hasPhone || hasDni;
        })
        .map(async (client) => {
          const overview = await this.attachManualIncident(await this.buildOverviewForClient(client), client);
          if (!allowedStatuses.has(String(overview.status || '').trim().toUpperCase())) return null;
          return {
            clientId: client.id,
            clubId: Number(client.clubId),
            clientName: String(client.name || '').trim() || 'Cliente sin nombre',
            email: client.email || null,
            phone: client.phone || null,
            dni: client.dni || null,
            status: overview.status,
            reasonCode: overview.reasonCode,
            summary: overview.summary,
            recommendedUserId: overview.recommendedUserId,
            signals: overview.signals,
            userCandidates: overview.userCandidates,
            duplicateClients: overview.duplicateClients
          } satisfies ClientIdentityQueueItem;
        })
    );

    const computedRows = rows
      .filter((row): row is ClientIdentityQueueItem => Boolean(row))
      .sort((a, b) => {
        const weight = (status: string) => (status === 'REVIEW_REQUIRED' ? 0 : status === 'SUGGESTED_LINK' ? 1 : 2);
        return weight(a.status) - weight(b.status);
      });

    const manualIncidents = await prisma.clientDuplicateIncident.findMany({
      where: {
        clubId: Number(clubId),
        status: 'OPEN',
        sourceType: 'ADMIN'
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit
    });

    const rowByClientId = new Map(computedRows.map((row) => [String(row.clientId), row]));
    for (const incident of manualIncidents as any[]) {
      const payload = incident?.payload && typeof incident.payload === 'object'
        ? (incident.payload as Record<string, any>)
        : {};
      if (String(payload?.kind || '') !== 'IDENTITY_REVIEW') continue;
      const manualClientId = String(payload?.clientId || incident?.primaryClientId || incident?.candidateClientIds?.[0] || '').trim();
      if (!manualClientId) continue;
      const incidentStatus = String(payload?.status || 'REVIEW_REQUIRED').trim().toUpperCase() as ClientIdentityOverviewStatus;
      if (!allowedStatuses.has(incidentStatus)) continue;

      const base = rowByClientId.get(manualClientId) || null;
      const manualRow: ClientIdentityQueueItem = {
        clientId: manualClientId,
        clubId: Number(clubId),
        clientName: String(payload?.clientName || base?.clientName || 'Cliente sin nombre'),
        email: payload?.email ?? base?.email ?? null,
        phone: payload?.phone ?? base?.phone ?? null,
        dni: payload?.dni ?? base?.dni ?? null,
        status: base?.status || incidentStatus,
        reasonCode: (base?.reasonCode || String(payload?.reasonCode || 'NO_STRONG_MATCH').trim().toUpperCase()) as ClientIdentityOverviewReasonCode,
        summary: base?.summary || String(payload?.summary || payload?.note || 'Caso marcado manualmente para revisión.'),
        recommendedUserId: base?.recommendedUserId ?? (Number(payload?.recommendedUserId || 0) > 0 ? Number(payload?.recommendedUserId) : null),
        signals: Array.isArray(payload?.signals) && payload.signals.length > 0 ? payload.signals as IdentityMatchSignal[] : (base?.signals || []),
        userCandidates: Array.isArray(payload?.userCandidates) ? payload.userCandidates as IdentityUserCandidate[] : (base?.userCandidates || []),
        duplicateClients: Array.isArray(payload?.duplicateClients) ? payload.duplicateClients as IdentityDuplicateClient[] : (base?.duplicateClients || []),
        incidentId: String(incident.id),
        isManualReview: true,
        manualReviewNote: String(payload?.note || '').trim() || null,
        manualReviewCreatedAt: incident?.createdAt ? new Date(incident.createdAt) : null
      };
      rowByClientId.set(manualClientId, manualRow);
    }

    return Array.from(rowByClientId.values()).sort((a, b) => {
      const manualWeightA = a.isManualReview ? 0 : 1;
      const manualWeightB = b.isManualReview ? 0 : 1;
      if (manualWeightA !== manualWeightB) return manualWeightA - manualWeightB;
      const createdA = a.manualReviewCreatedAt ? new Date(a.manualReviewCreatedAt).getTime() : 0;
      const createdB = b.manualReviewCreatedAt ? new Date(b.manualReviewCreatedAt).getTime() : 0;
      if (createdA !== createdB) return createdB - createdA;
      const weight = (status: string) => (status === 'REVIEW_REQUIRED' ? 0 : status === 'SUGGESTED_LINK' ? 1 : 2);
      return weight(a.status) - weight(b.status);
    });
  }

  private async attachManualIncident(overview: ClientIdentityOverview, client: Pick<ClientRow, 'id' | 'clubId' | 'name' | 'email' | 'phone' | 'dni'>) {
    const incident = await this.findOpenManualIncidentForClient(Number(client.clubId), String(client.id));
    if (!incident) return overview;
    const payload = incident?.payload && typeof incident.payload === 'object'
      ? (incident.payload as Record<string, any>)
      : {};
    return {
      ...overview,
      incidentId: String(incident.id),
      isManualReview: true,
      manualReviewNote: String(payload?.note || '').trim() || null,
      manualReviewCreatedAt: incident.createdAt ? new Date(incident.createdAt) : null
    };
  }

  private async findOpenManualIncidentForClient(clubId: number, clientId: string) {
    const incidents = await prisma.clientDuplicateIncident.findMany({
      where: {
        clubId: Number(clubId),
        status: 'OPEN',
        sourceType: 'ADMIN'
      },
      orderBy: { createdAt: 'desc' }
    });

    return incidents.find((incident) => {
      if (String(incident.primaryClientId || '') === String(clientId)) {
        return true;
      }
      const candidateIds = Array.isArray(incident.candidateClientIds)
        ? incident.candidateClientIds.map((value) => String(value))
        : [];
      return candidateIds.includes(String(clientId));
    }) || null;
  }

  private async buildOverviewForClient(client: ClientRow): Promise<ClientIdentityOverview> {
    if (Number(client.userId || 0) > 0 && client.user) {
      const normalizedEmail = normalizeEmail(String(client.email || ''));
      const normalizedPhone = normalizeIdentityPhone(client.phone);
      const normalizedDni = String(client.dni || '').replace(/\D/g, '').trim();
      const phoneVariants = normalizedPhone ? getPhoneIdentityVariants(normalizedPhone) : [];
      const signals: IdentityMatchSignal[] = [];
      if (normalizedEmail) signals.push('EMAIL');
      if (phoneVariants.length > 0) signals.push('PHONE');
      if (normalizedDni.length >= 6) signals.push('DNI');
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'LINKED',
        reasonCode: 'ALREADY_LINKED',
        summary: 'Este cliente ya está vinculado a un usuario del sistema.',
        linkedUser: {
          id: Number(client.user.id),
          displayName: this.buildUserDisplayName(client.user),
          email: client.user.email || null
        },
        recommendedUserId: null,
        signals,
        userCandidates: [],
        duplicateClients: []
      };
    }

    const normalizedEmail = normalizeEmail(String(client.email || ''));
    const normalizedPhone = normalizeIdentityPhone(client.phone);
    const normalizedDni = String(client.dni || '').replace(/\D/g, '').trim();
    const phoneVariants = normalizedPhone ? getPhoneIdentityVariants(normalizedPhone) : [];
    const signals: IdentityMatchSignal[] = [];
    if (normalizedEmail) signals.push('EMAIL');
    if (phoneVariants.length > 0) signals.push('PHONE');
    if (normalizedDni.length >= 6) signals.push('DNI');

    const userWhereOr: any[] = [];
    if (normalizedEmail) userWhereOr.push({ email: normalizedEmail });
    if (phoneVariants.length > 0) userWhereOr.push({ phoneNumber: { in: phoneVariants } });
    if (normalizedDni.length >= 6) userWhereOr.push({ dni: normalizedDni });

    const clientWhereOr: any[] = [];
    if (normalizedEmail) clientWhereOr.push({ email: normalizedEmail });
    if (phoneVariants.length > 0) clientWhereOr.push({ phone: { in: phoneVariants } });
    if (normalizedDni.length >= 6) clientWhereOr.push({ dni: normalizedDni });

    const [matchingUsers, duplicateClients, linkedClientsForUsers] = await Promise.all([
      userWhereOr.length > 0
        ? prisma.user.findMany({
            where: { OR: userWhereOr },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              dni: true
            }
          }) as Promise<UserRow[]>
        : Promise.resolve([] as UserRow[]),
      clientWhereOr.length > 0
        ? prisma.client.findMany({
            where: {
              clubId: Number(client.clubId),
              OR: clientWhereOr,
              NOT: { id: client.id }
            },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              dni: true,
              userId: true
            }
          })
        : Promise.resolve([] as any[]),
      userWhereOr.length > 0
        ? prisma.client.findMany({
            where: {
              clubId: Number(client.clubId),
              userId: {
                in: (await prisma.user.findMany({
                  where: { OR: userWhereOr },
                  select: { id: true }
                })).map((user) => Number(user.id))
              }
            },
            select: {
              id: true,
              userId: true,
              name: true
            }
          })
        : Promise.resolve([] as any[])
    ]);

    const linkedClientByUserId = new Map<number, { id: string; name: string }>();
    for (const linkedClient of linkedClientsForUsers) {
      if (Number(linkedClient.userId || 0) > 0) {
        linkedClientByUserId.set(Number(linkedClient.userId), {
          id: String(linkedClient.id),
          name: String(linkedClient.name || '').trim() || 'Cliente'
        });
      }
    }

    const userCandidates: IdentityUserCandidate[] = matchingUsers.map((user) => {
      const linkedClient = linkedClientByUserId.get(Number(user.id)) || null;
      return {
        userId: Number(user.id),
        displayName: this.buildUserDisplayName(user),
        email: user.email || null,
        phoneNumber: user.phoneNumber || null,
        matchedBy: this.getUserMatchSignals(user, { email: normalizedEmail, phoneVariants, dni: normalizedDni }),
        linkedClientId: linkedClient?.id || null,
        linkedClientName: linkedClient?.name || null
      };
    });

    const duplicateClientRows: IdentityDuplicateClient[] = duplicateClients.map((row: any) => ({
      clientId: String(row.id),
      name: String(row.name || '').trim() || 'Cliente sin nombre',
      email: row.email || null,
      phone: row.phone || null,
      dni: row.dni || null,
      userId: Number(row.userId || 0) > 0 ? Number(row.userId) : null,
      matchedBy: this.getClientMatchSignals(row, { email: normalizedEmail, phoneVariants, dni: normalizedDni })
    }));

    const blockedUsers = userCandidates.filter((candidate) => candidate.linkedClientId && candidate.linkedClientId !== client.id);
    const availableUsers = userCandidates.filter((candidate) => !candidate.linkedClientId);

    if (duplicateClientRows.length > 0 && userCandidates.length > 0) {
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'REVIEW_REQUIRED',
        reasonCode: 'DUPLICATE_CLIENT_AND_USER_CONFLICT',
        summary: 'Hay clientes duplicados y además usuarios compatibles. Revisá antes de vincular.',
        linkedUser: null,
        recommendedUserId: null,
        signals,
        userCandidates,
        duplicateClients: duplicateClientRows
      };
    }

    if (duplicateClientRows.length > 0) {
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'REVIEW_REQUIRED',
        reasonCode: 'DUPLICATE_CLIENTS_FOUND',
        summary: `Hay ${duplicateClientRows.length} clientes del club con la misma identidad fuerte.`,
        linkedUser: null,
        recommendedUserId: null,
        signals,
        userCandidates,
        duplicateClients: duplicateClientRows
      };
    }

    if (blockedUsers.length > 0) {
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'REVIEW_REQUIRED',
        reasonCode: 'USER_ALREADY_LINKED_ELSEWHERE',
        summary: 'Encontramos un usuario compatible, pero ya está vinculado a otro cliente del club.',
        linkedUser: null,
        recommendedUserId: null,
        signals,
        userCandidates,
        duplicateClients: duplicateClientRows
      };
    }

    if (availableUsers.length === 1) {
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'SUGGESTED_LINK',
        reasonCode: 'SINGLE_USER_CANDIDATE',
        summary: 'Encontramos un único usuario compatible para vincular.',
        linkedUser: null,
        recommendedUserId: Number(availableUsers[0].userId),
        signals,
        userCandidates,
        duplicateClients: duplicateClientRows
      };
    }

    if (availableUsers.length > 1) {
      return {
        clientId: client.id,
        clubId: Number(client.clubId),
        status: 'REVIEW_REQUIRED',
        reasonCode: 'MULTIPLE_USER_CANDIDATES',
        summary: `Encontramos ${availableUsers.length} usuarios compatibles. Elegí el correcto manualmente.`,
        linkedUser: null,
        recommendedUserId: null,
        signals,
        userCandidates,
        duplicateClients: duplicateClientRows
      };
    }

    return {
      clientId: client.id,
      clubId: Number(client.clubId),
      status: 'NO_MATCH',
      reasonCode: 'NO_STRONG_MATCH',
      summary: 'No encontramos un usuario compatible con señales fuertes.',
      linkedUser: null,
      recommendedUserId: null,
      signals,
      userCandidates,
      duplicateClients: duplicateClientRows
    };
  }

  private buildUserDisplayName(user: Pick<UserRow, 'id' | 'firstName' | 'lastName' | 'email'>) {
    const fullName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
    return fullName || String(user.email || '').trim() || `Usuario ${user.id}`;
  }

  private getUserMatchSignals(user: Pick<UserRow, 'email' | 'phoneNumber' | 'dni'>, identity: {
    email: string | null;
    phoneVariants: string[];
    dni: string;
  }): IdentityMatchSignal[] {
    const signals: IdentityMatchSignal[] = [];
    if (identity.email && normalizeEmail(String(user.email || '')) === identity.email) signals.push('EMAIL');
    const normalizedUserPhone = normalizeIdentityPhone(user.phoneNumber);
    if (normalizedUserPhone && getPhoneIdentityVariants(normalizedUserPhone).some((variant) => identity.phoneVariants.includes(variant))) {
      signals.push('PHONE');
    }
    if (identity.dni.length >= 6 && String(user.dni || '').replace(/\D/g, '').trim() === identity.dni) {
      signals.push('DNI');
    }
    return signals;
  }

  private getClientMatchSignals(client: Pick<ClientRow, 'email' | 'phone' | 'dni'>, identity: {
    email: string | null;
    phoneVariants: string[];
    dni: string;
  }): IdentityMatchSignal[] {
    const signals: IdentityMatchSignal[] = [];
    if (identity.email && normalizeEmail(String(client.email || '')) === identity.email) signals.push('EMAIL');
    const normalizedClientPhone = normalizeIdentityPhone(client.phone);
    if (normalizedClientPhone && getPhoneIdentityVariants(normalizedClientPhone).some((variant) => identity.phoneVariants.includes(variant))) {
      signals.push('PHONE');
    }
    if (identity.dni.length >= 6 && String(client.dni || '').replace(/\D/g, '').trim() === identity.dni) {
      signals.push('DNI');
    }
    return signals;
  }
}
